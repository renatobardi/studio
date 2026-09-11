"""The event store: NIP-01 historical queries, replaceable/addressable
upsert semantics, and a single live-query fan-out to many subscriptions.

ADR-0004 spike outcome: the SurrealDB Python SDK's *embedded* (`mem://`)
engine has a broken `live()`/`subscribe_live()` in `surrealdb==2.0.0` (it
reaches for `self.live_queues`, an attribute only initialised on the
WebSocket connection class). Live queries DO work correctly against a real
`surreal start` instance over `ws://`. This store therefore always connects
over the wire, never through the embedded engine — the same instance a
production deployment would use (`surrealdb` service in Compose, in-memory
or persisted storage on the server side).
"""

import asyncio
from collections.abc import Sequence
from enum import Enum
from typing import Any, cast

from surrealdb import AsyncSurreal
from surrealdb.data.types.record_id import RecordID
from surrealdb.errors import SurrealError

from studio_api.nostr.kinds import KindClass, kind_class
from studio_api.nostr.model import Filter, NostrEvent

_SCHEMA = "DEFINE TABLE IF NOT EXISTS event SCHEMALESS"


class PublishResult(Enum):
    OK = "ok"
    DUPLICATE = "duplicate"
    SUPERSEDED = "superseded"


def _build_tag_index(tags: list[list[str]]) -> list[str]:
    return [
        f"{tag[0]}:{tag[1]}"
        for tag in tags
        if len(tag) >= 2 and len(tag[0]) == 1 and tag[0].isalpha()
    ]


def replace_key(event: NostrEvent, kind_cls: KindClass) -> str:
    if kind_cls is KindClass.REPLACEABLE:
        return f"{event['pubkey']}:{event['kind']}"
    d_value = next((t[1] for t in event["tags"] if len(t) >= 2 and t[0] == "d"), "")
    return f"{event['pubkey']}:{event['kind']}:{d_value}"


def record_key(event: NostrEvent, *, workspace_slug: str) -> str:
    """The `event` table's record id. Namespaced by Workspace so two
    Workspaces on the same server never share a row — neither a replaceable
    slot (same pubkey + kind) nor the same regular event id (ticket #45)."""
    kind_cls = kind_class(event["kind"])
    key = (
        replace_key(event, kind_cls)
        if kind_cls in (KindClass.REPLACEABLE, KindClass.ADDRESSABLE)
        else event["id"]
    )
    return f"{workspace_slug}:{key}"


def _supersedes(new_event: NostrEvent, current_row: dict[str, Any]) -> bool:
    if new_event["created_at"] != current_row["created_at"]:
        return bool(new_event["created_at"] > current_row["created_at"])
    return bool(new_event["id"] < current_row["event_id"])


def to_event_row(event: NostrEvent, *, workspace_slug: str) -> dict[str, Any]:
    return {
        "workspace_slug": workspace_slug,
        "event_id": event["id"],
        "pubkey": event["pubkey"],
        "created_at": event["created_at"],
        "kind": event["kind"],
        "tags": event["tags"],
        "content": event["content"],
        "sig": event["sig"],
        "tag_index": _build_tag_index(event["tags"]),
    }


def _from_row(row: dict[str, Any]) -> NostrEvent:
    return {
        "id": row["event_id"],
        "pubkey": row["pubkey"],
        "created_at": row["created_at"],
        "kind": row["kind"],
        "tags": row["tags"],
        "content": row["content"],
        "sig": row["sig"],
    }


def build_query(flt: Filter, *, workspace_slug: str) -> tuple[str, dict[str, Any]]:
    """Map one NIP-01 filter to a SurrealQL SELECT + its bound params, always
    scoped to one Workspace."""
    clauses: list[str] = ["workspace_slug = $workspace_slug"]
    params: dict[str, Any] = {"workspace_slug": workspace_slug}

    if flt.ids is not None:
        clauses.append("event_id IN $ids")
        params["ids"] = flt.ids
    if flt.authors is not None:
        clauses.append("pubkey IN $authors")
        params["authors"] = flt.authors
    if flt.kinds is not None:
        clauses.append("kind IN $kinds")
        params["kinds"] = flt.kinds
    if flt.since is not None:
        clauses.append("created_at >= $since")
        params["since"] = flt.since
    if flt.until is not None:
        clauses.append("created_at <= $until")
        params["until"] = flt.until
    for i, (tag_name, values) in enumerate(sorted(flt.tags.items())):
        param_name = f"tagvals_{i}"
        clauses.append(f"tag_index CONTAINSANY ${param_name}")
        params[param_name] = [f"{tag_name}:{v}" for v in values]

    where = " AND ".join(clauses)
    surql = f"SELECT * FROM event WHERE {where} ORDER BY created_at DESC, event_id ASC"
    if flt.limit is not None:
        surql += " LIMIT $limit"
        params["limit"] = flt.limit
    return surql, params


class LiveFanout:
    """One `LIVE SELECT` on the event table, fanned out in-process to many
    subscriptions instead of one live query per subscription."""

    def __init__(self, db: Any, live_id: object) -> None:
        self._db = db
        self._live_id = live_id
        self._subs: dict[str, tuple[str, list[Filter], asyncio.Queue[NostrEvent]]] = {}
        self._task: asyncio.Task[None] | None = None

    def _start_consuming(self) -> None:
        self._task = asyncio.create_task(self._consume())

    async def _consume(self) -> None:
        generator = await self._db.subscribe_live(self._live_id)
        async for row in generator:
            typed_row = cast(dict[str, Any], row)
            event = _from_row(typed_row)
            row_workspace = typed_row.get("workspace_slug")
            for workspace_slug, filters, queue in list(self._subs.values()):
                from studio_api.nostr.matching import event_matches_filters

                if row_workspace == workspace_slug and event_matches_filters(event, filters):
                    await queue.put(event)

    async def subscribe(
        self, sub_id: str, filters: list[Filter], *, workspace_slug: str
    ) -> "asyncio.Queue[NostrEvent]":
        """One subscription, scoped to one Workspace: this single app-wide
        live query feeds every Workspace, so the slug is what keeps them
        apart (ticket #45)."""
        queue: asyncio.Queue[NostrEvent] = asyncio.Queue()
        self._subs[sub_id] = (workspace_slug, filters, queue)
        return queue

    def unsubscribe(self, sub_id: str) -> None:
        self._subs.pop(sub_id, None)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._db.kill(self._live_id)


class EventStore:
    """Reads and writes events for exactly one Workspace. A server hosting
    several Workspaces holds one connection and derives a store per Workspace
    with `for_workspace()`; there is no unscoped way to publish or query."""

    def __init__(self, db: Any, workspace_slug: str | None = None) -> None:
        self._db = db
        self._workspace_slug = workspace_slug

    @property
    def workspace_slug(self) -> str:
        if self._workspace_slug is None:
            raise RuntimeError(
                "this EventStore is the bare connection — call for_workspace(slug) before "
                "reading or writing events"
            )
        return self._workspace_slug

    def for_workspace(self, slug: str) -> "EventStore":
        """Another Workspace on the same connection."""
        return EventStore(self._db, slug)

    @classmethod
    async def connect(
        cls,
        *,
        url: str,
        namespace: str,
        database: str,
        user: str,
        password: str,
        workspace_slug: str | None = None,
        max_attempts: int = 20,
        retry_delay_seconds: float = 1.0,
    ) -> "EventStore":
        """Connect, retrying while SurrealDB is still starting up (e.g. the
        `surrealdb` Compose service winning the race against `api`)."""
        last_error: Exception | None = None
        for _ in range(max_attempts):
            try:
                db = AsyncSurreal(url)
                # The library's own concrete connection classes accept no
                # argument here (the URL was already given above); only its
                # abstract base class's stub disagrees.
                await db.connect()  # type: ignore[call-arg]
                await db.signin({"username": user, "password": password})
                await db.use(namespace, database)
                await db.query(_SCHEMA)
                return cls(db, workspace_slug)
            except Exception as error:  # noqa: BLE001 — broad: any connect-phase failure retries
                last_error = error
                await asyncio.sleep(retry_delay_seconds)
        assert last_error is not None
        raise last_error

    @property
    def raw(self) -> Any:
        """The underlying SurrealDB connection, shared with the control-plane
        repository (same namespace/database, different tables) so the app
        connects once, not twice."""
        return self._db

    async def close(self) -> None:
        await self._db.close()

    async def ping(self) -> None:
        """Round-trip the database. Raises if it is unreachable."""
        await self._db.query("RETURN 1")

    async def publish(self, event: NostrEvent) -> PublishResult:
        kind_cls = kind_class(event["kind"])

        if kind_cls is KindClass.EPHEMERAL:
            return PublishResult.OK

        record_id = RecordID("event", record_key(event, workspace_slug=self.workspace_slug))
        row = to_event_row(event, workspace_slug=self.workspace_slug)

        if kind_cls in (KindClass.REPLACEABLE, KindClass.ADDRESSABLE):
            existing_rows = await self._db.select(record_id)
            if existing_rows and not _supersedes(event, existing_rows[0]):
                return PublishResult.SUPERSEDED
            await self._db.upsert(record_id, row)
            return PublishResult.OK

        try:
            await self._db.create(record_id, row)
        except SurrealError:
            return PublishResult.DUPLICATE
        return PublishResult.OK

    async def query(self, filters: Sequence[Filter]) -> list[NostrEvent]:
        seen: dict[str, NostrEvent] = {}
        for flt in filters:
            surql, params = build_query(flt, workspace_slug=self.workspace_slug)
            rows = await self._db.query(surql, params)
            for row in rows:
                event = _from_row(row)
                seen[event["id"]] = event
        events = list(seen.values())
        events.sort(key=lambda e: (-e["created_at"], e["id"]))
        return events

    async def start_live_fanout(self) -> LiveFanout:
        live_id = await self._db.live("event")
        fanout = LiveFanout(self._db, live_id)
        fanout._start_consuming()
        return fanout

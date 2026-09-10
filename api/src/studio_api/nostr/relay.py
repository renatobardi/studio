"""The relay connection state machine: NIP-01 EVENT/REQ/CLOSE plus NIP-42
AUTH, on top of the EventStore and the shared live fan-out (ADR-0004).

Transport-agnostic on purpose (see ticket #2's TDD seam): `send` is just an
async callable taking a JSON-serializable list. A thin ASGI WebSocket
adapter feeds it real wire messages; tests feed it Python lists directly.
"""

import asyncio
import secrets
import time
from collections.abc import Awaitable, Callable
from typing import Any

from studio_api.nostr.auth_event import AuthRejection, verify_auth_event
from studio_api.nostr.model import Filter, NostrEvent
from studio_api.nostr.store import EventStore, LiveFanout, PublishResult
from studio_api.nostr.validation import validate_event

SendFn = Callable[[list[Any]], Awaitable[None]]

_SINGLE_LETTER_TAG_FILTER = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")


class RelayAuthorizer:
    """Stands in for real Workspace membership (ticket #3) with a seeded
    allowlist of pubkeys."""

    def __init__(self, allowed_pubkeys: set[str]) -> None:
        self._allowed = allowed_pubkeys

    def is_member(self, pubkey: str) -> bool:
        return pubkey in self._allowed


def parse_filter(raw: dict[str, Any]) -> Filter:
    """A NIP-01 filter as received over the wire: `#e`/`#p`/... tag keys
    alongside the plain ones."""
    tags: dict[str, list[str]] = {}
    kwargs: dict[str, Any] = {}
    for key, value in raw.items():
        if len(key) == 2 and key[0] == "#" and key[1] in _SINGLE_LETTER_TAG_FILTER:
            tags[key[1]] = value
        elif key in ("ids", "authors", "kinds", "since", "until", "limit"):
            kwargs[key] = value
    return Filter(tags=tags, **kwargs)


class RelayConnection:
    def __init__(
        self,
        *,
        store: EventStore,
        fanout: LiveFanout,
        authorizer: RelayAuthorizer,
        relay_url: str,
        send: SendFn,
        connection_id: str | None = None,
        now: Callable[[], int] = lambda: int(time.time()),
    ) -> None:
        self._store = store
        self._fanout = fanout
        self._authorizer = authorizer
        self._relay_url = relay_url
        self._send = send
        self._connection_id = connection_id or secrets.token_hex(8)
        self._now = now
        self.challenge = secrets.token_hex(16)
        self._authed_pubkey: str | None = None
        self._is_member = False
        self._sub_ids: set[str] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        await self._send(["AUTH", self.challenge])

    async def handle_message(self, message: list[Any]) -> None:
        if not message:
            return
        message_type = message[0]
        if message_type == "EVENT":
            await self._handle_event(message[1])
        elif message_type == "REQ":
            await self._handle_req(message[1], message[2:])
        elif message_type == "CLOSE":
            self._handle_close(message[1])
        elif message_type == "AUTH":
            await self._handle_auth(message[1])
        # Unrecognised message types are silently ignored: NIP-01 defines no
        # client-facing error for them.

    async def close(self) -> None:
        for sub_id in list(self._sub_ids):
            self._cancel_subscription(sub_id)

    def _full_sub_id(self, sub_id: str) -> str:
        return f"{self._connection_id}:{sub_id}"

    def _cancel_subscription(self, sub_id: str) -> None:
        self._sub_ids.discard(sub_id)
        self._fanout.unsubscribe(self._full_sub_id(sub_id))
        task = self._tasks.pop(sub_id, None)
        if task is not None:
            task.cancel()

    async def _handle_auth(self, event: NostrEvent) -> None:
        result = verify_auth_event(
            event, relay_url=self._relay_url, expected_challenge=self.challenge, now=self._now()
        )
        if isinstance(result, AuthRejection):
            await self._send(["OK", event.get("id", ""), False, f"invalid: {result.message}"])
            return
        self._authed_pubkey = result
        self._is_member = self._authorizer.is_member(result)
        await self._send(["OK", event["id"], True, ""])

    async def _handle_event(self, event: NostrEvent) -> None:
        event_id = event.get("id", "")
        if self._authed_pubkey is None:
            await self._send(
                ["OK", event_id, False, "auth-required: publishing requires authentication"]
            )
            return
        if not self._is_member:
            await self._send(["OK", event_id, False, "restricted: not a member of this workspace"])
            return
        if event.get("pubkey") != self._authed_pubkey:
            await self._send(
                ["OK", event_id, False, "invalid: pubkey does not match the authenticated session"]
            )
            return
        rejection = validate_event(event, now=self._now())
        if rejection is not None:
            await self._send(["OK", event_id, False, f"{rejection.prefix}: {rejection.message}"])
            return
        try:
            result = await self._store.publish(event)
        except Exception as error:  # noqa: BLE001 — a store failure, not a bad event
            await self._send(["OK", event_id, False, f"error: {error}"])
            return
        if result is PublishResult.DUPLICATE:
            await self._send(["OK", event_id, False, "duplicate: already have this event"])
        elif result is PublishResult.SUPERSEDED:
            await self._send(
                [
                    "OK",
                    event_id,
                    False,
                    "duplicate: a newer version of this replaceable event already exists",
                ]
            )
        else:
            await self._send(["OK", event_id, True, ""])

    async def _handle_req(self, sub_id: str, raw_filters: list[dict[str, Any]]) -> None:
        if self._authed_pubkey is None:
            await self._send(["CLOSED", sub_id, "auth-required: this relay requires authentication"])
            return
        if not self._is_member:
            await self._send(["CLOSED", sub_id, "restricted: not a member of this workspace"])
            return
        if sub_id in self._sub_ids:
            # NIP-01: a new REQ with the same id replaces the old subscription.
            self._cancel_subscription(sub_id)

        filters = [parse_filter(raw) for raw in raw_filters]
        try:
            events = await self._store.query(filters)
        except Exception as error:  # noqa: BLE001 — a store failure, not a bad request
            await self._send(["CLOSED", sub_id, f"error: {error}"])
            return
        for event in events:
            await self._send(["EVENT", sub_id, event])
        await self._send(["EOSE", sub_id])

        queue = await self._fanout.subscribe(self._full_sub_id(sub_id), filters)
        self._sub_ids.add(sub_id)
        self._tasks[sub_id] = asyncio.create_task(self._forward_live_events(sub_id, queue))

    def _handle_close(self, sub_id: str) -> None:
        self._cancel_subscription(sub_id)

    async def _forward_live_events(
        self, sub_id: str, queue: "asyncio.Queue[NostrEvent]"
    ) -> None:
        while True:
            event = await queue.get()
            await self._send(["EVENT", sub_id, event])

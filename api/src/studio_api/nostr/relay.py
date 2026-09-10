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
from typing import Any, Protocol

from studio_api.nostr.auth_event import AuthRejection, verify_auth_event
from studio_api.nostr.model import Filter, NostrEvent, first_tag_value
from studio_api.nostr.store import EventStore, LiveFanout, PublishResult
from studio_api.nostr.validation import validate_event

SendFn = Callable[[list[Any]], Awaitable[None]]
CloseTransportFn = Callable[[], Awaitable[None]]

_SINGLE_LETTER_TAG_FILTER = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

# NIP-43/NIP-29 moderation and announcement kinds: only ever written by the
# repository's own projection (signed by the Workspace Key), never accepted
# from an ordinary client connection (ticket #3's authorization rules).
MODERATION_KINDS = frozenset({8000, 8001, 9000, 9001, 13534, 33534, 39000, 39001, 39002, 39003})

# Readable by any Workspace Member regardless of Channel membership.
WORKSPACE_WIDE_KINDS = frozenset({0, 10002, 10050, 10063, *MODERATION_KINDS})

# Ticket #5: a Thread Reply's root (its `E` tag) or a Reaction's target (its
# `e` tag) must be a real event already in that same Channel — the root/
# target tag naming each kind uses to point at it.
_ROOT_TAG_BY_KIND = {1111: "E", 7: "e"}


class RelayAuthorizer(Protocol):
    """Who may authenticate, and who may read/write a given Channel."""

    async def is_member(self, pubkey: str) -> bool: ...
    async def is_channel_member(self, channel_id: str, pubkey: str) -> bool: ...


class SeededRelayAuthorizer:
    """A fixed allowlist standing in for real Workspace/Channel membership —
    used by this module's own tests. `channel_members` lets a test express
    "workspace member but not a member of this particular channel"; when
    omitted every workspace member is treated as a member of every channel.
    """

    def __init__(
        self, allowed_pubkeys: set[str], *, channel_members: dict[str, set[str]] | None = None
    ) -> None:
        self._allowed = allowed_pubkeys
        self._channel_members = channel_members

    async def is_member(self, pubkey: str) -> bool:
        return pubkey in self._allowed

    async def is_channel_member(self, channel_id: str, pubkey: str) -> bool:
        if self._channel_members is None:
            return await self.is_member(pubkey)
        return pubkey in self._channel_members.get(channel_id, set())


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


class ConnectionRegistry:
    """Every currently-authenticated connection, by pubkey — so removing a
    Workspace Member can force-close their open sockets immediately."""

    def __init__(self) -> None:
        self._by_pubkey: dict[str, set[RelayConnection]] = {}

    def register(self, pubkey: str, connection: "RelayConnection") -> None:
        self._by_pubkey.setdefault(pubkey, set()).add(connection)

    def unregister(self, pubkey: str, connection: "RelayConnection") -> None:
        connections = self._by_pubkey.get(pubkey)
        if connections is None:
            return
        connections.discard(connection)
        if not connections:
            del self._by_pubkey[pubkey]

    async def force_disconnect(self, pubkey: str, *, reason: str) -> None:
        for connection in list(self._by_pubkey.get(pubkey, ())):
            await connection.force_close(reason)


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
        registry: ConnectionRegistry | None = None,
        close_transport: CloseTransportFn | None = None,
    ) -> None:
        self._store = store
        self._fanout = fanout
        self._authorizer = authorizer
        self._relay_url = relay_url
        self._send = send
        self._connection_id = connection_id or secrets.token_hex(8)
        self._now = now
        self._registry = registry
        self._close_transport = close_transport
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
        if self._registry is not None and self._authed_pubkey is not None:
            self._registry.unregister(self._authed_pubkey, self)

    async def force_close(self, reason: str) -> None:
        """Called by the ConnectionRegistry when this connection's pubkey is
        removed from the Workspace: end every subscription and the socket
        itself immediately."""
        for sub_id in self._sub_ids:
            await self._send(["CLOSED", sub_id, f"restricted: {reason}"])
        await self.close()
        if self._close_transport is not None:
            await self._close_transport()

    def _full_sub_id(self, sub_id: str) -> str:
        return f"{self._connection_id}:{sub_id}"

    def _cancel_subscription(self, sub_id: str) -> None:
        self._sub_ids.discard(sub_id)
        self._fanout.unsubscribe(self._full_sub_id(sub_id))
        task = self._tasks.pop(sub_id, None)
        if task is not None:
            task.cancel()

    async def _may_read(self, event: NostrEvent) -> bool:
        """Channel-scoped events are only for that Channel's Members;
        everything else (profiles, relay lists, the Workspace's own
        announcements) is readable by any Workspace Member — re-checked for
        every event, not just once at REQ time (ticket #3)."""
        if event["kind"] in WORKSPACE_WIDE_KINDS:
            return True
        channel_id = first_tag_value(event, "h")
        if channel_id is None:
            return True
        assert self._authed_pubkey is not None
        return await self._authorizer.is_channel_member(channel_id, self._authed_pubkey)

    async def _handle_auth(self, event: NostrEvent) -> None:
        result = verify_auth_event(
            event, relay_url=self._relay_url, expected_challenge=self.challenge, now=self._now()
        )
        if isinstance(result, AuthRejection):
            await self._send(["OK", event.get("id", ""), False, f"invalid: {result.message}"])
            return
        self._authed_pubkey = result
        self._is_member = await self._authorizer.is_member(result)
        if self._registry is not None:
            self._registry.register(result, self)
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
        if event.get("kind") in MODERATION_KINDS:
            await self._send(
                ["OK", event_id, False, "restricted: membership changes go through the REST API"]
            )
            return
        channel_id = first_tag_value(event, "h")
        if channel_id is not None and not await self._authorizer.is_channel_member(
            channel_id, self._authed_pubkey
        ):
            await self._send(["OK", event_id, False, "restricted: not a member of this channel"])
            return
        rejection = validate_event(event, now=self._now())
        if rejection is not None:
            await self._send(["OK", event_id, False, f"{rejection.prefix}: {rejection.message}"])
            return
        root_tag = _ROOT_TAG_BY_KIND.get(event.get("kind"))
        if root_tag is not None:
            root_id = first_tag_value(event, root_tag)
            root_events = await self._store.query([Filter(ids=[root_id])]) if root_id else []
            root = root_events[0] if root_events else None
            if root is None or first_tag_value(root, "h") != channel_id:
                await self._send(["OK", event_id, False, "invalid: root is not in this channel"])
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
            if await self._may_read(event):
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
            if await self._may_read(event):
                await self._send(["EVENT", sub_id, event])

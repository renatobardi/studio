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
from typing import Any, Protocol, cast

from pydantic import ValidationError

from studio_api.nostr.auth_event import AuthRejection, verify_auth_event
from studio_api.nostr.kinds import KindClass, kind_class
from studio_api.nostr.limits import MAX_FILTERS_PER_REQ, MAX_LIMIT, MAX_SUBSCRIPTIONS
from studio_api.nostr.model import Filter, NostrEvent, all_tag_values, first_tag_value
from studio_api.nostr.store import (
    Delivery,
    EventStore,
    LiveFanout,
    PublishResult,
    SubscriptionOverflow,
)
from studio_api.nostr.validation import (
    ROOT_TAG_BY_KIND,
    EventRejection,
    malformed_event_rejection,
    validate_event,
)

SendFn = Callable[[list[Any]], Awaitable[None]]
CloseTransportFn = Callable[[], Awaitable[None]]


class MediaReferenceRecorder(Protocol):
    """Ticket #6: records that a Channel references the blobs named by an
    accepted event's `imeta` tags. Implemented by MediaRepository."""

    async def record_references(self, event: NostrEvent, *, channel_id: str) -> None: ...

    async def record_dm_references(self, event: NostrEvent, *, recipients: list[str]) -> None: ...


_SINGLE_LETTER_TAG_FILTER = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

# The NIP-01 client messages this relay acts on. Every one of them carries a
# payload; anything else is ignored.
_CLIENT_MESSAGE_TYPES = frozenset({"EVENT", "REQ", "CLOSE", "AUTH"})

# NIP-43/NIP-29 moderation and announcement kinds: only ever written by the
# repository's own projection (signed by the Workspace Key), never accepted
# from an ordinary client connection (ticket #3's authorization rules).
MODERATION_KINDS = frozenset({8000, 8001, 9000, 9001, 13534, 33534, 39000, 39001, 39002, 39003})

# Readable by any Workspace Member regardless of Channel membership.
WORKSPACE_WIDE_KINDS = frozenset({0, 10002, 10050, 10063, *MODERATION_KINDS})

# NIP-59 gift wraps (ticket #7): unlike every other kind, readable *only* by
# the pubkey named in the event's own `p` tag — never by Channel/Workspace
# membership alone, and never omitted just because there's no `h` tag.
GIFT_WRAP_KINDS = frozenset({1059})

_REJECTION_BY_RESULT = {
    PublishResult.DUPLICATE: "duplicate: already have this event",
    PublishResult.SUPERSEDED: (
        "duplicate: a newer version of this replaceable event already exists"
    ),
}


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


def rejection_text(rejection: EventRejection) -> str:
    """A rejection as NIP-01 puts it on the wire: `<machine-readable>: <human>`."""
    return f"{rejection.prefix}: {rejection.message}"


class MalformedFilter(ValueError):
    """A REQ carried something that is not a NIP-01 filter (ticket #52)."""


def parse_filter(raw: Any) -> Filter:
    """A NIP-01 filter as received over the wire: `#e`/`#p`/... tag keys
    alongside the plain ones. Raises MalformedFilter when the client sent
    something a filter cannot be made of."""
    if not isinstance(raw, dict):
        raise MalformedFilter("a filter must be a JSON object")
    tags: dict[str, list[str]] = {}
    kwargs: dict[str, Any] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            raise MalformedFilter("a filter's keys must be strings")
        if len(key) == 2 and key[0] == "#" and key[1] in _SINGLE_LETTER_TAG_FILTER:
            tags[key[1]] = value
        elif key in ("ids", "authors", "kinds", "since", "until", "limit"):
            kwargs[key] = value
    try:
        flt = Filter(tags=tags, **kwargs)
    except ValidationError as error:
        raise MalformedFilter("a filter field has the wrong type") from error
    if flt.limit is None:
        # A filter that names no limit gets the relay's, rather than the whole
        # table: `max_limit` is a ceiling on what a REQ can cost, and a client
        # that omits the field is not asking for an exemption from it.
        return flt.model_copy(update={"limit": MAX_LIMIT})
    if flt.limit < 0:
        raise MalformedFilter("a filter's limit cannot be negative")
    # Clamped rather than refused: a client asking for more history than the
    # relay serves gets the relay's maximum, which is what NIP-11's `max_limit`
    # tells it to expect.
    return flt.model_copy(update={"limit": min(flt.limit, MAX_LIMIT)})


class ConnectionRegistry:
    """Every currently-authenticated connection, by Workspace and pubkey — so
    removing a Workspace Member can force-close their open sockets
    immediately.

    Keyed by Workspace as well as pubkey because one process serves many
    (ticket #45): the same Identity may hold connections to several, and
    losing one membership must not close the others.
    """

    def __init__(self) -> None:
        self._by_member: dict[tuple[str, str], set[RelayConnection]] = {}

    def register(self, pubkey: str, connection: "RelayConnection") -> None:
        self._by_member.setdefault((connection.workspace_slug, pubkey), set()).add(connection)

    def unregister(self, pubkey: str, connection: "RelayConnection") -> None:
        key = (connection.workspace_slug, pubkey)
        connections = self._by_member.get(key)
        if connections is None:
            return
        connections.discard(connection)
        if not connections:
            del self._by_member[key]

    async def force_disconnect(self, pubkey: str, *, workspace_slug: str, reason: str) -> None:
        for connection in list(self._by_member.get((workspace_slug, pubkey), ())):
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
        media_repo: MediaReferenceRecorder | None = None,
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
        self._media_repo = media_repo
        self.challenge = secrets.token_hex(16)
        self._authed_pubkey: str | None = None
        self._is_member = False
        self._sub_ids: set[str] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}

    @property
    def workspace_slug(self) -> str:
        return self._store.workspace_slug

    async def start(self) -> None:
        await self._send(["AUTH", self.challenge])

    async def handle_message(self, message: Any) -> None:
        """Anything a client can put on the wire, NIP-01 or not. Every
        rejection is a relay message rather than an exception: one malformed
        frame may not take down the connection that sent it — let alone the
        task serving it, whose failure would leave the socket to be cleaned up
        by the transport's error path (ticket #52)."""
        if not isinstance(message, list) or not message:
            await self.notice("a client message must be a non-empty JSON array")
            return
        message_type, payload = message[0], message[1:]
        if message_type not in _CLIENT_MESSAGE_TYPES:
            # Unrecognised message types are silently ignored: NIP-01 defines
            # no client-facing error for them.
            return
        if not payload:
            await self.notice(f"a {message_type} message carries no payload")
            return
        if message_type == "EVENT":
            await self._handle_event(payload[0])
            return
        if message_type == "AUTH":
            await self._handle_auth(payload[0])
            return
        sub_id = payload[0]  # REQ and CLOSE both name a subscription
        if not isinstance(sub_id, str):
            await self.notice(f"a {message_type} subscription id must be a string")
        elif message_type == "REQ":
            await self._handle_req(sub_id, payload[1:])
        else:
            self._handle_close(sub_id)

    async def notice(self, message: str) -> None:
        """A NIP-01 NOTICE about something the client got wrong. Public
        because the WebSocket adapter refuses some frames before they ever
        reach this state machine, and those refusals read the same."""
        await self._send(["NOTICE", f"invalid: {message}"])

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

    def _detach_subscription(self, sub_id: str) -> None:
        """Forgets the subscription without touching its forwarding task —
        what that task itself calls when it is the one ending things, since
        cancelling the task you are running loses the rest of the coroutine."""
        self._sub_ids.discard(sub_id)
        self._fanout.unsubscribe(self._full_sub_id(sub_id))
        self._tasks.pop(sub_id, None)

    def _cancel_subscription(self, sub_id: str) -> None:
        task = self._tasks.get(sub_id)
        self._detach_subscription(sub_id)
        if task is not None:
            task.cancel()

    async def _may_read(self, event: NostrEvent) -> bool:
        """Channel-scoped events are only for that Channel's Members;
        everything else (profiles, relay lists, the Workspace's own
        announcements) is readable by any Workspace Member — re-checked for
        every event, not just once at REQ time (ticket #3)."""
        if event["kind"] in GIFT_WRAP_KINDS:
            return first_tag_value(event, "p") == self._authed_pubkey
        if event["kind"] in WORKSPACE_WIDE_KINDS:
            return True
        channel_id = first_tag_value(event, "h")
        if channel_id is None:
            return True
        assert self._authed_pubkey is not None
        return await self._authorizer.is_channel_member(channel_id, self._authed_pubkey)

    async def _handle_auth(self, payload: Any) -> None:
        malformed = malformed_event_rejection(payload)
        if malformed is not None:
            await self._send(["OK", "", False, rejection_text(malformed)])
            return
        event = cast(NostrEvent, payload)
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

    async def _handle_event(self, payload: Any) -> None:
        raw_id = payload.get("id") if isinstance(payload, dict) else None
        event_id = raw_id if isinstance(raw_id, str) else ""
        if self._authed_pubkey is None:
            await self._send(
                ["OK", event_id, False, "auth-required: publishing requires authentication"]
            )
            return
        if not self._is_member:
            await self._send(["OK", event_id, False, "restricted: not a member of this workspace"])
            return
        malformed = malformed_event_rejection(payload)
        if malformed is not None:
            await self._send(["OK", event_id, False, rejection_text(malformed)])
            return
        event = cast(NostrEvent, payload)
        # A gift wrap's pubkey is a one-time throwaway key (NIP-59) — never the sender's real
        # Identity, by design, so it can't be checked against the authenticated session.
        if event.get("kind") not in GIFT_WRAP_KINDS and event.get("pubkey") != self._authed_pubkey:
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
            await self._send(["OK", event_id, False, rejection_text(rejection)])
            return
        if not await self._root_in_channel(event, channel_id):
            await self._send(["OK", event_id, False, "invalid: root is not in this channel"])
            return
        try:
            result = await self._store.publish(event)
        except Exception as error:  # noqa: BLE001 — a store failure, not a bad event
            await self._send(["OK", event_id, False, f"error: {error}"])
            return
        if result is not PublishResult.OK:
            await self._send(["OK", event_id, False, _REJECTION_BY_RESULT[result]])
            return
        await self._on_accepted(event, channel_id)
        await self._send(["OK", event_id, True, ""])

    async def _on_accepted(self, event: NostrEvent, channel_id: str | None) -> None:
        await self._record_media_references(event, channel_id)
        if kind_class(event["kind"]) is KindClass.EPHEMERAL:
            # Never stored, so the live query will never report it: the relay
            # hands it to the fan-out itself (ticket #43).
            self._fanout.deliver(event, workspace_slug=self._store.workspace_slug)

    async def _record_media_references(self, event: NostrEvent, channel_id: str | None) -> None:
        """Ticket #6/#7: after an event is accepted, record which blobs it references — by
        Channel for ordinary content, or by DM recipient for a gift wrap (a gift wrap has no
        `h` tag, so the two cases are mutually exclusive)."""
        if self._media_repo is None:
            return
        if channel_id is not None:
            await self._media_repo.record_references(event, channel_id=channel_id)
        elif event["kind"] in GIFT_WRAP_KINDS:
            assert self._authed_pubkey is not None
            recipients = all_tag_values(event, "p") + [self._authed_pubkey]
            await self._media_repo.record_dm_references(event, recipients=recipients)

    async def _root_in_channel(self, event: NostrEvent, channel_id: str | None) -> bool:
        """Ticket #5: a Thread Reply's root (its `E` tag) or a Reaction's target (its `e` tag)
        must already exist, and be in this same Channel. Kinds with no root tag pass trivially."""
        root_tag = ROOT_TAG_BY_KIND.get(event.get("kind"))
        if root_tag is None:
            return True
        root_id = first_tag_value(event, root_tag)
        root_events = await self._store.query([Filter(ids=[root_id])]) if root_id else []
        root = root_events[0] if root_events else None
        return root is not None and first_tag_value(root, "h") == channel_id

    async def _handle_req(self, sub_id: str, raw_filters: list[Any]) -> None:
        if self._authed_pubkey is None:
            await self._send(["CLOSED", sub_id, "auth-required: this relay requires authentication"])
            return
        if not self._is_member:
            await self._send(["CLOSED", sub_id, "restricted: not a member of this workspace"])
            return
        if len(raw_filters) > MAX_FILTERS_PER_REQ:
            await self._send(
                ["CLOSED", sub_id, f"invalid: more than {MAX_FILTERS_PER_REQ} filters"]
            )
            return
        try:
            filters = [parse_filter(raw) for raw in raw_filters]
        except MalformedFilter as error:
            await self._send(["CLOSED", sub_id, f"invalid: {error}"])
            return
        if sub_id in self._sub_ids:
            # NIP-01: a new REQ with the same id replaces the old subscription.
            self._cancel_subscription(sub_id)
        elif len(self._sub_ids) >= MAX_SUBSCRIPTIONS:
            reason = f"rate-limited: no more than {MAX_SUBSCRIPTIONS} subscriptions per connection"
            await self._send(["CLOSED", sub_id, reason])
            return
        # Subscribe *before* reading the snapshot: anything published while the
        # historical query runs lands in this queue instead of falling into the
        # gap between the two (ticket #43). It is drained after EOSE, minus
        # whatever the snapshot already carried.
        queue = await self._fanout.subscribe(
            self._full_sub_id(sub_id), filters, workspace_slug=self._store.workspace_slug
        )
        # Live from here on, so the subscription counts as open even while the
        # snapshot is still being sent: whatever ends it — CLOSE, a failure, the
        # connection closing — releases its queue and task through the usual path.
        self._sub_ids.add(sub_id)
        try:
            events = await self._store.query(filters)
        except Exception as error:  # noqa: BLE001 — a store failure, not a bad request
            self._cancel_subscription(sub_id)
            await self._send(["CLOSED", sub_id, f"error: {error}"])
            return
        snapshot_ids: set[str] = set()
        for event in events:
            if await self._may_read(event):
                snapshot_ids.add(event["id"])
                await self._send(["EVENT", sub_id, event])
        await self._send(["EOSE", sub_id])

        if sub_id not in self._sub_ids:
            return  # closed while the snapshot was in flight
        self._tasks[sub_id] = asyncio.create_task(
            self._forward_live_events(sub_id, queue, snapshot_ids)
        )

    def _handle_close(self, sub_id: str) -> None:
        self._cancel_subscription(sub_id)

    async def _forward_live_events(
        self, sub_id: str, queue: "asyncio.Queue[Delivery]", snapshot_ids: set[str]
    ) -> None:
        """Drains the live queue, skipping whatever the snapshot already sent.
        Those ids are kept for the subscription's life, not just for the
        buffered backlog: the live query can report an event stored during the
        snapshot well after the backlog is drained, and that late copy is a
        duplicate just the same."""
        while True:
            delivery = await queue.get()
            if isinstance(delivery, SubscriptionOverflow):
                # The fan-out gave up on this subscription: this client was not
                # reading fast enough to be sent the rest (ticket #52).
                self._detach_subscription(sub_id)
                await self._send(
                    ["CLOSED", sub_id, "error: this subscription fell too far behind"]
                )
                return
            if delivery["id"] not in snapshot_ids:
                await self._deliver(sub_id, delivery)

    async def _deliver(self, sub_id: str, event: NostrEvent) -> None:
        if await self._may_read(event):
            await self._send(["EVENT", sub_id, event])

"""RED: the relay connection state machine — NIP-01 EVENT/REQ/CLOSE and
NIP-42 AUTH, against a real EventStore and the shared live fan-out
(ADR-0004). No real WebSocket involved; `send` is a plain recorder.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from coincurve import PrivateKey
from support import Recorder, make_auth_event, new_keypair, sign_event, wait_until

from studio_api.nostr.model import Filter, NostrEvent
from studio_api.nostr.relay import (
    ConnectionRegistry,
    MediaReferenceRecorder,
    RelayConnection,
    SeededRelayAuthorizer,
)
from studio_api.nostr.store import EventStore, LiveFanout

RELAY_URL = "wss://relay.example.com/relay/family"


def make_connection(
    store: EventStore,
    fanout: LiveFanout,
    *,
    allowed_pubkeys: tuple[str, ...] = (),
    channel_members: dict[str, set[str]] | None = None,
    now: Callable[[], int] | None = None,
    connection_id: str | None = None,
    registry: ConnectionRegistry | None = None,
    media_repo: MediaReferenceRecorder | None = None,
) -> tuple[RelayConnection, Recorder]:
    authorizer = SeededRelayAuthorizer(set(allowed_pubkeys), channel_members=channel_members)
    recorder = Recorder()
    connection = RelayConnection(
        store=store,
        fanout=fanout,
        authorizer=authorizer,
        relay_url=RELAY_URL,
        send=recorder,
        now=now or (lambda: int(time.time())),
        connection_id=connection_id,
        registry=registry,
        media_repo=media_repo,
    )
    return connection, recorder


async def authenticate(
    connection: RelayConnection, recorder: Recorder, sk: PrivateKey, pubkey: str, *, now: int
) -> list[object]:
    await connection.start()
    challenge = connection.challenge
    auth_event = make_auth_event(sk, pubkey, relay_url=RELAY_URL, challenge=challenge, created_at=now)
    await connection.handle_message(["AUTH", auth_event])
    return recorder.of_type("OK")[-1]


def _resolve_filter(raw: dict[str, Any], recipient_pubkey: str) -> dict[str, Any]:
    """Fills a parametrised filter's `"recipient"` placeholder in — the pubkey only exists
    once the test has generated it."""
    return {k: [recipient_pubkey] if v == "recipient" else v for k, v in raw.items()}


class TestAuthHandshake:
    async def test_start_sends_an_auth_challenge(self, store: EventStore, fanout: LiveFanout) -> None:
        connection, recorder = make_connection(store, fanout)

        await connection.start()

        assert recorder.sent == [["AUTH", connection.challenge]]

    async def test_a_valid_member_auth_event_is_accepted(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)

        ok = await authenticate(connection, recorder, sk, pubkey, now=now)

        assert ok[2] is True

    async def test_a_bad_auth_event_is_rejected(self, store: EventStore, fanout: LiveFanout) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, now=lambda: now)
        await connection.start()
        bad_auth = sign_event(sk, pubkey=pubkey, created_at=now, kind=22242, tags=[])

        await connection.handle_message(["AUTH", bad_auth])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")


class TestEventBeforeAuth:
    async def test_publishing_before_auth_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        connection, recorder = make_connection(store, fanout)
        event: NostrEvent = {
            "id": "x", "pubkey": "y", "created_at": 1, "kind": 1, "tags": [], "content": "", "sig": "z",
        }

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("auth-required:")


class TestReqBeforeAuth:
    async def test_subscribing_before_auth_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        connection, recorder = make_connection(store, fanout)

        await connection.handle_message(["REQ", "sub1", {}])

        closed = recorder.of_type("CLOSED")[-1]
        assert closed[0] == "CLOSED"
        assert closed[1] == "sub1"
        assert str(closed[2]).startswith("auth-required:")


class TestNonMemberRestriction:
    async def test_a_non_member_authenticates_but_is_restricted(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(), now=lambda: now)

        ok = await authenticate(connection, recorder, sk, pubkey, now=now)
        assert ok[2] is True  # the AUTH handshake itself succeeded

        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")
        await connection.handle_message(["EVENT", event])
        event_ok = recorder.of_type("OK")[-1]
        assert event_ok[2] is False
        assert str(event_ok[3]).startswith("restricted:")

        await connection.handle_message(["REQ", "sub1", {}])
        closed = recorder.of_type("CLOSED")[-1]
        assert str(closed[2]).startswith("restricted:")


class TestPublishing:
    async def test_a_valid_event_is_published_and_acknowledged(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok == ["OK", event["id"], True, ""]

    async def test_an_invalid_event_is_rejected(self, store: EventStore, fanout: LiveFanout) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")
        tampered: NostrEvent = {**event, "content": "tampered"}

        await connection.handle_message(["EVENT", tampered])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")

    async def test_publishing_someone_elses_event_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk1, pubkey1 = new_keypair()
        _sk2, pubkey2 = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey1,), now=lambda: now
        )
        await authenticate(connection, recorder, sk1, pubkey1, now=now)
        someone_elses_event = sign_event(_sk2, pubkey=pubkey2, created_at=now, kind=1, content="hi")

        await connection.handle_message(["EVENT", someone_elses_event])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")

    async def test_duplicate_publish_is_rejected(self, store: EventStore, fanout: LiveFanout) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")
        await connection.handle_message(["EVENT", event])

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("duplicate:")


class _FakeMediaRepo:
    def __init__(self) -> None:
        self.recorded: list[tuple[str, str]] = []
        self.dm_recorded: list[tuple[str, tuple[str, ...]]] = []

    async def record_references(self, event: NostrEvent, *, channel_id: str) -> None:
        self.recorded.append((event["id"], channel_id))

    async def record_dm_references(self, event: NostrEvent, *, recipients: list[str]) -> None:
        self.dm_recorded.append((event["id"], tuple(recipients)))


class TestMediaReferenceRecording:
    async def test_accepting_an_event_with_imeta_records_the_reference(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        media_repo = _FakeMediaRepo()
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, media_repo=media_repo
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=9,
            tags=[["h", "chan1"], ["imeta", f"x {'a' * 64}"]],
        )

        await connection.handle_message(["EVENT", event])

        assert media_repo.recorded == [(event["id"], "chan1")]

    async def test_a_rejected_event_records_no_reference(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        media_repo = _FakeMediaRepo()
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, media_repo=media_repo
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        tampered: NostrEvent = {**event, "content": "tampered"}

        await connection.handle_message(["EVENT", tampered])

        assert media_repo.recorded == []


class _BrokenPublishStore:
    """A store whose `publish` fails for reasons that have nothing to do
    with the event's own validity — a database outage, not a bad event."""

    async def publish(self, event: NostrEvent) -> None:
        raise RuntimeError("the database is on fire")


class _BrokenQueryStore:
    workspace_slug = "test-ws"

    async def query(self, filters: list[object]) -> list[object]:
        raise RuntimeError("the database is on fire")


class TestUnexpectedFailures:
    async def test_an_unexpected_publish_failure_yields_the_error_prefix(
        self, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            _BrokenPublishStore(), fanout, allowed_pubkeys=(pubkey,), now=lambda: now  # type: ignore[arg-type]
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("error:")

    async def test_an_unexpected_query_failure_closes_the_subscription_with_error_prefix(
        self, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            _BrokenQueryStore(), fanout, allowed_pubkeys=(pubkey,), now=lambda: now  # type: ignore[arg-type]
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)

        await connection.handle_message(["REQ", "sub1", {"kinds": [1]}])

        closed = recorder.of_type("CLOSED")[-1]
        assert closed[1] == "sub1"
        assert str(closed[2]).startswith("error:")


class TestSubscribing:
    async def test_req_returns_stored_events_then_eose(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")
        await connection.handle_message(["EVENT", event])

        await connection.handle_message(["REQ", "sub1", {"kinds": [1]}])

        events = recorder.of_type("EVENT")
        assert [m[2]["id"] for m in events] == [event["id"]]
        eose = recorder.of_type("EOSE")
        assert eose == [["EOSE", "sub1"]]
        # EOSE must come after the historical events, not before
        assert recorder.sent.index(eose[0]) > recorder.sent.index(events[-1])

    async def test_limit_zero_yields_no_historical_events(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hi")
        await connection.handle_message(["EVENT", event])

        await connection.handle_message(["REQ", "sub1", {"kinds": [1], "limit": 0}])

        assert recorder.of_type("EVENT") == []
        assert recorder.of_type("EOSE") == [["EOSE", "sub1"]]

    async def test_a_live_published_event_is_delivered_to_a_matching_subscription(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        subscriber, sub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="subscriber"
        )
        await authenticate(subscriber, sub_recorder, sk, pubkey, now=now)
        await subscriber.handle_message(["REQ", "sub1", {"kinds": [1]}])
        assert sub_recorder.of_type("EVENT") == []  # nothing stored yet

        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="publisher"
        )
        await authenticate(publisher, pub_recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="live!")
        await publisher.handle_message(["EVENT", event])

        await wait_until(lambda: len(sub_recorder.of_type("EVENT")) == 1)
        delivered = sub_recorder.of_type("EVENT")[0]
        assert delivered == ["EVENT", "sub1", event]

        await subscriber.close()
        await publisher.close()

    async def test_close_stops_further_live_delivery(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        subscriber, sub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="subscriber2"
        )
        await authenticate(subscriber, sub_recorder, sk, pubkey, now=now)
        await subscriber.handle_message(["REQ", "sub1", {"kinds": [1]}])
        await subscriber.handle_message(["CLOSE", "sub1"])

        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="publisher2"
        )
        await authenticate(publisher, pub_recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="after close")
        await publisher.handle_message(["EVENT", event])

        await asyncio.sleep(0.2)
        assert sub_recorder.of_type("EVENT") == []

        await subscriber.close()
        await publisher.close()


class TestChannelAuthorization:
    async def test_a_workspace_member_who_is_not_a_channel_member_cannot_publish_to_it(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), channel_members={}, now=lambda: now
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("restricted:")

    async def test_a_channel_member_can_publish_to_it(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok == ["OK", event["id"], True, ""]

    async def test_req_only_returns_channel_events_for_channels_the_caller_belongs_to(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        member_of_chan1, member_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}, "chan2": set()},
            now=lambda: now, connection_id="member1",
        )
        await authenticate(member_of_chan1, member_recorder, sk, pubkey, now=now)
        event1 = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await member_of_chan1.handle_message(["EVENT", event1])

        admin_of_both, admin_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}, "chan2": {pubkey}},
            now=lambda: now, connection_id="admin1",
        )
        await authenticate(admin_of_both, admin_recorder, sk, pubkey, now=now)
        event2 = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan2"]])
        await admin_of_both.handle_message(["EVENT", event2])

        await member_of_chan1.handle_message(["REQ", "sub1", {"kinds": [9]}])

        received_ids = {e[2]["id"] for e in member_recorder.of_type("EVENT")}
        assert received_ids == {event1["id"]}

    async def test_live_channel_events_are_only_delivered_to_that_channels_members(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        member_of_chan1, member_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}, "chan2": set()},
            now=lambda: now, connection_id="member1live",
        )
        await authenticate(member_of_chan1, member_recorder, sk, pubkey, now=now)
        await member_of_chan1.handle_message(["REQ", "sub1", {"kinds": [9]}])

        admin_of_both, admin_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}, "chan2": {pubkey}},
            now=lambda: now, connection_id="admin1live",
        )
        await authenticate(admin_of_both, admin_recorder, sk, pubkey, now=now)
        blocked_event = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan2"]])
        await admin_of_both.handle_message(["EVENT", blocked_event])
        allowed_event = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await admin_of_both.handle_message(["EVENT", allowed_event])

        await wait_until(lambda: len(member_recorder.of_type("EVENT")) == 1)
        await asyncio.sleep(0.1)  # give the (correctly rejected) other event a chance to arrive too
        received_ids = {e[2]["id"] for e in member_recorder.of_type("EVENT")}
        assert received_ids == {allowed_event["id"]}

        await member_of_chan1.close()
        await admin_of_both.close()

    async def test_workspace_wide_kinds_are_readable_without_channel_membership(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="pub-profile"
        )
        await authenticate(publisher, pub_recorder, sk, pubkey, now=now)
        profile = sign_event(sk, pubkey=pubkey, created_at=now, kind=0, content="{}")
        await publisher.handle_message(["EVENT", profile])

        reader, reader_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), channel_members={},
            now=lambda: now, connection_id="reader-profile",
        )
        await authenticate(reader, reader_recorder, sk, pubkey, now=now)
        await reader.handle_message(["REQ", "sub1", {"kinds": [0]}])

        received_ids = {e[2]["id"] for e in reader_recorder.of_type("EVENT")}
        assert received_ids == {profile["id"]}

    async def test_moderation_kinds_are_always_rejected_from_a_client(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=8000, tags=[["-"], ["p", pubkey]])

        await connection.handle_message(["EVENT", event])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("restricted:")


class TestThreadReplyAndReactionRootChannel:
    async def test_a_thread_reply_whose_root_is_in_a_different_channel_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}, "chan2": {pubkey}}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        root = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await connection.handle_message(["EVENT", root])
        reply = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=1111,
            tags=[
                ["h", "chan2"],
                ["E", root["id"]], ["K", "9"], ["P", pubkey],
                ["e", root["id"]], ["k", "9"], ["p", pubkey],
            ],
        )

        await connection.handle_message(["EVENT", reply])

        ok = recorder.of_type("OK")[-1]
        assert ok[0:2] == ["OK", reply["id"]]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")

    async def test_a_thread_reply_whose_root_is_in_the_same_channel_is_accepted(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), channel_members={"chan1": {pubkey}}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        root = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await connection.handle_message(["EVENT", root])
        reply = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=1111,
            tags=[
                ["h", "chan1"],
                ["E", root["id"]], ["K", "9"], ["P", pubkey],
                ["e", root["id"]], ["k", "9"], ["p", pubkey],
            ],
        )

        await connection.handle_message(["EVENT", reply])

        ok = recorder.of_type("OK")[-1]
        assert ok == ["OK", reply["id"], True, ""]

    async def test_a_thread_reply_whose_root_doesnt_exist_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), channel_members={"chan1": {pubkey}}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        reply = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=1111,
            tags=[
                ["h", "chan1"],
                ["E", "no-such-event"], ["K", "9"], ["P", pubkey],
                ["e", "no-such-event"], ["k", "9"], ["p", pubkey],
            ],
        )

        await connection.handle_message(["EVENT", reply])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")

    async def test_a_reaction_whose_target_is_in_a_different_channel_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}, "chan2": {pubkey}}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        target = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await connection.handle_message(["EVENT", target])
        reaction = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=7, content="+",
            tags=[["h", "chan2"], ["e", target["id"]], ["k", "9"], ["p", pubkey]],
        )

        await connection.handle_message(["EVENT", reaction])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")

    async def test_a_reaction_whose_target_is_in_the_same_channel_is_accepted(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), channel_members={"chan1": {pubkey}}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        target = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await connection.handle_message(["EVENT", target])
        reaction = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=7, content="+",
            tags=[["h", "chan1"], ["e", target["id"]], ["k", "9"], ["p", pubkey]],
        )

        await connection.handle_message(["EVENT", reaction])

        ok = recorder.of_type("OK")[-1]
        assert ok == ["OK", reaction["id"], True, ""]


class TestGiftWrapAuthorization:
    """Ticket #7: a kind 1059 gift wrap is readable only by the pubkey in
    its own `p` tag — regardless of what any subscription filters for,
    never by generic Workspace membership like other kindless-`h` events."""

    async def test_the_recipient_can_read_a_gift_wrap_addressed_to_them(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        wrap = sign_event(sk, pubkey=pubkey, created_at=now, kind=1059, tags=[["p", pubkey]])
        await connection.handle_message(["EVENT", wrap])

        await connection.handle_message(["REQ", "sub1", {"kinds": [1059]}])

        received_ids = {e[2]["id"] for e in recorder.of_type("EVENT")}
        assert received_ids == {wrap["id"]}

    @pytest.mark.parametrize(
        ("label", "eavesdropper_filter"),
        [
            # No `#p` filter at all — the leak this ticket closes — and its pointed version,
            # naming the recipient outright: what a gift wrap may be read by is its own `p`
            # tag, never what the subscription asks for.
            ("broad", {"kinds": [1059]}),
            ("targeted", {"kinds": [1059], "#p": "recipient"}),
        ],
    )
    async def test_a_third_party_never_receives_someone_elses_gift_wrap_from_history(
        self, store: EventStore, fanout: LiveFanout, label: str, eavesdropper_filter: dict[str, Any]
    ) -> None:
        sender_sk, sender_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        eavesdropper_sk, eavesdropper_pubkey = new_keypair()
        now = int(time.time())
        members = (sender_pubkey, eavesdropper_pubkey)
        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=members, now=lambda: now,
            connection_id=f"publisher-gw-{label}",
        )
        await authenticate(publisher, pub_recorder, sender_sk, sender_pubkey, now=now)
        wrap = sign_event(
            sender_sk, pubkey=sender_pubkey, created_at=now, kind=1059, tags=[["p", recipient_pubkey]]
        )
        await publisher.handle_message(["EVENT", wrap])

        eavesdropper, eve_recorder = make_connection(
            store, fanout, allowed_pubkeys=members, now=lambda: now,
            connection_id=f"eavesdropper-gw-{label}",
        )
        await authenticate(eavesdropper, eve_recorder, eavesdropper_sk, eavesdropper_pubkey, now=now)

        await eavesdropper.handle_message(
            ["REQ", "sub1", _resolve_filter(eavesdropper_filter, recipient_pubkey)]
        )

        assert eve_recorder.of_type("EVENT") == []

    @pytest.mark.parametrize(
        ("label", "eavesdropper_filter"),
        [("broad", {"kinds": [1059]}), ("targeted", {"kinds": [1059], "#p": "recipient"})],
    )
    async def test_live_gift_wrap_delivery_is_restricted_to_the_recipient(
        self, store: EventStore, fanout: LiveFanout, label: str, eavesdropper_filter: dict[str, Any]
    ) -> None:
        sender_sk, sender_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        eavesdropper_sk, eavesdropper_pubkey = new_keypair()
        now = int(time.time())
        members = (sender_pubkey, eavesdropper_pubkey)
        eavesdropper, eve_recorder = make_connection(
            store, fanout, allowed_pubkeys=members, now=lambda: now,
            connection_id=f"eavesdropper-gw-live-{label}",
        )
        await authenticate(eavesdropper, eve_recorder, eavesdropper_sk, eavesdropper_pubkey, now=now)
        await eavesdropper.handle_message(
            ["REQ", "sub1", _resolve_filter(eavesdropper_filter, recipient_pubkey)]
        )

        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=members, now=lambda: now,
            connection_id=f"publisher-gw-live-{label}",
        )
        await authenticate(publisher, pub_recorder, sender_sk, sender_pubkey, now=now)
        wrap = sign_event(
            sender_sk, pubkey=sender_pubkey, created_at=now, kind=1059, tags=[["p", recipient_pubkey]]
        )
        await publisher.handle_message(["EVENT", wrap])

        await asyncio.sleep(0.2)
        assert eve_recorder.of_type("EVENT") == []

        await eavesdropper.close()
        await publisher.close()

    async def test_the_sender_reads_their_own_self_addressed_copy_and_not_the_recipients(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        """NIP-17 publishes a wrap per participant *plus* one the sender addresses to itself —
        the sender's only record of what it sent, since it cannot decrypt the recipient's copy
        and the relay keeps no plaintext."""
        sender_sk, sender_pubkey = new_keypair()
        for_recipient_sk, for_recipient_pubkey = new_keypair()
        for_self_sk, for_self_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(sender_pubkey,), now=lambda: now
        )
        await authenticate(connection, recorder, sender_sk, sender_pubkey, now=now)
        to_recipient = sign_event(
            for_recipient_sk, pubkey=for_recipient_pubkey, created_at=now, kind=1059,
            tags=[["p", recipient_pubkey]],
        )
        to_self = sign_event(
            for_self_sk, pubkey=for_self_pubkey, created_at=now, kind=1059,
            tags=[["p", sender_pubkey]],
        )
        await connection.handle_message(["EVENT", to_recipient])
        await connection.handle_message(["EVENT", to_self])

        await connection.handle_message(["REQ", "sub1", {"kinds": [1059]}])

        received_ids = {e[2]["id"] for e in recorder.of_type("EVENT")}
        assert received_ids == {to_self["id"]}

    async def test_any_workspace_member_may_publish_a_gift_wrap(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), channel_members={}, now=lambda: now,
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        wrap = sign_event(sk, pubkey=pubkey, created_at=now, kind=1059, tags=[["p", recipient_pubkey]])

        await connection.handle_message(["EVENT", wrap])

        ok = recorder.of_type("OK")[-1]
        assert ok == ["OK", wrap["id"], True, ""]

    async def test_a_gift_wrap_signed_by_a_throwaway_ephemeral_key_is_accepted(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        """NIP-59: a gift wrap's `pubkey` is a one-time ephemeral key, never the sender's real
        Identity — the whole point is that the relay (and any onlooker) never learns who sent
        it. This is what every real client actually publishes (see web/src/lib/nip17.ts's
        wrapSeal); the sibling test above uses the authenticated key itself only for brevity,
        which happened to mask this exact check rejecting real traffic."""
        sender_sk, sender_pubkey = new_keypair()
        _ephemeral_sk, ephemeral_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(sender_pubkey,), channel_members={}, now=lambda: now,
        )
        await authenticate(connection, recorder, sender_sk, sender_pubkey, now=now)
        wrap = sign_event(
            _ephemeral_sk, pubkey=ephemeral_pubkey, created_at=now, kind=1059, tags=[["p", recipient_pubkey]]
        )

        await connection.handle_message(["EVENT", wrap])

        ok = recorder.of_type("OK")[-1]
        assert ok == ["OK", wrap["id"], True, ""]

    async def test_a_gift_wrap_without_a_p_tag_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now)
        await authenticate(connection, recorder, sk, pubkey, now=now)
        wrap = sign_event(sk, pubkey=pubkey, created_at=now, kind=1059, tags=[])

        await connection.handle_message(["EVENT", wrap])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")

    async def test_publishing_a_gift_wrap_before_auth_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        """The ephemeral-key exemption is about *authorship*, not about authentication: a wrap
        still only travels on a connection that proved who it belongs to."""
        ephemeral_sk, ephemeral_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, now=lambda: now)
        await connection.start()
        wrap = sign_event(
            ephemeral_sk, pubkey=ephemeral_pubkey, created_at=now, kind=1059,
            tags=[["p", recipient_pubkey]],
        )

        await connection.handle_message(["EVENT", wrap])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("auth-required:")

    async def test_a_non_member_cannot_publish_a_gift_wrap(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sender_sk, sender_pubkey = new_keypair()
        ephemeral_sk, ephemeral_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(store, fanout, allowed_pubkeys=(), now=lambda: now)
        await authenticate(connection, recorder, sender_sk, sender_pubkey, now=now)
        wrap = sign_event(
            ephemeral_sk, pubkey=ephemeral_pubkey, created_at=now, kind=1059,
            tags=[["p", recipient_pubkey]],
        )

        await connection.handle_message(["EVENT", wrap])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("restricted:")

    async def test_a_gift_wrap_whose_signature_does_not_match_its_pubkey_is_rejected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        """Exempting gift wraps from the pubkey match must not exempt them from proving the
        envelope is intact — checked on the ciphertext alone, never on the plaintext."""
        sender_sk, sender_pubkey = new_keypair()
        _ephemeral_sk, ephemeral_pubkey = new_keypair()
        impostor_sk, _impostor_pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(sender_pubkey,), now=lambda: now
        )
        await authenticate(connection, recorder, sender_sk, sender_pubkey, now=now)
        # Claims the ephemeral key's pubkey, but is signed by another key entirely.
        wrap = sign_event(
            impostor_sk, pubkey=ephemeral_pubkey, created_at=now, kind=1059,
            tags=[["p", recipient_pubkey]], content="opaque-ciphertext",
        )

        await connection.handle_message(["EVENT", wrap])

        ok = recorder.of_type("OK")[-1]
        assert ok[2] is False
        assert str(ok[3]).startswith("invalid:")


class TestDmMediaReferenceRecording:
    async def test_accepting_a_gift_wrap_with_x_tags_records_dm_references_for_sender_and_recipients(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        _recipient_sk, recipient_pubkey = new_keypair()
        now = int(time.time())
        media_repo = _FakeMediaRepo()
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, media_repo=media_repo
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        wrap = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=1059,
            tags=[["p", recipient_pubkey], ["x", "a" * 64]],
        )

        await connection.handle_message(["EVENT", wrap])

        assert media_repo.dm_recorded == [(wrap["id"], (recipient_pubkey, pubkey))]

    async def test_a_rejected_gift_wrap_records_no_dm_reference(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        media_repo = _FakeMediaRepo()
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, media_repo=media_repo
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        wrap = sign_event(sk, pubkey=pubkey, created_at=now, kind=1059, tags=[])

        await connection.handle_message(["EVENT", wrap])

        assert media_repo.dm_recorded == []


class TestForceDisconnect:
    async def test_removing_a_member_closes_their_connection_and_subscriptions(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        registry = ConnectionRegistry()
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, registry=registry
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        await connection.handle_message(["REQ", "sub1", {"kinds": [1]}])

        await registry.force_disconnect(
            pubkey, workspace_slug=store.workspace_slug, reason="removed from workspace"
        )

        closed = recorder.of_type("CLOSED")[-1]
        assert closed[1] == "sub1"
        assert str(closed[2]).startswith("restricted:")

    async def test_force_disconnect_of_an_unregistered_pubkey_is_a_no_op(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        registry = ConnectionRegistry()
        await registry.force_disconnect(
            "never-connected", workspace_slug="family", reason="whatever"
        )  # no error

    async def test_removal_from_one_workspace_leaves_the_others_connected(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        """Ticket #45: one process serves many Workspaces, and the same
        Identity may hold a connection to several. Being removed from one
        must not close the sockets it holds on the others."""
        sk, pubkey = new_keypair()
        now = int(time.time())
        registry = ConnectionRegistry()
        here, here_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, registry=registry,
            connection_id="here",
        )
        there, there_recorder = make_connection(
            store.for_workspace("book-club"), fanout, allowed_pubkeys=(pubkey,),
            now=lambda: now, registry=registry, connection_id="there",
        )
        await authenticate(here, here_recorder, sk, pubkey, now=now)
        await authenticate(there, there_recorder, sk, pubkey, now=now)
        await here.handle_message(["REQ", "sub1", {"kinds": [1]}])
        await there.handle_message(["REQ", "sub1", {"kinds": [1]}])

        await registry.force_disconnect(
            pubkey, workspace_slug=store.workspace_slug, reason="removed from the Workspace"
        )

        assert here_recorder.of_type("CLOSED")
        assert there_recorder.of_type("CLOSED") == []


class _HookedQueryStore:
    """The real store with a hook running inside the snapshot query — the
    snapshot→live transition a client has no other way to hit deterministically.
    `before` runs before the rows are read, `after` once they are."""

    def __init__(
        self,
        store: EventStore,
        *,
        before: Callable[[], Awaitable[None]] | None = None,
        after: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._store = store
        self._before = before
        self._after = after

    @property
    def workspace_slug(self) -> str:
        return self._store.workspace_slug

    async def publish(self, event: NostrEvent) -> object:
        return await self._store.publish(event)

    async def query(self, filters: list[object]) -> list[NostrEvent]:
        if self._before is not None:
            await self._before()
        events = await self._store.query(filters)  # type: ignore[arg-type]
        if self._after is not None:
            await self._after()
        return events


class TestSnapshotToLiveTransition:
    async def test_an_event_published_during_the_snapshot_still_reaches_the_subscriber(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="in the gap")
        # A probe subscription on the same fan-out: waiting for *it* to receive
        # the event is what makes a real publish land inside the snapshot
        # window deterministically, rather than a sleep hoping it does.
        probe = await fanout.subscribe(
            "probe-gap", [Filter(kinds=[1])], workspace_slug=store.workspace_slug
        )

        async def publish_after_the_rows_are_read() -> None:
            await store.publish(event)
            async with asyncio.timeout(5):
                await probe.get()

        hooked = _HookedQueryStore(store, after=publish_after_the_rows_are_read)
        subscriber, recorder = make_connection(
            hooked, fanout, allowed_pubkeys=(pubkey,), now=lambda: now,  # type: ignore[arg-type]
            connection_id="gap-subscriber",
        )
        await authenticate(subscriber, recorder, sk, pubkey, now=now)

        await subscriber.handle_message(["REQ", "sub1", {"kinds": [1]}])

        await wait_until(lambda: len(recorder.of_type("EVENT")) == 1)
        assert recorder.of_type("EVENT") == [["EVENT", "sub1", event]]
        eose = recorder.of_type("EOSE")[0]
        assert recorder.sent.index(eose) < recorder.sent.index(["EVENT", "sub1", event])

        fanout.unsubscribe("probe-gap")
        await subscriber.close()

    async def test_an_event_in_both_the_snapshot_and_the_buffer_is_sent_once(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="on the seam")

        async def publish_before_the_rows_are_read() -> None:
            await store.publish(event)
            await fanout.deliver(event, workspace_slug=store.workspace_slug)

        hooked = _HookedQueryStore(store, before=publish_before_the_rows_are_read)
        subscriber, recorder = make_connection(
            hooked, fanout, allowed_pubkeys=(pubkey,), now=lambda: now,  # type: ignore[arg-type]
            connection_id="seam-subscriber",
        )
        await authenticate(subscriber, recorder, sk, pubkey, now=now)

        await subscriber.handle_message(["REQ", "sub1", {"kinds": [1]}])

        await asyncio.sleep(0.1)  # a duplicate, if any, has had its chance to arrive
        assert recorder.of_type("EVENT") == [["EVENT", "sub1", event]]

        await subscriber.close()

    async def test_a_buffered_event_the_caller_may_not_read_is_not_delivered(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        blocked = sign_event(
            sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan2"]], content="not yours"
        )

        async def publish_after_the_rows_are_read() -> None:
            await fanout.deliver(blocked, workspace_slug=store.workspace_slug)

        hooked = _HookedQueryStore(store, after=publish_after_the_rows_are_read)
        subscriber, recorder = make_connection(
            hooked, fanout, allowed_pubkeys=(pubkey,),  # type: ignore[arg-type]
            channel_members={"chan1": {pubkey}, "chan2": set()},
            now=lambda: now, connection_id="gap-outsider",
        )
        await authenticate(subscriber, recorder, sk, pubkey, now=now)

        await subscriber.handle_message(["REQ", "sub1", {"kinds": [9]}])

        await asyncio.sleep(0.1)
        assert recorder.of_type("EVENT") == []

        await subscriber.close()


class TestEphemeralEvents:
    async def test_an_ephemeral_event_is_delivered_live_and_never_stored(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        subscriber, sub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="eph-subscriber"
        )
        await authenticate(subscriber, sub_recorder, sk, pubkey, now=now)
        await subscriber.handle_message(["REQ", "sub1", {"kinds": [20001]}])

        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="eph-publisher"
        )
        await authenticate(publisher, pub_recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=20001, content="typing")
        await publisher.handle_message(["EVENT", event])

        assert pub_recorder.of_type("OK")[-1] == ["OK", event["id"], True, ""]
        await wait_until(lambda: len(sub_recorder.of_type("EVENT")) == 1)
        assert sub_recorder.of_type("EVENT") == [["EVENT", "sub1", event]]

        later, later_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="eph-history"
        )
        await authenticate(later, later_recorder, sk, pubkey, now=now)
        await later.handle_message(["REQ", "sub2", {"kinds": [20001]}])
        assert later_recorder.of_type("EVENT") == []

        await subscriber.close()
        await publisher.close()
        await later.close()

    async def test_an_ephemeral_channel_event_reaches_only_that_channels_members(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        outsider, outsider_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": set()}, now=lambda: now, connection_id="eph-outsider",
        )
        await authenticate(outsider, outsider_recorder, sk, pubkey, now=now)
        await outsider.handle_message(["REQ", "sub1", {"kinds": [20001]}])

        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,),
            channel_members={"chan1": {pubkey}}, now=lambda: now, connection_id="eph-insider",
        )
        await authenticate(publisher, pub_recorder, sk, pubkey, now=now)
        event = sign_event(sk, pubkey=pubkey, created_at=now, kind=20001, tags=[["h", "chan1"]])
        await publisher.handle_message(["EVENT", event])

        await asyncio.sleep(0.1)
        assert outsider_recorder.of_type("EVENT") == []

        await outsider.close()
        await publisher.close()


class TestSubscriptionLifecycle:
    async def test_reusing_a_subscription_id_replaces_the_old_subscription(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        subscriber, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="replacer"
        )
        await authenticate(subscriber, recorder, sk, pubkey, now=now)
        await subscriber.handle_message(["REQ", "sub1", {"kinds": [1]}])
        await subscriber.handle_message(["REQ", "sub1", {"kinds": [7]}])

        publisher, pub_recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="replacer-pub"
        )
        await authenticate(publisher, pub_recorder, sk, pubkey, now=now)
        note = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="old filter")
        await publisher.handle_message(["EVENT", note])

        await asyncio.sleep(0.2)
        assert recorder.of_type("EVENT") == []  # the replaced subscription is gone, not doubled

        await subscriber.close()
        await publisher.close()

    async def test_a_req_with_several_filters_matches_their_union(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        sk, pubkey = new_keypair()
        now = int(time.time())
        connection, recorder = make_connection(
            store, fanout, allowed_pubkeys=(pubkey,), now=lambda: now, connection_id="union"
        )
        await authenticate(connection, recorder, sk, pubkey, now=now)
        note = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="a note")
        message = sign_event(sk, pubkey=pubkey, created_at=now, kind=9, tags=[["h", "chan1"]])
        await connection.handle_message(["EVENT", note])
        await connection.handle_message(["EVENT", message])

        await connection.handle_message(["REQ", "sub1", {"kinds": [1]}, {"kinds": [9]}])

        assert {e[2]["id"] for e in recorder.of_type("EVENT")} == {note["id"], message["id"]}

        live_note = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="live note")
        await connection.handle_message(["EVENT", live_note])
        await wait_until(lambda: len(recorder.of_type("EVENT")) == 3)

        await connection.close()

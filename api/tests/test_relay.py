"""RED: the relay connection state machine — NIP-01 EVENT/REQ/CLOSE and
NIP-42 AUTH, against a real EventStore and the shared live fan-out
(ADR-0004). No real WebSocket involved; `send` is a plain recorder.
"""

import asyncio
import time
from collections.abc import Callable

from coincurve import PrivateKey
from support import Recorder, make_auth_event, new_keypair, sign_event, wait_until

from studio_api.nostr.model import NostrEvent
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

    async def record_references(self, event: NostrEvent, *, channel_id: str) -> None:
        self.recorded.append((event["id"], channel_id))


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

        await registry.force_disconnect(pubkey, reason="removed from workspace")

        closed = recorder.of_type("CLOSED")[-1]
        assert closed[1] == "sub1"
        assert str(closed[2]).startswith("restricted:")

    async def test_force_disconnect_of_an_unregistered_pubkey_is_a_no_op(
        self, store: EventStore, fanout: LiveFanout
    ) -> None:
        registry = ConnectionRegistry()
        await registry.force_disconnect("never-connected", reason="whatever")  # no error

"""RED: the ADR-0004 spike — NIP-01 filters mapped to SurrealQL, and upsert
semantics for replaceable/addressable kinds, against a real SurrealDB.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator

import pytest
from conftest import SURREAL_PASS, SURREAL_URL, SURREAL_USER, TEST_WORKSPACE
from support import wait_until

from studio_api.nostr.model import Filter, NostrEvent
from studio_api.nostr.store import (
    MAX_PENDING_EVENTS,
    Delivery,
    EventStore,
    LiveFanout,
    PublishResult,
    SubscriptionOverflow,
)


def delivered_event(delivery: Delivery) -> NostrEvent:
    """Narrows one live-fanout delivery to the event it carries — the queue
    can also hand back a SubscriptionOverflow marker."""
    assert isinstance(delivery, dict)
    return delivery


def make_event(**overrides: object) -> NostrEvent:
    base: NostrEvent = {
        "id": "id-0000",
        "pubkey": "pub-aaa",
        "created_at": 1_000,
        "kind": 1,
        "tags": [],
        "content": "hello",
        "sig": "sig",
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


class TestHistoricalQuery:
    async def test_query_by_ids(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1"))
        await store.publish(make_event(id="id-2"))

        result = await store.query([Filter(ids=["id-1"])])

        assert [e["id"] for e in result] == ["id-1"]

    async def test_query_by_authors(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1", pubkey="alice"))
        await store.publish(make_event(id="id-2", pubkey="bob"))

        result = await store.query([Filter(authors=["bob"])])

        assert [e["id"] for e in result] == ["id-2"]

    async def test_query_by_kinds(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1", kind=1))
        await store.publish(make_event(id="id-2", kind=9))

        result = await store.query([Filter(kinds=[9])])

        assert [e["id"] for e in result] == ["id-2"]

    async def test_query_by_tag(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1", tags=[["h", "general"]]))
        await store.publish(make_event(id="id-2", tags=[["h", "random"]]))

        result = await store.query([Filter(tags={"h": ["general"]})])

        assert [e["id"] for e in result] == ["id-1"]

    async def test_query_by_since_and_until(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1", created_at=100))
        await store.publish(make_event(id="id-2", created_at=200))
        await store.publish(make_event(id="id-3", created_at=300))

        result = await store.query([Filter(since=150, until=250)])

        assert [e["id"] for e in result] == ["id-2"]

    async def test_results_are_newest_first_with_lowest_id_tiebreak(
        self, store: EventStore
    ) -> None:
        await store.publish(make_event(id="id-b", created_at=100))
        await store.publish(make_event(id="id-a", created_at=100))
        await store.publish(make_event(id="id-c", created_at=200))

        result = await store.query([Filter()])

        # id-c is newest; id-a and id-b tie on created_at, lowest id first.
        assert [e["id"] for e in result] == ["id-c", "id-a", "id-b"]

    async def test_limit_bounds_the_result(self, store: EventStore) -> None:
        for i in range(5):
            await store.publish(make_event(id=f"id-{i}", created_at=i))

        result = await store.query([Filter(limit=2)])

        assert len(result) == 2
        # newest two: id-4, id-3
        assert [e["id"] for e in result] == ["id-4", "id-3"]

    async def test_multiple_filters_are_unioned(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1", kind=1))
        await store.publish(make_event(id="id-2", kind=9))
        await store.publish(make_event(id="id-3", kind=99))

        result = await store.query([Filter(kinds=[1]), Filter(kinds=[9])])

        assert {e["id"] for e in result} == {"id-1", "id-2"}


class TestReplaceableUpsert:
    async def test_second_publish_of_same_pubkey_kind_replaces_first(
        self, store: EventStore
    ) -> None:
        await store.publish(make_event(id="id-1", kind=0, created_at=100, content="old"))
        result = await store.publish(make_event(id="id-2", kind=0, created_at=200, content="new"))

        assert result is PublishResult.OK
        stored = await store.query([Filter(kinds=[0])])
        assert len(stored) == 1
        assert stored[0]["id"] == "id-2"
        assert stored[0]["content"] == "new"

    async def test_older_replaceable_event_is_superseded_not_stored(
        self, store: EventStore
    ) -> None:
        await store.publish(make_event(id="id-2", kind=0, created_at=200))
        result = await store.publish(make_event(id="id-1", kind=0, created_at=100))

        assert result is PublishResult.SUPERSEDED
        stored = await store.query([Filter(kinds=[0])])
        assert [e["id"] for e in stored] == ["id-2"]

    async def test_same_timestamp_lowest_id_wins(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-b", kind=3, created_at=100))
        await store.publish(make_event(id="id-a", kind=3, created_at=100))

        stored = await store.query([Filter(kinds=[3])])

        assert [e["id"] for e in stored] == ["id-a"]

    async def test_different_pubkeys_keep_independent_replaceable_slots(
        self, store: EventStore
    ) -> None:
        await store.publish(make_event(id="id-1", kind=0, pubkey="alice"))
        await store.publish(make_event(id="id-2", kind=0, pubkey="bob"))

        stored = await store.query([Filter(kinds=[0])])

        assert {e["id"] for e in stored} == {"id-1", "id-2"}


class TestAddressableUpsert:
    async def test_second_publish_of_same_pubkey_kind_d_replaces_first(
        self, store: EventStore
    ) -> None:
        await store.publish(
            make_event(id="id-1", kind=30_023, created_at=100, tags=[["d", "my-article"]])
        )
        await store.publish(
            make_event(id="id-2", kind=30_023, created_at=200, tags=[["d", "my-article"]])
        )

        stored = await store.query([Filter(kinds=[30_023])])

        assert [e["id"] for e in stored] == ["id-2"]

    async def test_different_d_tags_are_independent_slots(self, store: EventStore) -> None:
        await store.publish(make_event(id="id-1", kind=30_023, tags=[["d", "article-a"]]))
        await store.publish(make_event(id="id-2", kind=30_023, tags=[["d", "article-b"]]))

        stored = await store.query([Filter(kinds=[30_023])])

        assert {e["id"] for e in stored} == {"id-1", "id-2"}

    async def test_missing_d_tag_is_treated_as_empty_identifier(
        self, store: EventStore
    ) -> None:
        await store.publish(make_event(id="id-1", kind=30_023, created_at=100, tags=[]))
        await store.publish(make_event(id="id-2", kind=30_023, created_at=200, tags=[]))

        stored = await store.query([Filter(kinds=[30_023])])

        assert [e["id"] for e in stored] == ["id-2"]


class TestPing:
    async def test_ping_succeeds_against_a_live_connection(self, store: EventStore) -> None:
        await store.ping()  # raises on failure; nothing to assert on success


class TestReconnect:
    async def test_connecting_twice_to_the_same_namespace_succeeds(self) -> None:
        # Simulates an app restart against a persisted SurrealDB volume,
        # where the schema DEFINE TABLE from the first boot already ran.
        namespace = f"test_{uuid.uuid4().hex}"
        first = await EventStore.connect(
            url=SURREAL_URL, namespace=namespace, database="test",
            user=SURREAL_USER, password=SURREAL_PASS, workspace_slug=TEST_WORKSPACE,
        )
        try:
            second = await EventStore.connect(
                url=SURREAL_URL, namespace=namespace, database="test",
                user=SURREAL_USER, password=SURREAL_PASS, workspace_slug=TEST_WORKSPACE,
            )
            await second.ping()
            await second.close()
        finally:
            await first.close()


class TestRegularDuplicates:
    async def test_publishing_the_same_id_twice_is_a_duplicate(
        self, store: EventStore
    ) -> None:
        await store.publish(make_event(id="id-1"))
        result = await store.publish(make_event(id="id-1"))

        assert result is PublishResult.DUPLICATE
        stored = await store.query([Filter(ids=["id-1"])])
        assert len(stored) == 1


class TestLiveFanout:
    async def test_two_subscriptions_receive_only_their_own_matches(
        self, store: EventStore
    ) -> None:
        fanout = await store.start_live_fanout()
        try:
            queue_kind1 = await fanout.subscribe(
                "sub-1", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE
            )
            queue_kind9 = await fanout.subscribe(
                "sub-2", [Filter(kinds=[9])], workspace_slug=TEST_WORKSPACE
            )

            await store.publish(make_event(id="id-1", kind=1))
            await store.publish(make_event(id="id-2", kind=9))

            received_1 = delivered_event(await asyncio.wait_for(queue_kind1.get(), timeout=2))
            received_2 = delivered_event(await asyncio.wait_for(queue_kind9.get(), timeout=2))

            assert received_1["id"] == "id-1"
            assert received_2["id"] == "id-2"
            assert queue_kind1.empty()
            assert queue_kind9.empty()
        finally:
            await fanout.stop()

    async def test_unsubscribed_subscription_receives_nothing_further(
        self, store: EventStore
    ) -> None:
        fanout = await store.start_live_fanout()
        try:
            queue = await fanout.subscribe(
                "sub-1", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE
            )
            fanout.unsubscribe("sub-1")

            await store.publish(make_event(id="id-1", kind=1))

            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(queue.get(), timeout=0.5)
        finally:
            await fanout.stop()


class TestWorkspaceIsolation:
    """Ticket #45: one server hosts many Workspaces. An event published to
    one Workspace must be invisible to every other, and each Workspace keeps
    its own replaceable slots — a pubkey's kind 0 in one Workspace must not
    overwrite the same pubkey's kind 0 in another."""

    async def test_an_event_published_to_one_workspace_is_invisible_to_another(
        self, store: EventStore
    ) -> None:
        other = store.for_workspace("other-ws")
        await store.publish(make_event(id="id-1"))

        assert await other.query([Filter()]) == []
        assert [e["id"] for e in await store.query([Filter()])] == ["id-1"]

    async def test_same_pubkey_and_kind_keep_independent_slots_per_workspace(
        self, store: EventStore
    ) -> None:
        other = store.for_workspace("other-ws")
        await store.publish(make_event(id="id-here", kind=0, created_at=200, content="here"))
        result = await other.publish(
            make_event(id="id-there", kind=0, created_at=100, content="there")
        )

        assert result is PublishResult.OK
        assert [e["content"] for e in await store.query([Filter(kinds=[0])])] == ["here"]
        assert [e["content"] for e in await other.query([Filter(kinds=[0])])] == ["there"]

    async def test_the_same_regular_event_can_exist_in_two_workspaces(
        self, store: EventStore
    ) -> None:
        other = store.for_workspace("other-ws")
        await store.publish(make_event(id="id-1"))

        assert await other.publish(make_event(id="id-1")) is PublishResult.OK

    async def test_a_live_subscription_only_sees_its_own_workspace(
        self, store: EventStore
    ) -> None:
        other = store.for_workspace("other-ws")
        fanout = await store.start_live_fanout()
        try:
            queue = await fanout.subscribe("sub-1", [Filter(kinds=[1])], workspace_slug="other-ws")

            await store.publish(make_event(id="id-here", kind=1))
            await other.publish(make_event(id="id-there", kind=1))

            received = delivered_event(await asyncio.wait_for(queue.get(), timeout=2))
            assert received["id"] == "id-there"
            assert queue.empty()
        finally:
            await fanout.stop()


class TestLiveFanoutBackpressure:
    """Ticket #52: a subscriber that stops draining its queue must not grow
    it without bound, and must not stall the delivery loop every other
    subscription of every other connection shares."""

    async def test_a_queue_that_is_never_drained_stops_growing(self, store: EventStore) -> None:
        fanout = await store.start_live_fanout()
        try:
            queue = await fanout.subscribe(
                "sub-1", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE
            )

            for i in range(MAX_PENDING_EVENTS + 10):
                fanout.deliver(make_event(id=f"id-{i}"), workspace_slug=TEST_WORKSPACE)

            assert queue.qsize() <= MAX_PENDING_EVENTS
        finally:
            await fanout.stop()

    async def test_an_overrun_subscription_is_told_it_fell_behind(
        self, store: EventStore
    ) -> None:
        fanout = await store.start_live_fanout()
        try:
            queue = await fanout.subscribe(
                "sub-1", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE
            )

            for i in range(MAX_PENDING_EVENTS + 10):
                fanout.deliver(make_event(id=f"id-{i}"), workspace_slug=TEST_WORKSPACE)

            drained = [queue.get_nowait() for _ in range(queue.qsize())]
            assert isinstance(drained[-1], SubscriptionOverflow)
            assert all(isinstance(delivery, dict) for delivery in drained[:-1])
        finally:
            await fanout.stop()

    async def test_one_overrun_subscription_does_not_stall_the_others(
        self, store: EventStore
    ) -> None:
        fanout = await store.start_live_fanout()
        try:
            await fanout.subscribe("stalled", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE)
            healthy = await fanout.subscribe(
                "healthy", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE
            )

            for i in range(MAX_PENDING_EVENTS + 10):
                fanout.deliver(make_event(id=f"id-{i}"), workspace_slug=TEST_WORKSPACE)
                healthy.get_nowait()

            assert healthy.empty()  # every delivery arrived, none blocked behind the stalled one
        finally:
            await fanout.stop()


async def _exhausted_stream() -> AsyncIterator[dict[str, object]]:
    """A live stream that is over before it yields anything."""
    return
    yield  # pragma: no cover — never reached; makes this an async generator


class _DeadLiveQuery:
    """A database connection whose live query is gone — the shape the
    SurrealDB SDK leaves behind when the stream ends or the socket drops."""

    def __init__(self, *, error: Exception | None = None) -> None:
        self._error = error
        self.killed = False

    async def subscribe_live(self, live_id: object) -> AsyncIterator[dict[str, object]]:
        if self._error is not None:
            raise self._error
        return _exhausted_stream()

    async def kill(self, live_id: object) -> None:
        self.killed = True


class TestLiveFanoutFailure:
    """Ticket #52: live delivery is the essential path. When its consumer
    stops for any reason, that has to be observable — a silently dead fan-out
    leaves the relay answering REQs with history and nothing else, forever."""

    async def test_a_fanout_with_a_working_consumer_reports_no_failure(
        self, store: EventStore
    ) -> None:
        fanout = await store.start_live_fanout()
        try:
            assert fanout.failure is None
        finally:
            await fanout.stop()

    async def test_a_live_stream_that_ends_is_recorded_as_a_failure(self) -> None:
        fanout = LiveFanout(_DeadLiveQuery(), "live-1")
        fanout.start_consuming()

        await wait_until(lambda: fanout.failure is not None)

        assert fanout.failure is not None
        await fanout.stop()

    async def test_a_live_stream_that_raises_is_recorded_as_a_failure(self) -> None:
        fanout = LiveFanout(_DeadLiveQuery(error=ConnectionError("socket closed")), "live-1")
        fanout.start_consuming()

        await wait_until(lambda: fanout.failure is not None)

        assert fanout.failure == "ConnectionError"
        await fanout.stop()

    async def test_stopping_a_healthy_fanout_is_not_a_failure(self, store: EventStore) -> None:
        fanout = await store.start_live_fanout()

        await fanout.stop()

        assert fanout.failure is None


class TestFailureLogging:
    """Ticket #52: the failures above have to be diagnosable from logs alone,
    with structured fields — and a relay's logs are the last place message
    content or a connection secret may end up."""

    async def test_the_overflow_warning_names_the_subscription_and_no_event_content(
        self, store: EventStore, caplog: pytest.LogCaptureFixture
    ) -> None:
        fanout = await store.start_live_fanout()
        try:
            await fanout.subscribe("sub-1", [Filter(kinds=[1])], workspace_slug=TEST_WORKSPACE)

            with caplog.at_level(logging.WARNING):
                for i in range(MAX_PENDING_EVENTS + 10):
                    fanout.deliver(
                        make_event(id=f"id-{i}", content="a-private-message"),
                        workspace_slug=TEST_WORKSPACE,
                    )

            assert any(
                getattr(record, "subscription", None) == "sub-1" for record in caplog.records
            )
            assert "a-private-message" not in caplog.text
        finally:
            await fanout.stop()

    async def test_the_live_failure_log_carries_a_reason_and_not_the_raw_error(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        fanout = LiveFanout(
            _DeadLiveQuery(error=ConnectionError("ws://root:hunter2@db:8000 went away")), "live-1"
        )

        with caplog.at_level(logging.ERROR):
            fanout.start_consuming()
            await wait_until(lambda: fanout.failure is not None)

        assert any(getattr(record, "reason", None) == "ConnectionError" for record in caplog.records)
        assert "hunter2" not in caplog.text
        await fanout.stop()

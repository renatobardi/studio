"""Shared fixtures for the store's integration tests.

These tests hit a real, running SurrealDB instance (the embedded `mem://`
engine's live-query support is broken in `surrealdb==2.0.0` — see ADR-0004).
Point `SURREAL_URL`/`SURREAL_USER`/`SURREAL_PASS` at a `surreal start memory`
instance; the Compose `test` profile and CI both provide one. Each test gets
its own namespace/database on that instance so tests never see each other's
data.
"""

import os
import uuid
from collections.abc import AsyncIterator

import pytest_asyncio

from studio_api.nostr.store import EventStore, LiveFanout

SURREAL_URL = os.environ.get("SURREAL_URL", "ws://localhost:8010/rpc")
SURREAL_USER = os.environ.get("SURREAL_USER", "root")
SURREAL_PASS = os.environ.get("SURREAL_PASS", "root")

# Every store fixture is scoped to this Workspace; isolation tests derive a
# second one with EventStore.for_workspace().
TEST_WORKSPACE = "test-ws"


async def connect_test_store() -> EventStore:
    """A fresh, isolated EventStore on its own namespace. A plain function
    (not a fixture) so code that must run in a different event loop — e.g.
    inside Starlette TestClient's own portal, for a real ASGI WebSocket test
    — can connect its own store rather than reusing one bound elsewhere."""
    return await EventStore.connect(
        url=SURREAL_URL,
        namespace=f"test_{uuid.uuid4().hex}",
        database="test",
        user=SURREAL_USER,
        password=SURREAL_PASS,
        workspace_slug=TEST_WORKSPACE,
    )


@pytest_asyncio.fixture
async def store() -> AsyncIterator[EventStore]:
    event_store = await connect_test_store()
    try:
        yield event_store
    finally:
        await event_store.close()


@pytest_asyncio.fixture
async def fanout(store: EventStore) -> AsyncIterator[LiveFanout]:
    """The single, app-wide live query fanned out to many subscriptions
    (ADR-0004) — shared by every RelayConnection in a real deployment."""
    live_fanout = await store.start_live_fanout()
    try:
        yield live_fanout
    finally:
        await live_fanout.stop()

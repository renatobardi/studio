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

from studio_api.nostr.store import EventStore

SURREAL_URL = os.environ.get("SURREAL_URL", "ws://localhost:8010/rpc")
SURREAL_USER = os.environ.get("SURREAL_USER", "root")
SURREAL_PASS = os.environ.get("SURREAL_PASS", "root")


@pytest_asyncio.fixture
async def store() -> AsyncIterator[EventStore]:
    namespace = f"test_{uuid.uuid4().hex}"
    database = "test"
    event_store = await EventStore.connect(
        url=SURREAL_URL,
        namespace=namespace,
        database=database,
        user=SURREAL_USER,
        password=SURREAL_PASS,
    )
    try:
        yield event_store
    finally:
        await event_store.close()

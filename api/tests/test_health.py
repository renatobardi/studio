"""RED: the walking skeleton's health and readiness endpoints.

Readiness is distinct from liveness: it actually round-trips SurrealDB, so a
misconfigured or unreachable database shows up as a failing readiness check
rather than a silently-broken app that still answers "I'm alive".
"""

from conftest import connect_test_store
from httpx import ASGITransport, AsyncClient

from studio_api.main import create_app
from studio_api.nostr.store import EventStore


async def test_health_is_always_ok() -> None:
    app = create_app(store=None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_reports_ok_when_the_store_answers(store: EventStore) -> None:
    app = create_app(store=store)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_reports_503_when_there_is_no_store() -> None:
    app = create_app(store=None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/ready")

    assert response.status_code == 503


class _BrokenStore:
    """A store whose connection to SurrealDB has died."""

    async def ping(self) -> None:
        raise ConnectionError("SurrealDB is unreachable")


async def test_ready_reports_503_when_the_store_cannot_reach_the_database() -> None:
    app = create_app(store=_BrokenStore())  # type: ignore[arg-type]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/ready")

    assert response.status_code == 503


class _FailedFanout:
    """A live fan-out whose consumer has stopped — the relay can still answer
    history, but nothing published anywhere reaches an open subscription."""

    failure = "ConnectionError"


async def test_ready_reports_503_when_live_delivery_has_stopped(store: EventStore) -> None:
    app = create_app(store=store, fanout=_FailedFanout())  # type: ignore[arg-type]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


async def test_ready_reports_503_after_the_database_connection_is_interrupted() -> None:
    """The real interruption, not a stand-in: the connection the app holds
    goes away and readiness has to stop saying ok."""
    interrupted = await connect_test_store()
    app = create_app(store=interrupted)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/api/ready")).status_code == 200

        await interrupted.close()

        assert (await client.get("/api/ready")).status_code == 503

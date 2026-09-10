"""RED: the walking skeleton's health and readiness endpoints.

Readiness is distinct from liveness: it actually round-trips SurrealDB, so a
misconfigured or unreachable database shows up as a failing readiness check
rather than a silently-broken app that still answers "I'm alive".
"""

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

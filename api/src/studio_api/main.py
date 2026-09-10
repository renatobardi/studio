"""The FastAPI app: liveness/readiness for now, the relay and control plane
(NIP-01/42/43, Accounts, Workspaces, Channels) arrive in later tickets."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response

from studio_api.nostr.store import EventStore


def create_app(*, store: EventStore | None) -> FastAPI:
    app = FastAPI(title="Studio API")
    app.state.store = store

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/ready")
    async def ready(response: Response) -> dict[str, str]:
        current_store: EventStore | None = app.state.store
        if current_store is None:
            response.status_code = 503
            return {"status": "unavailable"}
        try:
            await current_store.ping()
        except Exception:  # noqa: BLE001 — any failure reaching the store means "not ready"
            response.status_code = 503
            return {"status": "unavailable"}
        return {"status": "ok"}

    return app


async def build_default_store() -> EventStore:
    return await EventStore.connect(
        url=os.environ["SURREAL_URL"],
        namespace=os.environ.get("SURREAL_NAMESPACE", "studio"),
        database=os.environ.get("SURREAL_DATABASE", "studio"),
        user=os.environ["SURREAL_USER"],
        password=os.environ["SURREAL_PASS"],
    )


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.store = await build_default_store()
    try:
        yield
    finally:
        await app.state.store.close()


app = create_app(store=None)
app.router.lifespan_context = _lifespan

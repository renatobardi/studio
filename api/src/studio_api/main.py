"""The FastAPI app: health/readiness, the NIP-01/42 relay and NIP-11 for a
single seeded Workspace (ticket #2). Real Workspace/Channel membership and
the control-plane REST endpoints arrive in ticket #3."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Response
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocket, WebSocketDisconnect

from studio_api.nostr.nip11 import build_info_document
from studio_api.nostr.relay import RelayAuthorizer, RelayConnection
from studio_api.nostr.store import EventStore, LiveFanout

NOSTR_JSON_MEDIA_TYPE = "application/nostr+json"


def create_app(
    *,
    store: EventStore | None,
    fanout: LiveFanout | None = None,
    workspace_slug: str = "",
    allowed_pubkeys: set[str] | None = None,
    relay_name: str = "Studio",
) -> FastAPI:
    app = FastAPI(title="Studio API")
    app.state.store = store
    app.state.fanout = fanout
    app.state.workspace_slug = workspace_slug
    app.state.authorizer = RelayAuthorizer(allowed_pubkeys or set())
    app.state.relay_name = relay_name

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

    @app.get("/relay/{slug}")
    async def relay_info(
        slug: str, accept: str | None = Header(default=None)
    ) -> Response:
        if slug != app.state.workspace_slug or accept != NOSTR_JSON_MEDIA_TYPE:
            return Response(status_code=404)
        document = build_info_document(name=app.state.relay_name)
        return JSONResponse(document, media_type=NOSTR_JSON_MEDIA_TYPE)

    @app.websocket("/relay/{slug}")
    async def relay_ws(websocket: WebSocket, slug: str) -> None:
        if slug != app.state.workspace_slug:
            await websocket.close(code=4404)
            return
        await websocket.accept()
        connection = RelayConnection(
            store=app.state.store,
            fanout=app.state.fanout,
            authorizer=app.state.authorizer,
            relay_url=str(websocket.url),
            send=websocket.send_json,
        )
        await connection.start()
        try:
            while True:
                message = await websocket.receive_json()
                await connection.handle_message(message)
        except WebSocketDisconnect:
            pass
        finally:
            await connection.close()

    return app


async def build_default_store() -> EventStore:
    return await EventStore.connect(
        url=os.environ["SURREAL_URL"],
        namespace=os.environ.get("SURREAL_NAMESPACE", "studio"),
        database=os.environ.get("SURREAL_DATABASE", "studio"),
        user=os.environ["SURREAL_USER"],
        password=os.environ["SURREAL_PASS"],
    )


def _allowed_pubkeys_from_env() -> set[str]:
    raw = os.environ.get("WORKSPACE_ALLOWED_PUBKEYS", "")
    return {pubkey.strip() for pubkey in raw.split(",") if pubkey.strip()}


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.store = await build_default_store()
    app.state.fanout = await app.state.store.start_live_fanout()
    app.state.workspace_slug = os.environ.get("WORKSPACE_SLUG", "")
    app.state.authorizer = RelayAuthorizer(_allowed_pubkeys_from_env())
    try:
        yield
    finally:
        await app.state.fanout.stop()
        await app.state.store.close()


app = create_app(store=None)
app.router.lifespan_context = _lifespan

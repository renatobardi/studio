"""The FastAPI app: health/readiness, the NIP-01/42/43/29 relay, NIP-11, and
the control-plane REST API (Account, Workspace, Invite, Members, Channels —
ticket #3). Real Workspace/Channel membership drives relay authorization;
the ticket #2 seeded allowlist remains available for relay-only tests."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Response
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocket, WebSocketDisconnect

from studio_api.auth import FirebaseVerifier
from studio_api.control.relay_authorizer import WorkspaceMembershipAuthorizer
from studio_api.control.repository import ControlPlaneRepository
from studio_api.control.routes import router as control_router
from studio_api.media.repository import MediaRepository
from studio_api.media.routes import router as media_router
from studio_api.media.storage import ObjectStorage
from studio_api.nostr.nip11 import build_info_document
from studio_api.nostr.relay import (
    ConnectionRegistry,
    RelayAuthorizer,
    RelayConnection,
    SeededRelayAuthorizer,
)
from studio_api.nostr.store import EventStore, LiveFanout

NOSTR_JSON_MEDIA_TYPE = "application/nostr+json"


def create_app(
    *,
    store: EventStore | None,
    fanout: LiveFanout | None = None,
    repo: ControlPlaneRepository | None = None,
    workspace_slug: str = "",
    allowed_pubkeys: set[str] | None = None,
    relay_name: str = "Studio",
    firebase_verifier: FirebaseVerifier | None = None,
    media_repo: MediaRepository | None = None,
    storage: ObjectStorage | None = None,
) -> FastAPI:
    app = FastAPI(title="Studio API")
    app.state.store = store
    app.state.fanout = fanout
    app.state.repo = repo
    app.state.workspace_slug = workspace_slug
    app.state.relay_name = relay_name
    app.state.firebase_verifier = firebase_verifier
    app.state.connection_registry = ConnectionRegistry()
    app.state.media_repo = media_repo
    app.state.storage = storage

    authorizer: RelayAuthorizer
    if repo is not None:
        authorizer = WorkspaceMembershipAuthorizer(repo, workspace_slug=workspace_slug)
    else:
        authorizer = SeededRelayAuthorizer(allowed_pubkeys or set())
    app.state.authorizer = authorizer

    app.include_router(control_router)
    app.include_router(media_router)

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
        self_pubkey = None
        if app.state.repo is not None:
            workspace = await app.state.repo.get_workspace(slug)
            self_pubkey = workspace.key_pubkey if workspace is not None else None
        document = build_info_document(name=app.state.relay_name, self_pubkey=self_pubkey)
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
            registry=app.state.connection_registry,
            close_transport=websocket.close,
            media_repo=app.state.media_repo,
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


def _build_firebase_verifier() -> FirebaseVerifier | None:
    credentials_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")
    if not credentials_path:
        return None
    from studio_api.firebase_verifier import RealFirebaseVerifier

    return RealFirebaseVerifier(credentials_path)


async def _build_storage() -> ObjectStorage:
    storage = ObjectStorage(
        endpoint_url=os.environ["MINIO_ENDPOINT"],
        access_key=os.environ["MINIO_ROOT_USER"],
        secret_key=os.environ["MINIO_ROOT_PASSWORD"],
        bucket=os.environ.get("MINIO_BUCKET", "studio-media"),
    )
    await storage.ensure_bucket()
    return storage


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.store = await build_default_store()
    app.state.fanout = await app.state.store.start_live_fanout()
    app.state.workspace_slug = os.environ.get("WORKSPACE_SLUG", "")
    app.state.repo = ControlPlaneRepository(
        app.state.store.raw,
        event_store=app.state.store,
        server_secret=os.environ["WORKSPACE_KEY_SECRET"],
    )
    app.state.media_repo = MediaRepository(app.state.store.raw)
    app.state.storage = await _build_storage()
    app.state.authorizer = WorkspaceMembershipAuthorizer(
        app.state.repo, workspace_slug=app.state.workspace_slug
    )
    app.state.firebase_verifier = _build_firebase_verifier()
    try:
        yield
    finally:
        await app.state.fanout.stop()
        await app.state.store.close()


app = create_app(store=None)
app.router.lifespan_context = _lifespan

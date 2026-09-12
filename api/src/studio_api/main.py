"""The FastAPI app: health/readiness, the NIP-01/42/43/29 relay, NIP-11, and
the control-plane REST API (Account, Workspace, Invite, Members, Channels —
ticket #3). Real Workspace/Channel membership drives relay authorization;
the ticket #2 seeded allowlist remains available for relay-only tests."""

import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

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
    MAX_MESSAGE_LENGTH,
    ConnectionRegistry,
    RelayAuthorizer,
    RelayConnection,
    SeededRelayAuthorizer,
)
from studio_api.nostr.store import EventStore, LiveFanout

NOSTR_JSON_MEDIA_TYPE = "application/nostr+json"

logger = logging.getLogger(__name__)


async def _relay_authorizer(app: FastAPI, slug: str) -> RelayAuthorizer | None:
    """The authorizer for one Workspace's relay, or None when this server
    hosts no Workspace by that slug. A server holds many Workspaces, so the
    slug comes from the request path — never from configuration (ticket #45).
    """
    repo: ControlPlaneRepository | None = app.state.repo
    if repo is not None:
        workspace = await repo.get_workspace(slug)
        if workspace is None:
            return None
        return WorkspaceMembershipAuthorizer(repo, workspace_slug=slug)
    if slug in app.state.relay_workspaces:
        return cast(RelayAuthorizer, app.state.seeded_authorizer)
    return None


def create_app(
    *,
    store: EventStore | None,
    fanout: LiveFanout | None = None,
    repo: ControlPlaneRepository | None = None,
    relay_workspaces: set[str] | None = None,
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
    # Only consulted when there is no control plane: the ticket #2 relay-only
    # seam, where Workspaces are a fixed test allowlist rather than rows.
    app.state.relay_workspaces = relay_workspaces or set()
    app.state.relay_name = relay_name
    app.state.firebase_verifier = firebase_verifier
    app.state.connection_registry = ConnectionRegistry()
    app.state.media_repo = media_repo
    app.state.storage = storage

    app.state.seeded_authorizer = SeededRelayAuthorizer(allowed_pubkeys or set())

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
        # Reaching the database is not enough: a relay whose live query has
        # stopped answers REQs with history and then goes silent, which is not
        # a working Workspace (ticket #52).
        current_fanout: LiveFanout | None = app.state.fanout
        if current_fanout is not None and current_fanout.failure is not None:
            response.status_code = 503
            return {"status": "unavailable"}
        return {"status": "ok"}

    @app.get("/relay/{slug}")
    async def relay_info(
        slug: str, accept: str | None = Header(default=None)
    ) -> Response:
        if accept != NOSTR_JSON_MEDIA_TYPE or await _relay_authorizer(app, slug) is None:
            return Response(status_code=404)
        self_pubkey = None
        if app.state.repo is not None:
            workspace = await app.state.repo.get_workspace(slug)
            self_pubkey = workspace.key_pubkey if workspace is not None else None
        document = build_info_document(name=app.state.relay_name, self_pubkey=self_pubkey)
        return JSONResponse(document, media_type=NOSTR_JSON_MEDIA_TYPE)

    @app.websocket("/relay/{slug}")
    async def relay_ws(websocket: WebSocket, slug: str) -> None:
        authorizer = await _relay_authorizer(app, slug)
        if authorizer is None:
            await websocket.close(code=4404)
            return
        await websocket.accept()
        connection = RelayConnection(
            store=app.state.store.for_workspace(slug),
            fanout=app.state.fanout,
            authorizer=authorizer,
            relay_url=str(websocket.url),
            send=websocket.send_json,
            registry=app.state.connection_registry,
            close_transport=websocket.close,
            media_repo=app.state.media_repo,
        )
        await connection.start()
        try:
            while await _pump_one_message(websocket, connection):
                pass
        except WebSocketDisconnect:
            pass
        finally:
            await connection.close()

    return app


async def _pump_one_message(websocket: WebSocket, connection: RelayConnection) -> bool:
    """Reads one frame off the wire and hands it to the relay. Returns False
    once this socket is done. Everything a client can send that is not a
    NIP-01 message in a text frame is answered here, before the relay's own
    parsing, and only an over-long frame ends the connection (ticket #52)."""
    packet = await websocket.receive()
    if packet["type"] == "websocket.disconnect":
        return False
    text = packet.get("text")
    if text is None:
        await websocket.send_json(["NOTICE", "invalid: a client message must be a text frame"])
        return True
    if len(text) > MAX_MESSAGE_LENGTH:
        await websocket.send_json(
            ["NOTICE", f"invalid: a client message may not exceed {MAX_MESSAGE_LENGTH} characters"]
        )
        # 1009 (message too big): a client that ignores the published limit is
        # not one to keep reading from.
        logger.warning(
            "closing a connection over the message length limit", extra={"length": len(text)}
        )
        await websocket.close(code=1009)
        return False
    try:
        message = json.loads(text)
    except json.JSONDecodeError:
        await websocket.send_json(["NOTICE", "invalid: a client message must be valid JSON"])
        return True
    await connection.handle_message(message)
    return True


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
    # One store and one repository for the whole process. That is not just
    # frugality: both serialise their read-sign-write cycles on in-process
    # locks, so a Workspace's invariants hold only while a single process
    # owns them (ticket #44). Running the `api` service with more than one
    # worker or replica would need real optimistic concurrency instead.
    app.state.repo = ControlPlaneRepository(
        app.state.store.raw,
        event_store=app.state.store,
        server_secret=os.environ["WORKSPACE_KEY_SECRET"],
    )
    app.state.media_repo = MediaRepository(app.state.store.raw)
    app.state.storage = await _build_storage()
    app.state.firebase_verifier = _build_firebase_verifier()
    try:
        yield
    finally:
        await app.state.fanout.stop()
        await app.state.store.close()


app = create_app(store=None)
app.router.lifespan_context = _lifespan

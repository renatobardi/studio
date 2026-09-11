"""RED: wiring the relay (NIP-01/42) and NIP-11 into the FastAPI app —
ticket #2's actual `wss://<host>/relay/<workspace-slug>` endpoint.
"""

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from conftest import connect_test_store
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from support import new_keypair, sign_event

from studio_api.main import create_app
from studio_api.nostr.store import EventStore, LiveFanout

WORKSPACE_SLUG = "family"


async def make_app(
    store: EventStore,
    *,
    allowed_pubkeys: tuple[str, ...] = (),
    workspaces: tuple[str, ...] = (WORKSPACE_SLUG,),
) -> tuple[FastAPI, LiveFanout]:
    fanout = await store.start_live_fanout()
    app = create_app(
        store=store,
        fanout=fanout,
        relay_workspaces=set(workspaces),
        allowed_pubkeys=set(allowed_pubkeys),
    )
    return app, fanout


class TestNip11Route:
    async def test_nostr_json_accept_header_returns_the_info_document(
        self, store: EventStore
    ) -> None:
        app, fanout = await make_app(store)
        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    f"/relay/{WORKSPACE_SLUG}", headers={"Accept": "application/nostr+json"}
                )

            assert response.status_code == 200
            assert response.json()["name"]
            assert response.headers["content-type"].startswith("application/nostr+json")
        finally:
            await fanout.stop()

    async def test_a_plain_get_without_the_nostr_accept_header_is_not_found(
        self, store: EventStore
    ) -> None:
        app, fanout = await make_app(store)
        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(f"/relay/{WORKSPACE_SLUG}")

            assert response.status_code == 404
        finally:
            await fanout.stop()

    async def test_an_unknown_workspace_slug_is_not_found(self, store: EventStore) -> None:
        app, fanout = await make_app(store)
        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/relay/not-the-configured-workspace",
                    headers={"Accept": "application/nostr+json"},
                )

            assert response.status_code == 404
        finally:
            await fanout.stop()


@asynccontextmanager
async def _test_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Connects its own store inside whatever loop is running it — needed
    because Starlette's TestClient drives real ASGI WebSocket scopes from a
    background-thread portal with its own event loop, distinct from the
    pytest-asyncio loop the `store` fixture is bound to."""
    app.state.store = await connect_test_store()
    app.state.fanout = await app.state.store.start_live_fanout()
    try:
        yield
    finally:
        await app.state.fanout.stop()
        await app.state.store.close()


class TestRelayWebSocket:
    def test_full_round_trip_over_a_real_websocket(self) -> None:
        sk, pubkey = new_keypair()
        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG}, allowed_pubkeys={pubkey})
        app.router.lifespan_context = _test_lifespan

        with TestClient(app) as client, client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as ws:
            auth_msg = ws.receive_json()
            assert auth_msg[0] == "AUTH"
            challenge = auth_msg[1]

            now = int(time.time())
            auth_event = sign_event(
                sk, pubkey=pubkey, created_at=now, kind=22242,
                tags=[
                    ["relay", f"ws://testserver/relay/{WORKSPACE_SLUG}"],
                    ["challenge", challenge],
                ],
            )
            ws.send_json(["AUTH", auth_event])
            ok = ws.receive_json()
            assert ok == ["OK", auth_event["id"], True, ""]

            event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="hello relay")
            ws.send_json(["EVENT", event])
            publish_ok = ws.receive_json()
            assert publish_ok == ["OK", event["id"], True, ""]

            ws.send_json(["REQ", "sub1", {"kinds": [1]}])
            received = ws.receive_json()
            assert received == ["EVENT", "sub1", event]
            eose = ws.receive_json()
            assert eose == ["EOSE", "sub1"]

    def test_an_unknown_workspace_slug_closes_the_connection(self) -> None:
        from starlette.websockets import WebSocketDisconnect

        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG})

        with TestClient(app) as client:
            raised = False
            try:
                with client.websocket_connect("/relay/not-the-configured-workspace"):
                    pass
            except WebSocketDisconnect:
                raised = True
            assert raised


class TestManyWorkspacesOnOneServer:
    """Ticket #45: the server hosts every Workspace it holds, resolved from
    the request path — not one Workspace fixed by configuration."""

    async def test_each_hosted_workspace_serves_its_own_nip11_document(
        self, store: EventStore
    ) -> None:
        app, fanout = await make_app(store, workspaces=("family", "book-club"))
        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Accept": "application/nostr+json"}
                assert (await client.get("/relay/family", headers=headers)).status_code == 200
                assert (await client.get("/relay/book-club", headers=headers)).status_code == 200
                assert (await client.get("/relay/nope", headers=headers)).status_code == 404
        finally:
            await fanout.stop()

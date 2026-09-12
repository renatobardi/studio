"""RED: wiring the relay (NIP-01/42) and NIP-11 into the FastAPI app —
ticket #2's actual `wss://<host>/relay/<workspace-slug>` endpoint.
"""

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from coincurve import PrivateKey
from conftest import connect_test_store
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient, WebSocketTestSession
from support import new_keypair, sign_event

from studio_api.main import create_app
from studio_api.nostr.relay import MAX_MESSAGE_LENGTH
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


def _authenticate(ws: WebSocketTestSession, sk: PrivateKey, pubkey: str) -> int:
    """Walks one real socket through the NIP-42 handshake; returns the `now`
    its auth event was signed with."""
    auth_msg = ws.receive_json()
    assert auth_msg[0] == "AUTH"
    now = int(time.time())
    auth_event = sign_event(
        sk, pubkey=pubkey, created_at=now, kind=22242,
        tags=[
            ["relay", f"ws://testserver/relay/{WORKSPACE_SLUG}"],
            ["challenge", auth_msg[1]],
        ],
    )
    ws.send_json(["AUTH", auth_event])
    assert ws.receive_json() == ["OK", auth_event["id"], True, ""]
    return now


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

    def test_an_ephemeral_event_is_delivered_live_but_never_stored(self) -> None:
        sk, pubkey = new_keypair()
        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG}, allowed_pubkeys={pubkey})
        app.router.lifespan_context = _test_lifespan

        with TestClient(app) as client, client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as ws:
            now = _authenticate(ws, sk, pubkey)

            ws.send_json(["REQ", "sub1", {"kinds": [20001]}])
            assert ws.receive_json() == ["EOSE", "sub1"]

            event = sign_event(sk, pubkey=pubkey, created_at=now, kind=20001, content="typing")
            ws.send_json(["EVENT", event])
            assert ws.receive_json() == ["OK", event["id"], True, ""]
            assert ws.receive_json() == ["EVENT", "sub1", event]

            ws.send_json(["REQ", "sub2", {"kinds": [20001]}])
            assert ws.receive_json() == ["EOSE", "sub2"]

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


def _authenticate_over_websocket(ws: WebSocketTestSession, sk: PrivateKey, pubkey: str) -> None:
    challenge = ws.receive_json()[1]
    auth_event = sign_event(
        sk, pubkey=pubkey, created_at=int(time.time()), kind=22242,
        tags=[["relay", f"ws://testserver/relay/{WORKSPACE_SLUG}"], ["challenge", challenge]],
    )
    ws.send_json(["AUTH", auth_event])
    ok = ws.receive_json()
    assert ok[2] is True, ok


class TestGiftWrapOverARealWebSocket:
    """Ticket #7 / issue #40: what a real client actually puts on the wire. A NIP-59 gift wrap
    is signed by a one-time throwaway key (see web/src/lib/nip17.ts's `wrapSeal`), so the
    connection's authenticated Identity and the event's `pubkey` never match — the mismatch
    that used to make the relay reject every Direct Message. The ciphertext is opaque here on
    purpose: the relay must decide on the envelope alone, never on the plaintext."""

    def test_an_ephemerally_signed_gift_wrap_reaches_its_recipient_and_nobody_else(self) -> None:
        sender_sk, sender_pubkey = new_keypair()
        ephemeral_sk, ephemeral_pubkey = new_keypair()
        recipient_sk, recipient_pubkey = new_keypair()
        eavesdropper_sk, eavesdropper_pubkey = new_keypair()
        app = create_app(
            store=None,
            relay_workspaces={WORKSPACE_SLUG},
            allowed_pubkeys={sender_pubkey, recipient_pubkey, eavesdropper_pubkey},
        )
        app.router.lifespan_context = _test_lifespan

        with (
            TestClient(app) as client,
            client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as sender_ws,
            client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as recipient_ws,
            client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as eavesdropper_ws,
        ):
            for ws, sk, pubkey in (
                (sender_ws, sender_sk, sender_pubkey),
                (recipient_ws, recipient_sk, recipient_pubkey),
                (eavesdropper_ws, eavesdropper_sk, eavesdropper_pubkey),
            ):
                _authenticate_over_websocket(ws, sk, pubkey)

            # NIP-59 also backdates the wrap by up to two days so the relay can't correlate
            # the real send time — well inside the relay's past tolerance.
            wrap = sign_event(
                ephemeral_sk, pubkey=ephemeral_pubkey, created_at=int(time.time()) - 3600,
                kind=1059, tags=[["p", recipient_pubkey]], content="opaque-nip44-ciphertext",
            )
            sender_ws.send_json(["EVENT", wrap])
            assert sender_ws.receive_json() == ["OK", wrap["id"], True, ""]

            recipient_ws.send_json(["REQ", "sub1", {"kinds": [1059], "#p": [recipient_pubkey]}])
            assert recipient_ws.receive_json() == ["EVENT", "sub1", wrap]
            assert recipient_ws.receive_json() == ["EOSE", "sub1"]

            # A third Workspace Member asking for exactly that `p` tag gets an empty history.
            eavesdropper_ws.send_json(["REQ", "sub1", {"kinds": [1059], "#p": [recipient_pubkey]}])
            assert eavesdropper_ws.receive_json() == ["EOSE", "sub1"]


class TestMalformedWireTraffic:
    """Ticket #52: the WebSocket adapter is the first thing a broken or
    hostile client meets, before any of the relay's own parsing. None of it
    may end the connection on an unhandled exception."""

    def test_text_that_is_not_json_is_answered_with_a_notice(self) -> None:
        _sk, pubkey = new_keypair()
        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG}, allowed_pubkeys={pubkey})
        app.router.lifespan_context = _test_lifespan

        with TestClient(app) as client, client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as ws:
            assert ws.receive_json()[0] == "AUTH"

            ws.send_text("{not json at all")

            notice = ws.receive_json()
            assert notice[0] == "NOTICE"
            assert str(notice[1]).startswith("invalid:")

    def test_a_binary_frame_is_answered_with_a_notice(self) -> None:
        _sk, pubkey = new_keypair()
        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG}, allowed_pubkeys={pubkey})
        app.router.lifespan_context = _test_lifespan

        with TestClient(app) as client, client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as ws:
            assert ws.receive_json()[0] == "AUTH"

            ws.send_bytes(b"\x00\x01\x02")

            notice = ws.receive_json()
            assert notice[0] == "NOTICE"
            assert str(notice[1]).startswith("invalid:")

    def test_the_connection_survives_garbage_and_still_publishes(self) -> None:
        sk, pubkey = new_keypair()
        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG}, allowed_pubkeys={pubkey})
        app.router.lifespan_context = _test_lifespan

        with TestClient(app) as client, client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as ws:
            challenge = ws.receive_json()[1]
            ws.send_text("{not json at all")
            assert ws.receive_json()[0] == "NOTICE"

            now = int(time.time())
            auth_event = sign_event(
                sk, pubkey=pubkey, created_at=now, kind=22242,
                tags=[
                    ["relay", f"ws://testserver/relay/{WORKSPACE_SLUG}"],
                    ["challenge", challenge],
                ],
            )
            ws.send_json(["AUTH", auth_event])
            assert ws.receive_json() == ["OK", auth_event["id"], True, ""]

            event = sign_event(sk, pubkey=pubkey, created_at=now, kind=1, content="after garbage")
            ws.send_json(["EVENT", event])
            assert ws.receive_json() == ["OK", event["id"], True, ""]

    def test_a_message_beyond_the_published_length_limit_closes_the_connection(self) -> None:
        from starlette.websockets import WebSocketDisconnect

        app = create_app(store=None, relay_workspaces={WORKSPACE_SLUG})
        app.router.lifespan_context = _test_lifespan

        with TestClient(app) as client, client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as ws:
            assert ws.receive_json()[0] == "AUTH"

            ws.send_text("x" * (MAX_MESSAGE_LENGTH + 1))

            notice = ws.receive_json()
            assert notice[0] == "NOTICE"
            assert str(notice[1]).startswith("invalid:")
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()

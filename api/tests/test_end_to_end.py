"""RED: ticket #3's own verification method — "two raw Nostr clients: a
Channel Member sees channel events, a non-member does not, and a removed
member is disconnected" — through the real REST API and the real
WebSocket relay together, backed by a real SurrealDB.
"""

import base64
import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from coincurve import PrivateKey
from conftest import connect_test_store
from fastapi import FastAPI
from starlette.testclient import TestClient, WebSocketTestSession
from support import new_keypair, sign_event

from studio_api.control.repository import ControlPlaneRepository
from studio_api.main import create_app

WORKSPACE_SLUG = "family"
SERVER_SECRET = "e2e-server-secret"


@asynccontextmanager
async def _test_lifespan(app: FastAPI) -> AsyncIterator[None]:
    store = await connect_test_store()
    app.state.store = store
    app.state.fanout = await store.start_live_fanout()
    app.state.repo = ControlPlaneRepository(
        store.raw, event_store=store, server_secret=SERVER_SECRET
    )
    try:
        yield
    finally:
        await app.state.fanout.stop()
        await store.close()


def nostr_auth_headers(sk: PrivateKey, pubkey: str, *, url: str, method: str) -> dict[str, str]:
    event = sign_event(
        sk, pubkey=pubkey, created_at=int(time.time()), kind=27235,
        tags=[["u", url], ["method", method]],
    )
    encoded = base64.b64encode(json.dumps(event).encode()).decode("ascii")
    return {"Authorization": f"Nostr {encoded}"}


def test_channel_membership_gates_events_and_removal_disconnects() -> None:
    app = create_app(store=None)
    app.router.lifespan_context = _test_lifespan

    owner_sk, owner_pubkey = new_keypair()
    member_sk, member_pubkey = new_keypair()
    outsider_sk, outsider_pubkey = new_keypair()

    with TestClient(app) as client:
        # --- REST: owner creates the Workspace and a Channel, invites and
        # the member redeems, but the outsider never joins the Channel. ---
        create_ws = client.post(
            "/api/workspaces",
            headers=nostr_auth_headers(
                owner_sk, owner_pubkey, url="http://testserver/api/workspaces", method="POST"
            ),
            json={"slug": WORKSPACE_SLUG, "name": "Family"},
        )
        assert create_ws.status_code == 200

        create_invite = client.post(
            f"/api/workspaces/{WORKSPACE_SLUG}/invites",
            headers=nostr_auth_headers(
                owner_sk, owner_pubkey,
                url=f"http://testserver/api/workspaces/{WORKSPACE_SLUG}/invites", method="POST",
            ),
            json={},
        )
        assert create_invite.status_code == 200
        code = create_invite.json()["code"]

        for sk, pubkey in ((member_sk, member_pubkey), (outsider_sk, outsider_pubkey)):
            redeem = client.post(
                f"/api/invites/{code}/redeem",
                headers=nostr_auth_headers(
                    sk, pubkey, url=f"http://testserver/api/invites/{code}/redeem", method="POST"
                ),
            )
            assert redeem.status_code == 200

        create_channel = client.post(
            f"/api/workspaces/{WORKSPACE_SLUG}/channels",
            headers=nostr_auth_headers(
                owner_sk, owner_pubkey,
                url=f"http://testserver/api/workspaces/{WORKSPACE_SLUG}/channels", method="POST",
            ),
            json={"name": "general"},
        )
        assert create_channel.status_code == 200
        channel_id = create_channel.json()["id"]

        add_member = client.post(
            f"/api/workspaces/{WORKSPACE_SLUG}/channels/{channel_id}/members",
            headers=nostr_auth_headers(
                owner_sk, owner_pubkey,
                url=f"http://testserver/api/workspaces/{WORKSPACE_SLUG}/channels/{channel_id}/members",
                method="POST",
            ),
            json={"pubkey": member_pubkey},
        )
        assert add_member.status_code == 200
        # outsider stays a Workspace Member, never joins the Channel.

        # --- Relay: both connect and subscribe to the channel; only the
        # member should ever receive the message the owner posts. ---
        with (
            client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as member_ws,
            client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as outsider_ws,
            client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as owner_ws,
        ):

            def authenticate(
                ws: WebSocketTestSession, sk: PrivateKey, pubkey: str
            ) -> None:
                challenge = ws.receive_json()[1]
                auth_event = sign_event(
                    sk, pubkey=pubkey, created_at=int(time.time()), kind=22242,
                    tags=[
                        ["relay", f"ws://testserver/relay/{WORKSPACE_SLUG}"],
                        ["challenge", challenge],
                    ],
                )
                ws.send_json(["AUTH", auth_event])
                ok = ws.receive_json()
                assert ok[2] is True, ok

            authenticate(member_ws, member_sk, member_pubkey)
            authenticate(outsider_ws, outsider_sk, outsider_pubkey)
            authenticate(owner_ws, owner_sk, owner_pubkey)

            member_ws.send_json(["REQ", "sub1", {"kinds": [9]}])
            member_ws.receive_json()  # EOSE (nothing stored yet)
            outsider_ws.send_json(["REQ", "sub1", {"kinds": [9]}])
            outsider_ws.receive_json()  # EOSE

            message = sign_event(
                owner_sk, pubkey=owner_pubkey, created_at=int(time.time()), kind=9,
                tags=[["h", channel_id]], content="hello, channel",
            )
            owner_ws.send_json(["EVENT", message])
            publish_ok = owner_ws.receive_json()
            assert publish_ok == ["OK", message["id"], True, ""]

            received = member_ws.receive_json()
            assert received == ["EVENT", "sub1", message]

            # The outsider is not a Channel Member: a fresh, targeted query
            # for the exact same event returns only EOSE, never the event.
            outsider_ws.send_json(["REQ", "sub2", {"ids": [message["id"]]}])
            outsider_result = outsider_ws.receive_json()
            assert outsider_result[0] == "EOSE"

        # --- REST: remove the member; their relay connection must close. ---
        remove = client.delete(
            f"/api/workspaces/{WORKSPACE_SLUG}/members/{member_pubkey}",
            headers=nostr_auth_headers(
                owner_sk, owner_pubkey,
                url=f"http://testserver/api/workspaces/{WORKSPACE_SLUG}/members/{member_pubkey}",
                method="DELETE",
            ),
        )
        assert remove.status_code == 200

        with client.websocket_connect(f"/relay/{WORKSPACE_SLUG}") as reconnected_member_ws:
            challenge = reconnected_member_ws.receive_json()[1]
            auth_event = sign_event(
                member_sk, pubkey=member_pubkey, created_at=int(time.time()), kind=22242,
                tags=[
                    ["relay", f"ws://testserver/relay/{WORKSPACE_SLUG}"],
                    ["challenge", challenge],
                ],
            )
            reconnected_member_ws.send_json(["AUTH", auth_event])
            ok = reconnected_member_ws.receive_json()
            assert ok[2] is True  # still cryptographically valid...
            reconnected_member_ws.send_json(["REQ", "sub2", {"kinds": [9]}])
            closed = reconnected_member_ws.receive_json()
            assert closed[0] == "CLOSED"
            assert closed[2].startswith("restricted:")  # ...but no longer a member

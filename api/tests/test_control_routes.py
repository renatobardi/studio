"""RED: the control-plane REST API — ticket #3's Account, Workspace,
Invite, Workspace Members, Channels endpoints, exercised over real HTTP
against a real repository (SurrealDB) and a fake FirebaseVerifier.
"""

import base64
import json
import time
from collections.abc import AsyncIterator

import pytest
from coincurve import PrivateKey
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from support import new_keypair, sign_event

from studio_api.auth import AuthError
from studio_api.control.repository import ControlPlaneRepository
from studio_api.control.routes import router
from studio_api.nostr.store import EventStore

SERVER_SECRET = "test-server-secret"


class _FakeFirebaseVerifier:
    def verify(self, token: str) -> tuple[str, str]:
        if not token.startswith("valid:"):
            raise AuthError("bad token")
        uid = token.removeprefix("valid:")
        return uid, f"{uid}@example.com"


def make_app(store: EventStore) -> tuple[FastAPI, ControlPlaneRepository]:
    repo = ControlPlaneRepository(store.raw, event_store=store, server_secret=SERVER_SECRET)
    app = FastAPI()
    app.state.repo = repo
    app.state.firebase_verifier = _FakeFirebaseVerifier()
    app.state.connection_registry = None
    app.include_router(router)
    return app, repo


def firebase_header(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer valid:{uid}"}


def nostr_header(sk: PrivateKey, pubkey: str, *, url: str, method: str) -> dict[str, str]:
    event = sign_event(
        sk, pubkey=pubkey, created_at=int(time.time()), kind=27235,
        tags=[["u", url], ["method", method]],
    )
    encoded = base64.b64encode(json.dumps(event).encode()).decode("ascii")
    return {"Authorization": f"Nostr {encoded}"}


@pytest.fixture
async def client(store: EventStore) -> AsyncIterator[AsyncClient]:
    app, _repo = make_app(store)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestAccount:
    async def test_getting_the_account_creates_it_lazily(self, client: AsyncClient) -> None:
        response = await client.get("/api/account", headers=firebase_header("uid1"))

        assert response.status_code == 200
        body = response.json()
        assert body["uid"] == "uid1"
        assert body["email"] == "uid1@example.com"
        assert body["pubkey"] is None

    async def test_getting_the_account_twice_is_idempotent(self, client: AsyncClient) -> None:
        first = await client.get("/api/account", headers=firebase_header("uid1"))
        second = await client.get("/api/account", headers=firebase_header("uid1"))

        assert first.json() == second.json()

    async def test_linking_identity_with_a_valid_proof(self, client: AsyncClient) -> None:
        sk, pubkey = new_keypair()
        proof_headers = nostr_header(
            sk, pubkey, url="http://test/api/account/link-identity", method="POST"
        )
        proof_event = json.loads(
            base64.b64decode(proof_headers["Authorization"].removeprefix("Nostr "))
        )

        response = await client.post(
            "/api/account/link-identity",
            headers=firebase_header("uid1"),
            json={"proof": proof_event},
        )

        assert response.status_code == 200
        assert response.json()["pubkey"] == pubkey

    async def test_linking_with_a_bad_proof_is_rejected(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/account/link-identity",
            headers=firebase_header("uid1"),
            json={"proof": {"id": "x", "pubkey": "y", "created_at": 1, "kind": 1, "tags": [], "content": "", "sig": "z"}},
        )

        assert response.status_code == 400


class TestKeyBackup:
    async def test_upload_then_download_round_trips(self, client: AsyncClient) -> None:
        blob_b64 = base64.b64encode(b"opaque-age-bytes").decode("ascii")
        await client.put(
            "/api/account/key-backup", headers=firebase_header("uid1"),
            json={"blob_base64": blob_b64},
        )

        response = await client.get("/api/account/key-backup", headers=firebase_header("uid1"))

        assert response.status_code == 200
        assert base64.b64decode(response.json()["blob_base64"]) == b"opaque-age-bytes"

    async def test_a_different_account_has_no_access_to_it(self, client: AsyncClient) -> None:
        blob_b64 = base64.b64encode(b"owner-only").decode("ascii")
        await client.put(
            "/api/account/key-backup", headers=firebase_header("owner-uid"),
            json={"blob_base64": blob_b64},
        )

        response = await client.get(
            "/api/account/key-backup", headers=firebase_header("other-uid")
        )

        assert response.status_code == 404


class TestWorkspace:
    async def test_creating_a_workspace_makes_the_caller_the_owner(
        self, client: AsyncClient
    ) -> None:
        sk, pubkey = new_keypair()
        headers = nostr_header(sk, pubkey, url="http://test/api/workspaces", method="POST")

        response = await client.post(
            "/api/workspaces", headers=headers, json={"slug": "family", "name": "Family"}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["role"] == "owner"
        assert body["relay_url"] == "ws://test/relay/family"

    async def test_getting_by_slug_returns_the_callers_role(self, client: AsyncClient) -> None:
        sk, pubkey = new_keypair()
        create_headers = nostr_header(sk, pubkey, url="http://test/api/workspaces", method="POST")
        await client.post(
            "/api/workspaces", headers=create_headers, json={"slug": "family", "name": "Family"}
        )
        get_headers = nostr_header(
            sk, pubkey, url="http://test/api/workspaces/family", method="GET"
        )

        response = await client.get("/api/workspaces/family", headers=get_headers)

        assert response.status_code == 200
        assert response.json()["role"] == "owner"

    async def test_a_non_member_cannot_get_the_workspace(self, client: AsyncClient) -> None:
        owner_sk, owner_pubkey = new_keypair()
        await client.post(
            "/api/workspaces",
            headers=nostr_header(owner_sk, owner_pubkey, url="http://test/api/workspaces", method="POST"),
            json={"slug": "family", "name": "Family"},
        )
        stranger_sk, stranger_pubkey = new_keypair()

        response = await client.get(
            "/api/workspaces/family",
            headers=nostr_header(
                stranger_sk, stranger_pubkey, url="http://test/api/workspaces/family", method="GET"
            ),
        )

        assert response.status_code == 403


class TestInviteAndMembers:
    async def _create_workspace(self, client: AsyncClient) -> tuple[PrivateKey, str]:
        sk, pubkey = new_keypair()
        await client.post(
            "/api/workspaces",
            headers=nostr_header(sk, pubkey, url="http://test/api/workspaces", method="POST"),
            json={"slug": "family", "name": "Family"},
        )
        return sk, pubkey

    async def test_creating_an_invite_requires_workspace_manager(
        self, client: AsyncClient
    ) -> None:
        await self._create_workspace(client)
        stranger_sk, stranger_pubkey = new_keypair()

        response = await client.post(
            "/api/workspaces/family/invites",
            headers=nostr_header(
                stranger_sk, stranger_pubkey,
                url="http://test/api/workspaces/family/invites", method="POST",
            ),
            json={},
        )

        assert response.status_code == 403

    async def test_owner_creates_lists_and_revokes_an_invite(self, client: AsyncClient) -> None:
        sk, pubkey = await self._create_workspace(client)
        create = await client.post(
            "/api/workspaces/family/invites",
            headers=nostr_header(
                sk, pubkey, url="http://test/api/workspaces/family/invites", method="POST"
            ),
            json={"role": "member"},
        )
        assert create.status_code == 200
        code = create.json()["code"]

        listed = await client.get(
            "/api/workspaces/family/invites",
            headers=nostr_header(
                sk, pubkey, url="http://test/api/workspaces/family/invites", method="GET"
            ),
        )
        assert [i["code"] for i in listed.json()] == [code]

        revoke = await client.delete(
            f"/api/workspaces/family/invites/{code}",
            headers=nostr_header(
                sk, pubkey, url=f"http://test/api/workspaces/family/invites/{code}", method="DELETE"
            ),
        )
        assert revoke.status_code == 200

        preview = await client.get(f"/api/invites/{code}")
        assert preview.json() == {"workspace_name": "Family", "valid": False}

    async def test_preview_of_an_unknown_code(self, client: AsyncClient) -> None:
        response = await client.get("/api/invites/does-not-exist")

        assert response.json() == {"workspace_name": "", "valid": False}

    async def test_redeeming_an_invite_creates_a_member_then_can_be_managed(
        self, client: AsyncClient
    ) -> None:
        owner_sk, owner_pubkey = await self._create_workspace(client)
        create = await client.post(
            "/api/workspaces/family/invites",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/invites", method="POST"
            ),
            json={"role": "member"},
        )
        code = create.json()["code"]

        newcomer_sk, newcomer_pubkey = new_keypair()
        redeem = await client.post(
            f"/api/invites/{code}/redeem",
            headers=nostr_header(
                newcomer_sk, newcomer_pubkey,
                url=f"http://test/api/invites/{code}/redeem", method="POST",
            ),
        )
        assert redeem.status_code == 200
        assert redeem.json()["role"] == "member"
        assert redeem.json()["relay_url"] == "ws://test/relay/family"

        members = await client.get(
            "/api/workspaces/family/members",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/members", method="GET"
            ),
        )
        assert {m["pubkey"] for m in members.json()} == {owner_pubkey, newcomer_pubkey}

        promote = await client.patch(
            f"/api/workspaces/family/members/{newcomer_pubkey}",
            headers=nostr_header(
                owner_sk, owner_pubkey,
                url=f"http://test/api/workspaces/family/members/{newcomer_pubkey}", method="PATCH",
            ),
            json={"role": "admin"},
        )
        assert promote.json()["role"] == "admin"

        remove = await client.delete(
            f"/api/workspaces/family/members/{newcomer_pubkey}",
            headers=nostr_header(
                owner_sk, owner_pubkey,
                url=f"http://test/api/workspaces/family/members/{newcomer_pubkey}", method="DELETE",
            ),
        )
        assert remove.status_code == 200

    async def test_removing_the_owner_is_rejected(self, client: AsyncClient) -> None:
        sk, pubkey = await self._create_workspace(client)

        response = await client.delete(
            f"/api/workspaces/family/members/{pubkey}",
            headers=nostr_header(
                sk, pubkey, url=f"http://test/api/workspaces/family/members/{pubkey}", method="DELETE"
            ),
        )

        assert response.status_code == 400

    async def test_changing_the_owners_role_is_rejected(self, client: AsyncClient) -> None:
        sk, pubkey = await self._create_workspace(client)

        response = await client.patch(
            f"/api/workspaces/family/members/{pubkey}",
            headers=nostr_header(
                sk, pubkey, url=f"http://test/api/workspaces/family/members/{pubkey}", method="PATCH"
            ),
            json={"role": "member"},
        )

        assert response.status_code == 400


class TestChannels:
    async def _create_workspace(self, client: AsyncClient) -> tuple[PrivateKey, str]:
        sk, pubkey = new_keypair()
        await client.post(
            "/api/workspaces",
            headers=nostr_header(sk, pubkey, url="http://test/api/workspaces", method="POST"),
            json={"slug": "family", "name": "Family"},
        )
        return sk, pubkey

    async def test_owner_creates_a_channel(self, client: AsyncClient) -> None:
        sk, pubkey = await self._create_workspace(client)

        response = await client.post(
            "/api/workspaces/family/channels",
            headers=nostr_header(
                sk, pubkey, url="http://test/api/workspaces/family/channels", method="POST"
            ),
            json={"name": "general"},
        )

        assert response.status_code == 200
        assert response.json()["name"] == "general"

    async def test_a_stranger_cannot_list_channels(self, client: AsyncClient) -> None:
        await self._create_workspace(client)
        stranger_sk, stranger_pubkey = new_keypair()

        response = await client.get(
            "/api/workspaces/family/channels",
            headers=nostr_header(
                stranger_sk, stranger_pubkey,
                url="http://test/api/workspaces/family/channels", method="GET",
            ),
        )

        assert response.status_code == 403

    async def test_adding_and_removing_a_channel_member(self, client: AsyncClient) -> None:
        owner_sk, owner_pubkey = await self._create_workspace(client)
        create = await client.post(
            "/api/workspaces/family/channels",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/channels", method="POST"
            ),
            json={"name": "general"},
        )
        channel_id = create.json()["id"]
        invite = await client.post(
            "/api/workspaces/family/invites",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/invites", method="POST"
            ),
            json={},
        )
        code = invite.json()["code"]
        member_sk, member_pubkey = new_keypair()
        await client.post(
            f"/api/invites/{code}/redeem",
            headers=nostr_header(
                member_sk, member_pubkey, url=f"http://test/api/invites/{code}/redeem", method="POST"
            ),
        )

        add_url = f"http://test/api/workspaces/family/channels/{channel_id}/members"
        add = await client.post(
            f"/api/workspaces/family/channels/{channel_id}/members",
            headers=nostr_header(owner_sk, owner_pubkey, url=add_url, method="POST"),
            json={"pubkey": member_pubkey},
        )
        assert add.status_code == 200

        remove_url = f"http://test/api/workspaces/family/channels/{channel_id}/members/{member_pubkey}"
        remove = await client.delete(
            f"/api/workspaces/family/channels/{channel_id}/members/{member_pubkey}",
            headers=nostr_header(owner_sk, owner_pubkey, url=remove_url, method="DELETE"),
        )
        assert remove.status_code == 200

    async def test_a_channel_member_lists_channel_members(self, client: AsyncClient) -> None:
        owner_sk, owner_pubkey = await self._create_workspace(client)
        create = await client.post(
            "/api/workspaces/family/channels",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/channels", method="POST"
            ),
            json={"name": "general"},
        )
        channel_id = create.json()["id"]
        invite = await client.post(
            "/api/workspaces/family/invites",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/invites", method="POST"
            ),
            json={},
        )
        code = invite.json()["code"]
        member_sk, member_pubkey = new_keypair()
        await client.post(
            f"/api/invites/{code}/redeem",
            headers=nostr_header(
                member_sk, member_pubkey, url=f"http://test/api/invites/{code}/redeem", method="POST"
            ),
        )
        add_url = f"http://test/api/workspaces/family/channels/{channel_id}/members"
        await client.post(
            f"/api/workspaces/family/channels/{channel_id}/members",
            headers=nostr_header(owner_sk, owner_pubkey, url=add_url, method="POST"),
            json={"pubkey": member_pubkey},
        )

        list_url = f"http://test/api/workspaces/family/channels/{channel_id}/members"
        response = await client.get(
            f"/api/workspaces/family/channels/{channel_id}/members",
            headers=nostr_header(member_sk, member_pubkey, url=list_url, method="GET"),
        )

        assert response.status_code == 200
        by_pubkey = {m["pubkey"]: m["role"] for m in response.json()}
        assert by_pubkey == {owner_pubkey: "admin", member_pubkey: "member"}

    async def test_a_non_member_cannot_list_channel_members(self, client: AsyncClient) -> None:
        owner_sk, owner_pubkey = await self._create_workspace(client)
        create = await client.post(
            "/api/workspaces/family/channels",
            headers=nostr_header(
                owner_sk, owner_pubkey, url="http://test/api/workspaces/family/channels", method="POST"
            ),
            json={"name": "general"},
        )
        channel_id = create.json()["id"]
        stranger_sk, stranger_pubkey = new_keypair()

        list_url = f"http://test/api/workspaces/family/channels/{channel_id}/members"
        response = await client.get(
            f"/api/workspaces/family/channels/{channel_id}/members",
            headers=nostr_header(stranger_sk, stranger_pubkey, url=list_url, method="GET"),
        )

        assert response.status_code == 403

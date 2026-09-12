"""RED: the media API — `PUT /media/upload` and `GET /media/<sha256>[.ext]`
(ticket #6), over real HTTP, against a real ControlPlaneRepository/
MediaRepository (SurrealDB) and a real MinIO (see test_minio_connectivity.py).
"""

import base64
import hashlib
import json
import os
import time
import uuid

import httpx
import pytest
from coincurve import PrivateKey
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from support import new_keypair, sign_event

from studio_api.control.repository import ControlPlaneRepository
from studio_api.media.repository import MediaRepository
from studio_api.media.routes import router
from studio_api.media.storage import ObjectStorage
from studio_api.nostr.model import NostrEvent
from studio_api.nostr.store import EventStore

SERVER_SECRET = "test-server-secret"
WORKSPACE_SLUG = "acme"
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://localhost:9010")
MINIO_ROOT_USER = os.environ.get("MINIO_ROOT_USER", "studio")
MINIO_ROOT_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "devpassword")

JPEG_BYTES = b"\xff\xd8\xff\xe0fake-jpeg-bytes-for-testing"


def blossom_header(
    sk: PrivateKey,
    pubkey: str,
    *,
    action: str,
    sha256: str | None = None,
    expiration: int | None = None,
    recipients: list[str] | None = None,
) -> dict[str, str]:
    tags = [["t", action], ["expiration", str(expiration or int(time.time()) + 60)]]
    if sha256 is not None:
        tags.append(["x", sha256])
    for recipient in recipients or []:
        tags.append(["p", recipient])
    event = sign_event(sk, pubkey=pubkey, created_at=int(time.time()), kind=24242, tags=tags)
    encoded = base64.b64encode(json.dumps(event).encode()).decode("ascii")
    return {"Authorization": f"Nostr {encoded}"}


def nip98_header(sk: PrivateKey, pubkey: str, *, url: str, method: str) -> dict[str, str]:
    event: NostrEvent = sign_event(
        sk,
        pubkey=pubkey,
        created_at=int(time.time()),
        kind=27235,
        tags=[["u", url], ["method", method]],
    )
    encoded = base64.b64encode(json.dumps(event).encode()).decode("ascii")
    return {"Authorization": f"Nostr {encoded}"}


@pytest.fixture
def control_repo(store: EventStore) -> ControlPlaneRepository:
    return ControlPlaneRepository(store.raw, event_store=store, server_secret=SERVER_SECRET)


@pytest.fixture
def media_repo(store: EventStore, control_repo: ControlPlaneRepository) -> MediaRepository:
    return MediaRepository(store.raw, authorizer=control_repo)


@pytest.fixture
async def storage() -> ObjectStorage:
    object_storage = ObjectStorage(
        endpoint_url=MINIO_ENDPOINT,
        access_key=MINIO_ROOT_USER,
        secret_key=MINIO_ROOT_PASSWORD,
        bucket=f"test-{uuid.uuid4().hex}",
    )
    await object_storage.ensure_bucket()
    return object_storage


@pytest.fixture
async def client(
    control_repo: ControlPlaneRepository, media_repo: MediaRepository, storage: ObjectStorage
) -> AsyncClient:
    app = FastAPI()
    app.state.repo = control_repo
    app.state.media_repo = media_repo
    app.state.storage = storage
    app.include_router(router)
    transport = ASGITransport(app=app)
    # Matches MINIO_ENDPOINT so the app's own base_url (used to presign GET
    # redirects, see routes.py) is a real, directly-fetchable MinIO host —
    # exercising the same public-endpoint presigning the Caddyfile relies on.
    return AsyncClient(transport=transport, base_url=MINIO_ENDPOINT)


async def _make_workspace_member(control_repo: ControlPlaneRepository, pubkey: str) -> None:
    if await control_repo.get_workspace(WORKSPACE_SLUG) is None:
        await control_repo.create_workspace(slug=WORKSPACE_SLUG, name="Acme", owner_pubkey=pubkey)
        return
    invite = await control_repo.create_invite(
        workspace_slug=WORKSPACE_SLUG,
        role="member",
        expires_at=None,
        max_uses=None,
        created_by=pubkey,
    )
    await control_repo.redeem_invite(code=invite.code, pubkey=pubkey, now=int(time.time()))


class TestUpload:
    async def test_a_member_of_any_hosted_workspace_can_upload(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        """Ticket #45: the server hosts many Workspaces and blobs are shared
        across it (/media is server-wide), so upload asks whether this pubkey
        is a Workspace Member here at all — not of one configured slug."""
        sk, pubkey = new_keypair()
        await control_repo.create_workspace(
            slug="book-club", name="Book Club", owner_pubkey=pubkey
        )
        sha256 = hashlib.sha256(JPEG_BYTES).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256=sha256),
                "content-type": "image/jpeg",
            },
            content=JPEG_BYTES,
        )

        assert response.status_code == 200

    async def test_a_workspace_member_can_upload_an_image(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        sha256 = hashlib.sha256(JPEG_BYTES).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256=sha256),
                "content-type": "image/jpeg",
            },
            content=JPEG_BYTES,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["sha256"] == sha256
        assert body["size"] == len(JPEG_BYTES)
        assert body["type"] == "image/jpeg"
        assert body["url"].endswith(f"/media/{sha256}")

    async def test_a_non_member_is_rejected(self, client: AsyncClient) -> None:
        sk, pubkey = new_keypair()
        sha256 = hashlib.sha256(JPEG_BYTES).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256=sha256),
                "content-type": "image/jpeg",
            },
            content=JPEG_BYTES,
        )

        assert response.status_code == 403

    async def test_a_non_image_mime_type_is_rejected(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        body_bytes = b"not an image"
        sha256 = hashlib.sha256(body_bytes).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256=sha256),
                "content-type": "text/plain",
            },
            content=body_bytes,
        )

        assert response.status_code == 415

    async def test_an_oversized_upload_is_rejected(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        oversized = b"x" * (10 * 1024 * 1024 + 1)
        sha256 = hashlib.sha256(oversized).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256=sha256),
                "content-type": "image/jpeg",
            },
            content=oversized,
        )

        assert response.status_code == 413

    async def test_a_sha256_mismatch_is_rejected(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256="f" * 64),
                "content-type": "image/jpeg",
            },
            content=JPEG_BYTES,
        )

        assert response.status_code == 400

    async def test_encrypted_dm_photo_bytes_are_accepted_as_octet_stream(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        ciphertext = b"nip44-ciphertext-not-a-real-image"
        sha256 = hashlib.sha256(ciphertext).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(sk, pubkey, action="upload", sha256=sha256),
                "content-type": "application/octet-stream",
            },
            content=ciphertext,
        )

        assert response.status_code == 200
        assert response.json()["type"] == "application/octet-stream"

    async def test_an_expired_auth_event_is_rejected(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        sha256 = hashlib.sha256(JPEG_BYTES).hexdigest()

        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(
                    sk, pubkey, action="upload", sha256=sha256, expiration=int(time.time()) - 1
                ),
                "content-type": "image/jpeg",
            },
            content=JPEG_BYTES,
        )

        assert response.status_code == 401


class TestGet:
    async def _upload(
        self,
        client: AsyncClient,
        sk: PrivateKey,
        pubkey: str,
        *,
        data: bytes = JPEG_BYTES,
        recipients: list[str] | None = None,
    ) -> str:
        sha256 = hashlib.sha256(data).hexdigest()
        response = await client.put(
            "/media/upload",
            headers={
                **blossom_header(
                    sk, pubkey, action="upload", sha256=sha256, recipients=recipients
                ),
                "content-type": "image/jpeg",
            },
            content=data,
        )
        assert response.status_code == 200
        return sha256

    async def test_the_uploader_can_fetch_their_own_blob(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        sha256 = await self._upload(client, sk, pubkey)

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(sk, pubkey, action="get"),
            follow_redirects=False,
        )

        assert response.status_code == 302
        async with httpx.AsyncClient() as raw:
            fetched = await raw.get(response.headers["location"])
        assert fetched.content == JPEG_BYTES

    async def test_the_uploader_can_authenticate_with_nip98(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)
        sha256 = await self._upload(client, sk, pubkey)

        response = await client.get(
            f"/media/{sha256}",
            headers=nip98_header(sk, pubkey, url=f"{MINIO_ENDPOINT}/media/{sha256}", method="GET"),
            follow_redirects=False,
        )

        assert response.status_code == 302

    async def test_an_unrelated_workspace_member_cannot_fetch_it(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        sha256 = await self._upload(client, uploader_sk, uploader_pubkey)

        other_sk, other_pubkey = new_keypair()
        await _make_workspace_member(control_repo, other_pubkey)
        channel = await control_repo.create_channel(
            workspace_slug=WORKSPACE_SLUG,
            name="general",
            about="",
            private=False,
            created_by=uploader_pubkey,
        )
        await control_repo.add_channel_member(channel_id=channel.id, pubkey=other_pubkey)

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(other_sk, other_pubkey, action="get"),
        )

        assert response.status_code == 403

    async def test_a_channel_member_of_the_referencing_channel_can_fetch_it(
        self, client: AsyncClient, control_repo: ControlPlaneRepository, media_repo: MediaRepository
    ) -> None:
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        sha256 = await self._upload(client, uploader_sk, uploader_pubkey)

        channel = await control_repo.create_channel(
            workspace_slug=WORKSPACE_SLUG,
            name="general",
            about="",
            private=False,
            created_by=uploader_pubkey,
        )
        member_sk, member_pubkey = new_keypair()
        await _make_workspace_member(control_repo, member_pubkey)
        await control_repo.add_channel_member(channel_id=channel.id, pubkey=member_pubkey)
        await media_repo.record_references(
            {
                "id": "evt1",
                "pubkey": uploader_pubkey,
                "created_at": 0,
                "kind": 9,
                "tags": [["h", channel.id], ["imeta", f"x {sha256}"]],
                "content": "",
                "sig": "s",
            },
            channel_id=channel.id,
        )

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(member_sk, member_pubkey, action="get"),
            follow_redirects=False,
        )

        assert response.status_code == 302

    async def test_a_recipient_named_in_the_upload_authorization_can_fetch_it(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        """Ticket #38: a Direct Message photo's ACL comes from the uploader's
        own signed upload event, not from the gift wrap that carries it."""
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        recipient_sk, recipient_pubkey = new_keypair()
        await _make_workspace_member(control_repo, recipient_pubkey)

        sha256 = await self._upload(
            client, uploader_sk, uploader_pubkey, recipients=[recipient_pubkey]
        )

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(recipient_sk, recipient_pubkey, action="get"),
            follow_redirects=False,
        )

        assert response.status_code == 302

    async def test_a_reference_by_a_stranger_does_not_open_the_blob_to_their_channel(
        self, client: AsyncClient, control_repo: ControlPlaneRepository, media_repo: MediaRepository
    ) -> None:
        """Ticket #38: A uploads privately, B names the hash in a Channel of
        their own — neither B nor B's Channel gains anything by it."""
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        sha256 = await self._upload(client, uploader_sk, uploader_pubkey)

        stranger_sk, stranger_pubkey = new_keypair()
        await _make_workspace_member(control_repo, stranger_pubkey)
        channel = await control_repo.create_channel(
            workspace_slug=WORKSPACE_SLUG,
            name="stranger-channel",
            about="",
            private=False,
            created_by=stranger_pubkey,
        )
        await media_repo.record_references(
            {
                "id": "evt1",
                "pubkey": stranger_pubkey,
                "created_at": 0,
                "kind": 9,
                "tags": [["h", channel.id], ["imeta", f"x {sha256}"]],
                "content": "",
                "sig": "s",
            },
            channel_id=channel.id,
        )

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(stranger_sk, stranger_pubkey, action="get"),
        )

        assert response.status_code == 403
        assert await media_repo.channels_referencing(sha256) == []

    async def test_removal_from_the_workspace_blocks_the_uploaders_own_get(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        _owner_sk, owner_pubkey = new_keypair()
        await _make_workspace_member(control_repo, owner_pubkey)
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        sha256 = await self._upload(client, uploader_sk, uploader_pubkey)

        await control_repo.remove_workspace_member(slug=WORKSPACE_SLUG, pubkey=uploader_pubkey)

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(uploader_sk, uploader_pubkey, action="get"),
        )

        assert response.status_code == 403

    async def test_removal_from_the_workspace_blocks_a_registered_recipients_get(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        _owner_sk, owner_pubkey = new_keypair()
        await _make_workspace_member(control_repo, owner_pubkey)
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        recipient_sk, recipient_pubkey = new_keypair()
        await _make_workspace_member(control_repo, recipient_pubkey)
        sha256 = await self._upload(
            client, uploader_sk, uploader_pubkey, recipients=[recipient_pubkey]
        )

        await control_repo.remove_workspace_member(slug=WORKSPACE_SLUG, pubkey=recipient_pubkey)

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(recipient_sk, recipient_pubkey, action="get"),
        )

        assert response.status_code == 403

    async def test_a_workspace_member_not_named_as_a_recipient_cannot_fetch_it(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        uploader_sk, uploader_pubkey = new_keypair()
        await _make_workspace_member(control_repo, uploader_pubkey)
        sha256 = await self._upload(client, uploader_sk, uploader_pubkey)

        other_sk, other_pubkey = new_keypair()
        await _make_workspace_member(control_repo, other_pubkey)

        response = await client.get(
            f"/media/{sha256}",
            headers=blossom_header(other_sk, other_pubkey, action="get"),
        )

        assert response.status_code == 403

    async def test_an_unknown_blob_is_403(
        self, client: AsyncClient, control_repo: ControlPlaneRepository
    ) -> None:
        sk, pubkey = new_keypair()
        await _make_workspace_member(control_repo, pubkey)

        response = await client.get(
            f"/media/{'0' * 64}", headers=blossom_header(sk, pubkey, action="get")
        )

        assert response.status_code == 403

"""The Blossom-shaped media API (ticket #6): `PUT /media/upload` and
`GET /media/<sha256>[.ext]`, on top of the S3-compatible ObjectStorage and
the MediaRepository's blob/channel-reference bookkeeping."""

import hashlib
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse

from studio_api.auth import (
    BLOSSOM_KIND,
    AuthError,
    decode_nostr_authorization_event,
    verify_blossom_auth,
    verify_nip98,
)
from studio_api.control.repository import ControlPlaneRepository
from studio_api.media.models import BlobDescriptor
from studio_api.media.repository import MediaRepository
from studio_api.media.storage import ObjectStorage
from studio_api.nostr.model import NostrEvent, first_tag_value

router = APIRouter(prefix="/media")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
GET_URL_TTL_SECONDS = 60


def get_control_repo(request: Request) -> ControlPlaneRepository:
    return request.app.state.repo  # type: ignore[no-any-return]


def get_media_repo(request: Request) -> MediaRepository:
    return request.app.state.media_repo  # type: ignore[no-any-return]


def get_storage(request: Request) -> ObjectStorage:
    return request.app.state.storage  # type: ignore[no-any-return]


def _decode_nostr_authorization(authorization: str | None) -> NostrEvent:
    if not authorization:
        raise AuthError("missing Authorization header")
    scheme, _, value = authorization.partition(" ")
    if scheme != "Nostr":
        raise AuthError(f"unsupported authorization scheme: {scheme!r}")
    return decode_nostr_authorization_event(value)


def _resolve_get_pubkey(authorization: str | None, *, url: str, method: str, now: int) -> str:
    event = _decode_nostr_authorization(authorization)
    if event["kind"] == BLOSSOM_KIND:
        return verify_blossom_auth(event, action="get", now=now)
    return verify_nip98(event, url=url, method=method, now=now)


@router.put("/upload", responses={415: {"description": "unsupported Content-Type"}})
async def upload_blob(
    request: Request,
    authorization: str | None = Header(default=None),
    repo: ControlPlaneRepository = Depends(get_control_repo),
    media_repo: MediaRepository = Depends(get_media_repo),
    storage: ObjectStorage = Depends(get_storage),
) -> BlobDescriptor:
    now = int(time.time())
    try:
        auth_event = _decode_nostr_authorization(authorization)
        pubkey = verify_blossom_auth(auth_event, action="upload", now=now)
    except AuthError as error:
        raise HTTPException(401, str(error)) from error

    if not await repo.is_workspace_member_anywhere(pubkey):
        raise HTTPException(403, "not a Workspace Member")

    content_type = request.headers.get("content-type", "")
    # `application/octet-stream` covers a Direct Message photo (ticket #7):
    # its bytes are NIP-44 ciphertext, so no real image MIME type is ever
    # visible to the server (ADR-0003) — the true type lives only inside the
    # encrypted rumor's own `imeta` tag.
    if not content_type.startswith("image/") and content_type != "application/octet-stream":
        raise HTTPException(415, "only image MIME types (or opaque encrypted bytes) are accepted")

    content_length = request.headers.get("content-length")
    if content_length is not None and int(content_length) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file exceeds the 10 MB limit")

    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file exceeds the 10 MB limit")

    sha256 = hashlib.sha256(body).hexdigest()
    if first_tag_value(auth_event, "x") != sha256:
        raise HTTPException(400, "sha256 does not match the uploaded content")

    await storage.put_object(sha256, body, content_type=content_type)
    await media_repo.create_blob(
        sha256=sha256, pubkey=pubkey, mime=content_type, size=len(body), storage_key=sha256
    )
    url = f"{str(request.base_url).rstrip('/')}/media/{sha256}"
    return BlobDescriptor(url=url, sha256=sha256, size=len(body), type=content_type)


@router.get("/{sha256_with_ext}")
async def get_blob(
    sha256_with_ext: str,
    request: Request,
    authorization: str | None = Header(default=None),
    repo: ControlPlaneRepository = Depends(get_control_repo),
    media_repo: MediaRepository = Depends(get_media_repo),
    storage: ObjectStorage = Depends(get_storage),
) -> RedirectResponse:
    sha256 = sha256_with_ext.partition(".")[0]
    now = int(time.time())
    try:
        pubkey = _resolve_get_pubkey(
            authorization, url=str(request.url), method=request.method, now=now
        )
    except AuthError as error:
        raise HTTPException(401, str(error)) from error

    blob = await media_repo.get_blob(sha256)
    allowed = blob is not None and blob.pubkey == pubkey
    if blob is not None and not allowed:
        for channel_id in await media_repo.channels_referencing(sha256):
            if await repo.is_channel_member(channel_id, pubkey):
                allowed = True
                break
    if blob is not None and not allowed:
        allowed = pubkey in await media_repo.dm_recipients(sha256)
    if not allowed:
        raise HTTPException(403, "forbidden")

    assert blob is not None
    public_endpoint_url = str(request.base_url).rstrip("/")
    url = await storage.presigned_get_url(
        blob.storage_key, expires_in=GET_URL_TTL_SECONDS, public_endpoint_url=public_endpoint_url
    )
    return RedirectResponse(url, status_code=302)

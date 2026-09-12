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
from studio_api.nostr.model import NostrEvent, all_tag_values, first_tag_value

router = APIRouter(prefix="/media")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
GET_URL_TTL_SECONDS = 60


def get_control_repo(request: Request) -> ControlPlaneRepository:
    return request.app.state.repo  # type: ignore[no-any-return]


def get_media_repo(request: Request) -> MediaRepository:
    return request.app.state.media_repo  # type: ignore[no-any-return]


def get_storage(request: Request) -> ObjectStorage:
    return request.app.state.storage  # type: ignore[no-any-return]


def _is_pubkey(value: str) -> bool:
    return len(value) == 64 and all(c in "0123456789abcdef" for c in value)


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


@router.put(
    "/upload",
    responses={
        400: {"description": "sha256 or recipients do not match the request"},
        415: {"description": "unsupported Content-Type"},
    },
)
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

    # Ticket #38: who may read a Direct Message photo is declared here, in
    # the same signed event that authorizes the upload and pins its `x` to
    # these bytes — so the ACL cannot be tampered with apart from the
    # authorization, the way a relayed gift wrap's tags could be.
    recipients = all_tag_values(auth_event, "p")
    if any(not _is_pubkey(recipient) for recipient in recipients):
        raise HTTPException(400, "p tags must be 32-byte hex pubkeys")

    blob = await media_repo.get_blob(sha256)
    if blob is None:
        await storage.put_object(sha256, body, content_type=content_type)
        await media_repo.create_blob(
            sha256=sha256, pubkey=pubkey, mime=content_type, size=len(body), storage_key=sha256
        )
    elif blob.pubkey != pubkey:
        # Ticket #38: the same bytes offered again are the same blob. Holding
        # a copy proves this uploader may read it — it never hands them the
        # blob, which keeps the uploader it already has.
        recipients = [pubkey, *recipients]
    if recipients:
        await media_repo.record_dm_recipients(sha256=sha256, pubkeys=recipients)
    url = f"{str(request.base_url).rstrip('/')}/media/{sha256}"
    return BlobDescriptor(url=url, sha256=sha256, size=len(body), type=content_type)


@router.get("/{sha256_with_ext}", responses={403: {"description": "no right to this blob"}})
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

    # Ticket #38: losing the Workspace revokes the blob, whatever the older
    # grant was — including the uploader's own. Already-issued presigned
    # URLs stay valid for their remaining TTL; this stops new ones.
    if not await repo.is_workspace_member_anywhere(pubkey):
        raise HTTPException(403, "forbidden")

    blob = await media_repo.readable_blob(sha256, pubkey)
    if blob is None:
        raise HTTPException(403, "forbidden")

    public_endpoint_url = str(request.base_url).rstrip("/")
    url = await storage.presigned_get_url(
        blob.storage_key, expires_in=GET_URL_TTL_SECONDS, public_endpoint_url=public_endpoint_url
    )
    return RedirectResponse(url, status_code=302)

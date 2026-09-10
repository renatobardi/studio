"""The control-plane REST API (ticket #3): Account, Workspace, Invite,
Workspace Members, Channels — all requiring a caller resolved by
`require_caller` (Firebase ID token or NIP-98, ticket #2)."""

import base64
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from studio_api.auth import (
    AuthError,
    CallerIdentity,
    FirebaseCaller,
    NostrCaller,
    require_caller,
    verify_nip98,
)
from studio_api.control.errors import (
    AlreadyLinkedError,
    CannotRemoveOwnerError,
    ControlPlaneError,
    InviteInvalidError,
    NotAWorkspaceMemberError,
    WorkspaceSlugTakenError,
)
from studio_api.control.repository import ControlPlaneRepository

router = APIRouter(prefix="/api")

_MANAGE_ROLES = ("owner", "admin")


def get_repo(request: Request) -> ControlPlaneRepository:
    return request.app.state.repo  # type: ignore[no-any-return]


async def _caller_pubkey(caller: CallerIdentity, repo: ControlPlaneRepository) -> str:
    if isinstance(caller, NostrCaller):
        return caller.pubkey
    account = await repo.get_account(caller.uid)
    if account is None or account.pubkey is None:
        raise HTTPException(400, "this Account has no linked Identity yet")
    return account.pubkey


async def _require_workspace_manager(
    repo: ControlPlaneRepository, slug: str, pubkey: str
) -> None:
    role = await repo.get_workspace_role(slug, pubkey)
    if role not in _MANAGE_ROLES:
        raise HTTPException(403, "requires the Workspace owner or an admin")


async def _require_channel_manager(
    repo: ControlPlaneRepository, slug: str, channel_id: str, pubkey: str
) -> None:
    if await repo.get_workspace_role(slug, pubkey) in _MANAGE_ROLES:
        return
    if await repo.get_channel_role(channel_id, pubkey) == "admin":
        return
    raise HTTPException(403, "requires a Channel admin or a Workspace admin")


_ERROR_STATUS: dict[type[ControlPlaneError], int] = {
    AlreadyLinkedError: 409,
    WorkspaceSlugTakenError: 409,
    InviteInvalidError: 410,
    CannotRemoveOwnerError: 400,
    NotAWorkspaceMemberError: 400,
}


def _control_error_to_http(error: ControlPlaneError) -> HTTPException:
    return HTTPException(_ERROR_STATUS.get(type(error), 400), str(error))


# --- Account ----------------------------------------------------------------


class AccountOut(BaseModel):
    uid: str
    email: str
    pubkey: str | None


class LinkIdentityBody(BaseModel):
    proof: dict[str, Any]
    """A signed NIP-98-style event proving control of `proof.pubkey`, with
    `u`/`method` tags matching this endpoint."""


@router.get("/account")
async def get_account(
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> AccountOut:
    if not isinstance(caller, FirebaseCaller):
        raise HTTPException(403, "only a Firebase-authenticated caller has an Account")
    account = await repo.get_account(caller.uid)
    if account is None:
        account = await repo.create_account(uid=caller.uid, email=caller.email, provider="firebase")
    return AccountOut(uid=account.uid, email=account.email, pubkey=account.pubkey)


@router.post("/account/link-identity")
async def link_identity(
    body: LinkIdentityBody,
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> AccountOut:
    if not isinstance(caller, FirebaseCaller):
        raise HTTPException(403, "only a Firebase-authenticated caller has an Account")
    try:
        pubkey = verify_nip98(
            body.proof,  # type: ignore[arg-type]
            url=str(request.url),
            method=request.method,
            now=int(time.time()),
        )
    except AuthError as error:
        raise HTTPException(400, f"invalid proof: {error}") from error

    await repo.create_account(uid=caller.uid, email=caller.email, provider="firebase")
    try:
        account = await repo.link_identity(uid=caller.uid, pubkey=pubkey)
    except ControlPlaneError as error:
        raise _control_error_to_http(error) from error
    return AccountOut(uid=account.uid, email=account.email, pubkey=account.pubkey)


# --- Key Backup ---------------------------------------------------------------


class KeyBackupBody(BaseModel):
    blob_base64: str


@router.put("/account/key-backup")
async def put_key_backup(
    body: KeyBackupBody,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> dict[str, str]:
    if not isinstance(caller, FirebaseCaller):
        raise HTTPException(403, "only a Firebase-authenticated caller has a Key Backup")
    blob = base64.b64decode(body.blob_base64)
    await repo.put_key_backup(uid=caller.uid, blob=blob)
    return {"status": "ok"}


@router.get("/account/key-backup")
async def get_key_backup(
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> KeyBackupBody:
    if not isinstance(caller, FirebaseCaller):
        raise HTTPException(403, "only a Firebase-authenticated caller has a Key Backup")
    blob = await repo.get_key_backup(caller.uid)
    if blob is None:
        raise HTTPException(404, "no Key Backup on file")
    return KeyBackupBody(blob_base64=base64.b64encode(blob).decode("ascii"))


# --- Workspace ----------------------------------------------------------------


class CreateWorkspaceBody(BaseModel):
    slug: str
    name: str


class WorkspaceOut(BaseModel):
    slug: str
    name: str
    relay_url: str
    media_url: str
    role: str


def _workspace_urls(request: Request, slug: str) -> tuple[str, str]:
    base = str(request.base_url).rstrip("/")
    ws_scheme = "wss" if base.startswith("https") else "ws"
    relay_url = f"{ws_scheme}://{request.url.netloc}/relay/{slug}"
    media_url = f"{base}/media"
    return relay_url, media_url


@router.post("/workspaces")
async def create_workspace(
    body: CreateWorkspaceBody,
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> WorkspaceOut:
    owner_pubkey = await _caller_pubkey(caller, repo)
    try:
        workspace = await repo.create_workspace(
            slug=body.slug, name=body.name, owner_pubkey=owner_pubkey
        )
    except ControlPlaneError as error:
        raise _control_error_to_http(error) from error
    relay_url, media_url = _workspace_urls(request, workspace.slug)
    return WorkspaceOut(
        slug=workspace.slug, name=workspace.name, relay_url=relay_url, media_url=media_url,
        role="owner",
    )


@router.get("/workspaces/{slug}")
async def get_workspace(
    slug: str,
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> WorkspaceOut:
    workspace = await repo.get_workspace(slug)
    if workspace is None:
        raise HTTPException(404, "no such Workspace")
    pubkey = await _caller_pubkey(caller, repo)
    role = await repo.get_workspace_role(slug, pubkey)
    if role is None:
        raise HTTPException(403, "not a Workspace Member")
    relay_url, media_url = _workspace_urls(request, slug)
    return WorkspaceOut(
        slug=workspace.slug, name=workspace.name, relay_url=relay_url, media_url=media_url, role=role
    )


# --- Invite ---------------------------------------------------------------------


class CreateInviteBody(BaseModel):
    role: str = "member"
    expires_at: int | None = None
    max_uses: int | None = None


class InviteOut(BaseModel):
    code: str
    role: str
    expires_at: int | None
    max_uses: int | None
    use_count: int
    revoked: bool


class InvitePreviewOut(BaseModel):
    workspace_name: str
    valid: bool


class WorkspaceMemberOut(BaseModel):
    pubkey: str
    role: str


@router.post("/workspaces/{slug}/invites")
async def create_invite(
    slug: str,
    body: CreateInviteBody,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> InviteOut:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    invite = await repo.create_invite(
        workspace_slug=slug, role=body.role, expires_at=body.expires_at,
        max_uses=body.max_uses, created_by=pubkey,
    )
    return InviteOut(
        code=invite.code, role=invite.role, expires_at=invite.expires_at,
        max_uses=invite.max_uses, use_count=invite.use_count, revoked=invite.revoked,
    )


@router.get("/workspaces/{slug}/invites")
async def list_invites(
    slug: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[InviteOut]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    invites = await repo.list_invites(slug)
    return [
        InviteOut(
            code=i.code, role=i.role, expires_at=i.expires_at, max_uses=i.max_uses,
            use_count=i.use_count, revoked=i.revoked,
        )
        for i in invites
    ]


@router.delete("/workspaces/{slug}/invites/{code}")
async def revoke_invite(
    slug: str,
    code: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> dict[str, str]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    await repo.revoke_invite(code)
    return {"status": "ok"}


@router.get("/invites/{code}")
async def preview_invite(
    code: str, repo: ControlPlaneRepository = Depends(get_repo)
) -> InvitePreviewOut:
    name, valid = await repo.preview_invite(code, now=int(time.time()))
    return InvitePreviewOut(workspace_name=name, valid=valid)


@router.post("/invites/{code}/redeem")
async def redeem_invite(
    code: str,
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> WorkspaceOut:
    if not isinstance(caller, NostrCaller):
        raise HTTPException(403, "redeeming an invite requires proving Identity (NIP-98)")
    invite = await repo.get_invite(code)
    if invite is None:
        raise HTTPException(404, "no such invite")
    try:
        member = await repo.redeem_invite(code=code, pubkey=caller.pubkey, now=int(time.time()))
    except ControlPlaneError as error:
        raise _control_error_to_http(error) from error
    workspace = await repo.get_workspace(member.workspace_slug)
    assert workspace is not None
    relay_url, media_url = _workspace_urls(request, workspace.slug)
    return WorkspaceOut(
        slug=workspace.slug, name=workspace.name, relay_url=relay_url, media_url=media_url,
        role=member.role,
    )


# --- Workspace Members ---------------------------------------------------------


@router.get("/workspaces/{slug}/members")
async def list_workspace_members(
    slug: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[WorkspaceMemberOut]:
    pubkey = await _caller_pubkey(caller, repo)
    if await repo.get_workspace_role(slug, pubkey) is None:
        raise HTTPException(403, "not a Workspace Member")
    members = await repo.list_workspace_members(slug)
    return [WorkspaceMemberOut(pubkey=m.pubkey, role=m.role) for m in members]


class SetRoleBody(BaseModel):
    role: str


@router.patch("/workspaces/{slug}/members/{member_pubkey}")
async def set_workspace_member_role(
    slug: str,
    member_pubkey: str,
    body: SetRoleBody,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> WorkspaceMemberOut:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    try:
        member = await repo.set_workspace_member_role(
            slug=slug, pubkey=member_pubkey, role=body.role
        )
    except ControlPlaneError as error:
        raise _control_error_to_http(error) from error
    return WorkspaceMemberOut(pubkey=member.pubkey, role=member.role)


@router.delete("/workspaces/{slug}/members/{member_pubkey}")
async def remove_workspace_member(
    slug: str,
    member_pubkey: str,
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> dict[str, str]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    try:
        await repo.remove_workspace_member(slug=slug, pubkey=member_pubkey)
    except ControlPlaneError as error:
        raise _control_error_to_http(error) from error
    registry = getattr(request.app.state, "connection_registry", None)
    if registry is not None:
        await registry.force_disconnect(member_pubkey, reason="removed from the Workspace")
    return {"status": "ok"}


# --- Channel --------------------------------------------------------------------


class CreateChannelBody(BaseModel):
    name: str
    about: str = ""
    private: bool = False


class ChannelOut(BaseModel):
    id: str
    name: str
    about: str
    private: bool


class AddChannelMemberBody(BaseModel):
    pubkey: str
    role: str = "member"


@router.post("/workspaces/{slug}/channels")
async def create_channel(
    slug: str,
    body: CreateChannelBody,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> ChannelOut:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    channel = await repo.create_channel(
        workspace_slug=slug, name=body.name, about=body.about, private=body.private,
        created_by=pubkey,
    )
    return ChannelOut(id=channel.id, name=channel.name, about=channel.about, private=channel.private)


@router.get("/workspaces/{slug}/channels")
async def list_channels(
    slug: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[ChannelOut]:
    pubkey = await _caller_pubkey(caller, repo)
    if await repo.get_workspace_role(slug, pubkey) is None:
        raise HTTPException(403, "not a Workspace Member")
    channels = await repo.list_channels_for(workspace_slug=slug, pubkey=pubkey)
    return [ChannelOut(id=c.id, name=c.name, about=c.about, private=c.private) for c in channels]


@router.post("/workspaces/{slug}/channels/{channel_id}/members")
async def add_channel_member(
    slug: str,
    channel_id: str,
    body: AddChannelMemberBody,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> dict[str, str]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_channel_manager(repo, slug, channel_id, pubkey)
    try:
        await repo.add_channel_member(channel_id=channel_id, pubkey=body.pubkey, role=body.role)
    except ControlPlaneError as error:
        raise _control_error_to_http(error) from error
    return {"status": "ok"}


@router.delete("/workspaces/{slug}/channels/{channel_id}/members/{member_pubkey}")
async def remove_channel_member(
    slug: str,
    channel_id: str,
    member_pubkey: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> dict[str, str]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_channel_manager(repo, slug, channel_id, pubkey)
    await repo.remove_channel_member(channel_id=channel_id, pubkey=member_pubkey)
    return {"status": "ok"}

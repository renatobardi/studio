"""The control-plane REST API (ticket #3): Account, Workspace, Invite,
Workspace Members, Channels — all requiring a caller resolved by
`require_caller` (Firebase ID token or NIP-98, ticket #2)."""

import base64
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

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
from studio_api.control.models import Invite, Workspace
from studio_api.control.repository import ControlPlaneRepository, invite_state

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


async def _require_workspace_member(repo: ControlPlaneRepository, slug: str, pubkey: str) -> str:
    role = await repo.get_workspace_role(slug, pubkey)
    if role is None:
        raise HTTPException(403, "not a Workspace Member")
    return role


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


async def _require_channel_member(
    repo: ControlPlaneRepository, slug: str, channel_id: str, pubkey: str
) -> None:
    if await repo.get_workspace_role(slug, pubkey) in _MANAGE_ROLES:
        return
    if await repo.get_channel_role(channel_id, pubkey) is not None:
        return
    raise HTTPException(403, "not a Channel Member")


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
    # A Key Backup belongs to the Account's Identity, and that link is
    # immutable (link_identity refuses a second pubkey). Requiring it here is
    # what stops a second onboarding from storing a backup of a fresh key over
    # the one that recovers the real Identity (#36).
    account = await repo.get_account(caller.uid)
    if account is None or account.pubkey is None:
        raise HTTPException(400, "link an Identity to this Account before storing a Key Backup")
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


# The slug namespaces every event row as `<slug>:<key>` (ticket #45) and is a
# URL path segment, so it is kebab-case only — no separator, no surprises.
WORKSPACE_SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"


class CreateWorkspaceBody(BaseModel):
    slug: str = Field(pattern=WORKSPACE_SLUG_PATTERN, max_length=64)
    name: str


class WorkspaceOut(BaseModel):
    slug: str
    name: str
    relay_url: str
    media_url: str
    role: str


def _workspace_out(request: Request, workspace: Workspace, role: str) -> WorkspaceOut:
    """One Workspace as this caller sees it: its own relay URL, the server's
    media URL, and the caller's role in it."""
    base = str(request.base_url).rstrip("/")
    ws_scheme = "wss" if base.startswith("https") else "ws"
    return WorkspaceOut(
        slug=workspace.slug,
        name=workspace.name,
        relay_url=f"{ws_scheme}://{request.url.netloc}/relay/{workspace.slug}",
        media_url=f"{base}/media",
        role=role,
    )


@router.get("/workspaces")
async def list_workspaces(
    request: Request,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[WorkspaceOut]:
    """The caller's own Workspaces. A restore on a new browser has neither an
    invite nor local state, so this is how it finds where to reconnect (#36)."""
    pubkey = await _caller_pubkey(caller, repo)
    found = await repo.list_workspaces_for(pubkey)
    return [_workspace_out(request, workspace, role) for workspace, role in found]


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
    return _workspace_out(request, workspace, "owner")


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
    role = await _require_workspace_member(repo, slug, pubkey)
    return _workspace_out(request, workspace, role)


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
    state: str
    """"active", or why it admits nobody: "revoked", "expired", "exhausted".
    Judged here, by the same rule redemption is judged by — a client deriving
    it from the fields above would be a second copy of that rule, free to
    drift from this one (#46)."""


def _invite_out(invite: Invite, *, now: int) -> InviteOut:
    return InviteOut(
        code=invite.code, role=invite.role, expires_at=invite.expires_at,
        max_uses=invite.max_uses, use_count=invite.use_count, revoked=invite.revoked,
        state=invite_state(invite, now=now),
    )


class InvitePreviewOut(BaseModel):
    workspace_name: str
    valid: bool
    reason: str | None
    """Why it cannot be used — "not_found", "revoked", "expired" or
    "exhausted" — or null when it can. Without it the client can only say
    "not valid", which reads as a typo and sends people back to the code they
    already typed correctly (#46)."""


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
    # Limits now come from the interface (#46), so limits that could never
    # admit anybody are named as the mistake they are rather than stored as an
    # invite whose only possible answer is "not valid".
    if body.expires_at is not None and body.expires_at <= int(time.time()):
        raise HTTPException(400, "that expiry is already in the past")
    if body.max_uses is not None and body.max_uses < 1:
        raise HTTPException(400, "an invite must allow at least one use")
    invite = await repo.create_invite(
        workspace_slug=slug, role=body.role, expires_at=body.expires_at,
        max_uses=body.max_uses, created_by=pubkey,
    )
    return _invite_out(invite, now=int(time.time()))


@router.get("/workspaces/{slug}/invites")
async def list_invites(
    slug: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[InviteOut]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_manager(repo, slug, pubkey)
    invites = await repo.list_invites(slug)
    now = int(time.time())
    return [_invite_out(i, now=now) for i in invites]


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
    name, reason = await repo.preview_invite(code, now=int(time.time()))
    return InvitePreviewOut(workspace_name=name, valid=reason is None, reason=reason)


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
    return _workspace_out(request, workspace, member.role)


# --- Workspace Members ---------------------------------------------------------


@router.get("/workspaces/{slug}/members")
async def list_workspace_members(
    slug: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[WorkspaceMemberOut]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_workspace_member(repo, slug, pubkey)
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
        await registry.force_disconnect(
            member_pubkey, workspace_slug=slug, reason="removed from the Workspace"
        )
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
    role: str | None = None
    """The caller's own role in this Channel, or null when they are not a
    Channel Member — a public Channel is listed either way. It is what lets
    the client offer Channel management to a Channel admin who holds no
    Workspace admin role (#42)."""


class AddChannelMemberBody(BaseModel):
    pubkey: str
    role: str = "member"


class ChannelMemberOut(BaseModel):
    pubkey: str
    role: str


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
    await _require_workspace_member(repo, slug, pubkey)
    channels = await repo.list_channels_for(workspace_slug=slug, pubkey=pubkey)
    return [
        ChannelOut(
            id=c.id, name=c.name, about=c.about, private=c.private,
            role=await repo.get_channel_role(c.id, pubkey),
        )
        for c in channels
    ]


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


@router.get("/workspaces/{slug}/channels/{channel_id}/members")
async def list_channel_members(
    slug: str,
    channel_id: str,
    caller: CallerIdentity = Depends(require_caller),
    repo: ControlPlaneRepository = Depends(get_repo),
) -> list[ChannelMemberOut]:
    pubkey = await _caller_pubkey(caller, repo)
    await _require_channel_member(repo, slug, channel_id, pubkey)
    members = await repo.list_channel_members(channel_id)
    return [ChannelMemberOut(pubkey=m.pubkey, role=m.role) for m in members]


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

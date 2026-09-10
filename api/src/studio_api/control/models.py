"""Control-plane domain objects — the server-private records from the MVP
spec, as returned by ControlPlaneRepository (never as Nostr events)."""

from pydantic import BaseModel


class Account(BaseModel):
    uid: str
    email: str
    provider: str
    pubkey: str | None = None


class Workspace(BaseModel):
    slug: str
    name: str
    owner_pubkey: str
    key_pubkey: str


class WorkspaceMember(BaseModel):
    workspace_slug: str
    pubkey: str
    role: str


class Invite(BaseModel):
    code: str
    workspace_slug: str
    role: str
    expires_at: int | None
    max_uses: int | None
    use_count: int
    revoked: bool
    created_by: str


class Channel(BaseModel):
    id: str
    workspace_slug: str
    name: str
    about: str
    private: bool
    created_by: str


class ChannelMember(BaseModel):
    channel_id: str
    pubkey: str
    role: str

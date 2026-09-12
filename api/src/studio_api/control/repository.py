"""The control-plane repository: Account, Workspace, Invite, Members,
Channels — the server-private records from the MVP spec. Every mutation
that changes membership also projects the matching NIP-43/NIP-29 event,
signed by the Workspace Key, in the same SurrealDB transaction (ADR-0002).

Shares its SurrealDB connection with the EventStore (same namespace/
database, different tables) rather than connecting twice.
"""

import secrets
from typing import Any

from coincurve import PrivateKey
from surrealdb.data.types.record_id import RecordID

from studio_api.control.errors import (
    AlreadyLinkedError,
    CannotRemoveOwnerError,
    InviteInvalidError,
    NotAWorkspaceMemberError,
    WorkspaceSlugTakenError,
)
from studio_api.control.models import (
    Account,
    Channel,
    ChannelMember,
    Invite,
    Workspace,
    WorkspaceMember,
)
from studio_api.crypto_secrets import decrypt_secret, encrypt_secret
from studio_api.db import query_or_empty as _query_or_empty
from studio_api.db import select_or_none as _select_or_none
from studio_api.nostr.model import NostrEvent
from studio_api.nostr.projection import (
    WORKSPACE_ROLES,
    build_channel_add,
    build_channel_admins,
    build_channel_members,
    build_channel_metadata,
    build_channel_remove,
    build_channel_roles,
    build_workspace_add,
    build_workspace_member_list,
    build_workspace_remove,
    build_workspace_role_definition,
)
from studio_api.nostr.store import EventStore, record_key, to_event_row


def _event_statement(
    statements: list[str], params: dict[str, Any], var: str, event: NostrEvent,
    *, workspace_slug: str,
) -> None:
    """Appends an UPSERT for one projected event, keyed exactly the way
    EventStore.publish() would key it — Workspace-namespaced, so a later REQ
    on that Workspace's relay finds the same row a client-published event
    would replace, and no other Workspace ever sees it."""
    params[f"{var}_id"] = record_key(event, workspace_slug=workspace_slug)
    params[f"{var}_row"] = to_event_row(event, workspace_slug=workspace_slug)
    statements.append(f"UPSERT type::thing('event', ${var}_id) CONTENT ${var}_row;")


def _run_in_transaction(statements: list[str], params: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    surql = "BEGIN TRANSACTION;\n" + "\n".join(statements) + "\nCOMMIT TRANSACTION;"
    return surql, params


class ControlPlaneRepository:
    def __init__(self, db: Any, *, event_store: EventStore, server_secret: str) -> None:
        self._db = db
        self._events = event_store
        self._server_secret = server_secret

    # --- Account ----------------------------------------------------------

    async def create_account(self, *, uid: str, email: str, provider: str) -> Account:
        existing = await self.get_account(uid)
        if existing is not None:
            return existing
        record_id = RecordID("account", uid)
        await self._db.create(record_id, {"email": email, "provider": provider, "pubkey": None})
        return Account(uid=uid, email=email, provider=provider, pubkey=None)

    async def get_account(self, uid: str) -> Account | None:
        row = await _select_or_none(self._db, RecordID("account", uid))
        if row is None:
            return None
        return Account(uid=uid, email=row["email"], provider=row["provider"], pubkey=row.get("pubkey"))

    async def link_identity(self, *, uid: str, pubkey: str) -> Account:
        account = await self.get_account(uid)
        if account is not None and account.pubkey is not None and account.pubkey != pubkey:
            raise AlreadyLinkedError(f"account {uid} is already linked to a different Identity")
        await self._db.merge(RecordID("account", uid), {"pubkey": pubkey})
        linked = await self.get_account(uid)
        assert linked is not None
        return linked

    # --- Key Backup ---------------------------------------------------------

    async def put_key_backup(self, *, uid: str, blob: bytes) -> None:
        await self._db.upsert(RecordID("key_backup", uid), {"blob": blob})

    async def get_key_backup(self, uid: str) -> bytes | None:
        row = await _select_or_none(self._db, RecordID("key_backup", uid))
        return row["blob"] if row is not None else None

    # --- Workspace ----------------------------------------------------------

    async def create_workspace(self, *, slug: str, name: str, owner_pubkey: str) -> Workspace:
        if await self.get_workspace(slug) is not None:
            raise WorkspaceSlugTakenError(f"workspace slug {slug!r} is already taken")

        workspace_sk = PrivateKey()
        key_pubkey = workspace_sk.public_key_xonly.format().hex()
        encrypted_key = encrypt_secret(workspace_sk.secret, server_secret=self._server_secret)

        statements: list[str] = []
        params: dict[str, Any] = {
            "slug": slug,
            "name": name,
            "owner_pubkey": owner_pubkey,
            "encrypted_key": encrypted_key,
            "key_pubkey": key_pubkey,
        }
        statements.append(
            "CREATE type::thing('workspace', $slug) SET "
            "name = $name, owner_pubkey = $owner_pubkey, "
            "encrypted_key = $encrypted_key, key_pubkey = $key_pubkey;"
        )

        params["wm_id"] = f"{slug}:{owner_pubkey}"
        params["wm_row"] = {"workspace_slug": slug, "pubkey": owner_pubkey, "role": "owner"}
        statements.append("CREATE type::thing('workspace_member', $wm_id) CONTENT $wm_row;")

        for i, role in enumerate(WORKSPACE_ROLES):
            _event_statement(
                statements, params, f"role{i}",
                build_workspace_role_definition(workspace_sk, role=role),
                workspace_slug=slug,
            )
        _event_statement(
            statements, params, "memlist",
            build_workspace_member_list(workspace_sk, members=[(owner_pubkey, "owner")]),
            workspace_slug=slug,
        )
        _event_statement(
            statements, params, "add0",
            build_workspace_add(workspace_sk, pubkey=owner_pubkey),
            workspace_slug=slug,
        )

        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)
        return Workspace(slug=slug, name=name, owner_pubkey=owner_pubkey, key_pubkey=key_pubkey)

    async def get_workspace(self, slug: str) -> Workspace | None:
        row = await _select_or_none(self._db, RecordID("workspace", slug))
        if row is None:
            return None
        return Workspace(
            slug=slug, name=row["name"], owner_pubkey=row["owner_pubkey"], key_pubkey=row["key_pubkey"]
        )

    async def get_workspace_role(self, slug: str, pubkey: str) -> str | None:
        row = await _select_or_none(self._db, RecordID("workspace_member", f"{slug}:{pubkey}"))
        return row["role"] if row is not None else None

    async def list_workspaces_for(self, pubkey: str) -> list[tuple[Workspace, str]]:
        """Every Workspace this Identity belongs to, with its role. Restoring
        on a new browser has no invite and no local state, so the Identity is
        the only thing left to resolve a Workspace from (#36)."""
        rows = await _query_or_empty(
            self._db,
            "SELECT workspace_slug, role FROM workspace_member WHERE pubkey = $pubkey "
            "ORDER BY workspace_slug;",
            {"pubkey": pubkey},
        )
        found: list[tuple[Workspace, str]] = []
        for row in rows:
            workspace = await self.get_workspace(row["workspace_slug"])
            if workspace is not None:
                found.append((workspace, row["role"]))
        return found

    async def is_workspace_member_anywhere(self, pubkey: str) -> bool:
        """Whether this pubkey is a Workspace Member of any Workspace this
        server hosts. Blobs are server-wide (/media is not per-Workspace), so
        this is what gates an upload — a single configured slug would be
        wrong on a server holding many Workspaces (ticket #45)."""
        rows = await _query_or_empty(
            self._db,
            "SELECT VALUE pubkey FROM workspace_member WHERE pubkey = $pubkey LIMIT 1;",
            {"pubkey": pubkey},
        )
        return len(rows) > 0

    async def _workspace_signing_key(self, slug: str) -> PrivateKey:
        row = await _select_or_none(self._db, RecordID("workspace", slug))
        assert row is not None, f"workspace {slug!r} does not exist"
        secret = decrypt_secret(row["encrypted_key"], server_secret=self._server_secret)
        return PrivateKey(secret)

    # --- Workspace Members ---------------------------------------------------

    async def list_workspace_members(self, slug: str) -> list[WorkspaceMember]:
        rows = await _query_or_empty(
            self._db, "SELECT * FROM workspace_member WHERE workspace_slug = $slug", {"slug": slug}
        )
        return [
            WorkspaceMember(workspace_slug=slug, pubkey=r["pubkey"], role=r["role"]) for r in rows
        ]

    # --- Invite ---------------------------------------------------------------

    def _invite_from_row(self, code: str, row: dict[str, Any]) -> Invite:
        return Invite(
            code=code,
            workspace_slug=row["workspace_slug"],
            role=row["role"],
            expires_at=row.get("expires_at"),
            max_uses=row.get("max_uses"),
            use_count=row["use_count"],
            revoked=row["revoked"],
            created_by=row["created_by"],
        )

    async def create_invite(
        self,
        *,
        workspace_slug: str,
        role: str,
        expires_at: int | None,
        max_uses: int | None,
        created_by: str,
    ) -> Invite:
        code = secrets.token_urlsafe(12)
        row: dict[str, Any] = {
            "workspace_slug": workspace_slug,
            "role": role,
            "expires_at": expires_at,
            "max_uses": max_uses,
            "use_count": 0,
            "revoked": False,
            "created_by": created_by,
        }
        await self._db.create(RecordID("invite", code), row)
        return self._invite_from_row(code, row)

    async def get_invite(self, code: str) -> Invite | None:
        row = await _select_or_none(self._db, RecordID("invite", code))
        return self._invite_from_row(code, row) if row is not None else None

    async def list_invites(self, workspace_slug: str) -> list[Invite]:
        rows = await _query_or_empty(
            self._db, "SELECT * FROM invite WHERE workspace_slug = $slug", {"slug": workspace_slug}
        )
        return [self._invite_from_row(r["id"].id, r) for r in rows]

    async def revoke_invite(self, code: str) -> None:
        await self._db.merge(RecordID("invite", code), {"revoked": True})

    def _invite_is_valid(self, invite: Invite, *, now: int) -> bool:
        if invite.revoked:
            return False
        if invite.expires_at is not None and now > invite.expires_at:
            return False
        return not (invite.max_uses is not None and invite.use_count >= invite.max_uses)

    async def preview_invite(self, code: str, *, now: int) -> tuple[str, bool]:
        invite = await self.get_invite(code)
        if invite is None:
            return "", False
        workspace = await self.get_workspace(invite.workspace_slug)
        name = workspace.name if workspace is not None else ""
        return name, self._invite_is_valid(invite, now=now)

    async def redeem_invite(self, *, code: str, pubkey: str, now: int) -> WorkspaceMember:
        invite = await self.get_invite(code)
        if invite is None or not self._invite_is_valid(invite, now=now):
            raise InviteInvalidError(f"invite code {code!r} is not valid")

        existing_role = await self.get_workspace_role(invite.workspace_slug, pubkey)
        if existing_role is not None:
            return WorkspaceMember(workspace_slug=invite.workspace_slug, pubkey=pubkey, role=existing_role)

        workspace_sk = await self._workspace_signing_key(invite.workspace_slug)
        current_members = await self.list_workspace_members(invite.workspace_slug)
        updated_members = [(m.pubkey, m.role) for m in current_members] + [(pubkey, invite.role)]

        statements: list[str] = []
        params: dict[str, Any] = {
            "wm_id": f"{invite.workspace_slug}:{pubkey}",
            "wm_row": {"workspace_slug": invite.workspace_slug, "pubkey": pubkey, "role": invite.role},
            "invite_code": code,
            "new_use_count": invite.use_count + 1,
        }
        statements.append("CREATE type::thing('workspace_member', $wm_id) CONTENT $wm_row;")
        statements.append(
            "UPDATE type::thing('invite', $invite_code) SET use_count = $new_use_count;"
        )
        _event_statement(
            statements, params, "memlist",
            build_workspace_member_list(workspace_sk, members=updated_members),
            workspace_slug=invite.workspace_slug,
        )
        _event_statement(
            statements, params, "add0",
            build_workspace_add(workspace_sk, pubkey=pubkey),
            workspace_slug=invite.workspace_slug,
        )

        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)
        return WorkspaceMember(workspace_slug=invite.workspace_slug, pubkey=pubkey, role=invite.role)

    async def set_workspace_member_role(self, *, slug: str, pubkey: str, role: str) -> WorkspaceMember:
        workspace = await self.get_workspace(slug)
        assert workspace is not None
        if pubkey == workspace.owner_pubkey:
            raise CannotRemoveOwnerError("the Workspace owner's role cannot be changed")

        workspace_sk = await self._workspace_signing_key(slug)
        members = await self.list_workspace_members(slug)
        updated = [(m.pubkey, role if m.pubkey == pubkey else m.role) for m in members]

        statements = ["UPDATE type::thing('workspace_member', $wm_id) SET role = $role;"]
        params: dict[str, Any] = {"wm_id": f"{slug}:{pubkey}", "role": role}
        _event_statement(
            statements, params, "memlist",
            build_workspace_member_list(workspace_sk, members=updated),
            workspace_slug=slug,
        )
        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)
        return WorkspaceMember(workspace_slug=slug, pubkey=pubkey, role=role)

    async def remove_workspace_member(self, *, slug: str, pubkey: str) -> list[str]:
        """Removes the Workspace Member, cascading to every Channel they
        belonged to. Returns the ids of the Channels they were removed
        from, so the caller can force-disconnect any of their open relay
        connections scoped to those channels (and the workspace itself)."""
        workspace = await self.get_workspace(slug)
        assert workspace is not None
        if pubkey == workspace.owner_pubkey:
            raise CannotRemoveOwnerError("the Workspace owner cannot be removed")

        workspace_sk = await self._workspace_signing_key(slug)
        members = [m for m in await self.list_workspace_members(slug) if m.pubkey != pubkey]
        channel_ids = [c.id for c in await self._channels_with_member(slug, pubkey)]

        statements = [
            "DELETE type::thing('workspace_member', $wm_id);",
        ]
        params: dict[str, Any] = {"wm_id": f"{slug}:{pubkey}"}
        _event_statement(
            statements, params, "memlist",
            build_workspace_member_list(workspace_sk, members=[(m.pubkey, m.role) for m in members]),
            workspace_slug=slug,
        )
        _event_statement(
            statements, params, "remove0",
            build_workspace_remove(workspace_sk, pubkey=pubkey),
            workspace_slug=slug,
        )
        for i, channel_id in enumerate(channel_ids):
            statements.append(f"DELETE type::thing('channel_member', $cm_id_{i});")
            params[f"cm_id_{i}"] = f"{channel_id}:{pubkey}"
            remaining = [m for m in await self.list_channel_members(channel_id) if m.pubkey != pubkey]
            _event_statement(
                statements, params, f"cmembers{i}",
                build_channel_members(
                    workspace_sk, channel_id=channel_id, member_pubkeys=[m.pubkey for m in remaining]
                ),
                workspace_slug=slug,
            )
            _event_statement(
                statements, params, f"cadmins{i}",
                build_channel_admins(
                    workspace_sk, channel_id=channel_id,
                    admin_pubkeys=[m.pubkey for m in remaining if m.role == "admin"],
                ),
                workspace_slug=slug,
            )
            _event_statement(
                statements, params, f"cremove{i}",
                build_channel_remove(workspace_sk, channel_id=channel_id, pubkey=pubkey),
                workspace_slug=slug,
            )

        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)
        return channel_ids

    # --- Channel ----------------------------------------------------------

    async def create_channel(
        self, *, workspace_slug: str, name: str, about: str, private: bool, created_by: str
    ) -> Channel:
        workspace_sk = await self._workspace_signing_key(workspace_slug)
        channel_id = secrets.token_hex(8)

        statements: list[str] = []
        params: dict[str, Any] = {
            "c_id": channel_id,
            "c_row": {
                "workspace_slug": workspace_slug, "name": name, "about": about,
                "private": private, "created_by": created_by,
            },
            "cm_id": f"{channel_id}:{created_by}",
            "cm_row": {"channel_id": channel_id, "pubkey": created_by, "role": "admin"},
        }
        statements.append("CREATE type::thing('channel', $c_id) CONTENT $c_row;")
        statements.append("CREATE type::thing('channel_member', $cm_id) CONTENT $cm_row;")
        _event_statement(
            statements, params, "meta",
            build_channel_metadata(workspace_sk, channel_id=channel_id, name=name, about=about),
            workspace_slug=workspace_slug,
        )
        _event_statement(
            statements, params, "admins",
            build_channel_admins(workspace_sk, channel_id=channel_id, admin_pubkeys=[created_by]),
            workspace_slug=workspace_slug,
        )
        _event_statement(
            statements, params, "members",
            build_channel_members(workspace_sk, channel_id=channel_id, member_pubkeys=[created_by]),
            workspace_slug=workspace_slug,
        )
        _event_statement(
            statements, params, "roles",
            build_channel_roles(workspace_sk, channel_id=channel_id),
            workspace_slug=workspace_slug,
        )
        _event_statement(
            statements, params, "add0",
            build_channel_add(workspace_sk, channel_id=channel_id, pubkey=created_by),
            workspace_slug=workspace_slug,
        )

        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)
        return Channel(
            id=channel_id, workspace_slug=workspace_slug, name=name, about=about,
            private=private, created_by=created_by,
        )

    async def get_channel(self, channel_id: str) -> Channel | None:
        row = await _select_or_none(self._db, RecordID("channel", channel_id))
        if row is None:
            return None
        return Channel(
            id=channel_id, workspace_slug=row["workspace_slug"], name=row["name"],
            about=row["about"], private=row["private"], created_by=row["created_by"],
        )

    async def list_channels_for(self, *, workspace_slug: str, pubkey: str) -> list[Channel]:
        rows = await _query_or_empty(
            self._db, "SELECT * FROM channel WHERE workspace_slug = $slug", {"slug": workspace_slug}
        )
        channels = [
            Channel(
                id=r["id"].id, workspace_slug=workspace_slug, name=r["name"], about=r["about"],
                private=r["private"], created_by=r["created_by"],
            )
            for r in rows
        ]
        visible = []
        for channel in channels:
            if not channel.private or await self.is_channel_member(channel.id, pubkey):
                visible.append(channel)
        return visible

    async def list_channel_members(self, channel_id: str) -> list[ChannelMember]:
        rows = await _query_or_empty(
            self._db, "SELECT * FROM channel_member WHERE channel_id = $cid", {"cid": channel_id}
        )
        return [ChannelMember(channel_id=channel_id, pubkey=r["pubkey"], role=r["role"]) for r in rows]

    async def _channels_with_member(self, workspace_slug: str, pubkey: str) -> list[Channel]:
        channels = await _query_or_empty(
            self._db, "SELECT * FROM channel WHERE workspace_slug = $slug", {"slug": workspace_slug}
        )
        result = []
        for row in channels:
            channel_id = row["id"].id
            if await self.is_channel_member(channel_id, pubkey):
                result.append(
                    Channel(
                        id=channel_id, workspace_slug=workspace_slug, name=row["name"],
                        about=row["about"], private=row["private"], created_by=row["created_by"],
                    )
                )
        return result

    async def is_channel_member(self, channel_id: str, pubkey: str) -> bool:
        return await self.get_channel_role(channel_id, pubkey) is not None

    async def get_channel_role(self, channel_id: str, pubkey: str) -> str | None:
        row = await _select_or_none(self._db, RecordID("channel_member", f"{channel_id}:{pubkey}"))
        return row["role"] if row is not None else None

    async def add_channel_member(self, *, channel_id: str, pubkey: str, role: str = "member") -> None:
        channel = await self.get_channel(channel_id)
        assert channel is not None
        if await self.get_workspace_role(channel.workspace_slug, pubkey) is None:
            raise NotAWorkspaceMemberError(
                f"{pubkey} must be a Workspace Member before joining a Channel"
            )
        workspace_sk = await self._workspace_signing_key(channel.workspace_slug)
        members = [
            *(m for m in await self.list_channel_members(channel_id) if m.pubkey != pubkey),
            ChannelMember(channel_id=channel_id, pubkey=pubkey, role=role),
        ]

        # UPSERT, not CREATE: re-adding an existing member (e.g. a retried
        # request) updates their role instead of failing on the duplicate id.
        statements = ["UPSERT type::thing('channel_member', $cm_id) CONTENT $cm_row;"]
        params: dict[str, Any] = {
            "cm_id": f"{channel_id}:{pubkey}",
            "cm_row": {"channel_id": channel_id, "pubkey": pubkey, "role": role},
        }
        _event_statement(
            statements, params, "members",
            build_channel_members(
                workspace_sk, channel_id=channel_id, member_pubkeys=[m.pubkey for m in members]
            ),
            workspace_slug=channel.workspace_slug,
        )
        if role == "admin":
            admins = [m.pubkey for m in members if m.role == "admin"]
            _event_statement(
                statements, params, "admins",
                build_channel_admins(workspace_sk, channel_id=channel_id, admin_pubkeys=admins),
                workspace_slug=channel.workspace_slug,
            )
        _event_statement(
            statements, params, "add0",
            build_channel_add(workspace_sk, channel_id=channel_id, pubkey=pubkey),
            workspace_slug=channel.workspace_slug,
        )
        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)

    async def remove_channel_member(self, *, channel_id: str, pubkey: str) -> None:
        channel = await self.get_channel(channel_id)
        assert channel is not None
        workspace_sk = await self._workspace_signing_key(channel.workspace_slug)
        remaining = [m for m in await self.list_channel_members(channel_id) if m.pubkey != pubkey]

        statements = ["DELETE type::thing('channel_member', $cm_id);"]
        params: dict[str, Any] = {"cm_id": f"{channel_id}:{pubkey}"}
        _event_statement(
            statements, params, "members",
            build_channel_members(
                workspace_sk, channel_id=channel_id, member_pubkeys=[m.pubkey for m in remaining]
            ),
            workspace_slug=channel.workspace_slug,
        )
        _event_statement(
            statements, params, "admins",
            build_channel_admins(
                workspace_sk, channel_id=channel_id,
                admin_pubkeys=[m.pubkey for m in remaining if m.role == "admin"],
            ),
            workspace_slug=channel.workspace_slug,
        )
        _event_statement(
            statements, params, "remove0",
            build_channel_remove(workspace_sk, channel_id=channel_id, pubkey=pubkey),
            workspace_slug=channel.workspace_slug,
        )
        surql, bound = _run_in_transaction(statements, params)
        await self._db.query(surql, bound)

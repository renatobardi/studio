"""RED: the control-plane repository — Account, Workspace, Invite, Members,
Channels, each mutation projecting its NIP-43/NIP-29 event in the same
transaction as the table write (ADR-0002), against a real SurrealDB.
"""

import pytest
from surrealdb.data.types.record_id import RecordID

from studio_api.control.errors import (
    AlreadyLinkedError,
    CannotRemoveOwnerError,
    InviteInvalidError,
    NotAWorkspaceMemberError,
    WorkspaceSlugTakenError,
)
from studio_api.control.models import Channel
from studio_api.control.repository import ControlPlaneRepository
from studio_api.nostr.model import Filter
from studio_api.nostr.store import EventStore

SERVER_SECRET = "test-server-secret"


@pytest.fixture
def repo(store: EventStore) -> ControlPlaneRepository:
    return ControlPlaneRepository(store.raw, event_store=store, server_secret=SERVER_SECRET)


class TestAccount:
    async def test_creating_then_getting_an_account_round_trips(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")

        account = await repo.get_account("uid1")

        assert account is not None
        assert account.uid == "uid1"
        assert account.email == "a@example.com"
        assert account.pubkey is None

    async def test_getting_an_unknown_account_returns_none(
        self, repo: ControlPlaneRepository
    ) -> None:
        assert await repo.get_account("nope") is None

    async def test_linking_an_identity_sets_the_pubkey(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")

        await repo.link_identity(uid="uid1", pubkey="pub1")

        account = await repo.get_account("uid1")
        assert account is not None
        assert account.pubkey == "pub1"

    async def test_linking_the_same_pubkey_twice_is_fine(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")
        await repo.link_identity(uid="uid1", pubkey="pub1")

        await repo.link_identity(uid="uid1", pubkey="pub1")  # no error

        account = await repo.get_account("uid1")
        assert account is not None
        assert account.pubkey == "pub1"

    async def test_linking_a_second_different_identity_is_rejected(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")
        await repo.link_identity(uid="uid1", pubkey="pub1")

        with pytest.raises(AlreadyLinkedError):
            await repo.link_identity(uid="uid1", pubkey="pub2")


class TestKeyBackup:
    async def test_upload_then_download_round_trips_the_blob(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")

        await repo.put_key_backup(uid="uid1", blob=b"opaque-age-file-bytes")

        assert await repo.get_key_backup("uid1") == b"opaque-age-file-bytes"

    async def test_a_second_upload_replaces_the_first(self, repo: ControlPlaneRepository) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")
        await repo.put_key_backup(uid="uid1", blob=b"first")

        await repo.put_key_backup(uid="uid1", blob=b"second")

        assert await repo.get_key_backup("uid1") == b"second"

    async def test_an_account_with_no_backup_returns_none(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_account(uid="uid1", email="a@example.com", provider="password")

        assert await repo.get_key_backup("uid1") is None


class TestWorkspace:
    async def test_creating_a_workspace_returns_it_with_a_key_pubkey(
        self, repo: ControlPlaneRepository
    ) -> None:
        workspace = await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        assert workspace.slug == "family"
        assert workspace.name == "Family"
        assert workspace.owner_pubkey == "owner1"
        assert len(workspace.key_pubkey) == 64  # 32-byte x-only hex pubkey

    async def test_getting_by_slug_returns_the_same_workspace(
        self, repo: ControlPlaneRepository
    ) -> None:
        created = await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        fetched = await repo.get_workspace("family")

        assert fetched == created

    async def test_getting_an_unknown_slug_returns_none(
        self, repo: ControlPlaneRepository
    ) -> None:
        assert await repo.get_workspace("nope") is None

    async def test_a_taken_slug_is_rejected(self, repo: ControlPlaneRepository) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        with pytest.raises(WorkspaceSlugTakenError):
            await repo.create_workspace(slug="family", name="Family Again", owner_pubkey="owner2")

    async def test_owner_is_a_workspace_member_with_the_owner_role(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        assert await repo.get_workspace_role("family", "owner1") == "owner"

    async def test_a_non_member_has_no_role(self, repo: ControlPlaneRepository) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        assert await repo.get_workspace_role("family", "someone-else") is None

    async def test_projects_role_definitions_member_list_and_add_event(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        roles = await repo._events.for_workspace("family").query([Filter(kinds=[33534])])
        assert {r["pubkey"] for r in roles} == {
            (await repo.get_workspace("family")).key_pubkey  # type: ignore[union-attr]
        }
        assert {t[1] for r in roles for t in r["tags"] if t[0] == "d"} == {
            "owner", "admin", "member", "agent"
        }

        member_lists = await repo._events.for_workspace("family").query([Filter(kinds=[13534])])
        assert len(member_lists) == 1
        assert any(t == ["member", "owner1", "owner"] for t in member_lists[0]["tags"])

        add_events = await repo._events.for_workspace("family").query(
            [Filter(kinds=[8000]), Filter(kinds=[8000])]
        )
        assert any(
            any(t == ["p", "owner1"] for t in e["tags"]) for e in add_events
        )

    async def test_the_workspace_key_private_bytes_are_never_stored_in_clear(
        self, repo: ControlPlaneRepository
    ) -> None:
        workspace = await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

        raw_row = await repo._db.select(RecordID("workspace", "family"))
        assert workspace.key_pubkey.encode() not in raw_row[0]["encrypted_key"]


NOW = 1_700_000_000


class TestInvite:
    async def _workspace(self, repo: ControlPlaneRepository) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

    async def test_creating_then_listing_an_invite(self, repo: ControlPlaneRepository) -> None:
        await self._workspace(repo)

        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )

        listed = await repo.list_invites("family")
        assert [i.code for i in listed] == [invite.code]
        assert invite.use_count == 0
        assert invite.revoked is False

    async def test_preview_of_an_unknown_code_is_invalid(
        self, repo: ControlPlaneRepository
    ) -> None:
        _name, valid = await repo.preview_invite("nope", now=NOW)
        assert valid is False

    async def test_preview_of_a_valid_code_names_the_workspace(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )

        name, valid = await repo.preview_invite(invite.code, now=NOW)

        assert (name, valid) == ("Family", True)

    async def test_revoked_invite_preview_is_invalid(self, repo: ControlPlaneRepository) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )
        await repo.revoke_invite(invite.code)

        _, valid = await repo.preview_invite(invite.code, now=NOW)
        assert valid is False

    async def test_expired_invite_preview_is_invalid(self, repo: ControlPlaneRepository) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=NOW - 1, max_uses=None,
            created_by="owner1",
        )

        _, valid = await repo.preview_invite(invite.code, now=NOW)
        assert valid is False

    async def test_exhausted_invite_preview_is_invalid(self, repo: ControlPlaneRepository) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=1,
            created_by="owner1",
        )
        await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

        _, valid = await repo.preview_invite(invite.code, now=NOW)
        assert valid is False

    async def test_redeeming_creates_a_workspace_member_with_the_invites_role(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )

        member = await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

        assert member.role == "member"
        assert await repo.get_workspace_role("family", "newmember1") == "member"

    async def test_redeeming_updates_the_projected_member_list(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )

        await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

        lists = await repo._events.for_workspace("family").query([Filter(kinds=[13534])])
        assert len(lists) == 1
        assert {tuple(t) for t in lists[0]["tags"] if t[0] == "member"} == {
            ("member", "owner1", "owner"),
            ("member", "newmember1", "member"),
        }

    async def test_redeeming_twice_is_idempotent(self, repo: ControlPlaneRepository) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )
        await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

        await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)  # no error

        assert await repo.get_workspace_role("family", "newmember1") == "member"

    async def test_redeeming_a_revoked_invite_is_rejected(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )
        await repo.revoke_invite(invite.code)

        with pytest.raises(InviteInvalidError):
            await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

    async def test_redeeming_an_expired_invite_is_rejected(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=NOW - 1, max_uses=None,
            created_by="owner1",
        )

        with pytest.raises(InviteInvalidError):
            await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

    async def test_redeeming_an_exhausted_invite_is_rejected(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=1,
            created_by="owner1",
        )
        await repo.redeem_invite(code=invite.code, pubkey="newmember1", now=NOW)

        with pytest.raises(InviteInvalidError):
            await repo.redeem_invite(code=invite.code, pubkey="another-newcomer", now=NOW)


class TestWorkspaceMemberManagement:
    async def _workspace_with_member(self, repo: ControlPlaneRepository) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )
        await repo.redeem_invite(code=invite.code, pubkey="member1", now=NOW)

    async def test_changing_a_members_role_updates_the_projected_list(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace_with_member(repo)

        await repo.set_workspace_member_role(slug="family", pubkey="member1", role="admin")

        assert await repo.get_workspace_role("family", "member1") == "admin"
        lists = await repo._events.for_workspace("family").query([Filter(kinds=[13534])])
        assert {tuple(t) for t in lists[0]["tags"] if t[0] == "member"} == {
            ("member", "owner1", "owner"),
            ("member", "member1", "admin"),
        }

    async def test_removing_a_member_drops_their_role(self, repo: ControlPlaneRepository) -> None:
        await self._workspace_with_member(repo)

        await repo.remove_workspace_member(slug="family", pubkey="member1")

        assert await repo.get_workspace_role("family", "member1") is None

    async def test_removing_the_owner_is_rejected(self, repo: ControlPlaneRepository) -> None:
        await self._workspace_with_member(repo)

        with pytest.raises(CannotRemoveOwnerError):
            await repo.remove_workspace_member(slug="family", pubkey="owner1")

    async def test_changing_the_owners_role_is_rejected(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace_with_member(repo)

        with pytest.raises(CannotRemoveOwnerError):
            await repo.set_workspace_member_role(slug="family", pubkey="owner1", role="member")

    async def test_removing_a_member_drops_their_channel_memberships(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace_with_member(repo)
        channel = await repo.create_channel(
            workspace_slug="family", name="general", about="", private=False, created_by="owner1"
        )
        await repo.add_channel_member(channel_id=channel.id, pubkey="member1", role="member")

        removed_channel_ids = await repo.remove_workspace_member(slug="family", pubkey="member1")

        assert channel.id in removed_channel_ids
        assert await repo.is_channel_member(channel.id, "member1") is False


class TestChannel:
    async def _workspace(self, repo: ControlPlaneRepository) -> None:
        await repo.create_workspace(slug="family", name="Family", owner_pubkey="owner1")

    async def test_creating_a_channel_makes_the_creator_a_channel_admin(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)

        channel = await repo.create_channel(
            workspace_slug="family", name="general", about="chat", private=False,
            created_by="owner1",
        )

        assert channel.name == "general"
        assert await repo.is_channel_member(channel.id, "owner1") is True
        assert await repo.get_channel_role(channel.id, "owner1") == "admin"

    async def test_projects_metadata_admins_members_and_roles(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)

        channel = await repo.create_channel(
            workspace_slug="family", name="general", about="chat", private=False,
            created_by="owner1",
        )

        metas = await repo._events.for_workspace("family").query([Filter(kinds=[39000])])
        assert any(any(t == ["d", channel.id] for t in e["tags"]) for e in metas)
        admins = await repo._events.for_workspace("family").query([Filter(kinds=[39001])])
        assert any(
            any(t == ["p", "owner1"] for t in e["tags"])
            for e in admins
            if any(t == ["d", channel.id] for t in e["tags"])
        )

    async def test_list_channels_for_excludes_private_channels_for_non_members(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        public = await repo.create_channel(
            workspace_slug="family", name="general", about="", private=False, created_by="owner1"
        )
        private = await repo.create_channel(
            workspace_slug="family", name="secret", about="", private=True, created_by="owner1"
        )

        visible_to_owner = await repo.list_channels_for(workspace_slug="family", pubkey="owner1")
        assert {c.id for c in visible_to_owner} == {public.id, private.id}

        visible_to_stranger = await repo.list_channels_for(
            workspace_slug="family", pubkey="a-stranger"
        )
        assert {c.id for c in visible_to_stranger} == {public.id}

    async def test_adding_a_channel_member_requires_workspace_membership(
        self, repo: ControlPlaneRepository
    ) -> None:
        await self._workspace(repo)
        channel = await repo.create_channel(
            workspace_slug="family", name="general", about="", private=False, created_by="owner1"
        )

        with pytest.raises(NotAWorkspaceMemberError):
            await repo.add_channel_member(channel_id=channel.id, pubkey="not-a-member", role="member")

    async def _workspace_with_a_prospective_member(self, repo: ControlPlaneRepository) -> Channel:
        """A Workspace with "member1" already a Workspace Member (via Invite) and one Channel,
        neither yet a Channel Member of — the shared setup for the add-Channel-member tests."""
        await self._workspace(repo)
        invite = await repo.create_invite(
            workspace_slug="family", role="member", expires_at=None, max_uses=None,
            created_by="owner1",
        )
        await repo.redeem_invite(code=invite.code, pubkey="member1", now=NOW)
        return await repo.create_channel(
            workspace_slug="family", name="general", about="", private=False, created_by="owner1"
        )

    async def test_adding_then_removing_a_channel_member(
        self, repo: ControlPlaneRepository
    ) -> None:
        channel = await self._workspace_with_a_prospective_member(repo)

        await repo.add_channel_member(channel_id=channel.id, pubkey="member1", role="member")
        assert await repo.is_channel_member(channel.id, "member1") is True

    async def test_adding_an_existing_channel_member_again_is_a_no_op(
        self, repo: ControlPlaneRepository
    ) -> None:
        channel = await self._workspace_with_a_prospective_member(repo)
        await repo.add_channel_member(channel_id=channel.id, pubkey="member1", role="member")

        await repo.add_channel_member(channel_id=channel.id, pubkey="member1", role="member")

        assert await repo.is_channel_member(channel.id, "member1") is True

        await repo.remove_channel_member(channel_id=channel.id, pubkey="member1")
        assert await repo.is_channel_member(channel.id, "member1") is False

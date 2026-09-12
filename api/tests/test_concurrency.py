"""RED: the invariants the control plane and the event store claim to hold
when several clients act at the same time (ticket #44).

Each test drives concurrent asyncio tasks over the one shared SurrealDB
connection — the same shape a single API process has under concurrent
requests — and asserts the invariant on the state that survives.
"""

import asyncio
from typing import Any

import pytest
from support import new_keypair, sign_event
from surrealdb.errors import SurrealError

from studio_api.control.errors import InviteInvalidError, WorkspaceSlugTakenError
from studio_api.control.repository import (
    ControlPlaneRepository,
    _event_statement,
    _run_in_transaction,
)
from studio_api.nostr.model import Filter
from studio_api.nostr.store import EventStore

SERVER_SECRET = "test-server-secret"
WORKSPACE_MEMBER_LIST_KIND = 13534
REPLACEABLE_KIND = 10002


@pytest.fixture
def repo(store: EventStore) -> ControlPlaneRepository:
    return ControlPlaneRepository(store.raw, event_store=store, server_secret=SERVER_SECRET)


async def _projected_members(store: EventStore) -> set[tuple[str, str]]:
    events = await store.query([Filter(kinds=[WORKSPACE_MEMBER_LIST_KIND])])
    assert events, "no member-list event was projected"
    return {(t[1], t[2]) for t in events[0]["tags"] if t[0] == "member"}


class TestSingleUseInvite:
    async def test_a_single_use_invite_admits_at_most_one_identity(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_workspace(slug="test-ws", name="Test", owner_pubkey="owner")
        invite = await repo.create_invite(
            workspace_slug="test-ws", role="member", expires_at=None, max_uses=1,
            created_by="owner",
        )
        newcomers = [f"pub{i}" for i in range(5)]

        results = await asyncio.gather(
            *(repo.redeem_invite(code=invite.code, pubkey=p, now=0) for p in newcomers),
            return_exceptions=True,
        )

        admitted = [r for r in results if not isinstance(r, BaseException)]
        unexpected = [r for r in results if isinstance(r, BaseException) and not isinstance(r, InviteInvalidError)]
        assert not unexpected, f"redeeming failed for the wrong reason: {unexpected}"
        assert len(admitted) == 1, f"{len(admitted)} identities admitted through a single-use invite"

        members = await repo.list_workspace_members("test-ws")
        assert len(members) == 2, f"membership rows: {members}"

        stored = await repo.get_invite(invite.code)
        assert stored is not None
        assert stored.use_count == 1

    async def test_the_use_count_matches_the_identities_actually_admitted(
        self, repo: ControlPlaneRepository
    ) -> None:
        await repo.create_workspace(slug="test-ws", name="Test", owner_pubkey="owner")
        invite = await repo.create_invite(
            workspace_slug="test-ws", role="member", expires_at=None, max_uses=3,
            created_by="owner",
        )

        results = await asyncio.gather(
            *(repo.redeem_invite(code=invite.code, pubkey=f"pub{i}", now=0) for i in range(8)),
            return_exceptions=True,
        )

        admitted = [r for r in results if not isinstance(r, BaseException)]
        assert len(admitted) == 3, f"{len(admitted)} admitted through an invite good for 3"

        stored = await repo.get_invite(invite.code)
        assert stored is not None
        assert stored.use_count == len(admitted)
        assert len(await repo.list_workspace_members("test-ws")) == len(admitted) + 1


class TestConcurrentMembershipChanges:
    async def test_simultaneous_redemptions_all_reach_the_projected_member_list(
        self, repo: ControlPlaneRepository, store: EventStore
    ) -> None:
        await repo.create_workspace(slug="test-ws", name="Test", owner_pubkey="owner")
        invite = await repo.create_invite(
            workspace_slug="test-ws", role="member", expires_at=None, max_uses=None,
            created_by="owner",
        )
        newcomers = [f"pub{i}" for i in range(4)]

        await asyncio.gather(
            *(repo.redeem_invite(code=invite.code, pubkey=p, now=0) for p in newcomers)
        )

        rows = {(m.pubkey, m.role) for m in await repo.list_workspace_members("test-ws")}
        expected = {("owner", "owner")} | {(p, "member") for p in newcomers}
        assert rows == expected
        assert await _projected_members(store) == expected

    async def test_simultaneous_role_changes_leave_no_member_behind(
        self, repo: ControlPlaneRepository, store: EventStore
    ) -> None:
        await repo.create_workspace(slug="test-ws", name="Test", owner_pubkey="owner")
        invite = await repo.create_invite(
            workspace_slug="test-ws", role="member", expires_at=None, max_uses=None,
            created_by="owner",
        )
        promoted = [f"pub{i}" for i in range(4)]
        for pubkey in promoted:
            await repo.redeem_invite(code=invite.code, pubkey=pubkey, now=0)

        await asyncio.gather(
            *(repo.set_workspace_member_role(slug="test-ws", pubkey=p, role="admin")
              for p in promoted)
        )

        expected = {("owner", "owner")} | {(p, "admin") for p in promoted}
        assert {(m.pubkey, m.role) for m in await repo.list_workspace_members("test-ws")} == expected
        assert await _projected_members(store) == expected

    async def test_a_removal_racing_a_role_change_still_projects_the_final_state(
        self, repo: ControlPlaneRepository, store: EventStore
    ) -> None:
        """Different kinds of membership change, not just several of a kind:
        each rebuilds the member list from what it read."""
        await repo.create_workspace(slug="test-ws", name="Test", owner_pubkey="owner")
        invite = await repo.create_invite(
            workspace_slug="test-ws", role="member", expires_at=None, max_uses=None,
            created_by="owner",
        )
        for pubkey in ("leaver", "promoted", "stayer"):
            await repo.redeem_invite(code=invite.code, pubkey=pubkey, now=0)

        await asyncio.gather(
            repo.remove_workspace_member(slug="test-ws", pubkey="leaver"),
            repo.set_workspace_member_role(slug="test-ws", pubkey="promoted", role="admin"),
        )

        expected = {("owner", "owner"), ("promoted", "admin"), ("stayer", "member")}
        assert {(m.pubkey, m.role) for m in await repo.list_workspace_members("test-ws")} == expected
        assert await _projected_members(store) == expected


class TestConcurrentReplaceablePublish:
    async def test_the_latest_created_at_wins_however_the_writes_interleave(
        self, store: EventStore
    ) -> None:
        sk, pubkey = new_keypair()
        events = [
            sign_event(sk, pubkey=pubkey, created_at=1000 + i, kind=REPLACEABLE_KIND,
                       content=f"v{i}")
            for i in range(6)
        ]
        winner = events[-1]

        await asyncio.gather(*(store.publish(event) for event in reversed(events)))

        stored = await store.query([Filter(kinds=[REPLACEABLE_KIND], authors=[pubkey])])
        assert len(stored) == 1
        assert stored[0]["id"] == winner["id"]

    async def test_a_created_at_tie_is_broken_by_the_lowest_id(
        self, store: EventStore
    ) -> None:
        sk, pubkey = new_keypair()
        events = [
            sign_event(sk, pubkey=pubkey, created_at=1000, kind=REPLACEABLE_KIND, content=f"v{i}")
            for i in range(6)
        ]
        winner = min(events, key=lambda e: e["id"])

        await asyncio.gather(*(store.publish(event) for event in events))

        stored = await store.query([Filter(kinds=[REPLACEABLE_KIND], authors=[pubkey])])
        assert len(stored) == 1
        assert stored[0]["id"] == winner["id"]


class TestConcurrentWorkspaceCreation:
    async def test_only_one_of_two_racing_creations_claims_the_slug(
        self, repo: ControlPlaneRepository, store: EventStore
    ) -> None:
        """The loser must leave nothing behind — least of all events signed by
        a Workspace Key the stored Workspace does not own."""
        results = await asyncio.gather(
            repo.create_workspace(slug="test-ws", name="One", owner_pubkey="owner1"),
            repo.create_workspace(slug="test-ws", name="Two", owner_pubkey="owner2"),
            return_exceptions=True,
        )

        created = [r for r in results if not isinstance(r, BaseException)]
        taken = [r for r in results if isinstance(r, WorkspaceSlugTakenError)]
        assert len(created) == 1, f"both creations claimed the slug: {results}"
        assert len(taken) == 1, f"the loser failed for the wrong reason: {results}"

        workspace = await repo.get_workspace("test-ws")
        assert workspace is not None
        assert workspace.key_pubkey == created[0].key_pubkey

        events = await store.query([Filter()])
        assert events, "the winning creation projected nothing"
        assert {e["pubkey"] for e in events} == {workspace.key_pubkey}


class TestRollback:
    async def test_a_failing_statement_rolls_back_the_projection_with_it(
        self, repo: ControlPlaneRepository, store: EventStore
    ) -> None:
        """ADR-0002 puts the table write and the event it projects in one
        transaction so neither can survive alone. Evidence that SurrealDB
        already honours that — no application-side compensation needed."""
        await repo.create_workspace(slug="test-ws", name="Test", owner_pubkey="owner")
        before = await store.query([Filter()])

        sk, pubkey = new_keypair()
        event = sign_event(sk, pubkey=pubkey, created_at=1, kind=REPLACEABLE_KIND)
        statements: list[str] = []
        params: dict[str, Any] = {}
        _event_statement(statements, params, "doomed", event, workspace_slug="test-ws")
        # A second CREATE of the Workspace that already exists: the statement
        # fails, so the event above must never become visible.
        statements.append("CREATE type::thing('workspace', 'test-ws') SET name = 'clash';")
        surql, bound = _run_in_transaction(statements, params)

        with pytest.raises(SurrealError):
            await store.raw.query(surql, bound)

        assert await store.query([Filter()]) == before

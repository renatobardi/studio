"""RED: NIP-43 (Workspace) / NIP-29 (Channel) projection events, signed by
the Workspace Key (ADR-0002) — pure event construction, no store involved.
"""

from coincurve import PrivateKey

from studio_api.nostr.crypto import verify_event_signature
from studio_api.nostr.model import NostrEvent, Tag
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


def first_tag(event: NostrEvent, name: str) -> Tag:
    return next(t for t in event["tags"] if t[0] == name)


def all_tags(event: NostrEvent, name: str) -> list[Tag]:
    return [t for t in event["tags"] if t[0] == name]


class TestWorkspaceProjection:
    def test_role_definition_is_addressable_by_role_id(self) -> None:
        sk = PrivateKey()

        event = build_workspace_role_definition(sk, role="owner")

        assert event["kind"] == 33534
        assert first_tag(event, "-") == ["-"]
        assert first_tag(event, "d") == ["d", "owner"]
        assert verify_event_signature(event) is True

    def test_all_workspace_roles_are_defined(self) -> None:
        assert WORKSPACE_ROLES == ("owner", "admin", "member", "agent")

    def test_member_list_contains_every_member_and_role(self) -> None:
        sk = PrivateKey()

        event = build_workspace_member_list(sk, members=[("pub1", "owner"), ("pub2", "member")])

        assert event["kind"] == 13534
        assert first_tag(event, "-") == ["-"]
        assert all_tags(event, "member") == [
            ["member", "pub1", "owner"],
            ["member", "pub2", "member"],
        ]

    def test_add_event_names_the_pubkey(self) -> None:
        sk = PrivateKey()

        event = build_workspace_add(sk, pubkey="pub1")

        assert event["kind"] == 8000
        assert first_tag(event, "-") == ["-"]
        assert first_tag(event, "p") == ["p", "pub1"]

    def test_remove_event_names_the_pubkey(self) -> None:
        sk = PrivateKey()

        event = build_workspace_remove(sk, pubkey="pub1")

        assert event["kind"] == 8001
        assert first_tag(event, "p") == ["p", "pub1"]


class TestChannelProjection:
    def test_metadata_is_addressable_by_channel_id(self) -> None:
        sk = PrivateKey()

        event = build_channel_metadata(sk, channel_id="chan1", name="general", about="chat")

        assert event["kind"] == 39000
        assert first_tag(event, "d") == ["d", "chan1"]
        assert first_tag(event, "name") == ["name", "general"]
        assert first_tag(event, "about") == ["about", "chat"]
        # channel-level NIP-29 events, unlike NIP-43, do not carry the "-" tag
        assert not any(t[0] == "-" for t in event["tags"])

    def test_admins_lists_every_admin_pubkey(self) -> None:
        sk = PrivateKey()

        event = build_channel_admins(sk, channel_id="chan1", admin_pubkeys=["pub1", "pub2"])

        assert event["kind"] == 39001
        assert first_tag(event, "d") == ["d", "chan1"]
        assert all_tags(event, "p") == [["p", "pub1"], ["p", "pub2"]]

    def test_members_lists_every_member_pubkey(self) -> None:
        sk = PrivateKey()

        event = build_channel_members(sk, channel_id="chan1", member_pubkeys=["pub1", "pub2"])

        assert event["kind"] == 39002
        assert all_tags(event, "p") == [["p", "pub1"], ["p", "pub2"]]

    def test_roles_advertises_the_admin_role(self) -> None:
        sk = PrivateKey()

        event = build_channel_roles(sk, channel_id="chan1")

        assert event["kind"] == 39003
        assert any(t[0] == "role" and t[1] == "admin" for t in event["tags"])

    def test_add_event_scopes_to_the_channel(self) -> None:
        sk = PrivateKey()

        event = build_channel_add(sk, channel_id="chan1", pubkey="pub1")

        assert event["kind"] == 9000
        assert first_tag(event, "h") == ["h", "chan1"]
        assert first_tag(event, "p") == ["p", "pub1"]

    def test_remove_event_scopes_to_the_channel(self) -> None:
        sk = PrivateKey()

        event = build_channel_remove(sk, channel_id="chan1", pubkey="pub1")

        assert event["kind"] == 9001
        assert first_tag(event, "h") == ["h", "chan1"]
        assert first_tag(event, "p") == ["p", "pub1"]

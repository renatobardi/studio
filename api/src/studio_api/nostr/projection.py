"""NIP-43 (Workspace) and NIP-29 (Channel) projection: the events a
Workspace Key signs to announce membership changes (ADR-0002). Pure event
construction — the repository layer decides when to call these and writes
the result alongside the table change it projects."""

from coincurve import PrivateKey

from studio_api.nostr.model import NostrEvent, Tag
from studio_api.nostr.signing import sign_event

WORKSPACE_ROLES = ("owner", "admin", "member", "agent")

# --- Workspace level (NIP-43) --------------------------------------------
# NIP-43 requires the NIP-70 "-" protected tag on every event it defines.


def build_workspace_role_definition(sk: PrivateKey, *, role: str) -> NostrEvent:
    return sign_event(sk, kind=33534, tags=[["-"], ["d", role], ["label", role]])


def build_workspace_member_list(sk: PrivateKey, *, members: list[tuple[str, str]]) -> NostrEvent:
    tags: list[Tag] = [["-"]]
    tags += [["member", pubkey, role] for pubkey, role in members]
    return sign_event(sk, kind=13534, tags=tags)


def build_workspace_add(sk: PrivateKey, *, pubkey: str) -> NostrEvent:
    return sign_event(sk, kind=8000, tags=[["-"], ["p", pubkey]])


def build_workspace_remove(sk: PrivateKey, *, pubkey: str) -> NostrEvent:
    return sign_event(sk, kind=8001, tags=[["-"], ["p", pubkey]])


# --- Channel level (NIP-29) -----------------------------------------------
# Channel-level events use the channel's "d" identifier (metadata/admins/
# members/roles) or "h" tag (moderation) and, unlike NIP-43, carry no "-" tag.

CHANNEL_ROLES = ("admin",)


def build_channel_metadata(sk: PrivateKey, *, channel_id: str, name: str, about: str) -> NostrEvent:
    return sign_event(
        sk, kind=39000, tags=[["d", channel_id], ["name", name], ["about", about]]
    )


def build_channel_admins(sk: PrivateKey, *, channel_id: str, admin_pubkeys: list[str]) -> NostrEvent:
    tags: list[Tag] = [["d", channel_id]]
    tags += [["p", pubkey] for pubkey in admin_pubkeys]
    return sign_event(sk, kind=39001, tags=tags)


def build_channel_members(sk: PrivateKey, *, channel_id: str, member_pubkeys: list[str]) -> NostrEvent:
    tags: list[Tag] = [["d", channel_id]]
    tags += [["p", pubkey] for pubkey in member_pubkeys]
    return sign_event(sk, kind=39002, tags=tags)


def build_channel_roles(sk: PrivateKey, *, channel_id: str) -> NostrEvent:
    tags: list[Tag] = [["d", channel_id]]
    tags += [["role", role] for role in CHANNEL_ROLES]
    return sign_event(sk, kind=39003, tags=tags)


def build_channel_add(sk: PrivateKey, *, channel_id: str, pubkey: str) -> NostrEvent:
    return sign_event(sk, kind=9000, tags=[["h", channel_id], ["p", pubkey]])


def build_channel_remove(sk: PrivateKey, *, channel_id: str, pubkey: str) -> NostrEvent:
    return sign_event(sk, kind=9001, tags=[["h", channel_id], ["p", pubkey]])

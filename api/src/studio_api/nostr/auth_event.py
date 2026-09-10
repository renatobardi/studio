"""NIP-42: verification of the canonical `kind:22242` client authentication
event sent in response to the relay's AUTH challenge."""

from dataclasses import dataclass

from studio_api.nostr.crypto import has_valid_integrity
from studio_api.nostr.model import NostrEvent, first_tag_value

AUTH_KIND = 22242
CHALLENGE_TOLERANCE_SECONDS = 10 * 60


@dataclass(frozen=True)
class AuthRejection:
    message: str


def verify_auth_event(
    event: NostrEvent, *, relay_url: str, expected_challenge: str, now: int
) -> str | AuthRejection:
    """Returns the authenticated pubkey, or an AuthRejection explaining why not."""
    if event["kind"] != AUTH_KIND:
        return AuthRejection("wrong kind")
    if not has_valid_integrity(event):
        return AuthRejection("id/signature is invalid")
    if abs(now - event["created_at"]) > CHALLENGE_TOLERANCE_SECONDS:
        return AuthRejection("created_at is too far from now")
    if first_tag_value(event, "relay") != relay_url:
        return AuthRejection("relay tag does not match this relay")
    if first_tag_value(event, "challenge") != expected_challenge:
        return AuthRejection("challenge does not match")
    return event["pubkey"]

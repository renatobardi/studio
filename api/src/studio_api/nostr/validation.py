"""Event validity: id/signature, the created_at window, and published size
limits — the checks that gate every incoming EVENT before it reaches the
store (ticket #2)."""

from dataclasses import dataclass

from studio_api.nostr.crypto import has_valid_integrity
from studio_api.nostr.model import NostrEvent

FUTURE_TOLERANCE_SECONDS = 15 * 60
PAST_TOLERANCE_SECONDS = 30 * 24 * 60 * 60

# Published verbatim in the NIP-11 `limitation` object so clients know what
# a submission may not exceed.
LIMITATION = {
    "max_content_length": 8_196,
    "max_event_tags": 2_000,
    "created_at_lower_limit": PAST_TOLERANCE_SECONDS,
    "created_at_upper_limit": FUTURE_TOLERANCE_SECONDS,
}


@dataclass(frozen=True)
class EventRejection:
    prefix: str
    message: str


def validate_event(event: NostrEvent, *, now: int) -> EventRejection | None:
    if not has_valid_integrity(event):
        return EventRejection("invalid", "id/signature is invalid")
    if event["created_at"] > now + FUTURE_TOLERANCE_SECONDS:
        return EventRejection("invalid", "created_at is too far in the future")
    if event["created_at"] < now - PAST_TOLERANCE_SECONDS:
        return EventRejection("invalid", "created_at is too far in the past")
    if len(event["content"]) > LIMITATION["max_content_length"]:
        return EventRejection(
            "invalid", f"content exceeds the {LIMITATION['max_content_length']}-character limit"
        )
    if len(event["tags"]) > LIMITATION["max_event_tags"]:
        return EventRejection("invalid", f"more than {LIMITATION['max_event_tags']} tags")
    return None

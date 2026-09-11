"""Event validity: id/signature, the created_at window, and published size
limits — the checks that gate every incoming EVENT before it reaches the
store (ticket #2)."""

from dataclasses import dataclass

from studio_api.nostr.crypto import has_valid_integrity
from studio_api.nostr.model import NostrEvent, first_tag_value

FUTURE_TOLERANCE_SECONDS = 15 * 60
PAST_TOLERANCE_SECONDS = 30 * 24 * 60 * 60

MESSAGE = 9
REACTION = 7
THREAD_REPLY = 1111

# The tag naming a Thread Reply's root / a Reaction's target event — the single source of truth
# for which tag `relay.py` must look up to check that root/target is in the same Channel.
ROOT_TAG_BY_KIND = {THREAD_REPLY: "E", REACTION: "e"}

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
    return _validate_content_kind_tags(event)


def _require_tags(event: NostrEvent, names: tuple[str, ...], *, kind_label: str) -> EventRejection | None:
    for name in names:
        if first_tag_value(event, name) is None:
            return EventRejection("invalid", f"a {kind_label} requires a {name} tag")
    return None


def _validate_message_tags(event: NostrEvent) -> EventRejection | None:
    return _require_tags(event, ("h",), kind_label="Message")


def _validate_reaction_tags(event: NostrEvent) -> EventRejection | None:
    return _require_tags(event, ("h", "e", "k", "p"), kind_label="Reaction")


def _validate_thread_reply_tags(event: NostrEvent) -> EventRejection | None:
    rejection = _require_tags(event, ("h", "E", "K", "P", "e", "k", "p"), kind_label="Thread Reply")
    if rejection is not None:
        return rejection
    for lower, upper in (("e", "E"), ("k", "K"), ("p", "P")):
        if first_tag_value(event, lower) != first_tag_value(event, upper):
            return EventRejection("invalid", f"a Thread Reply's {lower} tag must match its {upper} tag")
    return None


_CONTENT_KIND_VALIDATORS = {
    MESSAGE: _validate_message_tags,
    THREAD_REPLY: _validate_thread_reply_tags,
    REACTION: _validate_reaction_tags,
}


def _validate_content_kind_tags(event: NostrEvent) -> EventRejection | None:
    """Ticket #5: Messages, Thread Replies and Reactions each require a
    fixed set of tags identifying their Channel and, for replies/reactions,
    the Message they target."""
    validator = _CONTENT_KIND_VALIDATORS.get(event["kind"])
    return validator(event) if validator is not None else None

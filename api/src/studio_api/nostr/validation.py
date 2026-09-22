"""Event validity: id/signature, the created_at window, and published size
limits — the checks that gate every incoming EVENT before it reaches the
store (ticket #2)."""

from dataclasses import dataclass
from typing import Any

from studio_api.nostr.crypto import has_valid_integrity
from studio_api.nostr.model import NostrEvent, first_tag_value

FUTURE_TOLERANCE_SECONDS = 15 * 60
PAST_TOLERANCE_SECONDS = 30 * 24 * 60 * 60

MESSAGE = 9
REACTION = 7
THREAD_REPLY = 1111
DELETION = 5
GIFT_WRAP = 1059

# How far back a kind may be stamped when it reaches the relay, where it is narrower than
# PAST_TOLERANCE_SECONDS (ADR-0008). A client asks again after a reconnect with `since` = the
# newest event it holds less this and FUTURE_TOLERANCE_SECONDS (web/src/lib/channelPagination.ts,
# dmPagination.ts): what was accepted while it was away can be stamped no earlier than that, so
# nothing is skipped. A Channel's content is stamped when it is sent; a gift wrap is backdated by
# up to two days (NIP-59), plus the hour for another client's clock. The hour binds every deletion
# (kind 5), not only a Channel's: the kind is what the relay can see, and nothing in Studio deletes
# anything long after deciding to.
PAST_TOLERANCE_BY_KIND = {
    MESSAGE: 60 * 60,
    REACTION: 60 * 60,
    THREAD_REPLY: 60 * 60,
    DELETION: 60 * 60,
    GIFT_WRAP: 2 * 24 * 60 * 60 + 60 * 60,
}

# The tag naming a Thread Reply's root / a Reaction's target event — the single source of truth
# for which tag `relay.py` must look up to check that root/target is in the same Channel.
ROOT_TAG_BY_KIND = {THREAD_REPLY: "E", REACTION: "e"}

# Published verbatim in the NIP-11 `limitation` object so clients know what
# a submission may not exceed. NIP-11 cannot state a limit per kind, so
# `created_at_lower_limit` is the 30 days most kinds get; a kind in
# PAST_TOLERANCE_BY_KIND is told its own, narrower one in the OK that refuses it.
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


_EVENT_FIELD_TYPES: dict[str, type] = {
    "id": str,
    "pubkey": str,
    "created_at": int,
    "kind": int,
    "tags": list,
    "content": str,
    "sig": str,
}


def malformed_event_rejection(payload: Any) -> EventRejection | None:
    """Whether an EVENT/AUTH payload is a Nostr event at all — it arrives as
    arbitrary JSON, so every field has to be proven present and of the right
    type before any other check may index into it (ticket #52)."""
    if not isinstance(payload, dict):
        return EventRejection("invalid", "an event must be a JSON object")
    for name, expected in _EVENT_FIELD_TYPES.items():
        value = payload.get(name)
        # `bool` is a subclass of `int`, so `True` would otherwise pass as a
        # `kind` or a `created_at`.
        if not isinstance(value, expected) or isinstance(value, bool):
            return EventRejection("invalid", f"an event's {name} is missing or of the wrong type")
    if not all(
        isinstance(tag, list) and all(isinstance(value, str) for value in tag)
        for tag in payload["tags"]
    ):
        return EventRejection("invalid", "an event's tags must be arrays of strings")
    return None


def validate_event(event: NostrEvent, *, now: int) -> EventRejection | None:
    if not has_valid_integrity(event):
        return EventRejection("invalid", "id/signature is invalid")
    if event["created_at"] > now + FUTURE_TOLERANCE_SECONDS:
        return EventRejection("invalid", "created_at is too far in the future")
    past_tolerance = PAST_TOLERANCE_BY_KIND.get(event["kind"], PAST_TOLERANCE_SECONDS)
    if event["created_at"] < now - past_tolerance:
        return EventRejection(
            "invalid",
            f"created_at is too far in the past for kind {event['kind']} (max {past_tolerance}s)",
        )
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


def _validate_gift_wrap_tags(event: NostrEvent) -> EventRejection | None:
    return _require_tags(event, ("p",), kind_label="Gift Wrap")


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
    GIFT_WRAP: _validate_gift_wrap_tags,
}


def _validate_content_kind_tags(event: NostrEvent) -> EventRejection | None:
    """Ticket #5: Messages, Thread Replies and Reactions each require a
    fixed set of tags identifying their Channel and, for replies/reactions,
    the Message they target."""
    validator = _CONTENT_KIND_VALIDATORS.get(event["kind"])
    return validator(event) if validator is not None else None

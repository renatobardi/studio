"""NIP-11: the relay information document."""

from typing import Any

from studio_api.nostr.validation import LIMITATION

SUPPORTED_NIPS = [1, 11, 42]


def build_info_document(*, name: str) -> dict[str, Any]:
    return {
        "name": name,
        "supported_nips": SUPPORTED_NIPS,
        "limitation": {
            "max_content_length": LIMITATION["max_content_length"],
            "max_event_tags": LIMITATION["max_event_tags"],
            "created_at_lower_limit": LIMITATION["created_at_lower_limit"],
            "created_at_upper_limit": LIMITATION["created_at_upper_limit"],
            "auth_required": True,
            "restricted_writes": True,
        },
    }

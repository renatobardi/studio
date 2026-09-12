"""NIP-11: the relay information document."""

from typing import Any

from studio_api.nostr.limits import CONNECTION_LIMITATION
from studio_api.nostr.validation import LIMITATION

SUPPORTED_NIPS = [1, 11, 17, 29, 42, 43, 44, 59]


def build_info_document(*, name: str, self_pubkey: str | None = None) -> dict[str, Any]:
    document: dict[str, Any] = {
        "name": name,
        "supported_nips": SUPPORTED_NIPS,
        "limitation": {
            **CONNECTION_LIMITATION,
            "max_content_length": LIMITATION["max_content_length"],
            "max_event_tags": LIMITATION["max_event_tags"],
            "created_at_lower_limit": LIMITATION["created_at_lower_limit"],
            "created_at_upper_limit": LIMITATION["created_at_upper_limit"],
            "auth_required": True,
            "restricted_writes": True,
        },
    }
    if self_pubkey is not None:
        document["self"] = self_pubkey
        document["pubkey"] = self_pubkey
    return document

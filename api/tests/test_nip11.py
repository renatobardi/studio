"""RED: the NIP-11 relay information document."""

import json

from studio_api.nostr.limits import CONNECTION_LIMITATION
from studio_api.nostr.nip11 import SUPPORTED_NIPS, build_info_document
from studio_api.nostr.validation import LIMITATION


def test_document_names_the_relay() -> None:
    document = build_info_document(name="Studio")

    assert document["name"] == "Studio"


def test_self_is_the_workspace_key_pubkey_when_given() -> None:
    document = build_info_document(name="Studio", self_pubkey="a" * 64)

    assert document["self"] == "a" * 64
    assert document["pubkey"] == "a" * 64


def test_self_is_omitted_when_not_given() -> None:
    document = build_info_document(name="Studio")

    assert "self" not in document
    assert "pubkey" not in document


def test_document_advertises_the_supported_nips() -> None:
    document = build_info_document(name="Studio")

    assert document["supported_nips"] == SUPPORTED_NIPS
    assert {1, 11, 42}.issubset(set(SUPPORTED_NIPS))


def test_document_publishes_the_enforced_limits() -> None:
    document = build_info_document(name="Studio")

    limitation = document["limitation"]
    assert limitation["max_content_length"] == LIMITATION["max_content_length"]
    assert limitation["max_event_tags"] == LIMITATION["max_event_tags"]
    assert limitation["created_at_lower_limit"] == LIMITATION["created_at_lower_limit"]
    assert limitation["created_at_upper_limit"] == LIMITATION["created_at_upper_limit"]
    assert limitation["auth_required"] is True


def test_document_publishes_the_connection_caps() -> None:
    document = build_info_document(name="Studio")

    limitation = document["limitation"]
    assert limitation["max_subscriptions"] == CONNECTION_LIMITATION["max_subscriptions"]
    assert limitation["max_filters"] == CONNECTION_LIMITATION["max_filters"]
    assert limitation["max_limit"] == CONNECTION_LIMITATION["max_limit"]
    assert limitation["max_message_length"] == CONNECTION_LIMITATION["max_message_length"]


def test_the_frame_limit_admits_the_largest_event_the_relay_calls_valid() -> None:
    """The two sets of published limits have to agree: an event within the
    event limits must be answerable with an OK, not by closing the socket for
    being too long (ticket #52)."""
    largest_legal_event = {
        "id": "a" * 64,
        "pubkey": "b" * 64,
        "created_at": 1_800_000_000,
        "kind": 1,
        "tags": [["e", "c" * 64, "wss://relay.example.com"]] * LIMITATION["max_event_tags"],
        "content": "x" * LIMITATION["max_content_length"],
        "sig": "d" * 128,
    }
    frame = json.dumps(["EVENT", largest_legal_event])

    assert len(frame) < CONNECTION_LIMITATION["max_message_length"]

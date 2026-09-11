"""RED: extracting sha256 blob references out of an event's `imeta` tags
(ticket #6) — parsing only, no storage involved."""

from studio_api.media.imeta import imeta_sha256s
from studio_api.nostr.model import NostrEvent

SHA_A = "a" * 64
SHA_B = "b" * 64


def _event(tags: list[list[str]]) -> NostrEvent:
    return {
        "id": "id",
        "pubkey": "pk",
        "created_at": 0,
        "kind": 9,
        "tags": tags,
        "content": "",
        "sig": "sig",
    }


def test_no_imeta_tags_yields_no_references() -> None:
    assert imeta_sha256s(_event([["h", "chan1"]])) == []


def test_extracts_the_sha256_from_a_single_imeta_tag() -> None:
    event = _event([["h", "chan1"], ["imeta", "url https://x/1", "m image/jpeg", f"x {SHA_A}"]])

    assert imeta_sha256s(event) == [SHA_A]


def test_extracts_from_multiple_imeta_tags() -> None:
    event = _event(
        [
            ["h", "chan1"],
            ["imeta", f"x {SHA_A}"],
            ["imeta", f"x {SHA_B}"],
        ]
    )

    assert imeta_sha256s(event) == [SHA_A, SHA_B]


def test_an_imeta_tag_without_an_x_item_contributes_nothing() -> None:
    event = _event([["imeta", "url https://x/1", "m image/jpeg"]])

    assert imeta_sha256s(event) == []

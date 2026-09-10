"""RED: canonical serialization (NIP-01) and Schnorr signature verification
(BIP-340), the primitives every event validation depends on.
"""

from support import new_keypair, sign_event

from studio_api.nostr.crypto import (
    compute_event_id,
    serialize_for_id,
    verify_event_signature,
)
from studio_api.nostr.model import NostrEvent


def test_serialize_for_id_matches_the_nip01_canonical_form() -> None:
    event: NostrEvent = {
        "id": "",
        "pubkey": "b" * 64,
        "created_at": 1_700_000_000,
        "kind": 1,
        "tags": [["e", "abc"]],
        "content": "hello",
        "sig": "",
    }

    serialized = serialize_for_id(event)

    assert serialized == (
        b'[0,"' + b"b" * 64 + b'",1700000000,1,[["e","abc"]],"hello"]'
    )


def test_serialize_for_id_escapes_control_characters_in_content() -> None:
    event: NostrEvent = {
        "id": "",
        "pubkey": "b" * 64,
        "created_at": 1,
        "kind": 1,
        "tags": [],
        "content": 'line one\nline "two"\\end',
        "sig": "",
    }

    serialized = serialize_for_id(event)

    assert serialized.endswith(b'"line one\\nline \\"two\\"\\\\end"]')


def test_compute_event_id_is_the_sha256_of_the_canonical_form() -> None:
    import hashlib

    event: NostrEvent = {
        "id": "",
        "pubkey": "c" * 64,
        "created_at": 42,
        "kind": 1,
        "tags": [],
        "content": "x",
        "sig": "",
    }

    expected = hashlib.sha256(serialize_for_id(event)).hexdigest()

    assert compute_event_id(event) == expected


def test_verify_event_signature_accepts_a_validly_signed_event() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=1, kind=1, content="hi")

    assert verify_event_signature(event) is True


def test_verify_event_signature_rejects_a_tampered_id() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=1, kind=1, content="hi")
    tampered: NostrEvent = {**event, "id": "a" * 64}

    assert verify_event_signature(tampered) is False


def test_verify_event_signature_rejects_a_signature_from_a_different_key() -> None:
    sk1, pubkey1 = new_keypair()
    _sk2, pubkey2 = new_keypair()
    event = sign_event(sk1, pubkey=pubkey1, created_at=1, kind=1, content="hi")
    wrong_author: NostrEvent = {**event, "pubkey": pubkey2}

    assert verify_event_signature(wrong_author) is False


def test_verify_event_signature_rejects_malformed_hex() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=1, kind=1, content="hi")
    malformed: NostrEvent = {**event, "sig": "not-hex"}

    assert verify_event_signature(malformed) is False

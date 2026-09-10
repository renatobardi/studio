"""RED: event validity per ticket #2 — id/signature, created_at window
(15 min future / 30 days past), and published size limits.
"""

from support import new_keypair, sign_event

from studio_api.nostr.model import NostrEvent
from studio_api.nostr.validation import (
    LIMITATION,
    validate_event,
)

NOW = 1_700_000_000


def test_a_well_formed_event_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1, content="hi")

    assert validate_event(event, now=NOW) is None


def test_a_tampered_id_is_rejected_as_invalid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1, content="hi")
    tampered: NostrEvent = {**event, "content": "tampered after signing"}

    rejection = validate_event(tampered, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_a_bad_signature_is_rejected_as_invalid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1, content="hi")
    bad_sig: NostrEvent = {**event, "sig": "00" * 64}

    rejection = validate_event(bad_sig, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_created_at_just_within_future_tolerance_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW + 15 * 60, kind=1)

    assert validate_event(event, now=NOW) is None


def test_created_at_beyond_future_tolerance_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW + 15 * 60 + 1, kind=1)

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_created_at_just_within_past_tolerance_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW - 30 * 24 * 60 * 60, kind=1)

    assert validate_event(event, now=NOW) is None


def test_created_at_beyond_past_tolerance_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW - 30 * 24 * 60 * 60 - 1, kind=1)

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_content_over_the_limit_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(
        sk, pubkey=pubkey, created_at=NOW, kind=1, content="x" * (LIMITATION["max_content_length"] + 1)
    )

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_content_at_the_limit_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(
        sk, pubkey=pubkey, created_at=NOW, kind=1, content="x" * LIMITATION["max_content_length"]
    )

    assert validate_event(event, now=NOW) is None


def test_too_many_tags_is_rejected() -> None:
    sk, pubkey = new_keypair()
    tags = [["t", str(i)] for i in range(LIMITATION["max_event_tags"] + 1)]
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1, tags=tags)

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"

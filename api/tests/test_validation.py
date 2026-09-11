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


def test_a_message_without_an_h_tag_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=9, tags=[])

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_a_message_with_an_h_tag_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=9, tags=[["h", "chan1"]])

    assert validate_event(event, now=NOW) is None


def _thread_reply_tags(*, h: str = "chan1", root_id: str = "root1", root_pubkey: str = "author1") -> list[list[str]]:
    return [
        ["h", h],
        ["E", root_id], ["K", "9"], ["P", root_pubkey],
        ["e", root_id], ["k", "9"], ["p", root_pubkey],
    ]


def test_a_thread_reply_with_all_required_tags_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1111, tags=_thread_reply_tags())

    assert validate_event(event, now=NOW) is None


def test_a_thread_reply_missing_a_required_tag_is_rejected() -> None:
    sk, pubkey = new_keypair()
    tags = [t for t in _thread_reply_tags() if t[0] != "P"]
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1111, tags=tags)

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_a_thread_reply_whose_reply_tags_dont_match_the_root_tags_is_rejected() -> None:
    sk, pubkey = new_keypair()
    tags = _thread_reply_tags()
    tags = [["e", "other-event"] if t[0] == "e" else t for t in tags]
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1111, tags=tags)

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def _reaction_tags(*, h: str = "chan1", target_id: str = "msg1", target_pubkey: str = "author1") -> list[list[str]]:
    return [["h", h], ["e", target_id], ["k", "9"], ["p", target_pubkey]]


def test_a_reaction_with_all_required_tags_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=7, tags=_reaction_tags(), content="+")

    assert validate_event(event, now=NOW) is None


def test_a_reaction_missing_a_required_tag_is_rejected() -> None:
    sk, pubkey = new_keypair()
    tags = [t for t in _reaction_tags() if t[0] != "k"]
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=7, tags=tags, content="+")

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"


def test_a_gift_wrap_with_a_p_tag_is_valid() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(
        sk, pubkey=pubkey, created_at=NOW, kind=1059, tags=[["p", "b" * 64]], content="ciphertext"
    )

    assert validate_event(event, now=NOW) is None


def test_a_gift_wrap_without_a_p_tag_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=1059, tags=[], content="ciphertext")

    rejection = validate_event(event, now=NOW)

    assert rejection is not None
    assert rejection.prefix == "invalid"

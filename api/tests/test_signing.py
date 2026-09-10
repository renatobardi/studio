"""RED: server-side event signing — the primitive every NIP-43/NIP-29
projection (and any other server-generated event) builds on."""

import time

from coincurve import PrivateKey

from studio_api.nostr.crypto import verify_event_signature
from studio_api.nostr.signing import sign_event


def test_signs_a_well_formed_event() -> None:
    sk = PrivateKey()

    event = sign_event(sk, kind=1, tags=[["t", "x"]], content="hi", created_at=1_700_000_000)

    assert event["kind"] == 1
    assert event["tags"] == [["t", "x"]]
    assert event["content"] == "hi"
    assert event["created_at"] == 1_700_000_000
    assert event["pubkey"] == sk.public_key_xonly.format().hex()
    assert verify_event_signature(event) is True


def test_defaults_content_to_empty_string() -> None:
    sk = PrivateKey()

    event = sign_event(sk, kind=13534, tags=[], created_at=1)

    assert event["content"] == ""


def test_defaults_created_at_to_now() -> None:
    sk = PrivateKey()
    before = int(time.time())

    event = sign_event(sk, kind=1, tags=[])

    after = int(time.time())
    assert before <= event["created_at"] <= after

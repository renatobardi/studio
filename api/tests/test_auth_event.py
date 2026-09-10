"""RED: NIP-42 canonical authentication event verification — the AUTH
handshake's crypto and freshness checks, independent of any connection
state machine.
"""

from coincurve import PrivateKey
from support import make_auth_event as _make_auth_event
from support import new_keypair, sign_event

from studio_api.nostr.auth_event import verify_auth_event
from studio_api.nostr.model import NostrEvent

RELAY_URL = "wss://relay.example.com/relay/family"
CHALLENGE = "abc123challenge"
NOW = 1_700_000_000


def make_auth_event(
    sk: PrivateKey,
    pubkey: str,
    *,
    relay: str = RELAY_URL,
    challenge: str = CHALLENGE,
    created_at: int = NOW,
) -> NostrEvent:
    return _make_auth_event(sk, pubkey, relay_url=relay, challenge=challenge, created_at=created_at)


def test_a_well_formed_auth_event_resolves_to_its_author_pubkey() -> None:
    sk, pubkey = new_keypair()
    event = make_auth_event(sk, pubkey)

    result = verify_auth_event(event, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert result == pubkey


def test_wrong_kind_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(
        sk, pubkey=pubkey, created_at=NOW, kind=1,
        tags=[["relay", RELAY_URL], ["challenge", CHALLENGE]],
    )

    result = verify_auth_event(event, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert isinstance(result, str) is False


def test_tampered_event_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = make_auth_event(sk, pubkey)
    tampered: NostrEvent = {**event, "tags": [["relay", RELAY_URL], ["challenge", "different"]]}

    result = verify_auth_event(tampered, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert isinstance(result, str) is False


def test_wrong_challenge_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = make_auth_event(sk, pubkey, challenge="not-the-challenge")

    result = verify_auth_event(event, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert isinstance(result, str) is False


def test_wrong_relay_url_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = make_auth_event(sk, pubkey, relay="wss://someone-elses-relay.example.com")

    result = verify_auth_event(event, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert isinstance(result, str) is False


def test_stale_auth_event_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = make_auth_event(sk, pubkey, created_at=NOW - 20 * 60)

    result = verify_auth_event(event, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert isinstance(result, str) is False


def test_missing_challenge_tag_is_rejected() -> None:
    sk, pubkey = new_keypair()
    event = sign_event(sk, pubkey=pubkey, created_at=NOW, kind=22242, tags=[["relay", RELAY_URL]])

    result = verify_auth_event(event, relay_url=RELAY_URL, expected_challenge=CHALLENGE, now=NOW)

    assert isinstance(result, str) is False

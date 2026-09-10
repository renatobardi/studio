"""NIP-01 canonical serialization and BIP-340 Schnorr signature verification."""

import hashlib
import json

from coincurve import PublicKeyXOnly

from studio_api.nostr.model import NostrEvent


def serialize_for_id(event: NostrEvent) -> bytes:
    """The exact byte sequence an event's id is the sha256 of (NIP-01)."""
    data = [
        0,
        event["pubkey"],
        event["created_at"],
        event["kind"],
        event["tags"],
        event["content"],
    ]
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def compute_event_id(event: NostrEvent) -> str:
    return hashlib.sha256(serialize_for_id(event)).hexdigest()


def verify_event_signature(event: NostrEvent) -> bool:
    try:
        pubkey_bytes = bytes.fromhex(event["pubkey"])
        sig_bytes = bytes.fromhex(event["sig"])
        id_bytes = bytes.fromhex(event["id"])
    except ValueError:
        return False
    if len(pubkey_bytes) != 32 or len(sig_bytes) != 64 or len(id_bytes) != 32:
        return False
    try:
        return bool(PublicKeyXOnly(pubkey_bytes).verify(sig_bytes, id_bytes))
    except Exception:  # noqa: BLE001 — a malformed/invalid key or signature just fails verification
        return False


def has_valid_integrity(event: NostrEvent) -> bool:
    """The id matches the event's own contents and the signature is valid —
    the two checks every NIP that verifies an event (NIP-01 EVENT, NIP-42
    AUTH, NIP-98 HTTP Auth) starts with."""
    return compute_event_id(event) == event["id"] and verify_event_signature(event)

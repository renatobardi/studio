"""Test-only helpers for building real, validly-signed Nostr events.

Not a test module itself — no `test_` functions live here.
"""

import asyncio
from collections.abc import Callable
from typing import Any

from coincurve import PrivateKey

from studio_api.nostr.crypto import compute_event_id
from studio_api.nostr.model import NostrEvent


class Recorder:
    """Collects messages a RelayConnection sends, in order."""

    def __init__(self) -> None:
        self.sent: list[list[Any]] = []

    async def __call__(self, message: list[Any]) -> None:
        self.sent.append(message)

    def of_type(self, message_type: str) -> list[list[Any]]:
        return [m for m in self.sent if m[0] == message_type]


async def wait_until(predicate: Callable[[], bool], *, timeout: float = 2.0) -> None:
    """Poll a predicate until true — used to wait for a background live-fanout
    delivery without a fixed sleep."""
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


def new_keypair() -> tuple[PrivateKey, str]:
    """Returns (private key, hex x-only pubkey)."""
    sk = PrivateKey()
    return sk, sk.public_key_xonly.format().hex()


def sign_event(
    sk: PrivateKey,
    *,
    pubkey: str,
    created_at: int,
    kind: int,
    tags: list[list[str]] | None = None,
    content: str = "",
) -> NostrEvent:
    unsigned: NostrEvent = {
        "id": "",
        "pubkey": pubkey,
        "created_at": created_at,
        "kind": kind,
        "tags": tags or [],
        "content": content,
        "sig": "",
    }
    event_id = compute_event_id(unsigned)
    sig = sk.sign_schnorr(bytes.fromhex(event_id))
    return {**unsigned, "id": event_id, "sig": sig.hex()}


def make_auth_event(
    sk: PrivateKey, pubkey: str, *, relay_url: str, challenge: str, created_at: int
) -> NostrEvent:
    return sign_event(
        sk,
        pubkey=pubkey,
        created_at=created_at,
        kind=22242,
        tags=[["relay", relay_url], ["challenge", challenge]],
    )

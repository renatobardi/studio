"""Server-side event construction: sign an event with a given key. Used by
the NIP-43/NIP-29 projection (Workspace Key) and anywhere else the server
itself publishes an event, as opposed to verifying one a client sent."""

import time

from coincurve import PrivateKey

from studio_api.nostr.crypto import compute_event_id
from studio_api.nostr.model import NostrEvent, Tag


def sign_event(
    sk: PrivateKey,
    *,
    kind: int,
    tags: list[Tag],
    content: str = "",
    created_at: int | None = None,
) -> NostrEvent:
    unsigned: NostrEvent = {
        "id": "",
        "pubkey": sk.public_key_xonly.format().hex(),
        "created_at": created_at if created_at is not None else int(time.time()),
        "kind": kind,
        "tags": tags,
        "content": content,
        "sig": "",
    }
    event_id = compute_event_id(unsigned)
    sig = sk.sign_schnorr(bytes.fromhex(event_id))
    return {**unsigned, "id": event_id, "sig": sig.hex()}

"""NIP-92 `imeta` tags: each item after "imeta" is "key value1 value2...",
not a separate Nostr tag. We only need the `x` (sha256) out of each one, to
record which blobs a Message references."""

from studio_api.nostr.model import NostrEvent


def imeta_sha256s(event: NostrEvent) -> list[str]:
    sha256s = []
    for tag in event["tags"]:
        if not tag or tag[0] != "imeta":
            continue
        for item in tag[1:]:
            key, _, value = item.partition(" ")
            if key == "x" and value:
                sha256s.append(value)
    return sha256s

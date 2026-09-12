"""What one relay connection may ask for (ticket #52).

Deliberately plain per-connection ceilings — no distributed rate limiting, no
extra infrastructure — published verbatim in the NIP-11 `limitation` object so
a client can read them instead of discovering them by being refused. Separate
from `validation.LIMITATION`, which bounds a single event rather than a
connection; they live apart so the NIP-11 document can name both without
reaching into the relay's own machinery.

The subscription ceiling sits well above what this project's own client
legitimately opens: web/ holds a handful per open pane plus one growing kind 0
lookup (web/src/lib/profileStore.ts), on the order of a dozen for a Workspace
of a household's size. The cap is here to stop a connection opening
subscriptions without end, not to second-guess a working client.

It was first set at 64 rather than 20 for a second reason that no longer
holds: `useProfiles` leaked one subscription per batch of profiles and the
client dropped CLOSED frames, so a cap it could reach would have failed
silently in the UI. #90 fixed both — the lookup is one subscription now, and a
refusal reaches the subscription's handlers. The headroom is kept because
nothing needs it spent, not because the client still requires it.
"""

MAX_SUBSCRIPTIONS = 64
MAX_FILTERS_PER_REQ = 10
MAX_LIMIT = 500
# Above the largest event `validation.LIMITATION` still calls valid — 2 000
# tags plus 8 196 characters of content — on purpose: a legal event must be
# answered with an `OK false` from the relay, never by closing the socket
# under it. `test_nip11.py` holds the two sets of limits to that.
MAX_MESSAGE_LENGTH = 512 * 1024

CONNECTION_LIMITATION = {
    "max_subscriptions": MAX_SUBSCRIPTIONS,
    "max_filters": MAX_FILTERS_PER_REQ,
    "max_limit": MAX_LIMIT,
    "max_message_length": MAX_MESSAGE_LENGTH,
}

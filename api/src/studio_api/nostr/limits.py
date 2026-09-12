"""What one relay connection may ask for (ticket #52).

Deliberately plain per-connection ceilings — no distributed rate limiting, no
extra infrastructure — published verbatim in the NIP-11 `limitation` object so
a client can read them instead of discovering them by being refused. Separate
from `validation.LIMITATION`, which bounds a single event rather than a
connection; they live apart so the NIP-11 document can name both without
reaching into the relay's own machinery.

The subscription ceiling is set well above what this project's own client
legitimately opens, not at a tidy round number: web/ keeps one subscription per
Channel pane and one more per batch of profiles it resolves
(web/src/routes/app/useProfiles.ts), so a Workspace of a household's size
reaches a couple of dozen on an ordinary session. The cap is here to stop a
connection opening subscriptions without end, not to second-guess a working
client — which would find out only by having a REQ silently refused.
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

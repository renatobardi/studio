---
status: accepted
---

# Cached media belongs to the Identity that fetched it, and does not outlive its session

Attached images were cached by a service worker route on `/media/{sha256}` (ticket #6), in one
cache shared by the whole origin. Cache Storage has no idea who is asking: the worker answered
from the cache before the request ever reached the server's authorization check (ADR-0006), and
it answered whoever held the browser next. Two people sharing a browser profile — a family
device, a kiosk, a handover — crossed accounts through it, and sign-out emptied a single fixed
cache name, silently, whether or not the delete succeeded (issue #39).

We decided:

- **The page caches, not the worker.** The `/media/…` route is gone from `sw.ts`; the worker
  keeps only the app-shell precache (#8). Caching now happens in `lib/mediaCache.ts`, reached
  from the same code path that already holds the signer and verifies the content hash. Nothing
  answers a media request except code that knows which Identity is asking.
- **One cache per Identity.** The cache is named `studio-media-v1-<pubkey>`, and a fetch only
  ever reads its own. Caching by content hash within that scope is kept — that was the point of
  #6 — but the hash is a key inside an Identity's cache, never a key across the origin.
- **A cache hit is verified like a download.** The sha256 is checked on cached bytes too, and a
  copy that no longer matches is re-downloaded rather than rendered. For a Direct Message photo
  what is cached is the ciphertext: the plaintext exists only in the page (ADR-0003).
- **Sign-out reports what it could not remove.** `clearIdentity` attempts every deletion before
  reporting any of them and throws when something survived; the sign-in screen says so. Taking
  over the browser prunes every media cache that is not the arriving Identity's, which is what
  covers the session that ended without a clean sign-out.

## Consequences

- Revocation does not reach a copy already delivered, here or anywhere. An Identity that loses
  access keeps rendering what it already downloaded for as long as it stays signed in: the cache
  is verified against its content hash, not re-authorized, and it carries no expiry. Sign-out
  and the takeover of the browser are what empty it. Beyond this device nothing is reachable at
  all — a photo saved to disk, a screenshot, another device's copy, a presigned URL still inside
  its 60-second TTL (ADR-0006) — and nothing here should be read as promising otherwise. What is
  guaranteed is narrower and worth stating plainly: no *new* download without the server's
  authorization, and no cached copy of one session answering the next.
- Same-origin code running as the current Identity can enumerate Cache Storage. The scope is a
  boundary between sessions of the app, not a defence against someone driving the browser's
  console — at which point the signed-in Identity's own key is equally reachable.
- The prune at takeover is best effort: it runs while the app is booting, where there is no
  screen to report on and nothing yet to protect. Sign-out is the path that reports, because it
  is the one that promises. A takeover that could not clear the previous Identity's cache leaves
  bytes that only that Identity's own pubkey scope can address — unreadable to the arriving one,
  but still on the device.
- Two Identities alternating in one browser profile re-download what the other had cached. That
  is the intended cost: each pays for its own authorization check.
- The cache no longer survives a switch of Identity, so offline reads after a handover start
  cold. The app shell still opens offline.

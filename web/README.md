# Studio web (tickets #4, #5)

Bun + Vite + React + TypeScript PWA: Firebase auth, Nostr Identity onboarding, Key Backup, and
the app shell. Serves as the `web` service in the Compose stack, proxied by Caddy — same-origin
`/api/*` and `/relay/*`.

## Setup

```bash
bun install
```

Client Firebase config comes from `web/.env` (gitignored) — see
`../scripts/ops/create-firebase-project.sh` to generate it against a real Firebase project.
Without it, the auth screens render but Firebase calls fail.

```bash
bun dev          # http://localhost:5173
bun run build    # typecheck + production build
bun run lint
bun test         # pure-logic unit tests (identity, backup crypto, routing, auth error mapping,
                 # channel event builders/grouping, relay client reconnection)
bun run test:e2e # Playwright flows 1, 2, 3 & 5 — needs STUDIO_TEST_* env, see scripts/ops/seed-e2e-test-account.sh
```

## Layout

- `src/lib/` — framework-free logic: `identity.ts` (keypair, kind 0/10050 events), `backup.ts`
  (age passphrase encryption), `custody.ts` (IndexedDB / NIP-07 signer), `relay.ts` (NIP-42
  handshake + publish, and `RelayClient` — a reconnecting connection with REQ subscriptions),
  `channelEvents.ts` (Message/Thread Reply/Reaction/deletion event builders, reaction grouping,
  reply counting), `api.ts` (control-plane REST client), `routing.ts` (auth/onboarding/app
  routing rule), `authErrors.ts` (Firebase error code → copy).
- `src/routes/auth/` — sign in/up/verify/reset screens.
- `src/routes/onboarding/` — the 8-step flow plus the restore-from-backup path.
- `src/routes/app/` — the Channel experience (ticket #5): `AppShell` (connection + Channel list),
  `ChannelView` (owns the one subscription per Channel, shared by `Timeline` and the side panes),
  `Timeline`, `ThreadPane`, `MembersPane`, `ReactionBar`, `ConnectionBadge`.

## Known gaps

- UI is functionally complete per ticket #4's acceptance criteria and uses the Kubo tokens
  (`src/styles/tokens/`), but is not a pixel-for-pixel port of `docs/UI/design/Studio.dc.html`
  (13k lines) — copy and states match the written handoff (`docs/UI/README.md`), not the
  prototype's exact micro-layout.
- The `backup-options` / `download` / `setup` / `config` step boundaries and the restore entry
  point aren't specified verbatim in the handoff doc; this implementation's split (passphrase
  entry → verify+upload → connect+publish → finish) is a reasonable interpretation, not a
  transcription.
- Restore (`OnboardingScreen`'s `restore` step) still redeems the invite code the person enters,
  same as a fresh identity — Invite redemption is idempotent server-side (`repository.py`), so
  this just re-confirms membership rather than minting a second one. It does mean restore needs
  a still-valid invite code, not just the Key Backup passphrase.
- Live-relay integration (invite preview → NIP-98 redeem → NIP-42 auth → publish kind 0) and the
  `App.tsx` resume-on-reload path (fetch the last-joined Workspace via the stored slug + a fresh
  NIP-98 proof) were both run against `docker compose up` in this environment and work. What's
  *not* verified here: the Firebase auth screens and Google popup — no real Firebase project was
  available in this environment; see `scripts/ops/create-firebase-project.sh`.
- Ticket #5's Channel UI (`src/routes/app/`) is a functional, not pixel-for-pixel, reading of
  `docs/UI/design/Studio.dc.html` — same gap as ticket #4's onboarding UI, same reason (no
  Firebase project in this environment to drive the real screens by hand). The relay-facing half
  (event tag shapes, channel/root validation, subscribe+reconnect) was verified against the real
  running stack (`docker compose up`) with a hand-rolled NIP-98 + WebSocket client mirroring
  `scripts/interop/smoke.mjs`'s approach: publish/reject a Message with/without an `h` tag, a
  Thread Reply, a Reaction, its removal, read the timeline back, and read the kind 39002 members
  projection — all matched what `channelEvents.ts` builds and what `validation.py`/`relay.py` now
  enforce. `send-message.spec.ts` and `thread-and-reactions.spec.ts` (flows 2 & 3) were written
  against that same UI but, like flows 1 & 5, need a real deployed `studio-test` and
  `STUDIO_TEST_*` env to actually run — not exercised end-to-end here.
- Channel unread indication is in-memory only (cleared on reload) — no per-viewer read-state is
  persisted anywhere; a channel is marked unread if a Message arrives while it isn't the selected
  one. "Load older messages" is an explicit button, not scroll-position detection.
- Reactions load 4 quick emoji (👍🔥❤️😂), not a full picker — the issue doesn't specify one.
- Flows 2 & 3 need two more secrets beyond flows 1/5's: `STUDIO_TEST_WORKSPACE_SLUG` and
  `STUDIO_TEST_OWNER_PRIVATE_KEY_HEX` (a Workspace owner/admin's raw hex private key). Redeeming
  an Invite only grants Workspace membership, never Channel membership, and onboarding/restore
  mint a fresh Identity every run — so `e2e/helpers.ts`'s `ensureChannelMembership` uses that
  owner identity to add the run's Identity to the Workspace's first Channel via the REST API
  before the flow tries to publish anything. Whoever owns/administers the `studio-test` Workspace
  needs to provide that key as a GitHub secret; it was never exercised against a real deployment
  here.

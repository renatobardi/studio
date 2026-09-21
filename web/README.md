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
bun test         # unit tests over src and tools: the framework-free logic (identity, backup
                 # crypto, routing, auth error mapping, channel event builders/grouping, relay
                 # client reconnection) and the component tests — one command, one runner,
                 # see "Component tests" below
bun run test:e2e # Playwright flows 1, 2, 3 & 5 — needs STUDIO_TEST_* env, see scripts/ops/seed-e2e-test-account.sh
bun run test:visual      # flow 10: the MVP screens over preview.html against their baselines (docs/UI/REFERENCE.md)
bun tools/seed-fixtures.ts # flow 11's Channel, thread and Direct Message on studio-test (#157); CD runs it
                           # before every smoke, so a re-seeded studio-test gets them back on the next deploy
bun run capture:reference # re-captures docs/UI/reference from the prototype
```

## Preview harness

`preview.html` (dev server only — Vite builds `index.html` alone) mounts the real screens over
fixed, signed fixtures and a relay that answers from them (`src/preview/`): no Workspace, relay or
Firebase needed. `?screen=channel|channel-thread|channel-members|dm|settings|auth-signin|onboarding-backup…`,
plus `theme`, `density` and `fontScale`. It is what flow 10 compares and what anyone checking a
screen against `docs/UI/reference` opens.

## Component tests

`bun test` renders React in a DOM: **happy-dom** through `@happy-dom/global-registrator`, with
`@testing-library/react` and `@testing-library/user-event` for the queries and the clicks. No
second runner and no second command — `bunfig.toml` preloads `src/lib/testing/dom.ts` for the
whole run, and a `*.test.tsx` next to the component is picked up like any other test.

**Write a component test for the WIRING, never for the decision.** The decision lives in
`src/lib/` — a pure function with its own test and no DOM. What the harness is for is what only
exists between modules: that a component hands the right thing to the right module, that what
comes back reaches the screen, and that a browser API failing is handled where reading the code
was the only proof before. Two examples ship with it: an invite code surviving the trip from
the URL (`App.tsx`) to the onboarding step that redeems it (`App.test.tsx`, #46), and the admin
console's "Copy link" against a clipboard that refuses (`AdminPane.test.tsx`).

**When to write E2E instead.** A Playwright flow costs a deploy and runs against `studio-test`,
so it earns its place only where a real server, a real relay or a real browser is the point:
authorization the API enforces, the service worker, custody under a NIP-07 extension, what a
screen looks like. If a fake relay and a stubbed `api` module would prove the same thing, it is
a component test. See `docs/delivery-gates.md` for what the smoke already covers.

What the harness sets up, and why each piece is there, is written in `src/lib/testing/dom.ts`.
Two rules that bite:

- **`spyOn` patches a module namespace for the whole process.** Restore it (`mock.restore()` in
  an `afterEach`) or it answers the next file's tests, in an order that differs in CI.
- **Never replace a global the DOM owns.** `globalThis.window = …` used to be how a test faked
  a NIP-07 extension; with a DOM in the process it leaves every later file without a window.
  Put the stub *on* the window — `stubNostr` in `src/lib/testing/window.ts`.

## Layout

- `src/lib/` — framework-free logic: `identity.ts` (keypair, kind 0/10050 events), `backup.ts`
  (age passphrase encryption), `custody.ts` (IndexedDB / NIP-07 signer), `relay.ts` (NIP-42
  handshake + publish, and `RelayClient` — a reconnecting connection with REQ subscriptions),
  `channelEvents.ts` (Message/Thread Reply/Reaction/deletion event builders, reaction grouping,
  reply counting), `api.ts` (control-plane REST client), `routing.ts` (auth/onboarding/app
  routing rule), `authErrors.ts` (Firebase error code → copy), `emailVerification.ts` (the one
  email-gate rule `App` and `AuthScreen` share), `relayReasons.ts` (a relay's NIP-01 refusal →
  copy, for the `CLOSED`/`NOTICE`/auth banner and for failed publishes), `memberDirectory.ts`
  (who a Direct Message may be started with).
- `src/routes/auth/` — sign in/up/verify/reset screens.
- `src/routes/onboarding/` — the 8-step flow plus the restore-from-backup path.
- `src/routes/app/` — the Channel experience (ticket #5): `AppShell` (connection, the persistent
  `Sidebar`, appearance), `ChannelView` (owns the one subscription per Channel, shared by
  `Timeline` and the side panes, and measures its own width for `lib/paneLayout.ts`),
  `Timeline`, `ThreadPane`, `MembersPane` (every row opens that Member's profile), `Composer`
  (the multiline ChatInput every conversation shares), `ReactionBar`, `SettingsView`,
  `SignOutDialog`. Direct Messages are listed in the sidebar and open in `ConversationView`,
  full width (#142); a new one starts from `NewMessageDialog`'s `MemberPicker`, over the
  Workspace's member list — there is no pubkey field (#47).
- `src/components/` — `brand/Sakura` (the mark) and `icons/Icon` (Lucide glyphs, path data in
  `icons.ts`).

## Known gaps

- The MVP screens follow `docs/UI/design/Studio.dc.html` per screen (#65); what the
  prototype leaves undefined — the sidebar on a phone, the screens it never draws — is listed
  in `docs/UI/REFERENCE.md` as pending decisions, not guessed.
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

# Studio web (ticket #4)

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
bun test         # pure-logic unit tests (identity, backup crypto, routing, auth error mapping)
bun run test:e2e # Playwright flows 1 & 5 — needs STUDIO_TEST_* env, see scripts/ops/seed-e2e-test-account.sh
```

## Layout

- `src/lib/` — framework-free logic: `identity.ts` (keypair, kind 0/10050 events), `backup.ts`
  (age passphrase encryption), `custody.ts` (IndexedDB / NIP-07 signer), `relay.ts` (NIP-42
  handshake + publish), `api.ts` (control-plane REST client), `routing.ts` (auth/onboarding/app
  routing rule), `authErrors.ts` (Firebase error code → copy).
- `src/routes/auth/` — sign in/up/verify/reset screens.
- `src/routes/onboarding/` — the 8-step flow plus the restore-from-backup path.
- `src/routes/app/` — placeholder app shell (Inbox etc. is ticket #5).

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

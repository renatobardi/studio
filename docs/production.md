# Production

How `studio-prd` is built, what it needs, how a release reaches it and how to
back one out. Issue #54. `studio-test` is covered by `docs/delivery-gates.md`;
backups and restore by `docs/recovery.md`.

## Shape

- An unprivileged LXC container `studio-prd` on `oute-server`, provisioned by
  the `lab` repo's `install-app.sh --name studio-prd --public` — a separate
  install, never a copy of `studio-test`. Its IP and port are in
  `lab/servers/oute-server/PORTS.md`.
- Inside it, `/opt/app` is a git checkout running this repository's
  `docker-compose.yml` unchanged: SurrealDB, MinIO, api, web, Caddy. Caddy
  listens on `:80` inside the container and publishes it on the host port
  `lab`'s inventory allocated to `studio-prd` — `3760`, from `CADDY_HOST_PORT`
  in this container's `.env` (issue #263).
  Its own volumes and its own `.env`: no database, bucket or application
  credential is shared with `studio-test`.
- Public at `https://studio.oute.pro`. TLS ends at the host's Nginx (Certbot
  certificate), which proxies to `<container-ip>:3760`. Caddy trusts that hop's
  `X-Forwarded-Proto`, so the api sees `https`/`wss` — NIP-98 and NIP-42 compare
  signed URLs with that scheme and reject every call without it.

## What the server needs

Nothing beyond the repository and these files, all mode `600`, none committed:

| File in `/opt/app` | Holds | Source of truth |
| --- | --- | --- |
| `.env` | `SURREAL_*`, `MINIO_ROOT_*`, `WORKSPACE_KEY_SECRET`, `CADDY_HOST_PORT` (`3760`), `FIREBASE_CREDENTIALS_FILE` (see `.env.example`) | Vaultwarden, items `studio-prd <NAME>` |
| `secrets/firebase-adminsdk.json` | Service account of the **`studio-prd`** Firebase project, owned by uid `10001` | Vaultwarden, item `studio-prd firebase-adminsdk.json` |
| `web/.env` | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` of the same project — read at image build time | Firebase console of `studio-prd` |

- **No `docker-compose.override.yml`.** `docker-compose.yml` mounts the
  Firebase credential itself from `FIREBASE_CREDENTIALS_FILE`.
- **No `STUDIO_TEST_*` variables.** Production is never seeded with e2e
  Accounts, and the promotion never runs `ensure_e2e_accounts`.
- **Firebase is its own project**, not `studio-oute`: Accounts on production
  are real people, and the e2e tooling deletes and recreates Accounts in the
  project it points at. Authorized domains: `studio.oute.pro` only.
- `WORKSPACE_KEY_SECRET` is generated once, on the server, and copied to
  Vaultwarden before anything is written with it. Losing it makes every
  Workspace Key inert (`docs/recovery.md`).

## Host

- Nginx vhost `studio.oute.pro` → `<container-ip>:3760`, listening on
  `0.0.0.0:443` and the Tailscale IP, with HTTP→HTTPS redirect, WebSocket
  upgrade headers and a long read timeout (the relay is a WebSocket), and
  `client_max_body_size 12m` — the api accepts 10 MiB Attachments and Nginx's
  default of 1 MiB would refuse most photos with a 413.
- `X-Forwarded-Proto https` set by that vhost.
- Backup: `studio-prd` in `lab`'s `inventory.yaml` with the same strategy as
  `studio-test` (`surreal`, `app_dir: /opt/app`, `backup_service:
  app-surrealdb-1`, bucket `studio-media` on `app-minio-1`), then `lab`'s
  `tools/deploy-backup.sh`. Prove it with the restore drill pointed at
  `studio-prd` before the first real user.

## GitHub

Environment **`studio-prd`**, with the repository owner as required reviewer,
holding:

- `TS_AUTHKEY_PRD` — reusable, ephemeral Tailscale key tagged `tag:cd-prd`.
  **It expires** (the current one, generated 2026-09-17 for 90 days, on
  2026-12-16): Promote then fails at "Connect to Tailscale". Renew before that
  — Tailscale admin → Settings → Keys, same flags and tag — and replace the
  secret with `gh secret set TS_AUTHKEY_PRD --env studio-prd`.
- `STUDIO_CD_SSH_KEY` — deploy key allowed to `ssh oute-server` and `lxc exec`.
  Production has its own (`studio-prd-deploy` in `authorized_keys`), so it can
  be revoked without touching `studio-test`'s CD.
- `STUDIO_PRD_SSH_HOST` — the SSH target for `oute-server`.

Referenced by name only, as every CD credential is. The deploy key reaches
`oute-server`, and from there any container, so what separates production is
this Environment's required reviewer, not the key. The reviewer is repository
configuration, not code: confirm it under Settings → Environments before the
first promotion.

## Releasing

1. The commit is on `main`, CI passed, and CD's `deploy-dev` deployed it to
   `studio-test` and its Playwright smoke passed.
2. Actions → **Promote** → Run workflow, `sha` = that full SHA.
3. `gate` refuses the SHA unless a `deploy-dev` job succeeded on exactly it.
   A CD run's own conclusion is not enough: it is green when `deploy-dev`
   stood down for a superseded SHA.
4. `deploy-prd` waits for the Environment's approval, checks out the SHA
   detached in `/opt/app`, rebuilds, and fails unless `git rev-parse HEAD` is
   that SHA. The job summary records the SHA it replaced.
5. It then requires, over public HTTPS with certificate validation,
   `/api/ready`, `/manifest.webmanifest` and `/sw.js`, and runs
   `scripts/ci/cache-headers.sh` — taken from the promoted SHA — to require
   `Cache-Control: no-cache` on the shell and `immutable` on the hashed assets
   (#203). The host's Nginx must pass `Cache-Control` through unchanged — an
   assumption the first promotion with this check is what confirms.
6. **Authenticated smoke, by a person**, with test Accounts of the
   `studio-prd` Firebase project and a Workspace kept for testing only —
   never real people's data: sign in, send a Message in a Channel, attach a photo
   and see it load, exchange a Direct Message with the second test Account,
   install the PWA from the browser. Record the SHA and the result on the
   release's issue or PR.

## Rolling back

Dispatch **Promote** again with the SHA the failed release's summary says it
replaced. The gate accepts it while its CD run is still in the Actions history
(the repository's run retention). Two exceptions: the very first promotion
replaces the checkout `install-app.sh` made, which never went through the
gate — there is nothing to roll back to but the LXD `deploy-*` snapshot — and
an SHA whose CD run has expired is refused like any unproven one.

A third, for as long as the history still reaches across it: an SHA from
before #263 publishes Caddy on `:80`, so rolling back onto one leaves the
host's vhost asking `:3760` of a port nothing listens on. Point the vhost back
at `:80` for the duration of that rollback.

Code rolls back; data does not. A release that changed stored data in a way
the older code cannot read needs a restore instead (`docs/recovery.md`) —
check the diff between the two SHAs before assuming a redeploy is enough.

If the server itself is broken, `install-app.sh` left a `deploy-*` LXD
snapshot, and the nightly Restic backup holds the database and bucket.

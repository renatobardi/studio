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
  `docker-compose.yml` unchanged: SurrealDB, MinIO, api, web, Caddy on `:80`.
  Its own volumes — no database, bucket or credential is shared with
  `studio-test`.
- Public at `https://studio.oute.pro`. TLS ends at the host's Nginx (Certbot
  certificate), which proxies to `<container-ip>:80`. Caddy trusts that hop's
  `X-Forwarded-Proto`, so the api sees `https`/`wss` — NIP-98 and NIP-42 compare
  signed URLs with that scheme and reject every call without it.

## What the server needs

Nothing beyond the repository and these files, all mode `600`, none committed:

| File in `/opt/app` | Holds | Source of truth |
| --- | --- | --- |
| `.env` | `SURREAL_*`, `MINIO_ROOT_*`, `WORKSPACE_KEY_SECRET`, `FIREBASE_CREDENTIALS_FILE` (see `.env.example`) | Vaultwarden, items `studio-prd <NAME>` |
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

- Nginx vhost `studio.oute.pro` → `<container-ip>:80`, listening on
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

- `TS_AUTHKEY_PRD` — reusable, ephemeral Tailscale key for the CD identity.
- `STUDIO_CD_SSH_KEY` — deploy key allowed to `ssh oute-server` and `lxc exec`.
- `STUDIO_PRD_SSH_HOST` — the SSH target for `oute-server`.

Referenced by name only, as every CD credential is.

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
   `/api/ready`, `/manifest.webmanifest` and `/sw.js`.
6. **Authenticated smoke, by a person**, with test Accounts of the
   `studio-prd` Firebase project and a Workspace kept for testing only —
   never real people's data: sign in, send a Channel Message, attach a photo
   and see it load, exchange a Direct Message with the second test Account,
   install the PWA from the browser. Record the SHA and the result on the
   release's issue or PR.

## Rolling back

Dispatch **Promote** again with the SHA the failed release's summary says it
replaced. It went through the same gate, so it is accepted.

Code rolls back; data does not. A release that changed stored data in a way
the older code cannot read needs a restore instead (`docs/recovery.md`) —
check the diff between the two SHAs before assuming a redeploy is enough.

If the server itself is broken, `install-app.sh` left a `deploy-*` LXD
snapshot, and the nightly Restic backup holds the database and bucket.

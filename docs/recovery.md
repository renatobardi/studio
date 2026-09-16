# Recovery

What has to come back before a Studio server counts as restored, and how that
is proven. Issue #53. The schedule, retention and the drill that exercises all
of this live in the `lab` repo (`docs/backup.md`); this file is the
application's half of the contract.

## What a Studio server keeps

Two stores, and neither is a backup of the other:

- **SurrealDB** — events (Messages, Thread Replies, Reactions, gift-wrapped
  Direct Messages), the control plane (Accounts, Workspaces, memberships,
  Channels, Invites, Key Backups) and every Workspace's **encrypted Workspace
  Key**.
- **MinIO** — the Attachment bytes, one object per sha256.

A Message references its Attachment by hash. Restoring one store without the
other gives a timeline pointing at blobs that are not there, which is why the
backup captures both and the audit checks both.

## The Workspace Key secret is part of the backup

`WORKSPACE_KEY_SECRET` encrypts every Workspace Key at rest (ADR-0002). It is
**not** in the database and never in the repository — it lives only in the
server's `.env` and in the secret manager (Vaultwarden). Restore the rows
without it and the `encrypted_key` column is inert: the Workspace can never
sign a membership change again, so the restore is not a restore.

Recovering it is therefore the first step of any recovery, and the audit below
fails loudly when it is wrong:

```bash
export WORKSPACE_KEY_SECRET="$(bw get password 'studio-test WORKSPACE_KEY_SECRET')"
```

The same applies to `SURREAL_PASS` and `MINIO_ROOT_PASSWORD`, which the
restored stack needs to start at all.

## Proving a restore

`studio_api.verify_restore` is the audit. Point it at the **restored** stack
with the same environment the app reads and it prints one JSON report:

```bash
docker run --rm --network <restored-project>_default --env-file <env> \
  app-api python -m studio_api.verify_restore
```

For each Workspace it reports, and exits non-zero unless the whole report is
sound:

| Field | What it proves |
| --- | --- |
| `key_recovered` | The recovered secret decrypts the Workspace Key **and** the key still matches the `key_pubkey` on the row |
| `messages` | Channel timeline events (kind 9) that came back |
| `memberships` | `workspace_member` rows that came back |
| `projections` | Workspace-signed NIP-43/NIP-29 events (`PROJECTION_KINDS`) |
| `unsigned_projections` | Projections that no longer verify — wrong signer, or bytes changed since signing |
| `blobs` / `missing_blobs` / `corrupt_blobs` | Every `blob` row fetched from the bucket and re-hashed against its own sha256 |

A Workspace is sound when its key is recoverable, its members are back and no
projection fails to verify. It is *not* required to be busy — a Workspace
nobody has spoken in yet has no Messages to lose. The restore as a whole is
proven when every Workspace is sound, no blob is missing or corrupt, and
somewhere on the server at least one Message and one projection did come back:
a dump that silently restored nothing would otherwise pass every other check.

## Running the drill

From the `lab` repo, against `studio-test`:

```bash
export WORKSPACE_KEY_SECRET="$(bw get password 'studio-test WORKSPACE_KEY_SECRET')"
scripts/ops/studio-restore-drill.sh
```

It restores the newest Restic artifacts into an isolated Compose project with
empty volumes inside the `studio-test` container, imports them, and runs the
audit. It never touches the live `app` project.

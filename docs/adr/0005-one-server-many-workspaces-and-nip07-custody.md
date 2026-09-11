---
status: accepted
---

# One server hosts many Workspaces, and custody decides what onboarding can promise

Four questions were left open as the MVP closed (issue #45): whether a server holds one
Workspace or many, what the mandatory Key Backup means for someone whose key lives in a NIP-07
extension, which onboarding steps may be skipped, and what offline resumption offers.

The code had already answered the first one twice, in contradictory ways. The control plane was
multi-workspace — slugs as keys, a taken-slug error, a Workspace Key per Workspace — while the
relay was pinned to a single `WORKSPACE_SLUG` environment variable and events carried no
Workspace at all. Nothing kept two Workspaces on one server apart.

We decided:

- **A server hosts every Workspace it holds.** The relay resolves the Workspace from the request
  path (`/relay/{slug}`), and events are namespaced by Workspace: the record id is
  `<slug>:<key>`, and reads and the live fan-out are scoped to one slug. The slug is validated as
  kebab-case because it is the namespace separator. `WORKSPACE_SLUG` is gone.
- **Custody shapes onboarding.** A NIP-07 extension holds the key and never exports it, so the
  app neither generates an Identity nor takes custody of one, and the Key Backup steps are absent
  rather than skipped. Under local custody the app holds the key, so the backup is created and
  the passphrase verified before onboarding continues.
- **Only the avatar is skippable.** Downloading the backup file is optional inside the
  verification step; the verification itself is not.
- **Offline resumption is the app shell plus already-fetched media.** Signing out empties that
  cache: Cache Storage is per-origin, not per-account.

## Consequences

- Two Workspaces on one server never share an event row. The same pubkey keeps an independent
  kind 0 in each, and the same event id can exist in both.
- Channel ids stay globally unique (random), so Channel membership needs no Workspace check of
  its own; Workspace-wide kinds (profiles, relay lists, the Workspace's own announcements) are
  the ones the namespacing protects.
- Under a NIP-07 extension there is no server-held Key Backup and no restore-from-backup path:
  recovery is the extension's concern. The Account still exists, but it recovers nothing.
- Content already delivered to a device is not revocable while the session lives. The media cache
  is a local cache, not a lease; revocation takes effect on the next fetch, and at sign-out.
- Event record ids changed shape, so events written before this decision are unreachable under
  the new keys. No migration is provided: the only deployment holding such events is
  `studio-test`, whose data is disposable. A deployment that had to keep its events would need
  one before taking this change.
- Blobs stay server-wide, keyed by content hash alone (`/media` is not per-Workspace). Read
  authorization is by Channel or DM reference, which is safe because Channel ids are unique, but
  the uploader recorded against a hash is whoever uploaded those exact bytes last, in any
  Workspace. Uploading requires being a Workspace Member somewhere on the server.

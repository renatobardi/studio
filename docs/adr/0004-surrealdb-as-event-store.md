---
status: accepted
---

# SurrealDB is the single datastore, including the relay's event store

With the relay embedded in the API (ADR-0001) the database holds Nostr events as well as accounts, membership and invites. Postgres (jsonb + GIN on tags + LISTEN/NOTIFY + tsvector) was the low-risk choice; SurrealDB is newer, changes syntax across majors and has a less battle-tested Python SDK.

We chose SurrealDB anyway: native live queries remove the need for a separate pub/sub path, its flexible schema suits the event kinds still to come (tasks, agents, workflows), and it is where the author is fastest. Scale is small, so the risk is ergonomic, not data-loss.

## Consequences

- A one-day spike must pass before feature work: NIP-01 filter → SurrealQL mapping, a single `LIVE SELECT` on the event table fanned out to subscriptions in Python (never one live query per `REQ`), and replaceable/addressable kinds via upsert on a composite key. If any of the three fails, fall back to Postgres with the same design.
- Tag filters (`#e`, `#p`, `#h`) rely on flattened compound indexes over the tags array; full-text search over Message content uses a FULLTEXT analyzer with BM25.

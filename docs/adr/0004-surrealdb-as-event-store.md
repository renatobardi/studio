---
status: accepted
---

# SurrealDB is the single datastore, including the relay's event store

With the relay embedded in the API (ADR-0001) the database holds Nostr events as well as accounts, membership and invites. Postgres (jsonb + GIN on tags + LISTEN/NOTIFY + tsvector) was the low-risk choice; SurrealDB is newer, changes syntax across majors and has a less battle-tested Python SDK.

We chose SurrealDB anyway: native live queries remove the need for a separate pub/sub path, its flexible schema suits the event kinds still to come (tasks, agents, workflows), and it is where the author is fastest. Scale is small, so the risk is ergonomic, not data-loss.

## Consequences

- A one-day spike must pass before feature work: NIP-01 filter → SurrealQL mapping, a single `LIVE SELECT` on the event table fanned out to subscriptions in Python (never one live query per `REQ`), and replaceable/addressable kinds via upsert on a composite key. If any of the three fails, fall back to Postgres with the same design.
- Tag filters (`#e`, `#p`, `#h`) rely on flattened compound indexes over the tags array; full-text search over Message content uses a FULLTEXT analyzer with BM25.

## Spike outcome (2026-09-10): GO, with one hard constraint

All three risks passed against a real `surreal start` instance (`surrealdb` Python SDK 2.0.0):

- NIP-01 filters map cleanly to SurrealQL: `ids`/`authors`/`kinds` as `IN`, tag filters as `CONTAINSANY` over a flattened `tag_index` array (`"e:<value>"` entries), `since`/`until` as inclusive bounds, `ORDER BY created_at DESC, event_id ASC` gives the required newest-first/lowest-id tie-break, multiple filters are unioned in Python for OR semantics.
- Replaceable and addressable kinds upsert correctly using the record ID itself as the identity key (`pubkey:kind` or `pubkey:kind:d`), with an application-level check against the current row before `UPSERT` to enforce the "newest wins, lowest id on a tie" rule.
- A single `LIVE SELECT` on the `event` table, consumed by one background task, correctly fans out to N independently-filtered in-process subscriptions (`asyncio.Queue` per subscription) — proven with two concurrent subscriptions receiving only their own matching events.

**Constraint found and it changes how the store must be run:** the SDK's *embedded* engine (`mem://`, meant to run SurrealDB in-process with no server) has a broken `live()`/`subscribe_live()` in this version — it reaches for `self.live_queues`, an attribute the embedded connection class never initialises, so any live query raises `AttributeError`. `select`/`create`/`upsert`/`query` all work fine embedded; only live queries are affected. Live queries work correctly against a real `surreal start` process over `ws://`, including with `memory` storage.

Consequence: the event store always connects to a running SurrealDB process (the `surrealdb` Compose service, or `surreal start` in CI) — never through the embedded engine — both in production and in tests. This costs a running container in the test loop instead of an in-process fixture; it does not change the architecture decided above.


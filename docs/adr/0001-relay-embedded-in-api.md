---
status: accepted
---

# The Nostr relay is embedded in the application API

Studio needs a private relay whose read *and* write authorization depends on workspace membership and channel roles kept in SurrealDB. Off-the-shelf relays either cannot gate reads per pubkey (strfry: write-policy plugin only) or require customization in Go (khatru / relay29 / frith) and keep events in their own store, forcing a second datastore and a sync path for search and business rules.

We decided to implement the relay as a WebSocket route inside the FastAPI service (NIP-01 + NIP-42), using SurrealDB as the single event store. Authorization is ordinary Python against the same database; live subscriptions ride on SurrealDB live queries. Scale is small, so relay throughput is not a concern; development friction is.

## Consequences

- We own relay correctness: NIP-01 filter semantics, replaceable/addressable kinds, `EOSE`/`CLOSED` behaviour must be tested against standard clients (`nostr-tools`, `nak`).
- Channel and membership events use NIP-29 kinds and tags even though no NIP-29 relay is running, so a later swap to relay29 stays possible.
- No dependency on Go, C++ or Rust binaries in the deployment.

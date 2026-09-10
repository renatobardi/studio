---
status: accepted
---

# Channels are readable by the server; only Direct Messages are end-to-end encrypted

Studio's core features — unified Inbox, search, agents participating in channels, notifications with previews — require the server to read channel content. End-to-end encrypting channels (per-member gift wraps or MLS) would contradict the product, so we do not do it and do not plan to.

We decided: Messages, Thread Replies, Forum Posts and Reactions are signed but stored in clear, protected by TLS, NIP-42 authentication and membership authorization. Direct Messages use NIP-17 (NIP-44 encryption, NIP-59 gift wrap); the server relays them without being able to read them.

## Consequences

- Direct Messages have no server-side search and notifications for them carry no preview.
- An agent taking part in a Direct Message must hold its own Identity and decrypt client-side like any Member.
- Encryption at rest of the server's storage is an operations concern, not an application feature.

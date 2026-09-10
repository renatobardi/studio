---
status: accepted
---

# Membership lives in SurrealDB and is projected as NIP-43 / NIP-29 events

Clients need to see who belongs to a Workspace and to each Channel, with roles, through ordinary Nostr subscriptions. But invites must exist before the invitee has an Identity, and the relay must answer authorization checks cheaply. A pure-event model (admins sign add-user events, relay derives state by replay) cannot express invite-by-link and turns every check into a fold over history.

We decided that SurrealDB membership tables are the source of truth. Every change is also emitted as the standard event for its level, signed by the Workspace Key:

- Workspace (relay) level — NIP-43: `13534` member list, `8000`/`8001` add/remove, `33534` role definitions. Admission after onboarding uses the NIP-43 `28934` join request carrying the invite code in `claim`.
- Channel (group) level — NIP-29: `39000` metadata, `39001` admins, `39002` members, `39003` roles, `9000`/`9001` add/remove. Channel events carry `["h", <channel-id>]`.

Invites are server-private rows and are never events.

## Consequences

- Each Workspace has a Nostr keypair generated at creation and held by the server (exposed as `self` in the NIP-11 document).
- A Channel Member is always a Workspace Member; removing someone from the Workspace removes them from every Channel.
- Invariant: tables and projected events must never disagree — the projection is written in the same transaction as the table change.
- A later move to relay29 keeps the same Channel event shapes.

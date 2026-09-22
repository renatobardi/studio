---
status: accepted
---

# The relay's past tolerance is per kind, and it is what a reconnect's `since` relies on

When the socket comes back, both feeds ask again with `since` = the newest event they hold,
less a margin (#226). That is only sound if nothing accepted *during the outage* can carry a
`created_at` further below that than the margin — and nothing enforced it. The relay accepted a
`created_at` up to 30 days in the past for every kind (`PAST_TOLERANCE_SECONDS`), so the
Channel's one-hour margin was an estimate (#256), and so was the Direct Messages' two days:
NIP-59's "backdate by up to two days" binds the client that wraps, not the relay that stores.
Reaching back 30 days on every reconnect would make every one of them come back full.

We decided the relay enforces a past tolerance **per kind**, and the client derives its
reconnect margins from those numbers rather than choosing its own:

| Kinds | Accepted back to |
|---|---|
| 9, 7, 1111, 5 (Channel content — the hour binds every deletion, since the kind is what the relay sees) | 1 hour |
| 1059 (gift wrap) | 2 days + 1 hour |
| everything else | 30 days, as before |

A reconnect margin is then **the kind's tolerance plus `FUTURE_TOLERANCE_SECONDS`** (15
minutes): an event accepted during the outage is stamped no earlier than `t_drop − T`, and the
newest one held — accepted before the drop — no later than `t_drop + 15 min`. So a `since` at
`newest held − (T + 15 min)` misses nothing, for Messages, Reactions, Thread Replies and gift
wraps alike. It is this bound, not a guess about how clients behave, that lets the companion
subscription (#255) use a `since` at all, where `rootCompanionFilters` still refuses a time
window for a page of old roots.

An event older than its kind allows is refused with an `OK false` that names the limit
(`… too far in the past for kind 9 (max 3600s)`). The loss becomes visible to the author
instead of silent to every reader. An Agent that queued an event while offline re-signs it with
a fresh `created_at`; that does not break "a Message is immutable once sent", since it never was.

## Considered Options

- **A ceiling the app imposes when composing.** Studio's own client stamps `created_at` when it
  signs and `publish` waits at most 15 s for the socket, so it never publishes anything older.
  But that binds no Agent, Runtime or other client, so it is not a guarantee.
- **Reach back the relay's 30 days.** Correct, and every reconnect of an active Channel would
  return a full page and page down a month.
- **Keep one hour and document the loss.** A Message stamped more than an hour back by any client
  other than ours would be skipped forever.

## Consequences

- NIP-11 cannot state a tolerance per kind: `created_at_lower_limit` stays at the widest one (30
  days), which is true for the kinds that still allow it. A client trusting it for kind 9 learns
  the narrower limit from the refusal, which says so.
- Changing a tolerance changes the client's correctness, not only the relay's policy: the
  margins in `web/src/lib/` are derived from these numbers and must move with them.

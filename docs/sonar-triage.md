# Sonar findings that stay open, and why

Issue #76 asked for every finding outside the vendored design bundle to be
either fixed or justified in writing — nothing merely ignored. Most were
fixed. These are the ones that were not, with the reason, and each is marked
in SonarCloud (*Won't fix* or *False positive*) carrying the same reason.

`scripts/ops/sonar-triage.sh` (gitignored, needs `SONAR_TOKEN`) applies the
markings from this table, matching by rule and file so it survives the
re-keying that comes with a new analysis method.

| Rule | Where | Resolution | Why |
|---|---|---|---|
| `python:S7503` | `auth.py` `require_caller` | Won't fix | A FastAPI dependency declared `async` is resolved on the event loop; declaring it `def` would send every request through a thread-pool hop to gain nothing. |
| `python:S7503` | `nostr/relay.py` `SeededRelayAuthorizer.is_member` | Won't fix | Implements the `RelayAuthorizer` interface, whose other implementation (`WorkspaceMembershipAuthorizer`) does await the database. The seeded one answers from a set. |
| `python:S7503` | `nostr/relay.py` `RelayConnection.close` | Won't fix | The connection lifecycle is awaited as a whole — `start()`, `force_close()`, `close()`. Making one of the three synchronous would change every call site to save nothing. |
| `python:S7503` | `nostr/store.py` `LiveFanout.subscribe` | Won't fix | Same shape: `subscribe`/`stop` are the fanout's awaited pair, and `stop` awaits the consumer task. |
| `python:S7504` | `nostr/relay.py` ×2 | False positive | Both loops mutate the collection they walk — closing a connection unregisters it, cancelling a subscription removes it. The `list(...)` is the copy that makes that safe, not redundancy. |
| `python:S7497` | `nostr/store.py` `LiveFanout.stop` | False positive | The `CancelledError` caught there is the consumer task's, requested one line above. Re-raising would turn an orderly shutdown into a failure. The case the rule describes — the caller being cancelled — cannot reach that handler: a task awaiting an uncancellable task never receives the error at all (verified against CPython 3.12). |
| `typescript:S3776` | `OnboardingScreen.tsx` (21 > 15) | Won't fix | The complexity is the onboarding state machine's, not accidental. Splitting a 950-line screen is a UI refactor with no component-test harness behind it yet (#94) — a separate piece of work, not a lint cleanup. |
| `typescript:S7718` | `AdminPane.tsx`, `OnboardingScreen.tsx` ×2 | Won't fix | `catch (caught)` is the name this codebase uses where an `error` state variable is already in scope. The rule's `error_` is a lint artefact, not a clearer name. |
| `typescript:S6819` | `AppearanceSettings.tsx`, `OnboardingScreen.tsx` ×2 | Won't fix | `role="group"` sits on the styled element the prototype draws; `<fieldset>`/`<progress>` carry user-agent appearance that cannot be styled back to the reference, and the visual baselines are accepted by a person (`docs/UI/REFERENCE.md`). The roles and labels are already what a screen reader needs. |

Anything not listed here was fixed. A finding that comes back after a change
is a new decision, not a re-run of this table.

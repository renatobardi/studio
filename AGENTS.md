# studio

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Tests in `web/`

Where a component test belongs and where an E2E flow does, and what the DOM harness sets up:
`web/README.md`, "Component tests". The decision always lives in `web/src/lib/`; the harness
covers the wiring.

### Delivery gates

What must pass before a commit reaches `studio-test`, and which repo settings
enforce it: `docs/delivery-gates.md`. Promotion to `studio-prd`, and
rollback: `docs/production.md`.

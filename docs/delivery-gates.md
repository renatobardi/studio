# Delivery gates

How a commit gets from a branch to `studio-test`, and what is allowed to stop
it. Issue #51.

## The chain

1. **PR opened** → `ci.yml` runs `test`, `web` and `gates`; SonarCloud analyses
   the PR; CodeRabbit posts (or skips) a review.
2. **Merge to `main`** is blocked by the `main` ruleset until the required
   checks pass (see below).
3. **CI runs again on `main`.** Its conclusion — not the push — is what
   triggers `cd.yml` (`workflow_run`).
4. **`cd.yml` `gate`** proceeds only when CI concluded `success` on that exact
   SHA — asked of the manual `workflow_dispatch` path too, which carries no CI
   run of its own and would otherwise be a hole straight through the gate. It
   then stands down when the SHA is no longer `main`'s tip, so two commits
   landing close together cannot roll `studio-test` backwards.
5. **`cd.yml` `deploy-dev`** re-reads `main`'s tip (the job may have waited on
   its concurrency group since the gate ran), checks out `/opt/app` on the
   `studio-test` container at the exact validated SHA (`git checkout --force
   --detach`), rebuilds, then re-reads `git rev-parse HEAD` over SSH and fails
   if it is not that SHA. The deployed SHA goes to the run's job summary.
6. **Post-deploy Playwright smoke** (flows 1, 2, 3 & 5) runs against what was
   just deployed, from the specs of that same commit.

`scripts/ci/delivery-gates.test.ts` (CI job `gates`) asserts steps 3–5 stay
true — it fails if `cd.yml` ever goes back to a push trigger or to deploying a
mutable branch tip.

## Required checks on `main`

The ruleset requires `test`, `web`, `gates` and `SonarCloud Code Analysis`, a
pull request with one approving review, resolved conversations, no force-push
and no branch deletion. Repository admins are bypass actors: this is a
single-maintainer repo, and a rule nobody can satisfy is a rule that gets
turned off. Apply it with `scripts/ops/apply-main-ruleset.sh`.

`CodeRabbit` is deliberately **not** a required check. On this public repo it
reports `Review skipped: manual review required for this OSS repository` and
still marks the check green — a green that carries no review, so requiring it
would only manufacture false assurance.

## Known limits of the Sonar gate

`sonar-project.properties` excludes `docs/UI/design/**` — a vendored, generated
design artefact nothing imports, which on its own produced most of the
project's CRITICAL findings and drowned the ones that are ours.

The project is on the built-in `Sonar way` quality gate, but `alert_status` has
no value on `main` and no coverage is reported (automatic analysis does not
compute it). Every condition in that gate is scoped to *new code* and to
metrics nothing currently publishes, so today's green `SonarCloud Code
Analysis` check means "analysis ran", not "quality threshold met". Closing that
gap means either enabling main-branch automatic analysis or moving to a
CI-based scan with coverage upload — tracked separately, along with the backlog
of existing findings. `scripts/ops/check-sonar-gate.sh` reports the current
state.

## Production

There is no `studio-prd` deployment yet. When it exists it gets a `deploy-prd`
job gated by `workflow_dispatch` plus promotion of a SHA already deployed and
smoke-tested on `studio-test` — never a fresh build off `main`. Provisioning
lives in the `renatobardi/lab` repo (`install-app.sh`), not here.

## Access

Repository settings, rulesets, Actions secrets and the SonarCloud organisation
are owned by the repository owner. CD's own credentials (`TS_AUTHKEY_DEV`,
`STUDIO_CD_SSH_KEY`, `STUDIO_TEST_*`) live in the `studio-test` GitHub
Environment and are referenced by name only — never checked in.

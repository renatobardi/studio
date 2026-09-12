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
6. **Post-deploy Playwright smoke** (flows 2, 3, 5, 6, 7 & 8) runs against what was
   just deployed, from the specs of that same commit. Flow 1 (first-time
   onboarding) skips itself once the seeded Account has an Identity: an
   Account is onboarded once and never again (#36), so on a fixed test
   account that flow has nothing left to assert. Flow 6 covers the repeatable
   half — signing in on a new browser restores the same Identity. Flow 7
   drives a second client through the REST control plane: another admin's
   Channel and membership changes must land in the running app with no
   reload (#42). Flow 8 puts two Identities through one browser profile with
   the service worker running: cached media must not survive sign-out, nor
   answer the next Identity (#39).

`scripts/ci/delivery-gates.test.ts` (CI job `gates`) asserts steps 3–5 stay
true — it fails if `cd.yml` ever goes back to a push trigger or to deploying a
mutable branch tip.

## Required checks on `main`

The ruleset requires `test`, `web`, `gates` and `SonarCloud Code Analysis`, a
pull request, resolved conversations, no force-push and no branch deletion.
Repository admins are bypass actors: this is a single-maintainer repo, and a
rule nobody can satisfy is a rule that gets turned off.

### Why no approving review

Issue #51 asked for an effective review on `main`, and the ruleset was first
applied with `required_approving_review_count: 1`. On a single-maintainer repo
that is unsatisfiable: GitHub does not let anyone approve their own pull
request, so the only way past it was admin bypass — which is how every PR from
#78 to #85 merged. A gate that is crossed by bypass every single time teaches
nobody anything, and it hides the checks that do work behind a red banner.

The repository owner asked for it to be dropped, and it was, on 12/09/2026 via
`scripts/ops/relax-main-ruleset-approvals.sh`. Two settings had to go, not one:
with approvals at zero, `require_extra_approval_for_unattributed_changes` would
still have demanded one for any commit GitHub cannot attribute to an account —
which includes every commit carrying a `Co-Authored-By:` trailer for a
non-GitHub identity.

What guards `main` is therefore the four required checks, plus the fact that a
pull request and resolved conversations are still mandatory. If a second person
ever joins the repo, restoring the approval is the first thing to revisit —
that is the condition the original requirement was really written for.

`CodeRabbit` is deliberately **not** a required check. On this public repo it
reports `Review skipped: manual review required for this OSS repository` and
still marks the check green — a green that carries no review, so requiring it
would only manufacture false assurance.

## Known limits of the Sonar gate

`docs/UI/design/**` is not excluded from analysis yet, and it should be: a
vendored, generated design artefact nothing imports, it accounts for 321 of the
project's 392 findings on its own. The exclusion was written here and then
withdrawn — the `SonarCloud Code Analysis` check run stopped being posted on
exactly the branch that carried the properties file, so the file is out while
that is being pinned down. Tracked in #76.

The project is on the built-in `Sonar way` quality gate, whose conditions are
all scoped to *new code*. On a pull request that works: new code is the diff,
the gate computes, and it does fail — PR #77 was rejected on
`new_security_rating` 3 against a threshold of 1. On `main` it reports
`Not computed`, because the project has **no New Code definition** set
(Administration > New Code): with no reference period there is nothing for the
conditions to measure. Coverage is uploaded by nothing either, so the coverage
condition never participates.

So the required check does gate pull requests, which is where the ruleset uses
it — but `main` itself carries no gate status, and the two gaps above are
tracked in #76. `scripts/ops/check-sonar-gate.sh` reports the current state.

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

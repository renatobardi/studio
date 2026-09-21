# Delivery gates

How a commit gets from a branch to `studio-test`, and what is allowed to stop
it. Issue #51.

## The chain

1. **PR opened** → `ci.yml` runs `test`, `web`, `visual` (flow 10 against
   the `-linux` baselines), `gates` and `sonar` (the SonarCloud scan, which
   waits for the quality gate); CodeRabbit posts (or skips) a review.
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
   its concurrency group since the gate ran). If the SHA was superseded while
   it queued, the job **stands down**: a `::notice::`, a line in the job
   summary, and every step below skipped — concluding `success`, because
   nothing failed. This deploy merely stopped being the deploy to make (#253).
   An answer that is not a SHA at all is not a stand-down: it fails the job.
   Otherwise it puts `/opt/app` on the `studio-test` container at the exact
   validated SHA (`git checkout --force --detach`), rebuilds, then re-reads
   `git rev-parse HEAD` over SSH and fails if it is not that SHA. The deployed SHA goes to the run's job summary.
   Once it answers, `scripts/ci/cache-headers.sh` asks `studio-test` over
   `curl -I` for the cache policy of `web/nginx.conf` (#203): `/`,
   `index.html`, `sw.js` and `manifest.webmanifest` with `Cache-Control:
   no-cache` — so a deploy reaches a page opened before it the next time the
   browser checks the service worker — and one hashed `/assets/*` file with
   `immutable`. CI's `test` job runs the same script on the stack it starts,
   through Caddy, and Promote on `studio-prd` (`docs/production.md`).
6. **Post-deploy Playwright smoke** (flows 1–9) runs against what was
   just deployed, from the specs of that same commit. Flow 1 (first-time
   onboarding) signs in as an Account that has no Identity on every run:
   an Account is onboarded once and never again (#36), so CD deletes and
   creates that one Account again before the smoke (see "e2e test Accounts"
   below). It redeems a single-use Invite, then restores on a fresh browser
   without being asked for the Invite it just exhausted, and finally removes
   its Identity from the Workspace. Flow 4 also has a Workspace admin who is
   no party to the Direct Message ask for its photos, and be refused. Flow 5
   restores onto a fresh browser and finds the Channel Message written
   before it. Flow 6 covers the repeatable
   half — signing in on a new browser restores the same Identity. Flow 7
   drives a second client through the REST control plane: another admin's
   Channel and membership changes must land in the running app with no
   reload (#42). Flow 8 puts two Identities through one browser profile with
   the service worker running: cached media must not survive sign-out, nor
   answer the next Identity (#39). Flow 9 drives onboarding under a NIP-07
   extension — faked in the page, signing with a fixed key in Node — including
   the two ways an extension fails to cooperate: refusing the request, and not
   doing NIP-44 (#75). Its first-access half self-skips like flow 1, for the
   same reason.
   Flow 11 (`visual-live.spec.ts`, #73) runs in the same smoke with
   `STUDIO_VISUAL_CAPTURE=1`: it captures the deployed app at 1440×900 and
   390×844, light and dark, into `web/test-results/visual-live/` — uploaded
   by the screenshots artifact, with a `manifest.json` naming the SHA, the
   URL and the Workspace — for comparison by hand against
   `docs/UI/reference`. It signs in as the fixtures Account and captures a
   Channel timeline, an open thread, the Members pane, a Direct Message and
   Settings › Profile (#157). Just before the smoke, CD runs
   `web/tools/seed-fixtures.ts`, which publishes whatever of that is missing:
   the Account's Identity and Key Backup, the `fixtures` Channel of the e2e
   Workspace with invented Messages, replies and reactions, and a Direct
   Message between two fixture Identities, whose keys derive from the owner
   key. Nothing there is real data, and a studio-test re-seeded from scratch
   gets it all back on the next deploy. No other flow may write to that
   Account, so that what flow 11 captures is the same from deploy to deploy;
   its inbox no longer has to stay within one page of gift wraps, and the
   seeding scans all of it rather than that page (#231). Flow 10
   (`visual.spec.ts`) compares preview.html
   against committed baselines and runs only where a dev server exists —
   locally, and in CI's `visual` job (see "The visual gate") — never in CD:
   the production build has no preview page, and a baseline is accepted by a
   person, not by a green run (`docs/UI/REFERENCE.md`, "Aceite visual").

`scripts/ci/delivery-gates.test.ts` (CI job `gates`) asserts steps 3–5 stay
true — it fails if `cd.yml` ever goes back to a push trigger or to deploying a
mutable branch tip, if the tip re-check inside `deploy-dev` disappears, stops
retiring the job or stops guarding every step after it, if CI, CD or Promote
stop checking the cache headers, or
if the smoke leaves `deploy-dev` or is allowed to fail.

## When CD is red

A red CD on `main` now means a deploy that really failed — a SHA that did not
reach `studio-test`, cache headers off contract, or a red smoke. It no longer
means a deploy that was simply overtaken: until #253, two commits landing close
together fabricated a red that protected nothing, and the rule below stopped a
merge queue over a healthy `studio-test`.

A red CD on `main` stops the queue: until it is green again, nothing merges
but the fix for it, or the revert of what broke it (#193). CI already passed
on every commit behind a red CD, so nothing else would stop the next merge —
and each one piles onto a `studio-test` that is not known to work, and makes
the fix harder to prove. On 18/09/2026 CD failed four runs in a row while
#177 merged over the red smoke, and the fix, #182, was proven only after
#183 landed on top of it.

Production does not depend on this rule being followed: `promote.yml`
refuses any SHA whose smoke step did not succeed inside a successful
`deploy-dev` (see "Production"), so a red smoke is a SHA Promote will not
take. What the rule protects is `studio-test`, and the chance of
promoting anything at all: a SHA merged over a red CD is proven only when a
later deploy goes green, and that deploy carries every commit before it.

It is a protocol, not a required check — the owner's decision on #193. A
required check is evaluated on the pull request's head, not on `main`, so it
would take a CI job that asks for `main`'s last CD, and its verdict goes stale
the moment CD turns red after the job ran. An unstable smoke would then block
every merge, the fix's own included, unless the check learns an escape for
fixes and reverts — and repository admins, who merge here, bypass it anyway.
Revisit if a merge over a red CD happens again.

## The workflow token

Each workflow says what its `GITHUB_TOKEN` may do, instead of inheriting the
repository default (#202). `ci.yml` grants `contents: read` and no job raises
it: it runs a pull request's own code, artifacts travel on the runner's own
token, and the Sonar scan authenticates with `SONAR_TOKEN`. `cd.yml` grants
`contents: read`, and only its `gate` adds `actions: read` to ask for CI's
conclusion — `deploy-dev`, which holds `studio-test`'s SSH key, gets nothing
more. `promote.yml` grants nothing at the top; its `gate` reads the Actions
API and `deploy-prd` gets nothing. The `gates` job asserts all three.

## Required checks on `main`

The ruleset requires `test`, `web`, `visual`, `gates` and `sonar`,
a pull request,
resolved conversations, no force-push and no branch deletion. `sonar`
replaced `SonarCloud Code Analysis` when the scan moved into CI (#76): with
automatic analysis off, that check run is no longer the thing that carries
the gate's verdict — and a required check nobody posts blocks every pull
request.
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

## The visual gate

Issue #155. Flow 10 had been a gate only on paper since #73: nothing set
`STUDIO_PREVIEW_URL`, so it ran when someone remembered to. `ci.yml` job
`visual` runs it on every pull request (and on `main`) against the `-linux`
baselines, and a screen whose pixels differ by more than `maxDiffPixelRatio`
turns the job red; the `actual`/`expected`/`diff` PNGs go up as the
`visual-diffs` artifact.

It runs through `web/tools/visual-linux.sh`, the same script a person uses to
draw those baselines, inside the pinned
`mcr.microsoft.com/playwright:v1.63.0-noble` image on linux/amd64 — not
`setup-bun` on the runner. A baseline drawn with one Chromium and compared with
another would fail on antialiasing alone, and a gate that is red for no reason
gets bypassed. The image tag follows `@playwright/test` in `bun.lock`: bump
both together and redraw the `-linux` baselines.

A red `visual` is not fixed by `--update-snapshots`: a baseline is redrawn only
for a screen the change meant to alter, and checked against
`docs/UI/reference/` first (`docs/UI/REFERENCE.md`, "Aceite visual").

**Required on `main` since 18/09/2026.** Making it required was a ruleset
edit the owner ran once the job had been green on `main`: requiring it before
the job existed there would have blocked every pull request on a check nobody
posts.

## The Sonar gate

The scan runs in CI (`ci.yml`, job `sonar`), not as SonarCloud's automatic
analysis, and on a pull request `sonar.qualitygate.wait` makes the gate's
verdict that job's conclusion: a gate that fails turns the run red, rather
than depending on a check run being posted.

On `main` the scan runs but does not wait. That is not the gate going soft:
step 3 above promotes only a SHA whose CI concluded `success`, so a red scan
on `main` stops every deploy — including of code the gate already passed on
its way in — and `main`'s new-code window measures a rolling month of commits
nobody can go back and change. The gate blocks where it can be acted on,
which is the pull request the ruleset requires it on. `main` is still
analysed, which is what keeps its gate status computed instead of
`Not computed`. The job needs both suites first (`needs: [test,
web]`), because what it adds over automatic analysis is their coverage —
`api/coverage/coverage.xml` from pytest-cov and `web/coverage/lcov.info` from
`bun test --coverage`, both rewritten to the paths the checkout has before
they are uploaded.

Why the move (#76): automatic analysis measures no coverage at all, so every
pull request reported 0.0% on new code — PR #95 did, on a commit that added
41 unit tests written for the two modules it introduced. The `Sonar way`
gate's `new_coverage < 80` condition therefore never participated, and
turning it on under automatic analysis would have failed every pull request
ever opened.

What the gate does reject is real, and predates this: PR #77 was rejected on
`new_security_rating`, and #110 on duplication and security. On `main` it
still reports `Not computed` until a **New Code definition** is set
(Administration > New Code — `Number of days: 30`: `Reference branch` is not
offered on this plan, and `Previous version` has nothing to key on, since the
project publishes no `sonar.projectVersion`) — every `Sonar way` condition is scoped to new
code, and on a pull request new code is the diff, which is why pull requests
compute and `main` does not.

Configuration that is not in this repository:

- **Automatic analysis must stay off.** It and a CI scan are exclusive; with
  both on, the scan is rejected.
- **`SONAR_TOKEN`** is an Actions secret. It is never written to a file here.
- **The `sonar` job is a required check on `main`**, alongside `test`, `web`
  and `gates`, and `SonarCloud Code Analysis` is no longer required. Swap the
  two in the same ruleset edit, before automatic analysis goes off.
- **The gate itself is still the built-in `Sonar way`**, whose conditions are
  all scoped to new code. Conditions over overall code — the other half of
  what #76 weighed — would need a quality gate of the project's own, since
  the built-in one is read-only. Coverage on new code is the condition that
  was missing, and that is what this change supplies.
- **Exclusions**: `docs/UI/design/**` — a vendored, generated design artefact
  nothing imports, once 321 of the project's 392 findings — is excluded in the
  scanner arguments in `ci.yml`. `.sonarcloud.properties` keeps the same
  exclusion for automatic analysis, which is what reads that file. A
  `sonar-project.properties` has its own history here: while one existed, the
  `SonarCloud Code Analysis` check run stopped being posted on exactly the
  branch that carried it (#51, #110), which is why the exclusion is not
  written there.

`scripts/ops/` (gitignored) holds the scripts that apply the configuration
above and that report the current state.

### Findings that stay open on purpose

Every Sonar finding outside the vendored bundle was either fixed (#76) or
justified in `docs/sonar-triage.md` and marked in SonarCloud with that
justification. Nothing is left merely ignored.

## e2e test Accounts

The smoke signs in as five Firebase password Accounts in the `studio-oute`
project: `STUDIO_TEST_EMAIL`, `STUDIO_TEST_EMAIL_2`,
`STUDIO_TEST_EXTENSION_EMAIL`, `STUDIO_TEST_FIXTURES_EMAIL` (flow 11's, with
its own `STUDIO_TEST_FIXTURES_BACKUP_PASSPHRASE`) and
`STUDIO_TEST_ONBOARDING_EMAIL`, each with its `*_PASSWORD`. Every value
lives in two places that must agree:

- **GitHub secrets**, which Playwright signs in with. The extension pair is a
  repository secret; every other pair, and the fixtures passphrase, are
  `studio-test` Environment secrets. An Environment secret shadows a
  repository secret of the same name, so a value written to the other scope
  changes nothing.
- **`/opt/app/.env` inside the `studio-test` container**, passed through by
  `docker-compose.yml` to the `api` service. Before the smoke, `cd.yml` runs
  `python -m studio_api.ensure_e2e_accounts` there, which creates or resets
  each Account to that password with a verified email (#50). The onboarding
  Account is deleted and created instead — a new uid is a new Account, so
  flow 1 always meets first access; only flow 1 may sign in as it. With no pairs in
  `.env` the step logs `nothing to seed` and does nothing — it does not fail.

GitHub secrets are write-only, so a lost password cannot be read back — and
does not need to be. These passwords are used by the smoke alone; they are
unrelated to the Key Backup passphrases and to the Identities. To rotate or
recover them, generate new passwords and write the same values to both
places, then restart `api` so it reads the new `.env`
(`docker compose up -d api`). The next deploy — or running
`ensure_e2e_accounts` by hand — resets Firebase to match. The repository
owner keeps a script that does all of this in `scripts/ops/` (gitignored, as
every ops script is).

Keep the emails of the first three: an Account is keyed by its Firebase uid,
and a new email is a new Account with no Identity linked to it.

## The host port `studio-test` publishes

`/opt/app/.env` in the container also carries `CADDY_HOST_PORT=3740` — the port
`lab`'s inventory allocated to `studio-test`, which `docker-compose.yml`
publishes Caddy on (#263). It has no default: a container whose `.env` lacks it
fails `cd.yml`'s `docker compose up -d --build`, so it is written there before
a deploy first needs it.

CD does not reach that port directly. The LXD bridge is not routed on the
tailnet, so nothing outside `oute-server` can address the container: what the
runner curls is an LXD **proxy device** on the host, `studio-test-tailscale`,
listening on the host's own tailnet address at 3740 and connecting to the
container. `STUDIO_TEST_WEB_URL` is that listener's address — never the
container's, which times out from anywhere else.

Two consequences, both learned the hard way on #263: `ss -ltnp` **inside** the
LXC cannot show the allocated port, because the listener lives on the host; and
changing the port Compose publishes means changing the device's `connect` in the
same breath (`lxc config device set studio-test studio-test-tailscale
connect=tcp:<container-ip>:<port>`), or the tunnel keeps forwarding to a port
nothing listens on and every deploy fails its health check.

## Production

`studio-prd` is never deployed by `cd.yml`. `promote.yml` is dispatched by
hand with a SHA, and its gate refuses any SHA whose CD run does not carry a
successful **smoke step inside a successful `deploy-dev`** on exactly that
commit. The job's own conclusion is not enough: since #253 a `deploy-dev` that
stood down also concludes `success`, with every step after the tip re-check
skipped, so the step that deployed and smoke-tested the SHA is the proof.
Nothing is built for production off `main`'s tip. The contract is
asserted by the same `gates` job; the runbook, including rollback, is
`docs/production.md`.

## Access

Repository settings, rulesets, Actions secrets and the SonarCloud organisation
are owned by the repository owner. CD's own credentials (`TS_AUTHKEY_DEV`,
`STUDIO_CD_SSH_KEY`, `STUDIO_TEST_*`) live in the `studio-test` GitHub
Environment, except `STUDIO_TEST_EXTENSION_*`, `STUDIO_TEST_OWNER_PRIVATE_KEY_HEX`
and `STUDIO_TEST_WORKSPACE_SLUG`, which are repository secrets. Production's
credentials (`TS_AUTHKEY_PRD`, `STUDIO_CD_SSH_KEY`, `STUDIO_PRD_SSH_HOST`) live
in the `studio-prd` Environment. All are referenced by name only — never
checked in.

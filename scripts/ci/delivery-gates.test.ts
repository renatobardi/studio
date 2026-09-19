import { describe, expect, test } from 'bun:test'

// The delivery-gate contract (issue #51): nothing reaches studio-test that CI
// has not already validated, and what is deployed is the exact commit CI
// validated — never a mutable branch tip that may have moved since.
//
// These are shape assertions over the workflow YAML, not a workflow run: they
// exist so a future edit cannot silently reintroduce a hard reset onto
// origin/main, a push-triggered deploy that races CI, or a manual dispatch
// that skips the gate.

type Step = {
  name?: string
  run?: string
  uses?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, string>
}
type Job = {
  if?: string
  needs?: string[]
  env?: Record<string, string>
  steps: Step[]
  [key: string]: unknown
}
type Workflow = { jobs: Record<string, Job>; [key: string]: unknown }

const repoRoot = new URL('../../', import.meta.url).pathname
const read = async (path: string) =>
  Bun.YAML.parse(await Bun.file(`${repoRoot}${path}`).text()) as Workflow

const cd = await read('.github/workflows/cd.yml')
const promote = await read('.github/workflows/promote.yml')
const ci = await read('.github/workflows/ci.yml')

// `on:` is YAML 1.1's boolean `true`; Bun.YAML follows 1.2 and keeps the
// string key, but read both so the test does not depend on that detail.
const triggers = (cd.on ?? cd[true as unknown as string]) as {
  push?: unknown
  workflow_run: { workflows: string[]; types: string[]; branches: string[] }
}

const gate = cd.jobs.gate
const deploy = cd.jobs['deploy-dev']

// The shell a job actually executes, comments stripped — a comment mentioning
// origin/main is documentation, not a deploy of origin/main.
const commandsOf = (job: Job) =>
  job.steps
    .map((step) => step.run ?? '')
    .join('\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

const deployCommands = commandsOf(deploy)

describe('cd.yml', () => {
  test('deploys only after CI completes on main, never straight off a push', () => {
    expect(triggers.push).toBeUndefined()
    expect(triggers.workflow_run.workflows).toContain('CI')
    expect(triggers.workflow_run.types).toContain('completed')
    expect(triggers.workflow_run.branches).toContain('main')
  })

  test('refuses to promote a CI run that did not succeed', () => {
    expect(gate.if).toContain("workflow_run.conclusion == 'success'")
  })

  test('a manual dispatch still has to prove CI passed on the SHA', () => {
    // Without this the dispatch path is a hole straight through the gate:
    // it carries no workflow_run to inspect.
    expect(commandsOf(gate)).toContain('conclusion')
  })

  test('stands down when the validated SHA is no longer main tip', () => {
    expect(commandsOf(gate)).toContain('stale=true')
    // Positive match only: a skipped or errored gate job yields '', which must
    // not read as "fresh".
    expect(deploy.if).toContain("needs.gate.outputs.stale == 'false'")
  })

  test('deploys the SHA CI validated, not the mutable branch tip', () => {
    expect(deploy.steps[0].with?.ref).toContain('needs.gate.outputs.sha')
    expect(deployCommands).toContain('--detach $DEPLOY_SHA')
    // Fetching `origin main` is fine — it is how the object reaches the host.
    // Moving the working tree *onto* origin/main is the bug this guards.
    expect(deployCommands).not.toMatch(/(?:reset --hard|checkout)[^\n]*origin\/main/)
  })

  test('re-checks the tip inside the deploy job, not only before it queued', () => {
    // deploy-dev queues on a concurrency group; main can move while it waits.
    expect(deployCommands).toContain('superseded')
  })

  test("seeds flow 11's fixtures after the Accounts exist and before the smoke (#157)", () => {
    const at = (text: string) => deploy.steps.findIndex((step) => (step.run ?? '').includes(text))
    const seed = at('bun tools/seed-fixtures.ts')
    expect(seed).toBeGreaterThan(at('studio_api.ensure_e2e_accounts'))
    expect(seed).toBeLessThan(at('bun run test:e2e'))
  })

  test('lets the token read the repository, and only the gate read CI runs (#202)', () => {
    // A workflow-level grant reaches deploy-dev too, which holds studio-test's
    // SSH key; the gate asks the Actions API for CI's conclusion.
    expect(cd.permissions).toEqual({ contents: 'read' })
    expect(gate.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(deploy.permissions).toBeUndefined()
  })

  test('verifies the commit actually running on the host, and records it', () => {
    expect(deployCommands).toContain('rev-parse HEAD')
    expect(deployCommands).toContain('GITHUB_STEP_SUMMARY')
  })
})

// Issue #203: the shell is served with Cache-Control: no-cache and the hashed
// assets as immutable — checked by one script against the Compose stack in
// CI, studio-test after CD's deploy, and studio-prd after a promotion.
const CACHE_CHECK = 'scripts/ci/cache-headers.sh'

describe('cache headers (#203)', () => {
  test('CI checks them on the stack it starts, through Caddy', () => {
    expect(commandsOf(ci.jobs.test)).toContain(CACHE_CHECK)
  })

  test('CD checks them on studio-test once it answers', () => {
    const step = deploy.steps.find((s) => s.run?.includes(CACHE_CHECK))
    expect(step?.env?.STUDIO_URL).toBe('${{ secrets.STUDIO_TEST_WEB_URL }}')
    const names = deploy.steps.map((s) => s.name)
    expect(names.indexOf(step?.name)).toBeGreaterThan(names.indexOf('Wait for health'))
  })

  test('Promote checks them on studio-prd, with the script of the commit it promoted', () => {
    const commands = commandsOf(promote.jobs['deploy-prd'])
    expect(commands).toContain(`/$DEPLOY_SHA/${CACHE_CHECK}`)
    expect(commands).toContain('STUDIO_URL="$STUDIO_PRD_URL"')
  })
})

describe('ci.yml', () => {
  test('publishes the job names the main ruleset requires', () => {
    // scripts/ops/apply-main-ruleset.sh requires these contexts by name —
    // renaming a job here silently unprotects main.
    expect(Object.keys(ci.jobs).sort()).toEqual(['gates', 'sonar', 'test', 'visual', 'web'])
  })

  test('type-checks the test files too, not only what the build ships', () => {
    // tsconfig.app.json leaves *.test.ts(x) out of the build, so a test passing a
    // prop the component does not have ran green for weeks (#191).
    expect(commandsOf(ci.jobs.web)).toContain('bun run typecheck:tests')
  })

  test('lets the token read the repository and nothing else (#202)', () => {
    // CI runs a pull request's code (visual: bun install, then docker run), so
    // its token must not inherit the repository default. No job needs more:
    // artifacts travel on the runner's own token, and Sonar on SONAR_TOKEN.
    expect(ci.permissions).toEqual({ contents: 'read' })
    for (const job of Object.values(ci.jobs)) expect(job.permissions).toBeUndefined()
  })
})

// Flow 10 on every pull request (issue #155). CI runs the same script a person
// runs to draw the -linux baselines, so the two can never compare against
// different Chromium builds; when it fails, the diff PNGs are the evidence.
describe('ci.yml visual job', () => {
  const visual = ci.jobs.visual

  test('runs flow 10 through the script that draws the -linux baselines', () => {
    expect(commandsOf(visual)).toContain('web/tools/visual-linux.sh')
  })

  test('uploads the diffs when the comparison fails', () => {
    const upload = visual.steps.find((step) => step.with?.name === 'visual-diffs')
    expect(upload?.if).toBe('failure()')
    expect(`${upload?.with?.path ?? ''}`).toContain('web/test-results')
  })

  // Issue #156: the baselines measured against docs/UI/reference. The report is
  // published on every run, pass or fail — it is the evidence either way.
  test('publishes the comparison with the prototype reference on every run', () => {
    const compare = visual.steps.findIndex((step) => (step.run ?? '').includes('compare:reference'))
    const upload = visual.steps.findIndex((step) => step.with?.name === 'reference-compare')
    const flow10 = visual.steps.findIndex((step) => (step.run ?? '').includes('web/tools/visual-linux.sh'))
    expect(compare).toBeGreaterThan(-1)
    expect(visual.steps[upload]?.if).toBe('always()')
    expect(`${visual.steps[upload]?.with?.path ?? ''}`).toContain('web/test-results/reference-compare')
    // Flow 10 runs as root in the Playwright container and clears test-results:
    // the report is written and uploaded before it, and flow 10 still runs when
    // a faithful screen fails the comparison.
    expect(compare).toBeLessThan(upload)
    expect(upload).toBeLessThan(flow10)
    expect(visual.steps[flow10]?.if).toBe('${{ !cancelled() }}')
  })
})

// The Sonar gate (issue #76). Automatic analysis measured no coverage at all —
// every PR read 0.0% on new code, so the one condition that would reject
// untested code could never participate. The scan moved into CI so it can be
// fed the coverage the suites already produce, and so the gate's verdict is a
// red job here instead of a check run that may or may not be posted.
describe('ci.yml sonar job', () => {
  const sonar = ci.jobs.sonar
  const sonarCommands = commandsOf(sonar)
  const scan = sonar.steps.find((step) => (step.uses ?? '').includes('sonarqube-scan-action'))
  const scanArgs = `${scan?.with?.args ?? ''}`

  test('waits for the quality gate on a pull request, and only there', () => {
    // Without the wait the scan is fire-and-forget: the job stays green
    // whatever the gate decides, which is exactly the hole #76 opened on.
    // On main it must not wait: cd.yml promotes only a SHA whose CI concluded
    // success, so a red scan there stops every deploy of code the gate already
    // passed on its way in — and main's new-code window covers a month of
    // commits nobody can go back and change.
    expect(scanArgs).toContain("sonar.qualitygate.wait=${{ github.event_name == 'pull_request' }}")
  })

  test('scans only after both suites ran, and takes their coverage', () => {
    expect(sonar.needs).toEqual(['test', 'web'])
    expect(scanArgs).toContain('sonar.python.coverage.reportPaths=api/coverage/coverage.xml')
    expect(scanArgs).toContain('sonar.javascript.lcov.reportPaths=web/coverage/lcov.info')
  })

  test('reads the token from secrets, never from a file in the repo', () => {
    expect(`${scan?.env?.SONAR_TOKEN ?? ''}`).toContain('secrets.SONAR_TOKEN')
    expect(sonarCommands).not.toContain('SONAR_TOKEN=')
  })

  test('the suites publish the coverage the scan downloads', () => {
    const uploads = [ci.jobs.test, ci.jobs.web].flatMap((job) =>
      job.steps.filter((step) => (step.uses ?? '').includes('upload-artifact')),
    )
    expect(uploads.map((step) => step.with?.name).sort()).toEqual([
      'coverage-api',
      'coverage-web',
    ])
  })
})

// Promotion to studio-prd (issue #54). Nothing is built for production that
// studio-test did not already run and smoke-test: the only input is a SHA, and
// the gate asks GitHub for proof that CD deployed exactly that SHA to
// studio-test and its smoke passed.

describe('promote.yml', () => {
  const promoteTriggers = (promote.on ?? promote[true as unknown as string]) as Record<
    string,
    { inputs?: Record<string, { required?: boolean }> } | undefined
  >
  const promoteGate = promote.jobs.gate
  const deployPrd = promote.jobs['deploy-prd']
  const everyRun = Object.values(promote.jobs)
    .flatMap((job) => job.steps.map((step) => step.run ?? ''))
    .join('\n')

  test('runs only when a person dispatches it with a SHA', () => {
    expect(Object.keys(promoteTriggers)).toEqual(['workflow_dispatch'])
    expect(promoteTriggers.workflow_dispatch?.inputs?.sha?.required).toBe(true)
  })

  test('never splices the typed SHA into a shell script', () => {
    // A dispatch input is free text: `${{ inputs.sha }}` inside `run:` is
    // script injection. It reaches the shell through env, and is checked there.
    expect(everyRun).not.toContain('inputs.sha')
    expect(commandsOf(promoteGate)).toContain('[0-9a-f]{40}')
  })

  test('promotes only a SHA whose studio-test deploy and smoke succeeded', () => {
    const commands = commandsOf(promoteGate)
    expect(commands).toContain('workflows/cd.yml/runs?head_sha=')
    // A CD run can succeed with deploy-dev skipped (a superseded SHA stands
    // down) — the run's conclusion alone proves nothing was deployed.
    expect(commands).toContain('deploy-dev')
  })

  test('deploys that exact SHA to studio-prd, behind its own Environment', () => {
    expect(deployPrd.needs).toEqual(['gate'])
    expect(deployPrd.environment).toBe('studio-prd')
    const commands = commandsOf(deployPrd)
    expect(commands).toContain('lxc exec studio-prd')
    expect(commands).toContain('--detach $DEPLOY_SHA')
    expect(commands).not.toMatch(/(?:reset --hard|checkout)[^\n]*origin\/main/)
  })

  test('verifies the commit running on studio-prd and that it answers over HTTPS', () => {
    const commands = commandsOf(deployPrd)
    expect(commands).toContain('rev-parse HEAD')
    expect(commands).toContain('GITHUB_STEP_SUMMARY')
    expect(commands).toContain('/api/ready')
  })

  test('grants the token nothing by default, and each job only what it uses', () => {
    // A workflow-level grant reaches every job, including the one holding
    // production's SSH key (Sonar githubactions:S8264).
    expect(promote.permissions).toEqual({})
    expect(promoteGate.permissions).toEqual({ actions: 'read' })
    expect(deployPrd.permissions).toEqual({})
  })

  test('never seeds or resets e2e Accounts on production', () => {
    expect(everyRun).not.toContain('ensure_e2e_accounts')
  })
})

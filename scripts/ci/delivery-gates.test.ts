import { describe, expect, test } from 'bun:test'

// The delivery-gate contract (issue #51): nothing reaches studio-test that CI
// has not already validated, and what is deployed is the exact commit CI
// validated — never a mutable branch tip that may have moved since.
//
// These are shape assertions over the workflow YAML, not a workflow run: they
// exist so a future edit cannot silently reintroduce a hard reset onto
// origin/main, a push-triggered deploy that races CI, or a manual dispatch
// that skips the gate.

type Step = { name?: string; run?: string; with?: Record<string, string> }
type Job = { if?: string; steps: Step[]; [key: string]: unknown }
type Workflow = { jobs: Record<string, Job>; [key: string]: unknown }

const repoRoot = new URL('../../', import.meta.url).pathname
const read = async (path: string) =>
  Bun.YAML.parse(await Bun.file(`${repoRoot}${path}`).text()) as Workflow

const cd = await read('.github/workflows/cd.yml')
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

  test('verifies the commit actually running on the host, and records it', () => {
    expect(deployCommands).toContain('rev-parse HEAD')
    expect(deployCommands).toContain('GITHUB_STEP_SUMMARY')
  })
})

describe('ci.yml', () => {
  test('publishes the job names the main ruleset requires', () => {
    // scripts/ops/apply-main-ruleset.sh requires these contexts by name —
    // renaming a job here silently unprotects main.
    expect(Object.keys(ci.jobs).sort()).toEqual(['gates', 'test', 'web'])
  })
})

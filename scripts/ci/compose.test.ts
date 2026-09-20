import { describe, expect, test } from 'bun:test'

// Issue #54: the Firebase service-account credential used to reach the api
// container through an untracked docker-compose.override.yml on the host — a
// step nobody provisioning studio-prd could have known about. The mount now
// lives in docker-compose.yml itself, keyed by a host path in .env.
//
// This renders the real Compose model (`docker compose config`), so the
// interpolation is Compose's own, not a reading of the YAML text.

type Mount = { type: string; source: string; target: string; read_only?: boolean }
type Port = { published: string | number; target: number }
type Service = { environment?: Record<string, string | null>; volumes?: Mount[]; ports?: Port[] }

const repoRoot = new URL('../../', import.meta.url).pathname
const TARGET = '/run/secrets/firebase-adminsdk.json'

const render = (name: string, env: Record<string, string>) =>
  Bun.spawnSync(
    ['docker', 'compose', '--project-directory', repoRoot, '--env-file', '/dev/null', 'config', '--format', 'json', name],
    // PATH/HOME only: a developer's own shell must not leak a value into the model.
    { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } },
  )

const service = (name: string, env: Record<string, string>): Service => {
  const result = render(name, env)
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString()).services[name]
}

const apiService = (env: Record<string, string>): Service => service('api', { CADDY_HOST_PORT: '80', ...env })

describe('docker-compose.yml api service', () => {
  test('mounts the Firebase credential named in .env, read-only, and points the app at it', () => {
    const api = apiService({ FIREBASE_CREDENTIALS_FILE: '/srv/secrets/firebase-adminsdk.json' })
    const mount = api.volumes?.find((volume) => volume.target === TARGET)
    expect(mount?.source).toBe('/srv/secrets/firebase-adminsdk.json')
    expect(mount?.read_only).toBe(true)
    expect(api.environment?.FIREBASE_CREDENTIALS_PATH).toBe(TARGET)
  })

  test("hands the fixtures Account's pair to ensure_e2e_accounts (#157)", () => {
    const api = apiService({ STUDIO_TEST_FIXTURES_EMAIL: 'f@example.com', STUDIO_TEST_FIXTURES_PASSWORD: 'pw' })
    expect(api.environment?.STUDIO_TEST_FIXTURES_EMAIL).toBe('f@example.com')
    expect(api.environment?.STUDIO_TEST_FIXTURES_PASSWORD).toBe('pw')
  })

  test('without a credential file, Firebase stays unconfigured instead of reading an empty mount', () => {
    const api = apiService({})
    expect(api.environment?.FIREBASE_CREDENTIALS_PATH ?? '').toBe('')
  })
})

// Issue #263: lab's inventory allocates one host port per container (studio-prd
// 3760, studio-test 3740) and its uniqueness is what makes `allocation.next_port`
// mean anything. Caddy still listens on :80 inside the container; only the
// published port is the environment's own, so it comes from that host's .env.
describe('docker-compose.yml caddy service', () => {
  test('publishes the host port the environment allocated, onto Caddy\'s own :80', () => {
    const caddy = service('caddy', { CADDY_HOST_PORT: '3760' })
    expect(caddy.ports).toEqual([expect.objectContaining({ published: '3760', target: 80 })])
  })

  test('without CADDY_HOST_PORT the stack refuses to render, instead of publishing some other port', () => {
    const result = render('caddy', {})
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('CADDY_HOST_PORT')
  })
})

import { describe, expect, test } from 'bun:test'

// Issue #54: the Firebase service-account credential used to reach the api
// container through an untracked docker-compose.override.yml on the host — a
// step nobody provisioning studio-prd could have known about. The mount now
// lives in docker-compose.yml itself, keyed by a host path in .env.
//
// This renders the real Compose model (`docker compose config`), so the
// interpolation is Compose's own, not a reading of the YAML text.

type Mount = { type: string; source: string; target: string; read_only?: boolean }
type Service = { environment?: Record<string, string | null>; volumes?: Mount[] }

const repoRoot = new URL('../../', import.meta.url).pathname
const TARGET = '/run/secrets/firebase-adminsdk.json'

const apiService = (env: Record<string, string>): Service => {
  const result = Bun.spawnSync(
    ['docker', 'compose', '--project-directory', repoRoot, '--env-file', '/dev/null', 'config', '--format', 'json', 'api'],
    // PATH/HOME only: a developer's own shell must not leak a value into the model.
    { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString()).services.api
}

describe('docker-compose.yml api service', () => {
  test('mounts the Firebase credential named in .env, read-only, and points the app at it', () => {
    const api = apiService({ FIREBASE_CREDENTIALS_FILE: '/srv/secrets/firebase-adminsdk.json' })
    const mount = api.volumes?.find((volume) => volume.target === TARGET)
    expect(mount?.source).toBe('/srv/secrets/firebase-adminsdk.json')
    expect(mount?.read_only).toBe(true)
    expect(api.environment?.FIREBASE_CREDENTIALS_PATH).toBe(TARGET)
  })

  test('without a credential file, Firebase stays unconfigured instead of reading an empty mount', () => {
    const api = apiService({})
    expect(api.environment?.FIREBASE_CREDENTIALS_PATH ?? '').toBe('')
  })
})

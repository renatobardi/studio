import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildId } from './tools/build-id.ts'

// Which build this is, carried by the page and by sw.ts alike (#259): a page taken over by a
// worker asks it this, to tell a deploy apart from its own visit's worker. vite-plugin-pwa builds
// sw.ts with this same `define`. A digest of what ships, so a rebuild with nothing new in it is
// not "a new version" — see tools/build-id.ts.
//
// Everything that decides what ships is an input, not only the sources: this file (the manifest,
// the plugins), the tsconfigs esbuild reads, and whichever `.env` files Vite finds — the Firebase
// config is baked into the bundle from there. Leave one out and a change to it ships a new worker
// that answers "same build", and the open tab never hears of it (the #235 failure mode).
const root = fileURLToPath(new URL('.', import.meta.url))
const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local'].filter((file) => existsSync(join(root, file)))
const build = buildId(root, [
  'index.html',
  'src',
  'public',
  'package.json',
  'bun.lock',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.sw.json',
  ...envFiles,
])

// https://vite.dev/config/
export default defineConfig({
  define: { __STUDIO_BUILD__: JSON.stringify(build) },
  plugins: [
    react(),
    // A hand-written service worker (src/sw.ts): app-shell precaching (issue #8).
    // injectManifest lets self.__WB_MANIFEST list the build's own assets —
    // precacheAndRoute in sw.ts consumes it. Media is cached by the page, per
    // Identity, not here (ADR-0007).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // registerType stays the default ('prompt'): 'autoUpdate' wires an automatic
      // window.location.reload() on SW activation, which fired mid-session on studio-test
      // and broke the CD Playwright smoke. A new version is offered instead, never forced:
      // lib/appUpdate.ts raises "A new version is available · Reload" (#203).
      manifest: {
        name: 'Studio',
        short_name: 'Studio',
        description: 'Private Channels and Direct Messages on Nostr, self-hosted.',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111111',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
})

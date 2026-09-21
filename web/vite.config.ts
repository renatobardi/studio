import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { buildId } from './tools/build-id.ts'

// Which build this is, carried by the page and by sw.ts alike (#259): a page taken over by a
// worker asks it this, to tell a deploy apart from its own visit's worker. vite-plugin-pwa builds
// sw.ts with this same `define`. A digest of what ships, so a rebuild with nothing new in it is
// not "a new version" — see tools/build-id.ts.
const build = buildId(fileURLToPath(new URL('.', import.meta.url)), ['index.html', 'src', 'public', 'package.json', 'bun.lock'])

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

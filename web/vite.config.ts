import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // A hand-written service worker (src/sw.ts): app-shell precaching (issue #8) plus the
    // ticket #6 media cache-by-hash. injectManifest lets self.__WB_MANIFEST list the build's
    // own assets — precacheAndRoute in sw.ts consumes it.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
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

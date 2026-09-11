import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Ticket #6: a hand-written service worker (src/sw.ts) that caches
    // attached images by content hash — no precache manifest needed.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { injectionPoint: undefined },
      manifest: false,
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
})

import { defineConfig } from "@playwright/test";

const baseURL = process.env.STUDIO_WEB_URL ?? "http://localhost:5173";

/**
 * studio-test is served over plain HTTP (see the Caddyfile: the network
 * boundary is Tailscale, not TLS), so its origin is not a secure context and
 * Chromium hides `navigator.serviceWorker` entirely — flow 8
 * (media-cache-isolation.spec.ts) needs the worker to be running to test it at
 * all. Telling Chromium to treat that one origin as secure is what lets the
 * flow run against a deployment shaped like the one it guards.
 *
 * `channel: "chromium"` goes with it on purpose: the headless shell Playwright
 * uses by default ignores the flag and keeps the worker hidden.
 *
 * localhost is already a secure context, so a local run needs neither.
 */
const url = new URL(baseURL);
const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
const insecureOrigin = url.protocol === "http:" && !isLocalhost ? url.origin : null;

/** Flow 10 (visual.spec.ts) draws preview.html from a dev server; `bun run test:visual` sets
 * STUDIO_PREVIEW_URL and this starts (or reuses) that server. Absent, the flow self-skips. */
const previewUrl = process.env.STUDIO_PREVIEW_URL;

export default defineConfig({
  testDir: "./e2e",
  ...(previewUrl
    ? {
        webServer: {
          command: "bunx vite --host localhost --port 5173 --strictPort",
          url: `${previewUrl}/preview.html`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }
    : {}),
  expect: {
    // Sub-pixel antialiasing differs run to run even on one machine; a component that moved,
    // resized or recoloured is well above 0.2% of the page. Baselines carry the platform
    // suffix on purpose: text rasterises differently per OS, so a baseline drawn on macOS is
    // never compared against Linux (docs/UI/REFERENCE.md, "Aceite visual").
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.2, animations: "disabled", caret: "hide" },
  },
  fullyParallel: false,
  // One worker: the flows share the same few seeded Accounts and Identities
  // against one deployment, and two of them signed in at once as the same
  // Account would race each other. No flow depends on another having run.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    ...(insecureOrigin
      ? {
          channel: "chromium" as const,
          launchOptions: { args: [`--unsafely-treat-insecure-origin-as-secure=${insecureOrigin}`] },
        }
      : {}),
    trace: "on-first-retry",
    // A screenshot is a pixel render (a password field shows masked dots, never the typed
    // characters) — safe to upload from CD, unlike trace.zip's recorded .fill() values (see
    // the incident notes on the artifact-upload step removed from cd.yml).
    screenshot: "only-on-failure",
  },
});

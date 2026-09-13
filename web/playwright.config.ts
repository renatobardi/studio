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

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // restore.spec.ts needs onboarding.spec.ts's Key Backup to already exist
  // for the same test account — must run in file order, one worker.
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

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // restore.spec.ts needs onboarding.spec.ts's Key Backup to already exist
  // for the same test account — must run in file order, one worker.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.STUDIO_WEB_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    // A screenshot is a pixel render (a password field shows masked dots, never the typed
    // characters) — safe to upload from CD, unlike trace.zip's recorded .fill() values (see
    // the incident notes on the artifact-upload step removed from cd.yml).
    screenshot: "only-on-failure",
  },
});

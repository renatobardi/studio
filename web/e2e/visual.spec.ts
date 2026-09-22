import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Flow 10 (#73): the MVP screens against their baselines, pixel for pixel.
 *
 * Runs over preview.html — the real components on fixed, signed fixtures (src/preview) — so
 * every run draws exactly the same bytes: same data, same clock (UTC, fixed at 10:00), same fonts, no relay,
 * no Firebase. A baseline is accepted only after being checked against docs/UI/reference; see
 * docs/UI/REFERENCE.md ("Aceite visual"). Self-skips unless STUDIO_PREVIEW_URL points at a
 * dev server (`bun run test:visual` starts one).
 */
const previewUrl = process.env.STUDIO_PREVIEW_URL;

test.skip(!previewUrl, "STUDIO_PREVIEW_URL not set — the visual flow needs the dev server's preview.html");

import { VIEWPORTS } from "./viewports";

/** The same ids as docs/UI/reference/<viewport>/<id>.png, where the harness can reach them. */
const SCREENS: { id: string; screen: string; mobile?: boolean; dark?: boolean; query?: string }[] = [
  { id: "auth-signin", screen: "auth-signin", mobile: true, dark: true },
  { id: "auth-signin-error", screen: "auth-signin-error" },
  { id: "auth-signup", screen: "auth-signup", mobile: true },
  { id: "auth-reset", screen: "auth-reset" },
  { id: "onboarding-invite", screen: "onboarding-invite", mobile: true },
  { id: "onboarding-profile", screen: "onboarding-profile", mobile: true },
  { id: "onboarding-avatar", screen: "onboarding-avatar" },
  { id: "onboarding-backup", screen: "onboarding-backup", mobile: true, dark: true },
  { id: "onboarding-backup-revealed", screen: "onboarding-backup-revealed" },
  { id: "onboarding-backup-options", screen: "onboarding-backup-options" },
  { id: "onboarding-download", screen: "onboarding-download", mobile: true },
  { id: "onboarding-setup", screen: "onboarding-setup" },
  { id: "channel", screen: "channel", mobile: true, dark: true },
  { id: "channel-thread", screen: "channel-thread", mobile: true, dark: true },
  { id: "channel-members", screen: "channel-members", mobile: true },
  { id: "dm", screen: "dm", mobile: true, dark: true },
  { id: "profile", screen: "profile", mobile: true },
  { id: "settings-appearance", screen: "settings", mobile: true, dark: true },
  { id: "settings-profile", screen: "settings-profile" },
  // Appearance at its extremes: nothing may overflow or clip (#71).
  { id: "channel-spacious-larger", screen: "channel", query: "density=spacious&fontScale=larger" },
  { id: "channel-comfy-smaller", screen: "channel", query: "density=comfy&fontScale=smaller", mobile: true },
  { id: "channel-members-spacious-larger", screen: "channel-members", query: "density=spacious&fontScale=larger" },
  { id: "auth-signin-spacious-larger", screen: "auth-signin", query: "density=spacious&fontScale=larger", mobile: true },
  { id: "auth-signup-compact-smaller", screen: "auth-signup", query: "fontScale=smaller" },
  { id: "onboarding-backup-spacious-larger", screen: "onboarding-backup", query: "density=spacious&fontScale=larger", mobile: true },
  { id: "onboarding-download-compact-smaller", screen: "onboarding-download", query: "fontScale=smaller" },
  { id: "settings-spacious-larger", screen: "settings", query: "density=spacious&fontScale=larger", mobile: true },
  { id: "settings-profile-comfy-smaller", screen: "settings-profile", query: "density=comfy&fontScale=smaller" },
];

/** Paints every secret on screen over (#190). A stylesheet rather than `toHaveScreenshot`'s
 * `mask`: the font scale zooms the shell with CSS `zoom`, and `mask` places its box from
 * coordinates that ignore it — at "larger" it drew beside the key and left it showing. A style
 * lands on the element itself, at any scale. */
const MASK_SECRETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "mask-secrets.css");

test.use({ timezoneId: "UTC", locale: "en-GB", colorScheme: "light" });

// Every failure of this flow so far came from a machine under pressure, not from a screen that
// changed — the macOS run included, while the amd64 container competed for the same laptop — and
// a starved run reads as a timeout like any other. The load it ran under is attached to the
// failure itself, so the next one arrives with its cause named instead of a rerun that happens to
// pass (#227).
test.afterEach(async () => {
  const info = test.info();
  if (info.status === info.expectedStatus) return;
  const [one, five] = os.loadavg();
  const lines = [`load ${one.toFixed(1)} (1 min) / ${five.toFixed(1)} (5 min) on ${os.cpus().length} CPUs`];
  // Linux reports memory a process could still get; macOS only pages nobody holds, which reads as
  // nearly none on a healthy machine — a number that would point the wrong way.
  if (process.platform === "linux") {
    const gb = (bytes: number) => (bytes / 2 ** 30).toFixed(1);
    lines.push(`${gb(os.freemem())} of ${gb(os.totalmem())} GB available`);
  }
  await info.attach("machine at failure", { body: lines.join(", "), contentType: "text/plain" });
});

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(viewportName, () => {
    test.use({ viewport });
    for (const entry of SCREENS) {
      if (viewportName === "mobile" && !entry.mobile) continue;
      for (const dark of entry.dark && viewportName === "desktop" ? [false, true] : [false]) {
        const name = `${entry.id}${dark ? "-dark" : ""}`;
        test(name, async ({ page }) => {
          const params = new URLSearchParams(entry.query ?? "");
          params.set("screen", entry.screen);
          if (dark) params.set("theme", "dark");
          // "last reply 12m ago" is measured from now: pin it to where the reference captures
          // stand, 10:00 on the fixtures' day (src/preview/fixtures.ts), so the text never drifts.
          await page.clock.setFixedTime(new Date("2026-09-11T10:00:00Z"));
          await page.goto(`${previewUrl}/preview.html?${params}`);
          // Ready, or given up — the preview says which, and why (src/preview/Steps.tsx). Waiting
          // for ready alone spent the whole test timeout on a step that had long since failed.
          await page.waitForSelector("html[data-preview-ready], html[data-preview-failed]");
          const failed = await page.evaluate(() => document.documentElement.dataset.previewFailed);
          expect(failed, "the preview gave up on one of its own steps").toBeUndefined();
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.fonts.check('12px "Inter Variable"'))).toBe(true);
          // Only secrets are masked (#190): the private key the onboarding generates at runtime
          // must never land in a baseline, blurred or not. Nothing else is: the fixtures are
          // fixed, the clock is UTC, and a component that renders differently is exactly what
          // this flow is for.
          await expect(page).toHaveScreenshot(`${viewportName}/${name}.png`, { stylePath: MASK_SECRETS });
        });
      }
    }
  });
}

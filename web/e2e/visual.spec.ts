import { expect, test } from "@playwright/test";

/**
 * Flow 10 (#73): the MVP screens against their baselines, pixel for pixel.
 *
 * Runs over preview.html — the real components on fixed, signed fixtures (src/preview) — so
 * every run draws exactly the same bytes: same data, same clock (UTC), same fonts, no relay,
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

test.use({ timezoneId: "UTC", locale: "en-GB", colorScheme: "light" });

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
          await page.goto(`${previewUrl}/preview.html?${params}`);
          await page.waitForSelector("html[data-preview-ready]");
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.fonts.check('12px "Inter Variable"'))).toBe(true);
          // Nothing dynamic is masked: the fixtures are fixed, the clock is UTC, and a
          // component that renders differently is exactly what this flow is for.
          await expect(page).toHaveScreenshot(`${viewportName}/${name}.png`);
        });
      }
    }
  });
}

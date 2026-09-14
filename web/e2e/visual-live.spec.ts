import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { reachAppViaRestore } from "./helpers";
import { VIEWPORTS } from "./viewports";

/**
 * Flow 11 (#73): the authenticated app on studio-test, captured for comparison — not compared
 * here. A live Workspace has whatever Messages the other flows left, so it cannot be a
 * baseline; what it proves is that the deployed SHA renders the shell with real fonts and
 * data, in both themes and at both viewports. CD uploads web/test-results/**\/*.png, so every
 * deploy leaves these behind. Opt in with STUDIO_VISUAL_CAPTURE=1.
 */
test.skip(process.env.STUDIO_VISUAL_CAPTURE !== "1", "STUDIO_VISUAL_CAPTURE=1 captures the deployed app");

const OUT = "test-results/visual-live";

test.use({ timezoneId: "UTC", locale: "en-GB" });

test("captures the shell on the deployed app", async ({ page, browserName }) => {
  test.slow();
  await mkdir(OUT, { recursive: true });
  // The sign-in screen is the one screen before authentication a fixed Account can show.
  for (const [viewport, size] of Object.entries(VIEWPORTS) as ["desktop" | "mobile", { width: number; height: number }][]) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/${viewport}/auth-signin.png`, animations: "disabled", caret: "hide" });
  }
  await page.setViewportSize(VIEWPORTS.desktop);
  await reachAppViaRestore(page);
  await expect(page.getByText(/Connected as/)).toBeVisible();

  const shot = async (viewport: "desktop" | "mobile", name: string) => {
    await page.screenshot({ path: `${OUT}/${viewport}/${name}.png`, animations: "disabled", caret: "hide" });
  };
  const toggleTheme = () => page.getByRole("button", { name: /Switch to (dark|light)/ }).click();

  for (const [viewport, size] of Object.entries(VIEWPORTS) as ["desktop" | "mobile", { width: number; height: number }][]) {
    await page.setViewportSize(size);
    await page.getByTestId("channel-list-item").first().click();
    await shot(viewport, "channel");
    const thread = page.getByTestId("open-thread").first();
    if (await thread.isVisible()) {
      await thread.click();
      await expect(page.getByTestId("thread-pane")).toBeVisible();
      await shot(viewport, "channel-thread");
      await page.getByRole("button", { name: "Close thread" }).click();
    }
    await page.getByRole("button", { name: "Channel members" }).click();
    await expect(page.getByTestId("members-pane")).toBeVisible();
    await shot(viewport, "channel-members");
    await page.getByRole("button", { name: "Close members" }).click();
    await page.getByTestId("mode-dms").click();
    await shot(viewport, "dm-list");
    await page.getByTestId("mode-settings").click();
    await shot(viewport, "settings-appearance");
    await toggleTheme();
    await shot(viewport, "settings-appearance-dark");
    await page.getByTestId("channel-list-item").first().click();
    await shot(viewport, "channel-dark");
    await toggleTheme();
  }

  await writeFile(
    `${OUT}/manifest.json`,
    JSON.stringify(
      {
        sha: process.env.GITHUB_SHA ?? null,
        url: process.env.STUDIO_WEB_URL ?? null,
        browser: browserName,
        capturedAt: new Date().toISOString(),
        viewports: { desktop: "1440x900", mobile: "390x844" },
      },
      null,
      2,
    ),
  );
});

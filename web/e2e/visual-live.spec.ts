import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { CHANNEL_SCRIPT, DM_SCRIPT, FIXTURE_CHANNEL, PROFILES } from "../tools/seed-fixtures-lib";
import { reachAppViaRestoreWithCredentials, testFixturesAccount, testWorkspaceSlug } from "./helpers";
import { VIEWPORTS } from "./viewports";

/**
 * Flow 11 (#73, #157): the authenticated app on studio-test, captured for comparison — not compared
 * here. It signs in as the fixtures Account, whose Channel, thread and Direct Message CD seeds just
 * before the smoke (tools/seed-fixtures.ts), so every deploy captures the same conversation: what
 * it proves is that the deployed SHA renders it, with real fonts, in both themes and at both
 * viewports. CD uploads web/test-results/**\/*.png, so every deploy leaves these behind. Opt in
 * with STUDIO_VISUAL_CAPTURE=1.
 */
test.skip(process.env.STUDIO_VISUAL_CAPTURE !== "1", "STUDIO_VISUAL_CAPTURE=1 captures the deployed app");

const OUT = "test-results/visual-live";
type Viewport = keyof typeof VIEWPORTS;

test.use({ timezoneId: "UTC", locale: "en-GB" });

const shot = (page: Page, viewport: Viewport, name: string) =>
  page.screenshot({ path: `${OUT}/${viewport}/${name}.png`, animations: "disabled", caret: "hide" });

test("captures the seeded conversations on the deployed app", async ({ page, browserName }) => {
  test.slow();
  await mkdir(OUT, { recursive: true });
  // The sign-in screen is the one screen before authentication a fixed Account can show.
  for (const [viewport, size] of Object.entries(VIEWPORTS) as [Viewport, { width: number; height: number }][]) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await shot(page, viewport, "auth-signin");
  }
  await page.setViewportSize(VIEWPORTS.desktop);
  await reachAppViaRestoreWithCredentials(page, {
    email: testFixturesAccount.email(),
    password: testFixturesAccount.password(),
    backupPassphrase: testFixturesAccount.backupPassphrase(),
  });
  await expect(page.locator(".account-name")).toHaveText(PROFILES.me.name);

  const channelItem = page.getByTestId("channel-list-item").filter({ hasText: new RegExp(`^${FIXTURE_CHANNEL}$`) });
  const threadRoot = CHANNEL_SCRIPT.messages[CHANNEL_SCRIPT.thread.root].text;
  const lastMessage = CHANNEL_SCRIPT.messages.at(-1)!.text;
  const lastReply = CHANNEL_SCRIPT.thread.replies.at(-1)!.text;
  const lastDmLine = DM_SCRIPT.at(-1)!.text;

  for (const [viewport, size] of Object.entries(VIEWPORTS) as [Viewport, { width: number; height: number }][]) {
    await page.setViewportSize(size);
    for (const theme of ["light", "dark"] as const) {
      const suffix = theme === "dark" ? "-dark" : "";
      await channelItem.click();
      await expect(page.getByTestId("timeline-message").filter({ hasText: lastMessage })).toBeVisible();
      await shot(page, viewport, `channel${suffix}`);

      // The reply count under the root opens the thread without a hover.
      await page.getByTestId("timeline-message").filter({ hasText: threadRoot }).getByTestId("open-thread").last().click();
      await expect(page.getByTestId("thread-pane").getByText(lastReply)).toBeVisible();
      await shot(page, viewport, `channel-thread${suffix}`);
      await page.getByRole("button", { name: "Close thread" }).click();

      await page.getByRole("button", { name: "Members", exact: true }).click();
      await expect(page.getByTestId("members-pane").getByText(PROFILES.ada.name)).toBeVisible();
      await shot(page, viewport, `channel-members${suffix}`);
      await page.getByRole("button", { name: "Close members" }).click();

      await page.getByTestId("conversation-list-item").filter({ hasText: PROFILES.ada.name }).click();
      await expect(page.getByTestId("conversation-view").getByText(lastDmLine)).toBeVisible();
      await shot(page, viewport, `dm${suffix}`);

      await page.getByTestId("mode-settings").click();
      await shot(page, viewport, `settings-appearance${suffix}`);
      await page.getByRole("complementary", { name: "Settings sections" }).getByRole("button", { name: "Profile" }).click();
      // Rendered, not necessarily on screen: at 390 px the Settings pane opens beside the
      // sidebar and the section falls outside the viewport. Flow 11 records what the app shows
      // — that layout is evidence for the visual acceptance, not something to fail CD on.
      await expect(page.getByTestId("profile-settings")).toBeAttached();
      await shot(page, viewport, `settings-profile${suffix}`);

      await page.getByRole("button", { name: /Switch to (dark|light)/ }).click();
    }
  }

  await writeFile(
    `${OUT}/manifest.json`,
    JSON.stringify(
      {
        sha: process.env.GITHUB_SHA ?? null,
        url: process.env.STUDIO_WEB_URL ?? null,
        workspace: testWorkspaceSlug(),
        channel: FIXTURE_CHANNEL,
        account: "fixtures (STUDIO_TEST_FIXTURES_EMAIL)",
        browser: browserName,
        capturedAt: new Date().toISOString(),
        viewports: { desktop: "1440x900", mobile: "390x844" },
      },
      null,
      2,
    ),
  );
});

import { expect, test } from "@playwright/test";
import { reachAppViaRestore } from "./helpers";

// Flow 2: sign in, open a Channel, send a Message, see it appear in the
// timeline (no photo yet — ticket #6). Assumes the test account is already
// a Channel Member of at least one Channel (seeded alongside the Workspace
// invite — see scripts/ops/seed-e2e-test-account.sh).
test.use({ storageState: undefined });

test("send a Message and see it in the Channel timeline", async ({ page }) => {
  await reachAppViaRestore(page);
  await expect(page.getByText(/Connected as/)).toBeVisible();

  await page.getByTestId("channel-list-item").first().click();

  const content = `e2e message ${Date.now()}`;
  await page.getByTestId("message-composer").fill(content);
  await page.getByTestId("message-composer").press("Enter");

  await expect(page.getByTestId("timeline-message").filter({ hasText: content })).toBeVisible({
    timeout: 10_000,
  });
});

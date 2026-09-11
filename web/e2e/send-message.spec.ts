import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { reachAppViaRestore } from "./helpers";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/test-image.png");

// Flow 2: sign in, open a Channel, send a Message with a photo attached, see
// both appear in the timeline (ticket #6). Assumes the test account is
// already a Channel Member of at least one Channel (seeded alongside the
// Workspace invite — see scripts/ops/seed-e2e-test-account.sh).
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

test("attach a photo, see the upload progress, and see it rendered inline", async ({ page }) => {
  await reachAppViaRestore(page);
  await expect(page.getByText(/Connected as/)).toBeVisible();

  await page.getByTestId("channel-list-item").first().click();

  await page.getByTestId("attach-input").setInputFiles(TEST_IMAGE);
  await expect(page.getByTestId("attachment-preview")).toBeVisible();
  await expect(page.getByTestId("attachment-error")).toHaveCount(0);

  const content = `e2e photo ${Date.now()}`;
  await page.getByTestId("message-composer").fill(content);
  await page.getByRole("button", { name: "Send" }).click();

  const message = page.getByTestId("timeline-message").filter({ hasText: content });
  await expect(message).toBeVisible({ timeout: 10_000 });
  await expect(message.getByTestId("attachment-image")).toBeVisible({ timeout: 10_000 });

  await message.getByTestId("attachment-image").click();
  await expect(page.getByTestId("attachment-lightbox")).toBeVisible();
});

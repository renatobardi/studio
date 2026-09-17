import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { makePng } from "../src/lib/testing/png";
import { reachAppViaRestore, sharedChannelItem } from "./helpers";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/test-image.png");

// Flow 2: sign in, open a Channel, send a Message with a photo attached, see
// both appear in the timeline (ticket #6), in the Workspace's shared "e2e"
// Channel — reachAppViaRestore makes the Identity a Member of it first.
test.use({ storageState: undefined });

test("send a Message and see it in the Channel timeline", async ({ page }) => {
  await reachAppViaRestore(page);
  await expect(page.getByTestId("account-menu-button")).toBeVisible();

  await sharedChannelItem(page).click();

  const content = `e2e message ${Date.now()}`;
  await page.getByTestId("message-composer").fill(content);
  await page.getByTestId("message-composer").press("Enter");

  await expect(page.getByTestId("timeline-message").filter({ hasText: content })).toBeVisible({
    timeout: 10_000,
  });
});

test("attach photos, see each one's upload progress, and see them rendered inline", async ({ page }) => {
  await reachAppViaRestore(page);
  await expect(page.getByTestId("account-menu-button")).toBeVisible();

  await sharedChannelItem(page).click();

  // #153: the limit is no longer written under the composer — a photo over it is refused
  // there, naming the limit, and a refused file offers no Retry (#107).
  await page.getByTestId("attach-input").setInputFiles({
    name: "too-big.png", mimeType: "image/png", buffer: Buffer.from(makePng(10 * 1024 * 1024 + 1)),
  });
  await expect(page.getByTestId("attachment-error")).toContainText("10 MB");
  await expect(page.getByTestId("attachment-preview").getByRole("button", { name: "Retry" })).toHaveCount(0);
  await page.getByTestId("attachment-preview").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("attachment-preview")).toHaveCount(0);

  // #48: more than one photo per Message, one of them the size of a real phone photo.
  await page.getByTestId("attach-input").setInputFiles([
    { name: "test-image.png", mimeType: "image/png", buffer: readFileSync(TEST_IMAGE) },
    { name: "phone-photo.png", mimeType: "image/png", buffer: Buffer.from(makePng(2 * 1024 * 1024)) },
  ]);
  await expect(page.getByTestId("attachment-preview")).toHaveCount(2);
  await expect(page.getByTestId("attachment-error")).toHaveCount(0);

  const content = `e2e photo ${Date.now()}`;
  await page.getByTestId("message-composer").fill(content);
  await page.getByRole("button", { name: "Send" }).click();

  const message = page.getByTestId("timeline-message").filter({ hasText: content });
  await expect(message).toBeVisible({ timeout: 10_000 });
  await expect(message.getByTestId("attachment-image")).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId("attachment-preview")).toHaveCount(0);

  await message.getByTestId("attachment-image").last().click();
  await expect(page.getByTestId("attachment-lightbox")).toBeVisible();
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  reachAppViaRestoreWithCredentials,
  testAccount,
  testAccountTwo,
  testBackupPassphrase,
  testBackupPassphraseTwo,
  testInviteCode,
  testInviteCodeTwo,
} from "./helpers";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/test-image.png");

// Flow 4 (ticket #7): a Direct Message between two Workspace Members, with a photo — NIP-17
// gift-wrapped end to end, so the relay only ever sees ciphertext and the `p`-tagged recipient.
// Needs two independently-seeded test Accounts (see helpers.ts's testAccountTwo) — DMs are the
// first flow in this repo to need more than one authenticated party in the same test.
test.use({ storageState: undefined });

test("a Direct Message with a photo is delivered between two browser contexts", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await reachAppViaRestoreWithCredentials(pageA, {
    email: testAccount.email(),
    password: testAccount.password(),
    inviteCode: testInviteCode(),
    backupPassphrase: testBackupPassphrase(),
  });
  const pubkeyB = await reachAppViaRestoreWithCredentials(pageB, {
    email: testAccountTwo.email(),
    password: testAccountTwo.password(),
    inviteCode: testInviteCodeTwo(),
    backupPassphrase: testBackupPassphraseTwo(),
  });

  await pageA.getByTestId("mode-dms").click();
  await pageA.getByTestId("dm-new-peer-input").fill(pubkeyB);
  await pageA.getByTestId("dm-new-peer-start").click();

  await pageA.getByTestId("dm-attach-input").setInputFiles(TEST_IMAGE);
  await expect(pageA.getByTestId("dm-attachment-preview")).toBeVisible();
  await expect(pageA.getByTestId("dm-attachment-error")).toHaveCount(0);

  const content = `e2e dm ${Date.now()}`;
  await pageA.getByTestId("dm-composer").fill(content);
  await pageA.getByRole("button", { name: "Send" }).click();

  const sentMessage = pageA.getByTestId("dm-message").filter({ hasText: content });
  await expect(sentMessage).toBeVisible({ timeout: 10_000 });
  await expect(sentMessage.getByTestId("dm-attachment-image")).toBeVisible({ timeout: 10_000 });

  await pageB.getByTestId("mode-dms").click();
  await pageB.getByTestId("conversation-list-item").first().click();

  const receivedMessage = pageB.getByTestId("dm-message").filter({ hasText: content });
  await expect(receivedMessage).toBeVisible({ timeout: 10_000 });
  await expect(receivedMessage.getByTestId("dm-attachment-image")).toBeVisible({ timeout: 10_000 });

  await receivedMessage.getByTestId("dm-attachment-image").click();
  await expect(pageB.getByTestId("dm-attachment-lightbox")).toBeVisible();

  await contextA.close();
  await contextB.close();
});

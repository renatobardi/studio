import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  reachAppViaRestoreWithCredentials,
  testAccount,
  testAccountTwo,
  testBackupPassphrase,
  testBackupPassphraseTwo,
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
    backupPassphrase: testBackupPassphrase(),
  });
  const pubkeyB = await reachAppViaRestoreWithCredentials(pageB, {
    email: testAccountTwo.email(),
    password: testAccountTwo.password(),
    backupPassphrase: testBackupPassphraseTwo(),
  });

  await pageA.getByTestId("mode-dms").click();
  // The DM pane's empty-state text briefly overlaps the new-peer form right after the mode
  // switch (issue #61) — wait for the input to be the one actually receiving events before
  // interacting, rather than just present in the DOM.
  await pageA.getByTestId("dm-new-peer-input").waitFor({ state: "visible" });
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

  // B answers, so the restore below has both directions of the conversation to recover.
  const reply = `e2e dm reply ${Date.now()}`;
  await pageB.getByTestId("dm-composer").fill(reply);
  await pageB.getByRole("button", { name: "Send" }).click();
  await expect(pageB.getByTestId("dm-message").filter({ hasText: reply })).toBeVisible({ timeout: 10_000 });

  // Issue #40: gift wraps are the only history that lives nowhere but the relay and the
  // Identity's own key. Restoring that Identity on a brand-new browser must bring both the
  // sent copy (A's self-addressed wrap) and the received one back, decrypted. A's first
  // context goes away first, so this is a restore onto a cold browser and not two live
  // sessions of the same Identity.
  await contextA.close();

  const contextC = await browser.newContext();
  const pageC = await contextC.newPage();
  await reachAppViaRestoreWithCredentials(pageC, {
    email: testAccount.email(),
    password: testAccount.password(),
    backupPassphrase: testBackupPassphrase(),
  });

  await pageC.getByTestId("mode-dms").click();
  // Picked by its own last message rather than by position: this Account accumulates
  // conversations across runs, and only this one is this run's.
  await pageC.getByTestId("conversation-list-item").filter({ hasText: reply }).click();
  await expect(pageC.getByTestId("dm-message").filter({ hasText: content })).toBeVisible({ timeout: 15_000 });
  await expect(pageC.getByTestId("dm-message").filter({ hasText: reply })).toBeVisible({ timeout: 15_000 });
  await expect(
    pageC.getByTestId("dm-message").filter({ hasText: content }).getByTestId("dm-attachment-image"),
  ).toBeVisible({ timeout: 15_000 });

  await contextB.close();
  await contextC.close();
});

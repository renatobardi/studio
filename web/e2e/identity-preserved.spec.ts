import { expect, test } from "@playwright/test";
import { reachAppViaRestoreWithCredentials, testAccount, testBackupPassphrase } from "./helpers";

/**
 * Flow 6 (#36): an Account keeps the Identity it was onboarded with. Signing
 * in on a brand-new browser must never offer to make a second one — and must
 * reconnect through the Account's own Workspaces, with no invite involved.
 */
test.use({ storageState: undefined });

test("signing in again on a new browser restores the same Identity", async ({ browser }) => {
  const credentials = {
    email: testAccount.email(),
    password: testAccount.password(),
    backupPassphrase: testBackupPassphrase(),
  };

  const first = await browser.newContext();
  const firstPubkey = await reachAppViaRestoreWithCredentials(await first.newPage(), credentials);
  await first.close();

  const second = await browser.newContext();
  const page = await second.newPage();
  const secondPubkey = await reachAppViaRestoreWithCredentials(page, credentials);

  expect(secondPubkey).toBe(firstPubkey);
  await expect(page.getByText(/Connected as/)).toBeVisible();
  await second.close();
});

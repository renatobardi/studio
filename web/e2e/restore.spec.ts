import { expect, test } from "@playwright/test";
import { testAccount, testBackupPassphrase, testInviteCode } from "./helpers";

// Flow 5: fresh browser context (no local IndexedDB state), sign in, restore
// the Identity from the server-held Key Backup, and reconnect to the relay.
// Depends on a Key Backup already existing for this account — run
// onboarding.spec.ts against the same account first.
test.use({ storageState: undefined });

test("restore Identity from Key Backup on a fresh browser", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Email").fill(testAccount.email());
  await page.getByLabel("Password").fill(testAccount.password());
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByPlaceholder("Invite code").fill(testInviteCode());
  await page.getByRole("button", { name: "Restore an existing Identity from Key Backup" }).click();

  await page.getByPlaceholder("Backup passphrase").fill(testBackupPassphrase());
  await page.getByRole("button", { name: "Restore" }).click();

  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByText(/Connected as/)).toBeVisible();
});

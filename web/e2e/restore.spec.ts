import { expect, test } from "@playwright/test";
import { testAccount, testBackupPassphrase } from "./helpers";

// Flow 5: fresh browser context (no local IndexedDB state), sign in, restore
// the Identity from the server-held Key Backup, and reconnect to the relay.
// Depends on a Key Backup already existing for this account — run
// onboarding.spec.ts against the same account first.
test.use({ storageState: undefined });

test("restore Identity from Key Backup on a fresh browser, with no invite", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Email").fill(testAccount.email());
  await page.getByLabel("Password").fill(testAccount.password());
  await page.getByRole("button", { name: "Sign in" }).click();

  // An Account that already has an Identity opens straight on restore: no
  // invite is asked for, so an expired, revoked or already-spent invite can
  // never stand between someone and their own account (#36).
  await expect(page.getByRole("heading", { name: "Restore your Identity" })).toBeVisible();
  await expect(page.getByPlaceholder("Invite code")).toHaveCount(0);

  await page.getByPlaceholder("Backup passphrase").fill(testBackupPassphrase());
  await page.getByRole("button", { name: "Restore" }).click();

  await page.getByRole("button", { name: /^Connect/ }).first().click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByText(/Connected as/)).toBeVisible();
});

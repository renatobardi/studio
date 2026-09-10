import { expect, test } from "@playwright/test";
import { testAccount, testBackupPassphrase, testInviteCode } from "./helpers";

// Flow 1: sign in (pre-verified test account), walk onboarding through a
// verified Key Backup, land in the app shell connected to the Workspace.
test("onboarding through verified Key Backup", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Email").fill(testAccount.email());
  await page.getByLabel("Password").fill(testAccount.password());
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByPlaceholder("Invite code").fill(testInviteCode());
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Your name").fill("E2E Test Person");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Continue" }).click(); // avatar: keep default

  await expect(page.locator(".nsec-reveal")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  const passphrase = testBackupPassphrase();
  await page.getByPlaceholder("Backup passphrase").fill(passphrase);
  await page.getByPlaceholder("Confirm passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Create backup" }).click();

  await page.getByPlaceholder("Backup passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("✓ Verified")).toBeVisible();

  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByText(/Connected as/)).toBeVisible();
});

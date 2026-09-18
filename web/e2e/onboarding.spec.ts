import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ownerApi, previewInvite, redeemInviteOnOnboarding, testOnboardingAccount } from "./helpers";

// Flow 1: first access. Sign in on an Account with no Identity, redeem a
// single-use Invite, walk onboarding through a verified Key Backup and land in
// the app shell. Then, on a fresh browser, the same Account restores that
// Identity without being asked for the Invite it has just exhausted (#36).
//
// First access happens once per Account, so this runs on an Account CD deletes
// and creates again before every smoke (studio_api.ensure_e2e_accounts) — never
// on the Accounts the other flows restore.
test.use({ storageState: undefined });
// A retry would meet an Account that already has an Identity: it can only fail
// again, and less clearly than the first attempt did.
test.describe.configure({ retries: 0 });

test("first access onboards through a verified Key Backup, and restore skips the spent invite", async ({
  browser,
}) => {
  test.slow(); // onboarding, then a second browser context restoring it
  const passphrase = `e2e-${randomUUID()}`;
  const first = await browser.newContext();
  const page = await first.newPage();

  await page.goto("/");
  const apiBase = new URL(page.url()).origin;
  const invite = await ownerApi.createSingleUseInvite(apiBase);

  await page.getByLabel("Email").fill(testOnboardingAccount.email());
  await page.getByLabel("Password", { exact: true }).fill(testOnboardingAccount.password());
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Join your community" })).toBeVisible({ timeout: 15_000 });
  await redeemInviteOnOnboarding(page, invite.code);

  await page.getByPlaceholder("Your name").fill("E2E Onboarding Person");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Continue" }).click(); // avatar: keep default

  await expect(page.locator(".nsec-reveal")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Backup passphrase").fill(passphrase);
  await page.getByPlaceholder("Confirm passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Create backup" }).click();

  await page.getByPlaceholder("Backup passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("✓ Verified")).toBeVisible();

  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  const pubkey = await page.getByTestId("own-pubkey").textContent();
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText(/Connected as/)).toBeVisible();

  try {
    // The Invite admitted exactly one person, and this was it.
    expect(await previewInvite(apiBase, invite.code)).toMatchObject({ valid: false, reason: "exhausted" });
    await first.close();

    // --- A fresh browser: the Account opens on restore, with no Invite to get past.
    const second = await browser.newContext();
    const restorePage = await second.newPage();
    await restorePage.goto("/");
    await restorePage.getByLabel("Email").fill(testOnboardingAccount.email());
    await restorePage.getByLabel("Password", { exact: true }).fill(testOnboardingAccount.password());
    await restorePage.getByRole("button", { name: "Sign in" }).click();

    await expect(restorePage.getByRole("heading", { name: "Restore your Identity" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(restorePage.getByLabel(/^Invite (link or )?code$/)).toHaveCount(0);
    await restorePage.getByPlaceholder("Backup passphrase").fill(passphrase);
    await restorePage.getByRole("button", { name: "Restore" }).click();

    await restorePage.getByRole("button", { name: /^Connect/ }).first().click();
    await expect(restorePage.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
    await expect(restorePage.getByTestId("own-pubkey")).toHaveText(pubkey!);
    await restorePage.getByRole("button", { name: "Finish" }).click();
    await expect(restorePage.getByText(/Connected as/)).toBeVisible();
    await second.close();
  } finally {
    // The Account is recreated on the next deploy, its Identity is not: without this the
    // Workspace would gain one orphaned Member per deploy.
    await ownerApi.removeWorkspaceMember(apiBase, pubkey!);
  }
});

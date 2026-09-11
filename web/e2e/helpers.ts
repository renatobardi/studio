/**
 * These flows run against a real deployed studio-test stack (real Firebase
 * project, real relay). Credentials come from env, seeded by
 * scripts/ops/seed-e2e-test-account.sh — see that script for what it creates.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see scripts/ops/seed-e2e-test-account.sh`);
  return value;
}

export const testAccount = {
  email: () => requiredEnv("STUDIO_TEST_EMAIL"),
  password: () => requiredEnv("STUDIO_TEST_PASSWORD"),
};

export const testInviteCode = () => requiredEnv("STUDIO_TEST_INVITE_CODE");
export const testBackupPassphrase = () => requiredEnv("STUDIO_TEST_BACKUP_PASSPHRASE");

/** Sign in and restore the Identity from Key Backup (same steps as flow 5,
 * restore.spec.ts) — the deterministic way for a flow to reach the app
 * shell without depending on run order or re-running onboarding's Key
 * Backup creation. Requires a Key Backup to already exist for this account
 * (onboarding.spec.ts creates one). */
export async function reachAppViaRestore(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");

  await page.getByLabel("Email").fill(testAccount.email());
  await page.getByLabel("Password").fill(testAccount.password());
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByPlaceholder("Invite code").fill(testInviteCode());
  await page.getByRole("button", { name: "Restore an existing Identity from Key Backup" }).click();

  await page.getByPlaceholder("Backup passphrase").fill(testBackupPassphrase());
  await page.getByRole("button", { name: "Restore" }).click();

  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: /You're in/ }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish" }).click();
}

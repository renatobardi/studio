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

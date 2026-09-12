import { describe, expect, test } from "bun:test";
import {
  decryptBackup,
  encryptBackup,
  needsAccountPassword,
  validateBackupPassphrase,
} from "./backup";

describe("encryptBackup / decryptBackup", () => {
  test("round-trips the nsec through an age passphrase file", async () => {
    const nsec = "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    const blob = await encryptBackup(nsec, "correct horse battery staple");

    expect(blob).toBeInstanceOf(Uint8Array);
    expect(await decryptBackup(blob, "correct horse battery staple")).toBe(nsec);
  });

  test("rejects decryption with the wrong passphrase", async () => {
    const nsec = "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    const blob = await encryptBackup(nsec, "correct horse battery staple");

    await expect(decryptBackup(blob, "wrong passphrase")).rejects.toThrow();
  });
});

describe("validateBackupPassphrase", () => {
  test("rejects a passphrase equal to the account password", () => {
    expect(validateBackupPassphrase("hunter2hunter2", "hunter2hunter2")).toBe(
      "The Key Backup passphrase must be different from your account password.",
    );
  });

  test("rejects a passphrase shorter than 8 characters", () => {
    expect(validateBackupPassphrase("short", "unrelated-password")).toBe(
      "Use 8 characters or more.",
    );
  });

  test("accepts a passphrase that differs from the account password and is long enough", () => {
    expect(validateBackupPassphrase("correct horse battery staple", "hunter2hunter2")).toBeNull();
  });
});

describe("needsAccountPassword", () => {
  test("a password account whose password is no longer in memory must confirm it", () => {
    // After a reload the password is gone — and it is never persisted, so the
    // only way to keep enforcing "different from the account password" is to
    // ask for it again (#36).
    expect(needsAccountPassword(["password"], null)).toBe(true);
  });

  test("nothing to ask once the password is known for this session", () => {
    expect(needsAccountPassword(["password"], "hunter2hunter2")).toBe(false);
  });

  test("a Google account has no password to differ from", () => {
    expect(needsAccountPassword(["google.com"], null)).toBe(false);
  });
});

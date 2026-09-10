import { describe, expect, test } from "bun:test";
import { decryptBackup, encryptBackup, validateBackupPassphrase } from "./backup";

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

import { describe, expect, test } from "bun:test";
import { keyBackupRow } from "./settingsProfile";

/** Settings › Profile shows the Key Backup the prototype shows (#150): the state comes from
 * whether the Account holds one, and only local custody has one to manage. */
describe("keyBackupRow", () => {
  test("a stored Key Backup is the verified one — it is only stored after verifying", () => {
    expect(keyBackupRow("local", true)).toEqual({ value: "Verified · studio-key-backup.age", manage: true });
  });

  test("without one, it says so and still offers to make it", () => {
    expect(keyBackupRow("local", false)).toEqual({ value: "Not verified", manage: true });
  });

  test("before the account has answered, nothing is claimed either way", () => {
    expect(keyBackupRow("local", null)).toEqual({ value: "Checking…", manage: false });
  });

  test("under a NIP-07 extension there is no key to back up here", () => {
    expect(keyBackupRow("extension", false)).toEqual({
      value: "Your Nostr extension holds your private key.",
      manage: false,
    });
  });
});

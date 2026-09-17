import { describe, expect, test } from "bun:test";
import { signOutBlocker } from "./signOut";

/** Sign out wipes this device's Identity and data (#148): the prototype's dialog only arms its
 * destructive button once the backup is confirmed and the phrase typed exactly. */
describe("signOutBlocker", () => {
  test("the key backup is confirmed first", () => {
    expect(signOutBlocker({ backupConfirmed: false, phrase: "wipe all my data" })).toBe("Confirm your key backup first.");
  });

  test("then the phrase has to be typed exactly", () => {
    expect(signOutBlocker({ backupConfirmed: true, phrase: "" })).toBe("Type the phrase exactly to enable the button.");
    expect(signOutBlocker({ backupConfirmed: true, phrase: "wipe all data" })).toBe("Type the phrase exactly to enable the button.");
  });

  test("with both, nothing blocks — surrounding spaces aside", () => {
    expect(signOutBlocker({ backupConfirmed: true, phrase: "  wipe all my data " })).toBeNull();
  });
});

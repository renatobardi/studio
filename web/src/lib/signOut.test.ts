import { describe, expect, test } from "bun:test";
import { isEscape, isOutsideClick, signOutBlocker } from "./signOut";

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

/** The backdrop dismisses the dialog on a click that is its own, and on Escape — the dialog box
 * inside it is not interactive and carries no handler of its own. */
describe("isOutsideClick", () => {
  test("a click on the backdrop itself dismisses", () => {
    const backdrop = {};
    expect(isOutsideClick({ target: backdrop, currentTarget: backdrop })).toBe(true);
  });

  test("a click that bubbled up from the dialog box does not", () => {
    expect(isOutsideClick({ target: {}, currentTarget: {} })).toBe(false);
  });
});

describe("isEscape", () => {
  test("Escape dismisses", () => {
    expect(isEscape({ key: "Escape" })).toBe(true);
  });

  test("no other key does", () => {
    expect(isEscape({ key: "Enter" })).toBe(false);
    expect(isEscape({ key: "Esc" })).toBe(false);
  });
});

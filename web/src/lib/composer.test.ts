import { describe, expect, test } from "bun:test";
import { sendsOnKey } from "./composer";

/** The multiline composer (#70): Enter sends, Shift+Enter breaks the line, and a key pressed
 * while an IME is still composing — picking a kanji, say — is the IME's, not ours. */
describe("sendsOnKey", () => {
  test("Enter sends", () => {
    expect(sendsOnKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
  });
  test("Shift+Enter is a new line", () => {
    expect(sendsOnKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  });
  test("Enter during IME composition is left to the IME", () => {
    expect(sendsOnKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });
  test("any other key types", () => {
    expect(sendsOnKey({ key: "a", shiftKey: false, isComposing: false })).toBe(false);
  });
});

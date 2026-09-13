import { describe, expect, test } from "bun:test";
import { clockTime, isContinuation, sendsOnKey } from "./composer";

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

/** Times in the timeline read "08:02" as in the prototype — 24h, zero-padded, no seconds. */
describe("clockTime", () => {
  test("formats to hours and minutes in the given zone", () => {
    const at = Date.UTC(2026, 8, 11, 8, 2, 30) / 1000;
    expect(clockTime(at, "UTC")).toBe("08:02");
    expect(clockTime(at, "America/Sao_Paulo")).toBe("05:02");
  });
});

/** Consecutive Messages from the same author share one avatar and header — by author alone,
 * as the prototype groups its rows. */
describe("isContinuation", () => {
  const a = { pubkey: "a" };
  test("the first Message is never a continuation", () => {
    expect(isContinuation(undefined, a)).toBe(false);
  });
  test("the same author again continues, however long after", () => {
    expect(isContinuation(a, { pubkey: "a" })).toBe(true);
  });
  test("a different author starts afresh", () => {
    expect(isContinuation(a, { pubkey: "b" })).toBe(false);
  });
});

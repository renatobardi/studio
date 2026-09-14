import { describe, expect, test } from "bun:test";
import { clockTime, isContinuation } from "./messageRow";

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

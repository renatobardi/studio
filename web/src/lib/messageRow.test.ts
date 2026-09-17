import { describe, expect, test } from "bun:test";
import { clockTime, isContinuation, relativeTime } from "./messageRow";

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

/** "last reply 12m ago" — the prototype's short relative form: just now, m, h, d. */
describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 11, 10, 0, 0) / 1000;
  test("under a minute (or a clock slightly behind) is just now", () => {
    expect(relativeTime(now - 59, now)).toBe("just now");
    expect(relativeTime(now + 30, now)).toBe("just now");
  });
  test("minutes, then hours, then days, rounded down", () => {
    expect(relativeTime(now - 12 * 60, now)).toBe("12m ago");
    expect(relativeTime(now - 59 * 60 - 59, now)).toBe("59m ago");
    expect(relativeTime(now - 3 * 3600 - 1800, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86400 - 3600, now)).toBe("2d ago");
  });
});

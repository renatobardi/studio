import { describe, expect, test } from "bun:test";
import { oldestRead, seedMissing, touch, unreadChannelIds } from "./unread";

describe("seedMissing", () => {
  test("treats a Channel seen for the first time as read up to now", () => {
    // Otherwise every Channel's whole history would count as unread the first
    // time the app ever sees it.
    expect(seedMissing({}, ["a", "b"], 500)).toEqual({ a: 500, b: 500 });
  });

  test("never moves a Channel that already has a last-read mark", () => {
    expect(seedMissing({ a: 100 }, ["a", "b"], 500)).toEqual({ a: 100, b: 500 });
  });
});

describe("touch", () => {
  test("records the timestamp for a Channel with none", () => {
    expect(touch({}, "a", 100)).toEqual({ a: 100 });
  });

  test("keeps the newest timestamp, so a late-arriving older event never rewinds it", () => {
    expect(touch({ a: 200 }, "a", 100)).toEqual({ a: 200 });
  });

  test("returns the same object when nothing moved, so React can skip the render", () => {
    const state = { a: 200 };
    expect(touch(state, "a", 100)).toBe(state);
  });

  test("leaves every other Channel untouched — opening one conversation never reads another", () => {
    expect(touch({ a: 100, b: 100 }, "a", 300)).toEqual({ a: 300, b: 100 });
  });
});

describe("unreadChannelIds", () => {
  test("a Channel with activity newer than its last read is unread", () => {
    expect(unreadChannelIds({ a: 100 }, { a: 200 })).toEqual(new Set(["a"]));
  });

  test("activity at or before the last read is read", () => {
    expect(unreadChannelIds({ a: 200 }, { a: 200 })).toEqual(new Set());
  });

  test("activity in a Channel that was never read is unread", () => {
    expect(unreadChannelIds({}, { a: 200 })).toEqual(new Set(["a"]));
  });
});

describe("oldestRead", () => {
  test("is the earliest last-read mark among the Channels on screen", () => {
    expect(oldestRead({ a: 300, b: 100, c: 50 }, ["a", "b"], 999)).toBe(100);
  });

  test("ignores Channels with no mark of their own", () => {
    expect(oldestRead({ a: 300 }, ["a", "b"], 999)).toBe(300);
  });

  test("falls back when nothing has ever been read", () => {
    expect(oldestRead({}, ["a"], 999)).toBe(999);
  });
});

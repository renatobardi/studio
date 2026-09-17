import { describe, expect, test } from "bun:test";
import { firstNewMessageId, oldestRead, seedMissing, touch, unreadChannelIds } from "./unread";

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

describe("firstNewMessageId", () => {
  const me = "me";
  const msg = (id: string, created_at: number, pubkey = "other") => ({ id, created_at, pubkey });
  const opened = { readAt: 100, openedAt: 200 };

  test("is the oldest Message after the last-read mark the Channel was opened with", () => {
    const messages = [msg("c", 150), msg("a", 50), msg("b", 120)];
    expect(firstNewMessageId(messages, opened, me)).toBe("b");
  });

  test("is null when everything was already read", () => {
    expect(firstNewMessageId([msg("a", 50), msg("b", 100)], opened, me)).toBeNull();
  });

  test("ignores Messages that arrive while the Channel is on screen", () => {
    // They are read as they arrive — a divider over them would announce nothing new.
    expect(firstNewMessageId([msg("a", 50), msg("b", 201)], opened, me)).toBeNull();
  });

  test("ignores the caller's own Messages, which never count as unread", () => {
    expect(firstNewMessageId([msg("a", 120, me), msg("b", 150)], opened, me)).toBe("b");
  });
});

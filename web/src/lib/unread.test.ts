import { describe, expect, test } from "bun:test";
import {
  firstNewMessageId,
  initialDmRead,
  markConversationRead,
  messagesWithDivider,
  oldestRead,
  openChannel,
  seedMissing,
  touch,
  unreadChannelIds,
  unreadConversationCounts,
} from "./unread";

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

  test("is null for a Channel with no Messages at all", () => {
    expect(firstNewMessageId([], opened, me)).toBeNull();
  });
});

describe("openChannel", () => {
  test("keeps the last-read mark the Channel still had, and when it was opened", () => {
    expect(openChannel({ a: 100 }, "a", 200)).toEqual({ readAt: 100, openedAt: 200 });
  });

  test("a Channel with no mark of its own has nothing unread to point at", () => {
    // Its mark is about to be seeded at `now` too, so the divider has no Message to sit above.
    expect(openChannel({}, "a", 200)).toEqual({ readAt: 200, openedAt: 200 });
  });
});

describe("messagesWithDivider", () => {
  const me = "me";
  const msg = (id: string, created_at: number, pubkey = "other") => ({ id, created_at, pubkey });

  test("sorts oldest first and points at the first Message that arrived while away", () => {
    const result = messagesWithDivider([msg("c", 150), msg("a", 50), msg("b", 120)], { readAt: 100, openedAt: 200 }, me);
    expect(result.sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(result.newMessageId).toBe("b");
  });

  test("has no divider before the Channel has been opened", () => {
    const result = messagesWithDivider([msg("a", 150)], null, me);
    expect(result.sorted.map((m) => m.id)).toEqual(["a"]);
    expect(result.newMessageId).toBeNull();
  });
});

/** Direct messages in the sidebar (#142): the sidebar row carries how many Messages someone else
 * wrote in the conversation after its last-read mark, as the prototype's count. */
describe("unreadConversationCounts", () => {
  const ME = "me";
  const conversation = (key: string, ...messages: [pubkey: string, at: number][]) => ({
    key,
    messages: messages.map(([pubkey, created_at]) => ({ pubkey, created_at })),
  });

  test("counts the Messages from someone else after the conversation's mark", () => {
    const counts = unreadConversationCounts(
      [conversation("ana", ["ana", 200], ["ana", 300]), conversation("sprig", ["sprig", 90])],
      { since: 0, readAt: { ana: 100, sprig: 100 } },
      ME,
    );
    expect([...counts]).toEqual([["ana", 2]]);
  });

  test("a conversation with nothing unread is left out, rather than counted as zero", () => {
    expect(unreadConversationCounts([conversation("sprig", ["sprig", 90])], { since: 0, readAt: { sprig: 100 } }, ME).size).toBe(0);
  });

  test("the caller's own Messages never count", () => {
    expect(unreadConversationCounts([conversation("ana", [ME, 200])], { since: 0, readAt: { ana: 100 } }, ME).size).toBe(0);
  });

  test("with no mark yet, only what arrived after this browser started keeping marks counts", () => {
    // A restore onto a new browser must not open with every conversation's history unread,
    // while a first Message someone sends later still has to show.
    const counts = unreadConversationCounts(
      [conversation("old", ["marina", 100]), conversation("new", ["tomas", 300])],
      { since: 200, readAt: {} },
      ME,
    );
    expect([...counts]).toEqual([["new", 1]]);
  });
});

/** Direct message marks are kept per conversation (#142), and only from the moment this browser
 * started keeping them — history that predates them is not a pile of unread Messages. */
describe("initialDmRead", () => {
  test("starts from what this browser kept", () => {
    const stored = { since: 100, readAt: { "a,me": 300 } };
    expect(initialDmRead(stored, 900)).toBe(stored);
  });

  test("with nothing kept yet, everything up to now counts as read", () => {
    expect(initialDmRead(undefined, 900)).toEqual({ since: 900, readAt: {} });
  });
});

describe("markConversationRead", () => {
  test("marks the conversation read up to now", () => {
    expect(markConversationRead({ since: 100, readAt: {} }, "a,me", 900, 500)).toEqual({
      since: 100,
      readAt: { "a,me": 900 },
    });
  });

  test("a Message from ahead of this clock is still read, so it is not left unread forever", () => {
    expect(markConversationRead({ since: 100, readAt: {} }, "a,me", 900, 1500).readAt["a,me"]).toBe(1500);
  });

  test("leaves every other conversation, and the start of the marks, alone", () => {
    const state = { since: 100, readAt: { "b,me": 200 } };
    expect(markConversationRead(state, "a,me", 900, 0)).toEqual({ since: 100, readAt: { "b,me": 200, "a,me": 900 } });
  });
});

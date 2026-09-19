import { describe, expect, test } from "bun:test";
import type { VerifiedEvent } from "nostr-tools";
import {
  DM_PAGE_SIZE,
  DM_SHOWN_STEP,
  OPEN_WINDOW_SECONDS,
  WRAP_BACKDATE_SECONDS,
  askOlder,
  asksForOlder,
  completeFrom,
  dmHistoryView,
  isLastDmPage,
  keepFetchingOlder,
  liveDmFilters,
  needsOpeningBackfill,
  olderDmFilters,
} from "./dmPagination";

const ME = "me";

const wrap = (id: string, createdAt: number) => ({ id, created_at: createdAt }) as VerifiedEvent;
const rumor = (id: string, createdAt: number) => ({ id, created_at: createdAt });

describe("DM paging filters", () => {
  test("the first page is a window of the newest gift wraps addressed to the caller", () => {
    expect(liveDmFilters(ME)).toEqual([{ kinds: [1059], "#p": [ME], limit: DM_PAGE_SIZE }]);
  });

  test("an older page reaches below the oldest gift wrap paged in, past the wraps replayed at that second", () => {
    const paged = [wrap("a", 500), wrap("b", 300)];
    const held = [...paged, wrap("c", 300), wrap("live", 100)];
    expect(olderDmFilters(ME, paged, held)).toEqual([
      { kinds: [1059], "#p": [ME], until: 300, limit: DM_PAGE_SIZE + 2 },
    ]);
  });

  test("a wrap that arrived live never moves the cursor, however far back it is dated", () => {
    // NIP-59 backdates it by up to two days: paging from it would skip every wrap in between.
    const paged = [wrap("a", 500)];
    expect(olderDmFilters(ME, paged, [...paged, wrap("live", 100)])[0]?.until).toBe(500);
  });
});

describe("isLastDmPage", () => {
  test("a page with fewer unseen wraps than a page's worth proves the history is exhausted", () => {
    const known = new Set(["a"]);
    const page = [wrap("a", 300), ...Array.from({ length: DM_PAGE_SIZE - 1 }, (_, i) => wrap(`n${i}`, 200))];
    expect(isLastDmPage(known, page)).toBe(true);
  });

  test("a full page of unseen wraps may have more behind it", () => {
    const page = Array.from({ length: DM_PAGE_SIZE }, (_, i) => wrap(`n${i}`, 200));
    expect(isLastDmPage(new Set(["a"]), [wrap("a", 300), ...page])).toBe(false);
  });
});

/** A gift wrap's created_at is the send time minus up to two days (NIP-59), so a page reaching
 * down to wrap time T holds every wrap of a Message sent after T + two days — and only some of
 * the wraps of one sent before that. */
describe("completeFrom", () => {
  test("is the oldest wrap held plus the backdating allowance, while older wraps may exist", () => {
    expect(completeFrom(1_000, true)).toBe(1_000 + WRAP_BACKDATE_SECONDS);
  });

  test("allows a margin beyond the two days NIP-59 backdates by", () => {
    expect(WRAP_BACKDATE_SECONDS).toBeGreaterThan(2 * 24 * 60 * 60);
  });

  test("once the history is exhausted everything held is complete", () => {
    expect(completeFrom(1_000, false)).toBe(-Infinity);
    expect(completeFrom(null, false)).toBe(-Infinity);
  });
});

describe("needsOpeningBackfill", () => {
  const now = 10_000_000;
  test("keeps paging while the last day is not yet complete", () => {
    expect(needsOpeningBackfill(now - OPEN_WINDOW_SECONDS + 1, now)).toBe(true);
  });

  test("stops once the last day is complete", () => {
    expect(needsOpeningBackfill(now - OPEN_WINDOW_SECONDS, now)).toBe(false);
    expect(needsOpeningBackfill(-Infinity, now)).toBe(false);
  });
});

describe("dmHistoryView", () => {
  const unasked = { shown: DM_SHOWN_STEP, waitingPast: null };

  test("leaves out Messages older than where the history is complete, and offers to load them", () => {
    const messages = [rumor("old", 10), rumor("mid", 20), rumor("new", 30)];
    const view = dmHistoryView(messages, 20, unasked, true);
    expect(view.messages).toEqual([rumor("mid", 20), rumor("new", 30)]);
    expect(view.hidden).toBe(0);
    expect(view.canLoadOlder).toBe(true);
  });

  test("mounts only the newest ones asked for, counting the complete ones kept back", () => {
    const messages = Array.from({ length: 5 }, (_, i) => rumor(`m${i}`, i));
    const view = dmHistoryView(messages, -Infinity, { shown: 2, waitingPast: null }, false);
    expect(view.messages).toEqual([rumor("m3", 3), rumor("m4", 4)]);
    expect(view.hidden).toBe(3);
    expect(view.complete).toBe(5);
    expect(view.canLoadOlder).toBe(true);
  });

  test("offers nothing older once all of it is on screen", () => {
    expect(dmHistoryView([rumor("only", 1)], -Infinity, unasked, false).canLoadOlder).toBe(false);
  });

  test("keeps fetching while the reader waits on a page that brought nothing here", () => {
    const view = dmHistoryView([rumor("only", 1)], -Infinity, { shown: 100, waitingPast: 1 }, true);
    expect(view.fetchOlder).toBe(true);
  });
});

describe("asksForOlder", () => {
  test("reaching the top while scrolling up asks for older Messages", () => {
    expect(asksForOlder(100, 40, 48)).toBe(true);
  });

  test("scrolling down from the top — where a conversation opens — does not", () => {
    expect(asksForOlder(0, 40, 48)).toBe(false);
  });

  test("scrolling up far from the top does not", () => {
    expect(asksForOlder(300, 200, 48)).toBe(false);
  });
});

describe("asking for older Direct Messages", () => {
  test("shows another step of what is already held, without waiting on the relay", () => {
    const state = askOlder({ shown: 50, waitingPast: null }, { hidden: 10, complete: 60, hasMore: true });
    expect(askOlder(state, { hidden: 0, complete: 60, hasMore: false })).toEqual({ shown: 150, waitingPast: null });
    expect(state).toEqual({ shown: 100, waitingPast: null });
    expect(keepFetchingOlder(state, { complete: 60, hasMore: true })).toBe(false);
  });

  test("with nothing held back, fetches until the conversation gains a Message", () => {
    const state = askOlder({ shown: 50, waitingPast: null }, { hidden: 0, complete: 7, hasMore: true });
    expect(state).toEqual({ shown: 100, waitingPast: 7 });
    expect(keepFetchingOlder(state, { complete: 7, hasMore: true })).toBe(true);
    expect(keepFetchingOlder(state, { complete: 8, hasMore: true })).toBe(false);
  });

  test("stops fetching when the history runs out", () => {
    const state = askOlder({ shown: 50, waitingPast: null }, { hidden: 0, complete: 7, hasMore: true });
    expect(keepFetchingOlder(state, { complete: 7, hasMore: false })).toBe(false);
  });

  test("never fetches unasked", () => {
    expect(keepFetchingOlder({ shown: 50, waitingPast: null }, { complete: 0, hasMore: true })).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  DM_PAGE_SIZE,
  DM_SHOWN_STEP,
  OPEN_WINDOW_SECONDS,
  WRAP_BACKDATE_SECONDS,
  DM_OPENING_PAGES,
  askOlder,
  completeFrom,
  dmHistoryView,
  isLastDmPage,
  keepFetchingOlder,
  liveDmFilters,
  needsOpeningBackfill,
  olderDmFilters,
  openedConversation,
  type ShownState,
} from "./dmPagination";
import { MAX_LIMIT } from "./relay";
import { verifiedEvent } from "./testing/events";

const ME = "me";

const wrap = (id: string, createdAt: number) =>
  verifiedEvent({ id, created_at: createdAt, kind: 1059, pubkey: "one-time", tags: [], content: "", sig: "" });
const rumor = (id: string, createdAt: number) => ({ id, created_at: createdAt });

describe("DM paging filters", () => {
  test("the first page is a window of the newest gift wraps addressed to the caller", () => {
    expect(liveDmFilters(ME)).toEqual([{ kinds: [1059], "#p": [ME], limit: DM_PAGE_SIZE }]);
  });

  test("an older page reaches below the oldest gift wrap paged in, past every wrap already held there", () => {
    // `until` is inclusive and a live wrap is backdated (NIP-59), so the page replays the two
    // held at the cursor second and the one below it: all three are what `isLastDmPage`
    // discounts, so all three have to ride on top of the limit.
    const paged = [wrap("a", 500), wrap("b", 300)];
    const held = [...paged, wrap("c", 300), wrap("live", 100)];
    expect(olderDmFilters(ME, paged, held)).toEqual([
      { kinds: [1059], "#p": [ME], until: 300, limit: DM_PAGE_SIZE + 3 },
    ]);
  });

  test("never asks past the relay's ceiling, whatever is held below the cursor", () => {
    // The relay clamps at MAX_LIMIT silently; asking for more would make the page's own length
    // lie about whether it was cut (#257).
    const paged = [wrap("a", 500)];
    const held = [...paged, ...Array.from({ length: 450 }, (_, i) => wrap(`live${i}`, 400 - i))];
    expect(olderDmFilters(ME, paged, held)[0]?.limit).toBe(MAX_LIMIT);
  });

  test("a wrap that arrived live never moves the cursor, however far back it is dated", () => {
    // NIP-59 backdates it by up to two days: paging from it would skip every wrap in between.
    const paged = [wrap("a", 500)];
    expect(olderDmFilters(ME, paged, [...paged, wrap("live", 100)])[0]?.until).toBe(500);
  });
});

describe("isLastDmPage", () => {
  test("a page with fewer unseen wraps than a page's worth, and shorter than it asked, proves the history is exhausted", () => {
    const known = new Set(["a"]);
    const page = [wrap("a", 300), ...Array.from({ length: DM_PAGE_SIZE - 1 }, (_, i) => wrap(`n${i}`, 200))];
    expect(isLastDmPage(known, page, DM_PAGE_SIZE + 1)).toBe(true);
  });

  test("a full page of unseen wraps may have more behind it", () => {
    const page = Array.from({ length: DM_PAGE_SIZE }, (_, i) => wrap(`n${i}`, 200));
    expect(isLastDmPage(new Set(["a"]), [wrap("a", 300), ...page], DM_PAGE_SIZE + 1)).toBe(false);
  });

  test("a page cut at the ceiling may have more behind it, however few of its wraps are new", () => {
    // The relay clamps at MAX_LIMIT: 450 held below the cursor leave room for 50 new ones (#257).
    const held = Array.from({ length: 450 }, (_, i) => wrap(`h${i}`, 300));
    const page = [...held, ...Array.from({ length: 50 }, (_, i) => wrap(`n${i}`, 200))];
    expect(isLastDmPage(new Set(held.map((w) => w.id)), page, MAX_LIMIT)).toBe(false);
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
  const unasked: ShownState = { shown: DM_SHOWN_STEP, waitingPast: null, pagesAt: 0 };

  test("leaves out Messages older than where the history is complete, and offers to load them", () => {
    const messages = [rumor("old", 10), rumor("mid", 20), rumor("new", 30)];
    const view = dmHistoryView(messages, 20, unasked, true, 0);
    expect(view.messages).toEqual([rumor("mid", 20), rumor("new", 30)]);
    expect(view.hidden).toBe(0);
    expect(view.canLoadOlder).toBe(true);
  });

  test("mounts only the newest ones asked for, counting the complete ones kept back", () => {
    const messages = Array.from({ length: 5 }, (_, i) => rumor(`m${i}`, i));
    const view = dmHistoryView(messages, -Infinity, { ...unasked, shown: 2 }, false, 0);
    expect(view.messages).toEqual([rumor("m3", 3), rumor("m4", 4)]);
    expect(view.hidden).toBe(3);
    expect(view.complete).toBe(5);
    expect(view.canLoadOlder).toBe(true);
  });

  test("offers nothing older once all of it is on screen", () => {
    expect(dmHistoryView([rumor("only", 1)], -Infinity, unasked, false, 0).canLoadOlder).toBe(false);
  });

  test("keeps fetching while the reader waits on a page that brought nothing here", () => {
    const view = dmHistoryView([rumor("only", 1)], -Infinity, { ...unasked, shown: 100, waitingPast: 1 }, true, 0);
    expect(view.fetchOlder).toBe(true);
  });
});

describe("opening a conversation", () => {
  test("a conversation with nothing to show fetches on its own, without a click", () => {
    // Anything sent more than a day ago sits below where the history is complete, so the panel
    // opens blank next to a sidebar row that says there is something in it (#231).
    const state = openedConversation(0);
    expect(keepFetchingOlder(state, { complete: 0, hasMore: true, pages: 0 })).toBe(true);
  });

  test("it stops as soon as there is something to show", () => {
    expect(keepFetchingOlder(openedConversation(0), { complete: 1, hasMore: true, pages: 0 })).toBe(false);
  });

  test("it stops when the history runs out", () => {
    expect(keepFetchingOlder(openedConversation(0), { complete: 0, hasMore: false, pages: 0 })).toBe(false);
  });

  test("one quiet conversation does not page the whole inbox", () => {
    const state = openedConversation(4);
    const spent = { complete: 0, hasMore: true, pages: 4 + DM_OPENING_PAGES };
    expect(keepFetchingOlder(state, { ...spent, pages: spent.pages - 1 })).toBe(true);
    expect(keepFetchingOlder(state, spent)).toBe(false);
  });

  test("a page that brought nothing anywhere still counts, so the wait ends", () => {
    // A page that gave up on its deadline moves neither the history nor this conversation: the
    // feed's own page count is the only thing that says it is over (#232).
    const state = openedConversation(0);
    expect(keepFetchingOlder(state, { complete: 0, hasMore: true, pages: DM_OPENING_PAGES })).toBe(false);
  });

  test("asking by hand buys a fresh budget", () => {
    const state = openedConversation(0);
    const pages = DM_OPENING_PAGES;
    expect(keepFetchingOlder(state, { complete: 0, hasMore: true, pages })).toBe(false);
    const asked = askOlder(state, { hidden: 0, complete: 0, hasMore: true, pages });
    expect(keepFetchingOlder(asked, { complete: 0, hasMore: true, pages })).toBe(true);
  });
});

describe("asking for older Direct Messages", () => {
  /** A conversation with Messages on screen already: nothing is being waited on. */
  const held: ShownState = { shown: 50, waitingPast: null, pagesAt: 0 };

  test("shows another step of what is already held, without waiting on the relay", () => {
    const state = askOlder(held, { hidden: 10, complete: 60, hasMore: true, pages: 0 });
    expect(askOlder(state, { hidden: 0, complete: 60, hasMore: false, pages: 0 })).toEqual({ ...held, shown: 150 });
    expect(state).toEqual({ ...held, shown: 100 });
    expect(keepFetchingOlder(state, { complete: 60, hasMore: true, pages: 0 })).toBe(false);
  });

  test("with nothing held back, fetches until the conversation gains a Message", () => {
    const state = askOlder(held, { hidden: 0, complete: 7, hasMore: true, pages: 0 });
    expect(state).toEqual({ ...held, shown: 100, waitingPast: 7 });
    expect(keepFetchingOlder(state, { complete: 7, hasMore: true, pages: 0 })).toBe(true);
    expect(keepFetchingOlder(state, { complete: 8, hasMore: true, pages: 0 })).toBe(false);
  });

  test("stops fetching when the history runs out", () => {
    const state = askOlder(held, { hidden: 0, complete: 7, hasMore: true, pages: 0 });
    expect(keepFetchingOlder(state, { complete: 7, hasMore: false, pages: 0 })).toBe(false);
  });

  test("never fetches unasked", () => {
    expect(keepFetchingOlder(held, { complete: 0, hasMore: true, pages: 0 })).toBe(false);
  });
});

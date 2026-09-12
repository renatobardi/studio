import { describe, expect, test } from "bun:test";
import type { VerifiedEvent } from "nostr-tools";
import {
  PAGE_SIZE,
  channelCompanionFilters,
  isEndOfHistory,
  liveMessageFilters,
  oldestCreatedAt,
  olderMessagesFilters,
  rootCompanionFilters,
} from "./channelPagination";

function message(id: string, createdAt: number): VerifiedEvent {
  return { id, kind: 9, created_at: createdAt, pubkey: "author", tags: [], content: "", sig: "" } as VerifiedEvent;
}

describe("liveMessageFilters", () => {
  test("asks for Messages alone, so Reactions can never crowd them out of the page", () => {
    expect(liveMessageFilters("chan")).toEqual([{ kinds: [9], "#h": ["chan"], limit: PAGE_SIZE }]);
  });
});

describe("rootCompanionFilters", () => {
  test("asks for a page of roots' Replies and Reactions by id, not by time", () => {
    // `created_at` is author-supplied, so a time window around the roots could miss a
    // backdated Reaction; their ids cannot be wrong.
    expect(rootCompanionFilters(["a", "b"])).toEqual([
      { kinds: [1111], "#E": ["a", "b"] },
      { kinds: [7], "#e": ["a", "b"] },
    ]);
  });
});

describe("channelCompanionFilters", () => {
  test("covers what is published next, and the deletions no root can be asked for", () => {
    expect(channelCompanionFilters("chan")).toEqual([
      { kinds: [1111, 7], "#h": ["chan"], limit: PAGE_SIZE },
      { kinds: [5], "#h": ["chan"] },
    ]);
  });
});

describe("oldestCreatedAt", () => {
  test("is the cursor the loaded history reaches back to", () => {
    expect(oldestCreatedAt([message("a", 200), message("b", 100)])).toBe(100);
  });

  test("is nothing at all while no Message is loaded", () => {
    expect(oldestCreatedAt([])).toBeNull();
  });
});

describe("olderMessagesFilters", () => {
  test("has nothing to page from before the first Message arrives", () => {
    expect(olderMessagesFilters("chan", [])).toEqual([]);
  });

  test("pages from the oldest known Message, inclusively", () => {
    expect(olderMessagesFilters("chan", [message("a", 200), message("b", 100)])).toEqual([
      { kinds: [9], "#h": ["chan"], until: 100, limit: PAGE_SIZE + 1 },
    ]);
  });

  test("widens the page by the Messages already known at the cursor second", () => {
    // `until` is inclusive and NIP-01 has no id cursor: the relay replays the same
    // second's Messages every time, so the page must be big enough to get past them
    // (#41 — more than PAGE_SIZE events in one second must not stall the history).
    const tied = [message("a", 100), message("b", 100), message("c", 100), message("d", 300)];
    expect(olderMessagesFilters("chan", tied)).toEqual([
      { kinds: [9], "#h": ["chan"], until: 100, limit: PAGE_SIZE + 3 },
    ]);
  });
});

describe("isEndOfHistory", () => {
  test("a page of nothing but Messages already known is the end", () => {
    const known = new Set(["a", "b"]);
    expect(isEndOfHistory(known, [message("a", 100), message("b", 100)])).toBe(true);
  });

  test("an empty page is the end", () => {
    expect(isEndOfHistory(new Set(["a"]), [])).toBe(true);
  });

  test("one unseen Message means there is more to fetch", () => {
    expect(isEndOfHistory(new Set(["a"]), [message("a", 100), message("older", 50)])).toBe(false);
  });
});

/** The relay's historical query, as `build_query` in api/src/studio_api/nostr/store.py runs it:
 * newest first, ties broken by event id, `until` inclusive, then LIMIT. */
function relayQuery(all: VerifiedEvent[], filter: { until?: number; limit?: number }): VerifiedEvent[] {
  const matching = all
    .filter((event) => filter.until === undefined || event.created_at <= filter.until)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  return matching.slice(0, filter.limit);
}

function paginateAll(all: VerifiedEvent[]): { collected: VerifiedEvent[]; pages: number } {
  const known = new Map<string, VerifiedEvent>();
  for (const event of relayQuery(all, { limit: PAGE_SIZE })) known.set(event.id, event);

  let pages = 1;
  for (;;) {
    const [filter] = olderMessagesFilters("chan", [...known.values()]);
    if (filter === undefined) break;
    const page = relayQuery(all, filter as { until?: number; limit?: number });
    pages += 1;
    const knownIds = new Set(known.keys());
    for (const event of page) known.set(event.id, event);
    if (isEndOfHistory(knownIds, page)) break;
    if (pages > 100) throw new Error("pagination never reached the end of the history");
  }
  return { collected: [...known.values()], pages };
}

describe("paging a whole history", () => {
  test("an empty Channel stops at the first page", () => {
    expect(paginateAll([])).toEqual({ collected: [], pages: 1 });
  });

  test("a single Message stops at the page that repeats it", () => {
    const { collected, pages } = paginateAll([message("only", 100)]);
    expect(collected.map((m) => m.id)).toEqual(["only"]);
    expect(pages).toBe(2);
  });

  test("reaches every Message across several pages, without repeating forever", () => {
    const all = Array.from({ length: 130 }, (_, i) => message(`m${String(i).padStart(3, "0")}`, 1000 + i));
    const { collected } = paginateAll(all);
    expect(collected).toHaveLength(130);
  });

  test("gets past a second holding far more than one page of Messages", () => {
    // 60 Messages share one second — the inclusive `until` cursor cannot move off it, so only
    // the widened page limit makes progress possible (#41).
    const tied = Array.from({ length: 60 }, (_, i) => message(`t${String(i).padStart(3, "0")}`, 1000));
    const older = Array.from({ length: 20 }, (_, i) => message(`o${String(i).padStart(3, "0")}`, 900 + i));
    const { collected } = paginateAll([...tied, ...older]);
    expect(collected).toHaveLength(80);
  });

  test("a page replayed by a reconnect adds nothing and still ends", () => {
    const all = Array.from({ length: 70 }, (_, i) => message(`m${String(i).padStart(3, "0")}`, 1000 + i));
    const { collected } = paginateAll([...all, ...all]);
    expect(collected).toHaveLength(70);
  });
});

import { describe, expect, test } from "bun:test";
import type { VerifiedEvent } from "nostr-tools";
import { DmFeed } from "./dmFeed";
import { DM_PAGE_SIZE, OPEN_WINDOW_SECONDS, WRAP_BACKDATE_SECONDS } from "./dmPagination";
import type { Rumor } from "./nip17";
import { FakeRelay } from "./testing/fakeRelay";

const ME = "me";
const NOW = 100_000_000;
const DAY = 24 * 60 * 60;

/** A gift wrap whose rumor rides in the clear — the test's `unwrap` just reads it back. */
function wrap(id: string, wrapAt: number, sentAt = wrapAt): VerifiedEvent {
  const rumor: Rumor = { id: `r-${id}`, pubkey: "peer", created_at: sentAt, kind: 14, tags: [], content: id };
  return { id, kind: 1059, created_at: wrapAt, pubkey: "one-time", tags: [["p", ME]], content: JSON.stringify(rumor), sig: "" } as VerifiedEvent;
}

const unwrap = async (event: { content: string }): Promise<Rumor> => {
  const rumor = JSON.parse(event.content) as Rumor;
  if (rumor.content.startsWith("foreign")) throw new Error("not for me");
  return rumor;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `count` wraps, one per `step` seconds going back from `newest`. */
function history(count: number, newest: number, step: number, prefix = "w"): VerifiedEvent[] {
  return Array.from({ length: count }, (_, i) => wrap(`${prefix}${String(i).padStart(4, "0")}`, newest - i * step));
}

function start(stored: VerifiedEvent[]) {
  const relay = new FakeRelay(stored);
  const feed = new DmFeed(relay, ME, unwrap, () => NOW);
  const stop = feed.start();
  return { relay, feed, stop };
}

describe("DmFeed", () => {
  test("asks for a window of the newest gift wraps, not the whole history", () => {
    const { relay } = start([]);
    expect(relay.allFilters[0]).toEqual({ kinds: [1059], "#p": [ME], limit: DM_PAGE_SIZE });
  });

  test("a history shorter than a page is complete and has nothing older", async () => {
    const { feed } = start([wrap("a", NOW - 10 * DAY), wrap("b", NOW - DAY)]);
    await flush();
    const snapshot = feed.getSnapshot();
    expect(snapshot.rumors.map((r) => r.content).sort()).toEqual(["a", "b"]);
    expect(snapshot.hasMore).toBe(false);
    expect(snapshot.completeFrom).toBe(-Infinity);
  });

  test("opening pages in until the last day is complete, and no further", async () => {
    // One wrap a minute: a page covers 100 minutes, and the last day needs WRAP_BACKDATE + 1 day.
    const { relay, feed } = start(history(5000, NOW, 60));
    await flush();
    const snapshot = feed.getSnapshot();
    expect(snapshot.hasMore).toBe(true);
    expect(snapshot.completeFrom).toBeLessThanOrEqual(NOW - OPEN_WINDOW_SECONDS);
    expect(snapshot.completeFrom).toBeGreaterThan(NOW - OPEN_WINDOW_SECONDS - DM_PAGE_SIZE * 60 * 2);
    const pages = relay.allFilters.filter((filter) => filter.until !== undefined);
    expect(pages.length).toBeGreaterThan(0);
    expect(snapshot.rumors.length).toBe((pages.length + 1) * DM_PAGE_SIZE);
  });

  test("a sparse history is complete for the last day after the first page", async () => {
    const { relay, feed } = start(history(300, NOW, DAY));
    await flush();
    expect(relay.allFilters.filter((filter) => filter.until !== undefined)).toEqual([]);
    expect(feed.getSnapshot().completeFrom).toBe(NOW - 99 * DAY + WRAP_BACKDATE_SECONDS);
  });

  test("loading older pages below the oldest wrap held, until the history runs out", async () => {
    const { relay, feed } = start(history(150, NOW, DAY));
    await flush();
    feed.loadOlder();
    await flush();
    expect(relay.allFilters.at(-1)).toEqual({ kinds: [1059], "#p": [ME], until: NOW - 99 * DAY, limit: DM_PAGE_SIZE + 1 });
    expect(feed.getSnapshot().rumors).toHaveLength(150);
    expect(feed.getSnapshot().hasMore).toBe(false);
    expect(feed.getSnapshot().completeFrom).toBe(-Infinity);
  });

  test("a wrap that does not unwrap still counts as paged past", async () => {
    const foreign = wrap("x", NOW - 5 * DAY);
    foreign.content = JSON.stringify({ id: "r-x", pubkey: "p", created_at: 0, kind: 14, tags: [], content: "foreign" });
    const { feed } = start([...history(DM_PAGE_SIZE - 1, NOW, 60), foreign]);
    await flush();
    expect(feed.getSnapshot().rumors).toHaveLength(DM_PAGE_SIZE - 1);
    expect(feed.getSnapshot().completeFrom).toBe(NOW - 5 * DAY + WRAP_BACKDATE_SECONDS);
  });

  test("a gift wrap published later arrives whatever its backdated created_at", async () => {
    const { relay, feed } = start(history(300, NOW, DAY));
    await flush();
    relay.publish(wrap("live", NOW - 2 * DAY, NOW));
    await flush();
    expect(feed.getSnapshot().rumors.map((r) => r.content)).toContain("live");
  });

  test("stopping closes every subscription", async () => {
    const { relay, stop } = start(history(300, NOW, DAY));
    await flush();
    stop();
    expect(relay.openFilters).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
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

  test("the same Message wrapped twice is one Message", async () => {
    const twice = wrap("b", NOW - DAY);
    twice.content = wrap("a", NOW - DAY).content;
    const { feed } = start([wrap("a", NOW - 2 * DAY), twice]);
    await flush();
    expect(feed.getSnapshot().rumors).toHaveLength(1);
  });

  test("tells a listener when a Message arrives, until it unsubscribes", async () => {
    const { relay, feed } = start([]);
    let calls = 0;
    const unsubscribe = feed.subscribe(() => (calls += 1));
    relay.publish(wrap("live", NOW));
    await flush();
    expect(calls).toBeGreaterThan(0);
    const heard = calls;
    unsubscribe();
    relay.publish(wrap("later", NOW));
    await flush();
    expect(calls).toBe(heard);
  });

  test("stopping closes every subscription", async () => {
    const { relay, stop } = start(history(300, NOW, DAY));
    await flush();
    stop();
    expect(relay.openFilters).toEqual([]);
  });

  test("a live wrap dated below the first page moves neither the cursor nor where the history is complete", async () => {
    const { relay, feed } = start(history(300, NOW, DAY));
    await flush();
    const before = feed.getSnapshot().completeFrom;
    relay.publish(wrap("live", NOW - 200 * DAY, NOW));
    await flush();
    expect(feed.getSnapshot().completeFrom).toBe(before);
    feed.loadOlder();
    expect(relay.allFilters.at(-1)?.until).toBe(NOW - 99 * DAY);
  });
});

/** A relay that answers only when the test says so — the real one is a socket away. */
class ManualRelay {
  readonly subscriptions: {
    filters: Filter[];
    handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void };
    open: boolean;
  }[] = [];

  subscribe(filters: Filter[], handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void }) {
    const entry = { filters, handlers, open: true };
    this.subscriptions.push(entry);
    const unsubscribe = () => {
      entry.open = false;
    };
    return Object.assign(unsubscribe, { update: () => {} });
  }

  answer(index: number, events: VerifiedEvent[]): void {
    const { handlers } = this.subscriptions[index]!;
    for (const event of events) handlers.onEvent(event);
    handlers.onEose?.();
  }
}

describe("DmFeed against a relay that answers later", () => {
  /** An unwrap that resolves only when released, as a remote signer's would. */
  function heldUnwrap() {
    const releases: (() => void)[] = [];
    const unwrapLater = (event: VerifiedEvent) =>
      new Promise<Rumor>((resolve) => releases.push(() => resolve(JSON.parse(event.content) as Rumor)));
    return { unwrapLater, release: () => releases.splice(0).forEach((release) => release()) };
  }

  function opened() {
    const relay = new ManualRelay();
    const { unwrapLater, release } = heldUnwrap();
    const feed = new DmFeed(relay, ME, unwrapLater, () => NOW);
    const stop = feed.start();
    // A full first page, a year back: the history is complete for the last day already.
    relay.answer(0, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    return { relay, feed, stop, release };
  }

  test("a page stays in flight until its wraps are unwrapped, so asking again waits for it", async () => {
    const { relay, feed, release } = opened();
    release();
    await flush();
    feed.loadOlder();
    relay.answer(1, history(DM_PAGE_SIZE, NOW - 400 * DAY, 60, "o"));
    feed.loadOlder();
    expect(relay.subscriptions).toHaveLength(2);
    expect(relay.subscriptions[1]!.open).toBe(false);
    release();
    await flush();
    expect(feed.getSnapshot().rumors).toHaveLength(2 * DM_PAGE_SIZE);
    feed.loadOlder();
    expect(relay.subscriptions).toHaveLength(3);
  });

  test("a page replayed after a reconnect does not count its wraps twice", async () => {
    const { relay, feed, release } = opened();
    release();
    await flush();
    feed.loadOlder();
    const replayedPage = history(DM_PAGE_SIZE / 2, NOW - 400 * DAY, 60, "o");
    const { handlers } = relay.subscriptions[1]!;
    for (const event of [...replayedPage, ...replayedPage]) handlers.onEvent(event);
    handlers.onEose?.();
    release();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(false);
  });

  test("a page that finishes unwrapping after a stop decides nothing for the next start", async () => {
    const { relay, feed, stop, release } = opened();
    release();
    await flush();
    feed.loadOlder();
    // A short page would end the history — but it belongs to a run that is over.
    relay.answer(1, history(DM_PAGE_SIZE / 2, NOW - 400 * DAY, 60, "o"));
    stop();
    feed.start();
    release();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(true);
  });

  test("a first page answered again after a reconnect is not a second first page", async () => {
    const { relay, feed, release } = opened();
    relay.answer(0, []);
    release();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(true);
  });
});

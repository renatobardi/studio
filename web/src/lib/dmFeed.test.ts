import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
import { DmFeed } from "./dmFeed";
import { PAGE_DEADLINE_MS } from "./channelPagination";
import { DM_PAGE_SIZE, OPEN_WINDOW_SECONDS, WRAP_BACKDATE_SECONDS } from "./dmPagination";
import type { Rumor } from "./nip17";
import { FakeRelay } from "./testing/fakeRelay";
import { verifiedEvent } from "./testing/events";

const ME = "me";
const NOW = 100_000_000;
const DAY = 24 * 60 * 60;

/** A gift wrap whose rumor rides in the clear — the test's `unwrap` just reads it back. */
function wrap(id: string, wrapAt: number, sentAt = wrapAt): VerifiedEvent {
  const rumor: Rumor = { id: `r-${id}`, pubkey: "peer", created_at: sentAt, kind: 14, tags: [], content: id };
  return verifiedEvent({ id, kind: 1059, created_at: wrapAt, pubkey: "one-time", tags: [["p", ME]], content: JSON.stringify(rumor), sig: "" });
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

  test("hands out the same snapshot until something changes, with its own loadOlder (#194)", async () => {
    // What the shell renders from: a new object on every render would redo every conversation.
    const { relay, feed } = start(history(150, NOW, DAY));
    await flush();
    const first = feed.getSnapshot();
    expect(feed.getSnapshot()).toBe(first);
    first.loadOlder();
    await flush();
    expect(relay.allFilters.at(-1)?.until).toBe(NOW - 99 * DAY);
    expect(feed.getSnapshot()).not.toBe(first);
  });

  test("stopping closes every subscription", async () => {
    const { relay, stop } = start(history(300, NOW, DAY));
    await flush();
    stop();
    expect(relay.openFilters).toEqual([]);
  });

  test("starting again over the wraps already held still reads a full first page", async () => {
    // React's StrictMode mounts the effect, tears it down and mounts it again (main.tsx): the
    // second REQ replays the same page, and its size is what says there is history behind it.
    const { relay, feed, stop } = start(history(DM_PAGE_SIZE, NOW - 10 * DAY, 60));
    await flush();
    const before = feed.getSnapshot();
    expect(before.hasMore).toBe(true);
    stop();
    const stopAgain = feed.start();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(true);
    // The replay is the page already held: it moves neither the cursor nor where the history
    // is complete.
    expect(feed.getSnapshot().completeFrom).toBe(before.completeFrom);
    feed.loadOlder();
    expect(relay.allFilters.at(-1)?.until).toBe(NOW - 10 * DAY - (DM_PAGE_SIZE - 1) * 60);
    stopAgain();
  });

  test("a history already paged to its end is not reopened by starting again", async () => {
    const { feed, stop } = start(history(DM_PAGE_SIZE + 50, NOW - 10 * DAY, 60));
    await flush();
    feed.loadOlder();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(false);
    stop();
    const stopAgain = feed.start();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(false);
    expect(feed.getSnapshot().completeFrom).toBe(-Infinity);
    stopAgain();
  });

  test("a page replaying wraps already held below the cursor does not end the history", async () => {
    // NIP-59 backdates a live wrap, so it lands below the cursor and the next page replays it.
    // Discounted from what came back but never asked for, three of them made a full page look
    // short — and the rest of the history unreachable until a reload (#230). The backdate here
    // is far past WRAP_BACKDATE_SECONDS on purpose: it puts a held wrap below the cursor without
    // a dense history whose opening backfill would page on its own.
    const { relay, feed } = start(history(300, NOW, DAY));
    await flush();
    ["L1", "L2", "L3"].forEach((id, i) => relay.publish(wrap(id, NOW - 150 * DAY - i, NOW)));
    await flush();
    expect(feed.getSnapshot().rumors).toHaveLength(DM_PAGE_SIZE + 3);
    feed.loadOlder();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(true);
    // The page really came: a no-op would leave hasMore true too.
    expect(feed.getSnapshot().rumors).toHaveLength(2 * DM_PAGE_SIZE + 3);
  });

  test("wraps held below the cursor do not stop a genuine last page from ending the history", async () => {
    const { relay, feed } = start(history(DM_PAGE_SIZE + 20, NOW, DAY));
    await flush();
    ["L1", "L2"].forEach((id, i) => relay.publish(wrap(id, NOW - 150 * DAY - i, NOW)));
    await flush();
    feed.loadOlder();
    await flush();
    expect(feed.getSnapshot().hasMore).toBe(false);
  });

  test("more than a page of wraps arriving while the socket was down all come back", async () => {
    // A reconnect re-issues the REQ. Without a `since`, the relay answers the newest page of it
    // and everything older falls into a hole the cursor never revisits (#226).
    const { relay, feed } = start(history(DM_PAGE_SIZE, NOW - 400 * DAY, 60));
    await flush();
    relay.disconnect();
    for (const wrap_ of history(250, NOW, 60, "n")) relay.publish(wrap_);
    relay.reconnect();
    await flush();
    expect(feed.getSnapshot().rumors).toHaveLength(DM_PAGE_SIZE + 250);
    // Asking since the newest held says nothing about how much history is behind it.
    expect(feed.getSnapshot().hasMore).toBe(true);
  });

  test("a drop before the first page landed asks for a first page again, not a window", () => {
    // The opening REQ is what says whether there is history behind the newest page, by its size.
    // Answering a `since` window into that count would call a long history exhausted.
    const relay = new ManualRelay();
    const feed = new DmFeed(relay, ME, unwrap, () => NOW);
    feed.start();
    const { handlers, filters } = relay.subscriptions[0]!;
    // Some of the first page arrived, and then the socket went: enough to have a newest wrap.
    for (const wrap_ of history(10, NOW, 60)) handlers.onEvent(wrap_);

    expect(handlers.onResubscribe?.() ?? filters).toEqual([{ kinds: [1059], "#p": [ME], limit: DM_PAGE_SIZE }]);
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

/** Timers the test moves by hand: a deadline is a rule, not a wait. */
class FakeTimers {
  private pending: { at: number; fn: () => void }[] = [];

  schedule = (fn: () => void, ms: number): (() => void) => {
    const entry = { at: ms, fn };
    this.pending.push(entry);
    return () => {
      this.pending = this.pending.filter((candidate) => candidate !== entry);
    };
  };

  get scheduled(): number {
    return this.pending.length;
  }

  /** Runs whatever was scheduled for `ms` or sooner, and forgets it. */
  fire(ms: number): void {
    const due = this.pending.filter((entry) => entry.at <= ms);
    this.pending = this.pending.filter((entry) => entry.at > ms);
    for (const entry of due) entry.fn();
  }
}

/** A relay that answers only when the test says so — the real one is a socket away. */
class ManualRelay {
  readonly subscriptions: {
    filters: Filter[];
    handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void; onResubscribe?(): Filter[] };
    open: boolean;
  }[] = [];

  subscribe(
    filters: Filter[],
    handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void; onResubscribe?(): Filter[] },
  ) {
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

  test("a page that never answers frees the paging once its deadline passes", async () => {
    // The relay dropped and came back without re-emitting this subscription's EOSE. Without a
    // deadline `loadOlder` was a no-op for the rest of the session (#232).
    const timers = new FakeTimers();
    const relay = new ManualRelay();
    const feed = new DmFeed(relay, ME, unwrap, () => NOW, timers.schedule);
    feed.start();
    relay.answer(0, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    await flush();
    let emitted = 0;
    feed.subscribe(() => {
      emitted += 1;
    });
    feed.loadOlder();
    expect(relay.subscriptions).toHaveLength(2);
    timers.fire(PAGE_DEADLINE_MS);
    await flush();
    expect(emitted).toBeGreaterThan(0);
    // An overrun says nothing about how much history is left.
    expect(feed.getSnapshot().hasMore).toBe(true);
    feed.loadOlder();
    expect(relay.subscriptions).toHaveLength(3);
    expect(relay.subscriptions[1]!.open).toBe(false);
  });

  test("a page whose unwrapping never settles frees the paging once its deadline passes", async () => {
    // Under NIP-07 custody an extension that simply does not answer leaves the unwrap pending
    // forever — it never rejects, so `apply`'s swallow never runs. The deadline had already
    // been cancelled by the EOSE, so `loadingOlder` and `pages` froze for the session, and
    // both "Load older" and a conversation waiting on pages waited forever (#268).
    const timers = new FakeTimers();
    const relay = new ManualRelay();
    const { unwrapLater, release } = heldUnwrap();
    const feed = new DmFeed(relay, ME, unwrapLater, () => NOW, timers.schedule);
    feed.start();
    relay.answer(0, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    release();
    await flush();

    feed.loadOlder();
    relay.answer(1, history(DM_PAGE_SIZE, NOW - 400 * DAY, 60, "o")); // EOSE, unwrapping held
    await flush();
    expect(timers.scheduled).toBe(1);

    timers.fire(PAGE_DEADLINE_MS);
    await flush();

    expect(feed.getSnapshot().pages).toBe(1);
    // An overrun says nothing about how much history is left.
    expect(feed.getSnapshot().hasMore).toBe(true);
    feed.loadOlder();
    expect(relay.subscriptions).toHaveLength(3);
  });

  test("a relay that answers inside subscribe() leaves no deadline behind either", async () => {
    // That branch used to return before scheduling anything. Its unwrapping is still owed a
    // deadline (#268), so the page now takes one — and has to give it back when it settles.
    const timers = new FakeTimers();
    const relay = new FakeRelay([
      ...history(DM_PAGE_SIZE, NOW - 365 * DAY, 60),
      ...history(DM_PAGE_SIZE, NOW - 400 * DAY, 60, "o"),
    ]);
    const feed = new DmFeed(relay, ME, unwrap, () => NOW, timers.schedule);
    feed.start();
    await flush();

    feed.loadOlder();
    await flush();

    expect(timers.scheduled).toBe(0);
  });

  test("a page that settles after a stop leaves the next page's deadline alone", async () => {
    // The page settles a microtask after its EOSE, and by then a stop/start may have put
    // another page in flight. `cancelDeadline` is the feed's, not the page's: taking it here
    // would leave the new page with nothing to free it — the very freeze this deadline cures.
    const timers = new FakeTimers();
    const relay = new ManualRelay();
    const { unwrapLater, release } = heldUnwrap();
    const feed = new DmFeed(relay, ME, unwrapLater, () => NOW, timers.schedule);
    const stop = feed.start();
    relay.answer(0, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    release();
    await flush();

    feed.loadOlder();
    relay.answer(1, history(DM_PAGE_SIZE, NOW - 400 * DAY, 60, "o")); // EOSE, unwrapping held
    stop();
    feed.start();
    relay.answer(2, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    await flush();
    feed.loadOlder();
    expect(timers.scheduled).toBe(1);

    release(); // the abandoned page's wraps open at last
    await flush();

    expect(timers.scheduled).toBe(1);
  });

  test("stopping takes the deadline with it", async () => {
    const timers = new FakeTimers();
    const relay = new ManualRelay();
    const feed = new DmFeed(relay, ME, unwrap, () => NOW, timers.schedule);
    const stop = feed.start();
    relay.answer(0, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    await flush();
    feed.loadOlder();
    expect(timers.scheduled).toBe(1);
    stop();
    expect(timers.scheduled).toBe(0);
  });

  test("a page that answers in time leaves no deadline behind", async () => {
    const timers = new FakeTimers();
    const relay = new ManualRelay();
    const feed = new DmFeed(relay, ME, unwrap, () => NOW, timers.schedule);
    feed.start();
    relay.answer(0, history(DM_PAGE_SIZE, NOW - 365 * DAY, 60));
    await flush();
    feed.loadOlder();
    relay.answer(1, history(DM_PAGE_SIZE, NOW - 400 * DAY, 60, "o"));
    await flush();
    expect(timers.scheduled).toBe(0);
  });

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

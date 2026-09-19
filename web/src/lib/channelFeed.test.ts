import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
import { ChannelFeed } from "./channelFeed";
import { PAGE_DEADLINE_MS, PAGE_SIZE } from "./channelPagination";
import { FakeRelay, MAX_LIMIT } from "./testing/fakeRelay";

const CHANNEL = "chan";

function event(id: string, kind: number, createdAt: number, tags: string[][]): VerifiedEvent {
  return { id, kind, created_at: createdAt, pubkey: "author", tags, content: "", sig: "" } as VerifiedEvent;
}

function message(id: string, createdAt: number): VerifiedEvent {
  return event(id, 9, createdAt, [["h", CHANNEL]]);
}

function reaction(id: string, rootId: string, createdAt: number): VerifiedEvent {
  return event(id, 7, createdAt, [["h", CHANNEL], ["e", rootId]]);
}

function reply(id: string, rootId: string, createdAt: number): VerifiedEvent {
  return event(id, 1111, createdAt, [["h", CHANNEL], ["E", rootId]]);
}

function messages(count: number, from = 1000): VerifiedEvent[] {
  return Array.from({ length: count }, (_, i) => message(`m${String(i).padStart(3, "0")}`, from + i));
}

describe("ChannelFeed", () => {
  test("an empty Channel has no Messages and no history to offer", () => {
    const relay = new FakeRelay([]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    expect(feed.getSnapshot().messages).toEqual([]);
    expect(feed.getSnapshot().hasMore).toBe(false);
  });

  test("a Channel shorter than a page has nothing older to load", () => {
    const relay = new FakeRelay([message("only", 1000)]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    expect(feed.getSnapshot().messages.map((m) => m.id)).toEqual(["only"]);
    expect(feed.getSnapshot().hasMore).toBe(false);
  });

  test("Reactions never take a Message's place in the first page", () => {
    const spam = Array.from({ length: 200 }, (_, i) => reaction(`r${i}`, "m000", 2000 + i));
    const relay = new FakeRelay([...messages(3), ...spam]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    expect(feed.getSnapshot().messages).toHaveLength(3);
  });

  test("loads the whole history page by page, then stops asking", () => {
    const relay = new FakeRelay(messages(130));
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    expect(feed.getSnapshot().messages).toHaveLength(PAGE_SIZE);

    while (feed.getSnapshot().hasMore) feed.loadOlder();
    expect(feed.getSnapshot().messages).toHaveLength(130);

    const asked = relay.requests.length;
    feed.loadOlder();
    expect(relay.requests).toHaveLength(asked);
  });

  test("gets past a second holding far more than one page of Messages", () => {
    const tied = Array.from({ length: 60 }, (_, i) => message(`t${String(i).padStart(3, "0")}`, 1000));
    const relay = new FakeRelay([...tied, ...messages(20, 900)]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    while (feed.getSnapshot().hasMore) feed.loadOlder();
    expect(feed.getSnapshot().messages).toHaveLength(80);
  });

  test("a page still in flight swallows a second request", () => {
    const relay = new FakeRelay(messages(130));
    let inFlight: (() => void) | null = null;
    const stalling = {
      subscribe(filters: Filter[], handlers: { onEvent(e: VerifiedEvent): void; onEose?(): void }) {
        if (filters[0]?.until === undefined) return relay.subscribe(filters, handlers);
        inFlight = () => relay.subscribe(filters, handlers);
        return Object.assign(() => {}, { update: () => {} });
      },
    };
    const feed = new ChannelFeed(stalling, CHANNEL);
    feed.start();
    feed.loadOlder();
    const first = inFlight;
    feed.loadOlder();
    expect(inFlight).toBe(first);
  });

  test("a page that never answers frees the paging once its deadline passes", () => {
    // Same hole as the Direct Message feed had (#232): a relay that drops and comes back does
    // not re-emit the EOSE of a subscription it already answered.
    const relay = new FakeRelay(messages(PAGE_SIZE * 3));
    let asks = 0;
    let closed = false;
    const stalling = {
      subscribe(filters: Filter[], handlers: { onEvent(e: VerifiedEvent): void; onEose?(): void }) {
        if (filters[0]?.until === undefined) return relay.subscribe(filters, handlers);
        asks += 1;
        return Object.assign(() => (closed = true), { update: () => {} });
      },
    };
    const deadlines: { fn: () => void; ms: number }[] = [];
    const feed = new ChannelFeed(stalling, CHANNEL, (fn, ms) => {
      const entry = { fn, ms };
      deadlines.push(entry);
      return () => deadlines.splice(deadlines.indexOf(entry), 1);
    });
    feed.start();
    feed.loadOlder();
    expect(asks).toBe(1);
    expect(deadlines.map((entry) => entry.ms)).toEqual([PAGE_DEADLINE_MS]);
    deadlines[0]!.fn();
    expect(closed).toBe(true);
    // The overrun proves nothing about the history: asking again is allowed, and still asks.
    expect(feed.getSnapshot().hasMore).toBe(true);
    feed.loadOlder();
    expect(asks).toBe(2);
  });

  test("a reconnect that replays the page changes nothing", () => {
    const relay = new FakeRelay(messages(10));
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    for (const stored of messages(10)) relay.publish(stored);
    expect(feed.getSnapshot().messages).toHaveLength(10);
  });

  test("Thread Replies stay out of the timeline and are counted for their root", () => {
    const relay = new FakeRelay([message("root", 1000), reply("r1", "root", 1100)]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    expect(feed.getSnapshot().messages.map((m) => m.id)).toEqual(["root"]);
    expect(feed.getSnapshot().replies.map((r) => r.id)).toEqual(["r1"]);
  });

  test("asks for the Replies and Reactions of the roots it loaded, whatever their created_at", () => {
    // created_at is author-supplied and the relay accepts it up to 30 days back
    // (PAST_TOLERANCE_SECONDS), so a time window around the roots would silently lose a
    // backdated Reaction — the roots' own ids are the only sound anchor (#41).
    const relay = new FakeRelay([message("root", 1000), reaction("backdated", "root", 1)]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    expect(feed.getSnapshot().reactions.map((r) => r.id)).toEqual(["backdated"]);
  });

  test("leaves no root-companions subscription open, however deep the scrollback", () => {
    const relay = new FakeRelay(messages(150));
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    while (feed.getSnapshot().hasMore) feed.loadOlder();

    expect(relay.allFilters.filter((f) => "#E" in f)).toHaveLength(150 / PAGE_SIZE);
    expect(relay.openFilters.filter((f) => "#E" in f)).toEqual([]);
  });

  test("closes a root-companions fetch still in flight when disposed", () => {
    const relay = new FakeRelay(messages(3));
    let closed = false;
    const stalling = {
      subscribe(filters: Filter[], handlers: { onEvent(e: VerifiedEvent): void; onEose?(): void }) {
        if (!filters.some((f) => "#E" in f)) return relay.subscribe(filters, handlers);
        return Object.assign(() => (closed = true), { update: () => {} });
      },
    };
    const dispose = new ChannelFeed(stalling, CHANNEL).start();
    dispose();
    expect(closed).toBe(true);
  });

  test("a companion published after its page loaded still arrives", () => {
    const relay = new FakeRelay(messages(60));
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    feed.loadOlder();
    relay.publish(reaction("late", "m000", 9000));
    expect(feed.getSnapshot().reactions.map((r) => r.id)).toEqual(["late"]);
  });

  test("asks for a root's companions once, however often the subscription is replayed", () => {
    const relay = new FakeRelay(messages(3));
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    const rootFilters = () => relay.allFilters.filter((f) => "#E" in f).length;
    const asked = rootFilters();
    for (const stored of messages(3)) relay.publish(stored);
    expect(rootFilters()).toBe(asked);
  });

  test("an older page's companions get their own budget, however many the newer pages hold", () => {
    // Page 1's roots alone hold more Reactions than the relay's per-filter ceiling, all newer
    // than page 2's. Sharing one filter across both pages crowded page 2's out (#119).
    const crowd = Array.from({ length: MAX_LIMIT }, (_, i) => reaction(`c${i}`, "m059", 5000 + i));
    const relay = new FakeRelay([...messages(60), ...crowd, reaction("old", "m000", 1001)]);
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    feed.loadOlder();
    expect(feed.getSnapshot().reactions.map((r) => r.id)).toContain("old");
  });

  test("does not re-notify listeners for a companion already held", () => {
    // react1 targets m015, which page 1 already covered: loading page 2 must not bring it back.
    const relay = new FakeRelay([...messages(60), reaction("react1", "m015", 1016)]);
    const feed = new ChannelFeed(relay, CHANNEL);
    let notifications = 0;
    feed.subscribe(() => (notifications += 1));
    feed.start();
    expect(feed.getSnapshot().reactions.map((r) => r.id)).toEqual(["react1"]);

    notifications = 0;
    feed.loadOlder();

    // 10 new page-2 Messages plus loadOlder's own final emit — not one more for react1.
    expect(notifications).toBe(11);
    expect(feed.getSnapshot().reactions.map((r) => r.id)).toEqual(["react1"]);
  });

  test("notifies its listener as events arrive, and stops once disposed", () => {
    const relay = new FakeRelay([]);
    const feed = new ChannelFeed(relay, CHANNEL);
    let notifications = 0;
    feed.subscribe(() => (notifications += 1));
    const dispose = feed.start();
    relay.publish(message("live", 1000));
    expect(notifications).toBeGreaterThan(0);

    dispose();
    const afterDispose = notifications;
    relay.publish(message("later", 1100));
    expect(notifications).toBe(afterDispose);
  });
});

import { describe, expect, test } from "bun:test";
import type { Filter, VerifiedEvent } from "nostr-tools";
import { ChannelFeed } from "./channelFeed";
import { PAGE_SIZE } from "./channelPagination";

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

function matches(event: VerifiedEvent, filter: Filter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, wanted] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const name = key.slice(1);
    const values = wanted as string[];
    if (!event.tags.some((tag) => tag[0] === name && values.includes(tag[1]))) return false;
  }
  return true;
}

/** Stands in for the relay: the same newest-first, id-broken order and inclusive `until` that
 * `build_query` in api/src/studio_api/nostr/store.py runs (ADR-0004), and subscriptions that
 * stay open for whatever is published next. */
class FakeRelay {
  readonly requests: Filter[][] = [];
  private open: { filters: Filter[]; onEvent: (event: VerifiedEvent) => void }[] = [];

  constructor(private stored: VerifiedEvent[]) {}

  subscribe(filters: Filter[], handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void }) {
    this.requests.push(filters);
    const entry = { filters, onEvent: handlers.onEvent };
    this.open.push(entry);
    for (const filter of filters) {
      const page = this.stored
        .filter((event) => matches(event, filter))
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        .slice(0, filter.limit);
      for (const event of page) handlers.onEvent(event);
    }
    handlers.onEose?.();
    return () => {
      this.open = this.open.filter((candidate) => candidate !== entry);
    };
  }

  /** A live event reaching every open subscription that asked for it. */
  publish(event: VerifiedEvent): void {
    this.stored.push(event);
    for (const entry of this.open) {
      if (entry.filters.some((filter) => matches(event, filter))) entry.onEvent(event);
    }
  }

  /** What every open subscription asked for, as a flat list of filters. */
  get allFilters(): Filter[] {
    return this.requests.flat();
  }
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
        return () => {};
      },
    };
    const feed = new ChannelFeed(stalling, CHANNEL);
    feed.start();
    feed.loadOlder();
    const first = inFlight;
    feed.loadOlder();
    expect(inFlight).toBe(first);
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

  test("asks for a root's companions once, however often the subscription is replayed", () => {
    const relay = new FakeRelay(messages(3));
    const feed = new ChannelFeed(relay, CHANNEL);
    feed.start();
    const rootFilters = () => relay.allFilters.filter((f) => "#E" in f).length;
    const asked = rootFilters();
    for (const stored of messages(3)) relay.publish(stored);
    expect(rootFilters()).toBe(asked);
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

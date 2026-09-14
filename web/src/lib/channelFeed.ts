import type { Filter, VerifiedEvent } from "nostr-tools";
import {
  PAGE_SIZE,
  channelCompanionFilters,
  isEndOfHistory,
  liveMessageFilters,
  olderMessagesFilters,
  rootCompanionFilters,
} from "./channelPagination";
import type { SubscriptionHandle } from "./relay";

/** All `ChannelFeed` needs of a `RelayClient` — and all a test has to stand in for. */
export interface FeedClient {
  subscribe(
    filters: Filter[],
    handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void },
  ): SubscriptionHandle;
}

export interface FeedSnapshot {
  messages: VerifiedEvent[];
  replies: VerifiedEvent[];
  reactions: VerifiedEvent[];
  deletions: VerifiedEvent[];
  hasMore: boolean;
}

/**
 * A Channel's content stream, kept off React so the paging can be tested on its own (#41).
 *
 * Messages (kind 9) have a subscription to themselves — sharing one with Reactions let a
 * burst of them fill the page and leave the Channel looking empty. The Thread Replies (1111),
 * Reactions (7) and deletions (5) arrive on their own subscriptions: one Channel-wide for
 * whatever is published next, and one per page of loaded Messages, addressed by those
 * Messages' ids so no count depends on an author's `created_at`.
 */
export class ChannelFeed {
  private readonly messages = new Map<string, VerifiedEvent>();
  private readonly replies = new Map<string, VerifiedEvent>();
  private readonly reactions = new Map<string, VerifiedEvent>();
  private readonly deletions = new Map<string, VerifiedEvent>();
  private hasMore = false;
  private loadingOlder = false;
  private readonly coveredRoots = new Set<string>();
  private rootsHandle: SubscriptionHandle | null = null;
  private readonly disposers: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshot: FeedSnapshot | null = null;

  private readonly client: FeedClient;
  private readonly channelId: string;

  constructor(client: FeedClient, channelId: string) {
    this.client = client;
    this.channelId = channelId;
  }

  /** Opens the Channel's subscriptions; the returned function closes every one of them. */
  start(): () => void {
    const firstPage: VerifiedEvent[] = [];
    let eosed = false;
    this.disposers.push(
      this.client.subscribe(liveMessageFilters(this.channelId), {
        onEvent: (event) => {
          this.apply(event);
          // A Message arriving live can have no history behind it: anything targeting it is
          // published later and reaches the Channel-wide companion subscription.
          if (!eosed) firstPage.push(event);
        },
        onEose: () => {
          if (!eosed) this.hasMore = firstPage.length >= PAGE_SIZE;
          eosed = true;
          this.coverRoots(firstPage);
          this.emit();
        },
      }),
    );
    this.disposers.push(
      this.client.subscribe(channelCompanionFilters(this.channelId), {
        onEvent: (event) => this.apply(event),
      }),
    );
    // Only the relay subscriptions: the listeners belong to whoever is rendering the feed,
    // which under StrictMode outlives a start()/dispose() pair.
    return () => {
      for (const dispose of this.disposers.splice(0)) dispose();
      this.coveredRoots.clear();
      this.rootsHandle = null;
    };
  }

  /** Fetches the page before the oldest loaded Message. A no-op while one is in flight, or
   * once the history is known to be exhausted. */
  loadOlder(): void {
    if (this.loadingOlder || !this.hasMore) return;
    const filters = olderMessagesFilters(this.channelId, [...this.messages.values()]);
    if (filters.length === 0) return;

    const knownIds = new Set(this.messages.keys());
    const page: VerifiedEvent[] = [];
    this.loadingOlder = true;
    let unsubscribe: (() => void) | null = null;
    let finished = false;
    unsubscribe = this.client.subscribe(filters, {
      onEvent: (event) => {
        page.push(event);
        this.apply(event);
      },
      onEose: () => {
        if (isEndOfHistory(knownIds, page)) this.hasMore = false;
        this.coverRoots(page);
        this.loadingOlder = false;
        finished = true;
        unsubscribe?.();
        this.emit();
      },
    });
    if (finished) unsubscribe();
  }

  getSnapshot = (): FeedSnapshot => {
    this.snapshot ??= {
      messages: [...this.messages.values()],
      replies: [...this.replies.values()],
      reactions: [...this.reactions.values()],
      deletions: [...this.deletions.values()],
      hasMore: this.hasMore,
    };
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Skips the map write and the listener notification for an id already held — events are
   * immutable, and each widen of the roots subscription (#91) replays every companion matching
   * the new filter, not just the ones the new page added. */
  private apply(event: VerifiedEvent): void {
    let map: Map<string, VerifiedEvent>;
    if (event.kind === 9) map = this.messages;
    else if (event.kind === 1111) map = this.replies;
    else if (event.kind === 7) map = this.reactions;
    else if (event.kind === 5) map = this.deletions;
    else return;
    if (map.has(event.id)) return;
    map.set(event.id, event);
    this.emit();
  }

  /** One subscription for every root covered so far, widened as each page loads — scrollback N
   * pages deep must not cost N open subscriptions (#91). A replayed page (a reconnect re-issues
   * every open subscription) must not widen it again.
   *
   * The relay clamps every filter's `limit` at MAX_LIMIT=500 (api/src/studio_api/nostr/relay.py),
   * regardless of what is asked. Before this widened into one subscription, that ceiling applied
   * per page — now it is shared across every root covered so far, so a channel active enough to
   * push total companions past 500 will have the oldest of them silently dropped. Tracked as a
   * follow-up, not fixed here (#119). */
  private coverRoots(page: VerifiedEvent[]): void {
    const roots = page.map((event) => event.id).filter((id) => !this.coveredRoots.has(id));
    if (roots.length === 0) return;
    for (const id of roots) this.coveredRoots.add(id);
    const filters = rootCompanionFilters([...this.coveredRoots]);
    if (this.rootsHandle !== null) this.rootsHandle.update(filters);
    else {
      this.rootsHandle = this.client.subscribe(filters, { onEvent: (event) => this.apply(event) });
      this.disposers.push(this.rootsHandle);
    }
  }

  private emit(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }
}

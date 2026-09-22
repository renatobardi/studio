import type { Filter, VerifiedEvent } from "nostr-tools";
import {
  PAGE_DEADLINE_MS,
  PAGE_SIZE,
  channelCompanionFilters,
  channelGapFilters,
  isEndOfHistory,
  liveMessageFilters,
  newestCreatedAt,
  olderMessagesFilters,
  reconnectCompanionFilters,
  reconnectMessageFilters,
  rootCompanionFilters,
} from "./channelPagination";
import { type Timer, timer } from "./clock";
import { GapFiller, type GapState, combinedGapState } from "./feedGap";
import type { SubscriptionHandle } from "./relay";

/** All `ChannelFeed` needs of a `RelayClient` — and all a test has to stand in for. */
export interface FeedClient {
  subscribe(
    filters: Filter[],
    handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void; onResubscribe?(): Filter[] },
  ): SubscriptionHandle;
}

export interface FeedSnapshot {
  messages: VerifiedEvent[];
  replies: VerifiedEvent[];
  reactions: VerifiedEvent[];
  deletions: VerifiedEvent[];
  hasMore: boolean;
  /** Whether events a reconnect could not bring in one answer are still owed (#254, #255). */
  gap: GapState;
  /** Asks for them again after a page of them overran its deadline. */
  retryGap: () => void;
}

/**
 * A Channel's content stream, kept off React so the paging can be tested on its own (#41).
 *
 * Messages (kind 9) have a subscription to themselves — sharing one with Reactions let a
 * burst of them fill the page and leave the Channel looking empty. The Thread Replies (1111),
 * Reactions (7) and deletions (5) arrive on their own subscriptions: one Channel-wide for
 * whatever is published next, and a one-shot fetch per page of loaded Messages, addressed by
 * those Messages' ids so no count depends on an author's `created_at`.
 */
export class ChannelFeed {
  private readonly messages = new Map<string, VerifiedEvent>();
  private readonly replies = new Map<string, VerifiedEvent>();
  private readonly reactions = new Map<string, VerifiedEvent>();
  private readonly deletions = new Map<string, VerifiedEvent>();
  private hasMore = false;
  private loadingOlder = false;
  /** Cancels the in-flight page's deadline — nothing is owed once it has answered. */
  private cancelDeadline: (() => void) | null = null;
  /** Closes the page in flight — held on the feed, not in the closure, because the teardown has
   * to reach it: a page left open is re-issued by every reconnect, and the `loadingOlder` it
   * holds would outlive the start() that set it (#267). */
  private closeOlder: (() => void) | null = null;
  /**
   * The Messages a reconnect's answer was too long to bring (#254). Kept across a stop and start,
   * like the Messages they are missing from.
   *
   * What a reconnect's answer or a gap's page brings skips `coverRoots`. Everything in them is
   * stamped no earlier than the reconnect's `since`, and the companion subscription asks again from
   * the same `since` (#255): a Reply or Reaction is stamped after the Message it answers, so it is
   * in that window too — whether the Message was accepted during the outage or, when the first
   * page spanned less than the window, was history below the cursor. What that misses is one
   * stamped before its own Message, below the window, and accepted before this run began.
   */
  private readonly messageGap: GapFiller;
  /** The same for the companion subscription's two filters, each cut on its own (#255). */
  private readonly companionGap: GapFiller;
  private readonly deletionGap: GapFiller;
  private readonly coveredRoots = new Set<string>();
  private readonly pendingRootFetches = new Set<() => void>();
  private readonly disposers: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshot: FeedSnapshot | null = null;

  private readonly client: FeedClient;
  private readonly channelId: string;
  private readonly schedule: Timer;

  constructor(client: FeedClient, channelId: string, schedule: Timer = timer) {
    this.client = client;
    this.channelId = channelId;
    this.schedule = schedule;
    const filler = (kinds: number[]) =>
      new GapFiller({
        client,
        schedule,
        filtersFor: (gap) => channelGapFilters(channelId, kinds, gap),
        take: (event) => this.apply(event),
        changed: () => this.emit(),
      });
    this.messageGap = filler([9]);
    this.companionGap = filler([1111, 7]);
    this.deletionGap = filler([5]);
  }

  /** Opens the Channel's subscriptions; the returned function closes every one of them. */
  start(): () => void {
    const firstPage: VerifiedEvent[] = [];
    let eosed = false;
    const liveMessages = this.client.subscribe(liveMessageFilters(this.channelId), {
      // A reconnect asks from the newest Message held, not for the newest page again (#226) —
      // but only once the first page has landed, whose size is what says there is more behind it.
      onResubscribe: () => {
        if (!eosed) return liveMessageFilters(this.channelId);
        const filters = reconnectMessageFilters(this.channelId, newestCreatedAt([...this.messages.values()]));
        this.messageGap.asking(filters[0]!);
        return filters;
      },
      onEvent: (event) => {
        this.messageGap.heard(event);
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
        this.messageGap.answered();
      },
    });
    const companions = this.client.subscribe(channelCompanionFilters(this.channelId), {
      onResubscribe: () => {
        const held = [...this.messages.values(), ...this.replies.values(), ...this.reactions.values(), ...this.deletions.values()];
        const filters = reconnectCompanionFilters(this.channelId, newestCreatedAt(held));
        this.companionGap.asking(filters[0]!);
        this.deletionGap.asking(filters[1]!);
        return filters;
      },
      onEvent: (event) => {
        this.companionGap.heard(event);
        this.deletionGap.heard(event);
        this.apply(event);
      },
      onEose: () => {
        this.emit();
        this.companionGap.answered();
        this.deletionGap.answered();
      },
    });
    this.disposers.push(liveMessages, companions);
    // Only the relay subscriptions: the listeners belong to whoever is rendering the feed,
    // which under StrictMode outlives a start()/dispose() pair.
    return () => {
      for (const dispose of this.disposers.splice(0)) dispose();
      this.closeOlder?.();
      this.cancelDeadline?.();
      this.closeOlder = this.cancelDeadline = null;
      this.loadingOlder = false;
      this.messageGap.stop();
      this.companionGap.stop();
      this.deletionGap.stop();
      for (const close of this.pendingRootFetches) close();
      this.pendingRootFetches.clear();
      this.coveredRoots.clear();
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
    let finished = false;
    const unsubscribe = this.client.subscribe(filters, {
      onEvent: (event) => {
        page.push(event);
        this.apply(event);
      },
      onEose: () => {
        // A reconnect re-issues the REQ, and its EOSE is not a second answer to this page.
        if (finished) return;
        finished = true;
        if (isEndOfHistory(knownIds, page)) this.hasMore = false;
        this.coverRoots(page);
        this.loadingOlder = false;
        this.closeOlder?.();
        this.cancelDeadline?.();
        this.closeOlder = this.cancelDeadline = null;
        this.emit();
      },
    });
    // A relay that answers within subscribe() has already finished the page.
    if (finished) {
      unsubscribe();
      return;
    }
    this.closeOlder = unsubscribe;
    // A page whose EOSE never arrives frees the paging instead of blocking it forever: what it
    // did bring stays, and how much history is left is still unknown (#232).
    this.cancelDeadline = this.schedule(() => {
      if (finished) return;
      finished = true;
      // Whatever the page did bring stays, so its roots still need their companions.
      this.coverRoots(page);
      this.loadingOlder = false;
      this.closeOlder?.();
      this.closeOlder = this.cancelDeadline = null;
      this.emit();
    }, PAGE_DEADLINE_MS);
  }

  /** Asks for what is still owed, once a page of it overran its deadline. Nothing does on
   * its own until the next reconnect: a relay sitting on the REQ would be asked again and again. */
  retryGap = (): void => {
    this.messageGap.fill();
    this.companionGap.fill();
    this.deletionGap.fill();
  };

  getSnapshot = (): FeedSnapshot => {
    this.snapshot ??= {
      messages: [...this.messages.values()],
      replies: [...this.replies.values()],
      reactions: [...this.reactions.values()],
      deletions: [...this.deletions.values()],
      hasMore: this.hasMore,
      gap: combinedGapState([this.messageGap.state, this.companionGap.state, this.deletionGap.state]),
      retryGap: this.retryGap,
    };
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Skips the map write and the listener notification for an id already held — events are
   * immutable, and the same companion can reach the feed through more than one subscription. */
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

  /** Fetches the Replies and Reactions of a page's roots, then closes — the relay clamps each
   * filter's `limit` at MAX_LIMIT=500 (api/src/studio_api/nostr/limits.py), so every page asks on
   * its own rather than sharing one ever-widening filter whose ceiling the newest pages would
   * exhaust (#119). Nothing stays open per page (#91): whatever targets these roots from now on
   * reaches the Channel-wide companion subscription. A replayed page (a reconnect re-issues every
   * open subscription) must not ask again. */
  private coverRoots(page: VerifiedEvent[]): void {
    const roots = page.map((event) => event.id).filter((id) => !this.coveredRoots.has(id));
    if (roots.length === 0) return;
    for (const id of roots) this.coveredRoots.add(id);
    let unsubscribe: (() => void) | null = null;
    let finished = false;
    unsubscribe = this.client.subscribe(rootCompanionFilters(roots), {
      onEvent: (event) => this.apply(event),
      onEose: () => {
        finished = true;
        if (unsubscribe === null) return;
        this.pendingRootFetches.delete(unsubscribe);
        unsubscribe();
      },
    });
    if (finished) unsubscribe();
    else this.pendingRootFetches.add(unsubscribe);
  }

  private emit(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }
}

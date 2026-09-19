import type { VerifiedEvent } from "nostr-tools";
import type { FeedClient } from "./channelFeed";
import {
  DM_PAGE_SIZE,
  completeFrom,
  isLastDmPage,
  liveDmFilters,
  needsOpeningBackfill,
  olderDmFilters,
} from "./dmPagination";
import type { Rumor } from "./nip17";

export interface DmSnapshot {
  /** Every Direct Message unwrapped so far, complete or not. */
  rumors: Rumor[];
  hasMore: boolean;
  /** The send time from which `rumors` holds every Direct Message there is (`completeFrom`). */
  completeFrom: number;
}

/**
 * The caller's Direct Message stream, paged by gift wrap (#185) and kept off React so the paging
 * can be tested on its own, as `ChannelFeed` is. The first page stays open for whatever is
 * published next; opening pages in until the last day is complete; older pages come on demand.
 */
export class DmFeed {
  private readonly wraps = new Map<string, VerifiedEvent>();
  private readonly rumors = new Map<string, Rumor>();
  private hasMore = false;
  /** Closes the older page in flight, if any. */
  private closeOlder: (() => void) | null = null;
  private closeLive: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: DmSnapshot | null = null;

  private readonly client: FeedClient;
  private readonly ownPubkey: string;
  private readonly unwrap: (wrap: VerifiedEvent) => Promise<Rumor>;
  private readonly now: () => number;

  constructor(client: FeedClient, ownPubkey: string, unwrap: (wrap: VerifiedEvent) => Promise<Rumor>, now: () => number) {
    this.client = client;
    this.ownPubkey = ownPubkey;
    this.unwrap = unwrap;
    this.now = now;
  }

  /** Opens the subscription; the returned function closes it and any page in flight. */
  start(): () => void {
    let firstPage = 0;
    let eosed = false;
    const live = this.client.subscribe(liveDmFilters(this.ownPubkey), {
      onEvent: (wrap) => {
        if (!eosed) firstPage += 1;
        this.apply(wrap);
      },
      onEose: () => {
        if (eosed) return;
        eosed = true;
        this.hasMore = firstPage >= DM_PAGE_SIZE;
        this.emit();
        this.backfill();
      },
    });
    this.closeLive = live;
    return () => {
      this.closeLive?.();
      this.closeOlder?.();
      this.closeLive = this.closeOlder = null;
    };
  }

  /** Fetches the page of gift wraps before the oldest held. A no-op while one is in flight, or
   * once the history is known to be exhausted. */
  loadOlder(): void {
    if (this.closeOlder !== null || !this.hasMore) return;
    const filters = olderDmFilters(this.ownPubkey, [...this.wraps.values()]);
    if (filters.length === 0) return;

    const knownIds = new Set(this.wraps.keys());
    const page: VerifiedEvent[] = [];
    let finished = false;
    const unsubscribe = this.client.subscribe(filters, {
      onEvent: (wrap) => {
        page.push(wrap);
        this.apply(wrap);
      },
      onEose: () => {
        if (isLastDmPage(knownIds, page)) this.hasMore = false;
        finished = true;
        this.closeOlder?.();
        this.closeOlder = null;
        this.emit();
        this.backfill();
      },
    });
    // A relay that answers within subscribe() has already finished the page.
    if (finished) unsubscribe();
    else this.closeOlder = unsubscribe;
  }

  getSnapshot = (): DmSnapshot => {
    this.snapshot ??= {
      rumors: [...this.rumors.values()],
      hasMore: this.hasMore,
      completeFrom: completeFrom(this.oldestWrapAt(), this.hasMore),
    };
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Opening the app pages in until the last day is complete — a Message sent a minute ago may
   * sit two days down the wrap order. */
  private backfill(): void {
    if (needsOpeningBackfill(completeFrom(this.oldestWrapAt(), this.hasMore), this.now())) this.loadOlder();
  }

  /** A gift wrap that fails to unwrap (foreign ciphertext, tampered seal) is skipped — the relay
   * already restricts delivery to the `p`-tagged recipient — but still counts as paged past. */
  private apply(wrap: VerifiedEvent): void {
    if (this.wraps.has(wrap.id)) return;
    this.wraps.set(wrap.id, wrap);
    this.unwrap(wrap)
      .then((rumor) => {
        if (this.rumors.has(rumor.id)) return;
        this.rumors.set(rumor.id, rumor);
        this.emit();
      })
      .catch(() => {});
  }

  private oldestWrapAt(): number | null {
    if (this.wraps.size === 0) return null;
    let oldest = Infinity;
    for (const wrap of this.wraps.values()) oldest = Math.min(oldest, wrap.created_at);
    return oldest;
  }

  private emit(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }
}

import type { VerifiedEvent } from "nostr-tools";
import type { FeedClient } from "./channelFeed";
import { PAGE_DEADLINE_MS, oldestCreatedAt } from "./channelPagination";
import { type Timer, timer } from "./clock";
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
  /** Every Message unwrapped so far, complete or not. */
  rumors: Rumor[];
  hasMore: boolean;
  /** The send time from which `rumors` holds every Message there is (`completeFrom`). */
  completeFrom: number;
  /** How many older pages have settled — by their EOSE or by their deadline. A page that
   * brought nothing moves nothing else, so this is what tells a reader waiting on one that it
   * is over and they may ask again (#231, #232). */
  pages: number;
  /** `DmFeed.loadOlder`, carried along so the snapshot is all a caller renders from — the same
   * object until something changes (#194). */
  loadOlder: () => void;
}

/**
 * The caller's Direct Message stream, paged by gift wrap (#185) and kept off React so the paging
 * can be tested on its own, as `ChannelFeed` is. The first page stays open for whatever is
 * published next; opening pages in until the last day is complete; older pages come on demand.
 */
export class DmFeed {
  private readonly wraps = new Map<string, VerifiedEvent>();
  /** The wraps a page brought — the only ones the cursor may page from. A live one is dated up
   * to two days back (NIP-59) and says nothing about what lies between it and the pages. */
  private readonly paged: VerifiedEvent[] = [];
  private readonly rumors = new Map<string, Rumor>();
  private hasMore = false;
  private pagesSettled = 0;
  /** Set once a page proved nothing older is left: starting again reads a full first page, and
   * that says nothing about history a cursor has already walked past the end of. */
  private exhausted = false;
  /** A page is in flight from its REQ until its wraps are unwrapped: until then the Messages it
   * brought are not in the snapshot, and asking again would fetch past them. */
  private loadingOlder = false;
  private closeLive: (() => void) | null = null;
  private closeOlder: (() => void) | null = null;
  /** Cancels the in-flight page's deadline — nothing is owed once it has answered. */
  private cancelDeadline: (() => void) | null = null;
  /** Bumped by every start/stop: a page that finishes unwrapping for an earlier run is dropped. */
  private run = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: DmSnapshot | null = null;

  private readonly client: FeedClient;
  private readonly ownPubkey: string;
  private readonly unwrap: (wrap: VerifiedEvent) => Promise<Rumor>;
  private readonly now: () => number;
  private readonly schedule: Timer;

  constructor(
    client: FeedClient,
    ownPubkey: string,
    unwrap: (wrap: VerifiedEvent) => Promise<Rumor>,
    now: () => number,
    schedule: Timer = timer,
  ) {
    this.client = client;
    this.ownPubkey = ownPubkey;
    this.unwrap = unwrap;
    this.now = now;
    this.schedule = schedule;
  }

  /** Opens the subscription; the returned function closes it and any page in flight. */
  start(): () => void {
    const run = ++this.run;
    // What this REQ answered, not what the feed had never seen: a second start over the wraps a
    // first one already held would otherwise read an empty page and call the history exhausted.
    const firstPageIds = new Set<string>();
    let eosed = false;
    this.closeLive = this.client.subscribe(liveDmFilters(this.ownPubkey), {
      onEvent: (wrap) => {
        if (!eosed && !firstPageIds.has(wrap.id)) {
          firstPageIds.add(wrap.id);
          if (!this.wraps.has(wrap.id)) this.paged.push(wrap);
        }
        void this.apply(wrap);
      },
      onEose: () => {
        // A reconnect re-issues the REQ: its EOSE is not a second first page.
        if (eosed) return;
        eosed = true;
        this.hasMore = !this.exhausted && firstPageIds.size >= DM_PAGE_SIZE;
        this.emit();
        if (run === this.run) this.backfill();
      },
    });
    return () => {
      this.run += 1;
      this.closeLive?.();
      this.closeOlder?.();
      this.cancelDeadline?.();
      this.closeLive = this.closeOlder = this.cancelDeadline = null;
      this.loadingOlder = false;
    };
  }

  /** Fetches the page of gift wraps before the oldest paged in. A no-op while one is in flight,
   * or once the history is known to be exhausted. */
  loadOlder = (): void => {
    if (this.loadingOlder || !this.hasMore) return;
    const run = this.run;
    const knownIds = new Set(this.wraps.keys());
    // By id: a reconnect replays the page, and a wrap counted twice would look like more history.
    const page = new Map<string, VerifiedEvent>();
    const unwrapping: Promise<void>[] = [];
    this.loadingOlder = true;
    let finished = false;
    const unsubscribe = this.client.subscribe(olderDmFilters(this.ownPubkey, this.paged, [...this.wraps.values()]), {
      onEvent: (wrap) => {
        if (page.has(wrap.id)) return;
        page.set(wrap.id, wrap);
        if (!knownIds.has(wrap.id)) this.paged.push(wrap);
        unwrapping.push(this.apply(wrap));
      },
      onEose: () => {
        if (finished) return;
        finished = true;
        this.closeOlder?.();
        this.cancelDeadline?.();
        this.closeOlder = this.cancelDeadline = null;
        void Promise.all(unwrapping).then(() => {
          if (run !== this.run) return;
          if (isLastDmPage(knownIds, [...page.values()])) {
            this.hasMore = false;
            this.exhausted = true;
          }
          this.loadingOlder = false;
          this.pagesSettled += 1;
          this.emit();
          this.backfill();
        });
      },
    });
    // A relay that answers within subscribe() has already finished the page.
    if (finished) {
      unsubscribe();
      return;
    }
    this.closeOlder = unsubscribe;
    // A page whose EOSE never arrives frees the paging instead of blocking it forever: what it
    // did bring stays, and how much history is left is still unknown (#232). The deadline covers
    // the REQ, which is what a reconnect drops; unwrapping afterwards is the signer's own work,
    // and `apply` already swallows a wrap that refuses to open.
    this.cancelDeadline = this.schedule(() => {
      if (finished) return;
      finished = true;
      this.closeOlder?.();
      this.closeOlder = this.cancelDeadline = null;
      this.loadingOlder = false;
      this.pagesSettled += 1;
      this.emit();
    }, PAGE_DEADLINE_MS);
  };

  getSnapshot = (): DmSnapshot => {
    this.snapshot ??= {
      rumors: [...this.rumors.values()],
      hasMore: this.hasMore,
      completeFrom: completeFrom(oldestCreatedAt(this.paged), this.hasMore),
      pages: this.pagesSettled,
      loadOlder: this.loadOlder,
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
    if (needsOpeningBackfill(completeFrom(oldestCreatedAt(this.paged), this.hasMore), this.now())) this.loadOlder();
  }

  /** Settles once the wrap is unwrapped — or found not to be the caller's: a gift wrap that fails
   * to unwrap (foreign ciphertext, tampered seal) is skipped, since the relay already restricts
   * delivery to the `p`-tagged recipient, but still counts as paged past. */
  private apply(wrap: VerifiedEvent): Promise<void> {
    if (this.wraps.has(wrap.id)) return Promise.resolve();
    this.wraps.set(wrap.id, wrap);
    return this.unwrap(wrap)
      .then((rumor) => {
        if (this.rumors.has(rumor.id)) return;
        this.rumors.set(rumor.id, rumor);
        this.emit();
      })
      .catch(() => {});
  }

  private emit(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }
}

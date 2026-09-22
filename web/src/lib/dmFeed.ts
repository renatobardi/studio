import type { VerifiedEvent } from "nostr-tools";
import type { FeedClient } from "./channelFeed";
import { PAGE_DEADLINE_MS, newestCreatedAt, oldestCreatedAt } from "./channelPagination";
import { type Timer, timer } from "./clock";
import {
  DM_PAGE_SIZE,
  completeFrom,
  isLastDmPage,
  liveDmFilters,
  needsOpeningBackfill,
  olderDmFilters,
  reconnectDmFilters,
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
   * to two days back (NIP-59) and says nothing about what lies between it and the pages; the
   * same wrap brought back by a page does, since the page covers everything down to it. */
  private readonly paged = new Map<string, VerifiedEvent>();
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
      // A reconnect asks from the newest wrap held, not for the newest page again (#226) — but
      // only once the first page has landed: its size is what says whether there is history
      // behind it, and a `since` window counted into that would call a long history exhausted.
      onResubscribe: () =>
        eosed ? reconnectDmFilters(this.ownPubkey, newestCreatedAt([...this.wraps.values()])) : liveDmFilters(this.ownPubkey),
      onEvent: (wrap) => {
        if (!eosed && !firstPageIds.has(wrap.id)) {
          firstPageIds.add(wrap.id);
          if (!this.wraps.has(wrap.id)) this.paged.set(wrap.id, wrap);
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
    /** The page has settled — by its EOSE and unwrapping, or by its deadline. Whichever got
     * here first is the only one that settles it. */
    let finished = false;
    /** The REQ answered. The page is not over yet: its wraps still have to open. */
    let eosed = false;
    const settle = () => {
      this.loadingOlder = false;
      this.pagesSettled += 1;
      this.emit();
    };
    const filters = olderDmFilters(this.ownPubkey, [...this.paged.values()], [...this.wraps.values()]);
    const unsubscribe = this.client.subscribe(filters, {
      onEvent: (wrap) => {
        if (page.has(wrap.id)) return;
        page.set(wrap.id, wrap);
        this.paged.set(wrap.id, wrap);
        unwrapping.push(this.apply(wrap));
      },
      onEose: () => {
        if (finished || eosed) return;
        eosed = true;
        this.closeOlder?.();
        this.closeOlder = null;
        void Promise.all(unwrapping).then(() => {
          // The deadline may have settled the page while a wrap was still open.
          if (finished) return;
          finished = true;
          // Before touching anything on the feed: this settles a microtask later than the EOSE
          // that scheduled it, and by then a stop/start may have put another page in flight.
          // `cancelDeadline` is the feed's, not the page's — cancelling it here would leave the
          // new page with nothing to free it, which is the freeze this deadline exists to cure.
          if (run !== this.run) return;
          this.cancelDeadline?.();
          this.cancelDeadline = null;
          if (isLastDmPage(knownIds, [...page.values()], filters[0]?.limit ?? 0)) {
            this.hasMore = false;
            this.exhausted = true;
          }
          settle();
          this.backfill();
        });
      },
    });
    // A relay that answers within subscribe() has already closed the page's REQ — but not its
    // unwrapping, so the deadline below is still owed.
    if (eosed) unsubscribe();
    else this.closeOlder = unsubscribe;
    // A page that never settles frees the paging instead of blocking it forever: what it did
    // bring stays, and how much history is left is still unknown (#232). The deadline covers the
    // unwrapping too, not only the REQ (#268): `apply` swallows a wrap that refuses to open, but
    // a signer that never answers at all leaves the promise pending, and `Promise.all` with it —
    // which is what a NIP-07 extension that stops cooperating does.
    this.cancelDeadline = this.schedule(() => {
      if (finished) return;
      finished = true;
      this.closeOlder?.();
      this.closeOlder = this.cancelDeadline = null;
      settle();
    }, PAGE_DEADLINE_MS);
  };

  getSnapshot = (): DmSnapshot => {
    this.snapshot ??= {
      rumors: [...this.rumors.values()],
      hasMore: this.hasMore,
      completeFrom: completeFrom(oldestCreatedAt([...this.paged.values()]), this.hasMore),
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
    if (needsOpeningBackfill(completeFrom(oldestCreatedAt([...this.paged.values()]), this.hasMore), this.now())) this.loadOlder();
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

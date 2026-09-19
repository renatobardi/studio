import type { Filter, VerifiedEvent } from "nostr-tools";
import { oldestCreatedAt } from "./channelPagination";
import { GIFT_WRAP } from "./nip17";

/** Gift wraps per page — the relay orders and cuts by the wrap's own created_at (#185). */
export const DM_PAGE_SIZE = 100;

/** Messages mounted per step of an open conversation: each mounted photo is a download. */
export const DM_SHOWN_STEP = 50;

/**
 * How far a gift wrap's created_at may sit behind its Message's: NIP-59 backdates it by up to two
 * days (`randomPast` in ./nip17), plus an hour for another client's rounding or clock.
 */
export const WRAP_BACKDATE_SECONDS = 2 * 24 * 60 * 60 + 60 * 60;

/** How much of the recent history opening the app pages in before showing it complete. */
export const OPEN_WINDOW_SECONDS = 24 * 60 * 60;

/** The first page — and, left open, every gift wrap published to the caller from now on. */
export function liveDmFilters(ownPubkey: string): Filter[] {
  return [{ kinds: [GIFT_WRAP], "#p": [ownPubkey], limit: DM_PAGE_SIZE }];
}

/**
 * The next page of older gift wraps, paged by the wrap's created_at — the rumor's is only
 * readable after unwrapping. The cursor is the oldest wrap a page brought: one that arrived live
 * is backdated by up to two days, and paging from it would skip every wrap in between. `until` is
 * inclusive, so the limit carries every wrap already held at or below the cursor on top of a
 * page — the same wraps `isLastDmPage` discounts from what comes back, which is what keeps a
 * full page from reading short (#230). `olderMessagesFilters` does the same for a Channel, where
 * nothing is backdated and the cursor second is all there can be.
 *
 * The relay clamps every limit at MAX_LIMIT=500 (api/src/studio_api/nostr/limits.py), so this
 * holds while fewer than 400 held wraps sit at or below the cursor — a live wrap is backdated by
 * at most two days, and a cursor that recent is still being paged past by the opening backfill.
 */
export function olderDmFilters(
  ownPubkey: string,
  paged: readonly VerifiedEvent[],
  held: readonly VerifiedEvent[],
): Filter[] {
  const oldest = oldestCreatedAt([...paged]);
  if (oldest === null) return [];
  const knownBelowCursor = held.filter((wrap) => wrap.created_at <= oldest).length;
  return [{ kinds: [GIFT_WRAP], "#p": [ownPubkey], until: oldest, limit: DM_PAGE_SIZE + knownBelowCursor }];
}

/**
 * Whether an older page proves nothing older is left. It asked for a page's worth past every
 * wrap already held at or below the cursor, so fewer unseen ones than that means the relay ran
 * out.
 */
export function isLastDmPage(knownIds: ReadonlySet<string>, page: readonly VerifiedEvent[]): boolean {
  return page.filter((wrap) => !knownIds.has(wrap.id)).length < DM_PAGE_SIZE;
}

/**
 * The send time from which every Message held is all there is. A Message sent before it
 * may have a sibling whose wrap was backdated below the oldest wrap held, so showing it would show
 * a history with holes in it.
 */
export function completeFrom(oldestWrapAt: number | null, hasMore: boolean): number {
  if (!hasMore || oldestWrapAt === null) return -Infinity;
  return oldestWrapAt + WRAP_BACKDATE_SECONDS;
}

/** Whether opening the app still has to page before the last day of Messages is complete. */
export function needsOpeningBackfill(from: number, now: number): boolean {
  return from > now - OPEN_WINDOW_SECONDS;
}

/** How much of a conversation the reader asked to see, and — while a page is awaited — how many
 * complete Messages it had when they asked. */
export type ShownState = Readonly<{ shown: number; waitingPast: number | null }>;

/** "Load older": one more step on screen. With nothing held back, older Messages have to come
 * from the relay, so it also waits for the conversation to gain one. */
export function askOlder(
  state: ShownState,
  { hidden, complete, hasMore }: { hidden: number; complete: number; hasMore: boolean },
): ShownState {
  return { shown: state.shown + DM_SHOWN_STEP, waitingPast: hidden === 0 && hasMore ? complete : state.waitingPast };
}

/** A page is global — the relay cannot tell which conversation a wrap belongs to — so it may bring
 * nothing for this one: keep paging until it does, or the history runs out. */
export function keepFetchingOlder(state: ShownState, { complete, hasMore }: { complete: number; hasMore: boolean }): boolean {
  return state.waitingPast !== null && complete <= state.waitingPast && hasMore;
}

/** What an open conversation shows: the newest `shown` of its complete Messages (oldest first),
 * how many complete ones are held back, and whether there is anything older to offer or fetch. */
export interface DmHistoryView<T> {
  messages: T[];
  hidden: number;
  complete: number;
  hasMore: boolean;
  canLoadOlder: boolean;
  fetchOlder: boolean;
}

export function dmHistoryView<T extends { created_at: number }>(
  messages: readonly T[],
  from: number,
  state: ShownState,
  hasMore: boolean,
): DmHistoryView<T> {
  const complete = messages.filter((message) => message.created_at >= from);
  const hidden = Math.max(0, complete.length - state.shown);
  return {
    messages: complete.slice(hidden),
    hidden,
    complete: complete.length,
    hasMore,
    canLoadOlder: hidden > 0 || hasMore,
    fetchOlder: keepFetchingOlder(state, { complete: complete.length, hasMore }),
  };
}

/** Reaching the top asks for older Messages only while scrolling up: a conversation opens at the
 * top, and the first scroll down from there must not pull in another step. */
export function asksForOlder(previousTop: number, top: number, threshold: number): boolean {
  return top < previousTop && top <= threshold;
}

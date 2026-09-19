import type { Filter, VerifiedEvent } from "nostr-tools";
import { GIFT_WRAP } from "./nip17";

/** Gift wraps per page — the relay orders and cuts by the wrap's own created_at (#185). */
export const DM_PAGE_SIZE = 100;

/** Direct Messages mounted per step of an open conversation: each mounted photo is a download. */
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
 * readable after unwrapping. `until` is inclusive, so the limit carries the wraps already held at
 * the cursor second on top of a page, as `olderMessagesFilters` does for a Channel.
 */
export function olderDmFilters(ownPubkey: string, wraps: readonly VerifiedEvent[]): Filter[] {
  if (wraps.length === 0) return [];
  const oldest = Math.min(...wraps.map((wrap) => wrap.created_at));
  const knownAtCursor = wraps.filter((wrap) => wrap.created_at === oldest).length;
  return [{ kinds: [GIFT_WRAP], "#p": [ownPubkey], until: oldest, limit: DM_PAGE_SIZE + knownAtCursor }];
}

/**
 * Whether an older page proves nothing older is left. It asked for a page's worth past the wraps
 * replayed at the cursor second, so fewer unseen ones than that means the relay ran out.
 */
export function isLastDmPage(knownIds: ReadonlySet<string>, page: readonly VerifiedEvent[]): boolean {
  return page.filter((wrap) => !knownIds.has(wrap.id)).length < DM_PAGE_SIZE;
}

/**
 * The send time from which every Direct Message held is all there is. A Message sent before it
 * may have a sibling whose wrap was backdated below the oldest wrap held, so showing it would show
 * a history with holes in it.
 */
export function completeFrom(oldestWrapAt: number | null, hasMore: boolean): number {
  if (!hasMore || oldestWrapAt === null) return -Infinity;
  return oldestWrapAt + WRAP_BACKDATE_SECONDS;
}

/** Whether opening the app still has to page before the last day of Direct Messages is complete. */
export function needsOpeningBackfill(from: number, now: number): boolean {
  return from > now - OPEN_WINDOW_SECONDS;
}

/** The newest `shown` of a conversation's complete Messages (oldest first), and how many complete
 * ones are held back. */
export function shownMessages<T extends { created_at: number }>(
  messages: readonly T[],
  from: number,
  shown: number,
): { messages: T[]; hidden: number } {
  const complete = messages.filter((message) => message.created_at >= from);
  const hidden = Math.max(0, complete.length - shown);
  return { messages: complete.slice(hidden), hidden };
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

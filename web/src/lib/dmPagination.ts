import type { Filter, VerifiedEvent } from "nostr-tools";
import { CLOCK_SKEW_SECONDS, oldestCreatedAt } from "./channelPagination";
import type { Gap } from "./feedGap";
import { FUTURE_TOLERANCE_SECONDS, GIFT_WRAP_PAST_TOLERANCE_SECONDS, MAX_LIMIT } from "./relay";
import { GIFT_WRAP } from "./nip17";

/** Gift wraps per page — the relay orders and cuts by the wrap's own created_at (#185). */
export const DM_PAGE_SIZE = 100;

/** Messages mounted per step of an open conversation: each mounted photo is a download. */
export const DM_SHOWN_STEP = 50;

/**
 * How far a gift wrap's created_at may sit behind its Message's: NIP-59 backdates it by up to two
 * days (`randomPast` in ./nip17), plus an hour for another client's rounding or clock.
 */
export const WRAP_BACKDATE_SECONDS = 2 * 24 * 60 * 60 + CLOCK_SKEW_SECONDS;

/** How much of the recent history opening the app pages in before showing it complete. */
export const OPEN_WINDOW_SECONDS = 24 * 60 * 60;

/** The first page — and, left open, every gift wrap published to the caller from now on. */
export function liveDmFilters(ownPubkey: string): Filter[] {
  return [{ kinds: [GIFT_WRAP], "#p": [ownPubkey], limit: DM_PAGE_SIZE }];
}

/** How far below the newest gift wrap held asking again after a reconnect has to reach: what the
 * relay accepts for a wrap, plus how far ahead the newest held may be stamped (ADR-0008). */
export const DM_RECONNECT_MARGIN_SECONDS = GIFT_WRAP_PAST_TOLERANCE_SECONDS + FUTURE_TOLERANCE_SECONDS;

/**
 * The same subscription, asked for again after the socket came back — `reconnectMessageFilters`
 * for gift wraps. The margin is the whole backdating window, not just a clock's: a wrap
 * published while the client was away is stamped up to two days before it (NIP-59), so a `since`
 * at the newest one held would skip it (#226) — and it is the relay that refuses one stamped
 * further back, so the window is a bound rather than a hope (`DM_RECONNECT_MARGIN_SECONDS`).
 * The same `MAX_LIMIT` cut applies, and `DmFeed` reads an answer that long as a `Gap` (#254).
 */
export function reconnectDmFilters(ownPubkey: string, newestHeldAt: number | null): Filter[] {
  if (newestHeldAt === null) return liveDmFilters(ownPubkey);
  return [
    { kinds: [GIFT_WRAP], "#p": [ownPubkey], since: newestHeldAt - DM_RECONNECT_MARGIN_SECONDS, limit: MAX_LIMIT },
  ];
}

/** The gift wraps a reconnect's cut answer left unasked — `gapMessageFilters` for a Direct Message
 * feed, with the same `MAX_LIMIT` so the answer's length says whether it was cut. */
export function gapDmFilters(ownPubkey: string, gap: Gap): Filter[] {
  return [{ kinds: [GIFT_WRAP], "#p": [ownPubkey], since: gap.since, until: gap.until, limit: MAX_LIMIT }];
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
 * Never past MAX_LIMIT=500, where the relay clamps every limit silently
 * (api/src/studio_api/nostr/limits.py): the page's length is what says whether it was cut, and
 * only an asked-for limit the relay honours keeps that true (#257).
 */
export function olderDmFilters(
  ownPubkey: string,
  paged: readonly VerifiedEvent[],
  held: readonly VerifiedEvent[],
): Filter[] {
  const oldest = oldestCreatedAt([...paged]);
  if (oldest === null) return [];
  const knownBelowCursor = held.filter((wrap) => wrap.created_at <= oldest).length;
  const limit = Math.min(DM_PAGE_SIZE + knownBelowCursor, MAX_LIMIT);
  return [{ kinds: [GIFT_WRAP], "#p": [ownPubkey], until: oldest, limit }];
}

/**
 * Whether an older page proves nothing older is left. It asked for a page's worth past every wrap
 * already held at or below the cursor, so fewer unseen ones than that means the relay ran out —
 * unless the relay cut the page at its ceiling, where most of it can be wraps already held and
 * history still behind it (#257). A cut page is as long as it asked for, so a page only ends the
 * history when it is shorter than that too. Both have to agree: reading a page as the last when it
 * is not hides the rest of the history (#230), the other way round costs one more page.
 */
export function isLastDmPage(knownIds: ReadonlySet<string>, page: readonly VerifiedEvent[], limit: number): boolean {
  return page.length < limit && page.filter((wrap) => !knownIds.has(wrap.id)).length < DM_PAGE_SIZE;
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

/** How many pages one opening of a conversation may pull in before it stops asking on its own.
 * A page is global — it may bring nothing for this conversation — so a quiet conversation whose
 * last Message is far down the inbox would otherwise page the whole thing (#231). */
export const DM_OPENING_PAGES = 8;

/** How much of a conversation the reader asked to see, — while a page is awaited — how many
 * complete Messages it had when they asked, and the feed's page count when this wait began: what
 * has settled since is what the budget is spent on. */
export type ShownState = Readonly<{ shown: number; waitingPast: number | null; pagesAt: number }>;

/** A conversation just opened: it waits on a history with nothing in it yet, so anything sent
 * before `completeFrom` is fetched without the reader having to ask. */
export function openedConversation(pages: number): ShownState {
  return { shown: DM_SHOWN_STEP, waitingPast: 0, pagesAt: pages };
}

/** "Load older": one more step on screen. With nothing held back, older Messages have to come
 * from the relay, so it also waits for the conversation to gain one — and the reader asking is
 * worth a fresh budget of pages, whatever this opening has already spent. */
export function askOlder(
  state: ShownState,
  { hidden, complete, hasMore, pages }: { hidden: number; complete: number; hasMore: boolean; pages: number },
): ShownState {
  return {
    shown: state.shown + DM_SHOWN_STEP,
    waitingPast: hidden === 0 && hasMore ? complete : state.waitingPast,
    pagesAt: pages,
  };
}

/** A page is global — the relay cannot tell which conversation a wrap belongs to — so it may bring
 * nothing for this one: keep paging until it does, the history runs out, or this opening has
 * spent its budget. */
export function keepFetchingOlder(
  state: ShownState,
  { complete, hasMore, pages }: { complete: number; hasMore: boolean; pages: number },
): boolean {
  const spent = pages - state.pagesAt;
  return state.waitingPast !== null && complete <= state.waitingPast && hasMore && spent < DM_OPENING_PAGES;
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
  pages: number,
): DmHistoryView<T> {
  const complete = messages.filter((message) => message.created_at >= from);
  const hidden = Math.max(0, complete.length - state.shown);
  return {
    messages: complete.slice(hidden),
    hidden,
    complete: complete.length,
    hasMore,
    canLoadOlder: hidden > 0 || hasMore,
    fetchOlder: keepFetchingOlder(state, { complete: complete.length, hasMore, pages }),
  };
}

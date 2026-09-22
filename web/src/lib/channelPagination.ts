import type { Filter, VerifiedEvent } from "nostr-tools";
import type { Gap } from "./feedGap";
import { CHANNEL_PAST_TOLERANCE_SECONDS, FUTURE_TOLERANCE_SECONDS, MAX_LIMIT } from "./relay";

/** Messages per page — the timeline's own budget, never shared with Reactions or Replies. */
export const PAGE_SIZE = 50;

/** How far another client's clock, or its rounding, may put an event behind ours. */
export const CLOCK_SKEW_SECONDS = 60 * 60;

/**
 * How far below the newest Message held asking again after a reconnect has to reach (ADR-0008).
 * A Message accepted while the client was away is stamped no earlier than an hour before it
 * arrived — the relay refuses anything older for a Channel's content — and the newest one held
 * no later than 15 minutes after the drop, the most the relay lets a `created_at` run ahead.
 */
export const CHANNEL_RECONNECT_MARGIN_SECONDS = CHANNEL_PAST_TOLERANCE_SECONDS + FUTURE_TOLERANCE_SECONDS;

/**
 * How long a page may stay in flight before the feed stops waiting for its EOSE and lets the
 * reader ask again. A relay that drops and reconnects does not re-emit the EOSE of a
 * subscription it already answered, and without a deadline that page blocks every later one for
 * the rest of the session (#232) — the same reason the download queue has one (#188). Generous
 * on purpose: it is a stuck subscription's escape, not a latency budget.
 */
export const PAGE_DEADLINE_MS = 20_000;

/**
 * A Channel's timeline REQ: Messages (kind 9) only. Asking for the four content kinds under
 * one limit let a burst of Reactions fill the page and leave the Channel looking empty (#41).
 */
export function liveMessageFilters(channelId: string): Filter[] {
  return [{ kinds: [9], "#h": [channelId], limit: PAGE_SIZE }];
}

/**
 * The same subscription, asked for again after the socket came back. A reconnect re-issues the
 * REQ, and the live filter is a window of the newest `PAGE_SIZE`: more Messages than that
 * arriving while the client was away would leave everything but the last page in a hole the
 * cursor never revisits, since it only walks down from what the pages brought (#226).
 *
 * `since` instead of a window, from the newest Message held — less the margin the relay's own
 * tolerance for a Channel's content guarantees is enough (`CHANNEL_RECONNECT_MARGIN_SECONDS`).
 * What that costs is every Message already held in the last hour and a quarter, asked for again.
 *
 * `MAX_LIMIT` is asked for outright, since that is what the relay gives a filter that names no
 * limit. It is still a cut: more than that arriving during one outage leaves the oldest of them
 * between what is held and where the cursor reaches — which is why `ChannelFeed` reads an answer
 * that long as a `Gap` and asks for the rest (#254).
 */
export function reconnectMessageFilters(channelId: string, newestHeldAt: number | null): Filter[] {
  if (newestHeldAt === null) return liveMessageFilters(channelId);
  return [{ kinds: [9], "#h": [channelId], since: newestHeldAt - CHANNEL_RECONNECT_MARGIN_SECONDS, limit: MAX_LIMIT }];
}

/** What a reconnect's cut answer left unasked (`Gap`) of a Channel's `kinds`, newest first from
 * the top of the gap — the same `MAX_LIMIT` a reconnect asks for, so the answer's length says
 * whether it was cut. */
export function channelGapFilters(channelId: string, kinds: number[], gap: Gap): Filter[] {
  return [{ kinds, "#h": [channelId], since: gap.since, until: gap.until, limit: MAX_LIMIT }];
}

/**
 * The Thread Replies and Reactions that target a page of Messages, addressed by the roots'
 * own ids. `created_at` is author-supplied and the relay accepts it up to
 * PAST_TOLERANCE_SECONDS in the past (api/src/studio_api/nostr/validation.py), so a time
 * window around the roots would silently lose a backdated Reaction and undercount it (#41).
 */
export function rootCompanionFilters(rootIds: string[]): Filter[] {
  return [
    { kinds: [1111], "#E": rootIds },
    { kinds: [7], "#e": rootIds },
  ];
}

/**
 * The Channel-wide companion subscription: whatever is published from now on, plus the
 * deletions (kind 5), which name the Reaction they remove rather than any Message and so
 * cannot be asked for by root.
 */
export function channelCompanionFilters(channelId: string): Filter[] {
  return [
    { kinds: [1111, 7], "#h": [channelId], limit: PAGE_SIZE },
    { kinds: [5], "#h": [channelId] },
  ];
}

/**
 * The companion subscription, asked for again after the socket came back — the same hole as the
 * Messages' (#226): a window of the newest 50 lost everything else published meanwhile, and no
 * page of roots ever asks again for a root it has covered (#255).
 *
 * `since` the newest event held of any kind, less `CHANNEL_RECONNECT_MARGIN_SECONDS`. That is not
 * the time window `rootCompanionFilters` refuses: a Reaction aimed at an old root can be stamped
 * long before the page that loaded it, but not long before the relay accepted it (ADR-0008), and
 * this asks only for what was accepted while the client was away. Each filter asks for
 * `MAX_LIMIT`, and `ChannelFeed` reads an answer that long as a gap of its own.
 */
export function reconnectCompanionFilters(channelId: string, newestHeldAt: number | null): Filter[] {
  if (newestHeldAt === null) return channelCompanionFilters(channelId);
  const since = newestHeldAt - CHANNEL_RECONNECT_MARGIN_SECONDS;
  return [
    { kinds: [1111, 7], "#h": [channelId], since, limit: MAX_LIMIT },
    { kinds: [5], "#h": [channelId], since, limit: MAX_LIMIT },
  ];
}

/**
 * The next page of older Messages — nothing at all while none is loaded to page from.
 *
 * `until` is inclusive and NIP-01 offers no id cursor, so the relay replays the cursor
 * second's Messages on every page. The limit therefore carries the Messages already known at
 * that second on top of PAGE_SIZE: with the relay's deterministic order (created_at DESC,
 * id ASC — ADR-0004) those replayed events come first, leaving a full page of genuinely older ones —
 * which is what keeps a second holding more than PAGE_SIZE Messages from stalling (#41).
 */
export function olderMessagesFilters(channelId: string, messages: VerifiedEvent[]): Filter[] {
  const oldest = oldestCreatedAt(messages);
  if (oldest === null) return [];
  const knownAtCursor = messages.filter((message) => message.created_at === oldest).length;
  return [{ kinds: [9], "#h": [channelId], until: oldest, limit: PAGE_SIZE + knownAtCursor }];
}

/**
 * Whether a page proves the history is exhausted. Because the page always asks past the
 * replayed cursor second, a page that brings no unseen Message means there is nothing older
 * left — so paging stops instead of asking forever.
 */
export function isEndOfHistory(knownIds: Set<string>, page: VerifiedEvent[]): boolean {
  return page.every((event) => knownIds.has(event.id));
}

/** How close to the top counts as asking for older Messages (story 30, #1). */
export const TOP_OF_HISTORY_PX = 48;

/**
 * Reaching the top asks for older Messages only while scrolling up: both a Channel and a
 * conversation open at the top, so the first scroll down from there would otherwise pull in a
 * page nobody asked for (#185, #225). One rule for both surfaces, here because each one's
 * paging already reads from this module.
 */
export function asksForOlder(previousTop: number, top: number, threshold: number): boolean {
  return top < previousTop && top <= threshold;
}

/**
 * The position a paged timeline remembers between scroll events, so it can tell a scroll up
 * from a scroll down. Answers each event with whether it asks for an older page.
 *
 * The remembering lives here rather than in a component ref because that is the half a test
 * without a DOM cannot reach: the rule is only right if what it is measured against moves with
 * every event, including the ones that ask for nothing (#225).
 */
export function createScrollWatcher(threshold: number = TOP_OF_HISTORY_PX): (top: number) => boolean {
  let previousTop = 0;
  return (top) => {
    const asks = asksForOlder(previousTop, top, threshold);
    previousTop = top;
    return asks;
  };
}

/** How far back the loaded history reaches — the cursor the next page pages from. */
export function oldestCreatedAt(messages: VerifiedEvent[]): number | null {
  if (messages.length === 0) return null;
  return messages.reduce((oldest, message) => Math.min(oldest, message.created_at), Infinity);
}

/** How far forward it reaches — where asking again after a reconnect starts from. */
export function newestCreatedAt(events: VerifiedEvent[]): number | null {
  if (events.length === 0) return null;
  return events.reduce((newest, event) => Math.max(newest, event.created_at), -Infinity);
}

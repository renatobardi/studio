import type { Filter, VerifiedEvent } from "nostr-tools";

/** Messages per page — the timeline's own budget, never shared with Reactions or Replies. */
export const PAGE_SIZE = 50;

/**
 * A Channel's timeline REQ: Messages (kind 9) only. Asking for the four content kinds under
 * one limit let a burst of Reactions fill the page and leave the Channel looking empty (#41).
 */
export function liveMessageFilters(channelId: string): Filter[] {
  return [{ kinds: [9], "#h": [channelId], limit: PAGE_SIZE }];
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

/** How far back the loaded history reaches — the cursor the next page pages from. */
export function oldestCreatedAt(messages: VerifiedEvent[]): number | null {
  if (messages.length === 0) return null;
  return messages.reduce((oldest, message) => Math.min(oldest, message.created_at), Infinity);
}

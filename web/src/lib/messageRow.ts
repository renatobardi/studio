/** "08:02" — the timeline's 24h clock, as the prototype shows it. */
export function clockTime(createdAt: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(createdAt * 1000),
  );
}

/** Whether `current` continues `previous` — the same author, back to back — and so shares its
 * avatar and header instead of repeating them. The prototype groups by author alone, with no
 * time window (`buildRow` in docs/UI/design/Studio.dc.html). */
export function isContinuation(previous: { pubkey: string } | undefined, current: { pubkey: string }): boolean {
  return previous?.pubkey === current.pubkey;
}

/** "12m ago" — how long before `now` something happened, in the prototype's short form
 * ("just now", "12m ago", "3h ago", "2d ago"), rounded down. Both in seconds. */
export function relativeTime(at: number, now: number): string {
  const seconds = now - at;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

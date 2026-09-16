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

/** Enter sends; Shift+Enter breaks the line; a key pressed while an IME is composing belongs
 * to the IME (the prototype's ChatInput, plus the composition guard it lacks). */
export function sendsOnKey({ key, shiftKey, isComposing }: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}

/** "08:02" — the timeline's 24h clock, as the prototype shows it. */
export function clockTime(createdAt: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(createdAt * 1000),
  );
}

const CONTINUATION_WINDOW_SECONDS = 5 * 60;

/** Whether `current` continues `previous` — same author, within five minutes — and so shares
 * its avatar and header instead of repeating them. */
export function isContinuation(
  previous: { pubkey: string; created_at: number } | undefined,
  current: { pubkey: string; created_at: number },
): boolean {
  if (!previous) return false;
  return previous.pubkey === current.pubkey && current.created_at - previous.created_at < CONTINUATION_WINDOW_SECONDS;
}

/**
 * A span of a feed's history known to be missing — both ends inclusive, in `created_at` seconds.
 *
 * A feed pages down from one cursor and treats everything above it as held. A reconnect asks
 * `since` the newest event held, and the relay answers newest first, cut at the limit (#254):
 * when the answer is cut, the bottom of its window was never sent, and that span sits above the
 * cursor where no page will ever look. Knowing it is what lets the feed ask for it.
 *
 * One span, not a list: two outages before the first gap closed become the span covering both,
 * and what lies between is asked for again and dropped by id.
 */
export type Gap = Readonly<{ since: number; until: number }>;

/** Where a feed is with its gap: nothing owed, being asked for, or given up on until the next
 * reconnect or the reader asks again — never retried on its own, since a relay that sits on a
 * REQ would be asked again and again. */
export type GapState = "none" | "filling" | "stalled";

export function gapState(gap: Gap | null, filling: boolean): GapState {
  if (gap === null) return "none";
  return filling ? "filling" : "stalled";
}

function oldest(events: readonly { created_at: number }[]): number {
  return events.reduce((min, event) => Math.min(min, event.created_at), Infinity);
}

/**
 * What an answer to a `since` REQ left unasked — a reconnect's, or a page asked for the gap
 * itself, which is asked newest first from its top. The relay sends fewer than the limit only when it
 * has run out, so a shorter answer covered its whole window. A cut one covered down to its oldest
 * event, and that second is owed again: `until` is inclusive and more may share it.
 *
 * Assumes no single second holds a whole answer's worth of events — the span below a cut answer
 * would otherwise start where it ends, and asking for it would bring the same page forever.
 */
export function gapLeftBy(since: number, answer: readonly { created_at: number }[], limit: number): Gap | null {
  if (answer.length < limit) return null;
  return { since, until: oldest(answer) };
}

export function mergeGaps(a: Gap | null, b: Gap | null): Gap | null {
  if (a === null) return b;
  if (b === null) return a;
  return { since: Math.min(a.since, b.since), until: Math.max(a.until, b.until) };
}

import type { Filter, VerifiedEvent } from "nostr-tools";
import type { FeedClient } from "./channelFeed";
import { PAGE_DEADLINE_MS } from "./channelPagination";
import type { Timer } from "./clock";
import { MAX_LIMIT } from "./relay";

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

function gapState(gap: Gap | null, filling: boolean): GapState {
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

/** A reconnect's answer to one `since` filter, watched until its EOSE says whether it was cut. */
interface ReconnectAnswer {
  readonly since: number;
  readonly limit: number;
  readonly kinds: readonly number[] | undefined;
  readonly events: Map<string, { created_at: number }>;
}

/**
 * What an answer left owed: at its EOSE, the part a cut would have left (`gapLeftBy`); dropped
 * before it, everything below the oldest it brought — which may be the newest held by now, and
 * the next `since` would start from it.
 */
function owedBy(answer: ReconnectAnswer | null, { dropped }: { dropped: boolean }): Gap | null {
  if (answer === null) return null;
  const events = [...answer.events.values()];
  if (!dropped) return gapLeftBy(answer.since, events, answer.limit);
  return events.length === 0 ? null : { since: answer.since, until: oldest(events) };
}

/**
 * One filter of a reconnecting subscription, and what its answers leave owed (#254): it watches
 * each reconnect's answer (`asking`, `heard`, `answered`), and asks for what a cut one left
 * unasked, newest first from the top of the gap, page after page until one comes back shorter
 * than it asked. A page is over once everything it brought is taken in — at once for a
 * Channel, once unwrapped for Direct Messages — and a deadline covers both the REQ and that, as
 * an older page's does (#232, #268). Overrunning it leaves the gap owed: `fill` again is the
 * reader's to ask for, or the next reconnect's, never a loop of its own.
 */
export class GapFiller {
  private gap: Gap | null = null;
  private filling = false;
  private close: (() => void) | null = null;
  private cancelDeadline: (() => void) | null = null;
  /** Bumped by `stop`: a page that settles for an earlier run decides nothing. */
  private run = 0;

  private answer: ReconnectAnswer | null = null;

  private readonly client: FeedClient;
  private readonly schedule: Timer;
  private readonly filtersFor: (gap: Gap) => Filter[];
  private readonly take: (event: VerifiedEvent) => Promise<void> | void;
  private readonly changed: () => void;

  constructor(options: {
    client: FeedClient;
    schedule: Timer;
    /** What to ask the relay for a gap. */
    filtersFor: (gap: Gap) => Filter[];
    /** Takes in what a page brought; the page is over once every promise returned settles. */
    take: (event: VerifiedEvent) => Promise<void> | void;
    changed: () => void;
  }) {
    this.client = options.client;
    this.schedule = options.schedule;
    this.filtersFor = options.filtersFor;
    this.take = options.take;
    this.changed = options.changed;
  }

  get state(): GapState {
    return gapState(this.gap, this.filling);
  }

  /** A reconnect is asking again with `filter`. An answer still unfinished was cut by the drop,
   * as surely as by the limit. A filter with no `since` is a first page asked again: nothing to
   * watch. */
  asking(filter: Filter): void {
    this.owe(owedBy(this.answer, { dropped: true }));
    this.answer =
      filter.since === undefined ? null : { since: filter.since, limit: filter.limit ?? MAX_LIMIT, kinds: filter.kinds, events: new Map() };
  }

  /** Counts an event toward the answer, if the filter asked for its kind. */
  heard(event: VerifiedEvent): void {
    if (this.answer === null || (this.answer.kinds !== undefined && !this.answer.kinds.includes(event.kind))) return;
    this.answer.events.set(event.id, event);
  }

  /** The subscription's EOSE: what a cut answer left is owed, and anything owed is asked for —
   * after a reconnect, or on a start over a gap an earlier run left. */
  answered(): void {
    this.owe(owedBy(this.answer, { dropped: false }));
    this.answer = null;
    this.fill();
  }

  private owe(gap: Gap | null): void {
    this.gap = mergeGaps(this.gap, gap);
  }

  fill = (): void => {
    if (this.gap === null || this.filling) return;
    const run = this.run;
    const gap = this.gap;
    const filters = this.filtersFor(gap);
    const page = new Map<string, VerifiedEvent>();
    const taking: Promise<void>[] = [];
    this.filling = true;
    this.changed();
    let finished = false;
    let eosed = false;
    const settle = () => {
      if (finished) return;
      finished = true;
      if (run !== this.run) return;
      this.cancelDeadline?.();
      this.cancelDeadline = null;
      this.filling = false;
      // A reconnect that widened the gap meanwhile makes this page only part of it: the whole gap
      // is asked for again, and what was already brought is dropped by id.
      if (this.gap === gap) this.gap = gapLeftBy(gap.since, [...page.values()], filters[0]?.limit ?? MAX_LIMIT);
      this.changed();
      this.fill();
    };
    const unsubscribe = this.client.subscribe(filters, {
      onEvent: (event) => {
        if (page.has(event.id)) return;
        page.set(event.id, event);
        const taken = this.take(event);
        if (taken) taking.push(taken);
      },
      onEose: () => {
        if (finished || eosed) return;
        eosed = true;
        this.close?.();
        this.close = null;
        if (taking.length === 0) settle();
        else void Promise.all(taking).then(settle);
      },
    });
    // A relay that answers within subscribe() has already closed the page's REQ — and, with
    // nothing to wait on, settled it and maybe the next, whose REQ and deadline are theirs.
    if (eosed) unsubscribe();
    else this.close = unsubscribe;
    if (finished) return;
    this.cancelDeadline = this.schedule(() => {
      if (finished) return;
      finished = true;
      this.close?.();
      this.close = this.cancelDeadline = null;
      this.filling = false;
      this.changed();
    }, PAGE_DEADLINE_MS);
  };

  /** Closes the page in flight, keeping what is owed for the next start — including the rest of
   * an answer the stop cut short. */
  stop(): void {
    this.owe(owedBy(this.answer, { dropped: true }));
    this.answer = null;
    this.run += 1;
    this.close?.();
    this.cancelDeadline?.();
    this.close = this.cancelDeadline = null;
    this.filling = false;
  }
}

/** One state for a feed that owes more than one gap: asking while any is being asked for. */
export function combinedGapState(states: readonly GapState[]): GapState {
  if (states.includes("filling")) return "filling";
  return states.includes("stalled") ? "stalled" : "none";
}

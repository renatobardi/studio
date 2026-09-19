import type { Filter, VerifiedEvent } from "nostr-tools";

function matches(event: VerifiedEvent, filter: Filter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, wanted] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const name = key.slice(1);
    const values = wanted as string[];
    if (!event.tags.some((tag) => tag[0] === name && values.includes(tag[1]))) return false;
  }
  return true;
}

/** The relay's per-filter ceiling (MAX_LIMIT in api/src/studio_api/nostr/limits.py). */
export const MAX_LIMIT = 500;

/** Stands in for the relay: the same newest-first, id-broken order, inclusive `until` and
 * clamped `limit` that `build_query` in api/src/studio_api/nostr/store.py runs (ADR-0004), and
 * subscriptions that stay open for whatever is published next. */
export class FakeRelay {
  readonly requests: Filter[][] = [];
  private open: { filters: Filter[]; onEvent: (event: VerifiedEvent) => void }[] = [];

  private stored: VerifiedEvent[];

  constructor(stored: VerifiedEvent[]) {
    this.stored = stored;
  }

  subscribe(filters: Filter[], handlers: { onEvent(event: VerifiedEvent): void; onEose?(): void }) {
    this.requests.push(filters);
    const entry = { filters, onEvent: handlers.onEvent };
    this.open.push(entry);
    const deliver = (fs: Filter[]) => {
      for (const filter of fs) {
        const page = this.stored
          .filter((event) => matches(event, filter))
          .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
          .slice(0, Math.min(filter.limit ?? MAX_LIMIT, MAX_LIMIT));
        for (const event of page) handlers.onEvent(event);
      }
      handlers.onEose?.();
    };
    deliver(filters);
    const unsubscribe = () => {
      this.open = this.open.filter((candidate) => candidate !== entry);
    };
    return Object.assign(unsubscribe, {
      update: (next: Filter[]) => {
        entry.filters = next;
        deliver(next);
      },
    });
  }

  /** A live event reaching every open subscription that asked for it. */
  publish(event: VerifiedEvent): void {
    this.stored.push(event);
    for (const entry of this.open) {
      if (entry.filters.some((filter) => matches(event, filter))) entry.onEvent(event);
    }
  }

  /** What was ever asked for, across every subscribe call, as a flat list of filters. */
  get allFilters(): Filter[] {
    return this.requests.flat();
  }

  /** What every open subscription is currently asking for, after any `update()` calls. */
  get openFilters(): Filter[] {
    return this.open.flatMap((entry) => entry.filters);
  }
}

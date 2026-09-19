/** Nostr stamps events in whole seconds since the epoch (NIP-01), so everything that compares
 * against `created_at` — unread marks, "12m ago" — reads the clock through here. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Schedules `fn` for `ms` from now and hands back the cancel. Injected wherever a deadline has
 * to be a rule a test can move rather than a wait it has to sit through. */
export type Timer = (fn: () => void, ms: number) => () => void;

export const timer: Timer = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

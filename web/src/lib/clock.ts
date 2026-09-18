/** Nostr stamps events in whole seconds since the epoch (NIP-01), so everything that compares
 * against `created_at` — unread marks, "12m ago" — reads the clock through here. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

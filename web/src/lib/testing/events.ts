import { verifiedSymbol, type Event, type VerifiedEvent } from "nostr-tools";

/**
 * A fixture event carrying the brand `verifyEvent` puts on one it has checked.
 *
 * Tests build events by hand, and `as unknown as VerifiedEvent` would take any shape at all —
 * the opposite of what type-checking the tests is for (#191, #238). This asks for a whole
 * `Event` and adds only the brand.
 */
export function verifiedEvent(event: Event): VerifiedEvent {
  return { ...event, [verifiedSymbol]: true };
}

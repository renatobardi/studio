import type { VerifiedEvent } from "nostr-tools";
import { publishFailureMessage } from "./relayReasons";

/** A Direct Message whose gift wraps are signed but not all accepted yet (#106): one wrap per
 * participant plus the sender's own copy. The wraps are kept, not rebuilt — a new rumor on retry
 * would reach whoever already got the first one as a second Message. */
export interface PendingDm {
  wraps: VerifiedEvent[];
  /** Ids of the wraps the relay has accepted. */
  delivered: ReadonlySet<string>;
  /** Why the last attempt left wraps undelivered; null once none are. */
  failure: unknown;
}

export function pendingDm(wraps: VerifiedEvent[]): PendingDm {
  return { wraps, delivered: new Set(), failure: null };
}

/** The relay already holding a wrap is a lost OK, not a refusal: its recipient has it. */
function alreadyStored(reason: unknown): boolean {
  return reason instanceof Error && reason.message.trim().startsWith("duplicate:");
}

/** Publishes the wraps not yet delivered, each on its own — one refused wrap no longer hides that
 * the others went out. */
export async function deliverPending(
  pending: PendingDm,
  publish: (wrap: VerifiedEvent) => Promise<void>,
): Promise<PendingDm> {
  const outstanding = pending.wraps.filter((wrap) => !pending.delivered.has(wrap.id));
  const results = await Promise.allSettled(outstanding.map((wrap) => publish(wrap)));
  const delivered = new Set(pending.delivered);
  let failure: unknown = null;
  results.forEach((result, index) => {
    if (result.status === "fulfilled" || alreadyStored(result.reason)) delivered.add(outstanding[index].id);
    else failure ??= result.reason;
  });
  return { wraps: pending.wraps, delivered, failure };
}

export function isDelivered(pending: PendingDm): boolean {
  return pending.delivered.size === pending.wraps.length;
}

export function partialDeliveryMessage(pending: PendingDm): string {
  return `Sent ${pending.delivered.size} of ${pending.wraps.length} copies. ${publishFailureMessage(pending.failure)} Retry sends only the rest.`;
}

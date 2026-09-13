import type { VerifiedEvent } from "nostr-tools";
import { isAlreadyStored, publishFailureMessage } from "./relayReasons";

/** A Direct Message whose gift wraps are signed but not all accepted yet (#106): one wrap per
 * recipient plus the sender's own copy. The wraps are kept, not rebuilt — a new rumor on retry
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
    if (result.status === "fulfilled" || isAlreadyStored(result.reason)) delivered.add(outstanding[index].id);
    else failure ??= result.reason;
  });
  return { wraps: pending.wraps, delivered, failure };
}

/** `partial` is the one that locks the composer: someone already has this Message, so only the
 * same wraps may follow. `undelivered` leaves it free — nobody has anything to contradict. */
export function deliveryOutcome(pending: PendingDm): "delivered" | "undelivered" | "partial" {
  if (pending.delivered.size === pending.wraps.length) return "delivered";
  return pending.delivered.size === 0 ? "undelivered" : "partial";
}

const recipientOf = (wrap: VerifiedEvent) => wrap.tags.find((tag) => tag[0] === "p")?.[1];

export function partialDeliveryMessage(pending: PendingDm, senderPubkey: string): string {
  const recipients = pending.wraps.filter((wrap) => recipientOf(wrap) !== senderPubkey);
  const reached = recipients.filter((wrap) => pending.delivered.has(wrap.id)).length;
  const ownCopy = pending.wraps.find((wrap) => recipientOf(wrap) === senderPubkey);
  const ownCopyLost = ownCopy !== undefined && !pending.delivered.has(ownCopy.id);
  const progress = `Delivered to ${reached} of ${recipients.length} recipients${ownCopyLost ? ", but not your own copy for your other devices" : ""}.`;
  return `${progress} ${publishFailureMessage(pending.failure)} Retry sends only the rest; Discard lets you edit it as a new Message.`;
}

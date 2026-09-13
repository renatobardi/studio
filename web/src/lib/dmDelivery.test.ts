import { describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { deliverPending, deliveryOutcome, partialDeliveryMessage, pendingDm } from "./dmDelivery";

const alice = getPublicKey(generateSecretKey());
const bob = getPublicKey(generateSecretKey());
const carol = getPublicKey(generateSecretKey());

/** A relay that refuses the wraps addressed to `refused` until told otherwise, and counts every
 * wrap it was handed per recipient. */
function flakyRelay(refused: Set<string>, reason = "error: could not store the event") {
  const published = new Map<string, number>();
  const publish = async (wrap: { tags: string[][] }) => {
    const recipient = wrap.tags.find((t) => t[0] === "p")![1];
    published.set(recipient, (published.get(recipient) ?? 0) + 1);
    if (refused.has(recipient)) throw new Error(reason);
  };
  return { published, publish };
}

/** One wrap per participant plus the sender's copy, as `wrapDmMessage` makes them — only the `p` tag matters here. */
function wraps() {
  return [bob, carol, alice].map((recipient) =>
    finalizeEvent({ kind: 1059, content: "sealed", created_at: 1, tags: [["p", recipient]] }, generateSecretKey()),
  );
}

describe("delivering a Direct Message's gift wraps (#106)", () => {
  test("a retry after a partial failure publishes only the wraps that failed — the same rumor, once more each", async () => {
    const refused = new Set([carol]);
    const relay = flakyRelay(refused);

    const first = await deliverPending(pendingDm(wraps()), relay.publish);
    expect(deliveryOutcome(first)).toBe("partial");

    refused.clear();
    const retried = await deliverPending(first, relay.publish);

    expect(deliveryOutcome(retried)).toBe("delivered");
    expect(relay.published.get(bob)).toBe(1);
    expect(relay.published.get(alice)).toBe(1);
    expect(relay.published.get(carol)).toBe(2);
    expect(retried.wraps).toEqual(first.wraps);
  });

  test("a wrap the relay already has counts as delivered — its OK came back lost, not refused", async () => {
    const relay = flakyRelay(new Set([bob]), "duplicate: already have this event");

    const delivered = await deliverPending(pendingDm(wraps()), relay.publish);

    expect(deliveryOutcome(delivered)).toBe("delivered");
  });

  test("the sender's own copy failing leaves the Message partly delivered — it is how they see it elsewhere (#40)", async () => {
    const relay = flakyRelay(new Set([alice]));

    const attempt = await deliverPending(pendingDm(wraps()), relay.publish);

    expect(deliveryOutcome(attempt)).toBe("partial");
    expect(attempt.delivered.size).toBe(2);
  });


  test("nothing accepted is not a partial delivery — nobody has the Message, so the composer is free again", async () => {
    const relay = flakyRelay(new Set([bob, carol, alice]));

    expect(deliveryOutcome(await deliverPending(pendingDm(wraps()), relay.publish))).toBe("undelivered");
  });

  test("a partial delivery counts recipients, not wraps, and says why the rest failed and what the way out is", async () => {
    const relay = flakyRelay(new Set([carol]), "restricted: not a member of this workspace");

    const attempt = await deliverPending(pendingDm(wraps()), relay.publish);

    expect(partialDeliveryMessage(attempt, alice)).toBe(
      "Delivered to 1 of 2 recipients. The Workspace refused this request: not a member of this workspace. Retry sends only the rest; Discard lets you edit it as a new Message.",
    );
  });

  test("a lost own copy is named — it is how the sender sees the Message on their other devices (#40)", async () => {
    const relay = flakyRelay(new Set([alice]));

    const attempt = await deliverPending(pendingDm(wraps()), relay.publish);

    expect(partialDeliveryMessage(attempt, alice)).toStartWith(
      "Delivered to 2 of 2 recipients, but not your own copy for your other devices.",
    );
  });
});

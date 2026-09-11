import { describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from "nostr-tools";
import {
  buildMessage,
  buildReaction,
  buildReactionRemoval,
  buildThreadReply,
  countThreadReplies,
  groupReactions,
} from "./channelEvents";

function sign(template: { kind: number; tags: string[][]; content: string }, secretKey: Uint8Array): VerifiedEvent {
  return finalizeEvent({ ...template, created_at: Math.floor(Date.now() / 1000) }, secretKey);
}

describe("buildMessage", () => {
  test("kind 9 with an h tag for the channel", () => {
    const template = buildMessage("chan1", "hello");
    expect(template.kind).toBe(9);
    expect(template.content).toBe("hello");
    expect(template.tags).toEqual([["h", "chan1"]]);
  });
});

describe("buildThreadReply", () => {
  test("kind 1111 with e/k/p mirroring E/K/P on the root", () => {
    const template = buildThreadReply("chan1", { id: "root1", kind: 9, pubkey: "author1" }, "nice");
    expect(template.kind).toBe(1111);
    expect(template.content).toBe("nice");
    expect(template.tags).toEqual([
      ["h", "chan1"],
      ["E", "root1"], ["K", "9"], ["P", "author1"],
      ["e", "root1"], ["k", "9"], ["p", "author1"],
    ]);
  });
});

describe("buildReaction", () => {
  test("kind 7 tagging the target message", () => {
    const template = buildReaction("chan1", { id: "msg1", kind: 9, pubkey: "author1" }, "🔥");
    expect(template.kind).toBe(7);
    expect(template.content).toBe("🔥");
    expect(template.tags).toEqual([
      ["h", "chan1"],
      ["e", "msg1"], ["k", "9"], ["p", "author1"],
    ]);
  });
});

describe("buildReactionRemoval", () => {
  test("kind 5 tagging the reaction event to delete", () => {
    const template = buildReactionRemoval("chan1", "reaction1");
    expect(template.kind).toBe(5);
    expect(template.tags).toEqual([["h", "chan1"], ["e", "reaction1"]]);
  });
});

describe("groupReactions", () => {
  test("groups by emoji with reactor pubkeys", () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const alicePubkey = getPublicKey(alice);
    const bobPubkey = getPublicKey(bob);
    const r1 = sign({ kind: 7, tags: [["e", "msg1"]], content: "🔥" }, alice);
    const r2 = sign({ kind: 7, tags: [["e", "msg1"]], content: "🔥" }, bob);
    const r3 = sign({ kind: 7, tags: [["e", "msg1"]], content: "👍" }, alice);

    const groups = groupReactions([r1, r2, r3], []);

    expect(groups).toEqual([
      { emoji: "🔥", count: 2, reactorPubkeys: [alicePubkey, bobPubkey] },
      { emoji: "👍", count: 1, reactorPubkeys: [alicePubkey] },
    ]);
  });

  test("excludes a reaction removed by its own author's kind 5", () => {
    const alice = generateSecretKey();
    const reaction = sign({ kind: 7, tags: [["e", "msg1"]], content: "🔥" }, alice);
    const removal = sign({ kind: 5, tags: [["e", reaction.id]], content: "" }, alice);

    const groups = groupReactions([reaction], [removal]);

    expect(groups).toEqual([]);
  });

  test("ignores a deletion from a different author than the reaction", () => {
    const alice = generateSecretKey();
    const alicePubkey = getPublicKey(alice);
    const mallory = generateSecretKey();
    const reaction = sign({ kind: 7, tags: [["e", "msg1"]], content: "🔥" }, alice);
    const removal = sign({ kind: 5, tags: [["e", reaction.id]], content: "" }, mallory);

    const groups = groupReactions([reaction], [removal]);

    expect(groups).toEqual([{ emoji: "🔥", count: 1, reactorPubkeys: [alicePubkey] }]);
  });
});

describe("countThreadReplies", () => {
  test("counts kind 1111 events whose E tag matches the root", () => {
    const sk = generateSecretKey();
    const reply1 = sign({ kind: 1111, tags: [["E", "root1"]], content: "a" }, sk);
    const reply2 = sign({ kind: 1111, tags: [["E", "root1"]], content: "b" }, sk);
    const otherRoot = sign({ kind: 1111, tags: [["E", "root2"]], content: "c" }, sk);

    expect(countThreadReplies([reply1, reply2, otherRoot], "root1")).toBe(2);
  });
});

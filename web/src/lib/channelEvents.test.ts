import { describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from "nostr-tools";
import {
  buildMessage,
  buildReaction,
  buildReactionRemoval,
  buildThreadReply,
  groupReactions,
  summarizeThread,
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

  test("appends imeta tags for attached images after the h tag", () => {
    const imeta = ["imeta", "url https://x/1", "m image/jpeg", "x " + "a".repeat(64)];
    const template = buildMessage("chan1", "look", [imeta]);
    expect(template.tags).toEqual([["h", "chan1"], imeta]);
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

describe("summarizeThread", () => {
  const at = (author: Uint8Array, root: string, createdAt: number) =>
    finalizeEvent({ kind: 1111, tags: [["E", root]], content: "r", created_at: createdAt }, author);

  test("counts kind 1111 events whose E tag matches the root", () => {
    const sk = generateSecretKey();
    const replies = [at(sk, "root1", 10), at(sk, "root1", 20), at(sk, "root2", 30)];

    expect(summarizeThread(replies, "root1").count).toBe(2);
  });

  test("with no replies there is nothing to summarise", () => {
    expect(summarizeThread([], "root1")).toEqual({ count: 0, participantPubkeys: [], lastReplyAt: null });
  });

  test("participants are distinct, latest reply first, at most three; lastReplyAt is the newest reply", () => {
    const [ana, sprig, tomas, marina] = [0, 1, 2, 3].map(() => generateSecretKey());
    const replies = [
      at(marina!, "root1", 5),
      at(ana!, "root1", 20),
      at(sprig!, "root1", 21),
      at(ana!, "root1", 48),
      at(tomas!, "root1", 34),
    ];

    expect(summarizeThread(replies, "root1")).toEqual({
      count: 5,
      participantPubkeys: [getPublicKey(ana!), getPublicKey(tomas!), getPublicKey(sprig!)],
      lastReplyAt: 48,
    });
  });
});

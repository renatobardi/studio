import { describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from "nostr-tools";
import {
  buildMessage,
  buildReaction,
  buildReactionRemoval,
  buildThreadReply,
  groupReactions,
  messageIndex,
  summarizeThread,
  type TargetRef,
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

  test("participants are distinct, latest reply first; lastReplyAt is the newest reply", () => {
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
      participantPubkeys: [getPublicKey(ana!), getPublicKey(tomas!), getPublicKey(sprig!), getPublicKey(marina!)],
      lastReplyAt: 48,
    });
  });
});

/** What each Message of a timeline carries, built once per change of the Channel's data rather than
 * once per Message per render (#194) — the same answer `groupReactions` and `summarizeThread` give
 * Message by Message. */
describe("messageIndex", () => {
  const alice = generateSecretKey();
  const bob = generateSecretKey();
  const target = (id: string): TargetRef => ({ id, kind: 9, pubkey: getPublicKey(alice) });
  const at = (template: { kind: number; tags: string[][]; content: string }, secretKey: Uint8Array, createdAt: number) =>
    finalizeEvent({ ...template, created_at: createdAt }, secretKey);

  const m1 = "1".repeat(64);
  const m2 = "2".repeat(64);
  const r1 = at(buildReaction("c", target(m1), "👍"), alice, 10);
  const r2 = at(buildReaction("c", target(m1), "👍"), bob, 11);
  const r3 = at(buildReaction("c", target(m2), "🎉"), bob, 12);
  const removeR2 = at(buildReactionRemoval("c", r2.id), bob, 13);
  const unrelatedRemoval = at(buildReactionRemoval("c", "f".repeat(64)), bob, 14);
  const reply1 = at(buildThreadReply("c", target(m1), "first"), bob, 20);
  const reply2 = at(buildThreadReply("c", target(m1), "second"), alice, 30);
  const data = { reactions: [r1, r2, r3], deletions: [removeR2, unrelatedRemoval], replies: [reply1, reply2] };

  test("gives each Message what groupReactions and summarizeThread give it one by one", () => {
    const lookup = messageIndex(data);
    for (const id of [m1, m2]) {
      const own = data.reactions.filter((r) => r.tags.find((t) => t[0] === "e")?.[1] === id);
      const ownDeletions = data.deletions.filter((d) => d.tags.some((t) => t[0] === "e" && own.some((r) => r.id === t[1])));
      expect(lookup(id)).toEqual({ reactions: groupReactions(own, ownDeletions), thread: summarizeThread(data.replies, id) });
    }
  });

  test("a removed Reaction no longer counts, and a removal of nothing on screen changes nothing", () => {
    expect(messageIndex(data)(m1).reactions).toEqual([{ emoji: "👍", count: 1, reactorPubkeys: [getPublicKey(alice)] }]);
  });

  test("a removal signed by someone else takes nobody's Reaction away", () => {
    const forged = at(buildReactionRemoval("c", r1.id), bob, 15);
    const lookup = messageIndex({ ...data, deletions: [forged] });
    expect(lookup(m1).reactions).toEqual([{ emoji: "👍", count: 2, reactorPubkeys: [getPublicKey(alice), getPublicKey(bob)] }]);
  });

  test("a Reply counts only for the root it names", () => {
    const toM2 = at(buildThreadReply("c", target(m2), "other root"), alice, 40);
    const lookup = messageIndex({ ...data, replies: [...data.replies, toM2] });
    expect(lookup(m1).thread.count).toBe(2);
    expect(lookup(m2).thread).toEqual({ count: 1, participantPubkeys: [getPublicKey(alice)], lastReplyAt: 40 });
  });

  test("a Message nothing points at has no Reactions and no Thread", () => {
    expect(messageIndex(data)("9".repeat(64))).toEqual({
      reactions: [],
      thread: { count: 0, participantPubkeys: [], lastReplyAt: null },
    });
  });
});

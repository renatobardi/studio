import { describe, expect, test } from "bun:test";
import { finalizeEvent, getPublicKey, type VerifiedEvent } from "nostr-tools";
import {
  CHANNEL_SCRIPT,
  DM_SCRIPT,
  PROFILES,
  dmRumors,
  findMessage,
  findReaction,
  findReply,
  fixtureSecretKey,
  missingRumors,
  type Cast,
} from "./seed-fixtures-lib";

/** Issue #157: flow 11's Channel and Direct Message, seeded into studio-test as often as CD
 * runs — so every lookup must find what an earlier run published instead of publishing it again. */

const OWNER = "11".repeat(32);
const keyOf = (seed: string) => Uint8Array.from(Buffer.from(seed.repeat(32), "hex"));
const keys = { ada: keyOf("a1"), bruno: keyOf("b2"), me: keyOf("c3") };
const cast: Cast = {
  ada: getPublicKey(keys.ada),
  bruno: getPublicKey(keys.bruno),
  me: getPublicKey(keys.me),
};
const CHANNEL = "channel-1";
const sign = (who: keyof typeof keys, kind: number, tags: string[][], content: string): VerifiedEvent =>
  finalizeEvent({ kind, tags, content, created_at: 1_789_394_400 }, keys[who]);

describe("fixtureSecretKey", () => {
  test("is the same key every run, and a different one per fixture Identity", () => {
    expect(fixtureSecretKey(OWNER, "ada")).toEqual(fixtureSecretKey(OWNER, "ada"));
    expect(fixtureSecretKey(OWNER, "ada")).not.toEqual(fixtureSecretKey(OWNER, "bruno"));
  });

  test("cannot be derived without the owner key", () => {
    expect(fixtureSecretKey(OWNER, "ada")).not.toEqual(fixtureSecretKey("22".repeat(32), "ada"));
  });
});

describe("the scripts", () => {
  test("give the Channel a thread with replies and reactions", () => {
    expect(CHANNEL_SCRIPT.messages.length).toBeGreaterThanOrEqual(4);
    expect(CHANNEL_SCRIPT.thread.replies.length).toBeGreaterThanOrEqual(2);
    expect(CHANNEL_SCRIPT.reactions.length).toBeGreaterThanOrEqual(2);
  });

  test("give every author a profile the app can show, as onboarding would have published it", () => {
    const authors = [
      ...CHANNEL_SCRIPT.messages.map((line) => line.from),
      ...CHANNEL_SCRIPT.thread.replies.map((line) => line.from),
      ...CHANNEL_SCRIPT.reactions.map((reaction) => reaction.from),
      ...DM_SCRIPT.map((line) => line.from),
    ];
    for (const author of new Set(authors)) {
      expect(PROFILES[author].name).not.toBe("");
      expect(PROFILES[author].picture).not.toBe("");
    }
  });

  test("give the Direct Message a history from both sides", () => {
    expect(new Set(DM_SCRIPT.map((line) => line.from))).toEqual(new Set(["ada", "me"]));
  });
});

describe("findMessage", () => {
  const events = [sign("ada", 9, [["h", CHANNEL]], "hello"), sign("bruno", 9, [["h", CHANNEL]], "hello")];

  test("finds the Message its author already published", () => {
    expect(findMessage(events, cast.bruno, "hello")?.id).toBe(events[1].id);
  });

  test("does not take the same words from another author", () => {
    expect(findMessage(events, cast.me, "hello")).toBeUndefined();
  });
});

describe("findReply", () => {
  const root = sign("ada", 9, [["h", CHANNEL]], "root");
  const other = sign("ada", 9, [["h", CHANNEL]], "other");
  const reply = sign("bruno", 1111, [["h", CHANNEL], ["E", root.id], ["e", root.id]], "yes");

  test("finds a reply under its root", () => {
    expect(findReply([root, reply], root.id, cast.bruno, "yes")?.id).toBe(reply.id);
  });

  test("does not take the same reply under another root", () => {
    expect(findReply([root, reply], other.id, cast.bruno, "yes")).toBeUndefined();
  });
});

describe("findReaction", () => {
  const target = sign("ada", 9, [["h", CHANNEL]], "root");
  const reaction = sign("me", 7, [["h", CHANNEL], ["e", target.id]], "👍");

  test("finds the reactor's emoji on its target", () => {
    expect(findReaction([reaction], target.id, cast.me, "👍")?.id).toBe(reaction.id);
  });

  test("another emoji, or another reactor, is still missing", () => {
    expect(findReaction([reaction], target.id, cast.me, "✅")).toBeUndefined();
    expect(findReaction([reaction], target.id, cast.ada, "👍")).toBeUndefined();
  });
});

describe("dmRumors", () => {
  test("are the same events every run, so a second wrap adds no second copy", () => {
    const first = dmRumors(cast);
    expect(dmRumors(cast).map((rumor) => rumor.id)).toEqual(first.map((rumor) => rumor.id));
  });

  test("follow the script, in order, each addressed to the other party", () => {
    const rumors = dmRumors(cast);
    expect(rumors.map((rumor) => rumor.content)).toEqual(DM_SCRIPT.map((line) => line.text));
    for (const rumor of rumors) {
      const other = rumor.pubkey === cast.ada ? cast.me : cast.ada;
      expect(rumor.kind).toBe(14);
      expect(rumor.tags).toEqual([["p", other]]);
    }
    const times = rumors.map((rumor) => rumor.created_at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });
});

describe("missingRumors", () => {
  test("is every rumor the reader's newest page does not carry", () => {
    const rumors = dmRumors(cast);
    expect(missingRumors(rumors, new Set([rumors[0].id]))).toEqual(rumors.slice(1));
    expect(missingRumors(rumors, new Set(rumors.map((rumor) => rumor.id)))).toEqual([]);
  });
});

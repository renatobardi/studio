import { describe, expect, test } from "bun:test";
import { groupConversations } from "./conversations";
import { buildDmRumor } from "./nip17";

const ME = "1".repeat(64);
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

function rumorAt(sender: string, participants: string[], content: string, createdAt: number) {
  return { ...buildDmRumor(sender, participants, content), created_at: createdAt };
}

describe("groupConversations", () => {
  test("groups messages by full participant set regardless of who sent which", () => {
    const fromMe = rumorAt(ME, [ALICE], "hi alice", 100);
    const fromAlice = rumorAt(ALICE, [ME], "hi back", 200);

    const conversations = groupConversations([fromMe, fromAlice], ME);

    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages).toHaveLength(2);
    expect(conversations[0].peerPubkeys).toEqual([ALICE]);
  });

  test("separates conversations with different participant sets", () => {
    const withAlice = rumorAt(ME, [ALICE], "hi alice", 100);
    const withBob = rumorAt(ME, [BOB], "hi bob", 100);

    const conversations = groupConversations([withAlice, withBob], ME);

    expect(conversations).toHaveLength(2);
  });

  test("orders messages within a conversation oldest first", () => {
    const second = rumorAt(ME, [ALICE], "second", 200);
    const first = rumorAt(ALICE, [ME], "first", 100);

    const [conversation] = groupConversations([second, first], ME);

    expect(conversation.messages.map((m) => m.content)).toEqual(["first", "second"]);
  });

  test("latest is the most recent message", () => {
    const older = rumorAt(ME, [ALICE], "older", 100);
    const newer = rumorAt(ALICE, [ME], "newer", 200);

    const [conversation] = groupConversations([older, newer], ME);

    expect(conversation.latest.content).toBe("newer");
  });

  test("orders conversations by their latest message, most recent first", () => {
    const aliceRumor = rumorAt(ME, [ALICE], "old", 100);
    const bobRumor = rumorAt(ME, [BOB], "new", 200);

    const conversations = groupConversations([aliceRumor, bobRumor], ME);

    expect(conversations.map((c) => c.peerPubkeys)).toEqual([[BOB], [ALICE]]);
  });

  test("a group DM's peerPubkeys excludes only the caller", () => {
    const rumor = rumorAt(ME, [ALICE, BOB], "group hi", 100);

    const [conversation] = groupConversations([rumor], ME);

    expect(conversation.peerPubkeys.sort()).toEqual([ALICE, BOB].sort());
  });
});

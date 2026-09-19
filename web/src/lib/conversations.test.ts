import { describe, expect, test } from "bun:test";
import { directMessages, groupConversations } from "./conversations";
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

/** What the shell needs to draw Direct messages (#142): the sidebar rows, the open conversation,
 * and every pubkey those two want a name for. */
describe("directMessages", () => {
  const SPRIG = "5".repeat(64);
  const members = [
    { pubkey: ME, role: "owner" },
    { pubkey: ALICE, role: "member" },
    { pubkey: SPRIG, role: "agent" },
  ];
  const nameOf = (pubkey: string) => ({ [ALICE]: "Ana Petrova", [BOB]: "Bob", [SPRIG]: "Sprig" })[pubkey] ?? pubkey;
  const view = (over: Partial<Parameters<typeof directMessages>[0]> = {}) =>
    directMessages({
      rumors: [rumorAt(ALICE, [ME], "hi", 200)],
      myPubkey: ME,
      members,
      selectedPeerPubkeys: null,
      readState: { since: 100, readAt: {} },
      completeFrom: -Infinity,
      nameOf,
      ...over,
    });

  test("a row per conversation, named after its other participants", () => {
    expect(view().rows.map((row) => [row.label, row.icon, row.unreadCount])).toEqual([["Ana Petrova", "user", 1]]);
  });

  test("a conversation with an Agent carries the Agent's glyph", () => {
    const rows = view({ rumors: [rumorAt(SPRIG, [ME], "on it", 200)] }).rows;
    expect(rows.map((row) => row.icon)).toEqual(["bot"]);
  });

  test("a group conversation is never an Agent's, whoever is in it", () => {
    const rows = view({ rumors: [rumorAt(SPRIG, [ME, ALICE], "hello both", 200)] }).rows;
    expect(rows.map((row) => row.icon)).toEqual(["user"]);
  });

  test("nothing is counted unread before the marks were read back", () => {
    expect(view({ readState: null }).rows.map((row) => row.unreadCount)).toEqual([null]);
  });

  test("counts unread only where the history is complete, and still lists the conversation (#185)", () => {
    const rumors = [rumorAt(ALICE, [ME], "maybe missing siblings", 200), rumorAt(ALICE, [ME], "complete", 300)];
    expect(view({ rumors, completeFrom: 250 }).rows.map((row) => row.unreadCount)).toEqual([1]);
    expect(view({ rumors: rumors.slice(0, 1), completeFrom: 250 }).rows.map((row) => [row.label, row.unreadCount])).toEqual([
      ["Ana Petrova", null],
    ]);
  });

  test("the picked Members name the open conversation, even before it has any Message", () => {
    const picked = view({ selectedPeerPubkeys: [BOB] });
    expect(picked.selectedKey).toBe([BOB, ME].sort().join(","));
    expect(picked.selected).toBeNull();
  });

  test("the open conversation is the one the picked Members are already talking in", () => {
    expect(view({ selectedPeerPubkeys: [ALICE] }).selected?.messages).toHaveLength(1);
  });

  test("every Member and every correspondent needs a name, each asked for once", () => {
    expect(view().namedPubkeys.sort()).toEqual([ME, ALICE, SPRIG].sort());
  });

  test("before the own pubkey is known there are no conversations, but Members still need names", () => {
    const unknown = view({ myPubkey: null });
    expect(unknown.rows).toEqual([]);
    expect(unknown.selectedKey).toBeNull();
    expect(unknown.namedPubkeys).toEqual([ME, ALICE, SPRIG]);
  });
});

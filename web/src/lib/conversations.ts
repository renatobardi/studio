import type { WorkspaceMemberOut } from "./api";
import { conversationKey, type Rumor } from "./nip17";
import { unreadConversationCounts, type DmReadState } from "./unread";

export interface Conversation {
  key: string;
  /** Every other participant besides the caller — a DM with 3+ people has more than one. */
  peerPubkeys: string[];
  /** Every rumor in this conversation, oldest first. */
  messages: Rumor[];
  latest: Rumor;
}

function participantsOf(rumor: Rumor): string[] {
  return [rumor.pubkey, ...rumor.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1])];
}

/** Groups decrypted Direct Message rumors into conversations by their full participant set
 * (ticket #7) — a DM between the same people always lands in one conversation regardless of
 * who sent which message, and regardless of message order. Newest conversation first. */
export function groupConversations(rumors: Rumor[], myPubkey: string): Conversation[] {
  const byKey = new Map<string, Rumor[]>();
  for (const rumor of rumors) {
    const key = conversationKey(participantsOf(rumor));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(rumor);
  }

  const conversations = [...byKey.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.created_at - b.created_at);
    const peerPubkeys = participantsOf(sorted[0]).filter((pubkey) => pubkey !== myPubkey);
    return { key, peerPubkeys, messages: sorted, latest: sorted.at(-1)! };
  });
  return conversations.sort((a, b) => b.latest.created_at - a.latest.created_at);
}

/** One Direct message row of the sidebar (#142): who it is with, and what is still unread. */
export interface ConversationRow {
  key: string;
  peerPubkeys: string[];
  label: string;
  /** The prototype's two glyphs: a person, or an Agent. */
  icon: "user" | "bot";
  unreadCount: number | null;
}

export interface DirectMessages {
  rows: ConversationRow[];
  /** The open conversation's key — known from the picked participants alone, so it is there
   * from the moment a Member is picked, before any Message exists. */
  selectedKey: string | null;
  /** The open conversation, or null while it has no Messages yet. */
  selected: Conversation | null;
  /** Every pubkey the rows and the Member picker want a kind 0 name for, each once. */
  namedPubkeys: string[];
}

/** Everything the shell draws Direct messages from (#142), out of what the relay delivered: the
 * sidebar rows newest first, which conversation is open, and whose names are needed. */
export function directMessages({
  rumors,
  myPubkey,
  members,
  selectedPeerPubkeys,
  readState,
  completeFrom,
  nameOf,
}: {
  rumors: Rumor[];
  myPubkey: string | null;
  members: readonly WorkspaceMemberOut[];
  selectedPeerPubkeys: string[] | null;
  /** Null until the stored marks are read back — until then nothing is counted unread. */
  readState: DmReadState | null;
  /** Where the history held is complete (#185): below it a Message may have unread siblings not
   * paged in yet, so it is listed but never counted. */
  completeFrom: number;
  nameOf: (pubkey: string) => string;
}): DirectMessages {
  const memberPubkeys = members.map((member) => member.pubkey);
  if (myPubkey === null) return { rows: [], selectedKey: null, selected: null, namedPubkeys: memberPubkeys };

  const conversations = groupConversations(rumors, myPubkey);
  const complete = conversations.map(({ key, messages }) => ({
    key,
    messages: messages.filter((message) => message.created_at >= completeFrom),
  }));
  const counts = readState ? unreadConversationCounts(complete, readState, myPubkey) : new Map<string, number>();
  const agents = new Set(members.filter((member) => member.role === "agent").map((member) => member.pubkey));
  const selectedKey = selectedPeerPubkeys ? conversationKey([...selectedPeerPubkeys, myPubkey]) : null;

  return {
    rows: conversations.map(({ key, peerPubkeys }) => ({
      key,
      peerPubkeys,
      label: peerPubkeys.map(nameOf).join(", "),
      icon: peerPubkeys.length === 1 && agents.has(peerPubkeys[0]!) ? "bot" : "user",
      unreadCount: counts.get(key) ?? null,
    })),
    selectedKey,
    selected: conversations.find((conversation) => conversation.key === selectedKey) ?? null,
    namedPubkeys: [...new Set([...memberPubkeys, ...conversations.flatMap((c) => c.peerPubkeys)])],
  };
}

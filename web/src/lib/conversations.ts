import { conversationKey, type Rumor } from "./nip17";

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
    return { key, peerPubkeys, messages: sorted, latest: sorted[sorted.length - 1] };
  });
  return conversations.sort((a, b) => b.latest.created_at - a.latest.created_at);
}

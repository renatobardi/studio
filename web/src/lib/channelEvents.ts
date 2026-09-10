import type { EventTemplate, VerifiedEvent } from "nostr-tools";

/** Identifies the Message (or, in principle, any content event) a Thread Reply or Reaction targets. */
export interface TargetRef {
  id: string;
  kind: number;
  pubkey: string;
}

function unsigned(kind: number, tags: string[][], content: string): EventTemplate {
  return { kind, tags, content, created_at: Math.floor(Date.now() / 1000) };
}

/** kind 9: a Message in a Channel's timeline. */
export function buildMessage(channelId: string, content: string): EventTemplate {
  return unsigned(9, [["h", channelId]], content);
}

/** kind 1111 (NIP-22): a Thread Reply. This app only ever replies to the Thread's root Message,
 * so `e`/`k`/`p` always mirror `E`/`K`/`P` — there is no nested reply chain. */
export function buildThreadReply(channelId: string, root: TargetRef, content: string): EventTemplate {
  const rootKind = String(root.kind);
  return unsigned(
    1111,
    [
      ["h", channelId],
      ["E", root.id], ["K", rootKind], ["P", root.pubkey],
      ["e", root.id], ["k", rootKind], ["p", root.pubkey],
    ],
    content,
  );
}

/** kind 7: a Reaction (emoji) attached to a Message or Thread Reply. */
export function buildReaction(channelId: string, target: TargetRef, emoji: string): EventTemplate {
  return unsigned(
    7,
    [["h", channelId], ["e", target.id], ["k", String(target.kind)], ["p", target.pubkey]],
    emoji,
  );
}

/** kind 5 (NIP-09): deletes the caller's own Reaction. */
export function buildReactionRemoval(channelId: string, reactionEventId: string): EventTemplate {
  return unsigned(5, [["h", channelId], ["e", reactionEventId]], "");
}

function firstTag(event: VerifiedEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  reactorPubkeys: string[];
}

/** Groups kind 7 Reactions by emoji, dropping any a `deletions` (kind 5) entry removed —
 * only the reaction's own author may remove it (NIP-09). */
export function groupReactions(reactions: VerifiedEvent[], deletions: VerifiedEvent[]): ReactionGroup[] {
  const deletedIds = new Set(
    deletions.flatMap((deletion) =>
      deletion.tags.filter((tag) => tag[0] === "e").map((tag) => `${deletion.pubkey}:${tag[1]}`),
    ),
  );
  const live = reactions.filter((reaction) => !deletedIds.has(`${reaction.pubkey}:${reaction.id}`));

  const order: string[] = [];
  const byEmoji = new Map<string, string[]>();
  for (const reaction of live) {
    const emoji = reaction.content;
    if (!byEmoji.has(emoji)) {
      byEmoji.set(emoji, []);
      order.push(emoji);
    }
    byEmoji.get(emoji)!.push(reaction.pubkey);
  }
  return order.map((emoji) => {
    const reactorPubkeys = byEmoji.get(emoji)!;
    return { emoji, count: reactorPubkeys.length, reactorPubkeys };
  });
}

/** Number of Thread Replies (kind 1111) rooted at `rootId`. */
export function countThreadReplies(replies: VerifiedEvent[], rootId: string): number {
  return replies.filter((reply) => firstTag(reply, "E") === rootId).length;
}

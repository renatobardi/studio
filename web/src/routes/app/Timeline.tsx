import type { VerifiedEvent } from "nostr-tools";
import { useState } from "react";
import type { Signer } from "../../lib/custody";
import {
  buildMessage,
  buildReaction,
  buildReactionRemoval,
  countThreadReplies,
  groupReactions,
  type TargetRef,
} from "../../lib/channelEvents";
import type { RelayClient } from "../../lib/relay";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { displayName, type useProfiles } from "./useProfiles";

function replyCountLabel(count: number): string {
  if (count === 0) return "Reply in thread";
  if (count === 1) return "1 reply";
  return `${count} replies`;
}

export function Timeline({
  client,
  channelId,
  pubkey,
  signer,
  messages,
  replies,
  reactions,
  deletions,
  hasMore,
  onLoadOlder,
  profiles,
  openThreadRootId,
  onOpenThread,
}: Readonly<{
  client: RelayClient;
  channelId: string;
  pubkey: string;
  signer: Signer;
  messages: VerifiedEvent[];
  replies: VerifiedEvent[];
  reactions: VerifiedEvent[];
  deletions: VerifiedEvent[];
  hasMore: boolean;
  onLoadOlder: () => void;
  profiles: ReturnType<typeof useProfiles>["profiles"];
  openThreadRootId: string | null;
  onOpenThread: (root: TargetRef & { content: string }) => void;
}>) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSendError(null);
    try {
      const template = buildMessage(channelId, content);
      const signed = await signer.signEvent(template);
      await client.publish(signed);
      setDraft("");
    } catch {
      setSendError("Couldn't send — check your connection and try again.");
    }
  };

  const react = async (target: TargetRef, emoji: string) => {
    const signed = await signer.signEvent(buildReaction(channelId, target, emoji));
    await client.publish(signed);
  };

  const unreact = async (targetId: string, emoji: string) => {
    const own = reactions.find((r) => {
      const targetTag = r.tags.find((t) => t[0] === "e")?.[1];
      return r.pubkey === pubkey && r.content === emoji && targetTag === targetId;
    });
    if (!own) return;
    const signed = await signer.signEvent(buildReactionRemoval(channelId, own.id));
    await client.publish(signed);
  };

  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at);

  return (
    <div className="timeline">
      {hasMore && (
        <button className="btn btn-outline load-older" onClick={onLoadOlder}>
          Load older messages
        </button>
      )}
      <ul className="message-list">
        {sorted.map((message) => {
          const target: TargetRef = { id: message.id, kind: message.kind, pubkey: message.pubkey };
          const reactionsForMessage = reactions.filter((r) => r.tags.find((t) => t[0] === "e")?.[1] === message.id);
          const deletionsForMessage = deletions.filter((d) =>
            d.tags.some((t) => t[0] === "e" && reactionsForMessage.some((r) => r.id === t[1])),
          );
          const replyCount = countThreadReplies(replies, message.id);
          return (
            <li
              key={message.id}
              className={`message${message.id === openThreadRootId ? " active" : ""}`}
              data-testid="timeline-message"
            >
              <div className="message-header">
                <Avatar profile={profiles.get(message.pubkey)} name={displayName(profiles, message.pubkey)} />
                <span className="message-author">{displayName(profiles, message.pubkey)}</span>
                <span className="meta">{new Date(message.created_at * 1000).toLocaleTimeString()}</span>
              </div>
              <div className="message-content">{message.content}</div>
              <ReactionBar
                groups={groupReactions(reactionsForMessage, deletionsForMessage)}
                ownPubkey={pubkey}
                onAdd={(emoji) => void react(target, emoji)}
                onRemoveOwn={(emoji) => void unreact(message.id, emoji)}
              />
              <button
                className="link thread-open"
                onClick={() => onOpenThread({ ...target, content: message.content })}
                data-testid="open-thread"
              >
                {replyCountLabel(replyCount)}
              </button>
            </li>
          );
        })}
      </ul>
      {sendError && <div className="error-banner">{sendError}</div>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="composer-input"
          value={draft}
          placeholder="Message the channel…"
          onChange={(e) => setDraft(e.target.value)}
          data-testid="message-composer"
        />
        <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

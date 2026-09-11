import type { VerifiedEvent } from "nostr-tools";
import { useState } from "react";
import { buildThreadReply, type TargetRef } from "../../lib/channelEvents";
import type { RelayClient } from "../../lib/relay";
import type { Signer } from "../../lib/custody";
import { Avatar } from "./Avatar";
import { displayName, type useProfiles } from "./useProfiles";

export function ThreadPane({
  client,
  signer,
  channelId,
  root,
  allReplies,
  profiles,
}: {
  client: RelayClient;
  signer: Signer;
  channelId: string;
  root: TargetRef & { content: string };
  allReplies: VerifiedEvent[];
  profiles: ReturnType<typeof useProfiles>["profiles"];
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      const template = buildThreadReply(channelId, root, content);
      const signed = await signer.signEvent(template);
      await client.publish(signed);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const sorted = allReplies
    .filter((reply) => reply.tags.find((t) => t[0] === "E")?.[1] === root.id)
    .sort((a, b) => a.created_at - b.created_at);

  return (
    <aside className="side-pane" aria-label="Thread" data-testid="thread-pane">
      <h2 className="side-pane-title">Thread</h2>
      <div className="thread-root">
        <div className="message-header">
          <Avatar profile={profiles.get(root.pubkey)} name={displayName(profiles, root.pubkey)} />
          <div className="message-author">{displayName(profiles, root.pubkey)}</div>
        </div>
        <div className="message-content">{root.content}</div>
      </div>
      <ul className="thread-reply-list">
        {sorted.map((reply) => (
          <li key={reply.id} data-testid="thread-reply">
            <div className="message-header">
              <Avatar profile={profiles.get(reply.pubkey)} name={displayName(profiles, reply.pubkey)} />
              <div className="message-author">{displayName(profiles, reply.pubkey)}</div>
            </div>
            <div className="message-content">{reply.content}</div>
          </li>
        ))}
      </ul>
      <div className="composer">
        <input
          className="composer-input"
          value={draft}
          placeholder="Reply in thread…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button className="btn btn-primary" disabled={sending || !draft.trim()} onClick={() => void send()}>
          Reply
        </button>
      </div>
    </aside>
  );
}

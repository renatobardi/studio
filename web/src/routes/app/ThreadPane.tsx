import type { VerifiedEvent } from "nostr-tools";
import { useState } from "react";
import { buildThreadReply, type TargetRef } from "../../lib/channelEvents";
import type { RelayClient } from "../../lib/relay";
import type { Signer } from "../../lib/custody";
import { publishFailureMessage } from "../../lib/relayReasons";
import { Icon } from "../../components/icons/Icon";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import { displayName, type useProfiles } from "./useProfiles";

export function ThreadPane({
  client,
  signer,
  channelId,
  channelName,
  root,
  allReplies,
  profiles,
  onClose,
}: Readonly<{
  client: RelayClient;
  signer: Signer;
  channelId: string;
  channelName: string;
  root: TargetRef & { content: string; created_at?: number };
  allReplies: VerifiedEvent[];
  profiles: ReturnType<typeof useProfiles>["profiles"];
  onClose: () => void;
}>) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setSendError(null);
    try {
      const template = buildThreadReply(channelId, root, content);
      const signed = await signer.signEvent(template);
      await client.publish(signed);
      setDraft("");
    } catch (error) {
      setSendError(publishFailureMessage(error));
    } finally {
      setSending(false);
    }
  };

  const sorted = allReplies
    .filter((reply) => reply.tags.find((t) => t[0] === "E")?.[1] === root.id)
    .sort((a, b) => a.created_at - b.created_at);

  const row = (event: { id: string; pubkey: string; content: string; created_at?: number }, testId?: string) => (
    <MessageRow
      key={event.id}
      author={displayName(profiles, event.pubkey)}
      profile={profiles.get(event.pubkey)}
      createdAt={event.created_at}
      content={event.content}
      testId={testId}
    />
  );

  return (
    <aside className="side-pane" aria-label="Thread" data-testid="thread-pane">
      <header className="pane-header side-pane-header">
        <h2 className="side-pane-title">Thread</h2>
        <span className="side-pane-context">#{channelName}</span>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close thread" title="Close thread">
          <Icon name="x" />
        </button>
      </header>
      <div className="side-pane-scroll">
        <ul className="message-list">{row(root)}</ul>
        <div className="separator thread-rule" />
        <ul className="message-list">
          {sorted.map((reply) => row(reply, "thread-reply"))}
        </ul>
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        placeholder="Reply in thread…"
        canSend={!sending && draft.trim().length > 0}
        sendLabel="Reply"
        hint={false}
        testId="thread-composer"
      >
        {sendError && <div className="error-banner">{sendError}</div>}
      </Composer>
    </aside>
  );
}

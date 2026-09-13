import type { VerifiedEvent } from "nostr-tools";
import { useLayoutEffect, useRef, useState } from "react";
import type { Signer } from "../../lib/custody";
import {
  buildMessage,
  buildReaction,
  buildReactionRemoval,
  countThreadReplies,
  groupReactions,
  type TargetRef,
} from "../../lib/channelEvents";
import {
  addDraft,
  canSendWithDrafts,
  failDraft,
  progressDraft,
  readyDraft,
  readyPayloads,
  removeDraft,
  retryDraft,
  type AttachmentDraft,
} from "../../lib/attachmentDrafts";
import { buildImetaTag, parseImetaTags, uploadBlob, validateAttachment, type BlobDescriptor } from "../../lib/media";
import type { RelayClient } from "../../lib/relay";
import { publishFailureMessage } from "../../lib/relayReasons";
import { AttachmentDraftList } from "./AttachmentDraftList";
import { AttachmentImage } from "./AttachmentImage";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { displayName, type useProfiles } from "./useProfiles";

type ReadyAttachment = { descriptor: BlobDescriptor; dim?: string };

/** "WxH" for the imeta `dim` item — best-effort, an image that fails to decode just has no dim. */
function imageDimensions(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(`${image.naturalWidth}x${image.naturalHeight}`);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

/** How close to the top counts as asking for older Messages (story 30, #1). */
const TOP_OF_HISTORY_PX = 48;

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
  mediaUrl,
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
  mediaUrl: string;
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
  const [attachments, setAttachments] = useState<AttachmentDraft<ReadyAttachment>[]>([]);
  const nextAttachmentId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heightBeforePage = useRef<number | null>(null);

  // Older Messages prepend, which would otherwise leave the view pinned at the top and pull
  // in page after page. Giving back the height they added keeps the reader where they were.
  useLayoutEffect(() => {
    const timeline = scrollRef.current;
    const before = heightBeforePage.current;
    if (timeline === null || before === null || timeline.scrollHeight === before) return;
    timeline.scrollTop += timeline.scrollHeight - before;
    heightBeforePage.current = null;
  }, [messages]);

  const loadOlder = () => {
    heightBeforePage.current = scrollRef.current?.scrollHeight ?? null;
    onLoadOlder();
  };

  const upload = async (id: string, file: File, previewUrl: string) => {
    try {
      validateAttachment(file);
      const [descriptor, dim] = await Promise.all([
        uploadBlob(mediaUrl, file, signer, (loaded, total) =>
          setAttachments((prev) => progressDraft(prev, id, loaded, total)),
        ),
        imageDimensions(previewUrl),
      ]);
      setAttachments((prev) => readyDraft(prev, id, { descriptor, dim }));
    } catch (err) {
      setAttachments((prev) => failDraft(prev, id, err instanceof Error ? err.message : "Upload failed."));
    }
  };

  const pickAttachments = (files: FileList) => {
    for (const file of Array.from(files)) {
      const id = String(nextAttachmentId.current++);
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => addDraft(prev, { id, file, previewUrl }));
      void upload(id, file, previewUrl);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const retryAttachment = (attachment: AttachmentDraft<ReadyAttachment>) => {
    setAttachments((prev) => retryDraft(prev, attachment.id));
    void upload(attachment.id, attachment.file, attachment.previewUrl);
  };

  const removeAttachment = (attachment: AttachmentDraft<ReadyAttachment>) => {
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((prev) => removeDraft(prev, attachment.id));
  };

  const canSend = canSendWithDrafts(draft, attachments);

  const send = async () => {
    if (!canSend) return;
    setSendError(null);
    const sent = attachments;
    try {
      const imetaTags = readyPayloads(sent).map((image) => buildImetaTag(image.descriptor, image.dim));
      const template = buildMessage(channelId, draft.trim(), imetaTags);
      const signed = await signer.signEvent(template);
      await client.publish(signed);
      setDraft("");
      // Only what went out: a photo picked while this was publishing stays in the composer.
      for (const attachment of sent) URL.revokeObjectURL(attachment.previewUrl);
      setAttachments((prev) => prev.filter((attachment) => !sent.some((s) => s.id === attachment.id)));
    } catch (error) {
      setSendError(publishFailureMessage(error));
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
    <div
      className="timeline"
      ref={scrollRef}
      onScroll={(e) => {
        // Reaching the top of the timeline pulls in the previous page; the feed ignores a
        // request while one is already in flight, so scrolling cannot pile them up.
        if (hasMore && e.currentTarget.scrollTop <= TOP_OF_HISTORY_PX) loadOlder();
      }}
    >
      {hasMore && (
        <button className="btn btn-outline load-older" onClick={loadOlder}>
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
              {message.content && <div className="message-content">{message.content}</div>}
              {parseImetaTags(message.tags).map((descriptor, index) => (
                <AttachmentImage key={`${index}:${descriptor.sha256}`} descriptor={descriptor} signer={signer} />
              ))}
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
      <AttachmentDraftList
        attachments={attachments}
        testIdPrefix=""
        onRetry={retryAttachment}
        onRemove={removeAttachment}
      />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="composer-attach-input"
          data-testid="attach-input"
          onChange={(e) => {
            if (e.target.files) pickAttachments(e.target.files);
          }}
        />
        <button
          type="button"
          className="btn btn-outline"
          data-testid="attach-button"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <input
          className="composer-input"
          value={draft}
          placeholder="Message the channel…"
          onChange={(e) => setDraft(e.target.value)}
          data-testid="message-composer"
        />
        <button className="btn btn-primary" type="submit" disabled={!canSend}>
          Send
        </button>
      </form>
    </div>
  );
}

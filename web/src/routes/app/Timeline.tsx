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
import { buildImetaTag, parseImetaTags, uploadBlob, validateAttachment, type BlobDescriptor } from "../../lib/media";
import type { RelayClient } from "../../lib/relay";
import { AttachmentImage } from "./AttachmentImage";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { displayName, type useProfiles } from "./useProfiles";

type Attachment =
  | { status: "uploading"; previewUrl: string; loaded: number; total: number }
  | { status: "ready"; previewUrl: string; descriptor: BlobDescriptor; dim?: string }
  | { status: "error"; previewUrl: string; message: string };

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
  const [attachment, setAttachment] = useState<Attachment | null>(null);
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

  const pickAttachment = async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    try {
      validateAttachment(file);
    } catch (err) {
      setAttachment({ status: "error", previewUrl, message: err instanceof Error ? err.message : "Couldn't attach that file." });
      return;
    }
    setAttachment({ status: "uploading", previewUrl, loaded: 0, total: file.size });
    try {
      const [descriptor, dim] = await Promise.all([
        uploadBlob(mediaUrl, file, signer, (loaded, total) =>
          setAttachment((prev) => (prev?.status === "uploading" ? { ...prev, loaded, total } : prev)),
        ),
        imageDimensions(previewUrl),
      ]);
      setAttachment({ status: "ready", previewUrl, descriptor, dim });
    } catch (err) {
      setAttachment({ status: "error", previewUrl, message: err instanceof Error ? err.message : "Upload failed." });
    }
  };

  const clearAttachment = () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canSend = draft.trim().length > 0 || attachment?.status === "ready";

  const send = async () => {
    const content = draft.trim();
    if (!canSend || attachment?.status === "uploading") return;
    setSendError(null);
    try {
      const imetaTags =
        attachment?.status === "ready" ? [buildImetaTag(attachment.descriptor, attachment.dim)] : [];
      const template = buildMessage(channelId, content, imetaTags);
      const signed = await signer.signEvent(template);
      await client.publish(signed);
      setDraft("");
      clearAttachment();
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
              {parseImetaTags(message.tags).map((descriptor) => (
                <AttachmentImage key={descriptor.sha256} descriptor={descriptor} signer={signer} />
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
      {attachment && (
        <div className="attachment-preview" data-testid="attachment-preview">
          <img src={attachment.previewUrl} alt="" className="attachment-preview-thumb" />
          {attachment.status === "uploading" && (
            <span className="meta" data-testid="attachment-progress">
              Uploading… {Math.round((attachment.loaded / Math.max(attachment.total, 1)) * 100)}%
            </span>
          )}
          {attachment.status === "error" && (
            <span className="error-banner" data-testid="attachment-error">
              {attachment.message}
            </span>
          )}
          <button type="button" className="link" onClick={clearAttachment}>
            Remove
          </button>
        </div>
      )}
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
          className="composer-attach-input"
          data-testid="attach-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickAttachment(file);
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
        <button className="btn btn-primary" type="submit" disabled={!canSend || attachment?.status === "uploading"}>
          Send
        </button>
      </form>
    </div>
  );
}

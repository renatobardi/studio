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
  attachmentLimitLabel,
  canSendWithDrafts,
  failDraft,
  invalidDraft,
  progressDraft,
  readyDraft,
  readyPayloads,
  removeDraft,
  retryDraft,
  type AttachmentDraft,
} from "../../lib/attachmentDrafts";
import { clockTime, isContinuation } from "../../lib/composer";
import { createSingleFlight, draftAfterSend } from "../../lib/composerSend";
import {
  MAX_UPLOAD_BYTES,
  buildImetaTag,
  parseImetaTags,
  uploadBlob,
  validateAttachment,
  type BlobDescriptor,
} from "../../lib/media";
import type { RelayClient } from "../../lib/relay";
import { publishFailureMessage } from "../../lib/relayReasons";
import { AttachmentDraftList } from "./AttachmentDraftList";
import { Composer } from "./Composer";
import { AttachmentImage } from "./AttachmentImage";
import { Avatar } from "./Avatar";
import { QuickReactions, ReactionBar } from "./ReactionBar";
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

/** Lucide message-square, as the hover action's glyph. */
const THREAD_GLYPH = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

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
  const [sending, setSending] = useState(false);
  const sendOnce = useRef(createSingleFlight()).current;
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
    } catch (err) {
      setAttachments((prev) => invalidDraft(prev, id, err instanceof Error ? err.message : "This file can't be attached."));
      return;
    }
    try {
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

  const send = () =>
    sendOnce(async () => {
      if (!canSend) return;
      setSending(true);
      setSendError(null);
      const sent = attachments;
      const sentDraft = draft;
      try {
        const imetaTags = readyPayloads(sent).map((image) => buildImetaTag(image.descriptor, image.dim));
        const template = buildMessage(channelId, draft.trim(), imetaTags);
        const signed = await signer.signEvent(template);
        await client.publish(signed);
        setDraft((current) => draftAfterSend(current, sentDraft));
        // Only what went out: a photo picked while this was publishing stays in the composer.
        for (const attachment of sent) URL.revokeObjectURL(attachment.previewUrl);
        const sentIds = new Set(sent.map((attachment) => attachment.id));
        setAttachments((prev) => prev.filter((attachment) => !sentIds.has(attachment.id)));
      } catch (error) {
        setSendError(publishFailureMessage(error));
      } finally {
        setSending(false);
      }
    });

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
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          // Reaching the top of the timeline pulls in the previous page; the feed ignores a
          // request while one is already in flight, so scrolling cannot pile them up.
          if (hasMore && e.currentTarget.scrollTop <= TOP_OF_HISTORY_PX) loadOlder();
        }}
      >
        {hasMore && (
          <button className="btn btn-outline btn-xs load-older" onClick={loadOlder}>
            Load older messages
          </button>
        )}
        <ul className="message-list">
          {sorted.map((message, index) => {
            const target: TargetRef = { id: message.id, kind: message.kind, pubkey: message.pubkey };
            const reactionsForMessage = reactions.filter((r) => r.tags.find((t) => t[0] === "e")?.[1] === message.id);
            const deletionsForMessage = deletions.filter((d) =>
              d.tags.some((t) => t[0] === "e" && reactionsForMessage.some((r) => r.id === t[1])),
            );
            const replyCount = countThreadReplies(replies, message.id);
            const continuation = isContinuation(sorted[index - 1], message);
            const author = displayName(profiles, message.pubkey);
            return (
              <li
                key={message.id}
                className={`message${message.id === openThreadRootId ? " active" : ""}${continuation ? " continuation" : ""}${replyCount > 0 ? " has-replies" : ""}`}
                data-row="true"
                data-testid="timeline-message"
              >
                {continuation ? (
                  <span className="message-gutter" />
                ) : (
                  <Avatar profile={profiles.get(message.pubkey)} name={author} />
                )}
                <div className="message-body">
                  {!continuation && (
                    <div className="message-header">
                      <span className="message-author">{author}</span>
                      <span className="message-time">{clockTime(message.created_at)}</span>
                    </div>
                  )}
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
                  {/* The thread pill sits under a Message that has replies, as in the prototype;
                      a Message without any offers "Reply in thread" among its hover actions. */}
                  {replyCount > 0 && (
                    <div className="thread-open-row">
                      <button
                        className="thread-open"
                        onClick={() => onOpenThread({ ...target, content: message.content })}
                        data-testid="open-thread"
                      >
                        {replyCountLabel(replyCount)}
                      </button>
                    </div>
                  )}
                </div>
                <span className="message-actions">
                  <QuickReactions onAdd={(emoji) => void react(target, emoji)} />
                  {replyCount === 0 && (
                    <button
                      className="message-action"
                      onClick={() => onOpenThread({ ...target, content: message.content })}
                      data-testid="open-thread"
                      aria-label="Reply in thread"
                      title="Reply in thread"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={THREAD_GLYPH} />
                      </svg>
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        placeholder="Message the channel…"
        canSend={canSend && !sending}
        onAttach={() => fileInputRef.current?.click()}
        testId="message-composer"
        attachTestId="attach-button"
        trailing={
          <span className="meta" data-testid="attach-limit">
            {attachmentLimitLabel(MAX_UPLOAD_BYTES)}
          </span>
        }
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
        {sendError && <div className="error-banner">{sendError}</div>}
        <AttachmentDraftList
          attachments={attachments}
          testIdPrefix=""
          locked={false}
          onRetry={retryAttachment}
          onRemove={removeAttachment}
        />
      </Composer>
    </div>
  );
}

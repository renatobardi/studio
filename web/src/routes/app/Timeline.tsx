import type { VerifiedEvent } from "nostr-tools";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Signer } from "../../lib/custody";
import {
  buildMessage,
  buildReaction,
  buildReactionRemoval,
  groupReactions,
  summarizeThread,
  type TargetRef,
} from "../../lib/channelEvents";
import { nowSeconds } from "../../lib/clock";
import {
  addDraft,
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
import { channelComposerPlaceholder } from "../../lib/conversationCopy";
import { isContinuation, relativeTime } from "../../lib/messageRow";
import { createSingleFlight, draftAfterSend } from "../../lib/composerSend";
import {
  buildImetaTag,
  parseImetaTags,
  uploadBlob,
  validateAttachment,
  type BlobDescriptor,
} from "../../lib/media";
import type { RelayClient } from "../../lib/relay";
import { publishFailureMessage } from "../../lib/relayReasons";
import { messagesWithDivider, type OpenedChannel } from "../../lib/unread";
import { Icon } from "../../components/icons/Icon";
import { AttachmentDraftList } from "./AttachmentDraftList";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import { AttachmentImage } from "./AttachmentImage";
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
export const TOP_OF_HISTORY_PX = 48;

function replyCountLabel(count: number): string {
  if (count === 0) return "Reply in thread";
  if (count === 1) return "1 reply";
  return `${count} replies`;
}


export function Timeline({
  client,
  channelId,
  channelName,
  ownPubkey,
  signer,
  mediaUrl,
  messages,
  replies,
  reactions,
  deletions,
  hasMore,
  onLoadOlder,
  profiles,
  opened,
  openThreadRootId,
  onOpenThread,
}: Readonly<{
  client: RelayClient;
  channelId: string;
  channelName: string;
  /** The Identity this browser signs with. */
  ownPubkey: string;
  signer: Signer;
  mediaUrl: string;
  messages: VerifiedEvent[];
  replies: VerifiedEvent[];
  reactions: VerifiedEvent[];
  deletions: VerifiedEvent[];
  hasMore: boolean;
  onLoadOlder: () => void;
  profiles: ReturnType<typeof useProfiles>["profiles"];
  opened: OpenedChannel | null;
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
  // "last reply 12m ago" is read against this, refreshed each minute so it does not go stale.
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), 60_000);
    return () => clearInterval(timer);
  }, []);
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
      return r.pubkey === ownPubkey && r.content === emoji && targetTag === targetId;
    });
    if (!own) return;
    const signed = await signer.signEvent(buildReactionRemoval(channelId, own.id));
    await client.publish(signed);
  };

  const { sorted, newMessageId } = messagesWithDivider(messages, opened, ownPubkey);

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
            const thread = summarizeThread(replies, message.id);
            const replyCount = thread.count;
            const continuation = isContinuation(sorted[index - 1], message);
            const author = displayName(profiles, message.pubkey);
            let rowClass = "";
            if (message.id === openThreadRootId) rowClass = "active";
            else if (replyCount > 0) rowClass = "has-replies";
            return (
              <Fragment key={message.id}>
                {message.id === newMessageId && (
                  <li className="new-divider" role="separator" data-testid="new-divider">
                    New
                  </li>
                )}
                <MessageRow
                  author={author}
                  profile={profiles.get(message.pubkey)}
                  createdAt={message.created_at}
                  content={message.content}
                  continuation={continuation}
                  className={rowClass}
                  testId="timeline-message"
                  actions={
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
                          <Icon name="message-square" size={14} />
                        </button>
                      )}
                    </span>
                  }
                >
                  {parseImetaTags(message.tags).map((descriptor, position) => (
                    // `priority={index}`: the newest Message's photos are the ones being waited on.
                    <AttachmentImage key={`${position}:${descriptor.sha256}`} descriptor={descriptor} signer={signer} priority={index} />
                  ))}
                  <ReactionBar
                    groups={groupReactions(reactionsForMessage, deletionsForMessage)}
                    ownPubkey={ownPubkey}
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
                        <span className="thread-open-avatars">
                          {/* The pill draws three faces, as the prototype does. */}
                          {thread.participantPubkeys.slice(0, 3).map((participant) => (
                            <Avatar
                              key={participant}
                              profile={profiles.get(participant)}
                              name={displayName(profiles, participant)}
                              size={24}
                            />
                          ))}
                        </span>
                        <span className="thread-open-text">
                          <span>{replyCountLabel(replyCount)}</span>
                          {thread.lastReplyAt !== null && (
                            <>
                              <span className="thread-open-dot">·</span>
                              <span className="thread-open-last">last reply {relativeTime(thread.lastReplyAt, now)}</span>
                            </>
                          )}
                        </span>
                      </button>
                    </div>
                  )}
                </MessageRow>
              </Fragment>
            );
          })}
        </ul>
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        placeholder={channelComposerPlaceholder(channelName)}
        canSend={canSend && !sending}
        onAttach={() => fileInputRef.current?.click()}
        testId="message-composer"
        attachTestId="attach-button"
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

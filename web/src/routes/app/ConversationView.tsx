import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { Icon } from "../../components/icons/Icon";
import { DM_ENCRYPTION_NOTICE, dmComposerPlaceholder } from "../../lib/conversationCopy";
import { isContinuation } from "../../lib/messageRow";
import { createSingleFlight, draftAfterSend } from "../../lib/composerSend";
import type { Signer } from "../../lib/custody";
import { deliverPending, deliveryOutcome, partialDeliveryMessage, pendingDm, type PendingDm } from "../../lib/dmDelivery";
import {
  encryptFileForDm,
  parseDmImetaTags,
  uploadEncryptedBlob,
  validateDmAttachment,
  wrapDmMessage,
  type ReadyDmPhoto,
} from "../../lib/dmMedia";
import { DM_SHOWN_STEP, askOlder, keepFetchingOlder, shownMessages, type ShownState } from "../../lib/dmPagination";
import type { Rumor } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";
import { publishFailureMessage } from "../../lib/relayReasons";
import { AttachmentDraftList } from "./AttachmentDraftList";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import { DmAttachmentImage } from "./DmAttachmentImage";
import { TOP_OF_HISTORY_PX } from "./Timeline";
import { displayName, shortNpub, type useProfiles } from "./useProfiles";

function imageDimensions(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(`${image.naturalWidth}x${image.naturalHeight}`);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

export function ConversationView({
  client,
  ownPubkey,
  peerPubkeys,
  signer,
  mediaUrl,
  messages,
  completeFrom,
  hasMore,
  onLoadOlder,
  profiles,
}: Readonly<{
  client: RelayClient;
  ownPubkey: string;
  peerPubkeys: string[];
  signer: Signer;
  mediaUrl: string;
  messages: Rumor[];
  /** Where the Direct Message history held is complete (#185) — nothing older is shown. */
  completeFrom: number;
  hasMore: boolean;
  onLoadOlder: () => void;
  profiles: ReturnType<typeof useProfiles>["profiles"];
}>) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Some recipients already have this Message (#106): until the rest do, Send retries exactly it, and
  // the composer is locked — an edit would be a different Message for them.
  const [partial, setPartial] = useState<{ dm: PendingDm; sentDraft: string; sent: AttachmentDraft<ReadyDmPhoto>[] } | null>(null);
  const sendOnce = useRef(createSingleFlight()).current;
  const [attachments, setAttachments] = useState<AttachmentDraft<ReadyDmPhoto>[]>([]);
  const nextAttachmentId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heightBeforeOlder = useRef<number | null>(null);
  // Only what is mounted fetches its photos (#185): the newest step, more as the reader asks.
  const [shownState, setShownState] = useState<ShownState>({ shown: DM_SHOWN_STEP, waitingPast: null });
  const shown = shownMessages(messages, completeFrom, shownState.shown);
  const complete = shown.messages.length + shown.hidden;
  const fetchOlder = keepFetchingOlder(shownState, { complete, hasMore });

  useEffect(() => {
    if (fetchOlder) onLoadOlder();
  });

  // Older Messages prepend; giving back the height they added keeps the reader where they were.
  useLayoutEffect(() => {
    const timeline = scrollRef.current;
    const before = heightBeforeOlder.current;
    if (timeline === null || before === null || timeline.scrollHeight === before) return;
    timeline.scrollTop += timeline.scrollHeight - before;
    heightBeforeOlder.current = null;
  }, [shown.messages.length]);

  const canLoadOlder = shown.hidden > 0 || hasMore;
  const loadOlder = () => {
    if (fetchOlder) return;
    heightBeforeOlder.current = scrollRef.current?.scrollHeight ?? null;
    setShownState((prev) => askOlder(prev, { hidden: shown.hidden, complete, hasMore }));
  };

  const upload = async (id: string, file: File, previewUrl: string) => {
    try {
      validateDmAttachment(file);
    } catch (err) {
      setAttachments((prev) => invalidDraft(prev, id, err instanceof Error ? err.message : "This file can't be attached."));
      return;
    }
    try {
      const encrypted = encryptFileForDm(await file.arrayBuffer(), file.type);
      const [descriptor, dim] = await Promise.all([
        uploadEncryptedBlob(mediaUrl, encrypted, peerPubkeys, signer, (loaded, total) =>
          setAttachments((prev) => progressDraft(prev, id, loaded, total)),
        ),
        imageDimensions(previewUrl),
      ]);
      setAttachments((prev) => readyDraft(prev, id, { encrypted, descriptor, dim }));
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

  const retryAttachment = (attachment: AttachmentDraft<ReadyDmPhoto>) => {
    setAttachments((prev) => retryDraft(prev, attachment.id));
    void upload(attachment.id, attachment.file, attachment.previewUrl);
  };

  const removeAttachment = (attachment: AttachmentDraft<ReadyDmPhoto>) => {
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((prev) => removeDraft(prev, attachment.id));
  };

  const canSend = canSendWithDrafts(draft, attachments);

  // Gives up on the rest of a partial delivery: whoever has the Message keeps it, and the composer —
  // text and photos still in it — is free to send something new.
  const discardPartial = () => {
    setPartial(null);
    setSendError(null);
  };

  const send = () =>
    sendOnce(async () => {
      if (!canSend && partial === null) return;
      setSending(true);
      setSendError(null);
      try {
        // A partially delivered Message is retried as it was signed; only a fresh one is built from the composer.
        const attempt = partial ?? {
          dm: pendingDm(await wrapDmMessage(signer, ownPubkey, peerPubkeys, draft.trim(), readyPayloads(attachments))),
          sentDraft: draft,
          sent: attachments,
        };
        const dm = await deliverPending(attempt.dm, (wrap) => client.publish(wrap));
        const outcome = deliveryOutcome(dm);
        if (outcome === "delivered") {
          setPartial(null);
          setDraft((current) => draftAfterSend(current, attempt.sentDraft));
          // Only what went out: a photo picked while this was publishing stays in the composer.
          for (const attachment of attempt.sent) URL.revokeObjectURL(attachment.previewUrl);
          const sentIds = new Set(attempt.sent.map((attachment) => attachment.id));
          setAttachments((prev) => prev.filter((attachment) => !sentIds.has(attachment.id)));
        } else if (outcome === "undelivered") {
          // Nobody has it: the composer is still free to change what gets sent.
          setPartial(null);
          setSendError(publishFailureMessage(dm.failure));
        } else {
          setPartial({ ...attempt, dm });
          setSendError(partialDeliveryMessage(dm, ownPubkey));
        }
      } catch (error) {
        setSendError(publishFailureMessage(error));
      } finally {
        setSending(false);
      }
    });

  const peerName = peerPubkeys.map((p) => displayName(profiles, p)).join(", ");

  return (
    <section className="conversation-view" data-testid="conversation-view" aria-label={`Direct message with ${peerName}`}>
      <header className="pane-header conversation-header">
        <span className="pane-title conversation-title">
          {peerPubkeys.length === 1 && (
            <Avatar profile={profiles.get(peerPubkeys[0]!)} name={peerName} size={26} />
          )}
          <span className="conversation-title-text">
            <h1 className="conversation-name">{peerName}</h1>
            {peerPubkeys.length === 1 && (
              <span className="conversation-handle">{shortNpub(peerPubkeys[0]!)}</span>
            )}
          </span>
        </span>
      </header>
      <div
        className="timeline-scroll dm-scroll"
        data-list="true"
        ref={scrollRef}
        onScroll={(e) => {
          if (canLoadOlder && e.currentTarget.scrollTop <= TOP_OF_HISTORY_PX) loadOlder();
        }}
      >
        <p className="dm-notice">
          <Icon name="lock" size={12} />
          <span>{DM_ENCRYPTION_NOTICE}</span>
        </p>
        {canLoadOlder && (
          <button type="button" className="btn btn-outline btn-xs load-older" disabled={fetchOlder} onClick={loadOlder}>
            Load older messages
          </button>
        )}
        <ul className="message-list">
          {shown.messages.map((message, index) => {
            const continuation = isContinuation(shown.messages[index - 1], message);
            const author = displayName(profiles, message.pubkey);
            return (
              <MessageRow
                key={message.id}
                author={author}
                profile={profiles.get(message.pubkey)}
                createdAt={message.created_at}
                content={message.content}
                continuation={continuation}
                avatarSize={26}
                className="dm-message"
                testId="dm-message"
              >
                {parseDmImetaTags(message.tags).map((dmAttachment, position) => (
                  // `priority={index}`: the newest Message's photos are the ones being waited on.
                  <DmAttachmentImage key={`${position}:${dmAttachment.sha256}`} attachment={dmAttachment} signer={signer} priority={index} />
                ))}
              </MessageRow>
            );
          })}
        </ul>
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        placeholder={dmComposerPlaceholder(peerName)}
        canSend={(canSend || partial !== null) && !sending}
        disabled={partial !== null}
        sendLabel={partial === null ? "Send" : "Retry"}
        onAttach={() => fileInputRef.current?.click()}
        testId="dm-composer"
        attachTestId="dm-attach-button"
        trailing={
          partial !== null && (
            <button type="button" className="btn btn-outline btn-xs" disabled={sending} onClick={discardPartial}>
              Discard
            </button>
          )
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="composer-attach-input"
          data-testid="dm-attach-input"
          onChange={(e) => {
            if (e.target.files) pickAttachments(e.target.files);
          }}
        />
        {sendError && <div className="error-banner">{sendError}</div>}
        <AttachmentDraftList
          attachments={attachments}
          testIdPrefix="dm-"
          locked={partial !== null}
          onRetry={retryAttachment}
          onRemove={removeAttachment}
        />
      </Composer>
    </section>
  );
}

import { useRef, useState } from "react";
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
import { createSingleFlight, draftAfterSend } from "../../lib/composerSend";
import type { Signer } from "../../lib/custody";
import { deliverPending, deliveryOutcome, partialDeliveryMessage, pendingDm, type PendingDm } from "../../lib/dmDelivery";
import {
  MAX_DM_PHOTO_BYTES,
  encryptFileForDm,
  parseDmImetaTags,
  uploadEncryptedBlob,
  validateDmAttachment,
  wrapDmMessage,
  type ReadyDmPhoto,
} from "../../lib/dmMedia";
import type { Rumor } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";
import { publishFailureMessage } from "../../lib/relayReasons";
import { AttachmentDraftList } from "./AttachmentDraftList";
import { Avatar } from "./Avatar";
import { DmAttachmentImage } from "./DmAttachmentImage";
import { displayName, type useProfiles } from "./useProfiles";

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
  myPubkey,
  peerPubkeys,
  signer,
  mediaUrl,
  messages,
  profiles,
}: Readonly<{
  client: RelayClient;
  myPubkey: string;
  peerPubkeys: string[];
  signer: Signer;
  mediaUrl: string;
  messages: Rumor[];
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
          dm: pendingDm(await wrapDmMessage(signer, myPubkey, peerPubkeys, draft.trim(), readyPayloads(attachments))),
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
          setSendError(partialDeliveryMessage(dm, myPubkey));
        }
      } catch (error) {
        setSendError(publishFailureMessage(error));
      } finally {
        setSending(false);
      }
    });

  return (
    <div className="conversation-view" data-testid="conversation-view">
      <ul className="message-list">
        {messages.map((message) => (
          <li key={message.id} className="message" data-testid="dm-message">
            <div className="message-header">
              <Avatar profile={profiles.get(message.pubkey)} name={displayName(profiles, message.pubkey)} />
              <span className="message-author">{displayName(profiles, message.pubkey)}</span>
              <span className="meta">{new Date(message.created_at * 1000).toLocaleTimeString()}</span>
            </div>
            {message.content && <div className="message-content">{message.content}</div>}
            {parseDmImetaTags(message.tags).map((dmAttachment, index) => (
              <DmAttachmentImage key={`${index}:${dmAttachment.sha256}`} attachment={dmAttachment} signer={signer} />
            ))}
          </li>
        ))}
      </ul>
      {sendError && <div className="error-banner">{sendError}</div>}
      <AttachmentDraftList
        attachments={attachments}
        testIdPrefix="dm-"
        locked={partial !== null}
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
          data-testid="dm-attach-input"
          onChange={(e) => {
            if (e.target.files) pickAttachments(e.target.files);
          }}
        />
        <button
          type="button"
          className="btn btn-outline"
          data-testid="dm-attach-button"
          disabled={partial !== null}
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <input
          className="composer-input"
          value={draft}
          placeholder="Message…"
          disabled={partial !== null}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="dm-composer"
        />
        <button className="btn btn-primary" type="submit" disabled={(!canSend && partial === null) || sending}>
          {partial === null ? "Send" : "Retry"}
        </button>
        {partial !== null && (
          <button type="button" className="btn btn-outline" disabled={sending} onClick={discardPartial}>
            Discard
          </button>
        )}
      </form>
      <span className="meta" data-testid="dm-attach-limit">
        {attachmentLimitLabel(MAX_DM_PHOTO_BYTES)}
      </span>
    </div>
  );
}

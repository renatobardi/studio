import { useRef, useState } from "react";
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
import type { Signer } from "../../lib/custody";
import {
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
  const [attachments, setAttachments] = useState<AttachmentDraft<ReadyDmPhoto>[]>([]);
  const nextAttachmentId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = async (id: string, file: File, previewUrl: string) => {
    try {
      validateDmAttachment(file);
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

  const send = async () => {
    if (!canSend) return;
    setSendError(null);
    const sent = attachments;
    try {
      const wraps = await wrapDmMessage(signer, myPubkey, peerPubkeys, draft.trim(), readyPayloads(sent));
      await Promise.all(wraps.map((wrap) => client.publish(wrap)));
      setDraft("");
      // Only what went out: a photo picked while this was publishing stays in the composer.
      for (const attachment of sent) URL.revokeObjectURL(attachment.previewUrl);
      setAttachments((prev) => prev.filter((attachment) => !sent.some((s) => s.id === attachment.id)));
    } catch (error) {
      setSendError(publishFailureMessage(error));
    }
  };

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
      {attachments.length > 0 && (
        <ul className="attachment-previews">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="attachment-preview" data-testid="dm-attachment-preview">
              <img src={attachment.previewUrl} alt="" className="attachment-preview-thumb" />
              {attachment.status === "uploading" && (
                <span className="meta" data-testid="dm-attachment-progress">
                  Uploading… {Math.round((attachment.loaded / Math.max(attachment.total, 1)) * 100)}%
                </span>
              )}
              {attachment.status === "error" && (
                <>
                  <span className="error-banner" data-testid="dm-attachment-error">
                    {attachment.message}
                  </span>
                  <button type="button" className="link" onClick={() => retryAttachment(attachment)}>
                    Retry
                  </button>
                </>
              )}
              <button type="button" className="link" onClick={() => removeAttachment(attachment)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
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
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <input
          className="composer-input"
          value={draft}
          placeholder="Message…"
          onChange={(e) => setDraft(e.target.value)}
          data-testid="dm-composer"
        />
        <button className="btn btn-primary" type="submit" disabled={!canSend}>
          Send
        </button>
      </form>
    </div>
  );
}

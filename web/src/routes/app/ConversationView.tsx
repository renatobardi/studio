import { useRef, useState } from "react";
import type { Signer } from "../../lib/custody";
import {
  buildDmImetaTag,
  encryptFileForDm,
  parseDmImetaTags,
  uploadEncryptedBlob,
  validateAttachment,
  type EncryptedFile,
} from "../../lib/dmMedia";
import { buildDmRumor, giftWrapForAll, type Rumor } from "../../lib/nip17";
import type { RelayClient } from "../../lib/relay";
import { Avatar } from "./Avatar";
import { DmAttachmentImage } from "./DmAttachmentImage";
import { displayName, type useProfiles } from "./useProfiles";

type Attachment =
  | { status: "uploading"; previewUrl: string; loaded: number; total: number }
  | { status: "ready"; previewUrl: string; encrypted: EncryptedFile; url: string; sha256: string; size: number; dim?: string }
  | { status: "error"; previewUrl: string; message: string };

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
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const bytes = await file.arrayBuffer();
      const encrypted = encryptFileForDm(bytes, file.type);
      const [descriptor, dim] = await Promise.all([
        uploadEncryptedBlob(mediaUrl, encrypted, signer, (loaded, total) =>
          setAttachment((prev) => (prev?.status === "uploading" ? { ...prev, loaded, total } : prev)),
        ),
        imageDimensions(previewUrl),
      ]);
      setAttachment({ status: "ready", previewUrl, encrypted, url: descriptor.url, sha256: descriptor.sha256, size: descriptor.size, dim });
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
        attachment?.status === "ready"
          ? [
              buildDmImetaTag(
                { url: attachment.url, sha256: attachment.sha256, size: attachment.size, type: "application/octet-stream" },
                attachment.encrypted.key,
                attachment.encrypted.originalMime,
                attachment.dim,
              ),
            ]
          : [];
      const rumor = buildDmRumor(myPubkey, peerPubkeys, content, imetaTags);
      const extraTags = attachment?.status === "ready" ? [["x", attachment.sha256]] : [];
      const wraps = await giftWrapForAll(signer, myPubkey, rumor, peerPubkeys, extraTags);
      await Promise.all(wraps.map((wrap) => client.publish(wrap)));
      setDraft("");
      clearAttachment();
    } catch {
      setSendError("Couldn't send — check your connection and try again.");
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
            {parseDmImetaTags(message.tags).map((dmAttachment) => (
              <DmAttachmentImage key={dmAttachment.sha256} attachment={dmAttachment} signer={signer} />
            ))}
          </li>
        ))}
      </ul>
      {sendError && <div className="error-banner">{sendError}</div>}
      {attachment && (
        <div className="attachment-preview" data-testid="dm-attachment-preview">
          <img src={attachment.previewUrl} alt="" className="attachment-preview-thumb" />
          {attachment.status === "uploading" && (
            <span className="meta" data-testid="dm-attachment-progress">
              Uploading… {Math.round((attachment.loaded / Math.max(attachment.total, 1)) * 100)}%
            </span>
          )}
          {attachment.status === "error" && (
            <span className="error-banner" data-testid="dm-attachment-error">
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
          data-testid="dm-attach-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickAttachment(file);
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
        <button className="btn btn-primary" type="submit" disabled={!canSend || attachment?.status === "uploading"}>
          Send
        </button>
      </form>
    </div>
  );
}

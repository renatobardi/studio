import { useEffect, useState } from "react";
import type { Signer } from "../../lib/custody";
import { fetchDmAttachmentObjectUrl, type DmAttachment } from "../../lib/dmMedia";
import { loadAttachment } from "../../lib/mediaDownloads";

/** A photo attached to a Direct Message: fetched with Blossom auth, decrypted client-side with
 * the per-file NIP-44 key carried in the rumor (ticket #7), rendered inline, and expandable to
 * full size on click — the server never sees the plaintext. */
export function DmAttachmentImage({ attachment, signer, priority }: Readonly<{ attachment: DmAttachment; signer: Signer; priority: number }>) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullSize, setFullSize] = useState(false);

  useEffect(
    () =>
      loadAttachment(
        priority,
        (signal) => fetchDmAttachmentObjectUrl(attachment.url, attachment.sha256, attachment.key, attachment.originalMime, signer, signal),
        setObjectUrl,
        setError,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attachment identity per message is stable
    [attachment.url, attachment.sha256, attachment.key],
  );

  if (error) return <div className="attachment-error">{error}</div>;
  if (!objectUrl) return <div className="attachment-loading" data-testid="dm-attachment-loading" />;

  return (
    <>
      <button type="button" className="attachment-thumb-button" onClick={() => setFullSize(true)}>
        <img src={objectUrl} alt="" className="attachment-thumb" data-testid="dm-attachment-image" />
      </button>
      {fullSize && (
        <button
          type="button"
          className="attachment-lightbox"
          onClick={() => setFullSize(false)}
          data-testid="dm-attachment-lightbox"
          aria-label="Close full-size image"
        >
          <img src={objectUrl} alt="" className="attachment-full" />
        </button>
      )}
    </>
  );
}

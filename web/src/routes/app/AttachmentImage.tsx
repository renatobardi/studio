import { useEffect, useState } from "react";
import type { Signer } from "../../lib/custody";
import { fetchBlobObjectUrl, type BlobDescriptor } from "../../lib/media";
import { loadAttachment } from "../../lib/mediaDownloads";

/** An image attached to a Message: fetched with Blossom auth (following the server's redirect
 * into an object URL, sha256-verified), rendered inline, and expandable to full size on click. */
export function AttachmentImage({ descriptor, signer, priority }: Readonly<{ descriptor: BlobDescriptor; signer: Signer; priority: number }>) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullSize, setFullSize] = useState(false);

  useEffect(
    () =>
      loadAttachment(
        priority,
        (signal) => fetchBlobObjectUrl(descriptor.url, descriptor.sha256, signer, signal),
        setObjectUrl,
        setError,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- descriptor identity per message is stable
    [descriptor.url, descriptor.sha256],
  );

  if (error) return <div className="attachment-error">{error}</div>;
  if (!objectUrl) return <div className="attachment-loading" data-testid="attachment-loading" />;

  return (
    <>
      <button type="button" className="attachment-thumb-button" onClick={() => setFullSize(true)}>
        <img src={objectUrl} alt="" className="attachment-thumb" data-testid="attachment-image" />
      </button>
      {fullSize && (
        <button
          type="button"
          className="attachment-lightbox"
          onClick={() => setFullSize(false)}
          data-testid="attachment-lightbox"
          aria-label="Close full-size image"
        >
          <img src={objectUrl} alt="" className="attachment-full" />
        </button>
      )}
    </>
  );
}

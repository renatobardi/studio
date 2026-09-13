import type { AttachmentDraft } from "../../lib/attachmentDrafts";

/** The photos waiting in a composer (#48), each with its own progress, error, Retry and Remove.
 * Presentation only: what an upload does, and what a ready photo holds, stays with each flow. */
export function AttachmentDraftList<R>({
  attachments,
  testIdPrefix,
  onRetry,
  onRemove,
}: Readonly<{
  attachments: AttachmentDraft<R>[];
  /** `""` for a Channel, `"dm-"` for a Direct Message — the test ids each flow already had. */
  testIdPrefix: string;
  onRetry: (attachment: AttachmentDraft<R>) => void;
  onRemove: (attachment: AttachmentDraft<R>) => void;
}>) {
  if (attachments.length === 0) return null;
  return (
    <ul className="attachment-previews">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="attachment-preview" data-testid={`${testIdPrefix}attachment-preview`}>
          <img src={attachment.previewUrl} alt="" className="attachment-preview-thumb" />
          {attachment.status === "uploading" && (
            <span className="meta" data-testid={`${testIdPrefix}attachment-progress`}>
              Uploading… {Math.round((attachment.loaded / Math.max(attachment.total, 1)) * 100)}%
            </span>
          )}
          {attachment.status === "error" && (
            <>
              <span className="error-banner" data-testid={`${testIdPrefix}attachment-error`}>
                {attachment.message}
              </span>
              {attachment.retryable && (
                <button type="button" className="link" onClick={() => onRetry(attachment)}>
                  Retry
                </button>
              )}
            </>
          )}
          <button type="button" className="link" onClick={() => onRemove(attachment)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

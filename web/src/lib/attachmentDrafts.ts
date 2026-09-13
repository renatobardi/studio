type DraftBase = { id: string; file: File; previewUrl: string };

/** The photos picked into a composer before the Message is sent (#48): each uploads, fails,
 * retries and is removed on its own. Pure list state shared by the Channel and Direct Message
 * composers — what `Ready` holds (a blob descriptor, or an encrypted file's key and descriptor)
 * and how it becomes `imeta` stays with each flow. */
export type AttachmentDraft<Ready> = DraftBase & (
  | { status: "uploading"; loaded: number; total: number }
  | { status: "ready"; ready: Ready }
  | { status: "error"; message: string }
);

const base = ({ id, file, previewUrl }: DraftBase): DraftBase => ({ id, file, previewUrl });

/** Replaces the draft with `id` while it is still uploading — an upload that settles after its
 * photo was removed, or after another attempt already settled it, changes nothing. */
function settleUpload<R>(
  drafts: AttachmentDraft<R>[],
  id: string,
  next: (draft: AttachmentDraft<R>) => AttachmentDraft<R>,
): AttachmentDraft<R>[] {
  return drafts.map((draft) => (draft.id === id && draft.status === "uploading" ? next(draft) : draft));
}

export function addDraft<R>(drafts: AttachmentDraft<R>[], draft: DraftBase): AttachmentDraft<R>[] {
  return [...drafts, { ...base(draft), status: "uploading", loaded: 0, total: draft.file.size }];
}

export function progressDraft<R>(drafts: AttachmentDraft<R>[], id: string, loaded: number, total: number): AttachmentDraft<R>[] {
  return settleUpload(drafts, id, (draft) => ({ ...draft, loaded, total }));
}

export function readyDraft<R>(drafts: AttachmentDraft<R>[], id: string, ready: R): AttachmentDraft<R>[] {
  return settleUpload(drafts, id, (draft) => ({ ...base(draft), status: "ready", ready }));
}

export function failDraft<R>(drafts: AttachmentDraft<R>[], id: string, message: string): AttachmentDraft<R>[] {
  return settleUpload(drafts, id, (draft) => ({ ...base(draft), status: "error", message }));
}

export function retryDraft<R>(drafts: AttachmentDraft<R>[], id: string): AttachmentDraft<R>[] {
  return drafts.map((draft) =>
    draft.id === id && draft.status === "error"
      ? { ...base(draft), status: "uploading", loaded: 0, total: draft.file.size }
      : draft,
  );
}

export function removeDraft<R>(drafts: AttachmentDraft<R>[], id: string): AttachmentDraft<R>[] {
  return drafts.filter((draft) => draft.id !== id);
}

/** A photo still uploading or failed holds the whole Message back: sending without it would
 * publish something other than what the composer shows. */
export function canSendWithDrafts<R>(content: string, drafts: AttachmentDraft<R>[]): boolean {
  if (drafts.some((draft) => draft.status !== "ready")) return false;
  return content.trim().length > 0 || drafts.length > 0;
}

export function readyPayloads<R>(drafts: AttachmentDraft<R>[]): R[] {
  return drafts.flatMap((draft) => (draft.status === "ready" ? [draft.ready] : []));
}

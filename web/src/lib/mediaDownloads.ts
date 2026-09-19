import { nowSeconds } from "./clock";
import { createPriorityQueue } from "./fetchQueue";

/**
 * The queue every attachment download goes through — Channel and Direct Message alike, since
 * they share the origin's connections (#188).
 *
 * Opening a conversation asks for every photo it ever carried at once. They share the origin's
 * few connections newest-Message-first, so the photo someone just sent never waits behind a
 * history of blobs — some of which answer slowly, or not at all: after 30 s a download gives
 * its connection back.
 *
 * It is module-level because sign-out has to reach it: the queue holds work belonging to the
 * Identity that is leaving, and `clearIdentity` drops and aborts it before wiping that
 * Identity's cache.
 */
export const mediaDownloads = createPriorityQueue(4, 30_000);

/**
 * What a photo's place in the queue is worth, on one scale for every surface: the send time of
 * the Message carrying it. The queue is global — Channel and Direct Message share the origin's
 * four connections — so a position inside one list says nothing against the other's, and a
 * Channel's two-hundredth Message used to outrank a photo just sent in a conversation (#234).
 *
 * `created_at` is the author's own claim, and the relay takes it up to FUTURE_TOLERANCE_SECONDS
 * ahead (api/src/studio_api/nostr/validation.py), so it is capped at now: a Message dated in the
 * future would otherwise hold the four slots in front of everything, for the whole session.
 * Messages of the same second keep the order they were rendered in — the sort is stable.
 */
export function downloadPriority(messageCreatedAt: number, now: number = nowSeconds()): number {
  return Math.min(messageCreatedAt, now);
}

/**
 * One attachment's download, for the effect that shows it: queued at `priority`, handed to
 * `onLoad` as an object URL, or to `onError` as the message to show. Returns the cleanup — it
 * takes a download that has not started out of the queue, aborts one in flight (#188), and
 * revokes the object URL, including one that only arrives after the photo is gone.
 */
export function loadAttachment(
  priority: number,
  fetchObjectUrl: (signal: AbortSignal) => Promise<string>,
  onLoad: (objectUrl: string) => void,
  onError: (message: string) => void,
): () => void {
  let cancelled = false;
  let created: string | null = null;
  const { result, cancel } = mediaDownloads.run(priority, (signal) =>
    fetchObjectUrl(signal).then((url) => {
      if (signal.aborted) URL.revokeObjectURL(url);
      return url;
    }),
  );
  result
    .then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      created = url;
      onLoad(url);
    })
    .catch((err: unknown) => {
      if (!cancelled) onError(err instanceof Error ? err.message : "Couldn't load the image.");
    });
  return () => {
    cancelled = true;
    cancel();
    if (created) URL.revokeObjectURL(created);
  };
}

import { createPriorityQueue } from "./fetchQueue";

/**
 * The queue every Direct Message photo download goes through.
 *
 * Opening a conversation asks for every photo it ever carried at once. They share the origin's
 * few connections newest-Message-first, so the photo someone just sent never waits behind a
 * history of blobs — some of which answer slowly, or not at all.
 *
 * It is module-level because sign-out has to reach it: the queue holds work belonging to the
 * Identity that is leaving, and `clearIdentity` drops it before wiping that Identity's cache.
 */
export const mediaDownloads = createPriorityQueue(4);

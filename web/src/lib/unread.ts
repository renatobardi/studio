/** Per-Channel unix timestamps: when the caller last read it, and when it was
 * last active. Both are the same shape, so both use the same merge. */
export type ReadState = Readonly<Record<string, number>>;

/** Marks Channels with no last-read mark as read up to `now` — a Channel this
 * browser has never seen must not open with its whole history unread. */
export function seedMissing(state: ReadState, channelIds: string[], now: number): ReadState {
  const missing = channelIds.filter((id) => state[id] === undefined);
  if (missing.length === 0) return state;
  return { ...state, ...Object.fromEntries(missing.map((id) => [id, now])) };
}

/** Moves one Channel's timestamp forward, never back, and never touches
 * another Channel — reading one conversation says nothing about the rest. */
export function touch(state: ReadState, channelId: string, at: number): ReadState {
  if ((state[channelId] ?? -Infinity) >= at) return state;
  return { ...state, [channelId]: at };
}

/** The Channels with activity the caller has not read yet. */
export function unreadChannelIds(readAt: ReadState, activityAt: ReadState): Set<string> {
  return new Set(
    Object.entries(activityAt)
      .filter(([channelId, at]) => at > (readAt[channelId] ?? -Infinity))
      .map(([channelId]) => channelId),
  );
}

/** The oldest last-read mark across `channelIds` — where a fresh subscription
 * has to start to tell whether any of them is unread. */
export function oldestRead(readAt: ReadState, channelIds: string[], fallback: number): number {
  const marks = channelIds.map((id) => readAt[id]).filter((at): at is number => at !== undefined);
  return marks.length === 0 ? fallback : Math.min(...marks);
}

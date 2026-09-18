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

/** Where a Channel stood the moment it was opened: its last-read mark then, and when. */
export type OpenedChannel = Readonly<{ readAt: number; openedAt: number }>;

/** Opening a Channel reads it, so `touch` is about to move its mark to `now` — this keeps
 * what the mark was, the only record of where the reader had stopped. */
export function openChannel(readAt: ReadState, channelId: string, now: number): OpenedChannel {
  return { readAt: readAt[channelId] ?? now, openedAt: now };
}

/** The Message the "New" divider goes above: the oldest one someone else sent after the
 * Channel's last-read mark and before it was opened — what arrived while it was not on
 * screen. Messages arriving while it is open are read as they come, so they never qualify. */
export function firstNewMessageId(
  messages: readonly { id: string; pubkey: string; created_at: number }[],
  opened: OpenedChannel,
  ownPubkey: string,
): string | null {
  const unread = messages.filter(
    (m) => m.pubkey !== ownPubkey && m.created_at > opened.readAt && m.created_at <= opened.openedAt,
  );
  if (unread.length === 0) return null;
  return unread.reduce((oldest, m) => (m.created_at < oldest.created_at ? m : oldest), unread[0]).id;
}

/** The Channel's Messages in reading order, with the one the "New" divider goes above — the
 * whole of the timeline's decision, so the component only renders it. */
export function messagesWithDivider<T extends { id: string; pubkey: string; created_at: number }>(
  messages: readonly T[],
  opened: OpenedChannel | null,
  ownPubkey: string,
): Readonly<{ sorted: T[]; newMessageId: string | null }> {
  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at);
  const newMessageId = opened === null ? null : firstNewMessageId(sorted, opened, ownPubkey);
  return { sorted, newMessageId };
}

/** Where Direct Message reading stands on this browser (#142): a mark per conversation, and when
 * the marks started being kept — the mark of any conversation that has none yet. */
export type DmReadState = Readonly<{ since: number; readAt: ReadState }>;

/** How many Messages someone else wrote in each conversation after its last-read mark — the
 * count the prototype's sidebar row carries. Conversations with nothing unread are left out. */
export function unreadConversationCounts(
  conversations: readonly { key: string; messages: readonly { pubkey: string; created_at: number }[] }[],
  state: DmReadState,
  ownPubkey: string,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { key, messages } of conversations) {
    const mark = state.readAt[key] ?? state.since;
    const unread = messages.filter((m) => m.pubkey !== ownPubkey && m.created_at > mark).length;
    if (unread > 0) counts.set(key, unread);
  }
  return counts;
}

/** The marks to start from: the ones this browser kept, or — the first time — no marks at all
 * from now on, so Messages that predate them never arrive as a pile of unread ones. */
export function initialDmRead(stored: DmReadState | undefined, now: number): DmReadState {
  return stored ?? { since: now, readAt: {} };
}

/** The open conversation read up to now, or up to its newest Message when that one is ahead of
 * this clock — otherwise a Message from a fast clock would stay unread forever. */
export function markConversationRead(state: DmReadState, key: string, now: number, latestAt: number): DmReadState {
  return { ...state, readAt: touch(state.readAt, key, Math.max(now, latestAt)) };
}

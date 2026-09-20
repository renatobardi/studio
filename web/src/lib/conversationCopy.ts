/** The prototype's conversation copy (#153): a composer says where the Message goes, and a
 * Direct Message timeline opens with the relay's encryption notice. */

/** `Message #eng-platform` — the Channel name carries no `#` of its own. */
export function channelComposerPlaceholder(name: string): string {
  return `Message #${name}`;
}

/** `Message Ana Petrova` — whoever is on the other side, as the header names them. */
export function dmComposerPlaceholder(peerName: string): string {
  return `Message ${peerName}`;
}

export const DM_ENCRYPTION_NOTICE = "Direct messages are end-to-end encrypted on this relay.";

/** Shown while a conversation whose Messages are all older than the history held is fetching
 * them: an empty panel would read as an empty conversation (#231). */
export const DM_LOOKING_FOR_OLDER = "Looking for older messages\u2026";

/** Shown once an opening has spent its pages without reaching this conversation: the panel would
 * otherwise be the empty box #231 is about, with no word of why. */
export const DM_NOTHING_FOUND_YET = "Nothing from this conversation yet. Load older messages to keep looking.";

/** What a conversation with nothing on screen says in place of an empty list: that it is still
 * looking, or that this opening stopped looking and the reader may carry on. Null once there are
 * Messages to show, or once there is nothing left to fetch. */
export function dmEmptyNotice({
  messages,
  canLoadOlder,
  fetchOlder,
}: {
  messages: readonly unknown[];
  canLoadOlder: boolean;
  fetchOlder: boolean;
}): string | null {
  if (messages.length > 0 || !canLoadOlder) return null;
  return fetchOlder ? DM_LOOKING_FOR_OLDER : DM_NOTHING_FOUND_YET;
}

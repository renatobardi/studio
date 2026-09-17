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

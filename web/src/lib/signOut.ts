/** What the sign-out dialog asks to be typed before it wipes this device (#148). */
export const SIGN_OUT_PHRASE = "wipe all my data";

/** Why the destructive button is still disabled, or null once it may wipe: the key backup
 * confirmed first, then the phrase typed exactly — the prototype's own order. */
export function signOutBlocker({ backupConfirmed, phrase }: { backupConfirmed: boolean; phrase: string }): string | null {
  if (!backupConfirmed) return "Confirm your key backup first.";
  if (phrase.trim() !== SIGN_OUT_PHRASE) return "Type the phrase exactly to enable the button.";
  return null;
}

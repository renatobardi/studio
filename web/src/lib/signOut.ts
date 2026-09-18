/** What the sign-out dialog asks to be typed before it wipes this device (#148). */
export const SIGN_OUT_PHRASE = "wipe all my data";

/** Why the destructive button is still disabled, or null once it may wipe: the key backup
 * confirmed first, then the phrase typed exactly — the prototype's own order. */
export function signOutBlocker({ backupConfirmed, phrase }: { backupConfirmed: boolean; phrase: string }): string | null {
  if (!backupConfirmed) return "Confirm your key backup first.";
  if (phrase.trim() !== SIGN_OUT_PHRASE) return "Type the phrase exactly to enable the button.";
  return null;
}

/** A click on the dimmed backdrop, not one that bubbled up from the dialog box inside it —
 * which is how the backdrop dismisses without the box carrying a handler of its own. */
export function isOutsideClick(event: { target: unknown; currentTarget: unknown }): boolean {
  return event.target === event.currentTarget;
}

/** Escape, the key that dismisses the dialog from the keyboard. */
export function isEscape(event: { key: string }): boolean {
  return event.key === "Escape";
}

/** The keys that activate what a click would, so a click handler can be given the keyboard
 * equivalent Sonar asks for without inventing a shortcut the dialog does not already have. */
export function isActivationKey(event: { key: string }): boolean {
  return event.key === "Enter" || event.key === " ";
}

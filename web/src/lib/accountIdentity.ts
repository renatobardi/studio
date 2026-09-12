import type { Custody } from "./onboardingSteps";

/**
 * What onboarding may do with this Account's Identity (#36).
 *
 * An Account is bound to one Identity for life: the server refuses to link a
 * second one, and the Key Backup is that Identity's. So onboarding an Account
 * that already has one — or that still holds the Key Backup of one it never
 * linked — may only restore it. Generating a replacement is how the real key
 * gets lost.
 */
export type OnboardingEntry = "new-identity" | "restore" | "extension";

export interface AccountState {
  /** The Identity the server has on file for this Account, if any. */
  linkedPubkey: string | null;
  /** Whether the server holds a Key Backup for it. */
  hasKeyBackup: boolean;
}

export function resolveOnboardingEntry(account: AccountState, custody: Custody): OnboardingEntry {
  // An extension holds the key and never exports it: nothing to back up, and
  // generating an Identity would leave this person with two (ADR-0005).
  if (custody === "extension") return "extension";
  if (account.linkedPubkey !== null || account.hasKeyBackup) return "restore";
  return "new-identity";
}

/**
 * Whether the key held locally is this Account's Identity. A local key that
 * isn't the linked one would sign as someone else, and its Key Backup is not
 * the one on file — so the app must fall back to restoring instead.
 */
export function localIdentityMatches(localPubkey: string, linkedPubkey: string | null): boolean {
  return linkedPubkey === null || localPubkey === linkedPubkey;
}

import * as api from "./api";
import { KEY_BACKUP_FILENAME } from "./keyBackup";
import type { Custody } from "./onboardingSteps";

/** Where "Send feedback" goes, as the owner decided for the prototype's button (#150). */
export const FEEDBACK_URL = "https://github.com/renatobardi/studio/issues/new";

/** The IDENTITY row for the Key Backup: what it says, and whether "Manage" is offered. */
export interface KeyBackupRow {
  value: string;
  manage: boolean;
}

/**
 * The prototype's "Private key backup · Verified · Manage" row over what the app really knows
 * (#150). `stored` is whether the Account holds a Key Backup (GET /account/key-backup), null
 * until it has answered — and a backup only ever reaches the server after its passphrase was
 * verified (#36), so holding one is what "Verified" means. Under a NIP-07 extension the key
 * never reaches Studio, so there is nothing here to back up or manage (#45).
 */
export function keyBackupRow(custody: Custody, stored: boolean | null): KeyBackupRow {
  if (custody === "extension") return { value: "Your Nostr extension holds your private key.", manage: false };
  if (stored === null) return { value: "Checking…", manage: false };
  return { value: stored ? `Verified · ${KEY_BACKUP_FILENAME}` : "Not verified", manage: true };
}

/**
 * Asks the Account whether it holds a Key Backup and hands the answer to the row (#150).
 *
 * Nothing is asked under a NIP-07 extension, which has no Studio-held key, nor without a
 * Firebase session to ask with. A request that fails answers nothing rather than claiming a
 * backup either way, and the returned cancel drops an answer that arrives after the pane is
 * gone — the row would otherwise be set on a pane nobody is looking at.
 */
export function askForKeyBackup(
  custody: Custody,
  user: { getIdToken(): Promise<string> } | null,
  onAnswer: (stored: boolean) => void,
): () => void {
  if (custody === "extension" || !user) return () => {};
  let cancelled = false;
  user
    .getIdToken()
    .then(api.hasKeyBackup)
    .then((stored) => {
      if (!cancelled) onAnswer(stored);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}

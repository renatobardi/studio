import { getPublicKey } from "nostr-tools";
import * as api from "./api";
import { decryptBackup, encryptBackup, validateBackupPassphrase } from "./backup";
import { loadIdentityNsec } from "./custody";
import { secretKeyFromNsec } from "./identity";

/**
 * The Key Backup flow's own decisions, shared by onboarding's steps and by "Manage" in
 * Settings › Profile (#150) — so a backup made later is made under exactly the rules the
 * first one was (#31, #36) and the dialog is left with nothing but state and markup.
 */

/** The name the encrypted key file carries everywhere: the download, the card that shows it,
 * and the Settings row that says a backup exists (#36, #150). */
export const KEY_BACKUP_FILENAME = "studio-key-backup.age";

/** Which of the two cards the flow is on: pick a passphrase, prove it unlocks, done — or proved
 * but not in the Account yet, which is not done: only the local file holds it (#200). */
export type KeyBackupStep = "passphrase" | "verify" | "unsaved" | "verified";

export function keyBackupStep(blob: Uint8Array | null, verified: boolean, stored: boolean): KeyBackupStep {
  if (verified) return stored ? "verified" : "unsaved";
  return blob ? "verify" : "passphrase";
}

/** What the dialog's header says on each step. */
export function keyBackupHeading(step: KeyBackupStep): { title: string; description: string } {
  if (step === "verified") {
    return { title: "Your backup is verified", description: "Your file and passphrase can restore your identity." };
  }
  if (step === "unsaved") {
    return { title: "Your backup file works", description: "Your passphrase unlocked it, but it isn't saved to your Account yet." };
  }
  if (step === "verify") {
    return { title: "That’s your backup file", description: "Now enter your passphrase to prove you can unlock it." };
  }
  return {
    title: "Back up your key with a password",
    description:
      "Pick a passphrase you can remember. It locks the backup file — Studio cannot recover it for you, and it must be different from your account password.",
  };
}

/** Why this passphrase cannot lock a backup yet, or null when it can: the length and
 * "different from the Account password" rules, then the confirmation. */
export function newBackupPassphraseProblem(
  passphrase: string,
  confirm: string,
  accountPassword: string | null,
): string | null {
  const invalid = validateBackupPassphrase(passphrase, accountPassword ?? "");
  if (invalid) return invalid;
  return passphrase === confirm ? null : "Passphrases don't match.";
}

export const NO_LOCAL_KEY_MESSAGE = "This browser doesn't hold your private key, so there is nothing to back up here.";
export const CREATE_FAILED_MESSAGE = "Couldn't create the Key Backup. Try again.";
export const WRONG_PASSPHRASE_MESSAGE = "That didn't decrypt to your key. Check the passphrase.";
export const NOT_STORED_MESSAGE =
  "Your backup file is correct, but it wasn't saved to your Account. Check your connection and try again.";

/** The age file for the key this browser holds, or null when it holds none — under a NIP-07
 * extension there is nothing here to back up. */
export async function createKeyBackup(passphrase: string): Promise<Uint8Array | null> {
  const nsec = await loadIdentityNsec();
  if (!nsec) return null;
  return encryptBackup(nsec, passphrase);
}

/** Whether the file really unlocks with this passphrase into this Identity — what has to be
 * true before it is worth keeping. Rejects when the passphrase does not open it at all. */
export async function verifyKeyBackup(blob: Uint8Array, passphrase: string, pubkey: string): Promise<boolean> {
  const decrypted = await decryptBackup(blob, passphrase);
  return getPublicKey(secretKeyFromNsec(decrypted)) === pubkey;
}

/** The encrypted file as PUT /account/key-backup takes it: base64, so the bytes survive the
 * JSON body. Onboarding stores its first backup itself, between linking the Identity and
 * storing the key, and encodes it through here too. */
export function keyBackupBase64(blob: Uint8Array): string {
  return btoa(String.fromCodePoint(...blob));
}

/** Hands the verified file to the Account. */
export async function storeKeyBackup(firebaseIdToken: string, blob: Uint8Array): Promise<void> {
  await api.putKeyBackup(firebaseIdToken, keyBackupBase64(blob));
}

/** The optional local copy of the same file, named as the rest of the app names it. */
export function downloadKeyBackup(blob: Uint8Array): void {
  const file = new Blob([blob as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = KEY_BACKUP_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The verify step, end to end: the file has to unlock into this Identity before anything is
 * kept, and only then does the Account get it (#36). Answers with what to show, or null when
 * it is stored. `onUnlocked` fires the moment the file proved itself, so the card can say so
 * while the upload is still in flight. A file that does not open and an upload that fails are
 * told apart: the first is the passphrase, the second is not (#200).
 */
export async function confirmKeyBackup(input: {
  blob: Uint8Array;
  passphrase: string;
  pubkey: string;
  getIdToken: () => Promise<string>;
  onUnlocked: () => void;
  onStored: () => void;
}): Promise<string | null> {
  try {
    if (!(await verifyKeyBackup(input.blob, input.passphrase, input.pubkey))) return WRONG_PASSPHRASE_MESSAGE;
  } catch {
    return WRONG_PASSPHRASE_MESSAGE;
  }
  input.onUnlocked();
  try {
    await storeKeyBackup(await input.getIdToken(), input.blob);
  } catch {
    return NOT_STORED_MESSAGE;
  }
  input.onStored();
  return null;
}

/**
 * The create step, end to end: the rules first, then the file, and the reason it did not happen
 * when it did not. The dialog is left holding nothing but the answer.
 */
export async function requestKeyBackup(input: {
  passphrase: string;
  confirm: string;
  accountPassword: string | null;
  onCreated: (blob: Uint8Array) => void;
}): Promise<string | null> {
  const invalid = newBackupPassphraseProblem(input.passphrase, input.confirm, input.accountPassword);
  if (invalid) return invalid;
  try {
    const created = await createKeyBackup(input.passphrase);
    if (!created) return NO_LOCAL_KEY_MESSAGE;
    input.onCreated(created);
    return null;
  } catch {
    return CREATE_FAILED_MESSAGE;
  }
}

/** Runs one of those steps while the dialog says it is busy, and shows whatever it answered —
 * neither of them throws, so there is nothing here to rescue. */
export async function runKeyBackupStep(
  step: () => Promise<string | null>,
  report: { busy: (busy: boolean) => void; error: (message: string | null) => void },
): Promise<void> {
  report.busy(true);
  report.error(null);
  report.error(await step());
  report.busy(false);
}

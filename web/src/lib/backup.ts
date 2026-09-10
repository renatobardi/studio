import { Decrypter, Encrypter } from "age-encryption";

/** Encrypts the nsec into an age passphrase-protected file. */
export async function encryptBackup(nsec: string, passphrase: string): Promise<Uint8Array> {
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  return encrypter.encrypt(nsec);
}

/** Decrypts an age file produced by {@link encryptBackup} back into the nsec. */
export async function decryptBackup(blob: Uint8Array, passphrase: string): Promise<string> {
  const decrypter = new Decrypter();
  decrypter.addPassphrase(passphrase);
  return decrypter.decrypt(blob, "text");
}

/**
 * Returns an error message if the Key Backup passphrase is unusable, or
 * `null` if it's fine. It must differ from the Account password (so a leaked
 * Account password alone can't open the Key Backup) and be long enough to
 * resist offline brute-force against the age/scrypt stanza.
 */
export function validateBackupPassphrase(
  passphrase: string,
  accountPassword: string,
): string | null {
  if (passphrase.length < 8) return "Use 8 characters or more.";
  if (passphrase === accountPassword) {
    return "The Key Backup passphrase must be different from your account password.";
  }
  return null;
}

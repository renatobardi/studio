import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Encrypter } from "age-encryption";
import * as idb from "idb-keyval";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import {
  CREATE_FAILED_MESSAGE,
  KEY_BACKUP_FILENAME,
  NOT_STORED_MESSAGE,
  NO_LOCAL_KEY_MESSAGE,
  WRONG_PASSPHRASE_MESSAGE,
  confirmKeyBackup,
  createKeyBackup,
  downloadKeyBackup,
  keyBackupBase64,
  keyBackupHeading,
  keyBackupStep,
  newBackupPassphraseProblem,
  requestKeyBackup,
  runKeyBackupStep,
  storeKeyBackup,
  verifyKeyBackup,
} from "./keyBackup";

const secretKey = generateSecretKey();
const nsec = nip19.nsecEncode(secretKey);
const pubkey = getPublicKey(secretKey);

/**
 * The same age file `encryptBackup` produces, at a scrypt work factor these tests can afford.
 * What is checked here is keyBackup's orchestration — what it validates, what it sends, what it
 * refuses — and the production work factor costs seconds per call on a CI runner, which is what
 * timed these tests out. The file is still a real one: `decryptBackup` reads the factor from its
 * own header, so the real decrypt path runs, and `backup.test.ts` covers encryptBackup itself.
 */
async function backupFile(passphrase: string): Promise<Uint8Array> {
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(2);
  return encrypter.encrypt(nsec);
}

/** Which of the two Key Backup cards the dialog is on (#150) — the onboarding order, and
 * "verified" only ever after the file proved it unlocks. */
describe("keyBackupStep", () => {
  test("picks the passphrase card until there is a file", () => {
    expect(keyBackupStep(null, false, false)).toBe("passphrase");
  });

  test("then the verify card, and its verified state once the file is also in the Account", () => {
    expect(keyBackupStep(new Uint8Array([1]), false, false)).toBe("verify");
    expect(keyBackupStep(new Uint8Array([1]), true, true)).toBe("verified");
  });

  test("a file that unlocked but never reached the Account is not the success state (#200)", () => {
    expect(keyBackupStep(new Uint8Array([1]), true, false)).toBe("unsaved");
  });
});

describe("keyBackupHeading", () => {
  test("each step says what it is asking for", () => {
    expect(keyBackupHeading("passphrase").title).toBe("Back up your key with a password");
    expect(keyBackupHeading("passphrase").description).toContain("different from your account password");
    expect(keyBackupHeading("verify").description).toContain("prove you can unlock it");
    expect(keyBackupHeading("verified").title).toBe("Your backup is verified");
    expect(keyBackupHeading("unsaved").title).not.toBe("Your backup is verified");
    expect(keyBackupHeading("unsaved").description).toContain("isn't saved to your Account");
  });
});

/** The create rules, unchanged from the first backup (#31, #36): long enough, different from the
 * Account password, and typed the same twice. */
describe("newBackupPassphraseProblem", () => {
  test("rejects a short passphrase and one that repeats the account password", () => {
    expect(newBackupPassphraseProblem("short", "short", null)).toBe("Use 8 characters or more.");
    expect(newBackupPassphraseProblem("same passphrase", "same passphrase", "same passphrase")).toBe(
      "The Key Backup passphrase must be different from your account password.",
    );
  });

  test("rejects a confirmation that does not match", () => {
    expect(newBackupPassphraseProblem("correct horse", "correct hose", null)).toBe("Passphrases don't match.");
  });

  test("passes a long passphrase confirmed and unlike the account password", () => {
    expect(newBackupPassphraseProblem("correct horse", "correct horse", "hunter22")).toBeNull();
  });
});

describe("createKeyBackup", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of the extension stub below
    delete globalThis.window;
  });

  test("is null under a NIP-07 extension, which never hands the key over", async () => {
    // @ts-expect-error minimal window stub for the custody check
    globalThis.window = { nostr: {} };
    expect(await createKeyBackup("correct horse")).toBeNull();
  });
});

describe("verifyKeyBackup", () => {
  test("true only when the file decrypts to this Identity's key", async () => {
    const blob = await backupFile("correct horse");
    expect(await verifyKeyBackup(blob, "correct horse", pubkey)).toBe(true);
    expect(await verifyKeyBackup(blob, "correct horse", getPublicKey(generateSecretKey()))).toBe(false);
  });

  test("rejects when the passphrase does not open the file at all", async () => {
    const blob = await backupFile("correct horse");
    await expect(verifyKeyBackup(blob, "wrong passphrase", pubkey)).rejects.toBeDefined();
  });
});

/** The file name is one literal: the download, the card that shows it, and the Settings row all
 * read it from here (#36, #150). */
describe("KEY_BACKUP_FILENAME", () => {
  test("is the age file the rest of the app names", () => {
    expect(KEY_BACKUP_FILENAME).toBe("studio-key-backup.age");
  });
});

describe("keyBackupBase64", () => {
  test("encodes the bytes as PUT /account/key-backup takes them", () => {
    expect(keyBackupBase64(new Uint8Array([104, 105]))).toBe(btoa("hi"));
  });
});

describe("storeKeyBackup", () => {
  const realFetch = globalThis.fetch;
  let sent: string | null;

  beforeEach(() => {
    sent = null;
    globalThis.fetch = (async (_input: string, init: RequestInit) => {
      sent = init.body as string;
      return new Response(JSON.stringify({ status: "ok" }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("sends the file base64-encoded, so the bytes survive the JSON body", async () => {
    await storeKeyBackup("id-token", new Uint8Array([104, 105]));
    expect(JSON.parse(sent ?? "{}").blob_base64).toBe(btoa("hi"));
  });
});

/** The optional "Download backup file": the same bytes the Account holds, named as the rest of
 * the app names it, with the object URL released again. */
describe("downloadKeyBackup", () => {
  const realDocument = globalThis.document;
  const realUrl = globalThis.URL;

  afterEach(() => {
    globalThis.document = realDocument;
    globalThis.URL = realUrl;
  });

  test("clicks a link at an object URL and revokes it afterwards", () => {
    const anchor = { href: "", download: "", clicked: false, click() { this.clicked = true; } };
    const revoked: string[] = [];
    // @ts-expect-error minimal document stub for this check
    globalThis.document = { createElement: () => anchor };
    // @ts-expect-error minimal URL stub for this check
    globalThis.URL = { createObjectURL: () => "blob:key-backup", revokeObjectURL: (url: string) => revoked.push(url) };

    downloadKeyBackup(new Uint8Array([104, 105]));

    expect(anchor.href).toBe("blob:key-backup");
    expect(anchor.download).toBe(KEY_BACKUP_FILENAME);
    expect(anchor.clicked).toBe(true);
    expect(revoked).toEqual(["blob:key-backup"]);
  });
});

/** Nothing reaches the Account until the file has proved it unlocks into this Identity (#36). */
describe("confirmKeyBackup", () => {
  const realFetch = globalThis.fetch;
  let stored: number;

  beforeEach(() => {
    stored = 0;
    globalThis.fetch = (async () => {
      stored += 1;
      return new Response(JSON.stringify({ status: "ok" }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const confirm = async (passphrase: string, identity = pubkey) => {
    const unlocked: string[] = [];
    const blob = await backupFile("correct horse");
    const error = await confirmKeyBackup({
      blob,
      passphrase,
      pubkey: identity,
      getIdToken: async () => "id-token",
      onUnlocked: () => void unlocked.push("unlocked"),
      onStored: () => unlocked.push("stored"),
    });
    return { error, unlocked };
  };

  test("stores the file once it unlocked into this Identity", async () => {
    const { error, unlocked } = await confirm("correct horse");
    expect(error).toBeNull();
    expect(unlocked).toEqual(["unlocked", "stored"]);
    expect(stored).toBe(1);
  });

  test("a file that decrypts to another key is never sent", async () => {
    const { error } = await confirm("correct horse", getPublicKey(generateSecretKey()));
    expect(error).toBe(WRONG_PASSPHRASE_MESSAGE);
    expect(stored).toBe(0);
  });

  test("a passphrase that does not open the file is never sent either, and says it is the passphrase", async () => {
    const { error, unlocked } = await confirm("wrong passphrase");
    expect(error).toBe(WRONG_PASSPHRASE_MESSAGE);
    expect(unlocked).toEqual([]);
    expect(stored).toBe(0);
  });

  test("an upload that fails says the file is right but not in the Account, and to try again (#200)", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const { error, unlocked } = await confirm("correct horse");
    expect(error).toBe(NOT_STORED_MESSAGE);
    expect(NOT_STORED_MESSAGE).not.toBe(WRONG_PASSPHRASE_MESSAGE);
    expect(NOT_STORED_MESSAGE).toContain("wasn't saved to your Account");
    expect(NOT_STORED_MESSAGE).toContain("try again");
    expect(unlocked).toEqual(["unlocked"]);
  });

  test("work the caller does between unlocking and storing finishes before the upload (#224)", async () => {
    // Onboarding links the Identity to the Account in `onUnlocked`, and the server only takes a
    // Key Backup for the Account's own Identity: running the two at once would upload against
    // an Identity that is not linked yet.
    const order: string[] = [];
    globalThis.fetch = (async () => {
      order.push("stored");
      return new Response(JSON.stringify({ status: "ok" }));
    }) as unknown as typeof fetch;
    const blob = await backupFile("correct horse");
    await confirmKeyBackup({
      blob,
      passphrase: "correct horse",
      pubkey,
      getIdToken: async () => "id-token",
      onUnlocked: async () => {
        // A real tick, not a microtask: anything that runs the two at once gets "stored" first.
        await new Promise((resolve) => setTimeout(resolve, 0));
        order.push("linked");
      },
      onStored: () => {},
    });
    expect(order).toEqual(["linked", "stored"]);
  });

  test("work the caller does between unlocking and storing counts as not stored (#224)", async () => {
    // Onboarding links the Identity to the Account before the upload — the server only takes a
    // Key Backup for the Account's own Identity. A link that fails leaves the file unsaved just
    // as a failed upload does, and must not read as the passphrase being wrong.
    const blob = await backupFile("correct horse");
    const error = await confirmKeyBackup({
      blob,
      passphrase: "correct horse",
      pubkey,
      getIdToken: async () => "id-token",
      onUnlocked: async () => {
        throw new Error("link failed");
      },
      onStored: () => {},
    });
    expect(error).toBe(NOT_STORED_MESSAGE);
    expect(stored).toBe(0);
  });
});

/** The create step the dialog runs, and the busy/error reporting around either step. */
describe("requestKeyBackup", () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of the extension stub below
    delete globalThis.window;
  });

  test("refuses before touching the key when the passphrase breaks a rule", async () => {
    const created: Uint8Array[] = [];
    const problem = await requestKeyBackup({
      passphrase: "short",
      confirm: "short",
      accountPassword: null,
      onCreated: (blob) => created.push(blob),
    });
    expect(problem).toBe("Use 8 characters or more.");
    expect(created).toHaveLength(0);
  });

  test("a browser whose key store will not open says the backup could not be made", async () => {
    // The key store is made to refuse here rather than left to be absent: another test file's
    // `mock.module("idb-keyval", …)` reaches this one — bun's module mocks are process-wide —
    // and then the read answers "nothing stored" instead of throwing, which is a different
    // dead end with a different message.
    const store = spyOn(idb, "get").mockRejectedValue(new Error("the key store will not open"));
    try {
      const problem = await requestKeyBackup({
        passphrase: "correct horse",
        confirm: "correct horse",
        accountPassword: "hunter22",
        onCreated: () => {},
      });
      expect(problem).toBe(CREATE_FAILED_MESSAGE);
    } finally {
      store.mockRestore();
    }
  });

  test("says there is nothing to back up when the key is the extension's", async () => {
    // @ts-expect-error minimal window stub for the custody check
    globalThis.window = { nostr: {} };
    const problem = await requestKeyBackup({
      passphrase: "correct horse",
      confirm: "correct horse",
      accountPassword: null,
      onCreated: () => {},
    });
    expect(problem).toBe(NO_LOCAL_KEY_MESSAGE);
  });
});

describe("runKeyBackupStep", () => {
  test("reports busy around the step and shows whatever it answered", async () => {
    const seen: unknown[] = [];
    await runKeyBackupStep(async () => "Use 8 characters or more.", {
      busy: (busy) => seen.push(busy),
      error: (message) => seen.push(message),
    });
    expect(seen).toEqual([true, null, "Use 8 characters or more.", false]);
  });

  test("clears the previous error when the step succeeds", async () => {
    const seen: unknown[] = [];
    await runKeyBackupStep(async () => null, { busy: () => {}, error: (message) => seen.push(message) });
    expect(seen).toEqual([null, null]);
  });
});

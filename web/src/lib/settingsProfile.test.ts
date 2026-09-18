import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { askForKeyBackup, keyBackupRow } from "./settingsProfile";

/** Settings › Profile shows the Key Backup the prototype shows (#150): the state comes from
 * whether the Account holds one, and only local custody has one to manage. */
describe("keyBackupRow", () => {
  test("a stored Key Backup is the verified one — it is only stored after verifying", () => {
    expect(keyBackupRow("local", true)).toEqual({ value: "Verified · studio-key-backup.age", manage: true });
  });

  test("without one, it says so and still offers to make it", () => {
    expect(keyBackupRow("local", false)).toEqual({ value: "Not verified", manage: true });
  });

  test("before the account has answered, nothing is claimed either way", () => {
    expect(keyBackupRow("local", null)).toEqual({ value: "Checking…", manage: false });
  });

  test("under a NIP-07 extension there is no key to back up here", () => {
    expect(keyBackupRow("extension", false)).toEqual({
      value: "Your Nostr extension holds your private key.",
      manage: false,
    });
  });
});

/** The row only ever reports what the Account answered (#150): it asks nothing under a NIP-07
 * extension, and an answer that arrives after the pane closed must not be reported at all. */
describe("askForKeyBackup", () => {
  const realFetch = globalThis.fetch;
  let asked: number;
  let reply: () => Response;

  beforeEach(() => {
    asked = 0;
    reply = () => new Response(JSON.stringify({ blob_base64: "AA==" }));
    globalThis.fetch = (async () => {
      asked += 1;
      return reply();
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const user = { getIdToken: async () => "id-token" };

  test("reports a stored backup once the Account answers", async () => {
    const answers: boolean[] = [];
    askForKeyBackup("local", user, (stored) => answers.push(stored));
    await Bun.sleep(1);
    expect(answers).toEqual([true]);
  });

  test("a 404 is the Account answering that it holds none", async () => {
    reply = () => new Response("{}", { status: 404 });
    const answers: boolean[] = [];
    askForKeyBackup("local", user, (stored) => answers.push(stored));
    await Bun.sleep(1);
    expect(answers).toEqual([false]);
  });

  test("a failed request claims nothing either way", async () => {
    reply = () => new Response("{}", { status: 500 });
    const answers: boolean[] = [];
    askForKeyBackup("local", user, (stored) => answers.push(stored));
    await Bun.sleep(1);
    expect(answers).toEqual([]);
  });

  test("an answer that arrives after the cancel is dropped", async () => {
    const answers: boolean[] = [];
    askForKeyBackup("local", user, (stored) => answers.push(stored))();
    await Bun.sleep(1);
    expect(answers).toEqual([]);
  });

  test("asks nothing under a NIP-07 extension, nor without a Firebase session", async () => {
    askForKeyBackup("extension", user, () => {})();
    askForKeyBackup("local", null, () => {})();
    await Bun.sleep(1);
    expect(asked).toBe(0);
  });
});

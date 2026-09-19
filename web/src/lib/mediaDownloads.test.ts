import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { loadAttachment } from "./mediaDownloads";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What an attachment's effect does: queue the download, show it, and undo all of it on cleanup. */
describe("loadAttachment", () => {
  afterEach(() => {
    spyOn(URL, "revokeObjectURL").mockRestore();
  });

  test("shows the object URL the download produced", async () => {
    const shown: string[] = [];

    loadAttachment(0, async () => "blob:photo", (url) => shown.push(url), () => {});
    await settle();

    expect(shown).toEqual(["blob:photo"]);
  });

  test("says why a download failed", async () => {
    const errors: string[] = [];

    loadAttachment(0, async () => { throw new Error("Couldn't load the image."); }, () => {}, (message) => errors.push(message));
    await settle();

    expect(errors).toEqual(["Couldn't load the image."]);
  });

  test("a photo unmounted before its turn is never downloaded", async () => {
    // #188: leaving a conversation must take its queued photos out of the line.
    let started = false;

    const cleanup = loadAttachment(0, async () => { started = true; return "blob:photo"; }, () => {}, () => {});
    cleanup();
    await settle();

    expect(started).toBe(false);
  });

  test("a photo unmounted mid-download has its signal aborted, and shows nothing", async () => {
    let seen: AbortSignal | undefined;
    const shown: string[] = [];
    const errors: string[] = [];

    const cleanup = loadAttachment(
      0,
      (signal) => { seen = signal; return new Promise<string>(() => {}); },
      (url) => shown.push(url),
      (message) => errors.push(message),
    );
    await settle();
    cleanup();
    await settle();

    expect(seen?.aborted).toBe(true);
    expect(shown).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("an object URL that arrives after the unmount is revoked, not leaked", async () => {
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let finish!: (url: string) => void;

    const cleanup = loadAttachment(0, () => new Promise<string>((resolve) => (finish = resolve)), () => {}, () => {});
    await settle();
    cleanup();
    finish("blob:late");
    await settle();

    expect(revoke).toHaveBeenCalledWith("blob:late");
  });

  test("the cleanup revokes the object URL it showed", async () => {
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const cleanup = loadAttachment(0, async () => "blob:photo", () => {}, () => {});
    await settle();
    cleanup();

    expect(revoke).toHaveBeenCalledWith("blob:photo");
  });
});

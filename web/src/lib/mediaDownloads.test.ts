import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { downloadPriority, loadAttachment, mediaDownloads } from "./mediaDownloads";

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

/** The queue is one line for both surfaces, so what goes into it has to be one scale (#234). */
describe("downloadPriority", () => {
  test("a photo just sent in a conversation goes before a Channel's history", async () => {
    // Four slots, all taken: what waits behind them is ordered by priority alone. The Channel
    // Message is the two-hundredth of its list and the conversation's is the first of its own,
    // so an index would have put the history in front.
    const release: (() => void)[] = [];
    const holding = [0, 0, 0, 0].map(() =>
      mediaDownloads.run(0, () => new Promise<string>((resolve) => release.push(() => resolve("blob:held")))),
    );
    await settle();
    const started: string[] = [];
    const channelHistory = mediaDownloads.run(downloadPriority(1_700_000_000), async () => {
      started.push("channel");
      return "blob:channel";
    });
    const justSent = mediaDownloads.run(downloadPriority(1_700_000_600), async () => {
      started.push("dm");
      return "blob:dm";
    });
    await settle();
    expect(started).toEqual([]);

    for (const free of release) free();
    await settle();
    // Order, not timing: each one frees its slot as it answers, so both get to run.
    expect(started).toEqual(["dm", "channel"]);
    await Promise.all([...holding.map((held) => held.result), channelHistory.result, justSent.result]);
  });
});

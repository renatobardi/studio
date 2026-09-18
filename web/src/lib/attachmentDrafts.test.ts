import { describe, expect, test } from "bun:test";
import {
  addDraft,
  canSendWithDrafts,
  failDraft,
  invalidDraft,
  progressDraft,
  readyDraft,
  readyPayloads,
  removeDraft,
  retryDraft,
  type AttachmentDraft,
} from "./attachmentDrafts";

const photo = (name: string, size = 3) => new File([new Uint8Array(size)], name, { type: "image/png" });

function twoUploading(): AttachmentDraft<string>[] {
  let drafts: AttachmentDraft<string>[] = [];
  drafts = addDraft(drafts, { id: "a", file: photo("a.png", 10), previewUrl: "blob:a" });
  drafts = addDraft(drafts, { id: "b", file: photo("b.png", 20), previewUrl: "blob:b" });
  return drafts;
}

describe("a composer's attachment drafts", () => {
  test("each picked photo starts uploading on its own, in the order picked", () => {
    const drafts = twoUploading();

    expect(drafts.map((d) => [d.id, d.status])).toEqual([["a", "uploading"], ["b", "uploading"]]);
    expect(drafts[1]).toMatchObject({ loaded: 0, total: 20 });
  });

  test("progress, readiness and failure land only on the photo they belong to", () => {
    let drafts = twoUploading();
    drafts = progressDraft(drafts, "a", 5, 10);
    drafts = failDraft(drafts, "b", "Upload failed (500).");

    expect(drafts[0]).toMatchObject({ status: "uploading", loaded: 5, total: 10 });
    expect(drafts[1]).toMatchObject({ status: "error", message: "Upload failed (500)." });

    drafts = readyDraft(drafts, "a", "descriptor-a");
    expect(drafts[0]).toMatchObject({ status: "ready", ready: "descriptor-a" });
    expect(drafts[1].status).toBe("error");
  });

  test("a late progress report never turns a finished photo back into an upload", () => {
    let drafts = readyDraft(twoUploading(), "a", "descriptor-a");
    drafts = progressDraft(drafts, "a", 10, 10);

    expect(drafts[0].status).toBe("ready");
  });

  test("an upload that settles after its photo already did — a retry racing the first try — changes nothing", () => {
    let drafts = readyDraft(twoUploading(), "a", "descriptor-a");
    drafts = failDraft(drafts, "a", "the slower attempt failed");
    drafts = readyDraft(drafts, "a", "descriptor-from-the-slower-attempt");

    expect(drafts[0]).toMatchObject({ status: "ready", ready: "descriptor-a" });
  });

  test("removing one photo keeps the others, and an upload finishing after removal does not bring it back", () => {
    let drafts = removeDraft(twoUploading(), "a");
    drafts = readyDraft(drafts, "a", "descriptor-a");
    drafts = failDraft(drafts, "a", "late");

    expect(drafts.map((d) => d.id)).toEqual(["b"]);
  });

  test("retrying a failed photo uploads the same file again from zero", () => {
    let drafts = failDraft(twoUploading(), "b", "Upload failed.");
    drafts = retryDraft(drafts, "b");

    expect(drafts[1]).toMatchObject({ status: "uploading", loaded: 0, total: 20 });
    expect(drafts[1].file.name).toBe("b.png");
    expect(retryDraft(readyDraft(drafts, "b", "descriptor-b"), "b")[1].status).toBe("ready");
  });

  test("a message is sendable only when no photo is still uploading or failed", () => {
    const uploading = twoUploading();
    const oneReady = readyDraft(uploading, "a", "descriptor-a");
    const oneFailed = failDraft(oneReady, "b", "Upload failed.");
    const bothReady = readyDraft(oneReady, "b", "descriptor-b");

    expect(canSendWithDrafts("hi", [])).toBe(true);
    expect(canSendWithDrafts("  ", [])).toBe(false);
    expect(canSendWithDrafts("hi", oneReady)).toBe(false);
    expect(canSendWithDrafts("hi", oneFailed)).toBe(false);
    expect(canSendWithDrafts("", bothReady)).toBe(true);
    expect(canSendWithDrafts("", removeDraft(oneFailed, "b"))).toBe(true);
  });

  test("the ready payloads come out in the order the photos were picked", () => {
    let drafts = readyDraft(twoUploading(), "b", "descriptor-b");
    drafts = readyDraft(drafts, "a", "descriptor-a");

    expect(readyPayloads(drafts)).toEqual(["descriptor-a", "descriptor-b"]);
  });

  test("a photo that failed validation offers no Retry — the same file would fail the same way (#107)", () => {
    const drafts = invalidDraft(twoUploading(), "a", "Only images can be attached.");

    expect(drafts[0]).toMatchObject({ status: "error", message: "Only images can be attached.", retryable: false });
    expect(retryDraft(drafts, "a")[0].status).toBe("error");
  });

  test("a photo whose upload failed still offers Retry (#107)", () => {
    const drafts = failDraft(twoUploading(), "a", "Upload failed (500).");

    expect(drafts[0]).toMatchObject({ status: "error", retryable: true });
    expect(retryDraft(drafts, "a")[0].status).toBe("uploading");
  });
});

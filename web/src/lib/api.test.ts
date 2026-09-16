import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError, previewInvite, revokeInvite } from "./api";

// Every dynamic path segment goes through encodeURIComponent, which does not
// encode "." — so an Invite code of ".." became /api/invites/.., and the URL
// parser resolves that to a different endpoint than the one the call names,
// carrying the same headers. Sonar's taint analysis (tssecurity:S8476) found it.
describe("request paths", () => {
  const realFetch = globalThis.fetch;
  let fetched: string[];

  beforeEach(() => {
    fetched = [];
    globalThis.fetch = (async (input: string) => {
      fetched.push(input);
      return new Response(JSON.stringify({ workspace_name: "w", valid: true, reason: null }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a segment that is only dots never reaches fetch", async () => {
    await expect(previewInvite("..")).rejects.toBeInstanceOf(ApiError);
    await expect(previewInvite(".")).rejects.toBeInstanceOf(ApiError);
    expect(fetched).toEqual([]);
  });

  test("nor does it on a call that deletes", async () => {
    await expect(revokeInvite("family", "..", "Nostr token")).rejects.toBeInstanceOf(ApiError);
    expect(fetched).toEqual([]);
  });

  test("dots inside a segment are an ordinary value", async () => {
    await previewInvite("a.b");
    expect(fetched).toEqual(["/api/invites/a.b"]);
  });
});

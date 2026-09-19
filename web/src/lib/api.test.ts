import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as api from "./api";
import { ApiError, apiPath, previewInvite, proofUrl, redeemInvite, revokeInvite, workspaceProofUrl } from "./api";

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

/** The URL a NIP-98 proof signs has to be the one requested, and a code pasted by the person must
 * not choose what gets signed (#198): both come from one derivation. */
describe("apiPath and proofUrl", () => {
  const ORIGIN = "https://studio.example";
  const hostile = "a/b?c#d";

  test("encodes a segment's slash, query and fragment instead of letting them restructure the URL", () => {
    expect(apiPath("invites", hostile, "redeem")).toBe("/invites/a%2Fb%3Fc%23d/redeem");
  });

  test("refuses a segment that is only dots — the URL parser would walk up from it", () => {
    expect(() => apiPath("invites", "..", "redeem")).toThrow(ApiError);
    expect(() => apiPath("invites", ".")).toThrow(ApiError);
  });

  test("the proof URL is the origin, /api and the same path", () => {
    expect(proofUrl(apiPath("invites", hostile, "redeem"), ORIGIN)).toBe(`${ORIGIN}/api/invites/a%2Fb%3Fc%23d/redeem`);
  });

  test("a Workspace endpoint named by its path signs through apiPath too — the admin console's proofs", () => {
    expect(workspaceProofUrl("family", `/members/${"ab".repeat(32)}`, ORIGIN)).toBe(
      proofUrl(apiPath("workspaces", "family", "members", "ab".repeat(32)), ORIGIN),
    );
    expect(() => workspaceProofUrl("family", "/invites/..", ORIGIN)).toThrow(ApiError);
  });

  test("what a call fetches is what its proof signs", async () => {
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string) => {
      fetched.push(input);
      return new Response("{}");
    }) as typeof fetch;
    try {
      await redeemInvite(hostile, "Nostr token");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(`${ORIGIN}${fetched[0]}`).toBe(proofUrl(apiPath("invites", hostile, "redeem"), ORIGIN));
  });
});

/** Every call that puts a slug, code, pubkey or Channel id into its path builds it with
 * `apiPath` — the path each one fetches is the one a proof for it signs (#198). */
describe("each Workspace call requests its apiPath", () => {
  const S = "fam/ily";
  const P = "pub?key";
  const C = "chan#1";
  const T = "Nostr token";
  const calls: [string, () => Promise<unknown>, string, string][] = [
    ["getWorkspace", () => api.getWorkspace(S, T), apiPath("workspaces", S), "GET"],
    ["listChannels", () => api.listChannels(S, T), apiPath("workspaces", S, "channels"), "GET"],
    ["createInvite", () => api.createInvite(S, T), apiPath("workspaces", S, "invites"), "POST"],
    ["listInvites", () => api.listInvites(S, T), apiPath("workspaces", S, "invites"), "GET"],
    ["revokeInvite", () => api.revokeInvite(S, "co/de", T), apiPath("workspaces", S, "invites", "co/de"), "DELETE"],
    ["listWorkspaceMembers", () => api.listWorkspaceMembers(S, T), apiPath("workspaces", S, "members"), "GET"],
    ["setWorkspaceMemberRole", () => api.setWorkspaceMemberRole(S, P, "admin", T), apiPath("workspaces", S, "members", P), "PATCH"],
    ["removeWorkspaceMember", () => api.removeWorkspaceMember(S, P, T), apiPath("workspaces", S, "members", P), "DELETE"],
    ["createChannel", () => api.createChannel(S, T, { name: "n", about: "", private: false }), apiPath("workspaces", S, "channels"), "POST"],
    ["listChannelMembers", () => api.listChannelMembers(S, C, T), apiPath("workspaces", S, "channels", C, "members"), "GET"],
    ["addChannelMember", () => api.addChannelMember(S, C, P, "member", T), apiPath("workspaces", S, "channels", C, "members"), "POST"],
    ["removeChannelMember", () => api.removeChannelMember(S, C, P, T), apiPath("workspaces", S, "channels", C, "members", P), "DELETE"],
  ];

  for (const [name, call, path, method] of calls) {
    test(name, async () => {
      const realFetch = globalThis.fetch;
      const fetched: [string, string][] = [];
      globalThis.fetch = (async (input: string, init?: RequestInit) => {
        fetched.push([input, init?.method ?? "GET"]);
        return new Response("{}");
      }) as typeof fetch;
      try {
        await call();
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(fetched).toEqual([[`/api${path}`, method]]);
    });
  }
});

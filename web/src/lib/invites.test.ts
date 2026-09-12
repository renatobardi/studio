import { afterEach, describe, expect, test } from "bun:test";
import {
  describeInvite,
  inviteCodeFromUrl,
  inviteLimits,
  inviteLink,
  invitePreviewMessage,
  forgetInviteCode,
  pendingInviteCode,
  rememberInviteCode,
} from "./invites";
import type { InviteOut } from "./api";

const NOW = 1_757_000_000;

function invite(overrides: Partial<InviteOut> = {}): InviteOut {
  return {
    code: "abc123",
    role: "member",
    expires_at: null,
    max_uses: null,
    use_count: 0,
    revoked: false,
    ...overrides,
  };
}

describe("inviteCodeFromUrl", () => {
  test("reads the code an invite link carries", () => {
    expect(inviteCodeFromUrl("?invite=abc123")).toBe("abc123");
  });

  test("no code without the parameter", () => {
    expect(inviteCodeFromUrl("")).toBeNull();
    expect(inviteCodeFromUrl("?other=1")).toBeNull();
  });

  test("an empty or whitespace-only code is no code", () => {
    // ?invite= would otherwise put onboarding into "an invite is pending"
    // with nothing to preview.
    expect(inviteCodeFromUrl("?invite=")).toBeNull();
    expect(inviteCodeFromUrl("?invite=%20%20")).toBeNull();
  });

  test("trims, so a code copied with surrounding space still resolves", () => {
    expect(inviteCodeFromUrl("?invite=%20abc123%20")).toBe("abc123");
  });
});

describe("inviteLink", () => {
  test("is the app's own origin plus the code — what an admin pastes to somebody", () => {
    expect(inviteLink("https://studio.example", "abc123")).toBe(
      "https://studio.example/?invite=abc123",
    );
  });

  test("escapes a code that would otherwise change the query string", () => {
    expect(inviteLink("https://studio.example", "a&b=c")).toBe(
      "https://studio.example/?invite=a%26b%3Dc",
    );
  });
});

describe("inviteLimits", () => {
  test("no limits at all is the plain invite the API already took", () => {
    expect(inviteLimits({ expiresInDays: "", maxUses: "" }, NOW)).toEqual({
      ok: true,
      body: { expires_at: null, max_uses: null },
    });
  });

  test("days become an absolute expiry, because that is what the API stores", () => {
    expect(inviteLimits({ expiresInDays: "7", maxUses: "" }, NOW)).toEqual({
      ok: true,
      body: { expires_at: NOW + 7 * 86400, max_uses: null },
    });
  });

  test("a use limit passes through", () => {
    expect(inviteLimits({ expiresInDays: "", maxUses: "5" }, NOW)).toEqual({
      ok: true,
      body: { expires_at: null, max_uses: 5 },
    });
  });

  test.each([
    ["0", "Expiry must be at least one day."],
    ["-2", "Expiry must be at least one day."],
    ["x", "Expiry must be a whole number of days."],
    ["1.5", "Expiry must be a whole number of days."],
  ])("refuses an expiry of %p before the request is sent", (expiresInDays, error) => {
    expect(inviteLimits({ expiresInDays, maxUses: "" }, NOW)).toEqual({ ok: false, error });
  });

  test.each([
    ["0", "An invite must allow at least one use."],
    ["-1", "An invite must allow at least one use."],
    ["many", "The use limit must be a whole number."],
  ])("refuses a use limit of %p before the request is sent", (maxUses, error) => {
    expect(inviteLimits({ expiresInDays: "", maxUses }, NOW)).toEqual({ ok: false, error });
  });
});

describe("describeInvite", () => {
  test("an unlimited invite says so rather than showing empty limits", () => {
    expect(describeInvite(invite(), NOW)).toBe("active · 0 uses · never expires");
  });

  test("counts uses against the limit", () => {
    expect(describeInvite(invite({ max_uses: 5, use_count: 2 }), NOW)).toBe(
      "active · 2/5 uses · never expires",
    );
  });

  test("a revoked invite reads as revoked, whatever its limits say", () => {
    expect(describeInvite(invite({ revoked: true, max_uses: 5 }), NOW)).toBe(
      "revoked · 0/5 uses · never expires",
    );
  });

  test("an invite past its expiry is expired, not active", () => {
    expect(describeInvite(invite({ expires_at: NOW - 1 }), NOW)).toContain("expired");
  });

  test("an invite that spent its last use is exhausted", () => {
    expect(describeInvite(invite({ max_uses: 2, use_count: 2 }), NOW)).toBe(
      "exhausted · 2/2 uses · never expires",
    );
  });

  test("an expiry still ahead is shown as a date, so an admin can see which link to resend", () => {
    const description = describeInvite(invite({ expires_at: NOW + 86400 }), NOW);
    expect(description).toStartWith("active · 0 uses · expires ");
    expect(description).not.toContain("never expires");
  });
});

describe("invitePreviewMessage", () => {
  test.each([
    ["not_found", "No invite with that code. Check it and try again."],
    ["revoked", "This invite was revoked. Ask for a new one."],
    ["expired", "This invite has expired. Ask for a new one."],
    ["exhausted", "This invite has already been used up. Ask for a new one."],
  ])("%p is named, not lumped into 'not valid'", (reason, message) => {
    expect(invitePreviewMessage(reason)).toBe(message);
  });

  test("an unknown reason still says something actionable", () => {
    expect(invitePreviewMessage("something-new")).toBe(
      "This invite can't be used. Ask for a new one.",
    );
  });

  test("no reason at all is still a message — an empty banner is a dead end", () => {
    expect(invitePreviewMessage(null)).toBe("This invite can't be used. Ask for a new one.");
  });
});

describe("the pending invite", () => {
  function stubStorage() {
    const entries = new Map<string, string>();
    // @ts-expect-error minimal localStorage stub for these tests
    globalThis.localStorage = {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => void entries.set(k, v),
      removeItem: (k: string) => void entries.delete(k),
    };
    return entries;
  }

  afterEach(() => {
    // @ts-expect-error test-only cleanup of a global stubbed above
    delete globalThis.localStorage;
  });

  test("an invite opened as a link survives sign-in and onboarding", () => {
    stubStorage();
    rememberInviteCode("abc123");
    expect(pendingInviteCode()).toBe("abc123");
  });

  test("nothing pending when no link was opened", () => {
    stubStorage();
    expect(pendingInviteCode()).toBeNull();
  });

  test("forgetting it is what stops a redeemed code from haunting the next sign-in", () => {
    stubStorage();
    rememberInviteCode("abc123");
    forgetInviteCode();
    expect(pendingInviteCode()).toBeNull();
  });

  test("storage that refuses to answer is no invite, not a crash", () => {
    // Private browsing and blocked site data both throw here, and an invite
    // nobody can remember must not take the whole app down with it.
    // @ts-expect-error deliberately hostile storage stub
    globalThis.localStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    };
    expect(() => rememberInviteCode("abc123")).not.toThrow();
    expect(pendingInviteCode()).toBeNull();
    expect(() => forgetInviteCode()).not.toThrow();
  });
});

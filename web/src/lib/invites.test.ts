import { afterEach, describe, expect, test } from "bun:test";
import {
  describeInvite,
  INITIAL_INVITE_STEP,
  inviteCodeFromInput,
  inviteCodeFromUrl,
  inviteLimits,
  inviteLink,
  invitePolicyError,
  invitePreviewMessage,
  inviteFieldHint,
  inviteStepHandlers,
  submitInviteStep,
  withAgeAccepted,
  withNoInviteToggled,
  withTermsAccepted,
  forgetInviteCode,
  pendingInviteCode,
  rememberInviteCode,
} from "./invites";
import type { InviteStepState } from "./invites";
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
    state: "active",
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

describe("inviteCodeFromInput", () => {
  test("takes the link an admin copied, as it was copied", () => {
    expect(inviteCodeFromInput("https://studio.example/?invite=abc123")).toBe("abc123");
  });

  test("a link that is not one is no code, however much it looks like a URL", () => {
    // `new URL` throws on this, and a scheme with nothing after it was never
    // somebody's invite code.
    expect(inviteCodeFromInput("https://")).toBeNull();
  });

  test("the link is the one inviteLink builds, so what one side hands out the other reads", () => {
    expect(inviteCodeFromInput(inviteLink("https://studio.example", "a&b=c"))).toBe("a&b=c");
  });

  test("takes a bare code too", () => {
    expect(inviteCodeFromInput("abc123")).toBe("abc123");
  });

  test("ignores space pasted around either", () => {
    expect(inviteCodeFromInput("  abc123 \n")).toBe("abc123");
    expect(inviteCodeFromInput(" https://studio.example/?invite=abc123 ")).toBe("abc123");
  });

  test("a link that carries no invite is no code — not a code that looks like a URL", () => {
    // Sent to the server as a code it would only come back "not found", which
    // reads as a typo in something the person never typed.
    expect(inviteCodeFromInput("https://studio.example/")).toBeNull();
    expect(inviteCodeFromInput("https://studio.example/?invite=")).toBeNull();
  });

  test("nothing pasted is no code", () => {
    expect(inviteCodeFromInput("")).toBeNull();
    expect(inviteCodeFromInput("   ")).toBeNull();
  });
});

describe("invitePolicyError", () => {
  test("both confirmed lets the invite through", () => {
    expect(invitePolicyError({ age: true, terms: true })).toBeNull();
  });

  test("the age comes first, as the prototype asks", () => {
    expect(invitePolicyError({ age: false, terms: false })).toBe("Confirm that you are at least 18 years old.");
    expect(invitePolicyError({ age: false, terms: true })).toBe("Confirm that you are at least 18 years old.");
  });

  test("then the terms", () => {
    expect(invitePolicyError({ age: true, terms: false })).toBe(
      "Agree to the Terms of Service and Privacy Policy.",
    );
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
    expect(describeInvite(invite())).toBe("active · 0 uses · never expires");
  });

  test("counts uses against the limit", () => {
    expect(describeInvite(invite({ max_uses: 5, use_count: 2 }))).toBe(
      "active · 2/5 uses · never expires",
    );
  });

  test("reports the server's state rather than re-deciding it here", () => {
    // The rule for what "exhausted" means lives in the API (invite_state);
    // a second copy here would be free to drift from the one redemption uses.
    expect(describeInvite(invite({ state: "revoked", max_uses: 5 }))).toBe(
      "revoked · 0/5 uses · never expires",
    );
    expect(describeInvite(invite({ state: "exhausted", max_uses: 2, use_count: 2 }))).toBe(
      "exhausted · 2/2 uses · never expires",
    );
  });

  test("an expiry is shown as a date, so an admin can see which link to resend", () => {
    const description = describeInvite(invite({ expires_at: NOW + 86400 }));
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

describe("the invite step's state", () => {
  test("starts with nothing agreed, nothing refused and the other ways in closed", () => {
    expect(INITIAL_INVITE_STEP).toEqual({ age: false, terms: false, policyError: null, noInvite: false });
  });

  test("ticking a box takes the refusal away, because it was about that box", () => {
    const refused = { ...INITIAL_INVITE_STEP, policyError: "Confirm that you are at least 18 years old." };
    expect(withAgeAccepted(refused, true)).toEqual({ age: true, terms: false, policyError: null, noInvite: false });
    expect(withTermsAccepted(refused, true)).toEqual({ age: false, terms: true, policyError: null, noInvite: false });
  });

  test("unticking a box is remembered too", () => {
    const agreed = withTermsAccepted(withAgeAccepted(INITIAL_INVITE_STEP, true), true);
    expect(withAgeAccepted(agreed, false).age).toBe(false);
    expect(withTermsAccepted(agreed, false).terms).toBe(false);
  });

  test("\"I don't have an invite\" opens and closes the ways in that need none", () => {
    const open = withNoInviteToggled(INITIAL_INVITE_STEP);
    expect(open.noInvite).toBe(true);
    expect(withNoInviteToggled(open).noInvite).toBe(false);
  });

  test("toggling it leaves what was already agreed alone", () => {
    const agreed = withTermsAccepted(withAgeAccepted(INITIAL_INVITE_STEP, true), true);
    expect(withNoInviteToggled(agreed)).toEqual({ ...agreed, noInvite: true });
  });
});

describe("submitInviteStep", () => {
  const agreed = { ...INITIAL_INVITE_STEP, age: true, terms: true };

  test("hands over the code an invite link carries", () => {
    const attempt = submitInviteStep(agreed, " https://studio.example/?invite=abc123 ");
    expect(attempt.code).toBe("abc123");
    expect(attempt.error).toBeNull();
    expect(attempt.state.policyError).toBeNull();
  });

  test("a bare code is a code", () => {
    expect(submitInviteStep(agreed, "abc123").code).toBe("abc123");
  });

  test("consent is asked for before the server is, and age comes first", () => {
    // Previewing a code nobody has agreed to would answer "this invite is
    // good" to somebody who is not allowed to use it.
    const refused = submitInviteStep(INITIAL_INVITE_STEP, "abc123");
    expect(refused.code).toBeNull();
    expect(refused.state.policyError).toBe("Confirm that you are at least 18 years old.");
    // The banner stays out of it: the refusal belongs under the boxes.
    expect(refused.error).toBeNull();
  });

  test("the terms are what is left to agree to once the age is confirmed", () => {
    const attempt = submitInviteStep({ ...INITIAL_INVITE_STEP, age: true }, "abc123");
    expect(attempt.code).toBeNull();
    expect(attempt.state.policyError).toBe("Agree to the Terms of Service and Privacy Policy.");
  });

  test("nothing to redeem asks for the link in the banner, not under the boxes", () => {
    for (const typed of ["", "   ", "https://studio.example/", "https://"]) {
      const attempt = submitInviteStep(agreed, typed);
      expect(attempt.code).toBeNull();
      expect(attempt.error).toBe("Paste the invite link you were sent, or just its code.");
      expect(attempt.state.policyError).toBeNull();
    }
  });

  test("a refusal that has been answered does not survive the next press", () => {
    const stale = { ...agreed, policyError: "Confirm that you are at least 18 years old." };
    expect(submitInviteStep(stale, "abc123").state.policyError).toBeNull();
  });
});

describe("inviteFieldHint", () => {
  test("names the Workspace once the code is known to admit to one", () => {
    expect(inviteFieldHint("Family")).toBe("Joining Family");
  });

  test("until then it says what the link looks like", () => {
    expect(inviteFieldHint(null)).toBe("The link should start with https://");
  });
});

describe("the invite step's controls", () => {
  const agreed = { ...INITIAL_INVITE_STEP, age: true, terms: true };

  function wire(state = INITIAL_INVITE_STEP, typed = "abc123") {
    const states: InviteStepState[] = [];
    const errors: string[] = [];
    const redeemed: string[] = [];
    const handlers = inviteStepHandlers({
      state,
      typed,
      setState: (next) => states.push(next),
      setError: (message) => errors.push(message),
      redeem: (code) => redeemed.push(code),
    });
    return { handlers, states, errors, redeemed };
  }

  test("the boxes report what they were set to", () => {
    const age = wire();
    age.handlers.onAge({ target: { checked: true } });
    expect(age.states).toEqual([{ ...INITIAL_INVITE_STEP, age: true }]);

    const terms = wire();
    terms.handlers.onTerms({ target: { checked: true } });
    expect(terms.states).toEqual([{ ...INITIAL_INVITE_STEP, terms: true }]);

    const unticked = wire(agreed);
    unticked.handlers.onAge({ target: { checked: false } });
    expect(unticked.states[0]?.age).toBe(false);
  });

  test("\"I don't have an invite\" opens the other ways in", () => {
    const { handlers, states } = wire();
    handlers.onNoInvite();
    expect(states).toEqual([{ ...INITIAL_INVITE_STEP, noInvite: true }]);
  });

  test("the button hands the code over once both boxes are ticked", () => {
    const { handlers, states, errors, redeemed } = wire(agreed, "https://studio.example/?invite=abc123");
    handlers.onSubmit();
    expect(redeemed).toEqual(["abc123"]);
    expect(errors).toEqual([]);
    expect(states[0]?.policyError).toBeNull();
  });

  test("without consent it redeems nothing and says which box is missing", () => {
    const { handlers, states, errors, redeemed } = wire();
    handlers.onSubmit();
    expect(redeemed).toEqual([]);
    expect(errors).toEqual([]);
    expect(states[0]?.policyError).toBe("Confirm that you are at least 18 years old.");
  });

  test("with consent but nothing to redeem it asks for the link in the banner", () => {
    const { handlers, errors, redeemed } = wire(agreed, "   ");
    handlers.onSubmit();
    expect(redeemed).toEqual([]);
    expect(errors).toEqual(["Paste the invite link you were sent, or just its code."]);
  });
});

import { describe, expect, test } from "bun:test";
import { authCopy } from "./authCopy";

/** Title, subtitle, CTA, the link under the card and the footnote of each auth step, as the
 * prototype's `authCopy` table has them (docs/UI/design/Studio.dc.html). */
describe("authCopy", () => {
  test("sign in", () => {
    expect(authCopy("signin")).toEqual({
      title: "Sign in to Studio",
      body: "Use your email and password, or continue with Google.",
      ctaLabel: "Sign in",
      switchLabel: "Don’t have an account? Create one",
      switchStep: "signup",
      footnote: "Studio signs you in with Firebase Authentication, then creates your Nostr identity key.",
    });
  });

  test("create account", () => {
    const copy = authCopy("signup");
    expect(copy.title).toBe("Create your Studio account");
    expect(copy.ctaLabel).toBe("Create account");
    expect(copy.switchLabel).toBe("Already have an account? Sign in");
    expect(copy.switchStep).toBe("signin");
  });

  test("verify goes back to sign-up with a different email", () => {
    const copy = authCopy("verify");
    expect(copy.title).toBe("Verify your email");
    expect(copy.ctaLabel).toBe("I verified — continue");
    expect(copy.switchLabel).toBe("Use a different email");
    expect(copy.switchStep).toBe("signup");
  });

  test("reset and sent", () => {
    expect(authCopy("reset").ctaLabel).toBe("Send reset link");
    expect(authCopy("reset").switchLabel).toBe("Back to sign in");
    expect(authCopy("sent").title).toBe("Check your inbox");
    expect(authCopy("sent").ctaLabel).toBe("Back to sign in");
    expect(authCopy("sent").switchLabel).toBeNull();
  });
});

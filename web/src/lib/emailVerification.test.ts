import { describe, expect, test } from "bun:test";
import { isEmailVerified } from "./emailVerification";

describe("isEmailVerified", () => {
  test("a password Account is verified only once the link is clicked", () => {
    const user = { emailVerified: false, providerData: [{ providerId: "password" }] };
    expect(isEmailVerified(user)).toBe(false);
    expect(isEmailVerified({ ...user, emailVerified: true })).toBe(true);
  });

  test("a federated Account is verified by construction", () => {
    // Google already proved the address; there is no link for Studio to gate on.
    expect(isEmailVerified({ emailVerified: false, providerData: [{ providerId: "google.com" }] })).toBe(
      true,
    );
  });

  test("nobody signed in is not verified", () => {
    expect(isEmailVerified(null)).toBe(false);
  });
});

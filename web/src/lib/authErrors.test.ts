import { describe, expect, test } from "bun:test";
import { mapFirebaseErrorCode } from "./authErrors";

describe("mapFirebaseErrorCode", () => {
  test("maps known Firebase error codes to Studio copy", () => {
    expect(mapFirebaseErrorCode("auth/invalid-credential")).toBe(
      "That email and password don't match an account.",
    );
    expect(mapFirebaseErrorCode("auth/user-not-found")).toBe(
      "No account uses that email yet. Create one instead.",
    );
    expect(mapFirebaseErrorCode("auth/email-already-in-use")).toBe(
      "An account already uses that email. Sign in instead.",
    );
    expect(mapFirebaseErrorCode("auth/network-request-failed")).toBe(
      "Studio couldn't reach Firebase. Check your connection and try again.",
    );
  });

  test("maps the codes the sign-in, reset and Google paths can actually raise", () => {
    // Every one of these was reaching the user as "Something went wrong. Try again."
    expect(mapFirebaseErrorCode("auth/wrong-password")).toBe(
      "That email and password don't match an account.",
    );
    expect(mapFirebaseErrorCode("auth/invalid-email")).toBe("That email address isn't valid.");
    expect(mapFirebaseErrorCode("auth/weak-password")).toBe("Use 8 characters or more.");
    expect(mapFirebaseErrorCode("auth/user-disabled")).toBe(
      "That account is disabled. Ask whoever runs this server.",
    );
    expect(mapFirebaseErrorCode("auth/too-many-requests")).toBe(
      "Too many attempts. Wait a minute and try again.",
    );
    expect(mapFirebaseErrorCode("auth/popup-closed-by-user")).toBe(
      "The Google window closed before sign-in finished.",
    );
    expect(mapFirebaseErrorCode("auth/popup-blocked")).toBe(
      "Your browser blocked the Google window. Allow popups for Studio and try again.",
    );
    expect(mapFirebaseErrorCode("auth/account-exists-with-different-credential")).toBe(
      "That email already signs in another way. Use the password form instead.",
    );
  });

  test("falls back to a generic message for unmapped codes", () => {
    expect(mapFirebaseErrorCode("auth/something-unexpected")).toBe(
      "Something went wrong. Try again.",
    );
  });
});

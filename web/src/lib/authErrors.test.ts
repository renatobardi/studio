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

  test("falls back to a generic message for unmapped codes", () => {
    expect(mapFirebaseErrorCode("auth/something-unexpected")).toBe(
      "Something went wrong. Try again.",
    );
  });
});

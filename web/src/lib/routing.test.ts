import { describe, expect, test } from "bun:test";
import { resolveInitialView } from "./routing";

describe("resolveInitialView", () => {
  test("no Account -> auth", () => {
    expect(resolveInitialView({ account: null, hasIdentity: false })).toBe("auth");
  });

  test("Account without Identity -> onboarding", () => {
    expect(resolveInitialView({ account: { uid: "u1", email: "a@b.com" }, hasIdentity: false })).toBe(
      "onboarding",
    );
  });

  test("Account with Identity -> app", () => {
    expect(resolveInitialView({ account: { uid: "u1", email: "a@b.com" }, hasIdentity: true })).toBe(
      "app",
    );
  });
});

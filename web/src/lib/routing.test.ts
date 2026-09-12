import { describe, expect, test } from "bun:test";
import { resolveInitialView } from "./routing";

describe("resolveInitialView", () => {
  test("no Account -> auth", () => {
    expect(resolveInitialView({ account: null, hasIdentity: false, hasWorkspace: false })).toBe(
      "auth",
    );
  });

  test("Account without Identity -> onboarding", () => {
    expect(
      resolveInitialView({
        account: { uid: "u1", email: "a@b.com" },
        hasIdentity: false,
        hasWorkspace: false,
      }),
    ).toBe("onboarding");
  });

  test("Account with Identity and Workspace -> app", () => {
    expect(
      resolveInitialView({
        account: { uid: "u1", email: "a@b.com" },
        hasIdentity: true,
        hasWorkspace: true,
      }),
    ).toBe("app");
  });
});

describe("resolveInitialView without a Workspace", () => {
  const account = { uid: "u1", email: "a@b.com" };

  test("an Identity that reached no Workspace goes back to onboarding", () => {
    // The key is stored the moment it is linked or restored, so an
    // interruption before joining a Workspace is reachable — and the app
    // shell has nothing to show for it (#36).
    expect(resolveInitialView({ account, hasIdentity: true, hasWorkspace: false })).toBe(
      "onboarding",
    );
  });

  test("Account, Identity and Workspace -> app", () => {
    expect(resolveInitialView({ account, hasIdentity: true, hasWorkspace: true })).toBe("app");
  });
});

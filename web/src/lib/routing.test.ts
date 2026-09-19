import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as React from "react";
import { accountPasswordKeptFor, resolveInitialView, useAppView } from "./routing";

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

/** #189: the typed Account password lives only as long as onboarding may still need it — never in
 * the signed-in app, and never past sign-out. */
describe("accountPasswordKeptFor", () => {
  test("signing out lets go of it", () => {
    expect(accountPasswordKeptFor("auth", "hunter22")).toBeNull();
  });

  test("the signed-in app never holds it", () => {
    expect(accountPasswordKeptFor("app", "hunter22")).toBeNull();
  });

  test("onboarding keeps it, to tell the Key Backup passphrase apart from it", () => {
    expect(accountPasswordKeptFor("onboarding", "hunter22")).toBe("hunter22");
  });

  test("the boot in between keeps it, so onboarding still gets it", () => {
    expect(accountPasswordKeptFor("loading", "hunter22")).toBe("hunter22");
  });
});

/** The App's view and password together: moving to a view re-applies the rule above. */
describe("useAppView", () => {
  afterEach(() => {
    spyOn(React, "useState").mockRestore();
    spyOn(React, "useCallback").mockRestore();
  });

  /** Moves a hook that already holds "hunter22" to `view`, and returns what it still holds. */
  function heldAfterMovingTo(view: "loading" | "auth" | "onboarding" | "app"): string | null {
    let held: string | null = "hunter22";
    const setHeld = (next: string | null | ((current: string | null) => string | null)) => {
      held = typeof next === "function" ? next(held) : next;
    };
    spyOn(React, "useState")
      .mockReturnValueOnce(["onboarding", () => {}] as never)
      .mockReturnValueOnce([held, setHeld] as never);
    spyOn(React, "useCallback").mockImplementation((callback) => callback);

    // oxlint-disable-next-line react-hooks/rules-of-hooks -- called outside React on purpose, with useState stubbed
    useAppView().setView(view);
    return held;
  }

  test("signing out drops what was typed", () => {
    expect(heldAfterMovingTo("auth")).toBeNull();
  });

  test("reaching the signed-in app drops it", () => {
    expect(heldAfterMovingTo("app")).toBeNull();
  });

  test("onboarding keeps it", () => {
    expect(heldAfterMovingTo("onboarding")).toBe("hunter22");
  });
});

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { User } from "firebase/auth";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import * as api from "./lib/api";
import { forgetInviteCode } from "./lib/invites";
import { OnboardingScreen } from "./routes/onboarding/OnboardingScreen";

const user = {
  email: "someone@studio.test",
  providerData: [{ providerId: "password" }],
  getIdToken: async () => "id-token",
} as unknown as User;

describe("an invite opened as a link", () => {
  afterEach(forgetInviteCode);
  // `spyOn` patches the module namespace for the whole process, so a spy left standing answers
  // the next file's tests — in an order that differs in CI.
  afterEach(() => mock.restore());

  test("survives the trip from the URL to the onboarding invite step (#46)", async () => {
    // Six lines of wiring apiece — App.tsx takes the code off the URL at boot, OnboardingScreen
    // reads it back when the person finally gets there — with sign-in and email verification in
    // between. Every piece is covered in lib/invites.ts; that the two meet was not, which is the
    // gap this harness exists for (#94).
    spyOn(api, "getAccount").mockResolvedValue({ uid: "u", email: "someone@studio.test", pubkey: null });
    spyOn(api, "hasKeyBackup").mockResolvedValue(false);
    const previewInvite = spyOn(api, "previewInvite").mockResolvedValue({
      workspace_name: "Family",
      valid: true,
      reason: null,
    });
    forgetInviteCode();
    window.history.replaceState(null, "", "/?invite=abc123");

    render(<App />);
    // Off the address bar: a reload, or a link shared out of it, must not carry the code again.
    await waitFor(() => expect(window.location.search).toBe(""));
    cleanup();

    render(<OnboardingScreen user={user} account={null} accountPassword={null} onComplete={() => {}} />);

    // The Workspace it names is the invite's, which is only knowable from the remembered code.
    await waitFor(() => expect(previewInvite).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByPlaceholderText(/paste a code/i)).toHaveProperty("value", "abc123");
  });
});

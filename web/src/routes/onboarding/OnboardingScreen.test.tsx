import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { User } from "firebase/auth";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../lib/api";
import { clearIdentity } from "../../lib/custody";
import { NOT_STORED_MESSAGE } from "../../lib/keyBackup";
import { OnboardingScreen } from "./OnboardingScreen";

const user = {
  email: "someone@studio.test",
  providerData: [{ providerId: "password" }],
  getIdToken: async () => "id-token",
} as unknown as User;

const PASSPHRASE = "correct horse battery staple";

describe("onboarding's Key Backup, when the file works but the Account does not take it", () => {
  // Both outlive the test otherwise: `spyOn` patches the module namespace for the whole process,
  // and verifying stores the new Identity in IndexedDB, where the next file to mount App or the
  // restore path would find a key it never made.
  afterEach(async () => {
    mock.restore();
    await clearIdentity();
  });

  test("stays on the step and offers to try again, instead of calling it verified (#224)", async () => {
    // The rule is `confirmKeyBackup` / `keyBackupStep`, tested in lib/. What only the screen
    // shows is that the step it moves to hangs on `backupStored`, not on the file having
    // unlocked — a regression back to "verified is enough" would pass every lib test (#94).
    spyOn(api, "getAccount").mockResolvedValue({ uid: "u", email: "someone@studio.test", pubkey: null });
    spyOn(api, "hasKeyBackup").mockResolvedValue(false);
    spyOn(api, "previewInvite").mockResolvedValue({ workspace_name: "Family", valid: true, reason: null });
    spyOn(api, "linkIdentity").mockImplementation(async () => ({ uid: "u", email: "someone@studio.test", pubkey: "linked" }));
    const upload = spyOn(api, "putKeyBackup").mockRejectedValue(new api.ApiError(503, "unavailable"));
    const person = userEvent.setup();

    // Signed in moments ago, so the Account password is still in memory — the Key Backup
    // passphrase is checked against it, and without it the step would ask for it first.
    render(<OnboardingScreen user={user} account={null} accountPassword="account-password" onComplete={() => {}} />);

    // Invite — checked against the server here, and only redeemed at the end.
    await person.type(await screen.findByPlaceholderText(/paste a code/i), "abc123");
    await person.click(screen.getByRole("checkbox", { name: /18 years old/i }));
    await person.click(screen.getByRole("checkbox", { name: /Terms of Service/i }));
    await person.click(screen.getByRole("button", { name: /Accept and redeem invite/i }));
    // Profile, avatar, and the step that explains the backup.
    await person.type(await screen.findByLabelText("Name"), "Renato");
    await person.click(screen.getByRole("button", { name: "Continue" }));
    await person.click(await screen.findByRole("button", { name: "Continue" }));
    await person.click(await screen.findByRole("button", { name: "Continue" }));
    // The passphrase, and the file it locks — real encryption, so the file really does unlock.
    await person.type(await screen.findByPlaceholderText("Backup passphrase"), PASSPHRASE);
    await person.type(screen.getByPlaceholderText("Confirm passphrase"), PASSPHRASE);
    await person.click(screen.getByRole("button", { name: /Create backup/i }));
    // Verify: the file opens, and the upload to the Account fails.
    await person.type(await screen.findByPlaceholderText("Backup passphrase"), PASSPHRASE);
    await person.click(screen.getByRole("button", { name: "Verify" }));

    // The error is what says the upload was tried and failed: the heading alone changes the
    // moment the file unlocks, before the link, the local key and the upload have run.
    expect(await screen.findByText(NOT_STORED_MESSAGE)).toBeDefined();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Your backup file works")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.queryByText("Your backup is verified")).toBeNull();
    // Real age encryption, twice (scrypt), through a dozen clicks: ~1.8 s in the full suite here,
    // more on a shared CI runner. The default 5 s leaves too little room for that.
  }, 15_000);
});

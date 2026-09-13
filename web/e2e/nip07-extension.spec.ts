import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey } from "nostr-tools";
import {
  ensureChannelMembership,
  installFakeNip07,
  signIn,
  testExtensionAccount,
  testInviteCode,
} from "./helpers";

/**
 * Flow 9 (#75): onboarding under a NIP-07 extension, including the two ways an
 * extension fails to cooperate. Chromium here has no real extension, so
 * `window.nostr` is the fake in helpers.ts — real signatures, Node-side key.
 *
 * The failure paths deliberately present a key that is *not* the Account's
 * linked Identity: nothing is written server-side before the step each test
 * asserts on, and a non-matching key guarantees the app opens on onboarding
 * instead of resuming a session, whatever earlier runs left behind.
 */
test.use({ storageState: undefined });

const strangerKeyHex = () => bytesToHex(generateSecretKey());

const credentials = () => ({
  email: testExtensionAccount.email(),
  password: testExtensionAccount.password(),
});

test("a refused extension says so, keeps what was typed, and lets you retry", async ({ page }) => {
  const fake = await installFakeNip07(page, { privateKeyHex: strangerKeyHex(), refusing: true });

  await signIn(page, credentials());
  await expect(page.getByRole("heading", { name: "Enter your invite" })).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("Invite code").fill(testInviteCode());
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Your name").fill("E2E Extension Person");
  await page.getByRole("button", { name: "Continue" }).click();

  // The extension is named as the origin, and what to do about it — not the
  // step's generic "couldn't do that".
  await expect(page.getByText(/extension didn't hand over your Identity/)).toBeVisible();
  await expect(page.getByText(/Approve it in the extension/)).toBeVisible();
  // Nothing typed was lost, so trying again is literally trying again.
  await expect(page.getByPlaceholder("Your name")).toHaveValue("E2E Extension Person");

  fake.setRefusing(false);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Pick an avatar" })).toBeVisible();
});

test("an extension without NIP-44 is turned away before anything is joined", async ({ page }) => {
  await installFakeNip07(page, { privateKeyHex: strangerKeyHex(), nip44: false });

  await signIn(page, credentials());

  await expect(page.getByTestId("nip44-unsupported")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/needs for Direct Messages/)).toBeVisible();
  await expect(page.getByText(/turn it off and reload/)).toBeVisible();
  // Before the invite, not on the first Direct Message — and with no Identity
  // of our own generated as a way around it (ADR-0005).
  await expect(page.getByRole("heading", { name: "Enter your invite" })).toHaveCount(0);
  await expect(page.locator(".nsec-reveal")).toHaveCount(0);
});

test("first access with an extension onboards on the extension's own Identity", async ({ page }) => {
  const fake = await installFakeNip07(page, { privateKeyHex: testExtensionAccount.privateKeyHex() });

  await signIn(page, credentials());
  const inviteStep = page.getByRole("heading", { name: "Enter your invite" });
  await inviteStep.or(page.getByText(/Connected as/)).first().waitFor({ timeout: 15_000 });
  // Onboarding is a one-time state for any Account: once this one has linked
  // the extension's Identity, only the resume flow below is left to assert.
  test.skip(!(await inviteStep.isVisible()), "this Account already onboarded — re-seed to exercise first access");

  await page.getByPlaceholder("Invite code").fill(testInviteCode());
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Your name").fill("E2E Extension Person");
  await page.getByRole("button", { name: "Continue" }).click();
  // No Key Backup steps at all: the extension holds the key and never exports
  // it, so there is nothing to back up (ADR-0005).
  await expect(page.getByRole("heading", { name: "Pick an avatar" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".nsec-reveal")).toHaveCount(0);

  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  // The Identity that was onboarded is the extension's, with no second one
  // minted alongside it.
  await expect(page.getByTestId("own-pubkey")).toHaveText(fake.pubkey);
  await ensureChannelMembership(page.url(), fake.pubkey);

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText(/Connected as/)).toBeVisible();
});

test("reload, signing and sign-out all go through the extension", async ({ page }) => {
  const fake = await installFakeNip07(page, { privateKeyHex: testExtensionAccount.privateKeyHex() });
  await reachApp(page, fake.pubkey);

  // Reload: the session resumes from the extension, with no onboarding and no
  // passphrase — there is no Key Backup under this custody.
  await page.reload();
  await expect(page.getByText(/Connected as/)).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("channel-list-item").first().click();
  const content = `e2e extension message ${Date.now()}`;
  await page.getByTestId("message-composer").fill(content);
  await page.getByTestId("message-composer").press("Enter");
  // Signed by the extension: the relay accepted both the NIP-42 auth and the
  // Message itself, so the signature is the extension's and it verifies.
  await expect(page.getByTestId("timeline-message").filter({ hasText: content })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

/** Into the app shell with the extension holding the key — by resuming when the
 * Account already linked that Identity, or by onboarding the first time. */
async function reachApp(page: import("@playwright/test").Page, pubkey: string): Promise<void> {
  await signIn(page, credentials());
  const inviteStep = page.getByRole("heading", { name: "Enter your invite" });
  const shell = page.getByText(/Connected as/);
  await inviteStep.or(shell).first().waitFor({ timeout: 15_000 });
  if (await shell.isVisible()) return;

  await page.getByPlaceholder("Invite code").fill(testInviteCode());
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("Your name").fill("E2E Extension Person");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // avatar: keep default
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  await ensureChannelMembership(page.url(), pubkey);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(shell).toBeVisible();
}

import { expect, test } from "@playwright/test";
import { reachAppViaRestore, sharedChannelItem, testAccount, testBackupPassphrase } from "./helpers";

// Flow 5: fresh browser context (no local IndexedDB state), sign in, restore
// the Identity from the server-held Key Backup, reconnect to the relay, and
// find the Channel history written before the restore. Needs the Account's
// Key Backup to exist already — it does on every seeded test Account.
test.use({ storageState: undefined });

test("restore Identity from Key Backup on a fresh browser, with no invite, and see earlier history", async ({
  browser,
}) => {
  // --- History to come back to, written by this Identity in a browser that is then thrown away.
  const earlier = await browser.newContext();
  const earlierPage = await earlier.newPage();
  await reachAppViaRestore(earlierPage);
  await sharedChannelItem(earlierPage).click();
  const history = `e2e history before restore ${Date.now()}`;
  await earlierPage.getByTestId("message-composer").fill(history);
  await earlierPage.getByTestId("message-composer").press("Enter");
  await expect(earlierPage.getByTestId("timeline-message").filter({ hasText: history })).toBeVisible({
    timeout: 10_000,
  });
  await earlier.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");

  await page.getByLabel("Email").fill(testAccount.email());
  await page.getByLabel("Password", { exact: true }).fill(testAccount.password());
  await page.getByRole("button", { name: "Sign in" }).click();

  // An Account that already has an Identity opens straight on restore: no
  // invite is asked for, so an expired, revoked or already-spent invite can
  // never stand between someone and their own account (#36).
  await expect(page.getByRole("heading", { name: "Restore your Identity" })).toBeVisible();
  await expect(page.getByLabel(/^Invite (link or )?code$/)).toHaveCount(0);

  await page.getByPlaceholder("Backup passphrase").fill(testBackupPassphrase());
  await page.getByRole("button", { name: "Restore" }).click();

  await page.getByRole("button", { name: /^Connect/ }).first().click();
  await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByTestId("account-menu-button")).toBeVisible();

  // Nothing of it was left in this browser: it can only have come back from the relay.
  await sharedChannelItem(page).click();
  await expect(page.getByTestId("timeline-message").filter({ hasText: history })).toBeVisible({ timeout: 15_000 });
  await context.close();
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  reachAppViaRestoreWithCredentials,
  testAccount,
  testAccountTwo,
  testBackupPassphrase,
  testBackupPassphraseTwo,
} from "./helpers";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/test-image.png");
const MEDIA_PATH = /\/media\/[0-9a-f]{64}/;

// Flow 8 (#39): two Identities sharing one browser profile, with the
// service worker active — the shape the bug lived in. What A downloaded must
// not answer B's request, and signing out must leave nothing of it behind.
test.use({ storageState: undefined });

/** The names of the media caches this origin currently holds. */
function mediaCacheNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("studio-media")));
}

async function signOut(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 15_000 });
}

test("cached media neither survives sign-out nor crosses to the next Identity", async ({ page }) => {
  // Every blob fetch, split at the handover: what A downloaded, and what B
  // had to go and download for itself.
  const servedToA: string[] = [];
  const servedToB: string[] = [];
  let served = servedToA;
  page.on("response", (response) => {
    if (MEDIA_PATH.test(new URL(response.url()).pathname)) served.push(response.url());
  });

  // B goes first only so A can address a Direct Message photo to it: both
  // Identities have to live in the same browser profile for this flow.
  const pubkeyB = await reachAppViaRestoreWithCredentials(page, {
    email: testAccountTwo.email(),
    password: testAccountTwo.password(),
    backupPassphrase: testBackupPassphraseTwo(),
  });
  await signOut(page);

  const pubkeyA = await reachAppViaRestoreWithCredentials(page, {
    email: testAccount.email(),
    password: testAccount.password(),
    backupPassphrase: testBackupPassphrase(),
  });
  await expect(page.getByText(/Connected as/)).toBeVisible();

  // The regression guarded here is a service worker answering `/media/…` by
  // URL, ahead of any authorization — so the worker has to be running, and
  // this browser has to be under its control.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? null)).toBe("activated");
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 15_000 })
    .toBe(true);

  servedToA.length = 0; // from here on, everything recorded is A's own doing

  // --- A attaches a photo to a Channel Message.
  await page.getByTestId("channel-list-item").first().click();
  await page.getByTestId("attach-input").setInputFiles(TEST_IMAGE);
  await expect(page.getByTestId("attachment-preview")).toBeVisible();
  const channelContent = `e2e cache ${Date.now()}`;
  await page.getByTestId("message-composer").fill(channelContent);
  await page.getByRole("button", { name: "Send" }).click();
  const channelMessage = page.getByTestId("timeline-message").filter({ hasText: channelContent });
  await expect(channelMessage.getByTestId("attachment-image")).toBeVisible({ timeout: 15_000 });

  // --- And sends B a Direct Message photo.
  await page.getByTestId("mode-dms").click();
  await page.getByTestId("dm-new-conversation").click();
  await page.locator(`[data-testid="dm-member-option"][data-pubkey="${pubkeyB}"]`).click();
  await page.getByTestId("dm-attach-input").setInputFiles(TEST_IMAGE);
  await expect(page.getByTestId("dm-attachment-preview")).toBeVisible();
  const dmContent = `e2e cache dm ${Date.now()}`;
  await page.getByTestId("dm-composer").fill(dmContent);
  await page.getByRole("button", { name: "Send" }).click();
  const dmMessage = page.getByTestId("dm-message").filter({ hasText: dmContent });
  await expect(dmMessage.getByTestId("dm-attachment-image")).toBeVisible({ timeout: 15_000 });

  // Both are cached, and only under A's own scope (ticket #6 still holds).
  expect(await mediaCacheNames(page)).toEqual([`studio-media-v1-${pubkeyA}`]);

  // --- Sign-out empties it.
  await signOut(page);
  expect(await mediaCacheNames(page)).toEqual([]);

  // --- B takes the browser over. Nothing of A's is left to answer with, and
  // every blob B renders it fetched itself, through the server's
  // authorization check. B is entitled to both of these, so "B sees the
  // image" proves nothing on its own — where the bytes came from is the
  // whole difference between the fix and the bug.
  const blobsAFetched = [...new Set(servedToA)];
  expect(blobsAFetched.length).toBeGreaterThan(0);
  served = servedToB;

  await reachAppViaRestoreWithCredentials(page, {
    email: testAccountTwo.email(),
    password: testAccountTwo.password(),
    backupPassphrase: testBackupPassphraseTwo(),
  });
  expect(await page.evaluate((name) => caches.has(name), `studio-media-v1-${pubkeyA}`)).toBe(false);

  await page.getByTestId("channel-list-item").first().click();
  await expect(
    page.getByTestId("timeline-message").filter({ hasText: channelContent }).getByTestId("attachment-image"),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("mode-dms").click();
  await page.getByTestId("conversation-list-item").filter({ hasText: dmContent }).click();
  await expect(
    page.getByTestId("dm-message").filter({ hasText: dmContent }).getByTestId("dm-attachment-image"),
  ).toBeVisible({ timeout: 15_000 });

  for (const url of blobsAFetched) expect(servedToB).toContain(url);
  expect(await mediaCacheNames(page)).toEqual([`studio-media-v1-${pubkeyB}`]);
});

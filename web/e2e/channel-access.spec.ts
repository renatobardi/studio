import { expect, test } from "@playwright/test";
import { ownerApi, reachAppViaRestore } from "./helpers";

// Flow 7 (#42): two clients on the same Workspace — a browser that only ever
// watches, and a Workspace admin acting through the REST control plane (see
// `ownerApi`). Everything the admin does must reach the running app through
// the Workspace's projections, with no reload: a Channel created and shared,
// a role changed, access taken away, and the last accessible Channel resumed
// on the next launch.
//
// The Channel this creates is left behind: the control plane has no Channel
// deletion yet. It is private and the test Identity is removed from it at the
// end, so it stays invisible to everyone but the Workspace admin.
test.use({ storageState: undefined });

test("another admin's Channel and membership changes land without a reload", async ({ page }) => {
  const pubkey = await reachAppViaRestore(page);
  await expect(page.getByText(/Connected as/)).toBeVisible();
  const apiBase = new URL(page.url()).origin;
  const channelName = `e2e-access-${Date.now()}`;
  const listItem = page.getByTestId("channel-list-item").filter({ hasText: channelName });

  // --- Created by someone else, and private: still invisible here.
  const channel = await ownerApi.createChannel(apiBase, channelName, true);
  await expect(listItem).toHaveCount(0);

  // --- Added as a Member: it appears in the navigation on its own.
  await ownerApi.addChannelMember(apiBase, channel.id, pubkey, "member");
  await expect(listItem).toBeVisible({ timeout: 15_000 });
  await listItem.click();

  // --- Promoted to Channel admin: the admin console opens on this Channel,
  // even though this Identity holds no Workspace admin role.
  await ownerApi.addChannelMember(apiBase, channel.id, pubkey, "admin");
  await page.getByTestId("mode-admin").click({ timeout: 15_000 });
  await expect(page.getByTestId("admin-pane").getByText(channelName)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("mode-channels").click();

  // --- Reload: the app comes back on the Channel that was last open.
  await page.reload();
  await expect(page.getByTestId("channel-list-item").filter({ hasText: channelName })).toHaveClass(/active/, {
    timeout: 15_000,
  });

  // --- Access removed: the Channel leaves the navigation and the view.
  await ownerApi.removeChannelMember(apiBase, channel.id, pubkey);
  await expect(page.getByTestId("channel-access-lost")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("channel-list-item").filter({ hasText: channelName })).toHaveCount(0);
  await expect(page.getByTestId("message-composer")).toHaveCount(0);

  // --- Next launch resumes the last Channel this Identity can still reach.
  await page.reload();
  await expect(page.getByTestId("channel-list-item").first()).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.getByTestId("channel-list-item").filter({ hasText: channelName })).toHaveCount(0);
});

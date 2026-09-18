import { expect, test } from "@playwright/test";
import { reachAppViaRestore, sharedChannelItem } from "./helpers";

// Flow 3: open a Thread on a Message, reply in it, then add and remove a
// Reaction on the root Message, in the shared "e2e" Channel reachAppViaRestore
// makes the Identity a Member of.
test.use({ storageState: undefined });

test("thread reply and reaction", async ({ page }) => {
  await reachAppViaRestore(page);
  await expect(page.getByTestId("account-menu-button")).toBeVisible();

  await sharedChannelItem(page).click();

  const rootContent = `e2e thread root ${Date.now()}`;
  await page.getByTestId("message-composer").fill(rootContent);
  await page.getByTestId("message-composer").press("Enter");
  const rootMessage = page.getByTestId("timeline-message").filter({ hasText: rootContent });
  await expect(rootMessage).toBeVisible({ timeout: 10_000 });

  // Hover actions only accept pointer events while the row is hovered.
  await rootMessage.hover();
  await rootMessage.getByTestId("open-thread").click();
  await expect(page.getByTestId("thread-pane")).toBeVisible();

  const replyContent = `e2e thread reply ${Date.now()}`;
  const threadPane = page.getByTestId("thread-pane");
  await threadPane.locator(".composer-input").fill(replyContent);
  await threadPane.locator(".composer-input").press("Enter");
  await expect(page.getByTestId("thread-reply").filter({ hasText: replyContent })).toBeVisible({
    timeout: 10_000,
  });
  // No space around the "·": the prototype puts it there with `margin: 0 4px`, not with text
  // (docs/UI/design/Studio.dc.html), and the app's `.thread-open-dot` follows it.
  await expect(rootMessage.getByTestId("open-thread")).toContainText("1 reply·last reply");

  await rootMessage.hover();
  await rootMessage.getByTestId("reaction-add").filter({ hasText: "🔥" }).click();
  const fireChip = rootMessage.getByTestId("reaction-chip").filter({ hasText: "🔥" });
  await expect(fireChip).toContainText("1");

  await fireChip.click();
  await expect(rootMessage.getByTestId("reaction-chip").filter({ hasText: "🔥" })).toHaveCount(0);
});

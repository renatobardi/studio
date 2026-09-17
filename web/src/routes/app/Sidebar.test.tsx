import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionState } from "../../lib/relay";
import { Sidebar } from "./Sidebar";

const footer = (connectionState: ConnectionState) =>
  renderToStaticMarkup(
    <Sidebar
      groups={[]}
      onSelect={() => {}}
      onSelectMode={() => {}}
      canCreateChannels={false}
      onCreateChannel={() => {}}
      ownName="Renato Bardi"
      ownHandle="npub1rb92…7ktz"
      workspaceName="family"
      connectionState={connectionState}
      theme="light"
      onToggleTheme={() => {}}
      onOpenProfile={() => {}}
      onOpenSettings={() => {}}
      onSignOut={() => {}}
    />,
  );

/** The prototype's account block (#148): avatar with a presence dot, name and Workspace, and the
 * theme toggle — Sign out lives in the menu the block opens, the connection in the banner. */
describe("Sidebar footer", () => {
  test("the account block opens the account menu, with only the theme toggle beside it", () => {
    const html = footer("open");
    expect(html).toContain('aria-label="Open account menu"');
    expect(html).toContain('aria-label="Switch to dark"');
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Connected");
  });

  test("the presence dot is lit only while the relay connection is open", () => {
    expect(footer("open")).toContain('data-connection="open"');
    expect(footer("reconnecting")).toContain('data-connection="reconnecting"');
  });
});

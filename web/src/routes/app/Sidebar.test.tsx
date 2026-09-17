import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionState } from "../../lib/relay";
import type { SidebarGroup } from "../../lib/sidebar";
import { Sidebar } from "./Sidebar";

const render = (connectionState: ConnectionState, groups: SidebarGroup[] = []) =>
  renderToStaticMarkup(
    <Sidebar
      groups={groups}
      onSelect={() => {}}
      onSelectMode={() => {}}
      onNewMessage={() => {}}
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
const footer = (connectionState: ConnectionState) => render(connectionState);

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

/** The Direct messages section (#142): a "+" beside the label starts one, and each row says whose
 * conversation it is, so a flow can open it by participant rather than by position. */
describe("Sidebar Direct messages", () => {
  const dms: SidebarGroup = {
    label: "Direct messages",
    newMessageLabel: "New message",
    items: [
      { id: "dm:a,me", label: "Ana Petrova", icon: "user", active: false, unread: true, unreadCount: 3, testId: "conversation-list-item", mode: "dms", peerPubkeys: ["a"] },
    ],
  };

  test("offers New message beside the section label", () => {
    const html = render("open", [dms]);
    expect(html).toContain('aria-label="New message"');
    expect(html).toContain('data-testid="dm-new-conversation"');
  });

  test("a conversation row carries its other participants", () => {
    expect(render("open", [dms])).toContain('data-peers="a"');
  });

  test("an unread conversation shows how many Messages it has, as the prototype counts them", () => {
    const html = render("open", [dms]);
    expect(html).toContain('class="sidebar-item-count">3<');
    expect(html).not.toContain("unread-dot");
  });

  test("an empty Direct messages section is not the Channels empty state", () => {
    expect(render("open", [{ ...dms, items: [] }])).not.toContain("No Channels yet");
  });
});

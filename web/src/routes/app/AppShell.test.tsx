import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RelayClient } from "../../lib/relay";
import type { Signer } from "../../lib/custody";
import { AppShell } from "./AppShell";

const workspace = {
  slug: "family",
  name: "family",
  role: "owner",
  relay_url: "wss://relay.example",
  media_url: "https://media.example",
};
/** Nothing is subscribed to or fetched on this render: effects do not run outside a browser,
 * which is exactly the first paint this asserts. */
const client = {
  onStateChange: () => () => {},
  onProblem: () => () => {},
  connect: async () => {},
  close: () => {},
  subscribe: () => () => {},
} as unknown as RelayClient;
const signer = { getPublicKey: async () => "a".repeat(64) } as unknown as Signer;

const render = () =>
  renderToStaticMarkup(<AppShell workspace={workspace} signer={signer} onSignOut={() => {}} client={client} />);

/** The shell's first paint, before the relay, the Member list or the stored read marks have
 * answered (#142): the sidebar is already whole, and nothing that needs an Identity is drawn. */
describe("AppShell", () => {
  test("opens on the sidebar, with the Direct messages section and its New message action", () => {
    const html = render();
    expect(html).toContain("Direct messages");
    expect(html).toContain('data-testid="dm-new-conversation"');
    expect(html).toContain("family");
  });

  test("lists no conversation while none has arrived", () => {
    expect(render()).not.toContain('data-testid="conversation-list-item"');
  });

  test("shows neither a conversation nor the new-message dialog until one is asked for", () => {
    const html = render();
    expect(html).not.toContain('data-testid="new-message-dialog"');
    expect(html).not.toContain('data-testid="dm-composer"');
  });
});

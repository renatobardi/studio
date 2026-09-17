import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelsEmptyState } from "./ChannelsEmptyState";

/** A new Workspace has no Channels, and they are created in Admin › Channels (#136). The empty
 * state points there for whoever may create one; for anyone else the plain notice is enough. */
describe("ChannelsEmptyState", () => {
  test("offers a Workspace manager the way to Admin › Channels", () => {
    const html = renderToStaticMarkup(<ChannelsEmptyState className="meta" canCreate onCreate={() => {}} />);
    expect(html).toContain("No Channels yet.");
    expect(html).toContain('data-testid="create-channel-link"');
    expect(html).toContain("Create one in Admin");
  });

  test("shows only the notice to someone who cannot create Channels", () => {
    const html = renderToStaticMarkup(<ChannelsEmptyState className="meta" canCreate={false} onCreate={() => {}} />);
    expect(html).toContain("No Channels yet.");
    expect(html).not.toContain("<button");
  });
});

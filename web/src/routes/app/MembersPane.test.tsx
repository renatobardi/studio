import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signer } from "../../lib/custody";
import type { RelayClient } from "../../lib/relay";
import { MembersPane } from "./MembersPane";

const client = { subscribe: () => () => {} } as unknown as RelayClient;
const signer = {} as Signer;

const render = (memberPubkeys: string[], overlay = false) =>
  renderToStaticMarkup(
    <MembersPane
      client={client}
      signer={signer}
      slug="family"
      channelId="channel"
      memberPubkeys={memberPubkeys}
      channelAdmins={[]}
      workspaceMembers={[]}
      canManage={false}
      overlay={overlay}
      onClose={() => {}}
    />,
  );

/** The pane lists the roster ChannelView read for the header pill (#143) — one row per Member,
 * and it floats over the timeline only where the Channel is too narrow to share its width (#72). */
describe("MembersPane", () => {
  test("lists one row per Member of the roster it is given", () => {
    const html = render(["aa".padEnd(64, "a"), "bb".padEnd(64, "b")]);
    expect(html.split('data-testid="member-list-item"').length - 1).toBe(2);
  });

  test("lists nothing when the roster is empty", () => {
    expect(render([])).not.toContain("member-list-item");
  });

  test("floats over the timeline only as an overlay", () => {
    expect(render([], true)).toContain("side-pane side-pane-overlay");
    expect(render([], false)).toContain('class="side-pane"');
  });
});

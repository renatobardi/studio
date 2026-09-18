import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberGroup } from "./MemberGroup";

/** A pubkey a row can shorten into an npub when its kind 0 has not arrived. */
const key = (n: string) => n.repeat(64).slice(0, 64);

const render = (entries: { pubkey: string; role: string }[]) =>
  renderToStaticMarkup(<MemberGroup label="People" entries={entries} profiles={new Map()} onView={() => {}} />);

/** The prototype's PEOPLE/AGENTS group in the members pane: a label over rows that read
 * "name / role", and the bot tile for an Agent (#145). */
describe("MemberGroup", () => {
  test("labels the group and gives every entry its role", () => {
    const html = render([{ pubkey: key("a"), role: "Owner" }]);
    expect(html).toContain("People");
    expect(html).toContain("Owner");
    expect(html).toContain('data-testid="member-list-item"');
    expect(html).toContain(`data-pubkey="${key("a")}"`);
  });

  test("an Agent gets the bot tile instead of an avatar", () => {
    expect(render([{ pubkey: key("b"), role: "Agent" }])).toContain("avatar-agent");
    expect(render([{ pubkey: key("c"), role: "Member" }])).not.toContain("avatar-agent");
  });
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberCandidates } from "./MemberCandidates";

/** A pubkey a row can shorten into an npub when its kind 0 has not arrived. */
const key = (n: string) => n.repeat(64).slice(0, 64);

const render = (candidates: { pubkey: string; role: string }[]) =>
  renderToStaticMarkup(<MemberCandidates candidates={candidates} profiles={new Map()} onAdd={() => {}} />);

/** What "Add people and agents" offers for what was typed (#145): the matching Workspace
 * Members, each row an add — and a plain line when the search matches nobody. */
describe("MemberCandidates", () => {
  test("offers every match as a row that adds it to this Channel", () => {
    const html = render([{ pubkey: key("a"), role: "member" }]);
    expect(html).toContain('data-testid="member-add-options"');
    expect(html).toContain('data-testid="member-add-option"');
    expect(html).toContain("Add to this Channel");
    expect(html).toContain(`data-pubkey="${key("a")}"`);
  });

  test("an agent is offered with the bot tile", () => {
    expect(render([{ pubkey: key("b"), role: "agent" }])).toContain("avatar-agent");
  });

  test("says so when nobody matches, instead of an empty list", () => {
    const html = render([]);
    expect(html).toContain("No Workspace Members match.");
    expect(html).not.toContain('data-testid="member-add-options"');
  });
});

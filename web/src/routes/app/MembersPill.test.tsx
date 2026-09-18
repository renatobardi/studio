import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MembersPill } from "./MembersPill";

const render = (pubkeys: string[] | null, open = false) =>
  renderToStaticMarkup(<MembersPill pubkeys={pubkeys} open={open} onToggle={() => {}} />);

/** The Channel header pill counts the roster (#143): the prototype shows the number, not the word
 * "Members", and the flows press it by its label. */
describe("MembersPill", () => {
  test("counts the Members the roster names", () => {
    expect(render(["aa", "bb", "cc"])).toContain(">3<");
  });

  test("shows no count until the roster has arrived, so no 0 flashes in the header", () => {
    const html = render(null);
    expect(html).toContain('aria-label="Members"');
    expect(html).toEndWith("</svg></button>");
  });

  test("is pressed, and marked active, while the Members pane is open", () => {
    expect(render([], true)).toContain('aria-pressed="true"');
    expect(render([], true)).toContain("btn btn-outline active");
    expect(render([], false)).toContain('aria-pressed="false"');
  });
});

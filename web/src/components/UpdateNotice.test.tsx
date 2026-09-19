import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createUpdateNotice } from "../lib/appUpdate";
import { UpdateNotice } from "./UpdateNotice";

/** The discreet "new version" notice (#203): nothing until the service worker says so, then a
 * status line with a Reload the person chooses to press. */
describe("UpdateNotice", () => {
  test("renders nothing while the page is the current version", () => {
    expect(renderToStaticMarkup(<UpdateNotice notice={createUpdateNotice(true)} />)).toBe("");
  });

  test("says a new version is available, with a Reload button", () => {
    const notice = createUpdateNotice(true);
    notice.report("waiting");
    const html = renderToStaticMarkup(<UpdateNotice notice={notice} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("A new version of Studio is available.");
    expect(html).toContain(">Reload</button>");
  });
});

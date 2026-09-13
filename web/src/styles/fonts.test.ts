import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** Inter must come from this build, not from whatever the visitor has installed: the tokens
 * name 'Inter Variable' first, so the face has to be declared and self-hosted (#67). */
describe("fonts.css", () => {
  const css = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");

  test("self-hosts Inter Variable under the tokens' family name", () => {
    expect(css).toContain("font-family: 'Inter Variable'");
    expect(css).toContain("url('/fonts/InterVariable.woff2')");
    expect(css).toContain("font-weight: 100 900");
  });

  test("swaps rather than hiding text while the face loads", () => {
    expect(css).toContain("font-display: swap");
  });
});

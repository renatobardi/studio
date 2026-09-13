import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sakura } from "./Sakura";

/** The Kubo line sakura: five notched petals rotated 72° apart, five stamens, a centre dot —
 * theme-aware through --sakura-petal / --sakura-ink (docs/UI/README.md "Assets"). */
describe("Sakura", () => {
  test("draws the five-petal mark at the requested size and stroke", () => {
    const svg = renderToStaticMarkup(<Sakura size={32} sw={7} />);
    expect(svg).toContain('width="32"');
    expect(svg).toContain('height="32"');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg.match(/<path /g)).toHaveLength(5);
    expect(svg.match(/rotate\(216 50 50\)/g)).toHaveLength(1);
    expect(svg).toContain('stroke-width="7"');
  });

  test("takes its petal fill and ink from the theme tokens", () => {
    const svg = renderToStaticMarkup(<Sakura />);
    expect(svg).toContain("var(--sakura-petal)");
    expect(svg).toContain("var(--sakura-ink)");
  });

  test("is decorative — hidden from assistive tech", () => {
    expect(renderToStaticMarkup(<Sakura />)).toContain('aria-hidden="true"');
  });
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "./Icon";
import { ICON_PATHS } from "./icons";

/** Monochrome Lucide glyphs, as the Kubo `Icon` wrapper draws them: 24×24 viewBox, stroke
 * currentColor, width 2, round caps and joins, 16px by default. */
describe("Icon", () => {
  test("renders a Lucide glyph as strokes in the current colour", () => {
    const svg = renderToStaticMarkup(<Icon name="hash" />);
    expect(svg).toContain('width="16"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg.match(/<path /g)).toHaveLength(4);
  });

  test("scales to the requested size", () => {
    expect(renderToStaticMarkup(<Icon name="x" size={14} />)).toContain('width="14"');
  });

  test("ships every glyph an MVP screen uses", () => {
    const needed = [
      "hash", "lock", "user", "x", "plus", "paperclip", "arrow-up", "mail", "settings", "log-out",
      "sun", "moon", "chevron-right", "chevron-down", "shield", "check", "pencil", "eye", "eye-off",
      "copy", "download", "message-square", "info", "triangle-alert", "image", "bot",
    ];
    for (const name of needed) expect(ICON_PATHS[name]?.length ?? 0).toBeGreaterThan(0);
  });
});

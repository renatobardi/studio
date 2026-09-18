import { describe, expect, test } from "bun:test";
import { comparePixels, maskOf, pairsOf, renderReport, screenConfig, verdictOf } from "./compare-reference-lib.mjs";

/** Issue #156: the flow 10 baselines measured against the prototype capture of the same id,
 * with the out-of-MVP regions each screen declares left out of the count. */

const rgba = (...pixels: number[][]) => new Uint8Array(pixels.flat());
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const NEAR_WHITE = [250, 250, 250, 255];

describe("pairsOf", () => {
  const matrix = {
    states: [
      { id: "auth-signin", mobile: true, dark: true },
      { id: "auth-verify", mobile: false, dark: false },
    ],
  };

  test("pairs every capture of the matrix with the baseline of the chosen platform", () => {
    expect(pairsOf(matrix, "linux")).toEqual([
      { id: "auth-signin", viewport: "desktop", name: "auth-signin", reference: "desktop/auth-signin.png", baseline: "desktop-auth-signin-linux.png" },
      { id: "auth-signin", viewport: "desktop", name: "auth-signin-dark", reference: "desktop/auth-signin-dark.png", baseline: "desktop-auth-signin-dark-linux.png" },
      { id: "auth-verify", viewport: "desktop", name: "auth-verify", reference: "desktop/auth-verify.png", baseline: "desktop-auth-verify-linux.png" },
      { id: "auth-signin", viewport: "mobile", name: "auth-signin", reference: "mobile/auth-signin.png", baseline: "mobile-auth-signin-linux.png" },
    ]);
  });
});

describe("screenConfig", () => {
  const regions = {
    screens: {
      channel: {
        faithful: true,
        tolerance: 0.05,
        ignore: { desktop: [{ x: 0, y: 0, width: 256, height: 292, label: "sidebar nav" }] },
      },
    },
  };

  test("reads the verdict fields and the regions of one viewport", () => {
    expect(screenConfig(regions, "channel", "desktop")).toEqual({
      faithful: true,
      tolerance: 0.05,
      ignore: [{ x: 0, y: 0, width: 256, height: 292, label: "sidebar nav" }],
    });
    expect(screenConfig(regions, "channel", "mobile").ignore).toEqual([]);
  });

  test("a screen the file does not list is report-only with nothing ignored", () => {
    expect(screenConfig(regions, "dm", "desktop")).toEqual({ faithful: false, tolerance: null, ignore: [] });
  });
});

describe("maskOf", () => {
  test("marks the pixels inside each region, clipped to the image", () => {
    const mask = maskOf(3, 2, [{ x: 2, y: 1, width: 5, height: 5 }]);
    expect([...mask]).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

describe("comparePixels", () => {
  test("counts pixels whose channels differ beyond the threshold, over the pixels not ignored", () => {
    const reference = rgba(WHITE, WHITE, WHITE, WHITE);
    const baseline = rgba(BLACK, NEAR_WHITE, BLACK, WHITE);
    const mask = new Uint8Array([0, 0, 1, 0]);
    const result = comparePixels(reference, baseline, { width: 2, height: 2, mask, threshold: 0.1 });
    expect(result.differing).toBe(1);
    expect(result.compared).toBe(3);
    expect(result.ratio).toBeCloseTo(1 / 3);
  });

  test("paints differing pixels red and ignored pixels apart from the faded reference", () => {
    const reference = rgba(WHITE, WHITE, WHITE);
    const baseline = rgba(BLACK, WHITE, BLACK);
    const mask = new Uint8Array([0, 0, 1]);
    const { diff } = comparePixels(reference, baseline, { width: 3, height: 1, mask, threshold: 0.1 });
    const pixel = (i: number) => [...diff.slice(i * 4, i * 4 + 4)];
    expect(pixel(0)).toEqual([255, 0, 0, 255]);
    expect(pixel(1)[0]).toBe(pixel(1)[1]);
    expect(pixel(2)).not.toEqual(pixel(1));
    expect(pixel(2)).not.toEqual(pixel(0));
  });
});

describe("verdictOf", () => {
  const measured = { ratio: 0.2 };

  test("a screen nobody decided is faithful is only reported, whatever the ratio", () => {
    expect(verdictOf({ faithful: false, tolerance: null }, measured)).toBe("report");
  });

  test("a faithful screen passes within its tolerance and fails above it", () => {
    expect(verdictOf({ faithful: true, tolerance: 0.2 }, measured)).toBe("pass");
    expect(verdictOf({ faithful: true, tolerance: 0.1 }, measured)).toBe("fail");
  });

  test("a faithful screen with no tolerance tolerates nothing", () => {
    expect(verdictOf({ faithful: true, tolerance: null }, { ratio: 0.001 })).toBe("fail");
  });

  test("a size mismatch fails a faithful screen and is reported otherwise", () => {
    expect(verdictOf({ faithful: true, tolerance: 1 }, { sizeMismatch: true })).toBe("fail");
    expect(verdictOf({ faithful: false, tolerance: null }, { sizeMismatch: true })).toBe("report");
  });
});

describe("renderReport", () => {
  test("one row per compared screen, with its metric, verdict and diff image", () => {
    const markdown = renderReport(
      [
        { pair: { viewport: "desktop", name: "dm" }, config: { faithful: false, tolerance: null, ignore: [{}, {}] }, ratio: 0.12345, verdict: "report", diff: "desktop-dm.png" },
        { pair: { viewport: "mobile", name: "dm" }, config: { faithful: true, tolerance: 0.01 }, sizeMismatch: "390×844 vs 390×900", verdict: "fail" },
      ],
      { platform: "linux", threshold: 0.1, missing: ["desktop/auth-verify"] },
    );
    expect(markdown).toContain("| desktop | dm | 12.35% | 2 | no | — | report | [diff](desktop-dm.png) |");
    expect(markdown).toContain("| mobile | dm | size 390×844 vs 390×900 | 0 | yes | 1.00% | **fail** | — |");
    expect(markdown).toContain("desktop/auth-verify");
    expect(markdown).toContain("linux");
  });
});

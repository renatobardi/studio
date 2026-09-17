// Pure logic of tools/compare-reference.mjs (issue #156), kept apart from the file system so it
// runs under bun test. Images are plain RGBA byte arrays, as pngjs decodes them.

/** Every capture docs/UI/reference/matrix.json describes, paired with the flow 10 baseline of the
 * same name: desktop always (plus -dark where the state has it), mobile where the state has it. */
export function pairsOf(matrix, platform) {
  const pairs = [];
  for (const viewport of ["desktop", "mobile"]) {
    for (const { id, mobile, dark } of matrix.states) {
      if (viewport === "mobile" && !mobile) continue;
      for (const name of dark && viewport === "desktop" ? [id, `${id}-dark`] : [id]) {
        pairs.push({ id, viewport, name, reference: `${viewport}/${name}.png`, baseline: `${viewport}-${name}-${platform}.png` });
      }
    }
  }
  return pairs;
}

/** What docs/UI/reference/regions.json says of one screen at one viewport. Unlisted screens are
 * report-only and ignore nothing. The dark capture shares the light one's entry. */
export function screenConfig(regions, id, viewport) {
  const screen = regions.screens[id] ?? {};
  return { faithful: screen.faithful ?? false, tolerance: screen.tolerance ?? null, ignore: screen.ignore?.[viewport] ?? [] };
}

/** 1 for each pixel inside an ignored region, clipped to the image. */
export function maskOf(width, height, regions) {
  const mask = new Uint8Array(width * height);
  for (const { x, y, width: w, height: h } of regions) {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) {
      mask.fill(1, row * width + Math.max(0, x), row * width + Math.min(width, x + w));
    }
  }
  return mask;
}

/** A pixel differs when any RGB channel moves more than `threshold` (0–1) of its range. The ratio
 * is over the pixels not ignored. The diff image is the reference faded to gray, differing pixels
 * red, ignored pixels blue. */
export function comparePixels(reference, baseline, { width, height, mask, threshold }) {
  const diff = new Uint8Array(width * height * 4);
  const limit = threshold * 255;
  let differing = 0;
  let compared = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const gray = 255 - (255 - (reference[i] * 0.299 + reference[i + 1] * 0.587 + reference[i + 2] * 0.114)) * 0.25;
    let color = [gray, gray, gray];
    if (mask[p]) {
      color = [gray * 0.8, gray * 0.85, 255];
    } else {
      compared++;
      const delta = Math.max(
        Math.abs(reference[i] - baseline[i]),
        Math.abs(reference[i + 1] - baseline[i + 1]),
        Math.abs(reference[i + 2] - baseline[i + 2]),
      );
      if (delta > limit) {
        differing++;
        color = [255, 0, 0];
      }
    }
    diff.set([...color, 255], i);
  }
  return { differing, compared, ratio: compared ? differing / compared : 0, diff };
}

/** "fail" only for a screen the owner declared faithful and that exceeds its tolerance (none set
 * means none tolerated) or no longer has the reference's size; everything else is reported. */
export function verdictOf({ faithful, tolerance }, { ratio, sizeMismatch }) {
  if (!faithful) return "report";
  if (sizeMismatch) return "fail";
  return ratio > (tolerance ?? 0) ? "fail" : "pass";
}

const percent = (value) => `${(value * 100).toFixed(2)}%`;

export function renderReport(rows, { platform, threshold, missing }) {
  const lines = [
    "# App baseline vs prototype reference",
    "",
    `Flow 10 \`-${platform}\` baselines against \`docs/UI/reference/\` (issue #156). A pixel differs when an RGB channel moves more than ${percent(threshold)}; ignored regions (out of the MVP, \`docs/UI/reference/regions.json\`) are left out of the ratio and shown blue in the diff.`,
    "",
    "| viewport | screen | differing pixels | ignored regions | faithful | tolerance | verdict | diff |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const { pair, config, ratio, sizeMismatch, verdict, diff } of rows) {
    lines.push(
      `| ${pair.viewport} | ${pair.name} | ${sizeMismatch ? `size ${sizeMismatch}` : percent(ratio)} | ${config.ignore?.length ?? 0} | ${config.faithful ? "yes" : "no"} | ${config.faithful ? percent(config.tolerance ?? 0) : "—"} | ${verdict === "fail" ? "**fail**" : verdict} | ${diff ? `[diff](${diff})` : "—"} |`,
    );
  }
  if (missing.length) {
    lines.push("", `No baseline to compare: ${missing.map((name) => `\`${name}\``).join(", ")}.`);
  }
  return `${lines.join("\n")}\n`;
}

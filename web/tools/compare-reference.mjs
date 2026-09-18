// Measures each flow 10 baseline against the prototype capture of the same id (issue #156).
// Flow 10 compares the app with the app; this is what says how far the app is from the HTML.
// Run from web/:
//
//   node tools/compare-reference.mjs [--platform darwin|linux]
//
// --platform picks the baselines (default: this machine's). Regions out of the MVP and the
// owner's verdict per screen live in docs/UI/reference/regions.json. Output under
// test-results/reference-compare/: report.md plus one diff PNG per screen. Exits 1 only when a
// screen declared faithful exceeds its tolerance.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// pngjs as Playwright ships it (an exported entry point of playwright-core): no dependency of our own.
import { PNG } from "playwright-core/lib/utilsBundle";
import { comparePixels, maskOf, pairsOf, renderReport, screenConfig, verdictOf } from "./compare-reference-lib.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = resolve(here, "../../docs/UI/reference");
const baselineDir = resolve(here, "../e2e/visual.spec.ts-snapshots");
const outDir = resolve(here, "../test-results/reference-compare");

const flag = process.argv.indexOf("--platform");
const platform = flag === -1 ? process.platform : process.argv[flag + 1];

const matrix = JSON.parse(await readFile(join(referenceDir, "matrix.json"), "utf8"));
const regions = JSON.parse(await readFile(join(referenceDir, "regions.json"), "utf8"));
await mkdir(outDir, { recursive: true });

const rows = [];
const missing = [];
for (const pair of pairsOf(matrix, platform)) {
  const baselinePath = join(baselineDir, pair.baseline);
  if (!existsSync(baselinePath)) {
    missing.push(`${pair.viewport}/${pair.name}`);
    continue;
  }
  const reference = PNG.sync.read(await readFile(join(referenceDir, pair.reference)));
  const baseline = PNG.sync.read(await readFile(baselinePath));
  const config = screenConfig(regions, pair.id, pair.viewport);
  if (reference.width !== baseline.width || reference.height !== baseline.height) {
    const sizeMismatch = `${baseline.width}×${baseline.height} vs ${reference.width}×${reference.height}`;
    rows.push({ pair, config, sizeMismatch, verdict: verdictOf(config, { sizeMismatch }) });
    continue;
  }
  const { width, height } = reference;
  const result = comparePixels(reference.data, baseline.data, { width, height, mask: maskOf(width, height, config.ignore), threshold: regions.threshold });
  const diff = `${pair.viewport}-${pair.name}.png`;
  const image = new PNG({ width, height });
  image.data = Buffer.from(result.diff);
  await writeFile(join(outDir, diff), PNG.sync.write(image));
  rows.push({ pair, config, ratio: result.ratio, verdict: verdictOf(config, result), diff });
}

const report = renderReport(rows, { platform, threshold: regions.threshold, missing });
await writeFile(join(outDir, "report.md"), report);
console.log(report);
if (rows.some((row) => row.verdict === "fail")) process.exit(1);

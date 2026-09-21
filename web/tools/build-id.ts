import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** What never ships: tests, the helpers only tests import, and the preview harness, which
 * `preview.html` mounts on the dev server alone. */
function neverShips(path: string): boolean {
  return /\.test\.tsx?$/.test(path) || path.startsWith(join("src", "lib", "testing")) || path.startsWith(join("src", "preview"));
}

/**
 * The id a build carries in the page and in sw.ts alike, so a page can ask the worker that just
 * took it over whether it serves this same build (#259): a digest of every file under `paths`
 * (relative to `root`) that ships, path and bytes both.
 *
 * Derived from what ships rather than from when it was built: `docker compose up --build` copies
 * all of web/ and rebuilds on any change in it, so a pull request that only touched tests would
 * otherwise have been "a new version" to every open tab.
 */
export function buildId(root: string, paths: string[]): string {
  const hash = createHash("sha256");
  const walk = (path: string) => {
    const full = join(root, path);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) walk(join(path, name));
    } else if (!neverShips(path)) {
      // Length-prefixed, so bytes moving from one file into the next are not the same stream.
      const bytes = readFileSync(full);
      hash.update(`${path}\0${bytes.length}\0`).update(bytes);
    }
  };
  for (const path of paths) walk(path);
  return hash.digest("hex").slice(0, 16);
}

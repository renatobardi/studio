import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildId } from "./build-id";

/** The id the page and sw.ts both carry, so a page can ask the worker that takes it over whether
 * it serves the same build (#259). It has to change exactly when what ships changes: a new id for
 * the same app is a "new version" notice to every open tab for nothing. */
describe("buildId", () => {
  let root = "";
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const app = () => {
    root = mkdtempSync(join(tmpdir(), "studio-build-id-"));
    write("index.html", "<div id=root></div>");
    write("src/main.tsx", "render()");
    write("src/lib/relay.ts", "export const relay = 1");
    write("public/favicon.svg", "<svg/>");
  };
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("the same sources give the same id — a rebuild nobody asked for is not a new version", () => {
    app();
    expect(buildId(root, ["index.html", "src", "public"])).toBe(buildId(root, ["index.html", "src", "public"]));
  });

  test("a change to anything shipped gives another", () => {
    app();
    const before = buildId(root, ["index.html", "src", "public"]);
    write("src/lib/relay.ts", "export const relay = 2");
    expect(buildId(root, ["index.html", "src", "public"])).not.toBe(before);
  });

  test("a change to a test, a test helper or the preview harness does not — none of them ships", () => {
    // `docker compose up --build` copies all of web/ and rebuilds on any change in it, so a
    // pull request that only touched tests used to be a "new version" for every open tab.
    app();
    const before = buildId(root, ["index.html", "src", "public"]);
    write("src/lib/relay.test.ts", "test()");
    write("src/routes/App.test.tsx", "test()");
    write("src/lib/testing/dom.ts", "register()");
    write("src/preview/main.tsx", "preview()");
    expect(buildId(root, ["index.html", "src", "public"])).toBe(before);
  });

  test("moving bytes from one file to another is a change, not the same concatenation", () => {
    app();
    write("src/a.ts", "xy");
    write("src/b.ts", "");
    const before = buildId(root, ["src"]);
    write("src/a.ts", "x");
    write("src/b.ts", "y");
    expect(buildId(root, ["src"])).not.toBe(before);
  });
});

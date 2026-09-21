// Captures the MVP screen matrix from the prototype (docs/UI/design/Studio.dc.html) at the
// two comparison viewports, with the vendored Kubo bundle and fonts — no other project on
// the path (#66). Run from web/ so Playwright resolves:
//
//   cd web && node tools/capture-reference.mjs
//
// Output: docs/UI/reference/<viewport>/<state>.png plus matrix.json (what each state is).
// The prototype has no URL routing; every state is reached by patching the component's own
// state through the runtime (support.js), the same way its account menu does.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const designDir = resolve(here, "../../docs/UI/design");
const outDir = resolve(here, "../../docs/UI/reference");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const ACCOUNT = { email: "renato@studio.app", provider: "password" };

/** @typedef {Record<string, unknown>} PrototypeState the component state the prototype renders from */

/**
 * @param {string} step
 * @param {PrototypeState} [extra]
 */
const onboarding = (step, extra = {}) => ({
  view: "onboarding",
  onboardingStep: step,
  authAccount: ACCOUNT,
  onboardingName: "Renato",
  onboardingEmoji: "🌸",
  onboardingKeyRevealed: false,
  onboardingBackup: "idle",
  onboardingAge: false,
  onboardingTerms: false,
  onboardingPolicyError: null,
  ...extra,
});
/**
 * @param {string} authStep
 * @param {PrototypeState} [extra]
 */
const auth = (authStep, extra = {}) => ({
  view: "auth",
  authStep,
  authEmail: "you@example.com",
  authPassword: "",
  authName: "",
  authError: null,
  authErrorCode: null,
  authGoogleOpen: false,
  authResent: false,
  ...extra,
});
/** @param {PrototypeState} [extra] */
const channel = (extra = {}) => ({
  view: "channel",
  channelId: "eng-platform",
  threadId: null,
  membersOpen: false,
  canvasOpen: false,
  ...extra,
});

/**
 * One screen of the matrix: the state that reaches it, what to do once it is up, and which
 * captures it has — mobile, and (on desktop) dark.
 *
 * @typedef {{ id: string, state: PrototypeState, after?: keyof typeof AFTER, mobile?: boolean, dark?: boolean }} MatrixEntry
 */

/** The matrix. `after` runs in the page once the state is applied (a click the state alone
 * cannot express). `mobile: true` states are captured at both viewports.
 *
 * @type {MatrixEntry[]}
 */
const MATRIX = [
  { id: "auth-signin", state: auth("signin"), mobile: true, dark: true },
  { id: "auth-signin-error", state: auth("signin", { authError: "That email and password don’t match an account.", authErrorCode: "auth/invalid-credential" }) },
  { id: "auth-signup", state: auth("signup"), mobile: true },
  { id: "auth-verify", state: auth("verify") },
  { id: "auth-reset", state: auth("reset") },
  { id: "auth-sent", state: auth("sent") },
  { id: "onboarding-invite", state: onboarding("invite"), mobile: true },
  { id: "onboarding-profile", state: onboarding("profile"), mobile: true },
  { id: "onboarding-avatar", state: onboarding("avatar") },
  { id: "onboarding-backup", state: onboarding("backup"), mobile: true, dark: true },
  { id: "onboarding-backup-revealed", state: onboarding("backup", { onboardingKeyRevealed: true }) },
  { id: "onboarding-backup-options", state: onboarding("backup-options") },
  { id: "onboarding-download", state: onboarding("download"), mobile: true },
  { id: "onboarding-download-created", state: onboarding("download", { onboardingBackup: "created" }) },
  { id: "onboarding-download-verified", state: onboarding("download", { onboardingBackup: "verified" }) },
  { id: "onboarding-setup", state: onboarding("setup") },
  { id: "onboarding-config", state: onboarding("config") },
  { id: "channel", state: channel(), mobile: true, dark: true },
  { id: "channel-thread", state: channel(), after: "openThread", mobile: true, dark: true },
  { id: "channel-members", state: channel({ membersOpen: true }), mobile: true },
  { id: "dm", state: { view: "dm", dmId: "Ana Petrova", threadId: null, membersOpen: false }, mobile: true, dark: true },
  { id: "profile", state: { view: "profile" }, mobile: true },
  { id: "settings-appearance", state: { view: "settings", settingsSection: "appearance" }, mobile: true, dark: true },
  { id: "settings-profile", state: { view: "settings", settingsSection: "profile" } },
];

/** @type {Record<string, string>} */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

/**
 * @param {string} dir
 * @returns {Promise<{ server: import("node:http").Server, port: number }>}
 */
function serve(dir) {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      // Always set on a request an http.Server hands its handler; the type also covers the
      // client side, where it is not.
      const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "https://x").pathname));
      const file = join(dir, path);
      if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      // A string is a pipe's address and null a server not listening — neither can happen after
      // listening on a TCP port, but saying so is what lets the port be read without a cast.
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error(`expected a TCP address, got ${address}`);
      ok({ server, port: address.port });
    });
  });
}

// The runtime keeps no handle to the mounted logic instance; the React fiber tree does. Runs
// inside the page: it walks the fibers and patches the state in one go.
/** @param {[PrototypeState, string]} args the state to set, and the theme */
function applyState([state, theme]) {
  for (const n of [document.body, ...document.body.querySelectorAll("*")]) {
    const k = Object.keys(n).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactContainer$"));
    if (!k) continue;
    const seen = new Set();
    // React's own expando, under a key it randomises per load: nothing to type it against.
    const stack = [Reflect.get(n, k)];
    while (stack.length) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      if (f.stateNode && f.stateNode.logic && f.stateNode.logic.setState) {
        f.stateNode.logic.setState({ ...state, theme, dialog: null, openMenu: null, hoveredGroup: null });
        return;
      }
      stack.push(f.return, f.child, f.sibling);
    }
  }
  throw new Error("prototype logic instance not found");
}

/** What to do once a state is up, by name, for the states that need more than being set. */
const AFTER = {
  /** @param {import("@playwright/test").Page} page */
  openThread: async (page) => {
    await page.getByRole("button", { name: /repl(y|ies)/ }).first().click();
  },
};

/**
 * One state of one screen, light and (on desktop, where the reference has both) dark.
 *
 * @param {import("@playwright/test").Page} page
 * @param {MatrixEntry} entry
 * @param {{ name: string, out: string }} target the viewport's name, and where captures go
 */
async function captureEntry(page, entry, { name, out }) {
  const written = [];
  for (const dark of entry.dark && name === "desktop" ? [false, true] : [false]) {
    /** @type {[PrototypeState, string]} */
    const args = [entry.state, dark ? "dark" : "light"];
    await page.evaluate(applyState, args);
    await page.waitForTimeout(250);
    if (entry.after) await AFTER[entry.after](page);
    await page.waitForTimeout(250);
    const file = join(out, name, `${entry.id}${dark ? "-dark" : ""}.png`);
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
    written.push(file);
  }
  return written;
}

/**
 * Every state the matrix asks of one viewport, in one browser context.
 *
 * @param {import("@playwright/test").Browser} browser
 * @param {number} port the loopback server's
 * @param {{ name: string, viewport: { width: number, height: number }, out: string, matrix: MatrixEntry[] }} target
 */
async function captureViewport(browser, port, { name, viewport, out, matrix }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  try {
    // Only the vendored bundle: the Noto Sans JP @import is the one remote fetch, and it is
    // not used by any Studio screen. Blocking it keeps the capture offline and repeatable.
    await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) => route.abort());
    const page = await context.newPage();
    // Plain HTTP to the in-process loopback server above — nothing leaves this machine.
    await page.goto(`http://127.0.0.1:${port}/Studio.dc.html`); // NOSONAR
    await page.waitForFunction(() => document.querySelector("[data-screen-label]") !== null);
    await page.evaluate(() => document.fonts.ready);
    const inter = await page.evaluate(() => document.fonts.check('12px "Inter Variable"'));
    if (!inter) throw new Error("Inter Variable did not load — the reference would be captured in a fallback font");
    await mkdir(join(out, name), { recursive: true });
    const written = [];
    for (const entry of matrix) {
      if (name === "mobile" && !entry.mobile) continue;
      written.push(...(await captureEntry(page, entry, { name, out })));
    }
    return written;
  } finally {
    await context.close();
  }
}

async function capture() {
  const viewports = VIEWPORTS;
  const matrix = MATRIX;
  const out = outDir;
  const { server, port } = await serve(designDir);
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const [name, viewport] of Object.entries(viewports)) {
      written.push(...(await captureViewport(browser, port, { name, viewport, out, matrix })));
    }
  } finally {
    await browser.close();
    server.close();
  }
  await writeFile(
    join(out, "matrix.json"),
    JSON.stringify({ viewports, deviceScaleFactor: 1, states: matrix.map(({ id, state, after, mobile, dark }) => ({ id, state, after: after ?? null, mobile: !!mobile, dark: !!dark })) }, null, 2) + "\n",
  );
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await capture();
  console.log(`${files.length} captures written under ${outDir}`);
}

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
const channel = (extra = {}) => ({
  view: "channel",
  channelId: "eng-platform",
  threadId: null,
  membersOpen: false,
  canvasOpen: false,
  ...extra,
});

/** The matrix. `after` runs in the page once the state is applied (a click the state alone
 * cannot express). `mobile: true` states are captured at both viewports. */
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

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

function serve(dir) {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
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
    server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port }));
  });
}

// The runtime keeps no handle to the mounted logic instance; the React fiber tree does. Runs
// inside the page: it walks the fibers and patches the state in one go.
function applyState([state, theme]) {
  for (const n of [document.body, ...document.body.querySelectorAll("*")]) {
    const k = Object.keys(n).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactContainer$"));
    if (!k) continue;
    const seen = new Set();
    const stack = [n[k]];
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

const AFTER = {
  openThread: async (page) => {
    await page.getByRole("button", { name: /repl(y|ies)/ }).first().click();
  },
};

async function capture() {
  const viewports = VIEWPORTS;
  const matrix = MATRIX;
  const out = outDir;
  const { server, port } = await serve(designDir);
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const [name, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
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
      for (const entry of matrix) {
        if (name === "mobile" && !entry.mobile) continue;
        for (const dark of entry.dark && name === "desktop" ? [false, true] : [false]) {
          await page.evaluate(applyState, [entry.state, dark ? "dark" : "light"]);
          await page.waitForTimeout(250);
          if (entry.after) await AFTER[entry.after](page);
          await page.waitForTimeout(250);
          const file = join(out, name, `${entry.id}${dark ? "-dark" : ""}.png`);
          await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
          written.push(file);
        }
      }
      await context.close();
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

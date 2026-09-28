// `node scripts/shots.mjs` — take the pictures of each feature from the web demo
// (docs/guide/SHOTS.md). It reads docs/guide/shots.json, starts the demo and a headless Edge
// on free ports, and saves each shot in each look to shots/<version>/, with a manifest and a
// contact sheet (index.html) to review the run.
//
//   node scripts/shots.mjs                          every shot, every look (F1)
//   node scripts/shots.mjs --only compass-open      one shot (repeat --only, or a comma list)
//   node scripts/shots.mjs --look lilac-press       one look, `theme-skin` (a comma list works)
//
// For debugging (SHOTS.md §5b):
//   --list <file>   another shot list: docs/guide/motion.json (the motion set), or a scratch list for one bug
//   --out <dir>     write there (default shots/[<list name>/]<version>[-slow<n>]/)
//   --slow <n>      CSS and Web Animations run n times slower (the clip plays slow too)
//   --raw           keep every real frame of a clip in <id>.<look>.raw/
//   --scratch <name>  the scratchpad: run shots/scratch/<name>.json into shots/scratch/<name>/;
//                   a new name writes a starter list to edit (SHOTS.md §5d)
// And on any clip step, `"frames": N` keeps the next N real paints after it.
//
// To compare (SHOTS.md §5f):
//   --tag <name>    write to <out>-<name> (`--tag now` = a timestamp), so a rerun keeps the old one
//   --vs "<spec>"   run each shot again with a change, beside the run as is (repeat for C, D…);
//                   a spec is `--token=value` or `settingKey=value`, several joined with ";"
//   --set "<spec>"  the same change on every run (the base of a comparison)
//   --repeat <n>    each shot n times; the log gives the median of each frames line and curve
//   --noise <pct>   the CPU load a shot waits for before it starts (default 35); over it, the
//                   row is marked noisy
//
// Headless: Edge opens no window and uses a throwaway profile, so nothing on the desktop moves
// and no real Edge profile or app data is touched. No Apple call and no network: the demo
// refuses every cross-origin request (WEB-DEMO.md §9.4).
//
// Steps 2–3 of SHOTS.md §10: pictures and clips from the demo. A clip is an MP4, a poster and
// a frame strip (one PNG of the motion, for a review by eye). The dev-app source comes later.

import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[shots]", ...a);

// ── the arguments ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const listArg = (flag) =>
  argv.flatMap((a, i) => (argv[i - 1] === flag ? a.split(",") : [])).map((s) => s.trim()).filter(Boolean);
const only = new Set(listArg("--only"));
const lookFilter = new Set(listArg("--look"));
const oneArg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const slow = Number(oneArg("--slow") ?? 1);
if (!(slow >= 1)) throw new Error("[shots] --slow takes a number of 1 or more");
const raw = argv.includes("--raw");
const repeat = Math.max(1, Number(oneArg("--repeat") ?? 1) | 0);
const noiseLimit = Number(oneArg("--noise") ?? 35);
const tagArg = oneArg("--tag");
const tag = tagArg === "now" ? new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-") : tagArg;
if (tag !== undefined && !/^[a-z0-9][a-z0-9-]*$/i.test(tag)) throw new Error("[shots] --tag takes a plain name: letters, digits, dashes (or `now`)");

/** A change for `--set` / `--vs`: `--token=value` sets a CSS custom property on <html> (it beats
 *  every theme and skin rule); any other key is a setting (the value read as JSON, else text). */
function parseSpec(spec) {
  const tokens = {};
  const settings = {};
  for (const part of spec.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq < 1) throw new Error(`[shots] "${part}" is not key=value`);
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k.startsWith("--")) tokens[k] = v;
    else {
      try {
        settings[k] = JSON.parse(v);
      } catch {
        settings[k] = v;
      }
    }
  }
  return { tokens, settings };
}
const allArgs = (flag) => argv.flatMap((a, i) => (argv[i - 1] === flag ? [a] : []));
const setSpec = parseSpec(allArgs("--set").join(";"));
const vsSpecs = allArgs("--vs");
/** The runs of each shot: one as is, or A (as is) plus B, C… for each --vs. */
const VARIANTS = [
  { label: vsSpecs.length ? "A" : "", desc: allArgs("--set").join("; ") || "as is", ...setSpec },
  ...vsSpecs.map((spec, i) => {
    const v = parseSpec(spec);
    return { label: String.fromCharCode(66 + i), desc: spec, tokens: { ...setSpec.tokens, ...v.tokens }, settings: { ...setSpec.settings, ...v.settings } };
  }),
];

// The scratchpad (SHOTS.md §5d): `--scratch <name>` runs shots/scratch/<name>.json into
// shots/scratch/<name>/ (gitignored, like all of shots/). A name with no list gets a starter
// list and the run stops, so the first command of a debug session makes the file to edit.
const scratch = oneArg("--scratch");
if (scratch !== undefined && !/^[a-z0-9][a-z0-9-]*$/i.test(scratch)) throw new Error("[shots] --scratch takes a plain name: letters, digits, dashes");
const scratchDir = join(root, "shots", "scratch");
const listFile = scratch
  ? join(scratchDir, `${scratch}.json`)
  : oneArg("--list")
    ? resolve(oneArg("--list"))
    : join(root, "docs", "guide", "shots.json");
if (scratch && !existsSync(listFile)) {
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(listFile, JSON.stringify(starter(scratch), null, 2) + "\n");
  console.log(`[shots] new scratch list: ${listFile}\n[shots] edit its steps, then run the same command again.`);
  process.exit(0);
}

/** A new scratch list: one clip that shows every debug tool once. `help` is for the reader;
 *  the runner ignores it. */
function starter(name) {
  return {
    help: [
      "A scratch list for one bug (SHOTS.md §5d). Run: node scripts/shots.mjs --scratch " + name,
      "Steps: click, rightclick, hover, key ('Ctrl+Space'), type, wait (ms or a selector), drag {from,to}, wheel (+dy, times), resize [w,h] (+over, steps), reload, eval, probe, snap.",
      "On any step: \"frames\": N keeps the next N real paints after it (a folder + a labeled PNG with marks, stalls and the change curve); \"region\": selector measures the curve in that box; \"strip\": true starts the strip there.",
      "Shot keys: size (mini, player, midi, max), seconds, prepare (steps before the recording), window (follow the app's set_size), settings, strip {fps, seconds, cols, width}.",
      "Flags: --slow 4 (CSS motion 4x slower), --raw (keep every real frame), --look theme-skin, --tag name (a folder of its own), --vs \"--token=value\" (a second run beside the first), --set, --repeat n (medians), --noise pct.",
      "Read: the log's frames and change lines, then <id>.<look>.console.txt, then the step's frames PNG (and <id>.<look>.s<n>.vs.png with --vs).",
    ],
    looks: [{ theme: "moonlight", skin: "glass" }],
    shots: [
      {
        id: name,
        kind: "clip",
        source: "demo",
        size: "midi",
        seconds: 2.5,
        prepare: [],
        steps: [
          { probe: "document.querySelector('.np__title')?.textContent" },
          { click: "[data-slot=\"left\"] .panel__title", frames: 12 },
          { wait: 800 },
          { snap: "open" },
          { key: "Escape", frames: 8 },
        ],
      },
    ],
  };
}

// ── what to shoot ────────────────────────────────────────────────────────────

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const list = JSON.parse(readFileSync(listFile, "utf8"));

/** The looks, read from the source so a new theme or skin joins the run by itself. */
function unionOf(file, type) {
  const src = readFileSync(join(root, "src", file), "utf8");
  const m = new RegExp(`export type ${type} = ([^;]+);`).exec(src);
  if (!m) throw new Error(`[shots] no \`${type}\` in src/${file}`);
  return [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
}
const THEMES = unionOf("look-ids.ts", "ThemeName");
const SKINS = unionOf("look-ids.ts", "SkinName");
const ALL_LOOKS = THEMES.flatMap((theme) => SKINS.map((skin) => ({ theme, skin })));
const lookId = (l) => `${l.theme}-${l.skin}`;

/** The window sizes (surface.ts MIN_SIZES and WEB-DEMO.md §9.6). */
const SIZES = {
  mini: { w: 385, h: 550, surface: "mini", miniView: "cards" },
  player: { w: 405, h: 675, surface: "mini", miniView: "player" },
  midi: { w: 495, h: 670, surface: "midi" },
  max: { w: 1100, h: 950, surface: "max" },
};

// ── free ports (never one fixed port: several Deets* apps run at once) ──────

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
async function freePort(from) {
  for (let p = from; p < from + 200; p++) if (await portFree(p)) return p;
  throw new Error(`[shots] no free port from ${from}`);
}

// ── the processes ────────────────────────────────────────────────────────────

const children = [];
let profileDir = "";
function cleanup() {
  for (const child of children) {
    try {
      // Edge and Vite both start child processes; /T takes the whole tree.
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  }
  children.length = 0;
  if (profileDir) {
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(profileDir, { recursive: true, force: true });
        break;
      } catch {
        /* Edge still holds a file for a moment */
      }
    }
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

async function startDemo() {
  const port = await freePort(1430);
  const vite = join(root, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "--config", "vite.demo.config.ts", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore",
  });
  children.push(child);
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return url;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("[shots] the demo did not start in 60 s");
}

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

async function startEdge() {
  if (!EDGE) throw new Error("[shots] Microsoft Edge is not installed where it usually is");
  const port = await freePort(9300);
  profileDir = mkdtempSync(join(tmpdir(), "deets-shots-"));
  const child = spawn(EDGE, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "--hide-scrollbars",
    "about:blank",
  ], { stdio: "ignore" });
  children.push(child);
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("[shots] headless Edge did not answer in 15 s");
}

// ── a small CDP client ───────────────────────────────────────────────────────

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const waiters = [];
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    for (const w of [...waiters]) {
      if (w.method === msg.method) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg.params);
      }
    }
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("[shots] CDP socket error"));
  });
  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    },
    once(method, ms = 30_000) {
      return new Promise((resolve, reject) => {
        const w = { method, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`[shots] no ${method} in ${ms} ms`));
          }
        }, ms);
      });
    },
    /** Every event of one kind until the returned function is called. */
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
      return () => listeners.get(method).delete(fn);
    },
    close: () => ws.close(),
  };
}

// ── one shot ─────────────────────────────────────────────────────────────────

/**
 * The page's first script, on every load: a clean store in the shot's look and size, with
 * the first-run walk over — what the demo's Start over does, then the choices the shot needs.
 * Clearing on EVERY load is the point: each shot starts from the same state (SHOTS.md §4).
 */
function seedScript(look, size, extra = {}, badges = false, windowed = false, tokens = {}) {
  // The walk over and the look fixed (the store's theme and skin, RULES.md §7a). A shot's own `settings` go on top. The demo itself
  // marks the Rewind unlock done (vite.demo.config.ts), so its notice never covers a shot.
  const settings = { onboardingStep: 0, lookSchedule: "off", theme: look.theme, skin: look.skin, ...extra };
  return `(() => {
    ${RECORDER}
    ${tokensScript(tokens)}
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("deets.") || k.startsWith("deets-")) localStorage.removeItem(k);
      localStorage.setItem("deets.surface", ${JSON.stringify(size.surface)});
      ${size.miniView ? `localStorage.setItem("deets.surface.mini", ${JSON.stringify(size.miniView)});` : ""}
      localStorage.setItem("deets.settings", ${JSON.stringify(JSON.stringify(settings))});
    } catch (e) {}
    ${badges ? "" : NO_BADGES}
    ${windowed ? `window.__deetsDemoHost = (kind, d) => { if (kind === "resize") __shotsWindow(JSON.stringify(d)); };` : ""}
  })();`;
}

/** A variant's tokens as inline style on <html>, which beats every theme and skin rule. The
 *  script runs before <html> exists, so it waits for it (a throw here stopped the whole seed). */
function tokensScript(tokens) {
  const entries = Object.entries(tokens);
  if (!entries.length) return "";
  const set = entries.map(([k, v]) => `el.style.setProperty(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(" ");
  return `const setTokens = (el) => { ${set} };
    if (document.documentElement) setTokens(document.documentElement);
    else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); setTokens(document.documentElement); } }).observe(document, { childList: true });`;
}

/**
 * The New badges read as seen (his call, 2026-09-26): a clean store has seen no mark, so the
 * cog, the quick panel and the Settings rows would all wear the N. The seen list is the app's
 * own (`quickSeen`, settings-card.ts NEW_MARKS), and copying it here would go stale with the
 * next mark, so the badge's three forms are hidden instead. A shot of a badge sets
 * `"badges": true`.
 */
const NO_BADGES = `document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".new-badge { display: none !important; } [data-new]::after { display: none !important; }";
      document.head.append(style);
    });`;

/**
 * The page's own record while a clip runs (SHOTS.md §5f), on the page's clock (epoch ms): each
 * input's own timestamp (a step starts there, not when the runner sent it), every
 * requestAnimationFrame (the page's real frames: a gap here is a stall on the main thread; a
 * screencast gap without one is a late delivery), and the long tasks. The app adds its own
 * marks to `window.__marks` (src/marks.ts). Off until `record` starts it.
 */
const RECORDER = `const T = (ts) => performance.timeOrigin + ts;
    const rec = (window.__shotsRec = { on: false, inputs: [], rafs: [], longtasks: [] });
    for (const type of ["keydown", "pointerdown", "click", "wheel"])
      addEventListener(type, (e) => { if (rec.on) rec.inputs.push({ t: T(e.timeStamp), type, key: e.key || "" }); }, { capture: true });
    const loop = (ts) => { if (!rec.on) return; rec.rafs.push(T(ts)); requestAnimationFrame(loop); };
    rec.start = () => { if (rec.on) return; rec.on = true; requestAnimationFrame(loop); };
    rec.stop = () => { rec.on = false; };
    try { new PerformanceObserver((l) => { if (rec.on) for (const e of l.getEntries()) rec.longtasks.push({ t: T(e.startTime), d: e.duration }); }).observe({ type: "longtask" }); } catch {}`;

/** What the page recorded (and the app's marks), taken out of the page. */
async function takeRecord(page) {
  const json = await evaluate(page, `JSON.stringify({ rec: window.__shotsRec ? { inputs: __shotsRec.inputs, rafs: __shotsRec.rafs, longtasks: __shotsRec.longtasks } : null, marks: window.__marks || [] })`);
  const { rec, marks } = JSON.parse(json);
  return { inputs: rec?.inputs ?? [], rafs: rec?.rafs ?? [], longtasks: rec?.longtasks ?? [], marks };
}
/** A clip in progress: a `reload` step keeps what the old page recorded. */
const recording = { on: false, kept: [] };

const KEYS = {
  Space: { key: " ", code: "Space", vk: 32 },
  Enter: { key: "Enter", code: "Enter", vk: 13 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
};
function keyOf(name) {
  if (KEYS[name]) return KEYS[name];
  if (/^[a-z0-9]$/i.test(name)) {
    const up = name.toUpperCase();
    return { key: name.toLowerCase(), code: /\d/.test(up) ? `Digit${up}` : `Key${up}`, vk: up.charCodeAt(0) };
  }
  throw new Error(`unknown key "${name}"`);
}

async function evaluate(page, expression) {
  const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

async function waitFor(page, selector, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await evaluate(page, `!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(100);
  }
  throw new Error(`"${selector}" did not appear in ${ms} ms`);
}

async function centerOf(page, selector) {
  await waitFor(page, selector);
  return evaluate(
    page,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
}

async function mouse(page, type, at, extra = {}) {
  await page.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", ...extra });
}

async function runStep(page, step) {
  if ("wait" in step) {
    if (typeof step.wait === "number") return sleep(step.wait);
    return waitFor(page, step.wait);
  }
  if ("key" in step) {
    const parts = step.key.split("+");
    const k = keyOf(parts.pop());
    const modifiers = parts.reduce((m, p) => m | ({ Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[p] ?? 0), 0);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers };
    await page.send("Input.dispatchKeyEvent", { type: modifiers & 2 ? "rawKeyDown" : "keyDown", ...base, ...(modifiers & 2 || k.key.length > 1 ? {} : { text: k.key }) });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    return;
  }
  if ("type" in step) {
    for (const ch of step.type) {
      await page.send("Input.insertText", { text: ch });
      await sleep(step.delay ?? 40);
    }
    return;
  }
  if ("click" in step) {
    const at = await centerOf(page, step.click);
    await mouse(page, "mouseMoved", at);
    await mouse(page, "mousePressed", at, { clickCount: 1 });
    await mouse(page, "mouseReleased", at, { clickCount: 1 });
    return;
  }
  if ("rightclick" in step) {
    const at = await centerOf(page, step.rightclick);
    await mouse(page, "mouseMoved", at);
    await mouse(page, "mousePressed", at, { button: "right", clickCount: 1 });
    await mouse(page, "mouseReleased", at, { button: "right", clickCount: 1 });
    return;
  }
  if ("hover" in step) {
    await mouse(page, "mouseMoved", await centerOf(page, step.hover));
    return;
  }
  if ("drag" in step) {
    const from = await centerOf(page, step.drag.from);
    const to = await centerOf(page, step.drag.to);
    await mouse(page, "mouseMoved", from);
    await mouse(page, "mousePressed", from, { clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      await mouse(page, "mouseMoved", { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 });
      await sleep(16);
    }
    await mouse(page, "mouseReleased", to, { clickCount: 1 });
    return;
  }
  if ("eval" in step) {
    await evaluate(page, step.eval);
    return;
  }
  if ("wheel" in step) {
    // `{ "wheel": selector, "dy": 400, "times": 4 }` — mouse-wheel notches over an element.
    const at = await centerOf(page, step.wheel);
    await mouse(page, "mouseMoved", at);
    for (let i = 0; i < (step.times ?? 1); i++) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY: step.dy ?? 120 });
      await sleep(step.delay ?? 60);
    }
    return;
  }
  if ("resize" in step) {
    // `{ "resize": [w, h], "over": 400, "steps": 16 }` — a hand drag of the window's corner,
    // from its size now, in even steps (the app's auto-flip sees each one). `over: 0` is a jump.
    const [w, h] = step.resize;
    const n = step.over === 0 ? 1 : step.steps ?? 16;
    const from = { w: win.w, h: win.h };
    note("window", `drag ${from.w}×${from.h} → ${w}×${h} over ${step.over ?? 400} ms`);
    for (let i = 1; i <= n; i++) {
      await setWindow(page, from.w + ((w - from.w) * i) / n, from.h + ((h - from.h) * i) / n);
      if (i < n) await sleep((step.over ?? 400) / n);
    }
    return;
  }
  if ("reload" in step) {
    // The page again from nothing, with the same seed: the boot and the cards' arrival. A clip
    // keeps recording across it.
    if (recording.on) recording.kept.push(await takeRecord(page));
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.reload", { ignoreCache: false });
    await loaded;
    if (recording.on) await evaluate(page, "__shotsRec.start()");
    return;
  }
  if ("probe" in step) {
    // A question to the page for the record: its answer goes in the shot's console file.
    const v = await evaluate(page, step.probe).catch((e) => `threw: ${e.message}`);
    note("probe", `${step.probe} → ${JSON.stringify(v)}`);
    return;
  }
  if ("snap" in step) {
    // A picture of this moment (mid-clip too), named <id>.<look>.<snap>.png.
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(journal.outDir, `${journal.base}.${step.snap}.png`), Buffer.from(data, "base64"));
    note("snap", `${journal.base}.${step.snap}.png`);
    return;
  }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

// ── the console record (SHOTS.md §5b) ───────────────────────────────────────

/** What the page said during one shot: console lines, uncaught errors, probe answers. Each
 *  line carries its ms from the shot's navigation, so it lines up with `.frames.json`. */
const journal = { t0: 0, lines: [], errors: 0, base: "", outDir: "" };

// ── the window (SHOTS.md §5c) ────────────────────────────────────────────────

/** The page's size now, in CSS px. The runner is the window: `"window": true` on a shot makes
 *  it follow the app's own set_size (a surface pick), and a `resize` step drags it. */
const win = { w: 0, h: 0, follow: false };
async function setWindow(page, w, h) {
  win.w = Math.round(w);
  win.h = Math.round(h);
  await page.send("Emulation.setDeviceMetricsOverride", { width: win.w, height: win.h, deviceScaleFactor: 2, mobile: false });
}
function listenWindow(page) {
  page.on("Runtime.bindingCalled", (e) => {
    if (e.name !== "__shotsWindow" || !win.follow) return;
    const { w, h } = JSON.parse(e.payload);
    note("window", `set_size ${w}×${h} (from ${win.w}×${win.h})`);
    setWindow(page, w, h).catch(() => {});
  });
}
function note(kind, text) {
  journal.lines.push(`${String(Date.now() - journal.t0).padStart(6)} ms  ${kind.padEnd(7)} ${text}`);
}
function listenConsole(page) {
  const arg = (a) => (a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : a.description ?? a.type);
  page.on("Runtime.consoleAPICalled", (e) => {
    if (e.type === "error") journal.errors++;
    note(e.type, (e.args ?? []).map(arg).join(" "));
  });
  page.on("Runtime.exceptionThrown", (e) => {
    journal.errors++;
    const d = e.exceptionDetails;
    note("THROWN", `${d.exception?.description ?? d.text} @ ${d.url ?? ""}:${d.lineNumber ?? ""}`);
  });
  page.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error" && !/favicon\.ico/.test(entry.url ?? "")) journal.errors++; // the demo has no favicon: noise
    note(`log:${entry.level}`, `${entry.text}${entry.url ? ` @ ${entry.url}` : ""}`);
  });
}

/** Loaded, fonts in, and the cards' arrival motion over. */
async function settle(page) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (await evaluate(page, `document.readyState === "complete" && document.fonts.status === "loaded" && !!document.querySelector("#app, body > *")`)) break;
    await sleep(100);
  }
  await sleep(1500);
}

async function shoot(page, demoUrl, shot, look, outDir, variant) {
  const size = SIZES[shot.size];
  if (!size) throw new Error(`unknown size "${shot.size}"`);
  win.follow = false; // not during the load: the boot's own set_size would move every shot
  await setWindow(page, size.w, size.h);
  const settings = { ...(shot.settings ?? {}), ...variant.settings };
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript(look, size, settings, shot.badges === true, shot.window === true, variant.tokens) });
  const base = `${shot.id}.${lookId(look)}${variant.label ? `.${variant.label}` : ""}`;
  Object.assign(journal, { t0: Date.now(), lines: [], errors: 0, base, outDir });
  try {
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: demoUrl });
    await loaded;
    await settle(page);
    win.follow = shot.window === true;
    // --slow: the page's animation clock (CSS and Web Animations; not requestAnimationFrame code).
    if (slow !== 1) await page.send("Animation.setPlaybackRate", { playbackRate: 1 / slow });
    let out;
    if (shot.kind === "clip") out = await record(page, shot, base, outDir);
    else {
      for (const step of shot.steps ?? []) await runStep(page, step);
      const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(outDir, `${base}.png`), Buffer.from(data, "base64"));
      out = { file: `${base}.png` };
    }
    return { ...out, ...consoleFile() };
  } catch (e) {
    consoleFile(String(e.message ?? e)); // a failed shot keeps what the page said: that is the evidence
    throw e;
  } finally {
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
}

function consoleFile(failure) {
  if (failure) note("FAILED", failure);
  const file = `${journal.base}.console.txt`;
  writeFileSync(join(journal.outDir, file), journal.lines.join("\n") + "\n");
  // The app's own frame telemetry (src/frames.ts, on in the demo's dev build): the honest
  // smoothness number for each gesture, where the screencast's gaps are only paint times.
  // The first load's boot line is left out; the boot clip reloads, so its second one stays.
  const perf = journal.lines.map((l) => /\[perf\] frames (.*)$/.exec(l)?.[1]).filter(Boolean);
  const firstBoot = perf.findIndex((l) => l.startsWith("boot "));
  if (firstBoot >= 0) perf.splice(firstBoot, 1);
  return { console: file, consoleErrors: journal.errors, perf };
}

// ── a clip (SHOTS.md §5, §10 step 3) ────────────────────────────────────────

/**
 * `prepare` steps run before the recording (a state the clip starts from); `steps` run while it
 * records. The screencast sends a frame only when the page paints, each with its time, so the
 * frames go to ffmpeg as a concat list with their real durations: the clip plays at the real
 * speed, and a gap in the list is a gap on screen.
 */
async function record(page, shot, base, outDir) {
  for (const step of shot.prepare ?? []) await runStep(page, step);
  const work = mkdtempSync(join(tmpdir(), "deets-clip-"));
  const frames = [];
  const marks = [];
  const off = page.on("Page.screencastFrame", (f) => {
    const n = frames.length;
    const file = join(work, `f${String(n).padStart(5, "0")}.jpg`);
    const buf = Buffer.from(f.data, "base64");
    writeFileSync(file, buf);
    frames.push({ file, t: f.metadata.timestamp, ...jpegSize(buf) });
    page.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  try {
    const seconds = shot.seconds ?? 4;
    // The frames come at 1x (495 px wide for Midi), not the page's 2x; a `snap` is 2x. Do not
    // add maxWidth / maxHeight: with them headless Edge sent its own 756×454 window instead.
    await page.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    recording.on = true;
    recording.kept = [];
    await evaluate(page, "__shotsRec.start()");
    const t0 = Date.now() / 1000;
    await sleep(300); // a still lead-in, so the first action is seen from rest
    for (const step of shot.steps ?? []) {
      // `"strip": true` on a step starts the strip there (default: the first action).
      // `"frames": N` keeps the next N real paints after this step (§5b, frames at a step).
      // `"region": selector` measures the change curve in that element's box only (§5f).
      // `pageT`: the page's clock when the step starts; the step's time is its input's own.
      const pageT = await evaluate(page, "performance.timeOrigin + performance.now()");
      const region = step.region ? await rectOf(page, step.region) : null;
      marks.push({ t: Date.now() / 1000 - t0, pageT, region, step: Object.keys(step)[0], what: JSON.stringify(Object.values(step)[0]), strip: step.strip === true, frames: step.frames ?? 0 });
      await runStep(page, step);
    }
    const left = t0 + seconds - Date.now() / 1000;
    if (left > 0) await sleep(left * 1000);
    const tEnd = Date.now() / 1000;
    await page.send("Page.stopScreencast");
    await sleep(100); // the last frames in flight
    const pageRec = [...recording.kept, await takeRecord(page)];
    recording.on = false;
    await evaluate(page, "__shotsRec.stop()").catch(() => {});
    if (frames.length < 2) throw new Error(`only ${frames.length} frame(s) recorded`);
    // In time order: the screencast can deliver a frame after a later one (a -12 ms gap, 2026-09-28).
    frames.sort((a, b) => a.t - b.t);
    const rec = mergeRecords(pageRec, marks, t0, frames);
    note("clock", rec.clockLine);
    const offSize = frames.filter((f) => f.w !== win.w || f.h !== win.h);
    if (offSize.length) note("window", `${offSize.length} of ${frames.length} frames are ${offSize[0].w}×${offSize[0].h}, not the page's ${win.w}×${win.h}: headless Edge sent its own window. The page is top-left; the change curve reads only its box.`);

    // The concat list: each frame lasts until the next; the last one until the end.
    const lines = [];
    const gaps = [];
    for (let i = 0; i < frames.length; i++) {
      const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(tEnd, frames[i].t + 0.05);
      const d = Math.max(0.001, next - frames[i].t);
      if (i + 1 < frames.length) gaps.push(d);
      lines.push(`file '${frames[i].file.replace(/\\/g, "/")}'`, `duration ${d.toFixed(4)}`);
    }
    lines.push(`file '${frames.at(-1).file.replace(/\\/g, "/")}'`); // ffmpeg's concat drops the last duration without it
    const listFile = join(work, "list.txt");
    writeFileSync(listFile, lines.join("\n"));

    const mp4 = `${base}.mp4`;
    // Every frame on one canvas, the size of the largest, anchored top-left as a Windows window
    // grows from its top-left corner: a clip whose window resizes (§5c) still has one size.
    const even = (n) => Math.ceil(n / 2) * 2;
    const W = even(Math.max(...frames.map((f) => f.w)));
    const H = even(Math.max(...frames.map((f) => f.h)));
    ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-vf", `pad=${W}:${H}:0:0:color=0x16161a,fps=60`, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", join(outDir, mp4)]);

    const poster = `${base}.poster.png`;
    const at = shot.poster === "first" ? 0 : typeof shot.poster === "number" ? shot.poster : Math.max(0, seconds - 0.05);
    ffmpeg(["-ss", String(at), "-i", join(outDir, mp4), "-frames:v", "1", join(outDir, poster)]);

    // The strip: the motion window at a fixed rate, one picture, for a review by eye (or by
    // Claude, who reads pictures and not video). It starts just before the first action. 60 fps
    // by default, so a 180 ms motion shows ~11 frames. The labels are app time: with --slow n,
    // the strip covers n times the seconds and each label is divided by n.
    const s = { fps: 60, seconds: 1, cols: 10, width: 240, ...(shot.strip ?? {}) };
    const firstAct = (marks.find((m) => m.strip) ?? marks.find((m) => m.step !== "wait"))?.t ?? 0.3;
    const from = s.from ?? Math.max(0, firstAct - 0.1);
    const count = Math.ceil(s.fps * s.seconds);
    const strip = `${base}.strip.png`;
    const label = `%{eif\\:n*1000/${s.fps * slow}\\:d} ms`;
    ffmpeg(["-ss", from.toFixed(3), "-t", String(s.seconds * slow), "-i", join(outDir, mp4), "-vf", `fps=${s.fps / slow},scale=${s.width}:-2,drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='${label}':x=6:y=6:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=3,tile=${s.cols}x${Math.ceil(count / s.cols)}:padding=4:color=black`, "-frames:v", "1", join(outDir, strip)]);

    const sorted = [...gaps].sort((a, b) => a - b);
    const times = frames.map((f) => f.t - t0);
    const stats = {
      frames: frames.length,
      fps: Math.round(1 / sorted[Math.floor(sorted.length / 2)]),
      longestGapMs: Math.round(sorted.at(-1) * 1000),
      slow,
      marks: marks.map((m) => ({ ...m, t: Math.round(m.t * 1000) })),
      stripFromMs: Math.round(from * 1000),
      // Every gap over 25 ms after the first action, as [at ms, gap ms]. At rest the page does
      // not paint, so a gap there is quiet, not a drop; a gap inside a motion is a drop.
      gaps: gaps.flatMap((g, i) => (g > 0.025 && times[i] >= firstAct ? [[Math.round(times[i] * 1000), Math.round(g * 1000)]] : [])),
    };
    // Frames at a step: the next N REAL paints after it, not the MP4 resampled. A dropped frame
    // is a large gap here, where a resampled strip would show the same picture twice. Each set
    // gets its change curve (§5f): how far each frame is from the picture before the step to the
    // picture the step settles on.
    const frameSets = [];
    marks.forEach((m, i) => {
      if (!m.frames) return;
      const from = t0 + m.t;
      const picked = frames.filter((f) => f.t >= from).slice(0, m.frames);
      const name = `${base}.s${i + 1}-${m.step}`;
      if (!picked.length) {
        note("frames", `step ${i + 1} (${m.step}): no paint after it — nothing moved, or the clip ended`);
        return;
      }
      // The step settles before the next ACTION (a wait or a probe starts at once and acts on nothing).
      const nextAct = marks.slice(i + 1).find((x) => !["wait", "probe", "snap"].includes(x.step));
      const next = nextAct ? t0 + nextAct.t : Infinity;
      const before = frames.filter((f) => f.t < from).at(-1) ?? picked[0];
      const settled = frames.filter((f) => f.t < next).at(-1) ?? picked.at(-1);
      const curve = changeCurve(picked, before, settled, m.region, from, { w: win.w, h: win.h });
      keepFrames(picked, from, join(outDir, name));
      frameStrip(picked, from, join(outDir, `${name}.png`), shot.strip?.width ?? 240, shot.strip?.cols ?? 6, { rec, curve, prev: before });
      const short = picked.length < m.frames ? ` (asked ${m.frames}; the clip ended or the page stopped painting)` : "";
      note("frames", `step ${i + 1} (${m.step}): ${picked.length} frames → ${name}/ and ${name}.png${short}`);
      if (curve) note("change", `step ${i + 1} (${m.step})${m.region ? ` in ${m.region.selector}` : ""}: ${curve.line}`);
      frameSets.push({ step: i + 1, kind: m.step, count: picked.length, asked: m.frames, dir: name, strip: `${name}.png`, anchor: m.anchored ?? "runner", change: curve?.summary ?? null });
    });
    stats.marks = marks.map(({ pageT: _p, ...m }) => ({ ...m, t: Math.round(m.t * 1000) }));
    writeFileSync(
      join(outDir, `${base}.frames.json`),
      JSON.stringify({
        ...stats,
        times: times.map((t) => Math.round(t * 1000)),
        // The page's own record, as ms from the clip's start: its frames, stalls, inputs, marks.
        page: {
          periodMs: +rec.period.toFixed(2),
          screencastLagMs: rec.lag,
          rafs: rec.rafs.map((t) => Math.round(t - t0 * 1000)),
          inputs: rec.inputs.map((x) => ({ ...x, t: Math.round(x.t - t0 * 1000) })),
          longtasks: rec.longtasks.map((x) => ({ t: Math.round(x.t - t0 * 1000), d: Math.round(x.d) })),
          marks: rec.appMarks.map((x) => ({ ...x, t: Math.round(x.t - t0 * 1000) })),
        },
        changes: frameSets.map((s) => ({ step: s.step, ...s.change })),
      }),
    );
    const { gaps: _all, marks: _m, ...brief } = stats;
    // --raw: every real frame of the clip, named by its ms from the start.
    if (raw) keepFrames(frames, t0, join(outDir, `${base}.raw`));

    return { file: mp4, poster, strip, stats: { ...brief, drops: stats.gaps.length }, frameSets };
  } finally {
    off();
    rmSync(work, { recursive: true, force: true });
  }
}

/** An element's box in CSS px, with the page width it was read at (frames are scaled to it). */
async function rectOf(page, selector) {
  await waitFor(page, selector);
  const r = await evaluate(page, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  return { selector, ...r, winW: win.w };
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};

/**
 * The page's record, on one clock with the frames (§5f): each step's time becomes its input's
 * own timestamp (the runner sends it a few ms later than it reads the clock); the rAF period;
 * the screencast's lag behind the page's frame (a frame's time − the last rAF before it). A
 * negative or huge lag means the two clocks disagree, and the clock line says so.
 */
function mergeRecords(parts, marks, t0, frames) {
  const inputs = parts.flatMap((p) => p.inputs).sort((a, b) => a.t - b.t);
  const rafs = parts.flatMap((p) => p.rafs).sort((a, b) => a - b);
  const longtasks = parts.flatMap((p) => p.longtasks);
  const appMarks = parts.flatMap((p) => p.marks).filter((m) => m.t >= t0 * 1000 - 50).sort((a, b) => a.t - b.t);
  const INPUT_STEPS = new Set(["key", "click", "rightclick", "type", "drag", "wheel"]);
  marks.forEach((m, i) => {
    if (!INPUT_STEPS.has(m.step)) return;
    const until = marks[i + 1]?.pageT ?? Infinity;
    const hit = inputs.find((x) => x.t >= m.pageT - 1 && x.t < until);
    if (!hit) return;
    m.anchored = `${hit.type}${hit.key ? ` ${hit.key}` : ""}`;
    m.t = hit.t / 1000 - t0;
  });
  const gaps = rafs.slice(1).map((t, i) => t - rafs[i]);
  const period = median(gaps.filter((g) => g > 0)) || 1000 / 60;
  const lags = [];
  for (const f of frames) {
    const ms = f.t * 1000;
    let lo = 0;
    let hi = rafs.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rafs[mid] <= ms) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best >= 0) lags.push(ms - rafs[best]);
  }
  const lag = Math.round(median(lags));
  const odd = !Number.isFinite(lag) || lag < 0 || lag > 100;
  const clockLine = `page rAF period ${period.toFixed(1)} ms (${Math.round(1000 / period)} Hz) · ${rafs.length} rAF · screencast lag median ${lag} ms${odd ? " — THE CLOCKS DISAGREE: read the frame times as the runner's, not the page's" : ""} · ${appMarks.length} app marks · ${longtasks.length} long tasks`;
  return { inputs, rafs, longtasks, appMarks, period, lag, clockLine };
}

/** A frame as small grey pixels (96 px wide), cut to `region` when one is given, else to the
 *  page's viewport: headless Edge at times sends its whole 756×454 window, and the strip outside
 *  the page snaps where the page fades (2026-09-28). */
function greyOf(frame, region, view) {
  let crop = `crop=${Math.min(frame.w, view.w)}:${Math.min(frame.h, view.h)}:0:0,`;
  if (region) {
    const s = frame.w / region.winW;
    const x = Math.max(0, Math.round(region.x * s));
    const y = Math.max(0, Math.round(region.y * s));
    const w = Math.max(2, Math.min(frame.w - x, Math.round(region.w * s)));
    const h = Math.max(2, Math.min(frame.h - y, Math.round(region.h * s)));
    crop = `crop=${w}:${h}:${x}:${y},`;
  }
  return execFileSync("ffmpeg", ["-loglevel", "error", "-i", frame.file, "-vf", `${crop}scale=96:-2,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
}
const distance = (a, b) => {
  if (a.length !== b.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/**
 * The change curve of one step (§5f): for each real frame, how far it has come from the picture
 * before the step (`before`) to the picture the step settles on (`settled`, the last frame before
 * the next step). `onset` is the first frame 5 % of the way; 50 % and 90 % the first to reach
 * them. Times are ms from the step's input. A frame set with no visible change says so.
 */
function changeCurve(list, before, settled, region, from, view) {
  const greyOf_ = (f) => greyOf(f, region, view);
  try {
    const a = greyOf_(before);
    const z = greyOf_(settled);
    const total = distance(a, z);
    const ms = (f) => Math.round((f.t - from) * 1000);
    if (!(total >= 0.3)) return { per: list.map(() => null), summary: { visible: false }, line: "no visible change between the picture before the step and the one it settles on" };
    const per = list.map((f) => {
      const g = greyOf_(f);
      const fromStart = distance(a, g) / total;
      const toEnd = distance(g, z) / total;
      // A frame of another size (a resize, the window fault above) cannot be compared: no value.
      return Number.isFinite(fromStart) && Number.isFinite(toEnd) ? Math.max(0, Math.min(1, (fromStart + (1 - toEnd)) / 2)) : null;
    });
    const at = (p) => {
      const i = per.findIndex((v) => v !== null && v >= p);
      return i < 0 ? null : ms(list[i]);
    };
    const summary = { visible: true, onset: at(0.05), p50: at(0.5), p90: at(0.9), lastFrame: ms(list.at(-1)), settledAt: ms(settled), size: +total.toFixed(1) };
    const t = (v) => (v === null ? `past +${summary.lastFrame}` : `+${v}`);
    return { per, summary, line: `onset ${t(summary.onset)} ms · 50% ${t(summary.p50)} · 90% ${t(summary.p90)} (from the input; change size ${summary.size} grey levels)` };
  } catch (e) {
    return { per: list.map(() => null), summary: { visible: false, error: String(e.message ?? e) }, line: `no curve: ${e.message ?? e}` };
  }
}

/** Copy real frames out, each named `<n>_+<ms>ms.jpg` from `from` (epoch s). */
function keepFrames(list, from, dir) {
  rmSync(dir, { recursive: true, force: true }); // a rerun replaces, never mixes
  mkdirSync(dir, { recursive: true });
  list.forEach((f, i) => copyFileSync(f.file, join(dir, `${String(i).padStart(3, "0")}_+${Math.round((f.t - from) * 1000)}ms.jpg`)));
}

/** One PNG of real frames. Each frame's label (§5f):
 *  - line 1: its ms from `from` (the step's input) and the gap before it. Red: the page itself
 *    stalled (a rAF gap over 1.5 periods, or a long task, in that gap). Yellow: the gap is over
 *    25 ms but the page kept its frames, so the screencast delivered late. White: on time.
 *  - line 2: what happened in that gap: inputs (`⌨ Enter`) and the app's marks (src/marks.ts).
 *  - line 3 and the bar at the bottom: the change curve, how far the frame is toward where the
 *    step settles.
 *  Frames of different sizes go on one top-left canvas, as in the MP4. */
function frameStrip(list, from, out, width, cols, ctx = null) {
  const tmp = mkdtempSync(join(tmpdir(), "deets-strip-"));
  const font = "fontfile='C\\:/Windows/Fonts/consola.ttf'";
  const pathArg = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  try {
    // Even, as for the MP4: ffmpeg's pad rounds an odd size DOWN, below the frame (495 px).
    const W = Math.ceil(Math.max(...list.map((f) => f.w)) / 2) * 2;
    const H = Math.ceil(Math.max(...list.map((f) => f.h)) / 2) * 2;
    list.forEach((f, i) => {
      const ms = Math.round((f.t - from) * 1000);
      const prevT = i ? list[i - 1].t : ctx?.prev?.t ?? from;
      const gap = i ? Math.round((f.t - list[i - 1].t) * 1000) : null;
      let line1 = gap === null ? `+${ms} ms` : `+${ms} ms  gap ${gap}`;
      let color = "white";
      const lines = [];
      if (ctx?.rec) {
        const { rafs, period, longtasks, inputs, appMarks } = ctx.rec;
        const lo = prevT * 1000;
        const hi = f.t * 1000;
        let rafMax = 0;
        for (let k = 1; k < rafs.length; k++) if (rafs[k] > lo && rafs[k - 1] < hi) rafMax = Math.max(rafMax, rafs[k] - rafs[k - 1]);
        const lt = longtasks.filter((x) => x.t < hi && x.t + x.d > lo);
        // A missed page frame is printed; red is kept for one you would see at 60 Hz (over 25 ms)
        // or a long task: at 240 Hz a 12 ms gap is a miss, and it painted most labels red.
        const stall = rafMax > period * 1.5 || lt.length > 0;
        if (stall) {
          if (rafMax > 25 || lt.length) color = "0xff6b6b";
          line1 += `  stall ${Math.round(rafMax)}${lt.length ? ` LT${Math.round(Math.max(...lt.map((x) => x.d)))}` : ""}`;
        }
        if (!(rafMax > 25 || lt.length) && gap !== null && gap > 25) {
          color = "0xffd166";
          line1 += "  late";
        }
        const events = [
          ...inputs.filter((x) => x.t > lo && x.t <= hi).map((x) => `> ${x.key || x.type}`),
          ...appMarks.filter((x) => x.t > lo && x.t <= hi).map((x) => x.name),
        ];
        if (events.length) lines.push(events.join(", ").slice(0, 34));
      } else if (gap !== null && gap > 25) color = "0xff6b6b";
      const p = ctx?.curve?.per?.[i];
      if (p !== null && p !== undefined) lines.push(`change ${Math.round(p * 100)}%`);
      const txt = join(tmp, `t${String(i).padStart(3, "0")}.txt`);
      writeFileSync(txt, [line1, ...lines].join("\n"));
      const bar = p !== null && p !== undefined ? `,drawbox=x=0:y=ih-5:w=iw*${p.toFixed(3)}:h=5:color=0x4cc9f0:t=fill` : "";
      ffmpeg(["-i", f.file, "-vf", `pad=${W}:${H}:0:0:color=0x16161a,scale=${width}:-2,drawtext=${font}:textfile='${pathArg(txt)}':expansion=none:x=6:y=6:fontsize=13:line_spacing=2:fontcolor=${color}:box=1:boxcolor=black@0.65:boxborderw=3${bar}`, join(tmp, `l${String(i).padStart(3, "0")}.png`)]);
    });
    const c = Math.min(cols, list.length);
    ffmpeg(["-framerate", "1", "-i", join(tmp, "l%03d.png"), "-vf", `tile=${c}x${Math.ceil(list.length / c)}:padding=4:color=black`, "-frames:v", "1", out]);
  } finally {
    if (!process.env.SHOTS_DEBUG) rmSync(tmp, { recursive: true, force: true }); else console.log("[shots] kept", tmp);
  }
}

/** A JPEG's pixel size, from its start-of-frame marker. */
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) return { w: 0, h: 0 };
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}

function ffmpeg(args) {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    if (process.env.SHOTS_DEBUG) console.log("[shots] ffmpeg failed:", JSON.stringify(args), String(e.stderr));
    throw new Error(`ffmpeg: ${String(e.stderr ?? e.message).trim().split("\n").at(-1)}`);
  }
}

// ── the contact sheet (F4) ───────────────────────────────────────────────────

function contactSheet(manifest) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const byShot = new Map();
  for (const row of manifest.shots) {
    if (!byShot.has(row.id)) byShot.set(row.id, []);
    byShot.get(row.id).push(row);
  }
  const sections = [...byShot].map(([id, rows]) => {
    const tiles = rows
      .map((r) => {
        if (!r.file) return `<figure class="bad"><figcaption>${esc(r.look)} — ${esc(r.error ?? "not taken")}</figcaption></figure>`;
        const note = r.ok ? "" : " — kept from an earlier run";
        if (r.kind === "clip") {
          const perf =
            (r.perf ?? []).map((p) => `<br><code>${esc(p)}</code>`).join("") +
            (r.frameSets ?? []).map((s) => `<br><a href="${esc(s.strip)}">step ${s.step} ${esc(s.kind)}: ${s.count} real frames</a>${s.change?.visible ? ` <code>${esc(changeText(s.change))}</code>` : ""}`).join("") +
            (r.repeat?.lines ?? []).map((l) => `<br><code>median: ${esc(l)}</code>`).join("");
          const errs = r.consoleErrors ? ` · <b class="err">${r.consoleErrors} error(s)</b>` : "";
          const which = `${r.variant ? ` · <b>${esc(r.variant)}</b> ${esc(r.change ?? "")}` : ""}${r.noisy ? ` · <b class="err">noisy (cpu ${r.cpu}%)</b>` : ""}`;
          return `<figure><video src="${esc(r.file)}" poster="${esc(r.poster ?? "")}" muted autoplay loop playsinline controls></video><figcaption>${esc(r.look)}${which} · <a href="${esc(r.strip ?? "")}">strip</a> · <a href="${esc(r.console ?? "")}">console</a>${errs}${note}${perf}</figcaption></figure>`;
        }
        return `<figure><a href="${esc(r.file)}"><img src="${esc(r.file)}" loading="lazy" alt="${esc(id)} in ${esc(r.look)}"></a><figcaption>${esc(r.look)}${note}</figcaption></figure>`;
      })
      .join("");
    const about = rows[0].about ? `<p>${esc(rows[0].about)}</p>` : "";
    return `<section><h2>${esc(id)} <small>${esc(rows[0].covers ?? "")}</small></h2>${about}<div class="grid">${tiles}</div></section>`;
  });
  const failed = manifest.shots.filter((r) => !r.ok).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shots ${esc(manifest.version)}</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --fg: #1d1d1f; --muted: #6e6e73; --line: #d9d9d6; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --fg: #ececec; --muted: #9a9aa0; --line: #2c2c30; --bad: #ff8a80; } }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 20px; } p { margin: 0 0 24px; color: var(--muted); }
h2 { font-size: 16px; margin: 32px 0 12px; } small { color: var(--muted); font-weight: normal; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
code { font-size: 11px; } .err { color: var(--bad); }
figure { margin: 0; } video { width: 100%; border-radius: 6px; display: block; } a { color: inherit; } img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; } .bad figcaption { color: var(--bad); }
</style></head><body>
<h1>Shots — DeetsMusic ${esc(manifest.version)}</h1>
<p>${esc(manifest.taken)} · ${manifest.shots.length} shots · ${failed ? `${failed} failed` : "none failed"}</p>
${sections.join("\n")}
</body></html>`;
}

// ── comparing (SHOTS.md §5f) ────────────────────────────────────────────────

/** The machine's CPU load over `ms`, in % (every core). */
async function cpuBusy(ms) {
  const read = () => cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, all: a.all + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, all: 0 });
  const a = read();
  await sleep(ms);
  const b = read();
  return Math.round(100 * (1 - (b.idle - a.idle) / Math.max(1, b.all - a.all)));
}
/** The noise gate: wait up to 8 s for the load to fall under --noise; return the last reading.
 *  bench.mjs refuses a noisy machine; a picture is still worth having, so here the row is marked. */
async function quietCpu() {
  let busy = await cpuBusy(500);
  const until = Date.now() + 8000;
  while (busy > noiseLimit && Date.now() < until) busy = await cpuBusy(1000);
  return busy;
}

const changeText = (c) => {
  if (!c?.visible) return "no visible change";
  const t = (v) => (v === null || v === undefined ? `>${c.lastFrame}` : `+${v}`);
  return `onset ${t(c.onset)} · 50% ${t(c.p50)} · 90% ${t(c.p90)} ms`;
};

const PERF_LINE = /^(.*?) (\d+) ms · (\d+) frames @\d+ Hz · dropped \d+ \(([\d.]+)%\) · worst (\d+) ms/;
/** --repeat: the median of each frames line (by its name) and of each step's curve, with the
 *  range of the dropped share, so a noisy run shows as a wide range, not as a number. */
function medianOfRuns(runs) {
  const groups = new Map();
  for (const run of runs)
    for (const line of run.perf) {
      const m = PERF_LINE.exec(line);
      if (!m) continue;
      if (!groups.has(m[1])) groups.set(m[1], []);
      groups.get(m[1]).push({ ms: +m[2], frames: +m[3], pct: +m[4], worst: +m[5] });
    }
  const lines = [];
  const perf = [];
  for (const [name, xs] of groups) {
    const pcts = xs.map((x) => x.pct);
    const row = { name, n: xs.length, ms: median(xs.map((x) => x.ms)), frames: median(xs.map((x) => x.frames)), dropped: median(pcts), droppedMin: Math.min(...pcts), droppedMax: Math.max(...pcts), worst: median(xs.map((x) => x.worst)) };
    perf.push(row);
    lines.push(`frames ${name} ${row.ms} ms · ${row.frames} frames · dropped ${row.dropped}% (${row.droppedMin}–${row.droppedMax}) · worst ${row.worst} ms · ${row.n} runs`);
  }
  const steps = [...new Set(runs.flatMap((r) => r.changes.map((c) => c.step)))];
  const changes = steps.map((step) => {
    const cs = runs.map((r) => r.changes.find((c) => c.step === step)).filter((c) => c?.visible);
    const med = (k) => {
      const v = cs.map((c) => c[k]).filter((x) => x !== null && x !== undefined);
      return v.length ? median(v) : null;
    };
    const c = { step, visible: cs.length > 0, onset: med("onset"), p50: med("p50"), p90: med("p90"), lastFrame: med("lastFrame") };
    lines.push(`step ${step}: ${changeText(c)}`);
    return c;
  });
  return { perf, changes, lines };
}

/** Beside each other: for each step with frames, one PNG with each variant's strip under a
 *  banner (its change and its curve), and the same rows in compare.txt. */
function compareRows(rows, outDir) {
  const ok = rows.filter((r) => r.ok);
  if (ok.length < 2) return;
  const text = [`${ok[0].id} · ${ok[0].look} · ${new Date().toISOString()}`];
  const steps = [...new Set(ok.flatMap((r) => (r.frameSets ?? []).map((s) => s.step)))];
  for (const step of steps) {
    const sets = ok.map((r) => ({ r, s: (r.frameSets ?? []).find((x) => x.step === step) })).filter((x) => x.s);
    if (sets.length < 2) continue;
    const banners = sets.map(({ r, s }) => {
      const c = r.repeat?.changes.find((x) => x.step === step) ?? s.change;
      const perf = r.repeat ? r.repeat.lines.filter((l) => l.startsWith("frames ")).join(" | ") : (r.perf ?? []).join(" | ");
      return { file: join(outDir, s.strip), line: `${r.variant}: ${r.change} — ${changeText(c)}${r.noisy ? " — NOISY" : ""}`, perf };
    });
    for (const b of banners) text.push(`  step ${step}  ${b.line}`, `           ${b.perf}`);
    const name = `${ok[0].id}.${ok[0].look}.s${step}.vs.png`;
    const tmp = mkdtempSync(join(tmpdir(), "deets-vs-"));
    try {
      const args = [];
      const chains = [];
      banners.forEach((b, i) => {
        const txt = join(tmp, `b${i}.txt`);
        writeFileSync(txt, b.line);
        args.push("-i", b.file);
        const p = txt.replace(/\\/g, "/").replace(/:/g, "\\:");
        chains.push(`[${i}:v]pad=iw:ih+30:0:30:color=0x101014,drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':textfile='${p}':expansion=none:x=8:y=8:fontsize=16:fontcolor=white[v${i}]`);
      });
      // vstack needs one width: pad each to the widest (a set with fewer frames than columns is narrower).
      const W = Math.max(...banners.map((b) => pngSize(b.file).w));
      const padded = banners.map((_, i) => `[v${i}]pad=${W}:ih:0:0:color=0x101014[w${i}]`);
      ffmpeg([...args, "-filter_complex", `${chains.join(";")};${padded.join(";")};${banners.map((_, i) => `[w${i}]`).join("")}vstack=inputs=${banners.length}`, "-frames:v", "1", join(outDir, name)]);
      text.push(`           → ${name}`);
    } catch (e) {
      text.push(`           (no side-by-side image: ${e.message ?? e})`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  for (const l of text) log(`vs ${l}`);
  appendFileSync(join(outDir, "compare.txt"), text.join("\n") + "\n\n");
}

/** A PNG's pixel size, from its header. */
function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ── the run ──────────────────────────────────────────────────────────────────

// shots.json → shots/<version>/; another list → shots/<list name>/<version>/ (motion.json →
// shots/motion/0.25.1/); --slow n adds `-slow<n>`. So a debug run never lands among the shots of
// a version. --out names any other place.
const listName = listFile === join(root, "docs", "guide", "shots.json") ? "" : basename(listFile, ".json");
// A scratch run writes beside its list, no version folder: it is for now, not for a release.
const outDir = `${oneArg("--out")
  ? resolve(oneArg("--out"))
  : scratch
    ? join(scratchDir, `${scratch}${slow !== 1 ? `-slow${slow}` : ""}`)
    : join(root, "shots", listName, `${version}${slow !== 1 ? `-slow${slow}` : ""}`)}${tag ? `-${tag}` : ""}`;
mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { shots: [] };
const rowKey = (r) => `${r.id}|${r.look}|${r.variant ?? ""}`;
const results = new Map(previous.shots.map((r) => [rowKey(r), r]));

const shots = list.shots.filter((s) => !only.size || only.has(s.id));
if (only.size && !shots.length) throw new Error(`[shots] no shot named ${[...only].join(", ")}`);

let taken = 0;
let failed = 0;
let skipped = 0;
try {
  log(`DeetsMusic ${version} — ${shots.length} shot(s); ${THEMES.length} themes × ${SKINS.length} skins → ${outDir}`);
  if (VARIANTS.length > 1) for (const v of VARIANTS) log(`variant ${v.label}: ${v.desc}`);
  rmSync(join(outDir, "compare.txt"), { force: true }); // this run's comparison only
  if (repeat > 1) log(`each shot ${repeat} times; the log gives the medians`);
  log(`cpu ${await cpuBusy(1000)}% now; a shot waits for under ${noiseLimit}% (--noise)`);
  const demoUrl = await startDemo();
  log(`demo on ${demoUrl}`);
  const page = cdp(await startEdge());
  await page.ready;
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Animation.enable");
  listenConsole(page);
  await page.send("Runtime.addBinding", { name: "__shotsWindow" }); // kept across loads
  listenWindow(page);
  // Motion on: a picture is taken after it settles, and a clip needs it (SHOTS.md §5).
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

  for (const shot of shots) {
    if (shot.source !== "demo") {
      log(`skip ${shot.id}: the ${shot.source} source is not built yet`);
      skipped++;
      continue;
    }
    // `"*"` in a look is every theme or every skin: `{ "theme": "moonlight", "skin": "*" }` is
    // one theme in each skin, the set for motion (a skin owns its motion tokens).
    const looks = (shot.looks ?? list.looks ?? ALL_LOOKS)
      .flatMap((l) => (l.theme === "*" ? THEMES : [l.theme]).flatMap((theme) => (l.skin === "*" ? SKINS : [l.skin]).map((skin) => ({ theme, skin }))))
      .filter((l) => !lookFilter.size || lookFilter.has(lookId(l)));
    for (const look of looks) {
      const rows = [];
      for (const variant of VARIANTS) {
        const row = { id: shot.id, kind: shot.kind, look: lookId(look), variant: variant.label || undefined, change: variant.label ? variant.desc : undefined, covers: shot.covers, size: shot.size, source: shot.source, about: shot.about };
        const key = rowKey(row);
        const runs = [];
        try {
          for (let r = 1; r <= repeat; r++) {
            // The noise gate (§5f): wait for a quiet CPU; a shot taken over the limit is marked.
            const cpu = await quietCpu();
            const out = await shoot(page, demoUrl, shot, look, outDir, variant);
            runs.push({ cpu, perf: out.perf ?? [], changes: (out.frameSets ?? []).map((s) => ({ step: s.step, ...s.change })) });
            Object.assign(row, out, { cpu, noisy: cpu > noiseLimit || undefined });
            const tagLine = `${variant.label ? ` [${variant.label}]` : ""}${repeat > 1 ? ` run ${r}/${repeat}` : ""} · cpu ${cpu}%${cpu > noiseLimit ? " NOISY" : ""}`;
            log(`ok   ${row.file}${tagLine}${row.consoleErrors ? ` — ${row.consoleErrors} console error(s), see ${row.console}` : ""}`);
            for (const p of row.perf ?? []) log(`       frames ${p}`);
            for (const s of row.frameSets ?? []) log(`       step ${s.step} (${s.kind}, from ${s.anchor}): ${s.count}/${s.asked} real frames → ${s.strip}${s.change?.visible ? ` · ${changeText(s.change)}` : ""}`);
          }
          if (repeat > 1) {
            row.repeat = medianOfRuns(runs);
            log(`       median of ${repeat}${variant.label ? ` [${variant.label}]` : ""} (cpu ${runs.map((x) => x.cpu).join("/")}%):`);
            for (const l of row.repeat.lines) log(`         ${l}`);
          }
          row.ok = true;
          row.at = new Date().toISOString();
          taken++;
        } catch (e) {
          // The last good capture stays, and the report says this one failed (SHOTS.md §6).
          const old = results.get(key);
          const b = `${shot.id}.${lookId(look)}${variant.label ? `.${variant.label}` : ""}`;
          Object.assign(row, { ok: false, error: String(e.message ?? e), file: old?.file, poster: old?.poster, strip: old?.strip, stats: old?.stats, at: old?.at, console: `${b}.console.txt` });
          failed++;
          log(`FAIL ${shot.id} ${lookId(look)}${variant.label ? ` [${variant.label}]` : ""} — ${row.error}`);
        }
        results.set(key, row);
        rows.push(row);
      }
      if (VARIANTS.length > 1) compareRows(rows, outDir);
    }
  }
  page.close();
} finally {
  cleanup();
}

const manifest = { version, taken: new Date().toISOString(), shots: [...results.values()] };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "index.html"), contactSheet(manifest));
log(`${taken} taken, ${failed} failed, ${skipped} skipped → ${outDir}`);
log(`contact sheet: ${join(outDir, "index.html")}`);
process.exit(failed ? 1 : 0);

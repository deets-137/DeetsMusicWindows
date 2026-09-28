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
//
// Headless: Edge opens no window and uses a throwaway profile, so nothing on the desktop moves
// and no real Edge profile or app data is touched. No Apple call and no network: the demo
// refuses every cross-origin request (WEB-DEMO.md §9.4).
//
// Steps 2–3 of SHOTS.md §10: pictures and clips from the demo. A clip is an MP4, a poster and
// a frame strip (one PNG of the motion, for a review by eye). The dev-app source comes later.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
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
const listFile = oneArg("--list") ? resolve(oneArg("--list")) : join(root, "docs", "guide", "shots.json");
const slow = Number(oneArg("--slow") ?? 1);
if (!(slow >= 1)) throw new Error("[shots] --slow takes a number of 1 or more");

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
function seedScript(look, size, extra = {}, badges = false, windowed = false) {
  // The walk over and the look fixed (the store's theme and skin, RULES.md §7a). A shot's own `settings` go on top. The demo itself
  // marks the Rewind unlock done (vite.demo.config.ts), so its notice never covers a shot.
  const settings = { onboardingStep: 0, lookSchedule: "off", theme: look.theme, skin: look.skin, ...extra };
  return `(() => {
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
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.reload", { ignoreCache: false });
    await loaded;
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

async function shoot(page, demoUrl, shot, look, outDir) {
  const size = SIZES[shot.size];
  if (!size) throw new Error(`unknown size "${shot.size}"`);
  win.follow = false; // not during the load: the boot's own set_size would move every shot
  await setWindow(page, size.w, size.h);
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript(look, size, shot.settings, shot.badges === true, shot.window === true) });
  const base = `${shot.id}.${lookId(look)}`;
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
    await page.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    const t0 = Date.now() / 1000;
    await sleep(300); // a still lead-in, so the first action is seen from rest
    for (const step of shot.steps ?? []) {
      // `"strip": true` on a step starts the strip there (default: the first action).
      marks.push({ t: Date.now() / 1000 - t0, step: Object.keys(step)[0], what: JSON.stringify(Object.values(step)[0]), strip: step.strip === true });
      await runStep(page, step);
    }
    const left = t0 + seconds - Date.now() / 1000;
    if (left > 0) await sleep(left * 1000);
    const tEnd = Date.now() / 1000;
    await page.send("Page.stopScreencast");
    await sleep(100); // the last frames in flight
    if (frames.length < 2) throw new Error(`only ${frames.length} frame(s) recorded`);

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
    writeFileSync(join(outDir, `${base}.frames.json`), JSON.stringify({ ...stats, times: times.map((t) => Math.round(t * 1000)) }));
    const { gaps: _all, marks: _m, ...brief } = stats;
    return { file: mp4, poster, strip, stats: { ...brief, drops: stats.gaps.length } };
  } finally {
    off();
    rmSync(work, { recursive: true, force: true });
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
          const perf = (r.perf ?? []).map((p) => `<br><code>${esc(p)}</code>`).join("");
          const errs = r.consoleErrors ? ` · <b class="err">${r.consoleErrors} error(s)</b>` : "";
          return `<figure><video src="${esc(r.file)}" poster="${esc(r.poster ?? "")}" muted autoplay loop playsinline controls></video><figcaption>${esc(r.look)} · <a href="${esc(r.strip ?? "")}">strip</a> · <a href="${esc(r.console ?? "")}">console</a>${errs}${note}${perf}</figcaption></figure>`;
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

// ── the run ──────────────────────────────────────────────────────────────────

// shots.json → shots/<version>/; another list → shots/<list name>/<version>/ (motion.json →
// shots/motion/0.25.1/); --slow n adds `-slow<n>`. So a debug run never lands among the shots of
// a version. --out names any other place.
const listName = listFile === join(root, "docs", "guide", "shots.json") ? "" : basename(listFile, ".json");
const outDir = oneArg("--out") ? resolve(oneArg("--out")) : join(root, "shots", listName, `${version}${slow !== 1 ? `-slow${slow}` : ""}`);
mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, "manifest.json");
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { shots: [] };
const results = new Map(previous.shots.map((r) => [`${r.id}|${r.look}`, r]));

const shots = list.shots.filter((s) => !only.size || only.has(s.id));
if (only.size && !shots.length) throw new Error(`[shots] no shot named ${[...only].join(", ")}`);

let taken = 0;
let failed = 0;
let skipped = 0;
try {
  log(`DeetsMusic ${version} — ${shots.length} shot(s); ${THEMES.length} themes × ${SKINS.length} skins`);
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
      const key = `${shot.id}|${lookId(look)}`;
      const row = { id: shot.id, kind: shot.kind, look: lookId(look), covers: shot.covers, size: shot.size, source: shot.source, about: shot.about };
      try {
        Object.assign(row, await shoot(page, demoUrl, shot, look, outDir));
        row.ok = true;
        row.at = new Date().toISOString();
        taken++;
        log(`ok   ${row.file}${row.consoleErrors ? ` — ${row.consoleErrors} console error(s), see ${row.console}` : ""}`);
        for (const p of row.perf ?? []) log(`       frames ${p}`);
      } catch (e) {
        // The last good capture stays, and the report says this one failed (SHOTS.md §6).
        const old = results.get(key);
        Object.assign(row, { ok: false, error: String(e.message ?? e), file: old?.file, poster: old?.poster, strip: old?.strip, stats: old?.stats, at: old?.at, console: `${key.replace("|", ".")}.console.txt` });
        failed++;
        log(`FAIL ${shot.id} ${lookId(look)} — ${row.error}`);
      }
      results.set(key, row);
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

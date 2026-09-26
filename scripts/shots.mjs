// `node scripts/shots.mjs` — take the pictures of each feature from the web demo
// (docs/guide/SHOTS.md). It reads docs/guide/shots.json, starts the demo and a headless Edge
// on free ports, and saves each shot in each look to shots/<version>/, with a manifest and a
// contact sheet (index.html) to review the run.
//
//   node scripts/shots.mjs                          every shot, every look (F1)
//   node scripts/shots.mjs --only compass-open      one shot (repeat --only, or a comma list)
//   node scripts/shots.mjs --look lilac-press       one look, `theme-skin` (a comma list works)
//
// Headless: Edge opens no window and uses a throwaway profile, so nothing on the desktop moves
// and no real Edge profile or app data is touched. No Apple call and no network: the demo
// refuses every cross-origin request (WEB-DEMO.md §9.4).
//
// Step 2 of SHOTS.md §10: pictures from the demo. Clips (`kind: "clip"`) and the dev-app
// source come later; the runner reports them as skipped.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// ── what to shoot ────────────────────────────────────────────────────────────

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const list = JSON.parse(readFileSync(join(root, "docs", "guide", "shots.json"), "utf8"));

/** The looks, read from the source so a new theme or skin joins the run by itself. */
function unionOf(file, type) {
  const src = readFileSync(join(root, "src", file), "utf8");
  const m = new RegExp(`export type ${type} = ([^;]+);`).exec(src);
  if (!m) throw new Error(`[shots] no \`${type}\` in src/${file}`);
  return [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
}
const THEMES = unionOf("theme.ts", "ThemeName");
const SKINS = unionOf("skin.ts", "SkinName");
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
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
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
    close: () => ws.close(),
  };
}

// ── one shot ─────────────────────────────────────────────────────────────────

/**
 * The page's first script, on every load: a clean store in the shot's look and size, with
 * the first-run walk over — what the demo's Start over does, then the choices the shot needs.
 * Clearing on EVERY load is the point: each shot starts from the same state (SHOTS.md §4).
 */
function seedScript(look, size, extra = {}, badges = false) {
  // The walk over and the look fixed. A shot's own `settings` go on top. The demo itself
  // marks the Rewind unlock done (vite.demo.config.ts), so its notice never covers a shot.
  const settings = { onboardingStep: 0, lookSchedule: "off", ...extra };
  return `(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("deets.") || k.startsWith("deets-")) localStorage.removeItem(k);
      localStorage.setItem("deets.theme", ${JSON.stringify(look.theme)});
      localStorage.setItem("deets.skin", ${JSON.stringify(look.skin)});
      localStorage.setItem("deets.surface", ${JSON.stringify(size.surface)});
      ${size.miniView ? `localStorage.setItem("deets.surface.mini", ${JSON.stringify(size.miniView)});` : ""}
      localStorage.setItem("deets.settings", ${JSON.stringify(JSON.stringify(settings))});
    } catch (e) {}
    ${badges ? "" : NO_BADGES}
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
  throw new Error(`unknown step ${JSON.stringify(step)}`);
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
  await page.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: false });
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript(look, size, shot.settings, shot.badges === true) });
  try {
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: demoUrl });
    await loaded;
    await settle(page);
    for (const step of shot.steps ?? []) await runStep(page, step);
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = `${shot.id}.${lookId(look)}.png`;
    writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
    return file;
  } finally {
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
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
      .map((r) =>
        r.file
          ? `<figure><a href="${esc(r.file)}"><img src="${esc(r.file)}" loading="lazy" alt="${esc(id)} in ${esc(r.look)}"></a><figcaption>${esc(r.look)}${r.ok ? "" : " — kept from an earlier run"}</figcaption></figure>`
          : `<figure class="bad"><figcaption>${esc(r.look)} — ${esc(r.error ?? "not taken")}</figcaption></figure>`,
      )
      .join("");
    return `<section><h2>${esc(id)} <small>${esc(rows[0].covers ?? "")}</small></h2><div class="grid">${tiles}</div></section>`;
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
figure { margin: 0; } img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; } .bad figcaption { color: var(--bad); }
</style></head><body>
<h1>Shots — DeetsMusic ${esc(manifest.version)}</h1>
<p>${esc(manifest.taken)} · ${manifest.shots.length} shots · ${failed ? `${failed} failed` : "none failed"}</p>
${sections.join("\n")}
</body></html>`;
}

// ── the run ──────────────────────────────────────────────────────────────────

const outDir = join(root, "shots", version);
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
  // Motion on: a picture is taken after it settles, and a clip needs it (SHOTS.md §5).
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

  for (const shot of shots) {
    if (shot.kind !== "picture" || shot.source !== "demo") {
      log(`skip ${shot.id}: ${shot.kind} from ${shot.source} is not built yet`);
      skipped++;
      continue;
    }
    const looks = (shot.looks ?? ALL_LOOKS).filter((l) => !lookFilter.size || lookFilter.has(lookId(l)));
    for (const look of looks) {
      const key = `${shot.id}|${lookId(look)}`;
      const row = { id: shot.id, look: lookId(look), covers: shot.covers, size: shot.size, source: shot.source };
      try {
        row.file = await shoot(page, demoUrl, shot, look, outDir);
        row.ok = true;
        row.at = new Date().toISOString();
        taken++;
        log(`ok   ${row.file}`);
      } catch (e) {
        // The last good capture stays, and the report says this one failed (SHOTS.md §6).
        const old = results.get(key);
        Object.assign(row, { ok: false, error: String(e.message ?? e), file: old?.file, at: old?.at });
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
log(`${taken} taken, ${failed} failed, ${skipped} skipped → ${join("shots", version)}`);
log(`contact sheet: ${join(outDir, "index.html")}`);
process.exit(failed ? 1 : 0);

// The readability step of the shots runner (docs/ops/checks/README.md › readability): how well
// each piece of text on screen reads against the pixels that are really behind it.
//
// A token check can only compare two token colors. Glass puts a see-through card over the
// aurora and the album covers, so the color behind its text is a picture, not a token. This
// step measures the picture:
//   1. The page lists every visible text box: its color, opacity, size, card and role.
//   2. A screenshot with every text color made transparent gives the backdrop alone.
//   3. For each text box, the text color is laid over each backdrop pixel under it, and the
//      contrast is taken per pixel. The 10th percentile is the box's score ("worst place").
//   4. A third screenshot outlines each box that fails, for the review by eye.
//
// The bar (his call, 2026-10-14, fork 1A): WCAG 2 AA for ALL readable text, subtext too:
// 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold). APCA Lc is printed beside it for
// information only. A disabled control is listed but never fails (WCAG exempts it).

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BAR = { body: 4.5, large: 3 };

// ── the color math ───────────────────────────────────────────────────────────

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** WCAG 2 relative luminance of an [r, g, b] in 0–255. */
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const wcag = (a, b) => {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** APCA Lc (SAPC 0.0.98G-4g), text on background; the sign says dark-on-light (+) or light-on-dark (−). */
export function apca(txt, bg) {
  const y = ([r, g, b]) => {
    let v = 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
    if (v < 0.022) v += (0.022 - v) ** 1.414;
    return v;
  };
  const yt = y(txt);
  const yb = y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** The text color (with its alpha) laid over one backdrop pixel. */
const over = (fg, a, bg) => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));

// ── the page side ────────────────────────────────────────────────────────────

/** Runs in the page: every visible text box, with what the report needs to name it. */
const COLLECT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const roles = {};
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  for (const r of ["--title", "--text", "--subtext", "--go", "--stop", "--pause", "--np-title", "--np-subtext", "--np-accent", "--canvas"]) {
    probe.style.color = "var(" + r + ")";
    const c = getComputedStyle(probe).color;
    if (!(c in roles)) roles[c] = r;
  }
  probe.remove();
  const parse = (c) => {
    const m = c.match(/[\\d.]+/g) || [];
    if (c.startsWith("color(srgb")) return [m[0] * 255, m[1] * 255, m[2] * 255, m[3] === undefined ? 1 : +m[3]];
    return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const clipOf = (el) => {
    let r = { l: 0, t: 0, r: vw, b: vh };
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const b = e.getBoundingClientRect();
        r = { l: Math.max(r.l, b.left), t: Math.max(r.t, b.top), r: Math.min(r.r, b.right), b: Math.min(r.b, b.bottom) };
      }
    }
    return r;
  };
  const sig = (el) => {
    const one = (e) => e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => "." + c).join("");
    return el.parentElement && el.parentElement !== document.body ? one(el.parentElement) + " > " + one(el) : one(el);
  };
  const where = (el) => {
    const host = el.closest("[data-mounted]");
    if (host) return host.getAttribute("data-mounted");
    const slot = el.closest("[data-slot]");
    if (slot) return slot.getAttribute("data-slot");
    let top = el;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    return top === el ? sig(el) : (top.id ? "#" + top.id : [...top.classList][0] || top.tagName.toLowerCase());
  };
  const visible = (el, x, y) => {
    // The hit stack, top first (pointer-events: none layers are not in it). The text is seen when
    // its element (or a relative) is in the stack and nothing solid lies over it.
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === el || el.contains(hit) || hit.contains(el)) return true;
      const cs = getComputedStyle(hit);
      const bg = parse(cs.backgroundColor);
      if ((bg[3] > 0.5 || cs.backgroundImage !== "none") && parseFloat(cs.opacity) > 0.5) return false;
    }
    return false;
  };
  const items = [];
  const skip = { hidden: 0, clipped: 0, covered: 0, clear: 0, clipBy: [] };
  const add = (el, rect, text, kind, color) => {
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible") { skip.hidden++; return; }
    const clip = clipOf(el);
    const l = Math.max(rect.left, clip.l), t = Math.max(rect.top, clip.t);
    const r = Math.min(rect.right, clip.r), b = Math.min(rect.bottom, clip.b);
    if (r - l < 3 || b - t < 4) { skip.clipped++; if (skip.clipBy.length < 6) skip.clipBy.push(sig(el) + " in " + JSON.stringify(clip)); return; }
    if (!visible(el, (l + r) / 2, (t + b) / 2)) { skip.covered++; return; }
    const c = parse(color);
    const alpha = c[3] * opacityOf(el);
    if (alpha < 0.05) { skip.clear++; return; }
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    items.push({
      text: text.replace(/\\s+/g, " ").trim().slice(0, 48), kind,
      x: l, y: t, w: r - l, h: b - t,
      rgb: c.slice(0, 3), alpha: Math.round(alpha * 1000) / 1000,
      role: roles[color] || (c[3] < 1 ? (roles["rgb(" + c.slice(0, 3).map(Math.round).join(", ") + ")"] || "") + "@" + Math.round(c[3] * 100) + "%" : ""),
      size, weight, large: size >= 24 || (size >= 18.66 && weight >= 700),
      where: where(el), sig: sig(el),
      disabled: !!el.closest("[disabled], [aria-disabled='true'], .is-disabled"),
    });
  };
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() && n.parentElement && !n.parentElement.closest("script, style, noscript, template") ? 1 : 2),
  });
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    range.selectNodeContents(n);
    for (const rect of range.getClientRects()) add(el, rect, n.nodeValue, "text", getComputedStyle(el).color);
  }
  for (const el of document.querySelectorAll("input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea")) {
    const rect = el.getBoundingClientRect();
    if (el.value) add(el, rect, el.value, "field", getComputedStyle(el).color);
    else if (el.placeholder) add(el, rect, el.placeholder, "placeholder", getComputedStyle(el, "::placeholder").color);
  }
  return { vw, vh, items, skip };
})()`;

/** Holds the page still for the two pictures: every animation paused where it is. */
const FREEZE = `(() => { window.__readAnims = document.getAnimations(); for (const a of window.__readAnims) a.pause(); })()`;
const THAW = `(() => { for (const a of window.__readAnims || []) try { a.play(); } catch {} window.__readAnims = null; })()`;
/** The backdrop alone: every text color transparent, with no fade to watch. */
const HIDE_TEXT = `(() => {
  const s = document.createElement("style");
  s.id = "__read-hide";
  s.textContent = "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; transition: none !important; } ::placeholder { color: transparent !important; }";
  document.head.appendChild(s);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;
const SHOW_TEXT = `(() => { document.getElementById("__read-hide")?.remove(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`;
const outline = (boxes) => `(() => {
  const host = document.createElement("div");
  host.id = "__read-marks";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  for (const b of ${JSON.stringify(boxes)}) {
    const d = document.createElement("div");
    d.style.cssText = "position:absolute;left:" + (b.x - 2) + "px;top:" + (b.y - 2) + "px;width:" + (b.w + 4) + "px;height:" + (b.h + 4) + "px;outline:2px solid " + b.c + ";outline-offset:0;border-radius:3px";
    host.appendChild(d);
  }
  document.body.appendChild(host);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;
const UNOUTLINE = `document.getElementById("__read-marks")?.remove()`;

// ── the step ─────────────────────────────────────────────────────────────────

/** A PNG as raw RGB pixels, through ffmpeg (the runner needs it already). */
function pixelsOf(png) {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const data = execFileSync("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: w * h * 3 + 1024 });
  return { w, h, data };
}

/** One item's score: its contrast at the worst tenth of the pixels behind it. */
function score(item, px, scale) {
  const x0 = Math.max(0, Math.floor(item.x * scale));
  const y0 = Math.max(0, Math.floor(item.y * scale));
  const x1 = Math.min(px.w, Math.ceil((item.x + item.w) * scale));
  const y1 = Math.min(px.h, Math.ceil((item.y + item.h) * scale));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 1500)));
  const ratios = [];
  const lcs = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * px.w + x) * 3;
      const bg = [px.data[i], px.data[i + 1], px.data[i + 2]];
      const fg = over(item.rgb, item.alpha, bg);
      ratios.push(wcag(fg, bg));
      lcs.push(Math.abs(apca(fg, bg)));
    }
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  lcs.sort((a, b) => a - b);
  const at = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return { ratio: at(ratios, 0.1), median: at(ratios, 0.5), min: ratios[0], lc: at(lcs, 0.1) };
}

/**
 * `{ "read": "<label>" }` — measure what is on screen now. With `"scroll": selector`, it reads,
 * scrolls that list down by most of its height, and reads again to the end (`<label>-1`, `-2`…).
 * Each reading adds one line to `<outDir>/readability.jsonl` and saves `<base>.<label>.read.png`
 * (the failures outlined) when anything fails.
 */
export async function readStep(page, evaluate, step, ctx) {
  const pages = [];
  if (step.scroll) {
    await evaluate(page, `(() => { const s = document.querySelector(${JSON.stringify(step.scroll)}); if (s) s.scrollTop = 0; })()`);
    for (let n = 1; n <= (step.pages ?? 30); n++) {
      await new Promise((r) => setTimeout(r, step.settle ?? 350));
      pages.push(`${step.read}-${n}`);
      await readOnce(page, evaluate, `${step.read}-${n}`, ctx);
      const moved = await evaluate(page, `(() => {
        const s = document.querySelector(${JSON.stringify(step.scroll)});
        if (!s) return false;
        const before = s.scrollTop;
        s.scrollTop = before + s.clientHeight * 0.85;
        return s.scrollTop > before;
      })()`);
      if (!moved) break;
    }
  } else await readOnce(page, evaluate, step.read, ctx);
  return pages;
}

async function readOnce(page, evaluate, label, ctx) {
  await evaluate(page, FREEZE);
  try {
    const { vw, items, skip } = await evaluate(page, COLLECT);
    // No text at all is a page that did not boot (two runs on one Vite cache did this,
    // 2026-10-14): fail the shot, never report it as clean.
    if (!items.length) throw new Error(`read ${label}: no text on the page — did the app boot? (see the console file)`);
    // The clean picture of this reading, for the review sheet (<base>.<label>.clean.png).
    const clean = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(ctx.outDir, `${ctx.base}.${label}.clean.png`), Buffer.from(clean.data, "base64"));
    await evaluate(page, HIDE_TEXT);
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await evaluate(page, SHOW_TEXT);
    const png = Buffer.from(data, "base64");
    const px = pixelsOf(png);
    const scale = px.w / vw;
    const rows = [];
    for (const it of items) {
      const s = score(it, px, scale);
      if (!s) continue;
      const bar = it.large ? BAR.large : BAR.body;
      rows.push({ ...it, ...s, bar, pass: it.disabled || s.ratio >= bar });
    }
    const fails = rows.filter((r) => !r.pass);
    let picture;
    if (fails.length) {
      await evaluate(page, outline(fails.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, c: f.ratio < 3 ? "#ff1f3d" : "#ffb000" }))));
      const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await evaluate(page, UNOUTLINE);
      picture = `${ctx.base}.${label}.read.png`;
      writeFileSync(join(ctx.outDir, picture), Buffer.from(shot.data, "base64"));
    }
    const line = { base: ctx.base, look: ctx.look, variant: ctx.variant, change: ctx.change, label, picture, count: rows.length, fails: fails.length, rows };
    appendFileSync(join(ctx.outDir, "readability.jsonl"), JSON.stringify(line) + "\n");
    ctx.note("read", `${label}: ${rows.length} text boxes, ${fails.length} under the bar (skipped ${JSON.stringify(skip)})${picture ? ` → ${picture}` : ""}`);
  } finally {
    await evaluate(page, THAW);
  }
}

/** The report's reader: every reading of a run, newest line wins per base + label. */
export function readingsOf(outDir) {
  const seen = new Map();
  for (const l of readFileSync(join(outDir, "readability.jsonl"), "utf8").split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    seen.set(`${r.base}|${r.label}`, r);
  }
  return [...seen.values()];
}

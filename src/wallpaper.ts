// Cover Wallpaper (docs/features/COVER-WALLPAPER.md) — under Glass, the canvas behind the
// cards shows a picture: the playing album's cover large with the queue's next albums as tiles
// around it (Covers), or one picture the user chose (Picture). Settings › Skin settings › Canvas.
//
// Two copies of the same picture:
//   - SHARP: the `.wallpaper` layer under the aurora. One element per tile, so one tile can fade
//     alone (§3.5, tiles stay in place). The tiles load Apple's cover links directly.
//   - SOFT: one baked JPEG (wallpaper-worker.ts: small, blurred, saturated) that the painted
//     frost lays under each card (--wallpaper-soft in skin.css). Nothing redraws when a list
//     scrolls. Fancy Glass blurs the sharp layer live, so it needs no soft copy.
// Neither copy made from Apple's artwork is saved: object URLs in memory only.
//
// The aurora over it takes the album's colors (--canvas-go / -stop / -pause on <html>, the
// same `auroraSlots` rule as the NP card), or the picture's own colors, read locally.
//
// When it redraws: when the playing ALBUM changes (a new song on the same album, or a queue
// edit, does not), when the tile count or the window size changes, and on a new picture. A
// hidden window draws nothing and catches up once on show. Nothing playing (Covers): the
// wallpaper fades out and the plain aurora comes back.

import { invoke } from "@tauri-apps/api/core";
import { onSkinChange, currentSkin } from "./skin";
import { onPlayerState } from "./player";
import { getUpcoming, getHistory, getPlan, type TrackHandle } from "./queue";
import { trackById } from "./track-store";
import { currentCover, lookupPalette } from "./album-color";
import { auroraSlots, paletteFromPixels, type AlbumPalette } from "./album-slots";
import { setting, setSetting, onSettingsChange } from "./settings-store";
import { tokenMs } from "./boot-cover";
import { toast } from "./toast";
import * as diag from "./diag";
import * as frames from "./frames";
import type { WallJob, WallTile } from "./wallpaper-worker";

/** Tiles around the anchor, per the Tiles row (row 5). 0 = the cover alone (1A). */
const TILE_COUNT = { one: 0, few: 6, some: 12, many: 20 } as const;
/** Cover fetch sizes: a few fixed steps, so tiles that share a cover share a cached image. */
const FETCH_PX = [120, 240, 480, 720, 1000, 1400];
/** The soft copy is drawn at a quarter of the canvas size: it is blurred, CSS stretches it. */
const SOFT_SCALE = 0.25;
/** A user picture is kept at most this long on its long side (§8). */
const PICTURE_MAX = 2560;
/** The picture's colors are read from a copy this small. */
const COLOR_PX = 48;
/** A tile's image that has not loaded by then fades in anyway (the ground shows until it does). */
const PRELOAD_MS = 3000;
const RESIZE_MS = 300;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Slot extends Rect {
  anchor: boolean;
  el: HTMLElement;
  /** The picture it shows now (a cover template, or the picture link); null = empty. */
  key: string | null;
}

const root = document.documentElement;
let layer: HTMLElement | null = null;
let set: HTMLElement | null = null; // the live `.wallpaper__set`
let slots: Slot[] = [];
let geom = ""; // the slots' seed: size + tile count + mode
let shown: "covers" | "picture" | null = null;
let anchorKey: string | null = null;
let dirty = false; // a change came while the window was hidden
let seq = 0; // only the newest update may write
let pending = ""; // the draw in flight (its slots + anchor), so a player tick does not restart it
let softUrl: string | null = null;
let softSeq = 0;
let worker: Worker | null = null;
let pictureColors: AlbumPalette | null | undefined; // undefined = not read yet
let resizeTimer = 0;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hidden = () => root.dataset.ambient === "paused";
const mode = (): "aurora" | "covers" | "picture" => (currentSkin() === "glass" ? setting("glassCanvas") : "aurora");
const ms = (token: string) => (reduced() ? 0 : tokenMs(token));
const num = (token: string, fallback: number) => parseFloat(getComputedStyle(root).getPropertyValue(token)) || fallback;
const pictureLink = () => `http://wallpaper.localhost/${setting("glassPicture")}`;

// ── the layout (§3.2) ───────────────────────────────────────────────────────────

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** mulberry32, as the mosaic worker: one seed always gives the same slots. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The anchor and `n` tiles over a `w × h` canvas. A grid of square cells is laid over the
 * canvas (overhanging its edges a little, centered); the anchor takes a k × k block at the
 * upper center, sized by the short side (--wallpaper-anchor-share); the other cells join into
 * 1×1, 2×1, 1×2 and 2×2 tiles until there are about `n`. The tiles come back nearest to the
 * anchor first, so the queue's next album sits next to the one that plays. n = 0: the anchor
 * alone, filling the canvas (1A).
 */
function layout(w: number, h: number, n: number): { anchor: Rect; tiles: Rect[] } {
  // The picture runs past the window on every side, so the Diffusion blur never pulls the
  // window's edge toward black.
  const bleed = num("--wallpaper-bleed", 48);
  if (n === 0) return { anchor: { x: -bleed, y: -bleed, w: w + 2 * bleed, h: h + 2 * bleed }, tiles: [] };
  const rnd = random(hash(`${w}x${h}:${n}`));
  const share = num("--wallpaper-anchor-share", 0.6);
  const rise = num("--wallpaper-anchor-rise", 0.3);
  const A = Math.min(w, h) * share;
  let k = 2;
  let s = A / k;
  let C = Math.ceil((w + 2 * bleed) / s);
  let R = Math.ceil((h + 2 * bleed) / s);
  while (C * R - k * k < n && k < 8) {
    k++;
    s = A / k;
    C = Math.ceil((w + 2 * bleed) / s);
    R = Math.ceil((h + 2 * bleed) / s);
  }
  const ox = (w - C * s) / 2;
  const oy = (h - R * s) / 2;
  const ac = Math.floor((C - k) / 2);
  const ar = Math.max(0, Math.round((R - k) * rise));
  const used: boolean[][] = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => r >= ar && r < ar + k && c >= ac && c < ac + k));
  const fits = (c: number, r: number, cw: number, ch: number) => {
    if (c + cw > C || r + ch > R) return false;
    for (let y = r; y < r + ch; y++) for (let x = c; x < c + cw; x++) if (used[y][x]) return false;
    return true;
  };
  const rect = (c: number, r: number, cw: number, ch: number): Rect => ({
    x: Math.round(ox + c * s),
    y: Math.round(oy + r * s),
    w: Math.round(ox + (c + cw) * s) - Math.round(ox + c * s),
    h: Math.round(oy + (r + ch) * s) - Math.round(oy + r * s),
  });
  let free = C * R - k * k;
  let left = n;
  const tiles: Rect[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (used[r][c]) continue;
      // Cells each remaining tile should take, with a little chance in it.
      const want = left > 0 ? (free / left) * (0.7 + 0.6 * rnd()) : 4;
      const wide = rnd() < 0.5;
      const order: [number, number][] =
        want >= 3 ? [[2, 2], wide ? [2, 1] : [1, 2], wide ? [1, 2] : [2, 1], [1, 1]]
        : want >= 1.6 ? [wide ? [2, 1] : [1, 2], wide ? [1, 2] : [2, 1], [1, 1]]
        : [[1, 1]];
      // Never take so many cells that a later tile has none.
      const [cw, ch] = order.find(([a, b]) => fits(c, r, a, b) && free - a * b >= Math.max(0, left - 1)) ?? [1, 1];
      for (let y = r; y < r + ch; y++) for (let x = c; x < c + cw; x++) used[y][x] = true;
      tiles.push(rect(c, r, cw, ch));
      free -= cw * ch;
      left--;
    }
  }
  const anchor = rect(ac, ar, k, k);
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const dist = (t: Rect) => Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy);
  tiles.sort((a, b) => dist(a) - dist(b));
  return { anchor, tiles };
}

// ── the picture set (§3.1) ──────────────────────────────────────────────────────

const coverOf = (h: TrackHandle): string | undefined => trackById(h.catalogId ?? h.libraryId)?.artwork?.urlTemplate;

/** The next distinct albums in the queue, then history newest first; repeated when short. */
function tileKeys(anchor: string, n: number): string[] {
  const seen = new Set([anchor]);
  const out: string[] = [];
  for (const h of [...getUpcoming(), ...getPlan(), ...[...getHistory()].reverse()]) {
    if (out.length >= n) break;
    const k = coverOf(h);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  const pool = out.length ? [...out] : [anchor];
  while (out.length < n) out.push(pool[out.length % pool.length]);
  return out;
}

/** The link a slot loads: a cover at the fetch step its size needs, or the picture as is. */
function linkFor(key: string, r: Rect): string {
  if (!key.includes("{w}")) return key;
  const want = Math.max(r.w, r.h) * (window.devicePixelRatio || 1);
  const px = String(FETCH_PX.find((p) => p >= want) ?? FETCH_PX[FETCH_PX.length - 1]);
  return key.replace("{w}", px).replace("{h}", px).replace("{f}", "jpg");
}

function preload(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  return Promise.race([img.decode().catch(() => {}), new Promise<void>((r) => setTimeout(r, PRELOAD_MS))]);
}

// ── the sharp layer ─────────────────────────────────────────────────────────────

function imgEl(url: string): HTMLElement {
  const i = document.createElement("i");
  i.className = "wallpaper__img";
  i.style.backgroundImage = `url("${url}")`;
  return i;
}

/** One slot's picture changes: the new one fades (and grows a little) in over the old one. */
function swapSlot(slot: Slot, key: string, from?: Rect): void {
  slot.key = key;
  const next = imgEl(linkFor(key, slot));
  const old = [...slot.el.children] as HTMLElement[];
  slot.el.appendChild(next);
  const dur = ms("--wallpaper-tile-dur");
  if (!dur) {
    old.forEach((o) => o.remove());
    return;
  }
  const ease = getComputedStyle(root).getPropertyValue("--wallpaper-tile-ease").trim() || "ease";
  const scale = num("--wallpaper-tile-scale", 1.04);
  // A cover that MOVES (the swap: the new anchor grows out of its tile, the old one shrinks into
  // it) flies from its old box (a FLIP), fully visible, over the other tiles. Any other change
  // fades in with a small scale.
  const start = from
    ? `translate(${from.x - slot.x}px, ${from.y - slot.y}px) scale(${from.w / slot.w}, ${from.h / slot.h})`
    : `scale(${scale})`;
  const origin = from ? "0 0" : "50% 50%";
  if (from) slot.el.style.zIndex = "1";
  next
    .animate([{ opacity: from ? 1 : 0, transform: start, transformOrigin: origin }, { opacity: 1, transform: "none", transformOrigin: origin }], { duration: dur, easing: ease })
    .finished.then(() => (slot.el.style.zIndex = ""), () => (slot.el.style.zIndex = ""));
  old.forEach((o) => o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: ease, fill: "forwards" }).finished.then(() => o.remove(), () => o.remove()));
}

/** A new set of slots (a new size, tile count or mode): the whole layer crossfades. */
function buildSlots(w: number, h: number, n: number): void {
  const { anchor, tiles } = layout(w, h, n);
  const el = document.createElement("div");
  el.className = "wallpaper__set";
  const mk = (r: Rect, isAnchor: boolean): Slot => {
    const box = document.createElement("div");
    box.className = isAnchor ? "wallpaper__tile wallpaper__tile--anchor" : "wallpaper__tile";
    box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    el.appendChild(box);
    return { ...r, anchor: isAnchor, el: box, key: null };
  };
  // The anchor last in the markup, so it paints over its neighbours' edges during a grow.
  slots = [...tiles.map((t) => mk(t, false)), mk(anchor, true)];
  const old = set;
  set = el;
  layer!.appendChild(el);
  const dur = ms("--wallpaper-fade-dur");
  if (old) {
    if (dur) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: "ease" });
      old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "ease", fill: "forwards" }).finished.then(() => old.remove(), () => old.remove());
    } else old.remove();
  }
}

// ── the soft copy (the painted frost's picture) ─────────────────────────────────

/** A change of the frost or the aurora colors crossfades on the cards: a window in which the
 *  cards and the blobs transition their background-image (styles.css `[data-wall-fade]`). */
let fadeTimer = 0;
function inFade(change: () => void): void {
  const dur = ms("--wallpaper-fade-dur");
  if (!dur) return change();
  root.dataset.wallFade = "";
  frames.during("wallpaper", dur, "frost");
  requestAnimationFrame(() => {
    change();
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => delete root.dataset.wallFade, dur + 50);
  });
}

function setSoft(url: string | null): void {
  const old = softUrl;
  softUrl = url;
  inFade(() => {
    if (url) root.style.setProperty("--wallpaper-soft", `url("${url}")`);
    else root.style.removeProperty("--wallpaper-soft");
  });
  if (old) window.setTimeout(() => URL.revokeObjectURL(old), ms("--wallpaper-fade-dur") + 200);
}

function placeSoft(): void {
  const box = document.querySelector<HTMLElement>(".app-body")?.getBoundingClientRect();
  if (box) root.style.setProperty("--wallpaper-at", `${box.left}px ${box.top}px / ${box.width}px ${box.height}px`);
}

async function bakeSoft(w: number, h: number): Promise<void> {
  if (setting("glassFancy")) {
    if (softUrl) setSoft(null); // the live frost blurs the sharp layer itself
    return;
  }
  const mine = ++softSeq;
  const tiles: WallTile[] = [];
  for (const s of slots) {
    if (!s.key) continue;
    let src: string | Blob = linkFor(s.key, s);
    // The picture's link is ours (a Tauri scheme): the page fetches it, the worker gets the bytes.
    if (!s.key.includes("{w}")) {
      try {
        src = await (await fetch(src)).blob();
      } catch {
        continue;
      }
    }
    tiles.push({ src, x: s.x, y: s.y, w: s.w, h: s.h });
  }
  if (!tiles.length) return;
  const cs = getComputedStyle(root);
  const job: Omit<WallJob, "id"> = {
    w,
    h,
    scale: SOFT_SCALE,
    blur: parseFloat(cs.getPropertyValue("--wallpaper-blur")) || 24,
    sat: parseFloat(cs.getPropertyValue("--glass-frost-sat")) || 1,
    bg: cs.getPropertyValue("--canvas").trim() || "#000",
    tiles,
  };
  const started = performance.now();
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      worker ??= new Worker(new URL("./wallpaper-worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      console.warn("[wallpaper] worker", e);
      return resolve(null);
    }
    const id = mine;
    worker.onmessage = (e: MessageEvent<{ id: number; blob: Blob | null }>) => {
      if (e.data.id === id) resolve(e.data.blob);
    };
    worker.onerror = () => resolve(null);
    worker.postMessage({ id, ...job });
  });
  if (mine !== softSeq || !shown) return;
  if (!blob) {
    diag.log("wallpaper:soft-failed", { tiles: tiles.length });
    return;
  }
  placeSoft();
  setSoft(URL.createObjectURL(blob));
  diag.log("wallpaper:soft", { tiles: tiles.length, ms: Math.round(performance.now() - started), kb: Math.round(blob.size / 1024) });
}

// ── the aurora's colors (§3.4, U4) ──────────────────────────────────────────────

const STOPS = ["--canvas-go", "--canvas-stop", "--canvas-pause"] as const;
function applyColors(p: AlbumPalette | null): void {
  const use = p && setting("glassAuroraColor") === "cover" ? auroraSlots(p) : null;
  inFade(() => {
    if (!use || !use[1]) return STOPS.forEach((s) => root.style.removeProperty(s));
    // go (the brightest blob) = the rim, the most colorful; stop = the halo; pause = the rest.
    const [under, rim, halo] = use;
    root.style.setProperty("--canvas-go", rim!);
    root.style.setProperty("--canvas-stop", halo ?? rim!);
    root.style.setProperty("--canvas-pause", under ?? rim!);
  });
}

async function colorsFor(which: "covers" | "picture", key: string): Promise<AlbumPalette | null> {
  if (which === "picture") {
    if (pictureColors === undefined) pictureColors = await invoke<AlbumPalette | null>("wallpaper_colors").catch(() => null);
    return pictureColors ?? null;
  }
  return lookupPalette(key, currentCover().catalogId).catch(() => null);
}

// ── enter, update, leave ────────────────────────────────────────────────────────

function leave(fade: boolean): void {
  ++seq;
  ++softSeq;
  pending = "";
  if (!shown && !root.hasAttribute("data-wallpaper")) return;
  shown = null;
  anchorKey = null;
  geom = "";
  const dur = fade ? ms("--wallpaper-fade-dur") : 0;
  const done = () => {
    if (shown) return; // it came back during the fade
    delete root.dataset.wallpaper;
    set?.remove();
    set = null;
    slots = [];
    if (layer) layer.style.opacity = "";
  };
  applyColors(null);
  setSoft(null);
  if (dur && layer) {
    frames.during("wallpaper", dur, "leave");
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "ease", fill: "forwards" }).finished.then(done, done);
    diag.log("wallpaper:off", {});
  } else done();
}

async function update(reason: string): Promise<void> {
  if (!layer) return;
  const m = mode();
  if (m === "aurora") return leave(currentSkin() === "glass");
  if (hidden()) {
    dirty = true;
    return;
  }
  dirty = false;
  const key = m === "picture" ? (setting("glassPicture") ? pictureLink() : null) : currentCover().cover;
  if (!key) return leave(true); // Covers with nothing playing (row 8); Picture with none chosen
  const body = layer.parentElement!;
  const w = body.clientWidth;
  const h = body.clientHeight;
  if (!w || !h) return;
  const n = m === "picture" ? 0 : TILE_COUNT[setting("glassTiles")];
  const g = `${m}:${w}x${h}:${n}`;
  if (g === geom && key === anchorKey && shown === m) return;
  if (pending === `${g}|${key}`) return;
  pending = `${g}|${key}`;
  const mine = ++seq;
  const started = performance.now();

  // What each slot should show.
  const newGeom = g !== geom;
  const urls: string[] = [];
  const plan: { slot: Slot; key: string; from?: Rect }[] = [];
  try {
  if (newGeom) {
    buildSlots(w, h, n);
    geom = g;
    // The grid can hold a few more tiles than asked (layout() fills every free cell), so the
    // albums are counted from the slots it made, not from `n`.
    const keys = m === "picture" ? [] : tileKeys(key, slots.length - 1);
    slots.forEach((s, i) => plan.push({ slot: s, key: s.anchor ? key : keys[i] ?? key }));
  } else {
    const keys = m === "picture" ? [] : tileKeys(key, slots.length - 1);
    // Tiles stay in place (T-A): an album still in the set keeps its slot.
    const anchorSlot = slots.find((s) => s.anchor)!;
    const tiles = slots.filter((s) => !s.anchor);
    const want = [...keys];
    const keep = new Set<Slot>();
    for (const s of tiles) {
      const i = s.key ? want.indexOf(s.key) : -1;
      if (i >= 0) {
        keep.add(s);
        want.splice(i, 1);
      }
    }
    const box = (s: Slot): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });
    if (anchorSlot.key !== key) {
      const was = tiles.find((s) => s.key === key && !keep.has(s));
      plan.push({ slot: anchorSlot, key, from: was ? box(was) : undefined });
      // The swap (his call 2026-09-24): the old center album shrinks into the tile the new one
      // left, so the two trade places and nothing leaves the mosaic. A jump to an album that had
      // no tile sends the old one to the nearest tile no longer wanted instead; with none free,
      // it fades out.
      const old = anchorSlot.key;
      const into = was ?? tiles.find((s) => !keep.has(s));
      if (old && into) {
        const dup = want.indexOf(old); // a short queue repeats covers: show this one once
        if (dup >= 0) want.splice(dup, 1);
        keep.add(into);
        plan.push({ slot: into, key: old, from: box(anchorSlot) });
      }
    }
    for (const s of tiles) if (!keep.has(s)) plan.push({ slot: s, key: want.shift() ?? key });
  }
  for (const p of plan) urls.push(linkFor(p.key, p.slot));
  await Promise.all(urls.map(preload));
  } finally {
    // Always, so a throw above can never leave this draw "in flight" and block every later
    // one for the same size and album (the boot draw did, 2026-09-24).
    if (pending === `${g}|${key}`) pending = "";
  }
  if (mine !== seq || mode() !== m) return;

  const entering = !shown;
  shown = m;
  anchorKey = key;
  root.dataset.wallpaper = m;
  if (entering) {
    layer.getAnimations().forEach((a) => a.cancel());
    const dur = ms("--wallpaper-fade-dur");
    if (dur) {
      frames.during("wallpaper", dur, "enter");
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: "ease" });
    }
  } else if (plan.length) frames.during("wallpaper", ms("--wallpaper-tile-dur"), "tiles");
  plan.forEach((p) => swapSlot(p.slot, p.key, newGeom ? undefined : p.from));

  diag.log("wallpaper:draw", {
    why: reason,
    mode: m,
    album: m === "covers" ? key.split("/").slice(-2, -1)[0] : undefined,
    tiles: n,
    changed: plan.length,
    ms: Math.round(performance.now() - started),
    w,
    h,
  });
  void colorsFor(m, key).then((p) => {
    if (mine === seq) applyColors(p);
  });
  void bakeSoft(w, h);
}

// ── the user's picture (§8) ─────────────────────────────────────────────────────

/** Read, resize and save a picture the user chose or dropped; the canvas shows it at once. */
export function setWallpaperFromFile(file: File): void {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const k = Math.min(1, PICTURE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext("2d");
    const small = document.createElement("canvas");
    small.width = small.height = COLOR_PX;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx || !sctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    sctx.drawImage(img, 0, 0, COLOR_PX, COLOR_PX);
    const colors = paletteFromPixels(sctx.getImageData(0, 0, COLOR_PX, COLOR_PX).data);
    invoke<number>("wallpaper_set", { data: c.toDataURL("image/jpeg", 0.9), colors })
      .then((stamp) => {
        pictureColors = colors;
        diag.log("wallpaper:picture", { w: c.width, h: c.height });
        setSetting("glassPicture", stamp);
      })
      .catch((e) => {
        console.error("[wallpaper] save", e);
        toast({ kind: "warn", text: "Couldn't save the picture." });
      });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast({ kind: "warn", text: `“${file.name}” is not an image DeetsMusic can read.` });
  };
  img.src = url;
}

/** The Choose button: pick an image file for the canvas. */
export function pickWallpaper(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) setWallpaperFromFile(file);
  });
  input.click();
}

export function initWallpaper(): void {
  layer = document.querySelector<HTMLElement>(".wallpaper");
  if (!layer) return;
  const body = layer.parentElement!;

  onPlayerState(() => {
    if (mode() === "covers" && currentCover().cover !== anchorKey) void update("album");
  });
  onSkinChange(() => (mode() === "aurora" ? leave(false) : void update("skin")));
  onSettingsChange((k) => {
    if (k === "glassCanvas" || k === "glassTiles") void update(k);
    else if (k === "glassPicture") {
      geom = ""; // a new picture: the whole layer crossfades
      void update(k);
    } else if (k === "glassAuroraColor" && shown && anchorKey) void colorsFor(shown, anchorKey).then(applyColors);
    else if (k === "glassFancy" && shown) void bakeSoft(body.clientWidth, body.clientHeight);
  });
  // The window came back into view: draw what changed while it was hidden.
  new MutationObserver(() => {
    if (!hidden() && dirty) void update("show");
  }).observe(root, { attributes: true, attributeFilter: ["data-ambient"] });
  // A new window size: new slots (a stretched picture looks wrong).
  new ResizeObserver(() => {
    if (!shown) return;
    placeSoft();
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void update("resize"), RESIZE_MS);
  }).observe(body);
  void update("boot");
}

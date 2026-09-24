// The Ocean sea (docs/features/OCEAN.md). CSS moves the layers; this module gives them
// something to show and says when to respond:
//
//  - The swell. A worker (ocean-worker.ts) paints three depth bands at the sea's height, in the
//    theme's water and ink: rows that crowd into haze at the horizon and grow tall toward the
//    bottom (ocean-texture.ts). Each lands as a plain background. A theme change, a new sea
//    height or a new display scale repaints them.
//  - The glow from the deep: the album's color, set as --ocean-glow-color (transparent with no
//    album); CSS fades it.
//  - The heave. While the Sound graph is routed (an effect is on), its 100 ms loudness hops lift
//    the bands, the near one most, following the song's swings against its own recent level.
//    With every effect off there is nothing to read and the sea stays calm (his call
//    2026-09-22, the room heads' rule).
//  - Ripples. A play or a drop sends two flattened rings out across the water.
//  - The album light (Settings › Album light, OCEAN.md §7). Above 0, the worker also paints each
//    band's crest lines alone, as neon in the album's color, onto a layer inside the band. CSS
//    sets how bright (the slider) and raises the glow. At 0 nothing is painted.
//
// Only while Ocean is the skin. Animate backgrounds Off, reduced motion or a hidden window: no
// heave and no ripples (the bands also hold still, in CSS).

import { onSkinChange, currentSkin } from "./skin";
import { onPlayerState, onPlayIntent, isPlayingNow } from "./player";
import { onMeter } from "./sound";
import { onDragLand } from "./row-drag";
import { setting, onSettingsChange } from "./settings-store";
import { currentCover, lookupPalette } from "./album-color";
import { albumColor, fromOKLCH, toOKLCH, type RGB } from "./album-slots";
import { BANDS, seaRows } from "./ocean-texture";
import type { LayerJob } from "./ocean-worker";
import type { LayerSpec } from "./ocean-texture";
import * as diag from "./diag";

/** A pointer-up this recent is the gesture behind a play. */
const GESTURE_MS = 1200;
/** Two ripples this close in time and place are one gesture (a drop that also plays). */
const SAME_RIPPLE_MS = 500;
const SAME_RIPPLE_PX = 48;
const MAX_RIPPLES = 4;
/** Meter hops come every 100 ms; after this gap the music or the graph has stopped. */
const BREATH_IDLE_MS = 600;
/** Write the heave every Nth hop; the CSS transition carries it between writes. */
const BREATH_EVERY = 3;
/** A height change smaller than this keeps the painted bands (they stretch a little). */
const REPAINT_PX = 24;

let sea: HTMLElement | null = null;
let worker: Worker | null = null;
let jobSeq = 0;
const pending = new Map<number, (b: Blob | null) => void>();
/** Blob URLs in use, per box, so a replaced one is released. */
const urls = new WeakMap<HTMLElement, string>();

const root = document.documentElement;
const active = () => currentSkin() === "ocean" && !!sea;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The responses (heave, ripples) run only with motion allowed and the window seen. */
const responsive = () => active() && root.dataset.bgMotion !== "off" && !reduced() && root.dataset.ambient !== "paused";

// ── colors ──────────────────────────────────────────────────────────────────────
// Any CSS color (color-mix, oklch, var) → sRGB, through a 1×1 canvas: the computed style of a
// color-mix is `color(srgb …)`, which the album parser does not read.
const swatch = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
swatch.canvas.width = swatch.canvas.height = 1;
function toRGB(css: string): RGB | null {
  swatch.clearRect(0, 0, 1, 1);
  swatch.fillStyle = "#000";
  swatch.fillStyle = css;
  swatch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
  return a ? [r / 255, g / 255, b / 255] : null;
}
let probe: HTMLElement | null = null;
/** A token resolved inside the sea (so skin and theme both apply) to sRGB. */
function resolve(expr: string): RGB | null {
  if (!sea) return null;
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    sea.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = expr;
  return toRGB(getComputedStyle(probe).color);
}
const to255 = (c: RGB): [number, number, number] => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as [number, number, number];
const hex = (c: RGB) => "#" + to255(c).map((v) => v.toString(16).padStart(2, "0")).join("");
const isDark = (c: RGB) => toOKLCH(c)[0] < 0.55;

/** Album color → a glow far under the surface: hue kept, chroma capped, a middle lightness
 *  (brighter reads as a lamp, darker vanishes into the deep water). */
function asGlow(c: RGB, darkWater: boolean): RGB {
  const [L, C, h] = toOKLCH(c);
  return fromOKLCH([darkWater ? Math.min(Math.max(L, 0.45), 0.6) : Math.min(Math.max(L, 0.55), 0.7), Math.min(C, 0.14), h]);
}

/** Album color → the neon crest: the bloom in the color made more vivid, and a core lifted
 *  toward white on dark water (a lit tube). On light water a bright line vanishes, so both
 *  go deeper. A grey cover stays grey: the chroma is scaled, never invented. */
function asNeon(c: RGB, darkWater: boolean): { core: RGB; bloom: RGB } {
  const [, C, h] = toOKLCH(c);
  const vivid = Math.min(C * 1.5, 0.2);
  return darkWater
    ? { bloom: fromOKLCH([0.72, vivid, h]), core: fromOKLCH([0.92, vivid * 0.45, h]) }
    : { bloom: fromOKLCH([0.62, vivid, h]), core: fromOKLCH([0.45, vivid, h]) };
}

// ── the bands ───────────────────────────────────────────────────────────────────
function draw(spec: LayerSpec): Promise<Blob | null> {
  worker ??= (() => {
    const w = new Worker(new URL("./ocean-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; blob: Blob | null; err?: string }>) => {
      if (e.data.err) diag.warn("ocean:paint", { err: e.data.err });
      pending.get(e.data.id)?.(e.data.blob);
      pending.delete(e.data.id);
    };
    return w;
  })();
  const id = ++jobSeq;
  return new Promise((res) => {
    pending.set(id, res);
    worker!.postMessage({ id, spec } satisfies LayerJob);
  });
}

/** Put a blob on a box as its background, once decoded (no half-drawn frame), and release
 *  the box's old one. */
async function setImage(el: HTMLElement, blob: Blob, size: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  const old = urls.get(el);
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundSize = size;
  urls.set(el, url);
  if (old) URL.revokeObjectURL(old);
}

let paintSeq = 0;
let paintedHeight = 0;

async function paintSwell(): Promise<void> {
  if (!active()) return;
  const height = sea!.clientHeight;
  if (height < 40) return; // not laid out yet
  const mine = ++paintSeq;
  paintedHeight = height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const top = resolve("var(--ocean-water-top)") ?? [0, 0, 0];
  const bottom = resolve("var(--ocean-water-bottom)") ?? top;
  const ink = resolve("var(--ocean-swell-ink)") ?? [0.5, 0.5, 0.5];
  const css = getComputedStyle(sea!);
  const shade = parseFloat(css.getPropertyValue(isDark(bottom) ? "--ocean-trough" : "--ocean-trough-light")) || 0.2;
  const rows = seaRows(height);
  const t0 = performance.now();
  await Promise.all(
    BANDS.map(async (band, i) => {
      const blob = await draw({
        w: Math.round(band.tile * dpr),
        h: Math.round(height * dpr),
        px: dpr,
        rows: rows[band.name],
        ink: to255(ink),
        top: to255(top),
        bottom: to255(bottom),
        shade,
        seed: 3 + i * 8,
      });
      const el = sea?.querySelector<HTMLElement>(`.ocean__train--${band.name}`);
      if (!blob || !el || mine !== paintSeq) return;
      el.style.setProperty("--tw", `${band.tile}px`);
      await setImage(el, blob, `${band.tile}px 100%`);
      el.toggleAttribute("data-on", true);
    }),
  );
  if (mine !== paintSeq) return;
  diag.log("ocean:paint", { ms: Math.round(performance.now() - t0), height, dpr });
  // new rows (a height, a scale or a theme): the neon must lie on them
  neonPainted = "";
  void paintNeon();
}

// ── the album light ─────────────────────────────────────────────────────────────
/** Settings › Album light, 0–100 (the stored key, and each step of a slider drag). */
let lightLevel = 0;
/** What the lit neon layers show (color, height, scale); "" = nothing current. */
let neonPainted = "";
let neonSeq = 0;

export function setAlbumLight(v: number): void {
  const was = lightLevel;
  lightLevel = v;
  if (v > 0 && was === 0) void paintNeon();
  if ((v > 0) !== (was > 0)) diag.log("ocean:light", { on: v > 0 });
}

const neonLayers = (band: string) => [...(sea?.querySelectorAll<HTMLElement>(`.ocean__train--${band} .ocean__neon`) ?? [])];

/** Paint the crest lines in the album's color and crossfade to them: the new lines go on the
 *  unlit layer of each band, then all three bands swap at once. No album: the neon fades out. */
async function paintNeon(): Promise<void> {
  if (!active() || lightLevel <= 0 || !paintedHeight) return;
  if (!glowSource) {
    sea!.querySelectorAll(".ocean__neon[data-on]").forEach((n) => n.removeAttribute("data-on"));
    neonPainted = "";
    return;
  }
  const water = resolve("var(--ocean-water-bottom)") ?? [0, 0, 0];
  const { core, bloom } = asNeon(glowSource, isDark(water));
  const height = paintedHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${hex(core)}${hex(bloom)}|${height}|${dpr}`;
  if (key === neonPainted) return;
  neonPainted = key;
  const mine = ++neonSeq;
  const rows = seaRows(height);
  const t0 = performance.now();
  const next: HTMLElement[] = [];
  await Promise.all(
    BANDS.map(async (band, i) => {
      const blob = await draw({
        w: Math.round(band.tile * dpr),
        h: Math.round(height * dpr),
        px: dpr,
        rows: rows[band.name],
        ink: [0, 0, 0],
        top: [0, 0, 0],
        bottom: [0, 0, 0],
        shade: 0,
        seed: 3 + i * 8, // the band's seed: the same crests
        neon: { core: to255(core), bloom: to255(bloom) },
      });
      const layers = neonLayers(band.name);
      const off = layers.find((n) => !n.hasAttribute("data-on")) ?? layers[0];
      if (!blob || !off || mine !== neonSeq) return;
      await setImage(off, blob, `${band.tile}px 100%`);
      next.push(off);
    }),
  );
  if (mine !== neonSeq) return;
  for (const band of BANDS) neonLayers(band.name).forEach((n) => n.toggleAttribute("data-on", next.includes(n)));
  diag.log("ocean:neon", { ms: Math.round(performance.now() - t0), height, dpr });
}

// ── the glow from the deep ──────────────────────────────────────────────────────
let liveCover: string | null | undefined;
let glowSource: RGB | null = null;

function applyGlow(): void {
  if (!sea) return;
  if (!glowSource) {
    sea.style.setProperty("--ocean-glow-color", "transparent");
    return;
  }
  const water = resolve("var(--ocean-water-bottom)") ?? [0, 0, 0];
  sea.style.setProperty("--ocean-glow-color", hex(asGlow(glowSource, isDark(water))));
}

function followAlbum(): void {
  if (!active()) return;
  const { cover, catalogId } = currentCover();
  if (cover === liveCover) return;
  liveCover = cover;
  if (!cover) {
    glowSource = null;
    applyGlow();
    void paintNeon();
    return;
  }
  lookupPalette(cover, catalogId)
    .then((p) => {
      if (liveCover !== cover) return; // the song changed meanwhile
      // the most colorful of the three, as the NP aurora's rim (Apple's names say nothing
      // about which is vivid: its text colors are near grey on half the library)
      const c = albumColor(p);
      glowSource = (c && toRGB(c)) || null;
      applyGlow();
      void paintNeon();
    })
    .catch((e) => diag.warn("ocean:palette", { err: String(e) }));
}

// ── the heave ───────────────────────────────────────────────────────────────────
let shortDb = -30;
let longDb = -30;
let hops = 0;
let heaving = false;
let idleTimer: number | undefined;

function setBreath(b: number): void {
  sea?.style.setProperty("--ocean-breath", b.toFixed(3));
}
function calm(): void {
  if (!heaving) return;
  heaving = false;
  setBreath(0);
  diag.log("ocean:heave", { on: false });
}

function onHop(ms: number): void {
  if (!responsive() || !isPlayingNow()) return calm();
  const db = 10 * Math.log10(Math.max(ms, 1e-9));
  if (db < -60) return calm(); // silence between songs
  // The song's swing against its own recent level: a short average (~1 s) over a long one
  // (~12 s), so a quiet song heaves as much as a loud one.
  if (!heaving) {
    shortDb = longDb = db;
    heaving = true;
    diag.log("ocean:heave", { on: true });
  }
  shortDb += (db - shortDb) * 0.12;
  longDb += (db - longDb) * 0.008;
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(calm, BREATH_IDLE_MS);
  if (++hops % BREATH_EVERY) return;
  setBreath(Math.max(-1, Math.min(1, (shortDb - longDb) / 6)));
}

// ── ripples ─────────────────────────────────────────────────────────────────────
let lastUp = { x: 0, y: 0, t: -Infinity };
let lastRipple = { x: 0, y: 0, t: -Infinity };

function ripple(x: number, y: number): void {
  if (!responsive() || !sea) return;
  const now = performance.now();
  if (now - lastRipple.t < SAME_RIPPLE_MS && Math.hypot(x - lastRipple.x, y - lastRipple.y) < SAME_RIPPLE_PX) return;
  lastRipple = { x, y, t: now };
  const host = sea.querySelector<HTMLElement>(".ocean__ripples");
  if (!host) return;
  while (host.childElementCount >= MAX_RIPPLES * 2) host.firstElementChild?.remove();
  const box = sea.getBoundingClientRect();
  const gap = getComputedStyle(sea).getPropertyValue("--ocean-ripple-gap").trim() || "0.35s";
  for (const delay of ["0s", gap]) {
    const ring = document.createElement("i");
    ring.className = "ocean__ripple";
    ring.style.setProperty("--x", `${x - box.left}px`);
    ring.style.setProperty("--y", `${y - box.top}px`);
    ring.style.setProperty("--delay", delay);
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
    host.appendChild(ring);
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────────
function enter(): void {
  liveCover = undefined;
  // after the skin's tokens apply, so the sea has its size and colors
  requestAnimationFrame(() => {
    void paintSwell();
    followAlbum();
  });
}

export function initOcean(): void {
  sea = document.querySelector<HTMLElement>(".ocean");
  if (!sea) return;
  // the stored album light; a slider drag also calls setAlbumLight (settings-card.ts)
  setAlbumLight(setting("oceanLight"));
  onSettingsChange((k) => {
    if (k === "oceanLight") setAlbumLight(setting("oceanLight"));
  });

  if (currentSkin() === "ocean") enter();
  onSkinChange((name) => {
    if (name === "ocean") enter();
    else calm();
  });
  // A theme (or the look schedule) changes the water and the ink: repaint and re-tint.
  new MutationObserver(() =>
    requestAnimationFrame(() => {
      if (!active()) return;
      void paintSwell();
      applyGlow();
    }),
  ).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  // The rows are laid out for the sea's height: a taller or shorter window repaints them,
  // once it settles (the bands stretch to fit meanwhile).
  let resizeTimer: number | undefined;
  new ResizeObserver(() => {
    if (!active() || Math.abs(sea!.clientHeight - paintedHeight) < REPAINT_PX) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void paintSwell(), 300);
  }).observe(sea);
  // A move to a display with another scale: repaint at its pixel density.
  const watchDpr = () => {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        if (active()) void paintSwell();
        watchDpr();
      },
      { once: true },
    );
  };
  watchDpr();

  onPlayerState(followAlbum);
  onMeter(onHop);

  document.addEventListener("pointerup", (e) => (lastUp = { x: e.clientX, y: e.clientY, t: performance.now() }), {
    capture: true,
    passive: true,
  });
  onPlayIntent(() => {
    if (performance.now() - lastUp.t < GESTURE_MS) ripple(lastUp.x, lastUp.y);
  });
  onDragLand(ripple);
}

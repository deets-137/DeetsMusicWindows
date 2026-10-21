// The scene around the cards (--hook-scene: on; the Happy skin, docs/features/happy.md §1.2).
// The pictures are the skin's (skin.css --scene-*), so a mod gets a scene by setting them; this
// module only sizes and places them, and paints the sky's part of the day:
//   - --scene-px on <html>: the art's pixel size, in whole device pixels (2× in Max, 1.5×
//     elsewhere, his call H8), so pixel art stays sharp at 125 % and 150 % Windows scaling.
//   - the sky: sky-phase.ts picks the part of the day once a minute (Settings › Sky).
//   - the sun or moon at the top-right card's corner, the far clouds' heights, the edge clouds
//     on the outer edges of the cards, from the cards' boxes (a resize, a card swap, a surface).
// pet.ts puts Deets and Happy on the floor this module reports (`sceneFloor`).
// Inert under every other skin: the layers are display:none and nothing here runs.

import * as diag from "./diag";
import { hook, onSkinChange } from "./skin";
import { setting, onSettingsChange } from "./settings-store";
import { skyAt } from "./sky-phase";
import { sunTimes } from "./look-schedule";
import { onSurfaceChange } from "./surface";

const root = document.documentElement;
const active = () => hook("scene") === "on";
let body: HTMLElement | null = null;
let back: HTMLElement | null = null;
let front: HTMLElement | null = null;
let skyTimer = 0;
let placing = 0;
const listeners = new Set<() => void>();

/** The art pixel size now, in CSS px (whole device pixels). */
export function scenePx(): number {
  const want = root.dataset.surface === "max" ? 2 : 1.5;
  const dpr = window.devicePixelRatio || 1;
  return Math.max(1, Math.round(want * dpr)) / dpr;
}

/** The line feet stand on, in .app-body's own px from its top, and its box. */
export function sceneFloor(): { y: number; w: number; h: number } | null {
  if (!body || !active()) return null;
  const cs = getComputedStyle(root);
  const px = scenePx();
  const tileH = num(cs, "--scene-grass-h") * px;
  const feet = num(cs, "--scene-grass-feet") * px;
  return { y: body.clientHeight - tileH + feet, w: body.clientWidth, h: body.clientHeight };
}

/** Called after the scene re-places itself (pet.ts moves the pair with it). */
export function onScenePlace(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const num = (cs: CSSStyleDeclaration, p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
/** The picture a token names: url("…") → the address, or "". */
export const urlOf = (v: string): string => /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(v)?.[1] ?? "";

const sizes = new Map<string, Promise<{ w: number; h: number }>>();
/** A picture's own size (cached), 0 × 0 when it cannot load. */
export function pictureSize(url: string): Promise<{ w: number; h: number }> {
  if (!url) return Promise.resolve({ w: 0, h: 0 });
  let p = sizes.get(url);
  if (!p) {
    p = new Promise((done) => {
      const img = new Image();
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => done({ w: 0, h: 0 });
      img.src = url;
    });
    sizes.set(url, p);
  }
  return p;
}

function paintSky(): void {
  if (!back) return;
  const sun = sunTimes(new Date());
  const s = skyAt(setting("happySky"), Date.now(), sun);
  const from = back.querySelector<HTMLElement>(".scene__sky--from");
  const to = back.querySelector<HTMLElement>(".scene__sky--to");
  if (!from || !to) return;
  if (from.dataset.part !== s.from) {
    // a new pair of parts: the old "to" is now underneath, so start the blend from nothing
    to.style.transition = "none";
    to.style.setProperty("--sky-t", "0");
    void to.offsetWidth;
    to.style.transition = "";
  }
  from.dataset.part = s.from;
  to.dataset.part = s.to;
  to.style.setProperty("--sky-t", String(s.t));
  if (front) front.toggleAttribute("data-moon", s.moon);
}

/** The visible cards' boxes, relative to .app-body. */
function cards(): DOMRect[] {
  if (!body) return [];
  const b = body.getBoundingClientRect();
  return [...body.querySelectorAll<HTMLElement>(".bento .panel")]
    .filter((p) => p.offsetParent !== null && p.getClientRects().length > 0)
    .map((p) => {
      const r = p.getBoundingClientRect();
      return new DOMRect(r.left - b.left, r.top - b.top, r.width, r.height);
    })
    .filter((r) => r.width > 40 && r.height > 40);
}

async function place(): Promise<void> {
  if (!body || !front || !back || !active()) return;
  const mine = ++placing;
  const cs = getComputedStyle(root);
  const px = scenePx();
  root.style.setProperty("--scene-px", String(px));
  const W = body.clientWidth;
  back.style.setProperty("--scene-w", `${W}px`);
  const boxes = cards();
  const [sun, c1, c2, c3] = await Promise.all(
    ["--scene-sun", "--scene-cloud-1", "--scene-cloud-2", "--scene-cloud-3"].map((p) => pictureSize(urlOf(cs.getPropertyValue(p)))),
  );
  if (mine !== placing) return;

  // The sun: at the top-right card's corner, a share of it over the card (--scene-sun-over).
  const sunEl = front.querySelector<HTMLElement>(".scene__sun");
  if (sunEl && boxes.length) {
    const right = Math.max(...boxes.map((r) => r.right));
    const card = boxes.filter((r) => r.right >= right - 2).sort((a, b) => a.top - b.top)[0];
    const d = sun.w * px;
    const over = Math.min(0.5, Math.max(0, num(cs, "--scene-sun-over")));
    sunEl.style.setProperty("--sun-w", `${d}px`);
    sunEl.style.setProperty("--sun-x", `${card.right - over * d}px`);
    sunEl.style.setProperty("--sun-y", `${card.top - d + over * d}px`);
    // the rays' picture is bigger than the disc: draw it at the same pixel size
    const rays = await pictureSize(urlOf(cs.getPropertyValue("--scene-sun-rays")));
    if (mine !== placing) return;
    sunEl.style.setProperty("--rays-k", String(sun.w ? rays.w / sun.w : 1));
  }

  // Far clouds: three heights in the top half, spread along their trip.
  const far = [c3, c1, c2];
  back.querySelectorAll<HTMLElement>(".scene__cloud--far").forEach((el, i) => {
    const s = far[i];
    el.style.setProperty("--cloud-w", `${s.w * px}px`);
    el.style.setProperty("--cloud-h", `${s.h * px}px`);
    el.style.setProperty("--cloud-y", `${Math.round(body!.clientHeight * [0.08, 0.22, 0.36][i])}px`);
    el.style.setProperty("--cloud-at", `calc(var(--scene-cloud-trip) * ${-[0.15, 0.55, 0.85][i]})`);
  });

  // Edge clouds: on the outer edge of the leftmost card and of the rightmost one, a share of
  // each over its card (--scene-cloud-over), never across the middle of a card.
  const edge = [c2, c1];
  const left = boxes.length ? boxes.reduce((a, b) => (b.left < a.left ? b : a)) : null;
  const rightCard = boxes.length ? boxes.reduce((a, b) => (b.right > a.right ? b : a)) : null;
  const overC = Math.min(0.5, Math.max(0, num(cs, "--scene-cloud-over")));
  front.querySelectorAll<HTMLElement>(".scene__cloud--edge").forEach((el, i) => {
    const s = edge[i];
    const card = i === 0 ? left : rightCard;
    if (!card || !s.w) { el.hidden = true; return; }
    el.hidden = false;
    const w = s.w * px, h = s.h * px;
    el.style.setProperty("--cloud-w", `${w}px`);
    el.style.setProperty("--cloud-h", `${h}px`);
    el.style.setProperty("--cloud-x", `${i === 0 ? card.left - w + overC * w : card.right - overC * w}px`);
    el.style.setProperty("--cloud-y", `${card.top + card.height * (i === 0 ? 0.42 : 0.3) - h / 2}px`);
    el.style.setProperty("--cloud-at", `${-i * 3}s`);
  });
  listeners.forEach((cb) => cb());
}

const schedulePlace = () => {
  if (!active()) return;
  cancelAnimationFrame(placeFrame);
  placeFrame = requestAnimationFrame(() => void place());
};
let placeFrame = 0;

function enter(): void {
  if (!body) return;
  paintSky();
  window.clearInterval(skyTimer);
  skyTimer = window.setInterval(paintSky, 60_000);
  schedulePlace();
  diag.log("scene:on", { px: scenePx(), sky: setting("happySky") });
}

function leave(): void {
  window.clearInterval(skyTimer);
  skyTimer = 0;
  root.style.removeProperty("--scene-px");
  diag.log("scene:off");
}

export function initScene(): void {
  body = document.querySelector<HTMLElement>(".app-body");
  back = document.querySelector<HTMLElement>(".scene--back");
  front = document.querySelector<HTMLElement>(".scene--front");
  if (!body || !back || !front) return;
  let on = active();
  if (on) enter();
  onSkinChange(() => {
    const now = active();
    if (now && !on) enter();
    else if (!now && on) leave();
    else if (now) schedulePlace();
    on = now;
  });
  onSettingsChange((k) => {
    if (k === "happySky" && active()) paintSky();
  });
  onSurfaceChange(() => schedulePlace());
  new ResizeObserver(() => schedulePlace()).observe(body);
  // a card swap, a grow or the full player moves the cards: place again once they settle
  const bento = body.querySelector(".bento");
  if (bento) new MutationObserver(() => schedulePlace()).observe(bento, { attributes: true, childList: true, subtree: false, attributeFilter: ["data-player", "data-screen", "class"] });
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => schedulePlace());
}

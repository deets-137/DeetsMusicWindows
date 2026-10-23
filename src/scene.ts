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
    // A read that fails or never settles gives 0 × 0 and leaves the cache, so the next place
    // reads it again. Once a read from a launch hidden off-screen never settled: every place
    // after it waited on it, and Deets stood in the title bar's corner all session (2026-10-21).
    p = new Promise((done) => {
      const img = new Image();
      const end = (w: number, h: number, why?: string) => {
        window.clearTimeout(limit);
        img.onload = img.onerror = null;
        if (!w || !h) {
          // place again a little later (pet.ts reads its strips from there too), a few times
          sizes.delete(url);
          const n = (fails.get(url) ?? 0) + 1;
          fails.set(url, n);
          diag.warn("scene:picture", { url, why, n });
          if (n <= 5) window.setTimeout(schedulePlace, RETRY_PLACE_MS);
        }
        done({ w, h });
      };
      const limit = window.setTimeout(() => end(0, 0, "stalled"), PICTURE_WAIT_MS);
      img.onload = () => end(img.naturalWidth, img.naturalHeight, "empty");
      img.onerror = () => end(0, 0, "error");
      img.src = url;
    });
    sizes.set(url, p);
  }
  return p;
}
const PICTURE_WAIT_MS = 3000;
const RETRY_PLACE_MS = 2000;
const fails = new Map<string, number>();

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
  return [...body.querySelectorAll<HTMLElement>(`.bento .panel:not(${PLAYER_COPIES})`)]
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
  // A place over the resting cards is the one the full player keeps (holdForPlayer).
  restSize = body.querySelector(".bento[data-player]") ? "" : sizeKey();
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

  // The sun: in the window's top-right corner, in the sky behind the title bar, its lower part
  // over the top-right card's corner (his call, 2026-10-21). It slides out of the pointer's way
  // (sunDodge), so the card's buttons under it stay reachable.
  const sunEl = front.querySelector<HTMLElement>(".scene__sun");
  if (sunEl) {
    const d = sun.w * px;
    const inset = Math.max(0, num(cs, "--scene-sun-inset")) * px;
    const bar = body.getBoundingClientRect().top; // the title bar's height above the body
    sunEl.style.setProperty("--sun-w", `${d}px`);
    sunEl.style.setProperty("--sun-x", `${W - d - inset}px`);
    sunEl.style.setProperty("--sun-y", `${inset - bar}px`);
    sunHome = d ? { x: W - d / 2 - inset, y: inset - bar + d / 2, r: d / 2, top: -bar, w: W } : null;
    sunAway = false;
    sunEl.toggleAttribute("data-away", false);
    sunEl.style.removeProperty("--sun-dx");
    sunEl.style.removeProperty("--sun-dy");
    // the rays' picture is bigger than the disc: draw it at the same pixel size
    const rays = await pictureSize(urlOf(cs.getPropertyValue("--scene-sun-rays")));
    if (mine !== placing) return;
    sunEl.style.setProperty("--rays-k", String(sun.w ? rays.w / sun.w : 1));
  }

  const pics = [c1, c2, c3];

  // Far clouds: scattered heights in the top 60 %, each its own size, speed and start, so they
  // never drift as one row. The draw is made once a session (cloudsFar), so a resize keeps them.
  const H = body.clientHeight;
  const farEls = cloudEls(back, "far", Math.round(num(cs, "--scene-far-clouds")));
  farEls.forEach((el, i) => {
    const c = cloudsFar[i];
    const s = pics[c.pic];
    el.hidden = !s.w;
    el.style.setProperty("--cloud-img", `var(--scene-cloud-${c.pic + 1})`);
    el.style.setProperty("--cloud-w", `${s.w * px}px`);
    el.style.setProperty("--cloud-h", `${s.h * px}px`);
    el.style.setProperty("--cloud-y", `${Math.round(H * c.y)}px`);
    el.style.setProperty("--cloud-alpha", String(c.alpha));
    el.style.setProperty("--cloud-trip", `calc(var(--scene-cloud-trip) * ${c.trip.toFixed(3)})`);
    el.style.setProperty("--cloud-at", `calc(var(--scene-cloud-trip) * ${(-c.trip * c.at).toFixed(3)})`);
  });

  // Edge clouds: on the outer edges of the left column's cards and the right column's, a share
  // of each over its card (--scene-cloud-over), never across the middle of a card. They take
  // turns between the two sides; two on one card keep to its upper and lower halves.
  const minL = boxes.length ? Math.min(...boxes.map((r) => r.left)) : 0;
  const maxR = boxes.length ? Math.max(...boxes.map((r) => r.right)) : 0;
  const sides = [
    boxes.filter((r) => r.left <= minL + 2).sort((a, b) => a.top - b.top),
    boxes.filter((r) => r.right >= maxR - 2).sort((a, b) => a.top - b.top),
  ];
  const overC = Math.min(0.5, Math.max(0, num(cs, "--scene-cloud-over")));
  const edgeEls = cloudEls(front, "edge", Math.round(num(cs, "--scene-edge-clouds")));
  const onCard = new Map<DOMRect, number[]>();
  const spots = edgeEls.map((_, i) => {
    const side = i % 2;
    const list = sides[side];
    if (!list.length) return null;
    const c = cloudsEdge[i];
    const card = list[Math.floor(c.card * list.length)];
    const n = onCard.get(card) ?? [];
    n.push(i);
    onCard.set(card, n);
    return { side, card };
  });
  edgeEls.forEach((el, i) => {
    const spot = spots[i];
    const c = cloudsEdge[i];
    const s = pics[c.pic];
    if (!spot || !s.w) { el.hidden = true; return; }
    el.hidden = false;
    const { side, card } = spot;
    const mates = onCard.get(card)!;
    const k = mates.indexOf(i), n = mates.length;
    const y = card.top + card.height * ((k + 0.15 + c.y * 0.7) / n);
    const w = s.w * px, h = s.h * px;
    el.style.setProperty("--cloud-img", `var(--scene-cloud-${c.pic + 1})`);
    el.style.setProperty("--cloud-w", `${w}px`);
    el.style.setProperty("--cloud-h", `${h}px`);
    el.style.setProperty("--cloud-x", `${side === 0 ? card.left - w + overC * w : card.right - overC * w}px`);
    el.style.setProperty("--cloud-y", `${Math.round(y - h / 2)}px`);
    el.style.setProperty("--cloud-bob", `calc(var(--scene-bob-dur) * ${c.bob.toFixed(2)})`);
    el.style.setProperty("--cloud-at", `${(-c.at * 10).toFixed(2)}s`);
  });
  listeners.forEach((cb) => cb());
}

// ---- the sun makes way ---------------------------------------------------------------------
// The sun covers the top-right card's corner, where its ⟳ sits, and the title bar's right end.
// A pointer coming near it sends it out of the window the way that leaves the pointer clear:
// up behind the top edge when the pointer comes from below (the card), out past the right edge
// when it comes from the title bar. A sliver stays in sight. It comes home once the pointer is
// well clear of where it lives, or leaves the window. All in .app-body's px.
let sunHome: { x: number; y: number; r: number; top: number; w: number } | null = null;
let sunAway = false;
const SUN_NEAR = 1.3; // × the radius from its center: the pointer is at the disc's edge
const SUN_CLEAR = 1.9; // × the radius: well clear, so it can come home without a flicker
const SUN_PEEK = 0.35; // × the radius left in sight while it is away

function sunMove(away: { dx: number; dy: number } | null): void {
  const el = front?.querySelector<HTMLElement>(".scene__sun");
  if (!el) return;
  sunAway = !!away;
  el.toggleAttribute("data-away", sunAway);
  el.style.setProperty("--sun-dx", `${Math.round(away?.dx ?? 0)}px`);
  el.style.setProperty("--sun-dy", `${Math.round(away?.dy ?? 0)}px`);
  diag.log(sunAway ? "scene:sun-away" : "scene:sun-home", away ? { dx: Math.round(away.dx), dy: Math.round(away.dy) } : {});
}

function sunDodge(e: PointerEvent): void {
  const h = sunHome;
  if (!h || !body || !active()) return;
  const b = body.getBoundingClientRect();
  const px = e.clientX - b.left, py = e.clientY - b.top;
  const dist = Math.hypot(px - h.x, py - h.y);
  if (!sunAway && dist < h.r * SUN_NEAR) {
    const fromBelow = py > h.y - h.r * 0.3;
    sunMove(fromBelow
      ? { dx: 0, dy: h.top + h.r * SUN_PEEK - (h.y + h.r) }
      : { dx: h.w - h.r * SUN_PEEK - (h.x - h.r), dy: 0 });
  } else if (sunAway && dist > h.r * SUN_CLEAR) sunMove(null);
}

// ---- the clouds' draw ----------------------------------------------------------------------
// One draw a session, from a seed: the same clouds come back after a resize or a card swap.
interface FarCloud { pic: number; y: number; trip: number; at: number; alpha: number }
interface EdgeCloud { pic: number; card: number; y: number; bob: number; at: number }
const cloudsFar: FarCloud[] = [];
const cloudsEdge: EdgeCloud[] = [];
let seed = (Math.random() * 2 ** 32) >>> 0;
/** mulberry32: a small seeded random, so the draw is stable once made */
function rnd(): number {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** small 40 % · medium 35 % · large 25 % (0, 1, 2 = --scene-cloud-1..3) */
const pickPic = () => { const r = rnd(); return r < 0.4 ? 0 : r < 0.75 ? 1 : 2; };

function drawFar(n: number): void {
  // heights: one band per cloud, the bands shuffled and each cloud jittered inside its own, so
  // the sky fills without a ladder of even rows
  const bands = [...Array(n).keys()].sort(() => rnd() - 0.5);
  for (let i = cloudsFar.length; i < n; i++) {
    const pic = pickPic();
    cloudsFar.push({
      pic,
      y: 0.03 + ((bands[i] + rnd() * 0.85) / n) * 0.57,
      // the small ones read as far away: slower and a little paler
      trip: [1.3, 1.05, 0.85][pic] * (0.85 + rnd() * 0.3),
      at: rnd(),
      alpha: [0.8, 0.92, 1][pic],
    });
  }
}

function drawEdge(n: number): void {
  for (let i = cloudsEdge.length; i < n; i++) {
    cloudsEdge.push({ pic: rnd() < 0.55 ? 0 : 1, card: rnd(), y: rnd(), bob: 0.7 + rnd() * 0.6, at: rnd() });
  }
}

/** The layer's clouds of one kind, made or dropped to `n`. */
function cloudEls(layer: HTMLElement, kind: "far" | "edge", n: number): HTMLElement[] {
  n = Math.max(0, Math.min(40, n || 0));
  (kind === "far" ? drawFar : drawEdge)(n);
  const els = [...layer.querySelectorAll<HTMLElement>(`.scene__cloud--${kind}`)];
  while (els.length > n) els.pop()!.remove();
  while (els.length < n) {
    const el = document.createElement("div");
    el.className = `scene__cloud scene__cloud--${kind}`;
    // far clouds behind the cards; edge clouds under the grass, the sun and the floor
    if (kind === "edge") layer.querySelector(".scene__grass")?.before(el);
    else layer.append(el);
    els.push(el);
  }
  return els;
}

const schedulePlace = () => {
  if (!active()) return;
  cancelAnimationFrame(placeFrame);
  placeFrame = requestAnimationFrame(() => void place());
};
let placeFrame = 0;

// ---- the full player keeps the clouds ------------------------------------------------------
// The full player's open and close put copies of its cards in the bento (full-player.ts: the
// resting copy, the moving card box, the Queue's still, the side column) and flip data-player.
// Each change placed the edge clouds again, over the moving boxes mid-motion and then over the
// full layout's fewer cards, so they jumped two or three times per open (his report,
// 2026-10-23). The outer edges they rest on do not move with the player, so they keep the
// resting place: a player change places nothing while the window has the size of the last
// resting place. A resize while it is open still places them.
const PLAYER_COPIES = ".np-still, .fp-still, .fp-ghost, .fp-history";
let restSize = "";
const sizeKey = (): string => (body ? `${body.clientWidth}x${body.clientHeight}` : "");
const playerOwn = (r: MutationRecord): boolean =>
  r.type === "attributes"
    ? r.attributeName === "data-player"
    : [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof HTMLElement && n.matches(PLAYER_COPIES));
function holdForPlayer(recs: MutationRecord[]): boolean {
  return !!restSize && restSize === sizeKey() && recs.every(playerOwn);
}

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
  sunHome = null;
  sunAway = false;
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
  window.addEventListener("pointermove", sunDodge, { passive: true });
  root.addEventListener("pointerleave", () => { if (sunAway) sunMove(null); });
  new ResizeObserver(() => schedulePlace()).observe(body);
  // a card swap or a grow moves the cards: place again once they settle (the full player keeps them)
  const bento = body.querySelector(".bento");
  if (bento) new MutationObserver((recs) => { if (!holdForPlayer(recs)) schedulePlace(); }).observe(bento, { attributes: true, childList: true, subtree: false, attributeFilter: ["data-player", "data-screen", "class"] });
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => schedulePlace());
}

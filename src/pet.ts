// The pet and its friend (the Happy skin: Happy and Deets; docs/features/happy.md §1.1, §1.5,
// §2.1a). The pictures are the skin's (skin.css --pet-*, --friend-*), so a mod with its own
// strips gets the same play; this module is the choreography:
//   - At rest: the friend stands facing you in the window's bottom-left corner, the pet sits
//     beside him facing you. Neither takes a click; the card under them gets end padding so its
//     last row can scroll clear of them.
//   - Fetch: a round 10 s after the scene shows, then every 25–40 s (his calls H6 a and
//     2026-10-21). The friend throws, the pet fetches; it ends one of three ways (the odds are a
//     draft): "Good boy!", or "Gundu..." when he comes back without the ball or keeps it.
//   - A cover change (--cover-swap: pet; vinyl.ts announces it with `vinyl:turn`): the pet leaves
//     the grass, moves the cover one of two ways (never the same twice in a row), sits by it,
//     and comes back. Only one pet ever shows (his call H7 a). Fast presses keep him at the cover.
//   - The grand opening's card (GRAND-OPENING.md §6, his ask 2026-10-22): while it is open the
//     pair rest in the bottom-RIGHT corner, in front of the card, and run across the grass when
//     it opens and when it closes. No fetch while they are over there (the throw goes right).
// Reduced motion, a hidden window and "Animate backgrounds" off hold everything at rest.

import * as diag from "./diag";
import { hook, onSkinChange } from "./skin";
import { motionReduced } from "./motion";
import { sceneFloor, scenePx, onScenePlace, urlOf, pictureSize } from "./scene";

type PetPose = "sit" | "idle" | "walk" | "run" | "push-head" | "stand-up" | "stand-push" | "run-ball" | "drop-ball" | "keep-ball";
type FriendPose = "idle" | "throw" | "watch" | "walk";
interface Strip { url: string; fw: number; fh: number; frames: number }

const root = document.documentElement;
const active = () => hook("scene") === "on";
const calm = () => motionReduced() || root.dataset.bgMotion === "off";
const seen = () => !document.hidden && root.dataset.ambient !== "paused";
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// The timing (happy.md §2.1a): the site's walkers.js with more room.
const FIRST_ROUND_MS = 10_000;
const NEXT_ROUND_MS: [number, number] = [25_000, 40_000];
const RUN_FPS = 10; // at RUN_SPEED; a faster run steps faster (strideFps), so feet never slide
const PUSH_FPS = 8;
const RUN_SPEED = 140; // CSS px a second at 2×, scaled with the art
const ODDS = { good: 0.7, without: 0.15 }; // the rest: he keeps it
const WORDS = { good: "Good boy!", gundu: "Gundu..." }; // his words (§1.5); the skin's, never a mod's
const PUSH_LEAD_MS = 300; // the slide waits this long for the pet (the cover moves within 0.3 s)
const PUSH_MS = 700; // the slide itself
const SIT_BY_COVER_MS = 1500; // another change in this time: he stays and pushes again
const DASH_MS = 150; // off the grass, toward the nearer edge
const DASH_PX = 30; // how far that dash goes, in art px
const STAND_LEAD_MS = 450; // the stand needs its run-in and the rise onto his hind legs first
const STAND_UP_FPS = 12; // the rise: three frames in a quarter second

// Each pose's fallback while its strip is blank or missing (a strip he has not drawn yet).
const PET_FALLBACK: Record<PetPose, PetPose | null> = {
  sit: "idle", idle: null, walk: "idle", run: "walk", "push-head": "idle", "stand-up": "idle",
  "stand-push": "idle", "run-ball": "walk", "drop-ball": "idle", "keep-ball": "sit",
};

const strips = new Map<string, Strip | null>();

/** One strip from the skin's tokens: its picture, frame size (art px) and frame count; null when blank. */
async function loadStrip(token: string): Promise<Strip | null> {
  const cs = getComputedStyle(root);
  const url = urlOf(cs.getPropertyValue(token));
  if (!url) return null;
  const key = `${token}|${url}`;
  if (strips.has(key)) return strips.get(key)!;
  const { w, h } = await pictureSize(url);
  // a failed read is not kept: the next ask reads it again (scene.ts places again after one)
  if (!w || !h) return null;
  const fwArt = parseFloat(cs.getPropertyValue(`${token}-w`)) || h;
  const blank = await isBlank(url, w, h);
  const s = blank ? null : { url, fw: fwArt, fh: h, frames: Math.max(1, Math.round(w / fwArt)) };
  strips.set(key, s);
  return s;
}

/** A strip with nothing drawn on it (a blank template copied in by happy:art). A read that never
    settles counts as drawn, so nothing waits on it (scene.ts pictureSize, 2026-10-21). */
function isBlank(url: string, w: number, h: number): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const limit = window.setTimeout(() => done(false), 3000);
    const done = (b: boolean) => { window.clearTimeout(limit); img.onload = img.onerror = null; resolve(b); };
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const a = g.getImageData(0, 0, w, h).data;
        for (let i = 3; i < a.length; i += 4) if (a[i]) return done(false);
        done(true);
      } catch {
        done(false);
      }
    };
    img.onerror = () => done(true);
    img.src = url;
  });
}

async function petStrip(pose: PetPose): Promise<Strip | null> {
  let p: PetPose | null = pose;
  while (p) {
    const s = await loadStrip(`--pet-${p}`);
    if (s) return s;
    p = PET_FALLBACK[p];
  }
  return null;
}
const friendStrip = async (pose: FriendPose) => (await loadStrip(`--friend-${pose}`)) ?? (await loadStrip("--friend-idle"));

/** A sprite on a layer: its feet at (x, y), facing left (the art's way) or right (mirrored). */
class Actor {
  el: HTMLElement;
  x = 0;
  y = 0;
  right = false;
  px = 2;
  strip: Strip | null = null;
  private move: Animation | null = null;
  constructor(layer: HTMLElement, cls: string) {
    this.el = document.createElement("div");
    this.el.className = `scene__actor ${cls}`;
    layer.append(this.el);
  }
  private transform(x = this.x, y = this.y) {
    const w = (this.strip?.fw ?? 0) * this.px;
    const h = (this.strip?.fh ?? 0) * this.px;
    return `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h)}px) scaleX(${this.right ? -1 : 1})`;
  }
  /** Show a pose: the strip, its size at this pixel scale, its frames stepped at `fps` (once or looped). */
  show(strip: Strip | null, fps = 0, loop = true) {
    this.strip = strip;
    this.el.hidden = !strip;
    if (!strip) return;
    const s = this.el.style;
    s.setProperty("--strip", `url("${strip.url}")`);
    s.setProperty("--fw", `${strip.fw * this.px}px`);
    s.setProperty("--fh", `${strip.fh * this.px}px`);
    s.setProperty("--frames", String(strip.frames));
    s.backgroundPositionX = "0px";
    // A loop steps to the strip's end (one frame past the last, which is the first again). A
    // single play must stop ON the last frame: past it there is nothing drawn, and the sprite
    // vanished until its next pose (Deets after the throw, 2026-10-21).
    s.animation = strip.frames > 1 && fps > 0
      ? loop
        ? `scene-frames ${(strip.frames / fps).toFixed(3)}s steps(${strip.frames}) infinite`
        : `scene-frames-once ${(strip.frames / fps).toFixed(3)}s steps(${strip.frames}, jump-none) 1 forwards`
      : "none";
    s.transform = this.transform();
  }
  /** Mid-move (a walk or a run under way). */
  get moving(): boolean {
    return this.move?.playState === "running";
  }
  place(x: number, y: number) {
    this.move?.cancel();
    this.x = x;
    this.y = y;
    this.el.style.transform = this.transform();
  }
  face(right: boolean) {
    this.right = right;
    this.el.style.transform = this.transform();
  }
  /** Walk or run to (x, y) over `ms`; resolves on arrival (or when cancelled). */
  to(x: number, y: number, ms: number, easing = "linear"): Promise<void> {
    this.move?.cancel();
    const from = this.transform();
    this.x = x;
    this.y = y;
    const to = this.transform();
    this.el.style.transform = to;
    if (ms <= 0) return Promise.resolve();
    this.move = this.el.animate([{ transform: from }, { transform: to }], { duration: ms, easing });
    return this.move.finished.then(() => {}, () => {});
  }
  fade(to: 0 | 1, ms: number): Promise<void> {
    const a = this.el.animate([{ opacity: to ? 0 : 1 }, { opacity: to }], { duration: ms, fill: "forwards" });
    return a.finished.then(() => { this.el.style.opacity = String(to); a.cancel(); }, () => {});
  }
  stop() {
    this.move?.cancel();
    this.el.getAnimations().forEach((a) => a.cancel());
  }
}

// ---- state --------------------------------------------------------------------------------
let floor: HTMLElement | null = null;
let pet: Actor | null = null;
let friend: Actor | null = null;
let ball: HTMLElement | null = null;
let bubble: HTMLElement | null = null;
let roundTimer = 0;
let gen = 0; // bumps on every interruption: an awaited step from an older one stops
let where: "grass" | "cover" | "away" = "grass";
let ballAt: number | null = null; // a ball left on the grass (x), fetched first next round
let ballKept = false; // the pet kept it: dropped before the next round
let carrying = false; // the ball is in his mouth on the way back
let lastPush = "";
/** The corner the pair rest in: the right one while the grand opening's card is open. */
let side: "left" | "right" = "left";
/** Happy by the cover: his layer in that card, and whether he is in sight there (`onstage`). */
let atCover: { panel: HTMLElement; layer: HTMLElement; actor: Actor; until: number; timer: number; onstage: boolean } | null = null;
const padded = new Map<HTMLElement, string>();

function restSpots(): { fx: number; px: number; y: number } | null {
  const f = sceneFloor();
  if (!f || !friend?.strip) return null;
  const fw = friend.strip.fw * friend.px;
  const pw = (pet?.strip?.fw ?? 32) * friend.px;
  const inset = 6 * friend.px + fw / 2; // a little in from the corner
  // On the right, the mirror: Deets in the corner, Happy on his inner side.
  if (side === "right") {
    const fx = f.w - inset;
    return { fx, px: fx - fw / 2 - pw / 2, y: f.y };
  }
  return { fx: inset, px: inset + fw / 2 + pw / 2, y: f.y };
}

/** The card under the pair gets end padding the height of the pair (happy.md §2.1a). */
function padUnderPair(): void {
  for (const [el, was] of padded) el.style.paddingBottom = was;
  padded.clear();
  if (!floor || !friend?.strip || !active()) return;
  const f = friend.el.getBoundingClientRect();
  const p = pet && !pet.el.hidden ? pet.el.getBoundingClientRect() : f;
  const box = { left: Math.min(f.left, p.left), right: Math.max(f.right, p.right), top: Math.min(f.top, p.top) };
  document.querySelectorAll<HTMLElement>(".bento .app-scroll, .onboarding .app-scroll").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= box.left || r.left >= box.right || r.bottom <= box.top) return;
    const own = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    padded.set(el, el.style.paddingBottom);
    el.style.paddingBottom = `${Math.round(own + (r.bottom - box.top))}px`;
  });
}

async function rest(): Promise<void> {
  if (!floor || !pet || !friend) return;
  const px = scenePx();
  pet.px = friend.px = px;
  friend.show(await friendStrip("idle"));
  friend.face(false);
  const spots = restSpots();
  // no floor yet: he stays out of sight, never at the layer's corner (the title bar, 2026-10-21)
  if (!spots) { friend.el.hidden = true; return; }
  friend.place(spots.fx, spots.y);
  if (where === "grass") {
    pet.show(await petStrip(ballKept ? "keep-ball" : "sit"));
    pet.face(side === "right");
    pet.place(spots.px, spots.y);
    pet.el.style.opacity = "1";
  }
  if (ball) {
    ball.hidden = ballAt === null;
    if (ballAt !== null) placeBall(ballAt, spots.y);
  }
  padUnderPair();
}

function placeBall(x: number, y: number): void {
  if (!ball) return;
  const s = 4 * scenePx(); // the fetch ball's art is 4 px; --pet-ball scales to the box
  ball.style.setProperty("--fw", `${s}px`);
  ball.style.transform = `translate(${Math.round(x - s / 2)}px, ${Math.round(y - s)}px)`;
}

function say(words: string): Promise<void> {
  if (!floor || !friend?.strip) return Promise.resolve();
  bubble?.remove();
  bubble = document.createElement("div");
  bubble.className = "scene__bubble";
  bubble.textContent = words;
  const h = friend.strip.fh * friend.px;
  bubble.style.top = `${Math.round(friend.y - h)}px`;
  floor.append(bubble);
  // Centered over his head, but kept inside the window: at rest he stands by its left edge, and
  // a centered bubble lost its left half there (2026-10-21). The tail still points at his head.
  const w = bubble.offsetWidth;
  const edge = 4 * friend.px;
  const left = Math.max(edge, Math.min(floor.clientWidth - w - edge, friend.x - w / 2));
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.setProperty("--tail-x", `${Math.round(friend.x - left)}px`);
  diag.log("pet:say", { words });
  const hold = (parseFloat(getComputedStyle(root).getPropertyValue("--bubble-hold-dur")) || 1.6) * 1000;
  const mine = bubble;
  return wait(hold).then(() => mine.remove());
}

/** One round of fetch. Returns early (quietly) when something newer interrupts it. */
async function round(): Promise<void> {
  if (!floor || !pet || !friend || !ball || where !== "grass" || side !== "left" || calm() || !seen()) return;
  const mine = ++gen;
  const live = () => mine === gen && where === "grass" && active();
  const spots = restSpots();
  if (!spots) return;
  const px = scenePx();
  const speed = (RUN_SPEED * px) / 2;
  const f = sceneFloor()!;
  diag.log("pet:round", { ballAt, kept: ballKept });

  // A ball he kept: he drops it at Deets' feet first.
  if (ballKept) {
    ballKept = false;
    pet.show(await petStrip("drop-ball"), PUSH_FPS, false);
    await wait(400);
    if (!live()) return;
  }

  let target = ballAt;
  if (target === null) {
    // Deets throws to the right: a random spot along the grass, past the pair.
    friend.face(true);
    friend.show(await friendStrip("throw"), 8, false);
    await wait(250);
    if (!live()) return;
    target = Math.round(rand(spots.px + 120 * px / 2, Math.max(spots.px + 160, f.w * 0.6)));
    const fh = friend.strip ? friend.strip.fh * px : 64 * px;
    const start = { x: friend.x + 10 * px / 2, y: friend.y - fh * 0.8 };
    ball.hidden = false;
    placeBall(start.x, start.y);
    const s = 4 * px;
    const peak = Math.min(start.y, spots.y) - 60 * px / 2;
    const fly = ball.animate(
      [
        { transform: `translate(${start.x - s / 2}px, ${start.y - s}px)` },
        { transform: `translate(${(start.x + target) / 2 - s / 2}px, ${peak - s}px)`, offset: 0.45 },
        { transform: `translate(${target - s / 2}px, ${spots.y - s}px)` },
      ],
      { duration: 800, easing: "linear" },
    );
    // the pet sets off as it flies
    pet.face(true);
    pet.show(await petStrip("run"), RUN_FPS);
    const run = pet.to(target - 14 * px / 2, spots.y, (Math.abs(target - pet.x) / speed) * 1000);
    await fly.finished.catch(() => {});
    placeBall(target, spots.y);
    friend.show(await friendStrip("watch"), 2);
    ballAt = target;
    if (!live()) return;
    await run;
  } else {
    // a ball still out there from last time: go and get it
    friend.show(await friendStrip("watch"), 2);
    pet.face(target > pet.x);
    pet.show(await petStrip("run"), RUN_FPS);
    await pet.to(target - 14 * px / 2, spots.y, (Math.abs(target - pet.x) / speed) * 1000);
  }
  if (!live()) return;

  const r = Math.random();
  const end = r < ODDS.good ? "good" : r < ODDS.good + ODDS.without ? "without" : "keep";
  if (end !== "without") {
    ball.hidden = true;
    ballAt = null;
    carrying = true;
  }
  pet.face(false);
  pet.show(await petStrip(end === "without" ? "run" : "run-ball"), RUN_FPS);
  await pet.to(spots.px, spots.y, (Math.abs(pet.x - spots.px) / speed) * 1000);
  if (!live()) return;
  friend.face(false);
  carrying = false;
  if (end === "good") {
    pet.show(await petStrip("drop-ball"), PUSH_FPS, false);
    await wait(380);
    if (!live()) return;
    pet.show(await petStrip("sit"));
    friend.show(await friendStrip("idle"));
    await say(WORDS.good);
  } else if (end === "keep") {
    ballKept = true;
    pet.show(await petStrip("keep-ball"), 2);
    friend.show(await friendStrip("idle"));
    await say(WORDS.gundu);
  } else {
    pet.show(await petStrip("sit"));
    friend.show(await friendStrip("idle"));
    await say(WORDS.gundu);
  }
  diag.log("pet:round-end", { end });
}

function scheduleRound(ms: number): void {
  window.clearTimeout(roundTimer);
  if (!active()) return;
  roundTimer = window.setTimeout(async () => {
    // a hidden window or a held background skips its turn, as the site's strolls do
    if (seen() && !calm() && where === "grass" && side === "left") await round().catch((e) => diag.warn("pet:round", String(e)));
    scheduleRound(rand(...NEXT_ROUND_MS));
  }, ms);
}

// ---- the cover change ---------------------------------------------------------------------
// The rope went out at his word (2026-10-21); with two left, the never-twice rule alternates them.
const PUSHES = ["head", "stand"] as const;
type Push = (typeof PUSHES)[number];
const pickPush = (): Push => {
  const options = PUSHES.filter((p) => p !== lastPush);
  const p = options[Math.floor(Math.random() * options.length)];
  lastPush = p;
  return p;
};

/** The pet leaves the grass for a cover change: drops a carried ball, dashes to the nearer edge. */
async function leaveGrass(): Promise<void> {
  if (!pet || where !== "grass") return;
  gen++; // a round in flight stops where it is
  where = "away";
  const f = sceneFloor();
  bubble?.remove();
  if ((carrying || ballKept) && f) {
    // he carried it: it stays on the grass where he was
    ballAt = Math.round(pet.x);
    ballKept = false;
    carrying = false;
    if (ball) { ball.hidden = false; placeBall(ballAt, f.y); }
  }
  if (friend && !friend.el.hidden) friend.show(await friendStrip("watch"), 2); // only once he is placed
  // Mid-run he keeps going the way he was running: a turn on the spot read as a jerk. From rest
  // he sets off toward the nearer edge. His stride keeps pace with the dash, so his feet never slide.
  if (!pet.strip || pet.el.hidden) return; // never placed on the grass: nothing to dash from
  const toLeft = pet.moving ? !pet.right : !f || pet.x < f.w / 2;
  const dist = DASH_PX * pet.px;
  pet.face(!toLeft);
  pet.show(await petStrip("run"), strideFps(dist, DASH_MS, pet.px));
  void pet.fade(0, DASH_MS);
  await pet.to(toLeft ? pet.x - dist : pet.x + dist, pet.y, DASH_MS, "ease-in");
  pet.el.hidden = true;
}

/** The run strip's frame rate for a run of `dist` px over `ms` at art scale `px`: the stride
    keeps pace with the ground, as RUN_FPS does at RUN_SPEED. */
function strideFps(dist: number, ms: number, px: number): number {
  const speed = dist / Math.max(1, ms / 1000);
  return Math.max(6, Math.min(24, (RUN_FPS * speed) / ((RUN_SPEED * px) / 2)));
}

/** Back from the cover: in from the near edge (the pair's side) to his place beside Deets. */
async function backToGrass(): Promise<void> {
  if (!pet || !active()) return;
  const spots = restSpots();
  where = "grass";
  if (!spots) return;
  const px = scenePx();
  const fromX = side === "right" ? (sceneFloor()?.w ?? 0) + 20 * px : -20 * px;
  pet.px = px;
  pet.face(side === "left");
  pet.show(await petStrip("run"), RUN_FPS);
  pet.el.style.opacity = "1";
  pet.place(fromX, spots.y);
  await pet.to(spots.px, spots.y, (Math.abs(spots.px - fromX) / ((RUN_SPEED * px) / 2)) * 1000);
  if (where !== "grass") return;
  pet.face(side === "right");
  pet.show(await petStrip("sit"));
  friend?.show(await friendStrip("idle"));
  padUnderPair();
}

/** The grand opening's card opened or closed (GRAND-OPENING.md §6): the pair run to the other
 *  corner, Deets in his walk at a run's pace, Happy in his run. A round in flight stops; a ball
 *  in Happy's mouth stays there (he keeps it, and drops it at the next round). Happy away at
 *  the cover comes back to the new side by himself. Calm: they are placed there at once. */
async function crossTo(to: "left" | "right"): Promise<void> {
  if (side === to) return;
  side = to;
  if (!floor || !pet || !friend || !active()) return;
  const mine = ++gen;
  bubble?.remove();
  if (carrying) { carrying = false; ballKept = true; }
  const spots = restSpots();
  if (!spots || calm() || friend.el.hidden) return void rest();
  diag.log("pet:cross", { to });
  const px = scenePx();
  const speed = (RUN_SPEED * px) / 2;
  const right = to === "right";
  const legs: Promise<void>[] = [];
  const fDist = Math.abs(spots.fx - friend.x);
  const fMs = (fDist / speed) * 1000;
  friend.show(await friendStrip("walk"), strideFps(fDist, fMs, px));
  friend.face(right);
  legs.push(friend.to(spots.fx, spots.y, fMs));
  if (where === "grass" && pet.strip && !pet.el.hidden) {
    const pDist = Math.abs(spots.px - pet.x);
    const pMs = (pDist / speed) * 1000;
    pet.show(await petStrip(ballKept ? "run-ball" : "run"), strideFps(pDist, pMs, px));
    pet.face(right);
    legs.push(pet.to(spots.px, spots.y, pMs));
  }
  await Promise.all(legs);
  if (mine !== gen) return;
  await rest();
}

function endAtCover(): void {
  if (!atCover) return;
  window.clearTimeout(atCover.timer);
  atCover.layer.remove();
  atCover = null;
}

async function onTurn(e: Event): Promise<void> {
  const box = e.target as HTMLElement;
  if (!active() || !(box instanceof HTMLElement) || !box.classList.contains("np__art")) return;
  const turn = box.dataset.turn;
  if (turn !== "fwd" && turn !== "back") return;
  const cs = getComputedStyle(box);
  if (cs.getPropertyValue("--cover-swap").trim() !== "pet") return;
  const panel = box.closest<HTMLElement>(".panel");
  const cover = box.getBoundingClientRect();
  const small = cover.height < 96 || !panel || calm();
  const back = turn === "back";
  const kind = small ? null : pickPush();
  const fromGrass = where === "grass";
  // His run-in before the cover moves: longer for the stand (he rises first), and longer again
  // when he comes from the grass, where he must be gone before he shows here (his call H7 a).
  const lead = !kind ? 0 : (kind === "stand" ? STAND_LEAD_MS : PUSH_LEAD_MS) + (fromGrass ? DASH_MS : 0);
  // The slide's shape for this change. Set before any await: vinyl.ts reads it as soon as the
  // new cover decodes, and the first wait for a strip (a first load) once came after that.
  // --vinyl-x stays -1: vinyl.ts flips the slide for Back itself, so the old cover leaves to the
  // left on Next and to the right on Back. Set to 1 for Back it cancelled that flip, and the
  // cover went left while Happy pushed right (2026-10-21).
  box.style.setProperty("--vinyl-x", "-1");
  box.style.setProperty("--vinyl-y", "0");
  box.style.setProperty("--vinyl-swap-delay", `${lead}ms`);
  box.style.setProperty("--vinyl-swap-dur", `${PUSH_MS}ms`);
  box.style.setProperty("--vinyl-swap-in-travel", small ? "1" : "0");
  if (!kind || !panel) return;
  // the leaving cover (vinyl.ts marks it before it announces the turn): Happy moves with it
  const old = box.querySelector<HTMLElement>(".vinyl--out");

  if (fromGrass) void leaveGrass();
  where = "cover";
  diag.log("pet:push", { kind, back, fromGrass, again: !!atCover });
  // Happy at about a third of the cover's height, in whole device pixels (his call H1 a)
  const dpr = window.devicePixelRatio || 1;
  const sit = await petStrip("sit");
  const artH = sit?.fh ?? 32;
  const s = Math.max(1, Math.floor((cover.height / 3 / artH) * dpr)) / dpr;

  // his layer in the card, over the cover
  const p = panel.getBoundingClientRect();
  const C = { left: cover.left - p.left, right: cover.right - p.left, top: cover.top - p.top, bottom: cover.bottom - p.top, w: cover.width };
  let at = atCover;
  if (!at || at.panel !== panel) {
    endAtCover();
    const layer = document.createElement("div");
    layer.className = "pet-push";
    panel.append(layer);
    at = atCover = { panel, layer, actor: new Actor(layer, "pet-push__dog"), until: 0, timer: 0, onstage: false };
    at.actor.el.style.opacity = "0";
  }
  window.clearTimeout(at.timer);
  const dog = at.actor;
  dog.px = s;
  const mineGen = ++gen;
  const live = () => mineGen === gen && atCover === at;
  // He is never cut by the card's edge: he may hang over it, as long as part of him is on the
  // card (his call, 2026-10-21). He comes and goes from behind the cover: only then does the
  // cover's box hide him (`behindCover`), and it is set or cleared only while no part of him is
  // over the cover, so nothing pops.
  const behindCover = (on: boolean) => {
    at!.layer.style.clipPath = on
      ? `path(evenodd, "M${-p.width} ${-p.height}H${2 * p.width}V${2 * p.height}H${-p.width}Z M${C.left} ${C.top}H${C.right}V${C.bottom}H${C.left}Z")`
      : "";
  };
  // Mirror for Back: everything runs the other way. He pushes from the cover's trailing side.
  const dir = back ? 1 : -1; // the cover's travel along x
  const trailEdge = back ? C.left : C.right;
  const travelK = (parseFloat(cs.getPropertyValue("--vinyl-swap-travel")) || 110) / 100;
  const travel = C.w * travelK * dir;
  const fw = artH * s;
  const y = C.bottom;
  const runSpeed = (RUN_SPEED * s) / 2;

  /** Run to `x` over `ms`, from `from` (a fresh start) or from where he is, his stride in pace. */
  const runTo = async (from: number | null, x: number, ms: number) => {
    const run = await petStrip("run");
    const sx = from ?? dog.x;
    dog.show(run, strideFps(Math.abs(x - sx), ms, s));
    if (from !== null) dog.place(from, y);
    dog.face(x > sx);
    dog.el.style.opacity = "1";
    await dog.to(x, y, ms);
  };

  /** Each frame, `frame(dx)` with the leaving cover's offset now, until it has gone. */
  const withCover = (frame: (dx: number) => void) =>
    new Promise<void>((done) => {
      const t0 = performance.now();
      const step = () => {
        if (!live()) return done();
        const gone = !old || !old.isConnected || performance.now() - t0 > lead + PUSH_MS + 1500; // a guard: it never started
        if (gone) { frame(travel); return done(); }
        const t = getComputedStyle(old).transform;
        frame(t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0);
        requestAnimationFrame(step);
      };
      step();
    });

  // The spots, along the cover's travel: just clear of the cover's edge on each side.
  const hidden = (edge: number, side: 1 | -1) => edge - side * fw * 0.55; // fully behind the cover
  const clearOf = (edge: number, side: 1 | -1) => edge + side * fw * 0.5; // touching it, outside

  // 1. Out from behind the cover, always on the move. A fast press: from where he is.
  const side = -dir as 1 | -1; // the trailing side
  const spot = clearOf(trailEdge, side);
  const runIn = Math.max(120, lead - (kind === "stand" ? (1000 / STAND_UP_FPS) * 3 : 100) - (fromGrass ? DASH_MS : 0) - 20);
  if (at.onstage) {
    behindCover(false);
    await runTo(null, spot, runIn);
  } else {
    if (fromGrass) await wait(DASH_MS); // the grass Happy has gone by now: never two at once
    if (!live()) return;
    behindCover(true);
    at.onstage = true;
    await runTo(hidden(trailEdge, side), spot, runIn);
    behindCover(false); // he is clear of the cover now
  }
  if (!live()) return;
  dog.face(back); // the art faces left: a Back push runs right

  // 2. The push, in step with the cover: vinyl.ts starts the slide when the new cover has
  //    decoded, so Happy reads where the old cover is each frame instead of keeping his own time.
  if (kind === "head") {
    // his head against the cover's edge, then he pushes it out
    const start = trailEdge - dir * fw * 0.35;
    dog.show(await petStrip("push-head"), PUSH_FPS);
    await dog.to(start, y, 100);
    if (!live()) return;
    await withCover((dx) => dog.place(start + dx, y));
  } else {
    // up on his hind legs, then he walks the cover out with his front paws on its edge (his ask,
    // 2026-10-21: before, he stood still while it went). The strips put the paws' tip 16 art px
    // ahead of his middle, so at `spot` they touch the edge.
    dog.show(await petStrip("stand-up"), STAND_UP_FPS, false);
    await wait((1000 / STAND_UP_FPS) * 3);
    if (!live()) return;
    const start = dog.x;
    dog.show(await petStrip("stand-push"), PUSH_FPS);
    await withCover((dx) => dog.place(start + dx, y));
  }
  if (!live()) return;

  dog.show(await petStrip("sit"));
  // he waits by the cover; another change in this time pushes again from here
  at.until = performance.now() + SIT_BY_COVER_MS;
  at.timer = window.setTimeout(async () => {
    if (!live()) return;
    // he runs a little way toward the nearer edge of the card and fades as he goes, so he never
    // stands off the card
    const out = dog.x + (dog.x < p.width / 2 ? -1 : 1) * fw * 0.8;
    const ms = (fw * 0.8 / runSpeed) * 1000;
    void dog.fade(0, ms);
    await runTo(null, out, ms);
    if (!live()) return;
    at.onstage = false;
    endAtCover();
    await backToGrass();
  }, SIT_BY_COVER_MS);
}

// ---- on and off ---------------------------------------------------------------------------
function enter(): void {
  if (!floor) return;
  floor.replaceChildren();
  friend = new Actor(floor, "scene__friend");
  pet = new Actor(floor, "scene__pet");
  ball = document.createElement("div");
  ball.className = "scene__ball";
  ball.hidden = true;
  floor.append(ball);
  where = "grass";
  ballAt = null;
  ballKept = false;
  side = root.dataset.onboarding === "open" ? "right" : "left"; // a skin change while the card is open
  void rest();
  scheduleRound(FIRST_ROUND_MS);
  diag.log("pet:on", { firstRoundMs: FIRST_ROUND_MS });
}

function leave(): void {
  gen++;
  window.clearTimeout(roundTimer);
  endAtCover();
  for (const [el, was] of padded) el.style.paddingBottom = was;
  padded.clear();
  floor?.replaceChildren();
  pet = friend = null;
  ball = bubble = null;
  document.querySelectorAll<HTMLElement>(".np__art").forEach((b) =>
    ["--vinyl-x", "--vinyl-y", "--vinyl-swap-delay", "--vinyl-swap-dur", "--vinyl-swap-in-travel"].forEach((p) => b.style.removeProperty(p)),
  );
  diag.log("pet:off");
}

export function initPet(): void {
  floor = document.querySelector<HTMLElement>(".scene__floor");
  if (!floor) return;
  let on = active();
  if (on) enter();
  onSkinChange(() => {
    const now = active();
    if (now && !on) enter();
    else if (!now && on) leave();
    on = now;
  });
  // the scene re-placed itself (a resize, a surface, a card swap): the pair follows
  onScenePlace(() => {
    if (!active() || !pet) return;
    if (where === "grass") { gen++; void rest(); } else void rest();
  });
  document.addEventListener("vinyl:turn", (e) => void onTurn(e).catch((err) => diag.warn("pet:push", String(err))));
  window.addEventListener("deets:onboarding", (e) => {
    const open = (e as CustomEvent<{ open: boolean }>).detail?.open;
    void crossTo(open ? "right" : "left").catch((err) => diag.warn("pet:cross", String(err)));
  });
}

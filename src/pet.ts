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
//     the grass, moves the cover one of three ways (never the same twice in a row), sits by it,
//     and comes back. Only one pet ever shows (his call H7 a). Fast presses keep him at the cover.
// Reduced motion, a hidden window and "Animate backgrounds" off hold everything at rest.

import * as diag from "./diag";
import { hook, onSkinChange } from "./skin";
import { motionReduced } from "./motion";
import { sceneFloor, scenePx, onScenePlace, urlOf, pictureSize } from "./scene";

type PetPose = "sit" | "idle" | "walk" | "run" | "push-head" | "stand-up" | "stand-push" | "run-ball" | "drop-ball" | "keep-ball";
type FriendPose = "idle" | "throw" | "watch";
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
const WALK_FPS = 7; // the art's own cycle (the site and the game)
const RUN_FPS = 10;
const PUSH_FPS = 8;
const RUN_SPEED = 140; // CSS px a second at 2×, scaled with the art
const ODDS = { good: 0.7, without: 0.15 }; // the rest: he keeps it
const WORDS = { good: "Good boy!", gundu: "Gundu..." }; // his words (§1.5); the skin's, never a mod's
const PUSH_LEAD_MS = 300; // the slide waits this long for the pet (the cover moves within 0.3 s)
const PUSH_MS = 700; // the slide itself
const SIT_BY_COVER_MS = 1500; // another change in this time: he stays and pushes again
const DASH_MS = 150; // off the grass, toward the nearer edge

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
  let s: Strip | null = null;
  if (w && h) {
    const fwArt = parseFloat(cs.getPropertyValue(`${token}-w`)) || h;
    const blank = await isBlank(url, w, h);
    s = blank ? null : { url, fw: fwArt, fh: h, frames: Math.max(1, Math.round(w / fwArt)) };
  }
  strips.set(key, s);
  return s;
}

/** A strip with nothing drawn on it (a blank template copied in by happy:art). */
function isBlank(url: string, w: number, h: number): Promise<boolean> {
  return new Promise((done) => {
    const img = new Image();
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
    s.animation = strip.frames > 1 && fps > 0
      ? `scene-frames ${(strip.frames / fps).toFixed(3)}s steps(${strip.frames}) ${loop ? "infinite" : "1 forwards"}`
      : "none";
    s.transform = this.transform();
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
let atCover: { panel: HTMLElement; layer: HTMLElement; actor: Actor; rope: HTMLElement; until: number; timer: number } | null = null;
const padded = new Map<HTMLElement, string>();

function restSpots(): { fx: number; px: number; y: number } | null {
  const f = sceneFloor();
  if (!f || !friend?.strip) return null;
  const fw = friend.strip.fw * friend.px;
  const fx = 6 * friend.px + fw / 2; // a little in from the corner
  const pw = (pet?.strip?.fw ?? 32) * friend.px;
  return { fx, px: fx + fw / 2 + pw / 2, y: f.y };
}

/** The card under the pair gets end padding the height of the pair (happy.md §2.1a). */
function padUnderPair(): void {
  for (const [el, was] of padded) el.style.paddingBottom = was;
  padded.clear();
  if (!floor || !friend?.strip || !active()) return;
  const f = friend.el.getBoundingClientRect();
  const p = pet && !pet.el.hidden ? pet.el.getBoundingClientRect() : f;
  const box = { left: Math.min(f.left, p.left), right: Math.max(f.right, p.right), top: Math.min(f.top, p.top) };
  document.querySelectorAll<HTMLElement>(".bento .app-scroll").forEach((el) => {
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
  if (!spots) return;
  friend.place(spots.fx, spots.y);
  if (where === "grass") {
    pet.show(await petStrip(ballKept ? "keep-ball" : "sit"));
    pet.face(false);
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
  bubble.style.left = `${Math.round(friend.x)}px`;
  bubble.style.top = `${Math.round(friend.y - h)}px`;
  floor.append(bubble);
  diag.log("pet:say", { words });
  const hold = (parseFloat(getComputedStyle(root).getPropertyValue("--bubble-hold-dur")) || 1.6) * 1000;
  const mine = bubble;
  return wait(hold).then(() => mine.remove());
}

/** One round of fetch. Returns early (quietly) when something newer interrupts it. */
async function round(): Promise<void> {
  if (!floor || !pet || !friend || !ball || where !== "grass" || calm() || !seen()) return;
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
    if (seen() && !calm() && where === "grass") await round().catch((e) => diag.warn("pet:round", String(e)));
    scheduleRound(rand(...NEXT_ROUND_MS));
  }, ms);
}

// ---- the cover change ---------------------------------------------------------------------
const PUSHES = ["head", "rope", "stand"] as const;
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
  friend?.show(await friendStrip("watch"), 2);
  const toLeft = !f || pet.x < f.w / 2;
  pet.face(!toLeft);
  pet.show(await petStrip("run"), RUN_FPS);
  void pet.fade(0, DASH_MS);
  await pet.to(toLeft ? pet.x - 60 : pet.x + 60, pet.y, DASH_MS);
  pet.el.hidden = true;
}

/** Back from the cover: in from the left edge to his place beside Deets. */
async function backToGrass(): Promise<void> {
  if (!pet || !active()) return;
  const spots = restSpots();
  where = "grass";
  if (!spots) return;
  const px = scenePx();
  pet.px = px;
  pet.face(true);
  pet.show(await petStrip("run"), RUN_FPS);
  pet.el.style.opacity = "1";
  pet.place(-20 * px, spots.y);
  await pet.to(spots.px, spots.y, ((spots.px + 20 * px) / ((RUN_SPEED * px) / 2)) * 1000);
  if (where !== "grass") return;
  pet.face(false);
  pet.show(await petStrip("sit"));
  friend?.show(await friendStrip("idle"));
  padUnderPair();
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
  // Happy at about a third of the cover's height, in whole device pixels (his call H1 a)
  const dpr = window.devicePixelRatio || 1;
  const sit = await petStrip("sit");
  const artH = sit?.fh ?? 32;
  const s = Math.max(1, Math.floor((cover.height / 3 / artH) * dpr)) / dpr;
  const small = cover.height < 96 || !panel || calm();
  const back = turn === "back";
  // the slide's shape for this change (vinyl.ts reads these before it moves the covers)
  box.style.setProperty("--vinyl-x", back ? "1" : "-1");
  box.style.setProperty("--vinyl-y", "0");
  box.style.setProperty("--vinyl-swap-delay", small ? "0ms" : `${PUSH_LEAD_MS}ms`);
  box.style.setProperty("--vinyl-swap-dur", `${PUSH_MS}ms`);
  box.style.setProperty("--vinyl-swap-in-travel", small ? "1" : "0");
  if (small || !panel) return;

  const fromGrass = where === "grass";
  if (fromGrass) void leaveGrass();
  where = "cover";
  const kind = pickPush();
  diag.log("pet:push", { kind, back, fromGrass, again: !!atCover });

  // his layer in the card, over the cover
  const p = panel.getBoundingClientRect();
  const C = { left: cover.left - p.left, right: cover.right - p.left, top: cover.top - p.top, bottom: cover.bottom - p.top, w: cover.width };
  let at = atCover;
  if (!at || at.panel !== panel) {
    endAtCover();
    const layer = document.createElement("div");
    layer.className = "pet-push";
    panel.append(layer);
    const rope = document.createElement("div");
    rope.className = "scene__rope";
    rope.hidden = true;
    layer.append(rope);
    at = atCover = { panel, layer, actor: new Actor(layer, "pet-push__dog"), rope, until: 0, timer: 0 };
    at.actor.el.style.opacity = "0";
  }
  window.clearTimeout(at.timer);
  const dog = at.actor;
  dog.px = s;
  const mineGen = ++gen;
  const live = () => mineGen === gen && atCover === at;
  // Mirror for Back: everything runs the other way. `lead` is the side the cover leaves by.
  const dir = back ? 1 : -1; // the cover's travel along x
  const leadEdge = back ? C.right : C.left;
  const trailEdge = back ? C.left : C.right;
  const travel = C.w * 1.1 * dir;
  const fw = (artH) * s;
  const y = C.bottom;
  const wasShowing = dog.el.style.opacity === "1";
  const appear = async (x: number) => {
    if (wasShowing) {
      // already by the cover (a fast press): he trots to where this push starts
      await dog.to(x, y, PUSH_LEAD_MS - 20);
      return;
    }
    dog.place(x, y);
    {
      // the pet from the grass has gone by now (DASH_MS < PUSH_LEAD_MS): never two at once
      await wait(fromGrass ? DASH_MS : 0);
      if (!live()) return;
      await dog.fade(1, PUSH_LEAD_MS - (fromGrass ? DASH_MS : 0) - 20);
    }
  };
  dog.face(back); // the art faces left: a Back push runs right

  if (kind === "head") {
    dog.show(await petStrip("push-head"), PUSH_FPS);
    await appear(trailEdge - dir * fw * 0.35);
    if (!live()) return;
    await dog.to(trailEdge + travel - dir * fw * 0.35, y, PUSH_MS, "ease-in-out");
  } else if (kind === "rope") {
    const L = C.w * 0.25;
    dog.show(await petStrip("run"), RUN_FPS);
    await appear(leadEdge + dir * L);
    if (!live()) return;
    const rope = at.rope;
    const mouthY = y - (sit?.fh ?? 32) * s * 0.55;
    const ropeAt = (dx: number) => {
      const x1 = leadEdge + dx;
      const x2 = dog.x - dir * fw * 0.4;
      rope.style.width = `${Math.abs(x2 - x1)}px`;
      rope.style.transform = `translate(${Math.min(x1, x2)}px, ${mouthY}px)`;
    };
    rope.hidden = false;
    ropeAt(0);
    const t0 = performance.now();
    const follow = () => {
      if (!live() || rope.hidden) return;
      const k = Math.min(1, (performance.now() - t0) / PUSH_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease-in-out, as the slide
      ropeAt(travel * e);
      if (k < 1) requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
    await dog.to(leadEdge + dir * L + travel, y, PUSH_MS, "ease-in-out");
    rope.hidden = true;
    if (!live()) return;
    // he trots back in to sit by the cover
    dog.face(!back);
    dog.show(await petStrip("walk"), WALK_FPS);
    await dog.to(leadEdge + dir * fw * 0.6, y, 420);
  } else {
    dog.show(await petStrip("stand-up"), PUSH_FPS, false);
    await appear(trailEdge - dir * fw * 0.1);
    if (!live()) return;
    dog.show(await petStrip("stand-push"), PUSH_FPS);
    await wait(PUSH_MS);
  }
  if (!live()) return;
  dog.show(await petStrip("sit"));
  // he waits by the cover; another change in this time pushes again from here
  at.until = performance.now() + SIT_BY_COVER_MS;
  at.timer = window.setTimeout(async () => {
    if (!live()) return;
    await dog.fade(0, 200); // back behind the cover
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
}

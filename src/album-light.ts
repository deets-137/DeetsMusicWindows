// The album light on the card edges (ALBUM-COLOR.md § The album light). A skin opts in with
// --hook-light, whose value names its slider (Press, Cyber). This module follows the song and
// sets the neon roles (album-neon.ts); the skin's tokens turn them into its edges. Bolts read
// the roles at their own loop seam (storm.ts).
//
// The wave: a new album's color turns in around each card, clockwise from 12 o'clock, a pinwheel
// on every card at once. CSS cannot wipe a color along a border, so the Cyber bolts' method does
// it (styles.css § Storm): a copy of a card's edges in the NEW color sits in a box that turns and
// clips it, and an inner box turns the other way, so the copy stays still. One box covers half a
// circle, so each card has two, one per half. Only `transform` moves, so nothing repaints in
// the motion. At the end the real cards take the roles and the copies go, in one frame.
//
// No wave at launch, on a theme or skin change, on a slider drag, with Reduce motion, or with
// the window hidden. A card in motion has no fixed box to copy, so the color then changes at
// once, and a card that starts moving during a wave ends the wave.

import { hook } from "./skin";
import { setting, onSettingsChange } from "./settings-store";
import { lookupPalette, playerCovers, type CoverSource } from "./album-color";
import { albumNeon, type Neon } from "./album-slots";
import { groundIsDark, setNeon } from "./album-neon";
import { stormTakeAlbum } from "./storm";
import { motionReduced } from "./motion";
import { mark } from "./marks";
import { during } from "./frames";
import * as diag from "./diag";

const LIGHT_KEYS = ["pressLight", "cyberLight"] as const;
type LightKey = (typeof LIGHT_KEYS)[number];

const root = document.documentElement;
/** What moves a card's box. Rows and the record inside a card do not. */
const MOVERS = ".panel, .stage, .grow-shell, .grow-shell__clip, .grow-shell__edge";
/** The transitions that move a box. A theme fade changes colors only, so it leaves a wave running. */
const BOX_PROPS = new Set(["transform", "translate", "scale", "rotate", "opacity", "left", "top", "width", "height"]);
/** Classes that change a card's inside and leave its box where it is: a drill, the grow's rows. */
const INSIDE_ONLY = new Set(["is-drill-swap", "is-grow-rows"]);
/** A wave's end is its own animation; this is the guard if the window throttles it. */
const END_SLACK_MS = 400;

/** The slider that lights `el`'s skin, or null when the skin has none. */
function lightKey(el: HTMLElement): LightKey | null {
  const v = getComputedStyle(el).getPropertyValue("--hook-light").trim();
  return (LIGHT_KEYS as readonly string[]).includes(v) ? (v as LightKey) : null;
}

/** A slider drag's value, until the store has it (the row's preview). */
let dragged: number | null = null;
const level = (k: LightKey) => dragged ?? setting(k);

// ── the wave ────────────────────────────────────────────────────────────────────
interface Wave {
  host: HTMLElement;
  neon: Neon;
  bento: HTMLElement;
  timer: number;
  t0: number;
  cards: number;
  /** A newer album's color, shown when this wave ends. Rapid Next keeps only the last. */
  next: Neon | null;
  /** Takes off what watches the cards. */
  unwatch: () => void;
}
let wave: Wave | null = null;

/** End the running wave: the real cards take its color and the copies go, in one frame. */
function endWave(why: string): void {
  const w = wave;
  if (!w) return;
  wave = null;
  clearTimeout(w.timer);
  w.unwatch();
  // A wave that ran its course hands over to the album that came during it; one cut short takes
  // the newest color at once.
  const last = w.next ?? w.neon;
  const queued = why === "done" && w.next;
  setNeon(root, queued ? w.neon : last);
  stormTakeAlbum();
  w.host.remove();
  mark("albumLight:wave:end", why);
  diag.log("albumLight:wave", { why, cards: w.cards, ms: Math.round(performance.now() - w.t0) });
  if (queued && !startWave(queued)) {
    setNeon(root, queued);
    stormTakeAlbum();
  }
}

/** One pinwheel over `from`'s edges: two halves, each with its own copy of them. The center sits
 *  on a whole device pixel, so the seam between the halves stays clean. Returns the half that ends last. */
function addWheel(host: HTMLElement, from: HTMLElement, kind: string, ox: number, oy: number, pad: number): HTMLElement {
  const r = from.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1; // a whole device pixel, so also at 125 % and 150 %
  const cx = Math.round((r.left + r.width / 2) * dpr) / dpr;
  const cy = Math.round((r.top + r.height / 2) * dpr) / dpr;
  const wheel = document.createElement("div");
  wheel.className = "album-wave__wheel";
  wheel.style.setProperty("--wheel-x", `${cx - ox}px`);
  wheel.style.setProperty("--wheel-y", `${cy - oy}px`);
  wheel.style.setProperty("--wheel-r", `${Math.ceil(Math.hypot(r.width, r.height) / 2 + pad + 2)}px`);
  wheel.style.setProperty("--edge-x", `${r.left - cx}px`);
  wheel.style.setProperty("--edge-y", `${r.top - cy}px`);
  wheel.style.setProperty("--edge-w", `${r.width}px`);
  wheel.style.setProperty("--edge-h", `${r.height}px`);
  let strike!: HTMLElement;
  for (const side of ["right", "left"]) {
    const half = document.createElement("div");
    half.className = `album-wave__half album-wave__half--${side}`;
    strike = document.createElement("div");
    strike.className = "album-wave__strike";
    const hold = document.createElement("div");
    hold.className = "album-wave__hold";
    const copy = document.createElement("div");
    copy.className = kind;
    hold.appendChild(copy);
    strike.appendChild(hold);
    half.appendChild(strike);
    wheel.appendChild(half);
  }
  host.appendChild(wheel);
  return strike;
}

/** Start the wave toward `neon`. False when there is nothing to turn it over. */
function startWave(neon: Neon): boolean {
  const bento = document.querySelector<HTMLElement>(".bento");
  if (!bento) return false;
  const moving = bento.getAnimations({ subtree: true }).some((a) => {
    const t = (a.effect as KeyframeEffect | null)?.target;
    return t instanceof Element && t.matches(MOVERS);
  });
  if (moving) {
    diag.log("albumLight:wave", { why: "moving" });
    return false;
  }

  const css = getComputedStyle(root);
  const pad = parseFloat(css.getPropertyValue("--grow-clip-pad")) || 0;
  const box = bento.getBoundingClientRect();
  const ox = box.left - pad;
  const oy = box.top - pad;

  const host = document.createElement("div");
  host.className = "album-wave";
  host.setAttribute("aria-hidden", "true");
  setNeon(host, neon);

  let cards = 0;
  let last: HTMLElement | null = null; // every wheel ends together; this one says so
  const shown = (el: HTMLElement) => {
    const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  // A grown card paints through its shell; its own box has no edge then.
  bento.querySelectorAll<HTMLElement>(".panel:not(.is-shelled), .grow-shell__edge").forEach((el) => {
    if (!shown(el)) return;
    last = addWheel(host, el, "album-wave__edge", ox, oy, pad);
    cards++;
  });
  if (!last) return false;
  const end: HTMLElement = last;
  bento.querySelectorAll<HTMLElement>(".vinyl__plate").forEach((el) => {
    if (shown(el) && getComputedStyle(el).boxShadow !== "none") addWheel(host, el, "album-wave__plate", ox, oy, pad);
  });

  // Anything that moves a card ends the wave, or the copies would stay at the old boxes. CSS
  // motion says so by an event. A grow and the full player run from script and fire none, but
  // they change a card's class or add one to the bento; a surface change resizes the bento.
  const moved = (e: Event) => {
    if (e instanceof TransitionEvent && !BOX_PROPS.has(e.propertyName)) return;
    if (e.target instanceof Element && e.target.matches(MOVERS)) endWave("moved");
  };
  const boxChange = (r: MutationRecord): boolean => {
    if (r.type === "childList") return [...r.addedNodes, ...r.removedNodes].some((n) => n !== host);
    if (r.attributeName !== "class") return true; // data-surface
    const was = new Set((r.oldValue ?? "").split(/\s+/).filter(Boolean));
    const now = new Set((r.target as Element).classList);
    return [...was, ...now].some((c) => was.has(c) !== now.has(c) && !INSIDE_ONLY.has(c));
  };
  const cardsChanged = new MutationObserver((records) => {
    if (records.some(boxChange)) endWave("moved");
  });
  let measured = false; // a ResizeObserver reports once when it starts
  const sized = new ResizeObserver(() => {
    if (measured) endWave("moved");
    measured = true;
  });
  const ms = parseFloat(css.getPropertyValue("--album-wave-dur")) * 1000 || 0;
  wave = {
    host,
    neon,
    bento,
    next: null,
    cards,
    unwatch: () => {
      bento.removeEventListener("animationstart", moved, true);
      bento.removeEventListener("transitionrun", moved, true);
      cardsChanged.disconnect();
      sized.disconnect();
    },
    t0: performance.now(),
    timer: window.setTimeout(() => endWave("late"), ms + END_SLACK_MS),
  };
  end.addEventListener("animationend", (e) => {
    if (e.target === end) endWave("done");
  });
  bento.addEventListener("animationstart", moved, true);
  bento.addEventListener("transitionrun", moved, true);
  bento.appendChild(host);
  cardsChanged.observe(bento, { childList: true });
  cardsChanged.observe(root, { attributes: true, attributeFilter: ["data-surface"] });
  sized.observe(bento);
  bento.querySelectorAll<HTMLElement>(".panel").forEach((el) => {
    cardsChanged.observe(el, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    sized.observe(el); // a card can change height with the bento's size unchanged
  });
  mark("albumLight:wave", `${cards} cards`);
  during("album-wave", ms, "album-wave");
  return true;
}

// ── following the song ──────────────────────────────────────────────────────────
const wakes = new Set<() => void>();

/** A slider drag on Album light: the first move above 0 starts the color, so the drag shows it. */
export function setCardLight(v: number): void {
  const crossed = dragged === null || v > 0 !== dragged > 0; // only on or off needs the color again
  dragged = v;
  if (crossed) wakes.forEach((f) => f());
}

/** Light `el`'s cards from `source`'s song: the page, or the grand opening's preview player. */
export function watchAlbumLight(el: HTMLElement, source: CoverSource = playerCovers): () => void {
  const page = el === root;
  let liveCover: string | null | undefined; // undefined: nothing asked yet
  let seen = false; // a cover has shown: the first one, at launch, takes its color with no wave
  let asked = 0; // the newest lookup; an older one's answer is stale, whatever its cover
  let pourNext = false; // a new album's turn is owed, across a wake that comes before its palette
  let shown: Neon | null = null;

  const show = (n: Neon | null, pour: boolean) => {
    if (n?.core === shown?.core && n?.second === shown?.second) {
      if (page && n) stormTakeAlbum(); // a skin change restarts the bolts with the same roles
      return;
    }
    const was = shown;
    shown = n;
    // The same song on a new ground (Live Theming changes the theme with the album): the wave
    // goes on, in the color for that ground.
    if (page && wave && n && !pour) {
      if (wave.next) wave.next = n;
      else {
        wave.neon = n;
        setNeon(wave.host, n);
      }
      return;
    }
    // A new album during a wave waits for it: cutting it short would pop the part not yet reached.
    if (page && wave && n) {
      wave.next = n;
      return;
    }
    if (page) endWave("next");
    const allowed = pour && page && !!n && setting("albumWave") && !motionReduced() && !document.hidden;
    if (allowed && startWave(n)) return;
    setNeon(el, n);
    if (page) stormTakeAlbum();
    if (!was !== !n) diag.log("albumLight:color", { on: !!n, page });
  };

  const follow = (force = false) => {
    const { cover, catalogId } = source.now();
    if (!force && cover === liveCover) return;
    pourNext ||= cover !== liveCover && seen;
    liveCover = cover;
    seen ||= !!cover;
    const mine = ++asked;
    const k = lightKey(el);
    if (!k || level(k) <= 0 || !cover) {
      pourNext = false;
      show(null, false);
      return;
    }
    lookupPalette(cover, catalogId)
      .then((p) => {
        if (mine !== asked) return; // a newer song, slider or look came meanwhile
        const pour = pourNext;
        pourNext = false;
        show(p ? albumNeon(p, groundIsDark(el)) : null, pour);
      })
      .catch((e) => diag.warn("albumLight:palette", { err: String(e) }));
  };

  const unsub = source.onChange(() => follow());
  const wake = () => follow(true);
  wakes.add(wake);
  const offSettings = onSettingsChange((k) => {
    if (!(LIGHT_KEYS as readonly string[]).includes(k)) return;
    dragged = null;
    wake();
  });
  // A theme or skin change moves the ground and may turn the light on or off. Deferred a frame
  // so the new tokens have resolved.
  const mo = new MutationObserver((records) => {
    // The copies were measured under the old skin, and its boxes are not the new one's.
    if (page && records.some((r) => r.attributeName === "data-skin")) {
      endWave("look");
      dragged = null;
    }
    requestAnimationFrame(wake);
  });
  mo.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });
  if (!page) mo.observe(el, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });
  follow();

  return () => {
    asked++;
    unsub();
    offSettings();
    wakes.delete(wake);
    mo.disconnect();
    if (page) endWave("off");
    setNeon(el, null);
  };
}

/** The page's own cards. A skin without --hook-light costs one comparison per player tick. */
export function initAlbumLight(): void {
  watchAlbumLight(root);
  diag.log("albumLight:watch", { hook: hook("light") });
}

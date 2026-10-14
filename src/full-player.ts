// The full player (features/fullscreen-player.md): Now Playing grows so the cover is as large as
// the window allows. Midi: over the Library and Queue cards, the rows over the cover on a dark
// band. Max: over the four content cards, the Queue takes the whole stage column. In both, the
// controls go under the cover when there is room or the card is wide, else over it on the band;
// never beside it (2026-10-11). Mini: not in the test version (§12.9: Mini's player view stays
// as it is until he says).
//
// It is not a grow: it changes the card's column (Max) and its inner layout, so it is its own
// module and borrows the grow's parts (the clip, the covered-card classes, the zones' look).
// One attribute carries the state: `data-player="full"` on <html>; every CSS rule hangs on it.
// The card wears `data-np-rows="over|below"` (below: the controls under the cover, 2026-10-11).
//
// Ways in: the edge strips on Now Playing (Midi top and bottom, Max left and right), Compass
// ("Full player"), a rule (the `player` action). Ways out: the close square over the cover, the
// same strips, Escape, a card request (Show queue, Show search, a Compass place), a surface
// change (no motion). A press on the Queue in Max keeps it open (his call, 2026-10-11).
//
// The motion (§9.4): the cover flies (a copy over everything, from the rest box to the full
// box; Press flies a still of the disc, §12.9 Q3), the card's clip opens, the Queue grows up
// over the old place in Max, and the rows and the band come in at --player-rows-at. The close
// is the reverse; the rows and the band go first. Reduced motion snaps.
//
// On for everyone since 2026-10-11 (his call); the DevTools flag of the test version is gone.

import { currentSurface, onSurfaceChange } from "./surface";
import { setting, onSettingsChange } from "./settings-store";
import { enterRows } from "./pop";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import * as diag from "./diag";
import { TELEMETRY } from "./telemetry-on";
import { registerAction, registerFact } from "./rules";
import { refreshPlayerState } from "./player";
import { setFullArtPx, stageArtPx } from "./queue-rows";
import { rowsPlace, fullArtPx, fullClipFrom, flightFrom, type Box, type RowsPlace } from "./full-player-layout";
import {
  clipBetween, clipOpen, clipPad, cover, uncover, collapseGrow, grownState, onGrowChange, refreshGrowZones, setPlayerHooks, stageGapShared, type Slot,
} from "./card-grow";

interface Opts {
  hosts: Record<Slot, HTMLElement | null>;
  /** The content slots of the live composition (the cards the player covers). */
  slots: () => Slot[];
  bento: HTMLElement;
  /** Mount the side column's card (`id`, History by default) and its title picker into the
   *  host; a pick calls `onPick` (layout.ts holds the registry and the picker). */
  mountSide?: (host: HTMLElement, id: string, onPick: (id: string) => void) => { destroy(): void };
}

let opts: Opts | null = null;
let full = false;
let busy = false; // a motion is on screen, or the open waits for the large cover
let gen = 0; // bumps on every open and close: a wait that comes back late knows it is stale
let artPx = 0; // the cover file size asked for while full (a 200 px bucket)
let watch: ResizeObserver | null = null;
let slideGen = 0; // bumps on every rows slide: only the newest one ends is-rows-sliding
const subs = new Set<(on: boolean) => void>();

const root = document.documentElement;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rect = (el: Element) => el.getBoundingClientRect();
const surfaceNow = (): "midi" | "max" | null => {
  const s = currentSurface();
  return s === "midi" || s === "max" ? s : null;
};

/** The full player is open. */
export const isFullPlayer = (): boolean => full;
/** Be told when it opens or closes. */
export function onFullPlayerChange(cb: (on: boolean) => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
/** It can open now: the window is Midi or Max. */
export const fullPlayerAvailable = (): boolean => !!opts && surfaceNow() !== null;

// ── the motion values (skin.css --player-*, a set per skin, §9.4.4) ─────────────
interface Motion {
  dur: number;
  ease: string;
  rowsAt: number;
  collapseDur: number;
}
function motion(): Motion | null {
  if (reduced()) return null;
  const dur = tokenMs("--player-dur");
  if (dur <= 0) return null;
  const cs = getComputedStyle(root);
  const ease = cs.getPropertyValue("--player-ease").trim() || "ease";
  const at = parseFloat(cs.getPropertyValue("--player-rows-at"));
  const rowsAt = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) * dur : dur;
  return { dur, ease, rowsAt, collapseDur: tokenMs("--player-collapse-dur") || dur };
}
const pxToken = (name: string): number => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;

// ── the parts ───────────────────────────────────────────────────────────────────
const npHost = (): HTMLElement | null => opts?.hosts.np ?? null;
const queueHost = (): HTMLElement | null => (currentSurface() === "max" ? opts?.hosts.queue ?? null : null);
const artOf = (panel: HTMLElement) => panel.querySelector<HTMLElement>(".np__art");
const npOf = (panel: HTMLElement) => panel.querySelector<HTMLElement>(".np");
/** The cards the player covers: every content slot of the composition. */
const coveredHosts = (): HTMLElement[] =>
  stack && surfaceNow() === "midi" ? [] : (opts?.slots() ?? []).map((s) => opts!.hosts[s]).filter((h): h is HTMLElement => !!h);

/** The room the History column takes from Now Playing now: its width and the panel gap. */
const historyRoom = (): number => (root.dataset.fpHistory === "on" && !stack ? pxToken("--full-history-w") + pxToken("--panel-gap") : 0);

/** The full player's layout now. */
interface Layout {
  place: RowsPlace;
  /** The side column shows (Max only, his calls 2026-10-11: when a --full-history-w column
   *  fits beside the cover without making it smaller, or always when stacked). */
  history: boolean;
  /** Stacked: the player across the top, the cards in the band under it. */
  stack: boolean;
  /** The player's height when stacked (--fp-stack-h). */
  stackH: number;
}

// ── stacked (a window taller than wide; his calls, 2026-10-11) ──────────────────
let stack = false;
/** Stacked fits now: the window is taller than wide (with --full-stack-band of dead-band once
 *  on, so a drag near square does not flip it back and forth), and the band left under a
 *  full-width cover and its controls holds --full-stack-room. Also the player's height then:
 *  the cover (the full width, less the card's own padding and border), the gap, the controls. */
function stackNow(panel: HTMLElement, controlsH: number, gap: number): { on: boolean; h: number } {
  const bento = opts?.bento;
  if (!bento || !surfaceNow() || !Number.isFinite(controlsH)) return { on: false, h: 0 };
  const b = rect(bento);
  const cs = getComputedStyle(panel);
  const px = (v: string) => parseFloat(v) || 0;
  const boxW = px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const boxH = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  const h = Math.ceil(b.width - boxW + gap + controlsH + boxH);
  const band = pxToken("--full-stack-band");
  const tall = stack ? window.innerHeight > window.innerWidth - band : window.innerHeight > window.innerWidth + band;
  return { on: tall && b.height - h - pxToken("--panel-gap") >= pxToken("--full-stack-room"), h };
}

/** Put the stacked layout on or off. Midi's two content cards are the cards under the player,
 *  so they are uncovered while stacked (and covered again after). */
function setStack(on: boolean, h: number): void {
  if (h > 0) opts?.bento.style.setProperty("--fp-stack-h", `${h}px`);
  if (on === stack) return;
  stack = on;
  root.toggleAttribute("data-fp-stack", on);
  diag.log("player:stack", { on, h });
  if (surfaceNow() === "midi") midiCards().forEach((c) => (on ? uncover(c) : cover(c)));
  paintZones(); // stacked, the strip over the cards closes the player
}
const midiCards = (): HTMLElement[] =>
  (opts?.slots() ?? []).map((s) => opts!.hosts[s]).filter((h): h is HTMLElement => !!h);

/** Where everything goes in the card's full box. Called with the full layout on and no paint
 *  between: the controls are measured as they sit on the band (stacked, at the cover's width);
 *  then stacked (a tall window), or the rows' place (§7.3, rowsPlace) and whether the side
 *  column fits. The controls' height is kept as --fp-controls-h, so the halo can center on the
 *  cover above them. The side column is read from the card's width WITHOUT it, so showing it
 *  never turns it off again. */
function layoutNow(panel: HTMLElement): Layout {
  const np = npOf(panel);
  if (!np) return { place: "over", history: false, stack: false, stackH: 0 };
  const r = rect(np);
  const w = r.width + historyRoom();
  const was = panel.dataset.npRows;
  panel.dataset.npRows = "over";
  const scrub = panel.querySelector<HTMLElement>(".np__scrub");
  const vol = panel.querySelector<HTMLElement>(".np__vol");
  const h = scrub && vol ? rect(vol).bottom - rect(scrub).top : Infinity;
  if (was) panel.dataset.npRows = was;
  else delete panel.dataset.npRows;
  if (Number.isFinite(h)) panel.style.setProperty("--fp-controls-h", `${h}px`);
  const gap = parseFloat(getComputedStyle(np).rowGap) || 0;
  // Stacked: the controls are under the cover by construction, and Max shows its side column
  // in the band beside the Queue whatever the width.
  const st = stackNow(panel, h, gap);
  if (st.on) return { place: "below", history: surfaceNow() === "max" && !!opts?.mountSide, stack: true, stackH: st.h };
  const place = rowsPlace(w, r.height, pxToken("--full-wide-w"), h, gap);
  const side = place === "below" ? Math.min(w, r.height - h - gap) : Math.min(w, r.height);
  const history = surfaceNow() === "max" && !!opts?.mountSide && w - pxToken("--full-history-w") - pxToken("--panel-gap") >= side;
  return { place, history, stack: false, stackH: st.h };
}

// ── the side column (Max, a wide card) ──────────────────────────────────────────
// History by default; its title is the slots' picker, any card but Now Playing and Rulez (his
// calls, 2026-10-11). Queue in that list FLIPS the two columns: the side card (with its picker)
// takes the Queue's place on the left and the Queue goes right. The card and the flip are
// remembered (localStorage), and a window too narrow for the column puts the Queue back left.
const SIDE_KEY = "deets.fullplayer.side";
let side: { card: string; flip: boolean } = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SIDE_KEY) ?? "null");
    if (s && typeof s.card === "string") return { card: s.card, flip: s.flip === true };
  } catch {
    /* storage off or not JSON: the defaults */
  }
  return { card: "history", flip: false };
})();
const saveSide = () => {
  try {
    localStorage.setItem(SIDE_KEY, JSON.stringify(side));
  } catch {
    /* storage off: kept for the session */
  }
};
const markFlip = () => root.toggleAttribute("data-fp-flip", side.flip);

let historyInst: { destroy(): void } | null = null;
let historyGen = 0;
const historyHost = (): HTMLElement | null => opts?.bento.querySelector<HTMLElement>(".panel.fp-history") ?? null;
const queuePanel = (): HTMLElement | null => opts?.hosts.queue ?? null;
/** The side column slides in and out at its own edge: the right, or the left when flipped. */
const awayX = (): string => (side.flip ? `translateX(calc(-100% - ${pxToken("--panel-gap")}px))` : `translateX(calc(100% + ${pxToken("--panel-gap")}px))`);

/** Mount the side card (and its picker) into the column's host. */
function mountSide(host: HTMLElement): void {
  if (historyInst || !opts?.mountSide) return;
  historyInst = opts.mountSide(host, side.card, pickSide);
}

/** The column's picker: Queue flips the columns; any other card takes the column. */
function pickSide(id: string): void {
  if (id === "queue") return flipSides();
  if (id === side.card) return;
  side = { ...side, card: id };
  saveSide();
  diag.log("player:side", { card: id });
  const host = historyHost();
  historyInst?.destroy();
  historyInst = null;
  if (host) {
    mountSide(host);
    enterRows([...host.children], host.children.length);
  }
}

/** Swap the two columns: the side card and the Queue change places, sliding past each other
 *  over the cover (they rise above it while they move). Nothing remounts. */
function flipSides(): void {
  const host = historyHost();
  const queue = queuePanel();
  side = { ...side, flip: !side.flip };
  saveSide();
  diag.log("player:side", { flip: side.flip });
  const m = root.dataset.fpHistory === "on" ? motion() : null;
  const moving = [host, queue].filter((p): p is HTMLElement => !!p);
  const before = moving.map(rect);
  markFlip();
  if (!m) return;
  moving.forEach((p, i) => {
    const dx = before[i].left - rect(p).left;
    if (Math.abs(dx) < 1) return;
    p.style.zIndex = "3";
    const anim = p.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: m.dur, easing: m.ease });
    void anim.finished.finally(() => p.style.removeProperty("z-index")).catch(() => {});
  });
  frames.during("player-side", m.dur, side.flip ? "flip" : "back");
}

/** Take the column off at once (the close, a surface change, reduced motion). */
function dropHistory(): void {
  historyGen++;
  historyHost()?.getAnimations().forEach((a) => a.cancel());
  queuePanel()?.getAnimations().forEach((a) => a.id === "side-queue" && a.cancel());
  delete root.dataset.fpHistory;
  historyInst?.destroy();
  historyInst = null;
}

/** Show or hide the column. Its part of the change: the attribute (Now Playing's margin goes
 *  with it) and the mount. Returns the motion to run after the layout has changed. Flipped,
 *  the Queue moves too: to the right as the column comes in on the left, back to the left as
 *  it goes. */
function setHistory(on: boolean, m: Motion | null): (() => void) | null {
  const host = historyHost();
  if (!host || !opts?.mountSide) return null;
  const my = ++historyGen;
  host.getAnimations().forEach((a) => a.cancel());
  const queue = side.flip ? queuePanel() : null;
  const qBefore = queue ? rect(queue) : null;
  const away = awayX();
  /** The Queue slides from where it was to where the new layout put it. */
  const moveQueue = (mm: Motion) => {
    if (!queue || !qBefore) return;
    const dx = qBefore.left - rect(queue).left;
    if (Math.abs(dx) < 1) return;
    const a = queue.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: mm.dur, easing: mm.ease });
    a.id = "side-queue";
  };
  if (on) {
    root.dataset.fpHistory = "on";
    mountSide(host);
    diag.log("player:history", { on: true, card: side.card, flip: side.flip });
    return m
      ? () => {
          host.animate([{ transform: away }, { transform: "none" }], { duration: m.dur, easing: m.ease });
          moveQueue(m);
        }
      : null;
  }
  diag.log("player:history", { on: false });
  if (!m) {
    delete root.dataset.fpHistory;
    return null;
  }
  // It stays on screen while it slides out; Now Playing has its room back at once. The card
  // stays mounted (hidden) until the player closes, so a drag back costs no mount.
  root.dataset.fpHistory = "leaving";
  return () => {
    const anim = host.animate([{ transform: "none" }, { transform: away }], { duration: m.dur, easing: m.ease, fill: "forwards" });
    moveQueue(m);
    void anim.finished.then(() => {
      if (my !== historyGen) return;
      delete root.dataset.fpHistory;
      anim.cancel();
    }, () => {});
  };
}

/** Mount the column's card while it is hidden (a History list is a ~95 ms task, measured
 *  2026-10-11): done once the open lands, so the slide's first frame does not carry it. */
function warmHistory(): void {
  const host = historyHost();
  markFlip();
  if (host && surfaceNow() === "max") mountSide(host);
}

/** A resize moved the rows between the band and the space under the cover (his ask,
 *  2026-10-11): each part slides from its old place to its new one (FLIP: measure, change,
 *  measure, animate the difference away), and the cover moves and scales to its new box.
 *  --player-dur and --player-ease; reduced motion snaps. */
function slideRows(panel: HTMLElement, next: Layout): void {
  const { place, history } = next;
  const from = panel.dataset.npRows;
  const parts = [...panel.querySelectorAll<HTMLElement>(".np__art, .np__meta, .np__scrub, .np__times, .np__bottom, .np__vol")];
  parts.forEach((p) => p.getAnimations().forEach((a) => a.id === "rows-slide" && a.cancel()));
  const m = motion();
  const before = m ? parts.map(rect) : [];
  // Stacked on or off moves the Queue and the side column between the side columns and the
  // band under the player: they slide from their old place too (their size changes at once).
  const restack = next.stack !== stack;
  const columns = restack ? [queuePanel(), historyHost()].filter((p): p is HTMLElement => !!p && !!p.offsetParent) : [];
  const colsBefore = m ? columns.map(rect) : [];
  setStack(next.stack, next.stackH);
  if (place !== from) {
    panel.dataset.npRows = place;
    diag.log("player:rows", { from: from ?? "", to: place, motion: !!m });
  }
  // The History column comes or goes in the same pass: the cover block moves over for it.
  const column = history !== (root.dataset.fpHistory === "on") ? setHistory(history, m) : null;
  if (!m) return;
  column?.();
  columns.forEach((c, i) => {
    const a = colsBefore[i];
    const b = rect(c);
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: m.dur, easing: m.ease }).id = "rows-slide";
  });
  // The band hides while the parts move, and fades in once they land (styles.css). A newer
  // slide (a drag back across the line) owns the class: `my` keeps an old one from ending it.
  panel.classList.add("is-rows-sliding");
  const my = ++slideGen;
  const anims: Animation[] = [];
  parts.forEach((p, i) => {
    const a = before[i];
    const b = rect(p);
    if (!a.width || !b.width) return;
    const s = a.width / b.width;
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return;
    // The cover changes size (a wide card gives up the controls' height); the rows only move.
    const start = p.classList.contains("np__art") ? `translate(${dx}px, ${dy}px) scale(${s})` : `translate(${dx}px, ${dy}px)`;
    const anim = p.animate([{ transform: start, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], { duration: m.dur, easing: m.ease });
    anim.id = "rows-slide";
    anims.push(anim);
  });
  frames.during("player-rows", m.dur, `${from ?? ""}→${place}`);
  void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
    if (my === slideGen) panel.classList.remove("is-rows-sliding");
  });
}

/** Set the layout (or take it off). Midi holds the strip's row at its rest height, so the
 *  covered cards stay where they are while they fade (the spanning card leaves row 1 empty). */
function apply(on: boolean, place?: RowsPlace, row1?: number): void {
  const panel = npHost();
  if (on) {
    if (row1 !== undefined) opts?.bento.style.setProperty("--player-row1", `${row1}px`);
    root.dataset.player = "full";
    root.toggleAttribute("data-fp-stack", stack);
    if (panel && place) panel.dataset.npRows = place;
  } else {
    delete root.dataset.player;
    root.removeAttribute("data-fp-stack");
    if (panel) delete panel.dataset.npRows;
    opts?.bento.style.removeProperty("--player-row1");
  }
}

/** The cover's URL at another size: Apple's image server takes any `{w}x{h}` in the path. A URL
 *  that does not have that shape (a playlist's own cover) is used as it is. */
function sizedUrl(src: string, px: number): string {
  return src.replace(/\/(\d+)x(\d+)([a-z]*)\.(jpe?g|png|webp)(?=$|\?)/i, `/${px}x${px}$3.$4`);
}
/** Load a picture and wait for its decode, at most `ms`. */
function preload(src: string, ms: number): Promise<void> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  return Promise.race([img.decode().catch(() => {}), new Promise<void>((r) => window.setTimeout(r, ms))]);
}

/** Ask for the cover file the box needs now. The card swaps its picture once the new file is
 *  decoded (vinyl.ts, same song), so a resize never blanks it. */
function askArt(boxPx: number): void {
  const px = fullArtPx(boxPx, window.devicePixelRatio, stageArtPx());
  if (px === artPx) return;
  artPx = px;
  setFullArtPx(px);
  refreshPlayerState();
}

/** The copy of the cover that flies (§12.4.3): the art box, cloned, laid out at `at`. A Press
 *  record flies turning from the angle it shows now, at the real disc's rate (his ask, 2026-10-11;
 *  it flew as a still before, §12.9 Q3). */
function makeFlight(art: HTMLElement, at: DOMRect, src: string | null): HTMLElement | null {
  const real = art.querySelector<HTMLElement>(".vinyl:not(.vinyl--out)");
  if (!real || real.classList.contains("vinyl--glyph")) return null; // the ♪ placeholder does not fly
  const fly = art.cloneNode(false) as HTMLElement;
  fly.removeAttribute("id");
  fly.classList.add("np__fly");
  const disc = real.cloneNode(true) as HTMLElement;
  const spin = real.querySelector<HTMLElement>(".vinyl__spin");
  const still = disc.querySelector<HTMLElement>(".vinyl__spin");
  if (spin && still) {
    // The copy turns on with the real disc (vinyl.ts): the same turn, angle and rate, so the
    // record lands at the angle the real one has then. A paused disc flies still.
    const real = spin.getAnimations()[0];
    const timing = real?.effect?.getTiming();
    if (real && timing && real.currentTime !== null) {
      const copy = still.animate([{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }], {
        duration: timing.duration, iterations: Infinity, easing: "linear",
      });
      copy.currentTime = real.currentTime;
      copy.playbackRate = real.playbackRate;
      if (real.playState !== "running") copy.pause();
    } else {
      still.style.transform = getComputedStyle(spin).transform; // the angle now, held
    }
  }
  const img = disc.querySelector<HTMLImageElement>("img");
  if (img && src) img.src = src;
  fly.appendChild(disc);
  // The place's record setting rides along: outside the card no rule gives the copy one.
  fly.style.setProperty("--vinyl", getComputedStyle(art).getPropertyValue("--vinyl").trim() || "0");
  fly.style.left = `${at.left}px`;
  fly.style.top = `${at.top}px`;
  fly.style.width = `${at.width}px`;
  fly.style.height = `${at.height}px`;
  document.body.appendChild(fly);
  return fly;
}
const flyAnim = (fly: HTMLElement, from: Box, to: Box, dur: number, ease: string, reverse: boolean): Animation => {
  const f = flightFrom(from, to);
  const small = `translate(${f.dx}px, ${f.dy}px) scale(${f.scale})`;
  const frames = reverse ? [{ transform: "none" }, { transform: small }] : [{ transform: small }, { transform: "none" }];
  return fly.animate(frames, { duration: dur, easing: ease, fill: "both" });
};

/** The rows on the band (and the band itself) come in. The fade is a Web Animation, not a CSS
 *  class: layoutNow flips `data-np-rows` to "over" to measure the controls, and a CSS animation
 *  on a rule that names the attribute stops on the flip and starts again from 0 on the flip
 *  back. That was the flash ~60 ms after the open landed, in *below* (2026-10-14). */
function enterBand(panel: HTMLElement): void {
  const center = panel.querySelector<HTMLElement>(".np__center");
  panel.classList.remove("is-player-rebuild");
  if (!center) return;
  // In *below* the rows' box is `display: contents` (it cannot fade): its parts fade.
  const below = root.dataset.player === "full" && panel.dataset.npRows === "below";
  const dur = reduced() ? 0 : tokenMs("--grow-body-fade");
  if (dur > 0) {
    const easing = getComputedStyle(panel).getPropertyValue("--ease-ui").trim() || "ease";
    // `offset: 0` makes it the FROM frame (the end is the part's own opacity). A lone keyframe
    // with no offset is the TO frame: the rows faded out and snapped back (2026-10-14).
    (below ? [...center.children] : [center]).forEach((el) => el.animate([{ opacity: 0, offset: 0 }], { duration: dur, easing }));
  }
  const rows = [...center.children].filter((el) => (el as HTMLElement).offsetParent !== null);
  enterRows(rows, rows.length);
}

function emit(): void {
  subs.forEach((cb) => cb(full));
  paintZones();
  refreshGrowZones(); // the Fill strips beside Now Playing change reach; every strip hides while full
}

// ── open ────────────────────────────────────────────────────────────────────────
export async function openFullPlayer(cause: string): Promise<void> {
  if (full || busy || !fullPlayerAvailable()) return;
  const surface = surfaceNow();
  const panel = npHost();
  const art = panel ? artOf(panel) : null;
  if (!surface || !panel || !art) return;
  busy = true;
  const my = ++gen;
  try {
    if (grownState()) await collapseGrow("player", false); // no motion: one motion at a time
    const m = motion();
    const from = rect(panel);
    const fromArt = rect(art);
    const queue = queueHost();
    const fromQueue = queue ? rect(queue) : null;
    const row1 = surface === "midi" ? from.height : undefined;
    // Measure the full layout once, with no paint between: the rows' place, then the cover box.
    apply(true, undefined, row1);
    // Stacked or not is decided here too (a tall window), before the cover box is measured.
    const first = layoutNow(panel);
    stack = first.stack;
    root.toggleAttribute("data-fp-stack", stack);
    if (first.stackH > 0) opts?.bento.style.setProperty("--fp-stack-h", `${first.stackH}px`);
    const place = first.place;
    panel.dataset.npRows = place;
    const box = rect(art).width;
    apply(false);
    const px = fullArtPx(box, window.devicePixelRatio, stageArtPx());
    const img = art.querySelector<HTMLImageElement>(".vinyl:not(.vinyl--out) img");
    const big = img?.src ? sizedUrl(img.src, px) : null;
    // The large file loads before the open, so the flight never shows a soft picture (§9.3).
    if (big && m) await preload(big, tokenMs("--player-art-wait"));
    if (my !== gen || !fullPlayerAvailable() || surfaceNow() !== surface) return;
    artPx = 0;
    askArt(box);

    full = true;
    apply(true, place, row1);
    const covered = coveredHosts();
    covered.forEach((h) => (m ? h.classList.add("is-covering") : cover(h)));
    diag.log("player", { on: true, cause, surface, rows: place, px });
    emit();
    watchSize(panel);
    if (!m) {
      covered.forEach(cover);
      return;
    }

    panel.classList.add("is-player-rebuild");
    panel.dataset.frames = "grow";
    const to = rect(panel); // the layout at its final size, once
    const toArt = rect(art);
    const pad = clipPad();
    const radius = getComputedStyle(panel).borderRadius || "0px";
    const endFrames = frames.begin("player", `${surface} open`);
    const fly = makeFlight(art, toArt, big);
    if (fly) art.style.visibility = "hidden";
    const anims: Animation[] = [
      panel.animate([{ clipPath: clipBetween(fullClipFrom(from, to, surface), to, pad, radius) }, { clipPath: clipOpen(pad, radius) }], {
        duration: m.dur, easing: m.ease, fill: "both",
      }),
    ];
    if (fly) anims.push(flyAnim(fly, fromArt, toArt, m.dur, m.ease, false));
    if (queue && fromQueue) {
      // Max: the Queue grows up over the place Now Playing left, in the same time (§9.4.3).
      const toQueue = rect(queue);
      const qr = getComputedStyle(queue).borderRadius || "0px";
      anims.push(queue.animate([{ clipPath: clipBetween(fromQueue, toQueue, pad, qr) }, { clipPath: clipOpen(pad, qr) }], {
        duration: m.dur, easing: m.ease, fill: "both",
      }));
    }
    let rowsIn = false;
    const rows = () => {
      if (rowsIn) return;
      rowsIn = true;
      enterBand(panel);
    };
    const rowsTimer = window.setTimeout(rows, m.rowsAt);
    await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    window.clearTimeout(rowsTimer);
    anims.forEach((a) => a.cancel());
    fly?.remove();
    art.style.visibility = "";
    endFrames();
    delete panel.dataset.frames;
    if (full && my === gen) {
      covered.forEach(cover);
      rows();
    }
  } finally {
    if (my === gen) busy = false;
  }
  // The History column waits for the open to land: its card mounts hidden, and two frames
  // later it slides in when the card is wide.
  if (full && my === gen) {
    warmHistory();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (full && my === gen) refit(panel);
    }));
  }
}

// ── close ───────────────────────────────────────────────────────────────────────
/** Close it. `withMotion` false snaps (a surface change, a card request). */
export async function closeFullPlayer(cause: string, withMotion = true): Promise<void> {
  if (!full) return;
  const panel = npHost();
  const art = panel ? artOf(panel) : null;
  const surface = surfaceNow();
  const my = ++gen;
  const m = withMotion && !busy ? motion() : null;
  // A close during the open's motion: the open's animations end, then the snap.
  panel?.getAnimations().forEach((a) => a.cancel());
  opts?.hosts.queue?.getAnimations().forEach((a) => a.cancel());
  document.querySelectorAll(".np__fly").forEach((f) => f.remove());
  if (art) art.style.visibility = "";
  // The History column and a rows slide end at once: the close measures the layout without them.
  dropHistory();
  panel?.getAnimations({ subtree: true }).forEach((a) => a.id === "rows-slide" && a.cancel());
  busy = true;
  const covered = coveredHosts();
  const end = () => {
    full = false;
    apply(false);
    stack = false; // the next open decides again
    opts?.bento.style.removeProperty("--fp-stack-h");
    covered.forEach(uncover);
    watch?.disconnect();
    watch = null;
    artPx = 0;
    setFullArtPx(0);
    refreshPlayerState(); // the cover goes back to the rest file (already in the cache)
    panel?.classList.remove("is-player-rebuild", "is-rows-sliding");
    if (panel) delete panel.dataset.frames;
    diag.log("player", { on: false, cause, surface: surface ?? currentSurface(), motion: !!m });
    if (my === gen) busy = false;
    emit();
  };
  if (!m || !panel || !art || !surface) {
    end();
    return;
  }
  const to = rect(panel);
  const toArt = rect(art);
  const queue = queueHost();
  const toQueue = queue ? rect(queue) : null;
  // The rest boxes: measured with the layout off for one layout, no paint.
  const row1 = opts?.bento.style.getPropertyValue("--player-row1");
  const place = panel.dataset.npRows as RowsPlace | undefined;
  apply(false);
  const rest = rect(panel);
  const restArt = rect(art);
  const restQueue = queue ? rect(queue) : null;
  apply(true, place, row1 ? parseFloat(row1) : undefined);

  // The rows and the band go first (§9.4.2).
  panel.classList.add("is-player-rebuild");
  panel.dataset.frames = "grow";
  covered.forEach((h) => {
    h.classList.remove("is-covered");
    h.inert = false;
    h.style.transition = "none"; // from 0 at once, then the fade in (card-grow.ts collapseGrow)
    h.classList.add("is-covering");
  });
  void panel.offsetWidth;
  covered.forEach((h) => {
    h.style.transition = "";
    h.classList.remove("is-covering");
    h.classList.add("is-uncovering");
  });
  const pad = clipPad();
  const radius = getComputedStyle(panel).borderRadius || "0px";
  const endFrames = frames.begin("player", `${surface} close`);
  const fly = makeFlight(art, toArt, null);
  if (fly) art.style.visibility = "hidden";
  const anims: Animation[] = [
    panel.animate([{ clipPath: clipOpen(pad, radius) }, { clipPath: clipBetween(fullClipFrom(rest, to, surface), to, pad, radius) }], {
      duration: m.collapseDur, easing: m.ease, fill: "both",
    }),
  ];
  if (fly) anims.push(flyAnim(fly, restArt, toArt, m.collapseDur, m.ease, true));
  if (queue && toQueue && restQueue) {
    const qr = getComputedStyle(queue).borderRadius || "0px";
    anims.push(queue.animate([{ clipPath: clipOpen(pad, qr) }, { clipPath: clipBetween(restQueue, toQueue, pad, qr) }], {
      duration: m.collapseDur, easing: m.ease, fill: "both",
    }));
  }
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
  if (my !== gen) return; // something else ended it (a surface change) and cleaned up
  end();
  anims.forEach((a) => a.cancel());
  fly?.remove();
  art.style.visibility = "";
  covered.forEach((h) => h.classList.remove("is-uncovering"));
  endFrames();
  enterBand(panel); // the rows come in at their rest place
}

export function toggleFullPlayer(cause: string): void {
  if (full) void closeFullPlayer(cause);
  else void openFullPlayer(cause);
}

/** While full: the rows' place and the cover file follow the card's size. */
function watchSize(panel: HTMLElement): void {
  watch?.disconnect();
  const np = npOf(panel);
  const art = artOf(panel);
  if (!np || !art) return;
  watch = new ResizeObserver(() => refit(panel));
  watch.observe(np);
}

/** While full: put the rows and the History column where the card's size says. The open and
 *  the close have their own motion: during one, the rows snap and the column waits for the
 *  end of the open (refit runs again then). */
function refit(panel: HTMLElement): void {
  if (!full) return;
  const art = artOf(panel);
  const next = layoutNow(panel);
  const histNow = root.dataset.fpHistory === "on";
  if (busy) {
    setStack(next.stack, next.stackH);
    if (panel.dataset.npRows !== next.place) panel.dataset.npRows = next.place;
  } else if (panel.dataset.npRows !== next.place || next.history !== histNow || next.stack !== stack) {
    slideRows(panel, next);
  } else {
    setStack(stack, next.stackH); // the same layout: only the player's height follows the window
  }
  if (art) askArt(rect(art).width);
}

// ── the edge strips on Now Playing (§10) ────────────────────────────────────────
// The grow's strips (`.grow-zone`, its bar per skin), painted here: card-grow.ts paints only
// strips with a data-slot. Midi: the top and bottom of the strip. Max: the left and right of
// the card. Each opens the player at rest and closes it while full.
type Side = "left" | "right" | "up" | "down";
const BAR_SIDE: Record<Side, string> = { right: "left", left: "right", down: "top", up: "bottom" };
let zones: HTMLElement[] = [];

/** Strips act: Midi or Max, "Grow cards from edges" on, and Now Playing not under the Queue's
 *  grow. Another card grown does not stop them: the open collapses it first (his ask,
 *  2026-10-14: a Fill on the Library hid the way in). */
const zonesOn = (): boolean => fullPlayerAvailable() && setting("cardGrow") && grownState()?.slot !== "queue";

function reachOf(side: Side): "half" | "full" | "edge" | null {
  const s = surfaceNow();
  // Stacked: the gap over the cards closes the player (the card's sides are the window's edges).
  if (full && stack) return side === "down" ? "full" : null;
  if (s === "midi") {
    if (side === "up") return "full";
    if (side === "down") return full ? "edge" : "full";
    return null;
  }
  if (s === "max") {
    if (side === "left") return full ? "full" : "edge";
    // Half the gap beside the stage when a card's strip takes the other half (the Fill strips of
    // four-card Max, or a grown card's collapse strip); the whole gap when none is there.
    if (side === "right") return full ? "edge" : stageGapShared() ? "half" : "full";
    // The top and the bottom of the resting card open it too (his ask, 2026-10-11). The bottom
    // gap is the Queue's as well (its grow up over Now Playing): each takes half of it, also
    // while another card is grown (both strips act then, 2026-10-14).
    if (side === "up") return full ? null : "full";
    if (side === "down") return full ? null : "half";
  }
  return null;
}

function paintZones(): void {
  const on = zonesOn();
  for (const el of zones) {
    const side = el.dataset.playerSide as Side;
    const reach = on ? reachOf(side) : null;
    if (!reach) {
      el.hidden = true;
      continue;
    }
    el.hidden = false;
    el.dataset.side = side;
    el.dataset.reach = reach;
    el.dataset.act = full ? "collapse" : "grow";
    el.className = `grow-zone grow-zone--${BAR_SIDE[side]}`;
    const hint = full ? "Back to the cards" : "Opens the full player";
    el.title = hint;
    el.setAttribute("aria-label", hint);
  }
}

function makeZones(host: HTMLElement): void {
  zones = (["left", "right", "up", "down"] as Side[]).map((side) => {
    const el = document.createElement("div");
    el.className = "grow-zone";
    el.dataset.playerSide = side;
    el.hidden = true;
    el.setAttribute("role", "button");
    el.innerHTML = `<span class="grow-zone__bar" aria-hidden="true"></span>`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (busy || !zonesOn()) return;
      toggleFullPlayer("zone");
    });
    host.appendChild(el);
    return el;
  });
}

// ── init ────────────────────────────────────────────────────────────────────────
declare global {
  interface Window {
    /** A measuring handle on the TELEMETRY gate. Not `__player`: player.ts owns that one. */
    __full?: {
      open: typeof openFullPlayer;
      close: typeof closeFullPlayer;
      state: () => { full: boolean; busy: boolean; rows: string | null; px: number };
    };
  }
}

export function initFullPlayer(o: Opts): void {
  opts = o;
  setPlayerHooks({
    full: () => full,
    npRightLive: () => !full && surfaceNow() === "max" && zonesOn(),
  });
  // The rules (RULES.md §19, §12.6): the fact "player" (on / off) and the action (open / close).
  registerFact("player", () => (full ? "on" : "off"), { seam: (cb) => onFullPlayerChange(() => cb()) });
  registerAction("player", {
    cost: "free",
    run: (arg) => (arg === "close" ? closeFullPlayer("rule") : openFullPlayer("rule")),
  });
  if (o.hosts.np) makeZones(o.hosts.np);
  onGrowChange(() => paintZones());
  onSettingsChange((k) => {
    if (k === "cardGrow") emit();
    // Layout for Max changed: close with no motion before the layout remounts (MAX-CARDS.md).
    if (k === "maxCards") {
      if (full) void closeFullPlayer("layout", false);
      paintZones();
    }
  });
  // A surface change ends it with no motion, before the layout remounts the slots.
  onSurfaceChange(() => {
    if (full) void closeFullPlayer("surface", false);
    paintZones();
  });
  // Escape closes it, unless a menu, a popover or a text field takes it first (the grow's rule).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !full || busy || e.defaultPrevented) return;
    const t = e.target;
    if (t instanceof Element && t.closest("input, textarea, [contenteditable]")) return;
    if (document.querySelector(".ctx-menu, .lib-pop:not([hidden]), .slot-picker__menu:not([hidden]), .pop:not([hidden])")) return;
    void closeFullPlayer("esc");
  });
  paintZones();
  // A measuring handle (DEBUGGING.md), on the TELEMETRY gate as `__grow` is. Not `__player`:
  // player.ts owns that name and set it over this one once MusicKit configured (2026-10-11).
  if (TELEMETRY) {
    window.__full = {
      open: openFullPlayer,
      close: closeFullPlayer,
      state: () => ({ full, busy, rows: npHost()?.dataset.npRows ?? null, px: artPx }),
    };
  }
}

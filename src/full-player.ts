// The full player (features/fullscreen-player.md): Now Playing grows so the cover is as large as
// the window allows. Midi: over the Library and Queue cards, the rows over the cover on a dark
// band. Max: over the four content cards, the Queue takes the whole stage column. In both, the
// controls go under the cover when there is room or the card is wide, else over it on the band;
// never beside it (2026-10-11). Mini: not in the test version (§12.9: Mini's player view stays
// as it is until he says).
//
// It is not a grow: it changes the card's column (Max) and its inner layout, so it is its own
// module and borrows the grow's parts (the clip, the covered-card classes, the zones' look).
// One attribute carries the state: `data-player="full"` on the bento (`fp()`); every CSS rule
// hangs on it (the Compass and the toasts outside the bento read it through `:has()`).
// The card wears `data-np-rows="over|below"` (below: the controls under the cover, 2026-10-11).
//
// Ways in: the edge strips on Now Playing (Midi top and bottom, Max all four sides when full), Compass
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
import { rowsPlace, coverSide, closePlace, fullArtPx, fullClipFrom, flightFrom, stillCutRight, type Box, type ClosePlace, type RowsPlace } from "./full-player-layout";
import {
  clipBetween, clipOpen, clipPad, cover, uncover, collapseGrow, grownState, onGrowChange, refreshGrowZones, setPlayerHooks, stageGapShared, type Slot,
} from "./card-grow";
import { motionReduced } from "./motion";
import { sizeDrum } from "./metal";

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
let shareWatch: MutationObserver | null = null; // the look's cover share (Metal's peek) changes the layout at the same size
let measuredShare = 1; // the cover share the last layout was measured with (layoutNow)
let measuredMeta = false; // the title block's place the last layout was measured with (layoutNow)
/** The close square off the cover (Title under the cover, §17): its place, and the height the
 *  cover gives up for it. Null: on the cover's corner, as before. */
let measuredClose: { place: ClosePlace; room: number } | null = null;
let slideGen = 0; // bumps on every rows slide: only the newest one ends is-rows-sliding
let wantHistory = false; // the open's measure: the side column shows (Max)
let resizedInMotion = false; // a resize during the open changed the layout: check it after the landing
const subs = new Set<(on: boolean) => void>();

const root = document.documentElement;
/** The element that wears the player's state (`data-player`, `data-fp-stack`, `data-fp-history`,
 *  `data-fp-flip`): the bento, not <html>. A change on <html> restyled the whole page (1,500
 *  elements, a 50–70 ms close frame, §14.9); on the bento it restyles the cards only. Nothing is
 *  set before init, so the fallback only reads. */
const fp = (): HTMLElement => opts?.bento ?? root;
const reduced = () => motionReduced();
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
/** The cover's most share of the card's width (--fp-cover-share; Metal's peek, 0.72). */
const coverShare = (): number => pxToken("--fp-cover-share") || 1;
/** Settings › Window › *Title under the cover* (§17): nothing on the cover. */
const offCover = (): boolean => root.dataset.npOffCover === "on";
/** The title, artist and album under the cover, never on it (--fp-meta-below; Metal; or the
 *  setting). */
const metaBelow = (): boolean => offCover() || pxToken("--fp-meta-below") > 0;

/** Write the close square's place on the card (null: back on the cover). */
function markClose(panel: HTMLElement, c: { place: ClosePlace; room: number } | null): void {
  if (c) panel.dataset.npClose = c.place;
  else delete panel.dataset.npClose;
  if (c?.room) panel.style.setProperty("--fp-close-room", `${c.room}px`);
  else panel.style.removeProperty("--fp-close-room");
}

// ── the parts ───────────────────────────────────────────────────────────────────
const npHost = (): HTMLElement | null => opts?.hosts.np ?? null;
const queueHost = (): HTMLElement | null => (currentSurface() === "max" ? opts?.hosts.queue ?? null : null);
const artOf = (panel: HTMLElement) => panel.querySelector<HTMLElement>(".np__art");
const npOf = (panel: HTMLElement) => panel.querySelector<HTMLElement>(".np");
/** The surface the player opened on. A surface change closes it after the surface has changed,
 *  so the close reads this, not surfaceNow(): stacked in Max, a switch to Midi read "stacked +
 *  Midi" and uncovered no card, and all four stayed hidden (2026-10-21). */
let openedOn: "midi" | "max" | null = null;
/** The cards the player covers: every content slot of the composition. */
const coveredHosts = (): HTMLElement[] =>
  stack && (full ? openedOn : surfaceNow()) === "midi" ? [] :(opts?.slots() ?? []).map((s) => opts!.hosts[s]).filter((h): h is HTMLElement => !!h);

/** The room the History column takes from Now Playing now: its width and the panel gap. */
const historyRoom = (): number => (fp().dataset.fpHistory === "on" && !stack ? pxToken("--full-history-w") + pxToken("--panel-gap") : 0);

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
  const h = Math.ceil(coverSide(b.width - boxW, Infinity, measuredShare) + gap + controlsH + boxH);
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
  fp().toggleAttribute("data-fp-stack", on);
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
  measuredShare = coverShare();
  measuredMeta = metaBelow();
  // The CSS reads the place from the card (styles.css, the full player's rows below); it applies
  // only with the rows below, so the measure on the band below is not touched by it.
  panel.toggleAttribute("data-np-meta-below", measuredMeta);
  const r = rect(np);
  const w = r.width + historyRoom();
  const gap = parseFloat(getComputedStyle(np).rowGap) || 0;
  const was = panel.dataset.npRows;
  panel.dataset.npRows = "over";
  const scrub = panel.querySelector<HTMLElement>(".np__scrub");
  const vol = panel.querySelector<HTMLElement>(".np__vol");
  const meta = panel.querySelector<HTMLElement>(".np__meta");
  // With the title block under the cover, it is one more row of the controls' height.
  const metaH = measuredMeta && meta ? rect(meta).height + gap : 0;
  const h = scrub && vol ? rect(vol).bottom - rect(scrub).top + metaH : Infinity;
  if (was) panel.dataset.npRows = was;
  else delete panel.dataset.npRows;
  if (Number.isFinite(h)) panel.style.setProperty("--fp-controls-h", `${h}px`);
  // The close square off the cover (§17): its size plus its gap to the cover. Stacked, the cover
  // takes the full width, so the player is that much taller for it.
  const close = offCover() ? panel.querySelector<HTMLElement>(".np__close") : null;
  const need = close ? (close.offsetHeight || pxToken("--icon-lg")) + pxToken("--np-close-inset") : 0;
  // Stacked: the controls are under the cover by construction, and Max shows its side column
  // in the band beside the Queue whatever the width.
  const st = stackNow(panel, h + need, gap);
  if (st.on) {
    measuredClose = close ? closePlace(0, 0, 0, 0, need, true) : null;
    markClose(panel, measuredClose);
    return { place: "below", history: surfaceNow() === "max" && !!opts?.mountSide, stack: true, stackH: st.h };
  }
  const share = measuredShare;
  const place = rowsPlace(w, r.height, pxToken("--full-wide-w"), h, gap, share, measuredMeta);
  const side = coverSide(w, place === "below" ? r.height - h - gap : r.height, share);
  // The column shows when the card beside it still gives the cover the same side.
  const history = surfaceNow() === "max" && !!opts?.mountSide && coverSide(w - pxToken("--full-history-w") - pxToken("--panel-gap"), Infinity, share) >= side;
  // The close square's room is read in the card as it will be: without the side column's width
  // while that column shows. Metal's peek (a share under 1) fills the room beside the cover with
  // the side covers, so the square never goes there: no room beside.
  const cardW = share < 1 ? side : history ? w - pxToken("--full-history-w") - pxToken("--panel-gap") : w;
  measuredClose = close ? closePlace(cardW, r.height, side, side + gap + h, need) : null;
  markClose(panel, measuredClose);
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
const markFlip = () => fp().toggleAttribute("data-fp-flip", side.flip);

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
  const m = fp().dataset.fpHistory === "on" ? motion() : null;
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

/** Take the column off at once (the close, a surface change, reduced motion). The card stays
 *  mounted in its hidden host (`keep`), so the next open carries no mount and its tiles play no
 *  reveal during the motion (§14 N3, 2026-10-18); a surface or layout change unmounts it. */
function dropHistory(keep = true): void {
  historyGen++;
  historyHost()?.getAnimations().forEach((a) => a.cancel());
  queuePanel()?.getAnimations().forEach((a) => a.id === "side-queue" && a.cancel());
  delete fp().dataset.fpHistory;
  if (keep) return;
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
    fp().dataset.fpHistory = "on";
    mountSide(host);
    paintZones(); // the right strip moves from the window edge to the gap beside the column
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
    delete fp().dataset.fpHistory;
    paintZones();
    return null;
  }
  // It stays on screen while it slides out; Now Playing has its room back at once. The card
  // stays mounted (hidden) until the player closes, so a drag back costs no mount.
  fp().dataset.fpHistory = "leaving";
  paintZones(); // the right strip is back on the window edge with the room
  return () => {
    const anim = host.animate([{ transform: "none" }, { transform: away }], { duration: m.dur, easing: m.ease, fill: "forwards" });
    moveQueue(m);
    void anim.finished.then(() => {
      if (my !== historyGen) return;
      delete fp().dataset.fpHistory;
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
  const column = history !== (fp().dataset.fpHistory === "on") ? setHistory(history, m) : null;
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
    fp().dataset.player = "full";
    fp().toggleAttribute("data-fp-stack", stack);
    if (panel && place) panel.dataset.npRows = place;
    // The title block's place comes back with the layout: the open turns the layout off while
    // the large cover loads, and the title fell back on the cover when it came on again (his
    // report, 2026-10-21: "still seeing this sometimes").
    if (panel) panel.toggleAttribute("data-np-meta-below", measuredMeta);
    if (panel) markClose(panel, measuredClose);
  } else {
    delete fp().dataset.player;
    fp().removeAttribute("data-fp-stack");
    if (panel) {
      delete panel.dataset.npRows;
      panel.removeAttribute("data-np-meta-below");
      markClose(panel, null);
    }
    opts?.bento.style.removeProperty("--player-row1");
  }
}

/** The cover's URL at another size: Apple's image server takes any `{w}x{h}` in the path. A URL
 *  that does not have that shape (a playlist's own cover) is used as it is. */
function sizedUrl(src: string, px: number): string {
  return src.replace(/\/(\d+)x(\d+)([a-z]*)\.(jpe?g|png|webp)(?=$|\?)/i, `/${px}x${px}$3.$4`);
}
/** Load a picture and wait for its decode, at most `ms`. `ready`: the picture is already in the
 *  memory cache (a second open of the same song), so there is nothing to wait for (§14 N2). */
function preload(src: string, ms: number): { ready: boolean; wait: Promise<void> } {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  if (img.complete && img.naturalWidth > 0) return { ready: true, wait: Promise.resolve() };
  return { ready: false, wait: Promise.race([img.decode().catch(() => {}), new Promise<void>((r) => window.setTimeout(r, ms))]) };
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
    // The copy turns on with the real disc (vinyl.ts): the same turn, angle, rate and steps
    // (the Spin FPS row), so the record lands at the angle the real one has then. A paused
    // disc flies still.
    const real = spin.getAnimations()[0];
    const timing = real?.effect?.getTiming();
    if (real && timing && real.currentTime !== null) {
      const copy = still.animate([{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }], {
        duration: timing.duration, iterations: Infinity, easing: timing.easing ?? "linear",
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
  // Metal's side covers fly with the cover: the real box is hidden for the motion, so they
  // appeared only as it landed (metal.md §6.8, 2026-10-21). Each slot is an empty box painted by its own
  // attributes (--peek-art, data-side, data-empty), so a shallow copy is the whole slot.
  art.querySelectorAll<HTMLElement>(":scope > .metal-peek").forEach((p) => fly.appendChild(p.cloneNode(false)));
  fly.appendChild(disc);
  // The place's record setting rides along: outside the card no rule gives the copy one.
  fly.style.setProperty("--vinyl", getComputedStyle(art).getPropertyValue("--vinyl").trim() || "0");
  fly.style.left = `${at.left}px`;
  fly.style.top = `${at.top}px`;
  fly.style.width = `${at.width}px`;
  fly.style.height = `${at.height}px`;
  document.body.appendChild(fly);
  // The copy is laid out at the full size now, before the real box's resize watch has run: its
  // side covers take the drum depth for that size (metal.ts), not the copied resting one.
  sizeDrum(fly);
  return fly;
}
const flyAnim = (fly: HTMLElement, from: Box, to: Box, dur: number, ease: string, reverse: boolean): Animation => {
  const f = flightFrom(from, to);
  const small = `translate(${f.dx}px, ${f.dy}px) scale(${f.scale})`;
  const frames = reverse ? [{ transform: "none" }, { transform: small }] : [{ transform: small }, { transform: "none" }];
  return fly.animate(frames, { duration: dur, easing: ease, fill: "both" });
};

/** A still copy of Now Playing in its resting layout, in its resting box (Max). The card changes
 *  column there, so its resting place in column 1 stood empty while the Queue grew up over it
 *  (the open) or shrank down off it (the close), and the card popped into it at the end of the
 *  close; Glass showed the empty place as bright wallpaper (his report, 2026-10-14). The copy
 *  fills the place under the Queue for the length of the motion. Its cover is hidden (the flight
 *  carries the picture). Call it while the resting layout is on; `placeStill` puts it on screen. */
function restCopy(panel: HTMLElement): HTMLElement | null {
  const bento = opts?.bento;
  if (!bento || surfaceNow() !== "max") return null;
  const r = rect(panel);
  const b = rect(bento);
  const copy = panel.cloneNode(true) as HTMLElement;
  // Off the slot, so no full-player rule and no slot code reaches it; `.np-still` takes the one
  // resting rule it needs (styles.css).
  copy.removeAttribute("data-slot");
  copy.removeAttribute("data-np-rows");
  copy.removeAttribute("data-frames");
  copy.removeAttribute("id");
  copy.classList.remove("is-player-rebuild", "is-rows-sliding");
  copy.classList.add("np-still");
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  copy.querySelectorAll(".grow-zone, .np__close").forEach((el) => el.remove());
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.style.left = `${r.left - b.left - bento.clientLeft}px`;
  copy.style.top = `${r.top - b.top - bento.clientTop}px`;
  copy.style.width = `${r.width}px`;
  copy.style.height = `${r.height}px`;
  return copy;
}
let still: HTMLElement | null = null;
/** Put the copy on screen, under the Queue (which grows over it or shrinks off it). */
function placeStill(copy: HTMLElement | null): void {
  dropStill();
  if (!copy || !opts) return;
  still = copy;
  opts.bento.appendChild(copy);
  opts.hosts.queue?.style.setProperty("z-index", "1");
}
function dropStill(): void {
  if (!still) return;
  still.remove();
  still = null;
  opts?.hosts.queue?.style.removeProperty("z-index");
}

// ── held boxes (§14 N1) ─────────────────────────────────────────────────────────
// The stacked grid gives the covered content cards the player's area and the Queue the band.
// Each new size laid out every card again (its list redrew) on every measure, and the cards and
// the Queue jumped: at the open's first frame, and at the close's last (his report, 2026-10-18).
// A held card keeps its box (`.fp-pin`, absolute in the bento): the covered cards for as long as
// the player is open in Max, the Queue while a stacked motion runs.
const pinned = new Set<HTMLElement>();
/** The bento's padding box in the viewport. Read it BEFORE any write: a read after one forces a
 *  layout (one per card, measured with scripts/frame-why.mjs, 2026-10-18). */
function bentoOrigin(): { left: number; top: number } {
  const bento = opts!.bento;
  const b = rect(bento);
  return { left: b.left + bento.clientLeft, top: b.top + bento.clientTop };
}
/** The box `r` (a viewport rect) in the bento's padding box. */
function bentoBox(r: DOMRect, o: { left: number; top: number }): { left: number; top: number; width: number; height: number } {
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
}
/** Hold each card at its box. Measure every box before the first call changes the layout. */
function pin(els: HTMLElement[], boxes: DOMRect[]): void {
  if (!opts) return;
  const b = bentoOrigin();
  els.forEach((el, i) => {
    const box = bentoBox(boxes[i], b);
    el.classList.add("fp-pin");
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    pinned.add(el);
  });
}
function unpin(els: Iterable<HTMLElement> = [...pinned]): void {
  for (const el of els) {
    el.classList.remove("fp-pin");
    for (const k of ["left", "top", "width", "height"]) el.style.removeProperty(k);
    pinned.delete(el);
  }
}

/** Still copies of the Queue for a stacked motion: its look at the place it leaves, which fades
 *  while the real one is somewhere else (§14.4). Inert, off the slot, under the moving cards. */
let queueStills: HTMLElement[] = [];
function stillOf(panel: HTMLElement, r: DOMRect): HTMLElement | null {
  if (!opts) return null;
  const copy = panel.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-slot");
  copy.removeAttribute("data-frames");
  copy.removeAttribute("id");
  copy.classList.remove("fp-pin", "pop-enter");
  copy.classList.add("fp-still");
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  copy.querySelectorAll(".grow-zone").forEach((el) => el.remove());
  for (const k of ["left", "top", "width", "height", "opacity", "z-index"]) copy.style.removeProperty(k);
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  const box = bentoBox(r, bentoOrigin());
  copy.style.left = `${box.left}px`;
  copy.style.top = `${box.top}px`;
  copy.style.width = `${box.width}px`;
  copy.style.height = `${box.height}px`;
  opts.bento.appendChild(copy);
  queueStills.push(copy);
  return copy;
}
// ── the moving card box (§14.10, Max) ──────────────────────────────────────────
// In Max, Now Playing rests in column 1 and is full over the columns beside it, so a clip on the
// card cannot take it from one box to the other: the close wiped the card off to its left edge,
// a cut with no rim that crossed the cards (his report, Glass, 2026-10-19). Now an empty card
// box (`.fp-ghost`: the card's own fill, rim, corners and shadow) moves and changes size between
// the two boxes while the real card waits unseen; the rows come in when it lands. An empty box
// lays out alone, so moving its edges costs one small layout a frame.
let ghost: HTMLElement | null = null;
function makeGhost(panel: HTMLElement, r: DOMRect): HTMLElement | null {
  dropGhost();
  if (!opts) return null;
  const g = document.createElement("div");
  g.className = "panel fp-ghost";
  g.inert = true;
  g.setAttribute("aria-hidden", "true");
  // The album glow (`.np__aurora`, the skins that show it) rides along: its colors are on the
  // card's `.np` (album-color.ts), and its turn goes on from the angle the real one shows now,
  // or the glow would jump at the start and at the landing.
  const np = panel.querySelector<HTMLElement>(".np");
  const aurora = np?.querySelector<HTMLElement>(":scope > .np__aurora");
  if (np && aurora) {
    g.style.cssText = np.style.cssText;
    const copy = aurora.cloneNode(false) as HTMLElement;
    g.appendChild(copy);
    const real = aurora.getAnimations({ subtree: true });
    copy.getAnimations({ subtree: true }).forEach((a, i) => {
      const r = real[i];
      if (r && r.currentTime !== null) a.currentTime = r.currentTime;
      if (r && r.playState !== "running") a.pause();
    });
  }
  const box = bentoBox(r, bentoOrigin());
  g.style.left = `${box.left}px`;
  g.style.top = `${box.top}px`;
  g.style.width = `${box.width}px`;
  g.style.height = `${box.height}px`;
  opts.bento.appendChild(g);
  ghost = g;
  return g;
}
function dropGhost(): void {
  ghost?.remove();
  ghost = null;
}
/** The box's motion from `a` to `b` (viewport rects), and the resting still's cut that follows
 *  its left edge. The real card is held unseen for as long (its rows wait for the landing).
 *  `artA` / `artB`: the cover's boxes at each end. The glow is centered on the cover and sized by
 *  it in the card (styles.css), so its copy moves with the flying cover: the cover and the box
 *  move on the same easing, so the glow's place inside the box is linear too, and two keyframes
 *  hold it on the cover for the whole motion. */
function ghostMotion(panel: HTMLElement, a: DOMRect, b: DOMRect, artA: DOMRect, artB: DOMRect, rest: DOMRect, dur: number, ease: string): Animation[] {
  const g = makeGhost(panel, a);
  if (!g) return [];
  const o = bentoOrigin();
  const at = (r: DOMRect) => {
    const x = bentoBox(r, o);
    return { left: `${x.left}px`, top: `${x.top}px`, width: `${x.width}px`, height: `${x.height}px` };
  };
  const timing = { duration: dur, easing: ease, fill: "both" as const };
  const anims = [
    g.animate([at(a), at(b)], timing),
    panel.animate([{ opacity: 0 }, { opacity: 0 }], timing),
  ];
  const glow = g.querySelector<HTMLElement>(".np__aurora");
  if (glow) {
    const reach = parseFloat(getComputedStyle(glow).getPropertyValue("--album-aurora-reach")) || 1;
    const gs = getComputedStyle(g);
    const edge = parseFloat(gs.borderLeftWidth) || 0;
    const radius = Math.max(0, (parseFloat(gs.borderTopLeftRadius) || 0) - edge);
    // The glow's square in the box's padding box, around the cover, and a clip to the box's
    // padding box in the square's own frame. The box's `overflow: hidden` alone let the turning
    // layer out while the motion ran (a square past the box, Glass, 2026-10-19). Each value is
    // linear in the motion's progress, as the square's place is.
    const halo = (box: DOMRect, art: DOMRect) => {
      const side = art.width * reach;
      const x = art.left + art.width / 2 - box.left - edge - side / 2;
      const y = art.top + art.height / 2 - box.top - edge - side / 2;
      const w = box.width - 2 * edge;
      const h = box.height - 2 * edge;
      return {
        left: `${x}px`, top: `${y}px`, width: `${side}px`, height: `${side}px`,
        clipPath: `inset(${-y}px ${x + side - w}px ${y + side - h}px ${-x}px round ${radius}px)`,
      };
    };
    anims.push(glow.animate([halo(a, artA), halo(b, artB)], timing));
  }
  if (still) {
    still.classList.add("is-bare");
    const pad = clipPad();
    const cut = (left: number) => `inset(${-pad}px ${stillCutRight(rest, left)}px ${-pad}px ${-pad}px)`;
    anims.push(still.animate([{ clipPath: cut(a.left) }, { clipPath: cut(b.left) }], timing));
  }
  return anims;
}

/** End a stacked motion's parts: the stills go, the Queue's own motion and hold end. */
function dropStackBits(): void {
  queueStills.forEach((s) => s.remove());
  queueStills = [];
  const queue = queuePanel();
  if (queue) {
    queue.getAnimations().forEach((a) => a.id === "stack-move" && a.cancel());
    queue.style.removeProperty("opacity");
    unpin([queue]);
  }
  historyHost()?.getAnimations().forEach((a) => a.id === "stack-move" && a.cancel());
}
/** Max, not stacked: the Queue between its resting box (`rest`, under Now Playing) and the whole
 *  column (`full`, where it is laid out now). It moves with its top edge (a translate), so its
 *  header and rows go up and down with the edge; a clip holds its bottom edge where the column
 *  ends. `back`: the close (full → rest). The same edges as the clip it replaces (§14.6). */
function queueRise(queue: HTMLElement, rest: DOMRect, full: DOMRect, pad: number, dur: number, ease: string, back: boolean): Animation[] {
  const dy = rest.top - full.top;
  // The clip is a path in the Queue's own box: the shadow pad on the top and the sides, and at
  // the bottom the card's own edge with its rounded corners, at the line where the column ends.
  // An inset() clip padded on every side showed the Queue's body below that line (the Queue is
  // moved down by `dy`; 40 px in Glass, past the window), and unpadded at the bottom it cut the
  // card flat with square corners (his reports, 2026-10-20). Both ends use the same commands, so
  // the path animates.
  const r = Math.min(parseFloat(getComputedStyle(queue).borderBottomLeftRadius) || 0, full.width / 2);
  const w = full.width;
  const s = still?.getBoundingClientRect(); // read before the writes below
  const shape = (cut: number): string =>
    `path("M ${-pad} ${-pad} H ${w + pad} V ${cut - r} H ${w} A ${r} ${r} 0 0 1 ${w - r} ${cut} H ${r} A ${r} ${r} 0 0 1 0 ${cut - r} H ${-pad} Z")`;
  // The slide is a registered custom property, not `transform`: a transform animation runs on the
  // compositor and the clip on the main thread, so in a frame where the main thread stalled the
  // slide ran ahead of the clip and the bottom edge rose in the open and fell past the window in
  // the close (his report and the frames, 2026-10-20). A custom property animates on the main
  // thread, so the slide and the clip are computed in the same frame.
  registerQueueDy();
  const low = { [QUEUE_DY]: `${dy}px`, clipPath: shape(full.height - dy - (full.bottom - rest.bottom)) };
  const up = { [QUEUE_DY]: "0px", clipPath: shape(full.height) };
  queue.style.transform = `translateY(var(${QUEUE_DY}))`;
  const a = queue.animate(back ? [up, low] : [low, up], { duration: dur, easing: ease, fill: "both" });
  a.id = "queue-rise";
  // The list's own box follows the visible card (his ask, 2026-10-21): the card is laid out at
  // the column's full height for the whole motion, so its scrollbar thumb was sized for that box
  // and snapped to the resting size in the last frame. A max-height on the list, from the
  // visible height at one end to the other, grows and shrinks the thumb with the edge. The list
  // draws ~20 rows, so the layout per frame is small; it runs on the main thread with the slide.
  const list = queue.querySelector<HTMLElement>(".qcard__list");
  const anims = [a];
  if (list) {
    const at = (cardH: number) => `${Math.max(0, list.offsetHeight - (queue.offsetHeight - cardH))}px`;
    const short = { maxHeight: at(rest.height) }, tall = { maxHeight: at(full.height) };
    const b = list.animate(back ? [tall, short] : [short, tall], { duration: dur, easing: ease, fill: "both" });
    b.id = "queue-rise";
    anims.push(b);
  }
  // The resting place's copy shows only above the Queue's top edge (his report, 2026-10-23): on
  // a see-through skin the two cards' fills stacked where the Queue slid over it, so Happy drew a
  // near-black box that grew with the Queue and went in one frame when the copy was dropped. The
  // edge is linear in the slide, so the same ease keeps the cut on it in every frame.
  if (still && s) {
    const cut = (top: number): string => {
      const y = top - s.top;
      return `polygon(${-pad}px ${-pad}px, ${s.width + pad}px ${-pad}px, ${s.width + pad}px ${y}px, ${-pad}px ${y}px)`;
    };
    const lowS = { clipPath: cut(rest.top) }, upS = { clipPath: cut(full.top) };
    const c = still.animate(back ? [upS, lowS] : [lowS, upS], { duration: dur, easing: ease, fill: "both" });
    c.id = "queue-rise";
    anims.push(c);
  }
  a.addEventListener("cancel", () => {
    anims.forEach((x) => x !== a && x.cancel());
    if (!queue.getAnimations().some((x) => x.id === "queue-rise" && x !== a)) queue.style.removeProperty("transform");
  });
  return anims;
}
const QUEUE_DY = "--fp-queue-dy";
let queueDyRegistered = false;
function registerQueueDy(): void {
  if (queueDyRegistered) return;
  queueDyRegistered = true;
  try {
    CSS.registerProperty({ name: QUEUE_DY, syntax: "<length>", inherits: false, initialValue: "0px" });
  } catch {
    // Registered already (a hot reload of this module): the registration stands.
  }
}
/** The skin's stacked motion (skin.css --player-stack-move): fade or slide. */
const stackMove = (): "fade" | "slide" =>
  getComputedStyle(root).getPropertyValue("--player-stack-move").trim() === "slide" ? "slide" : "fade";
/** Max's content cards: every content slot of the composition (covered while full). */
const maxCards = (): HTMLElement[] =>
  surfaceNow() === "max" ? (opts?.slots() ?? []).map((s) => opts!.hosts[s]).filter((h): h is HTMLElement => !!h) : [];

/** The rows on the band (and the band itself) come in. The fade is a Web Animation, not a CSS
 *  class: layoutNow flips `data-np-rows` to "over" to measure the controls, and a CSS animation
 *  on a rule that names the attribute stops on the flip and starts again from 0 on the flip
 *  back. That was the flash ~60 ms after the open landed, in *below* (2026-10-14). */
function enterBand(panel: HTMLElement): void {
  const center = panel.querySelector<HTMLElement>(".np__center");
  panel.classList.remove("is-player-rebuild");
  if (!center) return;
  // In *below* the rows' box is `display: contents` (it cannot fade): its parts fade.
  const below = fp().dataset.player === "full" && panel.dataset.npRows === "below";
  const dur = reduced() ? 0 : tokenMs("--grow-body-fade");
  if (dur > 0) {
    const easing = getComputedStyle(panel).getPropertyValue("--ease-ui").trim() || "ease";
    // The close square sits outside the rows but hides with them; it fades with them too, or it
    // popped in at once beside the fade (the motion monitor, 2026-10-14).
    const close = panel.querySelector<HTMLElement>(".np__close");
    if (close?.offsetParent) close.animate([{ opacity: 0, offset: 0 }], { duration: dur, easing });
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
  resizedInMotion = false;
  try {
    if (grownState()) await collapseGrow("player", false); // no motion: one motion at a time
    const m = motion();
    const from = rect(panel);
    const fromArt = rect(art);
    const queue = queueHost();
    const fromQueue = queue ? rect(queue) : null;
    const restStill = m && queue ? restCopy(panel) : null; // Max: the resting place stays filled
    const row1 = surface === "midi" ? from.height : undefined;
    // Max: the content cards keep their boxes while the player is open (§14 N1), measured now,
    // while the layout is the resting one.
    const cards = maxCards();
    pin(cards, cards.map(rect));
    // Measure the full layout once, with no paint between: the rows' place, then the cover box.
    apply(true, undefined, row1);
    // Stacked or not is decided here too (a tall window), before the cover box is measured.
    const first = layoutNow(panel);
    stack = first.stack;
    fp().toggleAttribute("data-fp-stack", stack);
    if (first.stackH > 0) opts?.bento.style.setProperty("--fp-stack-h", `${first.stackH}px`);
    const place = first.place;
    panel.dataset.npRows = place;
    const box = rect(art).width * coverShare(); // the cover's width: Metal's peek box is wider than its cover
    // Stacked in Max, the side card is part of the open (§14 N3): it mounts now, hidden, so the
    // motion carries no mount and nothing moves again after it lands.
    wantHistory = first.history;
    const stacked = stack && surface === "max" && first.history;
    if (stacked) warmHistory();
    const px = fullArtPx(box, window.devicePixelRatio, stageArtPx());
    const img = art.querySelector<HTMLImageElement>(".vinyl:not(.vinyl--out) img");
    const big = img?.src ? sizedUrl(img.src, px) : null;
    // The large file loads before the open, so the flight never shows a soft picture (§9.3).
    // Already in memory, the layout stays on and the motion starts in this task (§14 N2).
    const pre = big && m ? preload(big, tokenMs("--player-art-wait")) : null;
    if (pre && !pre.ready) {
      apply(false);
      await pre.wait;
    }
    if (my !== gen || !fullPlayerAvailable() || surfaceNow() !== surface) {
      if (!full) {
        apply(false);
        unpin();
      }
      return;
    }
    artPx = 0;
    askArt(box);

    full = true;
    openedOn = surface;
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
    placeStill(restStill);
    // Max: the card box moves from the resting place to the full one (§14.10); Midi: the clip
    // opens from the strip, which is inside the full box.
    const moving = surface === "max";
    const anims: Animation[] = moving
      ? ghostMotion(panel, from, to, fromArt, toArt, from, m.dur, m.ease)
      : [
          panel.animate([{ clipPath: clipBetween(fullClipFrom(from, to, surface, pad), to, pad, radius) }, { clipPath: clipOpen(pad, radius) }], {
            duration: m.dur, easing: m.ease, fill: "both",
          }),
        ];
    if (fly) anims.push(flyAnim(fly, fromArt, toArt, m.dur, m.ease, false));
    const move = stacked ? stackMove() : null;
    if (queue && fromQueue && move) {
      // Stacked (§14.4): the Queue goes from its column to the band under the player. A still of
      // it stays in the column and fades under the growing player.
      const toQueue = rect(queue);
      const qStill = stillOf(queue, fromQueue);
      qStill?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: m.dur, easing: m.ease, fill: "both" });
      const side = historyHost();
      if (move === "slide") {
        // It slides down into the band while the side card slides in from its edge.
        const a = queue.animate([{ transform: `translate(${fromQueue.left - toQueue.left}px, ${fromQueue.top - toQueue.top}px)` }, { transform: "none" }], {
          duration: m.dur, easing: m.ease,
        });
        a.id = "stack-move";
        anims.push(a);
        if (side) {
          fp().dataset.fpHistory = "on";
          paintZones();
          const s = side.animate([{ transform: awayX() }, { transform: "none" }], { duration: m.dur, easing: m.ease });
          s.id = "stack-move";
          anims.push(s);
        }
      } else {
        // Fade: out of view until the cover lands; then the band rises in (below).
        queue.style.opacity = "0";
      }
    } else if (queue && fromQueue) {
      // Max: the Queue grows up over the place Now Playing left, in the same time (§9.4.3).
      // Its rows ride its top edge (§14.6, 2026-10-18): a clip alone showed the middle of the
      // tall list in the resting box, and the rows jumped at the first frame and the last.
      anims.push(...queueRise(queue, fromQueue, rect(queue), pad, m.dur, m.ease, false));
    }
    let rowsIn = false;
    const rows = () => {
      if (rowsIn) return;
      rowsIn = true;
      enterBand(panel);
    };
    // The moving box carries no rows: they come in when it lands, in the real card.
    const rowsTimer = moving ? 0 : window.setTimeout(rows, m.rowsAt);
    await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    window.clearTimeout(rowsTimer);
    anims.forEach((a) => a.cancel());
    fly?.remove();
    art.style.visibility = "";
    if (my === gen) {
      dropGhost(); // a close that took over owns the box now
      dropStill(); // a close that took over owns the copy now
      queueStills.forEach((s) => s.remove());
      queueStills = [];
    }
    endFrames();
    delete panel.dataset.frames;
    if (full && my === gen) {
      // The covered cards are at opacity 0 and take no click (`.is-covering`). `cover` adds
      // `inert` and `visibility: hidden`, which restyle every element inside them (~1,100,
      // 12 ms on the landing frame, frame-why.mjs, 2026-10-18): once the rows and the band
      // have come in, in a frame where nothing moves.
      window.setTimeout(() => {
        if (full && my === gen) covered.forEach(cover);
      }, m.dur);
      rows();
      if (move === "fade" && queue) {
        // The band (the Queue and the side card) rises in, as the rows do.
        queue.style.removeProperty("opacity");
        const side = historyHost();
        if (side) {
          fp().dataset.fpHistory = "on";
          paintZones();
        }
        enterRows(side ? [queue, side] : [queue], 2);
      }
    }
  } finally {
    if (my === gen) busy = false;
  }
  // The History column waits for the open to land: its card mounts hidden, and two frames
  // later it slides in when the card is wide. The check measures the layout again (~20 ms,
  // frame-why.mjs, 2026-10-18), so it runs only when something can have changed: a resize
  // during the open, or a column still to come.
  if (full && my === gen) {
    warmHistory();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!full || my !== gen) return;
      if (resizedInMotion || wantHistory !== (fp().dataset.fpHistory === "on")) refit(panel);
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
  // A close during the open's motion: the open's animations end, then the snap. Its moving box
  // is read first: the close's box starts where that one is now, not at the full box.
  const midway = ghost ? rect(ghost) : null;
  dropGhost();
  panel?.getAnimations().forEach((a) => a.cancel());
  opts?.hosts.queue?.getAnimations().forEach((a) => a.cancel());
  document.querySelectorAll(".np__fly").forEach((f) => f.remove());
  dropStill();
  dropStackBits();
  if (art) art.style.visibility = "";
  // Stacked in Max, the side card leaves with the Queue's motion (§14.4). Otherwise the History
  // column ends at once: the close measures the layout without it.
  const stacked = !!m && stack && surface === "max";
  if (!stacked) dropHistory();
  panel?.getAnimations({ subtree: true }).forEach((a) => a.id === "rows-slide" && a.cancel());
  busy = true;
  const covered = coveredHosts();
  const end = () => {
    full = false;
    dropGhost();
    dropHistory(cause !== "surface" && cause !== "layout"); // those remount the slots
    dropStackBits();
    unpin(); // each held card is at its resting box already: the grid takes it there, no jump
    apply(false);
    stack = false; // the next open decides again
    opts?.bento.style.removeProperty("--fp-stack-h");
    covered.forEach(uncover);
    watch?.disconnect();
    watch = null;
    shareWatch?.disconnect();
    shareWatch = null;
    artPx = 0;
    setFullArtPx(0);
    // The cover goes back to the rest file (already in the cache), one frame after the layout
    // goes back, so the last frame of the close carries only the layout (§14 N4).
    requestAnimationFrame(() => {
      if (!full) refreshPlayerState();
    });
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
  // The held cards are measured where the resting grid puts them now (the window may have
  // changed size while full), then held there for the motion.
  const cards = maxCards();
  unpin(cards);
  apply(false);
  const rest = rect(panel);
  const restArt = rect(art);
  const restQueue = queue ? rect(queue) : null;
  const restCards = cards.map(rect);
  const restStill = queue ? restCopy(panel) : null; // Max: the resting place fills as the Queue goes
  apply(true, place, row1 ? parseFloat(row1) : undefined);
  pin(cards, restCards);

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
  placeStill(restStill);
  // Max: the card box moves back to the resting place (§14.10); Midi: the clip closes to the strip.
  const moving = surface === "max";
  const anims: Animation[] = moving
    ? ghostMotion(panel, midway ?? to, rest, toArt, restArt, rest, m.collapseDur, m.ease)
    : [
        panel.animate([{ clipPath: clipOpen(pad, radius) }, { clipPath: clipBetween(fullClipFrom(rest, to, surface, pad), to, pad, radius) }], {
          duration: m.collapseDur, easing: m.ease, fill: "both",
        }),
      ];
  if (fly) anims.push(flyAnim(fly, restArt, toArt, m.collapseDur, m.ease, true));
  if (stacked && queue && toQueue && restQueue) {
    // Stacked (§14.4): the Queue goes back to its column, held at its resting box, so the grid's
    // change at the end moves nothing. A still of the band's Queue fades where it was.
    const qStill = stillOf(queue, toQueue);
    pin([queue], [restQueue]);
    const side = fp().dataset.fpHistory === "on" ? historyHost() : null;
    if (stackMove() === "slide") {
      qStill?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: m.collapseDur, easing: m.ease, fill: "both" });
      const a = queue.animate([{ transform: `translate(${toQueue.left - restQueue.left}px, ${toQueue.top - restQueue.top}px)` }, { transform: "none" }], {
        duration: m.collapseDur, easing: m.ease,
      });
      a.id = "stack-move";
      anims.push(a);
      if (side) {
        const s = side.animate([{ transform: "none" }, { transform: awayX() }], { duration: m.collapseDur, easing: m.ease, fill: "forwards" });
        s.id = "stack-move";
        anims.push(s);
      }
    } else {
      // Fade: the band goes first, as the rows do; the Queue fades in at its column under the
      // shrinking player, with the content cards.
      const out = Math.round(m.collapseDur * 0.4);
      qStill?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, easing: m.ease, fill: "both" });
      if (side) side.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, easing: m.ease, fill: "forwards" }).id = "stack-move";
      const a = queue.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: m.collapseDur, easing: m.ease, fill: "both" });
      a.id = "stack-move";
      anims.push(a);
    }
  } else if (queue && toQueue && restQueue) {
    anims.push(...queueRise(queue, restQueue, toQueue, pad, m.collapseDur, m.ease, true));
  }
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
  if (my !== gen) return; // something else ended it (a surface change) and cleaned up
  end();
  anims.forEach((a) => a.cancel());
  fly?.remove();
  art.style.visibility = "";
  covered.forEach((h) => h.classList.remove("is-uncovering"));
  endFrames();
  if (moving) {
    // The box landed on the bare still: the real card takes the place, its rows come in.
    dropGhost();
    dropStill();
    enterBand(panel);
  } else if (still) {
    // The copy already shows the resting rows in this place: the real card takes over in the
    // same frame, with no fade (a fade here would dim rows that were on screen).
    dropStill();
    panel.classList.remove("is-player-rebuild");
  } else {
    enterBand(panel); // the rows come in at their rest place
  }
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
  // An observer reports the size it starts on, at once: the open has just measured that size,
  // so its first report is skipped (a full measure in the motion's first frame, 2026-10-18).
  let started = false;
  watch = new ResizeObserver(() => {
    if (!started) return void (started = true);
    refit(panel);
  });
  watch.observe(np);
  // Stacked, the card's row is a fixed height (--fp-stack-h), so a window that changes only its
  // height (a drag on the bottom edge, or a shared edge in a snap group) does not resize the
  // card: the grid it sits in follows the window, and is watched too (2026-10-23, his report:
  // stuck stacked with the band under the window's edge).
  if (opts?.bento) watch.observe(opts.bento);
  // A look change can change the cover's share (--fp-cover-share: Metal's peek on or off) or the
  // title block's place (--fp-meta-below: Metal or not) with no change of size: lay out again
  // when either differs from what the layout was measured with. During the open's motion the layout waits for the landing check (resizedInMotion);
  // that covers a change during the cover's preload too, before this watch existed. A surface
  // change resizes the card, so the size watch above takes it.
  shareWatch?.disconnect();
  const check = (): void => {
    if (coverShare() === measuredShare && metaBelow() === measuredMeta && offCover() === (measuredClose !== null)) return;
    if (busy) resizedInMotion = true;
    else refit(panel);
  };
  shareWatch = new MutationObserver(check);
  shareWatch.observe(root, { attributes: true, attributeFilter: ["data-skin", "data-hook-material", "data-metal-peek", "data-metal-cover", "data-np-off-cover"] });
  check();
}

/** While full: put the rows and the History column where the card's size says. The open and
 *  the close have their own motion: during one, the rows snap and the column waits for the
 *  end of the open (refit runs again then). */
function refit(panel: HTMLElement): void {
  if (!full) return;
  const art = artOf(panel);
  const next = layoutNow(panel);
  const histNow = fp().dataset.fpHistory === "on";
  if (busy) {
    if (next.stack !== stack || panel.dataset.npRows !== next.place || next.history !== wantHistory) resizedInMotion = true;
    setStack(next.stack, next.stackH);
    if (panel.dataset.npRows !== next.place) panel.dataset.npRows = next.place;
  } else if (panel.dataset.npRows !== next.place || next.history !== histNow || next.stack !== stack) {
    slideRows(panel, next);
  } else {
    setStack(stack, next.stackH); // the same layout: only the player's height follows the window
  }
  if (art) askArt(rect(art).width * coverShare());
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
  // Stacked and full: every side closes the player (his ask, 2026-10-18). The gap over the
  // cards (down) and the padding under the title bar (up) are whole gaps; the card's sides are
  // the window's edges. Midi keeps its two sides only (top and bottom), as at rest.
  if (full && stack) {
    if (side === "down" || side === "up") return "full";
    return s === "max" ? "edge" : null;
  }
  if (s === "midi") {
    if (side === "up") return "full";
    if (side === "down") return full ? "edge" : "full";
    return null;
  }
  if (s === "max") {
    // Full: all four sides close the player (his ask, 2026-10-18). Left is the gap beside the
    // left column (the Queue, or the side card when flipped); right is the window edge, or the
    // gap beside the side column while it shows; up is the padding under the title bar; down is
    // the window edge.
    if (full) {
      if (side === "left" || side === "up") return "full";
      if (side === "right") return fp().dataset.fpHistory === "on" ? "full" : "edge";
      return "edge";
    }
    if (side === "left") return "edge";
    // Half the gap beside the stage when a card's strip takes the other half (the Fill strips of
    // four-card Max, or a grown card's collapse strip); the whole gap when none is there.
    if (side === "right") return stageGapShared() ? "half" : "full";
    // The top and the bottom of the resting card open it too (his ask, 2026-10-11). The bottom
    // gap is the Queue's as well (its grow up over Now Playing): each takes half of it, also
    // while another card is grown (both strips act then, 2026-10-14).
    if (side === "up") return "full";
    if (side === "down") return "half";
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
  // Shade behind the title (§16): the attribute the band's CSS reads.
  const applyShade = () => { document.documentElement.dataset.npShade = setting("npShade"); };
  applyShade();
  // Title under the cover (§17): the attribute the layout reads (the look watch lays out again).
  const applyOffCover = () => { root.dataset.npOffCover = setting("npOffCover") ? "on" : "off"; };
  applyOffCover();
  onSettingsChange((k) => {
    if (k === "npShade") applyShade();
    if (k === "npOffCover") applyOffCover();
    if (k === "cardGrow") emit();
    // Layout for Max changed: close with no motion before the layout remounts (MAX-CARDS.md).
    if (k === "maxCards") {
      if (full) void closeFullPlayer("layout", false);
      else dropHistory(false); // the kept side card goes with the old layout
      paintZones();
    }
  });
  // A surface change ends it with no motion, before the layout remounts the slots.
  onSurfaceChange(() => {
    if (full) void closeFullPlayer("surface", false);
    else dropHistory(false);
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

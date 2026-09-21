// Card swap motion (Settings › Animate card swaps; docs/cards/CARD-SWAP.md).
// layout.ts hands each pick here in two steps:
//   out — a skin with an out phase (--swap-out-dur > 0, Cyber) plays the leaving
//         cards out first; the remount waits for it. Other skins remount at once.
//   in  — after the remount, each new card plays from the slot it left, or rises in.
// JS only measures the slot a card left; the shape and the timing are skin tokens (skin.css
// §card swap, styles.css §Card swap). On by default (since 2026-09-16); the OS reduced-motion preference snaps.

import { setting } from "./settings-store";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";

/** One panel to animate. `from` is the slot its card left; none = a replace (it rises in). */
export interface SwapMove {
  el: HTMLElement;
  from?: HTMLElement;
}

const CLASSES = ["swap-out", "swap-in", "swap-top", "swap-rise"];
const MOVING = ".bento .panel.swap-out, .bento .panel.swap-in, .bento .panel.swap-rise";
const LAST = new Set(["card-swap-shape", "card-swap-rise"]); // the animation that ends a panel's in step
const handlers = new WeakMap<HTMLElement, (e: AnimationEvent) => void>();
let closeWin: (() => void) | null = null;
let pending: { run: () => void; els: HTMLElement[]; timer: number } | null = null;

const reduced = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
const motionOn = (): boolean => setting("cardSwapMotion") && !reduced();

/** A slot on screen has a box; mini's hidden right slot has none. */
export const onScreen = (el: HTMLElement | null | undefined): el is HTMLElement =>
  !!el && el.getClientRects().length > 0;

function clear(el: HTMLElement): void {
  el.classList.remove(...CLASSES);
  el.style.removeProperty("--swap-dx");
  el.style.removeProperty("--swap-dy");
  el.style.removeProperty("--swap-i");
  const h = handlers.get(el);
  if (h) el.removeEventListener("animationend", h);
  handlers.delete(el);
}

function openWin(detail: string): void {
  closeWin ??= frames.begin("swap", `${detail} ${document.documentElement.dataset.skin ?? ""}`.trim());
}
function closeWinNow(): void {
  closeWin?.();
  closeWin = null;
}

/** A remount still waiting on its out step runs now (a new pick, a surface change), so the
 *  caller reads a current layout. */
export function flushSwapOut(): void {
  const p = pending;
  if (!p) return;
  pending = null;
  window.clearTimeout(p.timer);
  p.els.forEach(clear);
  p.run(); // same task as the clear: the old card never paints back at rest
}

/** The out step: the leaving cards play out, then `run` remounts. No out phase in this skin,
 *  motion off, or nothing on screen: `run` at once. */
export function playOut(els: HTMLElement[], run: () => void, detail: string): void {
  flushSwapOut();
  const ms = els.length && motionOn() ? tokenMs("--swap-out-dur") : 0;
  if (ms <= 0) {
    run();
    return;
  }
  document.querySelectorAll<HTMLElement>(MOVING).forEach(clear);
  openWin(detail);
  // A panel hidden mid-step (a surface flip) sends no animationend: the timer still lands it.
  const p = { run, els, timer: window.setTimeout(() => pending === p && flushSwapOut(), ms + 100) };
  pending = p;
  void els[0].offsetWidth;
  let running = els.length;
  els.forEach((el) => {
    el.classList.add("swap-out");
    const done = (e: AnimationEvent) => {
      if (e.target !== el || e.animationName !== "card-swap-out") return;
      if (--running === 0 && pending === p) flushSwapOut();
    };
    handlers.set(el, done);
    el.addEventListener("animationend", done);
  });
}

/** Resolves once no card is moving — the out step and every in step have ended (the chip
 *  flight waits on it, handoff.ts). A cap resolves it anyway: a hidden panel sends no
 *  animationend. */
export function whenSwapSettled(): Promise<void> {
  const cap = performance.now() + tokenMs("--swap-out-dur") + tokenMs("--swap-dur") + tokenMs("--swap-stagger") + 300;
  return new Promise((resolve) => {
    const check = () => {
      if ((pending || document.querySelector(MOVING)) && performance.now() < cap) requestAnimationFrame(check);
      else resolve();
    };
    check();
  });
}

/** The in step. The first move is the card the user picked: it passes over the other. */
export function playSwap(moves: SwapMove[], detail: string): void {
  if (!moves.length || !motionOn()) return closeWinNow();
  // A pick during a run: every panel still moving snaps home first, so each rect below is its slot.
  document.querySelectorAll<HTMLElement>(MOVING).forEach(clear);
  moves.forEach((m) => clear(m.el));
  void moves[0].el.offsetWidth; // restart an animation that was still running

  openWin(detail);
  // Measure every slot before any class lands: `both` fill puts a started card at its old
  // slot at once, and the second card's `from` is the first card's panel.
  const rects = moves.map((m) => ({ at: m.el.getBoundingClientRect(), from: m.from?.getBoundingClientRect() }));
  let running = moves.length;
  moves.forEach((m, i) => {
    const el = m.el;
    const { at, from } = rects[i];
    if (from) {
      el.style.setProperty("--swap-dx", `${Math.round(from.left - at.left)}px`);
      el.style.setProperty("--swap-dy", `${Math.round(from.top - at.top)}px`);
      el.style.setProperty("--swap-i", String(i));
      el.classList.add("swap-in");
      if (i === 0) el.classList.add("swap-top");
    } else {
      el.classList.add("swap-rise");
    }
    const done = (e: AnimationEvent) => {
      if (e.target !== el || !LAST.has(e.animationName)) return; // a spinner inside the card is not the card's
      clear(el);
      if (--running === 0) closeWinNow();
    };
    handlers.set(el, done);
    el.addEventListener("animationend", done);
  });
}

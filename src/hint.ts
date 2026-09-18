// Hover hints — the app's one hover-text primitive (docs/ONBOARDING.md §1).
//
// Until 2026-09-15 every hint was the native `title` box: the Windows tooltip, about a
// second of delay, no theme, one line only. This module replaces all of them with a
// themed box that wears the menu material, and adds a second line so a cut-off song row
// can show the song AND the artist.
//
// It is CENTRAL by adoption, not by edit. Nothing at a call site changed: you still write
// `title="…"` in markup or `el.title = "…"` in code. On boot this module sweeps the page,
// moves every `title` value to `data-hint`, and REMOVES the attribute so Windows never
// draws its own box. A MutationObserver does the same for every element added later and
// for every later `title` write, so state-driven hints (Play/Pause, Favorite/Unfavorite)
// keep working untouched.
//
// Two kinds of hint:
//   • a WRITTEN hint — what a `title` said. One line, the author's words.
//   • a ROW hint — the song/album name and the line under it, read off the row itself.
//     No author writes these; SHAPES below lists the row and tile shapes the cards build,
//     and the box shows the full text the ellipsis cut off.
// The deeper element wins: the Add button inside a song row shows "Add to Library", the
// rest of the row shows the song.
//
// Settings (Settings › Menus, hints and notices):
//   hoverHints       off = no hover text at all, of either kind
//   hoverHintDelay   how long the pointer rests first; a row waits ROW_WAIT× as long
//   hoverSongNames   the row hint: on every row, only when the name is cut off, or never
//
// Accessibility: `aria-label` stays the accessible name. Where an element had a `title`
// and no accessible name of its own (an icon button with no label), adoption promotes the
// hint to `aria-label`, so removing the attribute takes nothing away. The box itself is
// `aria-hidden` and never takes the pointer.
//
// Not shown for a touch pointer (there is no hover to rest), and the rise is dropped under
// reduced motion (styles/hint.css).

import { setting } from "./settings-store";
import { creditsFor } from "./credits";
import "./styles/hint.css";

/** Settings › Hints appear after, in ms. */
const DELAY = { quick: 250, normal: 600, slow: 1100 } as const;
/** A song row waits longer than a button: scanning a list must stay quiet. */
const ROW_WAIT = 1.6;
/** Move to another anchor within this long of a hint closing and the next one is instant. */
const WARM_MS = 400;

/** A row shape a card builds: the row itself, its title line, and the line under it. */
interface Shape {
  row: string;
  title: string;
  sub?: string;
}
const SHAPES: Shape[] = [
  { row: ".lib-row", title: ".lib-row__title", sub: ".lib-row__artist" }, // Library, album + playlist song lists
  { row: ".lib-tile", title: ".lib-tile__name", sub: ".lib-tile__sub" }, // Library tiles
  { row: ".lib-hero", title: ".lib-hero__title", sub: ".lib-hero__sub" }, // a collection's own header
  { row: ".qrow", title: ".qrow__title", sub: ".qrow__artist" }, // Queue, Rewind, History, Playing next
  { row: ".qnow", title: ".qnow__title", sub: ".qnow__artist" }, // the queue / history hero row
  { row: ".search__song", title: ".search__song-title", sub: ".search__song-artist" }, // Search's Songs results
  { row: ".search__row", title: ".search__song-title", sub: ".search__song-artist" }, // a Search album / playlist / artist song list
  { row: ".search__tile", title: ".search__tile-name", sub: ".search__tile-sub" }, // Search tiles, Home + Artist shelves
  { row: ".search__artist", title: ".search__artist-name" }, // the round artist tile
  { row: ".np", title: ".np__title", sub: ".np__artist" }, // Now Playing
];
/** One selector for the whole table: `resolve` tests this per ancestor, and only looks the
 *  shape up on a hit. A pointer crossing a list walks a lot of ancestors. */
const ROW_SEL = SHAPES.map((s) => s.row).join(",");

interface Hint {
  text: string;
  sub?: string;
  /** A song row's writers, under a blank line (CREDITS.md §7). */
  credit?: string;
  /** A row hint waits longer and can be turned off on its own. */
  row: boolean;
}

let box: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let subEl: HTMLElement | null = null;
let creditEl: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let timer = 0;
let closedAt = 0;
let showing = false;
/** Pressed under the pointer: stays quiet until the pointer moves off it. A press answers
 *  the question the hint was there to answer, so re-showing it reads as a twitch. */
let pressed: HTMLElement | null = null;

function ensureBox(): HTMLElement {
  if (box) return box;
  box = document.createElement("div");
  box.className = "hint";
  box.setAttribute("aria-hidden", "true");
  box.hidden = true;
  titleEl = document.createElement("span");
  titleEl.className = "hint__title";
  subEl = document.createElement("span");
  subEl.className = "hint__sub";
  creditEl = document.createElement("span");
  creditEl.className = "hint__credit";
  box.append(titleEl, subEl, creditEl);
  document.body.appendChild(box);
  return box;
}

// ── Adoption: every `title` becomes a `data-hint`, and the attribute goes ──────────

function adopt(el: Element): void {
  const raw = el.getAttribute("title");
  if (raw === null) return;
  el.removeAttribute("title"); // before anything else: Windows must never get the chance
  const text = raw.trim();
  const host = el as HTMLElement;
  if (!text) {
    delete host.dataset.hint;
  } else {
    host.dataset.hint = text;
    // The hint was the only name this control had — keep it for a screen reader.
    const named = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby");
    if (!named && !(el.textContent ?? "").trim()) el.setAttribute("aria-label", text);
  }
  if (anchor === host && showing) fill(host); // a hint that changed under the pointer (Play → Pause)
}

function sweep(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute("title")) adopt(root);
  root.querySelectorAll?.("[title]").forEach(adopt);
}

// ── What the pointer is on ────────────────────────────────────────────────────────

const cutOff = (el: HTMLElement | null): boolean => !!el && el.scrollWidth > el.clientWidth + 1;

function rowHint(row: HTMLElement, shape: Shape): Hint | null {
  const mode = setting("hoverSongNames");
  if (mode === "off") return null;
  const t = row.querySelector<HTMLElement>(shape.title);
  const s = shape.sub ? row.querySelector<HTMLElement>(shape.sub) : null;
  const text = t?.textContent?.trim() ?? "";
  const sub = s?.textContent?.trim() ?? "";
  if (!text && !sub) return null; // a row still waiting for its data
  // The writers (CREDITS.md §7). A song row only — the id is on the row itself, so a tile
  // or an artist row never asks. The read is synchronous and local: a song we have not
  // collected yet simply has no third line, and asking warms it for the next hover.
  const credit = row.dataset.cid ? creditsFor(row.dataset.cid)?.composer : undefined;
  // The song name being cut off is not the only reason to hover a row any more, so a row
  // that has credits shows them even under "only when the name is cut off".
  if (mode === "cut" && !credit && !cutOff(t) && !cutOff(s)) return null;
  return { text, sub: sub || undefined, credit, row: true };
}

/** Walk up from the pointer. The first element that can say something owns the hint. */
function resolve(from: Element | null): { el: HTMLElement; hint: Hint } | null {
  for (let el = from as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el === box) return null;
    const node = el;
    if (node.matches(ROW_SEL)) {
      const shape = SHAPES.find((s) => node.matches(s.row))!;
      const h = rowHint(node, shape);
      if (h) return { el: node, hint: h };
    }
    // A row that carries a written hint too (a Home tile) falls back to it when the row
    // hint is off, so turning song names off never leaves a control silent.
    const written = node.dataset.hint;
    if (written) return { el: node, hint: { text: written, row: false } };
  }
  return null;
}

// ── Showing ───────────────────────────────────────────────────────────────────────

/** The floating tier (z 100): pop panels, menus, flyouts, the settings and slot pickers. */
const FLOATING = ".pop, .ctx-menu, .flyout, .set__menu, .slot-picker__menu";

function fill(el: HTMLElement): boolean {
  const found = resolve(el);
  if (!found || found.el !== el) return false;
  const b = ensureBox();
  titleEl!.textContent = found.hint.text;
  subEl!.textContent = found.hint.sub ?? "";
  subEl!.hidden = !found.hint.sub;
  creditEl!.textContent = found.hint.credit ?? "";
  creditEl!.hidden = !found.hint.credit;
  b.classList.toggle("hint--row", found.hint.row);
  // A control inside a floating panel (a pop panel, a menu, a flyout): the hint goes above
  // that tier, or the panel it explains covers it. Everywhere else it stays under menus.
  b.classList.toggle("hint--over", !!el.closest(FLOATING));
  return true;
}

function place(el: HTMLElement, px: number): void {
  const b = ensureBox();
  const r = el.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(b).getPropertyValue("--hint-gap")) || 8;
  const edge = 6; // never touch the window edge
  const bw = b.offsetWidth;
  const bh = b.offsetHeight;
  // Follow the pointer across the row, so a wide row's hint sits where you are looking.
  const centre = Number.isFinite(px) ? px : r.left + r.width / 2;
  const left = Math.max(edge, Math.min(Math.round(centre - bw / 2), window.innerWidth - bw - edge));
  let top = Math.round(r.bottom + gap);
  if (top + bh > window.innerHeight - edge) top = Math.round(r.top - gap - bh); // no room below: flip above
  b.style.left = `${left}px`;
  b.style.top = `${Math.max(edge, top)}px`;
}

function show(el: HTMLElement, px: number): void {
  if (!el.isConnected) return;
  const b = ensureBox();
  b.hidden = false;
  if (!fill(el)) {
    b.hidden = true;
    return;
  }
  place(el, px);
  void b.offsetWidth; // the box was display:none — start the fade from 0
  b.classList.add("is-on");
  showing = true;
}

function hide(): void {
  if (!anchor && !showing && !timer) return; // nothing is up — a scroll must cost nothing
  clearTimeout(timer);
  timer = 0;
  anchor = null;
  if (!box) return;
  if (showing) closedAt = performance.now();
  showing = false;
  box.classList.remove("is-on");
  box.hidden = true;
}

function enter(target: Element | null, px: number): void {
  if (!setting("hoverHints")) return;
  const found = resolve(target);
  if (!found) {
    pressed = null;
    if (anchor) hide();
    return;
  }
  if (found.el !== pressed) pressed = null; // the pointer moved on — the press is spent
  if (found.el === anchor || found.el === pressed) return;
  const warm = showing || performance.now() - closedAt < WARM_MS;
  const el = found.el;
  const row = found.hint.row;
  hide();
  anchor = el;
  const base = DELAY[setting("hoverHintDelay")];
  const wait = warm ? 0 : Math.round(row ? base * ROW_WAIT : base);
  if (wait === 0) show(el, px);
  else timer = window.setTimeout(() => show(el, px), wait);
}

let started = false;

/** Adopt every hint on the page and start listening. Call once, after the DOM exists. */
export function initHints(): void {
  if (started) return;
  started = true;
  sweep(document);

  new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === "attributes") {
        if (r.target instanceof Element) adopt(r.target);
      } else {
        r.addedNodes.forEach((n) => {
          if (n instanceof Element) sweep(n);
        });
      }
    }
    if (anchor && !anchor.isConnected) hide(); // the row under the pointer was re-rendered away
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  });

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return; // nothing rests on a touch screen
    enter(e.target as Element | null, e.clientX);
  });
  // A press is intent; the hint has said what it had to say, and must not come back
  // under the pointer that is still resting on the control it just pressed.
  document.addEventListener(
    "pointerdown",
    (e) => {
      pressed = resolve(e.target as Element | null)?.el ?? null;
      hide();
    },
    true,
  );
  document.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
  document.addEventListener("scroll", hide, true); // capture: a card's own scroller too
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  // Keyboard: the hint follows focus the way it follows the pointer. `:focus-visible`
  // keeps it to keyboard focus — a click already focuses what it pressed.
  document.addEventListener("focusin", (e) => {
    const el = e.target as Element | null;
    if (!el?.matches?.(":focus-visible")) return;
    enter(el, NaN);
  });
  document.addEventListener("focusout", hide);
}

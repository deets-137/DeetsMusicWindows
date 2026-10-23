// The grand opening (docs/features/GRAND-OPENING.md) — one large card over every other card
// on the app's first launch. The owner designs what it holds, piece by piece.
//
// The card is a `.panel`, so it wears each skin's card material (fill, edge, corners,
// shadow) with no new color. It sits inside `.app-body` on the bento's own edges, so the
// title bar stays usable above it. A nav bar on its left picks the page in the pane to its
// right: pages 1–3 from the top (the welcome §5, the layout §7, Fashion §8), Settings at the foot (§2–§4).
//
// The motion (§4): the picked mark glides along the bar to the button pressed, and the page
// slides the same way — a button lower in the bar brings its page up from below. Both ride the
// in-card nav tokens (--nav-dur, --nav-ease, --nav-off-opacity); the page's two positions
// are --ob-page-above / --ob-page-below (skin.css).
//
// It opens on a brand-new install (settings-store.ts `isFreshInstall`: the saved
// `openingPending`, so a launch that quits during it opens it again), after the launch cover,
// and the first-run walk (walk.ts) waits for it to close: the sprites point at controls this
// card would hide. Closing it clears `openingPending`. `__onboarding.open()` and
// the Compass's Onboarding row open it at any time.

import { isFreshInstall, setting, setSetting } from "./settings-store";
import * as diag from "./diag";
import * as frames from "./frames";
import { settingsCard } from "./settings-card";
import { mountWelcome } from "./onboarding-welcome";
import { mountLooks } from "./onboarding-looks";
import { mountFashion } from "./onboarding-fashion";
import { mountNitpicks } from "./onboarding-nitpicks";
import { mountLetter } from "./onboarding-letter";
import type { CardInstance } from "./cards";
import { tokenMs, revealApp } from "./boot-cover";
import { applePlaylistsSync, notifyPlaylistsChanged } from "./playlists";
import { motionReduced } from "./motion";
import "./styles/onboarding.css";

declare global {
  interface Window {
    __onboarding?: { open: () => Promise<void>; close: () => void };
  }
}

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /></svg>';
/** The title bar's cog (index.html `#cog-open`), so the nav button reads as the same thing. */
const ICON_COG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.41 2.96A9.4 9.4 0 0 1 14.59 2.96L14.75 6.11A6.5 6.5 0 0 1 15.73 6.68L18.53 5.24A9.4 9.4 0 0 1 21.12 9.73L18.48 11.43A6.5 6.5 0 0 1 18.48 12.57L21.12 14.27A9.4 9.4 0 0 1 18.53 18.76L15.73 17.32A6.5 6.5 0 0 1 14.75 17.89L14.59 21.04A9.4 9.4 0 0 1 9.41 21.04L9.25 17.89A6.5 6.5 0 0 1 8.27 17.32L5.47 18.76A9.4 9.4 0 0 1 2.88 14.27L5.52 12.57A6.5 6.5 0 0 1 5.52 11.43L2.88 9.73A9.4 9.4 0 0 1 5.47 5.24L8.27 6.68A6.5 6.5 0 0 1 9.25 6.11L9.41 2.96Z"/><circle cx="12" cy="12" r="3"/></svg>';

/** The pages the nav bar opens, in the bar's order from the top (the order the slide reads).
 *  Each of pages 1–5 shows its number on its button until the owner draws its icon. */
const PAGES = ["one", "two", "three", "four", "five", "settings"] as const;
type Page = (typeof PAGES)[number];
const NUMBERED: [Page, number][] = [["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5]];
/** The last numbered page: its button is *Let's Boogie*. */
const LAST: Page = "five";

/** One page in the pane: its box, the card mounted in it (Settings), and its slide in. */
interface Shown {
  page: Page;
  el: HTMLElement;
  inst: CardInstance | null;
  anim?: Animation;
}

let card: HTMLElement | null = null;
let closed: (() => void) | null = null;
let current: Shown | null = null;
/** Pages still sliding out. A new press drops them at once (never two leaving). */
const leaving = new Set<Shown>();
let sizeWatch: ResizeObserver | null = null;

function buildPage(page: Page): Shown {
  const el = document.createElement("div");
  el.className = "onboarding__page";
  el.dataset.page = page;
  // Page 1 is the welcome (onboarding-welcome.ts). Settings is the whole Settings card, as it
  // is in a slot: its header, its search and every section.
  const inst =
    page === "settings" ? settingsCard.mount(el)
    : page === "one" ? mountWelcome(el)
    : page === "two" ? mountLooks(el)
    : page === "three" ? mountFashion(el)
    : page === "four" ? mountNitpicks(el)
    : mountLetter(el);
  return { page, el, inst };
}

function dropPage(p: Shown): void {
  p.anim?.cancel();
  p.inst?.destroy();
  p.el.remove();
  leaving.delete(p);
}

/** Moves the picked mark to the pressed button. `still` places it with no glide (the open,
 *  a resize). */
function glide(still: boolean): void {
  if (!card || !current) return;
  const mark = card.querySelector<HTMLElement>(".onboarding__mark");
  const btn = card.querySelector<HTMLElement>(`[data-ob-page="${current.page}"]`);
  if (!mark || !btn) return;
  mark.classList.toggle("is-still", still);
  mark.style.setProperty("--ob-mark-y", `${btn.offsetTop}px`);
  mark.style.setProperty("--ob-mark-w", `${btn.offsetWidth}px`);
  mark.style.setProperty("--ob-mark-h", `${btn.offsetHeight}px`);
  if (still) {
    void mark.offsetWidth; // commit the place before the glide comes back on
    mark.classList.remove("is-still");
  }
}

/** Shows one page in the pane to the right of the nav bar. */
function showPage(page: Page): void {
  if (!card || current?.page === page) return;
  const pane = card.querySelector<HTMLElement>(".onboarding__pages")!;
  const prev = current;
  const next = buildPage(page);
  pane.append(next.el);
  current = next;
  for (const b of card.querySelectorAll<HTMLElement>("[data-ob-page]")) b.setAttribute("aria-pressed", String(b.dataset.obPage === page));
  paintForward(page);
  glide(!prev);
  diag.log("onboarding:page", { page });
  if (!prev) return;

  for (const p of [...leaving]) dropPage(p);
  const dur = tokenMs("--nav-dur");
  if (dur <= 0 || motionReduced()) return dropPage(prev);

  const css = getComputedStyle(card);
  const tok = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
  const ease = tok("--nav-ease", "ease");
  const center = tok("--nav-at-center", "none");
  const above = tok("--ob-page-above", "none");
  const below = tok("--ob-page-below", "none");
  const off = Number(tok("--nav-off-opacity", "1"));
  // Lower in the bar = the new page comes up from below and the old one leaves upward.
  const down = PAGES.indexOf(page) > PAGES.indexOf(prev.page);
  // A press mid-slide: the page still coming in leaves from where it is now, not from the middle.
  const now = getComputedStyle(prev.el);
  const from = prev.anim ? { transform: now.transform, opacity: Number(now.opacity) } : { transform: center, opacity: 1 };
  prev.anim?.cancel();
  prev.el.inert = true;
  leaving.add(prev);
  const end = frames.begin("onboarding-page", page);
  prev.anim = prev.el.animate([from, { transform: down ? above : below, opacity: off }], { duration: dur, easing: ease, fill: "forwards" });
  prev.anim.onfinish = () => dropPage(prev);
  const anim = next.el.animate([{ transform: down ? below : above, opacity: off }, { transform: center, opacity: 1 }], { duration: dur, easing: ease });
  next.anim = anim;
  anim.onfinish = () => {
    end();
    if (next.anim === anim) next.anim = undefined;
  };
  anim.oncancel = end;
}

/** The button at the foot of a page (his call, 2026-10-22): *Next* on pages 1 to 4, *Let's Boogie*
 *  on page 5 (the end: the app comes in as at launch; pages 4 and 5 added 2026-10-23), none on
 *  Settings. */
const FORWARD: Partial<Record<Page, { label: string; hint: string }>> = {
  one: { label: "Next", hint: "Shows the next page" },
  two: { label: "Next", hint: "Shows the next page" },
  three: { label: "Next", hint: "Shows the next page" },
  four: { label: "Next", hint: "Shows the next page" },
  five: { label: "Let's Boogie", hint: "Closes this page and opens DeetsMusic" },
};
function paintForward(page: Page): void {
  const b = card?.querySelector<HTMLButtonElement>(".onboarding__forward");
  if (!b) return;
  const f = FORWARD[page];
  b.hidden = !f;
  if (!f) return;
  b.textContent = f.label;
  b.title = f.hint;
  b.dataset.end = String(page === LAST);
}
function forward(): void {
  if (!current) return;
  if (current.page === LAST) return void boogie();
  const i = PAGES.indexOf(current.page);
  showPage(PAGES[i + 1]);
}

/** A sign-in made on page 1 readies the cards behind the page while the user reads on (his ask,
 *  2026-10-22). The library sync already starts on every sign-in (track-store.ts `signInSync`),
 *  and the mounted cards rebuild as it lands (Home asks Apple for its shelves on that rebuild).
 *  Apple's playlists are read only when the Playlists card mounts, which was before the sign-in,
 *  so their mirror is synced here. The work is Rust's, on its async pool, off the UI thread; a
 *  Web Worker would add nothing (no heavy work runs in the page). */
function warmUp(): void {
  diag.log("onboarding:warm");
  applePlaylistsSync(false)
    .then(() => notifyPlaylistsChanged())
    .catch((e) => diag.warn("onboarding:warm", { e: String(e) }));
}

/** *Let's Boogie*: the card leaves under the launch's own cover and the app rises as it does at
 *  a launch (boot-cover.ts `revealApp`). */
let ending = false;
function boogie(): void {
  if (ending || !card) return;
  ending = true;
  diag.log("onboarding:boogie");
  void revealApp(() => closeOnboarding()).finally(() => (ending = false));
}

/** Tells the rest of the app the card opened or closed: `data-onboarding` on the root (the
 *  scene's sprite layer rises over the card) and `deets:onboarding` (pet.ts moves the pair to
 *  the other side, §6). */
function announce(open: boolean): void {
  if (open) document.documentElement.dataset.onboarding = "open";
  else delete document.documentElement.dataset.onboarding;
  window.dispatchEvent(new CustomEvent("deets:onboarding", { detail: { open } }));
}

/** Opens the card. Resolves when the user closes it. A second call while it is open
 *  returns the same wait. */
export function openOnboarding(): Promise<void> {
  if (card) return new Promise((r) => { const prev = closed; closed = () => { prev?.(); r(); }; });
  const host = document.querySelector<HTMLElement>(".app-body");
  if (!host) return Promise.resolve();

  card = document.createElement("section");
  card.className = "panel onboarding";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Welcome to DeetsMusic");
  card.innerHTML =
    `<nav class="onboarding__nav" aria-label="Pages">` +
    `<span class="onboarding__mark" aria-hidden="true"></span>` +
    NUMBERED.map(([page, n]) =>
      `<button class="panel__back onboarding__navbtn" type="button" data-ob-page="${page}" aria-pressed="false" aria-label="Page ${n}" title="Shows page ${n}"><span class="onboarding__navnum" aria-hidden="true">${n}</span></button>`,
    ).join("") +
    `<button class="panel__back onboarding__navbtn onboarding__navbtn--foot" type="button" data-ob-page="settings" aria-pressed="false" aria-label="Settings" title="Shows all of Settings">${ICON_COG}</button>` +
    `</nav>` +
    `<div class="onboarding__pane"><div class="onboarding__pages"></div>` +
    `<div class="onboarding__foot"><button class="onboarding__forward" type="button" hidden></button></div></div>` +
    `<button class="panel__back onboarding__close" type="button" aria-label="Close" title="Closes this page">${ICON_X}</button>`;
  card.querySelector(".onboarding__close")!.addEventListener("click", () => closeOnboarding());
  for (const b of card.querySelectorAll<HTMLElement>("[data-ob-page]")) b.addEventListener("click", () => showPage(b.dataset.obPage as Page));
  card.querySelector(".onboarding__forward")!.addEventListener("click", forward);
  document.addEventListener("keydown", onKey);
  window.addEventListener("deets:signed-in", warmUp);
  host.append(card);
  announce(true);
  showPage("one");
  // The buttons are as wide as the bar, so a window resize moves them: the mark follows, still.
  sizeWatch = new ResizeObserver(() => glide(true));
  sizeWatch.observe(card.querySelector(".onboarding__nav")!);
  card.querySelector<HTMLElement>(".onboarding__close")!.focus({ preventScroll: true });
  diag.log("onboarding:open");
  return new Promise((r) => (closed = r));
}

export function closeOnboarding(): void {
  if (!card) return;
  sizeWatch?.disconnect();
  sizeWatch = null;
  for (const p of [...leaving]) dropPage(p);
  if (current) dropPage(current);
  current = null;
  card.remove();
  card = null;
  announce(false);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("deets:signed-in", warmUp);
  diag.log("onboarding:close");
  if (setting("openingPending")) setSetting("openingPending", false);
  const done = closed;
  closed = null;
  done?.();
}

/** Escape closes it, unless something inside it has the key first. It listens on the bubble
 *  side, so the Settings search field clears and closes its own bar before this runs; a key
 *  pressed in a text field is that field's, never the card's. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!card?.contains(document.activeElement) && document.activeElement !== document.body) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
  closeOnboarding();
}

/** The launch: opens the card on a brand-new install, then resolves when it closes.
 *  Resolves at once on every other launch. */
export function initOnboarding(): Promise<void> {
  window.__onboarding = { open: openOnboarding, close: closeOnboarding };
  return isFreshInstall() ? openOnboarding() : Promise.resolve();
}

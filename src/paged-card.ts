// The paged card's frame (docs/features/GRAND-OPENING.md §1–§4): one large card over every other
// card, a nav bar on its left that picks the page in the pane to its right, a foot button
// (Next, then the last page's end), and the × top right. Two callers: the grand opening
// (onboarding.ts) and the update card (update-card.ts, docs/features/UPDATE-CARD.md §3.8). One
// card shows at a time; opening one while the other is up closes the other first.
//
// The card is a `.panel`, so it wears each skin's card material (fill, edge, corners,
// shadow) with no new color. It sits inside `.app-body` on the bento's own edges, so the
// title bar stays usable above it.
//
// The motion (§4): the picked mark glides along the bar to the button pressed, and the page
// slides the same way — a button lower in the bar brings its page up from below. Both ride the
// in-card nav tokens (--nav-dur, --nav-ease, --nav-off-opacity); the page's two positions
// are --ob-page-above / --ob-page-below (skin.css).

import * as diag from "./diag";
import * as frames from "./frames";
import type { CardInstance } from "./cards";
import { tokenMs } from "./boot-cover";
import { motionReduced } from "./motion";
import "./styles/onboarding.css";

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /></svg>';

/** One page of a paged card, in the bar's order from the top. */
export interface PagedPage {
  id: string;
  /** The nav button's face: its markup (a number, a short version, an icon). */
  face: string;
  /** The nav button's name for a screen reader, and its hover hint. */
  label: string;
  hint: string;
  /** At the bar's foot (Settings, Older): the first foot page takes the free space above it. */
  foot?: boolean;
  /** The foot button on this page: Next, or the end (Let's Boogie, Done). None: no button. */
  forward?: { label: string; hint: string; end?: boolean };
  mount: (el: HTMLElement) => CardInstance;
}

export interface PagedSpec {
  /** The log's name for this card ("onboarding", "updatecard"), and its class modifier. */
  name: string;
  /** The dialog's name for a screen reader. */
  ariaLabel: string;
  pages: PagedPage[];
  /** The page it opens on (default: the first). */
  start?: string;
  /** The end button (`forward.end`) was pressed. Default: close. */
  onEnd?: () => void;
  /** After the card has left the page (the × , Escape, the end, or a second card). */
  onClosed?: () => void;
}

export interface PagedHandle {
  close: () => void;
  /** Show one page by id (the update card's Older search opens a version this way). */
  show: (id: string) => void;
  /** Resolves when the card closes. */
  done: Promise<void>;
}

let open: { name: string; close: () => void } | null = null;
/** The paged card on screen now, if any: its name. */
export const pagedOpen = (): string | null => open?.name ?? null;

/** One page in the pane: its box, the card mounted in it, and its slide in. */
interface Shown {
  page: PagedPage;
  el: HTMLElement;
  inst: CardInstance | null;
  anim?: Animation;
}

/** Tells the rest of the app the card opened or closed: `data-onboarding` on the root (the cards
 *  behind hide, the scene's sprite layer rises over the card) and `deets:onboarding` (pet.ts moves
 *  the pair to the other side, GRAND-OPENING.md §6). Both cards are the same frame, so both say it. */
function announce(isOpen: boolean): void {
  if (isOpen) document.documentElement.dataset.onboarding = "open";
  else delete document.documentElement.dataset.onboarding;
  window.dispatchEvent(new CustomEvent("deets:onboarding", { detail: { open: isOpen } }));
}

export function openPagedCard(spec: PagedSpec): PagedHandle | null {
  const host = document.querySelector<HTMLElement>(".app-body");
  if (!host) return null;
  open?.close();

  const pages = spec.pages;
  const byId = (id: string) => pages.find((p) => p.id === id);
  let current: Shown | null = null;
  /** Pages still sliding out. A new press drops them at once (never two leaving). */
  const leaving = new Set<Shown>();
  let resolve: () => void = () => {};
  const done = new Promise<void>((r) => (resolve = r));

  const card = document.createElement("section");
  card.className = `panel onboarding onboarding--${spec.name}`;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", spec.ariaLabel);
  let firstFoot = true;
  card.innerHTML =
    `<nav class="onboarding__nav" aria-label="Pages">` +
    `<span class="onboarding__mark" aria-hidden="true"></span>` +
    pages
      .map((p) => {
        const foot = p.foot && firstFoot ? " onboarding__navbtn--foot" : "";
        if (p.foot) firstFoot = false;
        return `<button class="panel__back onboarding__navbtn${foot}" type="button" data-ob-page="${p.id}" aria-pressed="false" aria-label="${p.label}" title="${p.hint}">${p.face}</button>`;
      })
      .join("") +
    `</nav>` +
    `<div class="onboarding__pane"><div class="onboarding__pages"></div>` +
    `<div class="onboarding__foot"><button class="onboarding__forward" type="button" hidden></button></div></div>` +
    `<button class="panel__back onboarding__close" type="button" aria-label="Close" title="Closes this page">${ICON_X}</button>`;

  const dropPage = (p: Shown): void => {
    p.anim?.cancel();
    p.inst?.destroy();
    p.el.remove();
    leaving.delete(p);
  };

  /** Moves the picked mark to the pressed button. `still` places it with no glide (the open,
   *  a resize). */
  const glide = (still: boolean): void => {
    if (!current) return;
    const mark = card.querySelector<HTMLElement>(".onboarding__mark");
    const btn = card.querySelector<HTMLElement>(`[data-ob-page="${current.page.id}"]`);
    if (!mark || !btn) return;
    mark.classList.toggle("is-still", still);
    mark.style.setProperty("--ob-mark-y", `${btn.offsetTop}px`);
    mark.style.setProperty("--ob-mark-w", `${btn.offsetWidth}px`);
    mark.style.setProperty("--ob-mark-h", `${btn.offsetHeight}px`);
    if (still) {
      void mark.offsetWidth; // commit the place before the glide comes back on
      mark.classList.remove("is-still");
    }
  };

  const paintForward = (page: PagedPage): void => {
    const b = card.querySelector<HTMLButtonElement>(".onboarding__forward");
    if (!b) return;
    const f = page.forward;
    b.hidden = !f;
    if (!f) return;
    b.textContent = f.label;
    b.title = f.hint;
    b.dataset.end = String(!!f.end);
  };

  /** Shows one page in the pane to the right of the nav bar. */
  const showPage = (id: string): void => {
    const page = byId(id);
    if (!page || current?.page.id === id) return;
    const pane = card.querySelector<HTMLElement>(".onboarding__pages")!;
    const prev = current;
    const el = document.createElement("div");
    el.className = "onboarding__page";
    el.dataset.page = id;
    pane.append(el);
    const next: Shown = { page, el, inst: page.mount(el) };
    current = next;
    for (const b of card.querySelectorAll<HTMLElement>("[data-ob-page]")) b.setAttribute("aria-pressed", String(b.dataset.obPage === id));
    paintForward(page);
    glide(!prev);
    diag.log(`${spec.name}:page`, { page: id });
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
    const down = pages.indexOf(page) > pages.indexOf(prev.page);
    // A press mid-slide: the page still coming in leaves from where it is now, not from the middle.
    const now = getComputedStyle(prev.el);
    const from = prev.anim ? { transform: now.transform, opacity: Number(now.opacity) } : { transform: center, opacity: 1 };
    prev.anim?.cancel();
    prev.el.inert = true;
    leaving.add(prev);
    const end = frames.begin(`${spec.name}-page`, id);
    prev.anim = prev.el.animate([from, { transform: down ? above : below, opacity: off }], { duration: dur, easing: ease, fill: "forwards" });
    prev.anim.onfinish = () => dropPage(prev);
    const anim = next.el.animate([{ transform: down ? below : above, opacity: off }, { transform: center, opacity: 1 }], { duration: dur, easing: ease });
    next.anim = anim;
    anim.onfinish = () => {
      end();
      if (next.anim === anim) next.anim = undefined;
    };
    anim.oncancel = end;
  };

  /** The foot button: the next numbered page, or the end on the last one. */
  const forward = (): void => {
    if (!current) return;
    if (current.page.forward?.end) return void (spec.onEnd ? spec.onEnd() : close());
    const i = pages.indexOf(current.page);
    const next = pages[i + 1];
    if (next) showPage(next.id);
  };

  /** Escape closes it, unless something inside it has the key first. It listens on the bubble
   *  side, so a search field clears and closes its own bar before this runs; a key pressed in a
   *  text field is that field's, never the card's. */
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!card.contains(document.activeElement) && document.activeElement !== document.body) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable='true']")) return;
    e.preventDefault();
    close();
  };

  // The buttons are as wide as the bar, so a window resize moves them: the mark follows, still.
  const sizeWatch = new ResizeObserver(() => glide(true));

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    sizeWatch.disconnect();
    for (const p of [...leaving]) dropPage(p);
    if (current) dropPage(current);
    current = null;
    card.remove();
    if (open?.close === close) open = null;
    announce(false);
    document.removeEventListener("keydown", onKey);
    diag.log(`${spec.name}:close`);
    spec.onClosed?.();
    resolve();
  }

  card.querySelector(".onboarding__close")!.addEventListener("click", () => close());
  for (const b of card.querySelectorAll<HTMLElement>("[data-ob-page]")) b.addEventListener("click", () => showPage(b.dataset.obPage!));
  card.querySelector(".onboarding__forward")!.addEventListener("click", forward);
  document.addEventListener("keydown", onKey);
  host.append(card);
  open = { name: spec.name, close };
  announce(true);
  showPage(spec.start && byId(spec.start) ? spec.start : pages[0].id);
  sizeWatch.observe(card.querySelector(".onboarding__nav")!);
  card.querySelector<HTMLElement>(".onboarding__close")!.focus({ preventScroll: true });
  diag.log(`${spec.name}:open`);
  return { close, show: showPage, done };
}

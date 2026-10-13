// The Last.fm facts box arriving beside a hero, or leaving it (LISTENERS.md §6b; his call,
// 2026-10-13). The hero draws centered; when Last.fm answers, the cover column slides left and
// the box fades in beside it. When the box's Settings row goes off while the view is open (the
// row, or the box's *Hide* menu), the box fades out and the column slides back to the center;
// on again (Undo), it comes back the same way. Under reduced motion the cover starts on the
// left, in a held empty place (info-box.ts `pendingBoxHTML`), and nothing moves; an answer of
// "nothing" snaps it back to the center.
//
// Only the hero's own nodes change, never the card: the card's redraw re-made every row and
// cover just after the drill's slide, which was the flicker (2026-10-13). A module of its own
// so collection-card.ts can import it (info-box.ts imports collection-card.ts).

import { tokenMs } from "./boot-cover";
import { onSettingsChange, setting } from "./settings-store";
import * as frames from "./frames";

const reduced = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The box in a hero: beside the column (the Library), or in the Search panes' holder. */
const wrapOf = (hero: HTMLElement): HTMLElement | null =>
  hero.querySelector<HTMLElement>(":scope > .artist-info-wrap, :scope > [data-artist-info] > .artist-info-wrap");

const isBox = (wrap: Element | null): boolean => !!wrap && !wrap.hasAttribute("data-info-pending");

/** The cover column. A hero drawn with no box has its parts loose; they move into a column
 *  of their own, which looks the same centered (both are a centered flex column). */
function mainOf(hero: HTMLElement): HTMLElement {
  const main = hero.querySelector<HTMLElement>(":scope > .lib-hero__main");
  if (main) return main;
  const col = document.createElement("div");
  col.className = "lib-hero__main";
  col.append(...hero.childNodes);
  hero.append(col);
  return col;
}

/** Put the box's HTML in place ("" takes it out). */
function put(hero: HTMLElement, html: string): void {
  const holder = hero.querySelector<HTMLElement>(":scope > [data-artist-info]");
  if (holder) {
    // A Search pane: the hero is always a row; an empty holder leaves the column centered.
    holder.innerHTML = html;
    return;
  }
  wrapOf(hero)?.remove();
  if (html) hero.insertAdjacentHTML("beforeend", html);
  hero.classList.toggle("lib-hero--aside", !!html);
}

const running = new WeakMap<HTMLElement, Animation[]>();

/** Change the hero's layout with `change`, then slide the column (and the hero's height) from
 *  where it was to where it is now. */
function flip(hero: HTMLElement, change: () => void, fadeIn: boolean): void {
  const main = mainOf(hero);
  const r0 = main.getBoundingClientRect();
  const h0 = hero.offsetHeight;
  change();
  const r1 = main.getBoundingClientRect();
  const h1 = hero.offsetHeight;
  const dur = tokenMs("--artist-info-slide");
  const easing = token("--artist-info-slide-ease") || "ease";
  const dx = r0.left - r1.left;
  const dy = r0.top - r1.top;
  const anims: Animation[] = [];
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
    anims.push(main.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: dur, easing }));
  // The rows under the hero follow its height instead of jumping (a narrow card's Info line).
  if (Math.abs(h1 - h0) > 0.5) {
    hero.classList.add("is-sliding");
    anims.push(hero.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: dur, easing }));
  }
  const box = fadeIn ? wrapOf(hero) : null;
  if (box)
    anims.push(box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay: dur * 0.3, easing, fill: "backwards" }));
  if (!anims.length) return;
  running.set(hero, anims);
  const end = frames.begin("info-box", fadeIn ? "in" : "out");
  void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
    end();
    if (running.get(hero) !== anims) return;
    running.delete(hero);
    hero.classList.remove("is-sliding");
  });
}

/** Put a hero's facts box in, out, or in place of the one there, with the motion above.
 *  `html` is `artistInfoHTML` / `albumInfoHTML`'s output ("" for none). */
export function setHeroAside(hero: HTMLElement, html: string): void {
  for (const a of running.get(hero) ?? []) a.cancel();
  running.delete(hero);
  hero.classList.remove("is-sliding");
  const had = isBox(wrapOf(hero));
  const will = html !== "" && !html.includes("data-info-pending");
  if (reduced() || !hero.isConnected || had === will) {
    put(hero, html);
    return;
  }
  if (will) {
    flip(hero, () => put(hero, html), true);
    return;
  }
  // Leaving: the box fades out first, then the column slides back to the center.
  const box = wrapOf(hero)!;
  const out = box.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: tokenMs("--pop-out"),
    easing: token("--artist-info-slide-ease") || "ease",
    fill: "forwards",
  });
  running.set(hero, [out]);
  out.onfinish = () => {
    if (running.get(hero)?.[0] !== out) return;
    running.delete(hero);
    flip(hero, () => put(hero, ""), false);
  };
}

// The box's row going off or on while a view is open. Off: each open box of that kind leaves,
// and its HTML is kept beside its hero; on (Undo, or the row again): it comes back from there.
const parked = new Map<HTMLElement, { kind: string; html: string }>();
onSettingsChange((key) => {
  if (key !== "showArtistInfo" && key !== "showAlbumInfo") return;
  const kind = key === "showArtistInfo" ? "artist" : "album";
  for (const hero of [...parked.keys()]) if (!hero.isConnected) parked.delete(hero);
  if (!setting(key)) {
    for (const wrap of document.querySelectorAll<HTMLElement>(`.artist-info-wrap[data-info-box="${kind}"]`)) {
      const hero = wrap.closest<HTMLElement>(".lib-hero");
      if (!hero) continue;
      if (isBox(wrap)) parked.set(hero, { kind, html: wrap.outerHTML });
      setHeroAside(hero, "");
    }
    return;
  }
  for (const [hero, p] of parked) {
    if (p.kind !== kind) continue;
    parked.delete(hero);
    setHeroAside(hero, p.html);
  }
});

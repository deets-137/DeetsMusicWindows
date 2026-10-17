// Presentation mode (docs/ideas/PresentationMode.md; his calls 2026-10-13, §7a). A click on
// the Listening Stats cell of an artist's, an album's or a song's facts box (the song's since
// 2026-10-17, LISTENERS.md §8), in Max: the card fills Max
// (the grow's Fill, card-grow.ts) and the stats grow from the cell over the whole card, with
// Last.fm's Plays and Listeners in large type. Now Playing and the Queue stay beside it.
//
// The counts are Last.fm's (his call: "Last.fm has insight into millions of users"). Last.fm
// refreshes them in batches, not per scrobble (the probes in PresentationMode.md §2), so the
// view re-reads them every `POLL_MS` while it is open and says when Last.fm was last asked. A
// count that moves rolls up to its new value.
//
// Ways out: Escape, the shrink square, or anything that ends the grow (an outside click, a
// surface change). The view goes back into the cell, then the grow collapses. Max only (his
// call): elsewhere the cell is plain text. The picture is his to draw; this is the mechanics.

import { ICON_SHRINK, clipOpen, collapseGrow, fillCard, grownState, hostOf, onGrowChange, slotHolding, type Slot } from "./card-grow";
import { currentSurface, onSurfaceChange } from "./surface";
import { onSettingsChange, setting } from "./settings-store";
import { albumInfoFresh, albumInfoNow, artistInfoFresh, artistInfoNow, songInfoByKey, songInfoFresh } from "./listeners";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import * as diag from "./diag";

export const PRESENT_HINTS = {
  close: "Back to the card (Esc)",
  checked: "When the app last asked Last.fm. Last.fm updates its counts in batches",
} as const;

/** The Settings row of each kind of box: off ends a view of that kind. */
const ROW_OF = { artist: "showArtistInfo", album: "showAlbumInfo", song: "showSongInfo" } as const;

/** How often an open view asks Last.fm again. */
const POLL_MS = 5 * 60 * 1000;
/** A stored answer younger than this is not asked again (Rust floors it at a minute). */
const FRESH_MS = 4 * 60 * 1000;
/** How often the "checked N min ago" line is redrawn. */
const AGE_TICK_MS = 30 * 1000;

type Counts = { playcount: number; listeners: number; fetchedAt: number };

interface Open {
  slot: Slot;
  host: HTMLElement;
  el: HTMLElement;
  /** The facts box the view came from: the way back goes into its stats cell. */
  wrap: HTMLElement;
  /** True when this view grew the card (so closing collapses it). */
  grew: boolean;
  read: () => Promise<Counts | null>;
  counts: Counts;
  poll: number;
  tick: number;
  offGrow: () => void;
  offSurface: () => void;
  offRow: () => void;
}

let open: Open | null = null;
let closing = false;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n: number) => n.toLocaleString();
// Its own escape: collection-card.ts imports this module, so this one does not import it.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The clip that shows only `inner` of `outer` (both viewport boxes). */
function clipTo(outer: DOMRect, inner: DOMRect, radius: string): string {
  const t = Math.max(0, inner.top - outer.top);
  const r = Math.max(0, outer.right - inner.right);
  const b = Math.max(0, outer.bottom - inner.bottom);
  const l = Math.max(0, inner.left - outer.left);
  return `inset(${t}px ${r}px ${b}px ${l}px round ${radius})`;
}

function ageText(at: number): string {
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return "Checked with Last.fm just now";
  if (min < 60) return `Checked with Last.fm ${min} min ago`;
  return `Checked with Last.fm ${Math.floor(min / 60)} h ago`;
}

/** Roll a number from what it shows to `to` over --present-roll-dur; a snap under reduced motion. */
function roll(b: HTMLElement, to: number): void {
  const from = Number(b.dataset.n ?? to);
  b.dataset.n = String(to);
  const dur = reduced() ? 0 : tokenMs("--present-roll-dur");
  if (!dur || from === to) {
    b.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    if (b.dataset.n !== String(to)) return; // a newer roll took over
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    b.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function paint(o: Open, c: Counts): void {
  const moved = c.playcount !== o.counts.playcount || c.listeners !== o.counts.listeners;
  if (moved) diag.log("present:moved", { plays: c.playcount - o.counts.playcount, listeners: c.listeners - o.counts.listeners });
  o.counts = c;
  const plays = o.el.querySelector<HTMLElement>("[data-n-plays]");
  const listeners = o.el.querySelector<HTMLElement>("[data-n-listeners]");
  if (plays) roll(plays, c.playcount);
  if (listeners) roll(listeners, c.listeners);
  paintAge(o);
}

function paintAge(o: Open): void {
  const age = o.el.querySelector<HTMLElement>(".present__age");
  if (age) age.textContent = ageText(o.counts.fetchedAt);
}

async function refresh(o: Open, why: string): Promise<void> {
  const c = await o.read();
  if (open !== o) return;
  diag.log("present:read", { why, got: !!c, plays: c?.playcount, listeners: c?.listeners });
  if (c) paint(o, c);
}

/** A click landed on a box's stats cell (`[data-present]`). Max only. */
export async function openPresent(cell: HTMLElement): Promise<void> {
  if (open || closing || currentSurface() !== "max") return;
  const wrap = cell.closest<HTMLElement>("[data-info-box]");
  const slot = slotHolding(cell);
  const host = slot ? hostOf(slot) : null;
  const artist = wrap?.dataset.artist;
  if (!wrap || !slot || !host || !artist) return;
  const album = wrap.dataset.album;
  // A song's box (LISTENERS.md §8) carries its key and title: the view holds no Track.
  const song = wrap.dataset.song;
  const songTitle = wrap.dataset.title;
  const kind =
    wrap.dataset.infoBox === "song" && song && songTitle ? "song"
    : wrap.dataset.infoBox === "album" && album ? "album"
    : "artist";
  const now = kind === "song" ? songInfoByKey(song!) : kind === "album" ? albumInfoNow(artist, album!) : artistInfoNow(artist);
  if (!now || now.state !== "have") return;
  const read = (): Promise<Counts | null> =>
    (kind === "song" ? songInfoFresh(song!, artist, songTitle!, FRESH_MS)
    : kind === "album" ? albumInfoFresh(artist, album!, FRESH_MS)
    : artistInfoFresh(artist, FRESH_MS)
    ).then((v) => (v && v.state === "have" ? v : null));
  const from = cell.getBoundingClientRect();

  // The card fills Max first (the layout is final when this returns; its clip is opening).
  const already = grownState()?.slot === slot;
  if (!already) await fillCard(slot, "present");
  if (currentSurface() !== "max" || !host.isConnected) return;
  const grew = !already && grownState()?.slot === slot;

  const named = kind === "song" ? songTitle! : kind === "album" ? album! : "";
  const title = named ? `${esc(named)}<span class="present__by"> · ${esc(artist)}</span>` : esc(artist);
  const el = document.createElement("div");
  el.className = "present";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Listening stats, ${named ? `${named}, ${artist}` : artist}`);
  el.innerHTML =
    `<div class="present__head"><div class="present__title"><span class="search__label">Listening Stats</span>` +
    `<span class="present__name">${title}</span></div>` +
    `<button class="panel__action present__close" type="button" data-present-close title="${PRESENT_HINTS.close}" aria-label="${PRESENT_HINTS.close}">${ICON_SHRINK}</button></div>` +
    `<div class="present__counts">` +
    `<div class="present__count"><b data-n-plays data-n="${now.playcount}">${fmt(now.playcount)}</b><span>Plays</span></div>` +
    `<div class="present__count"><b data-n-listeners data-n="${now.listeners}">${fmt(now.listeners)}</b><span>Listeners</span></div>` +
    `</div><div class="present__age" title="${PRESENT_HINTS.checked}"></div>`;
  host.append(el);
  host.classList.add("is-presenting");

  const o: Open = {
    slot,
    host,
    el,
    wrap,
    grew,
    read,
    counts: { playcount: now.playcount, listeners: now.listeners, fetchedAt: now.fetchedAt },
    poll: window.setInterval(() => void refresh(o, "poll"), POLL_MS),
    tick: window.setInterval(() => paintAge(o), AGE_TICK_MS),
    // Anything that ends this card's grow (an outside click, Esc from elsewhere, the full
    // player) ends the view too, with no motion of its own: the grow's motion is the one.
    offGrow: onGrowChange((s) => {
      if (open === o && !closing && s?.slot !== o.slot) void closePresent("grow", false);
    }),
    offSurface: onSurfaceChange(() => {
      if (open === o) void closePresent("surface", false);
    }),
    // Its box's row going off (Settings, the box's Hide, the agent) ends the view: its re-read
    // would answer nothing and leave frozen numbers (a test of the song box, 2026-10-17).
    offRow: onSettingsChange((key) => {
      if (open === o && key === ROW_OF[kind] && !setting(key)) void closePresent("row");
    }),
  };
  open = o;
  paintAge(o);
  el.querySelector("[data-present-close]")?.addEventListener("click", () => void closePresent("button"));
  diag.log("present:open", { kind, artist, album, song, grew });

  // The view grows out of the cell: a clip from the cell's box to the card's, on the grow's
  // curve (the same idiom as the grow itself); the words fade in once it is mostly open.
  const dur = reduced() ? 0 : tokenMs("--grow-dur");
  if (dur) {
    const radius = getComputedStyle(host).borderRadius || "0px";
    const end = frames.begin("present", "open");
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--grow-ease").trim() || "ease";
    const anim = el.animate([{ clipPath: clipTo(host.getBoundingClientRect(), from, radius) }, { clipPath: clipOpen(0, radius) }], {
      duration: dur,
      easing: ease,
    });
    anim.onfinish = anim.oncancel = end;
  }
  el.classList.add("is-in");
  void refresh(o, "open");
}

/** Close the view: it goes back into its cell, then the grow it made collapses. */
export async function closePresent(cause: string, withMotion = true): Promise<void> {
  const o = open;
  if (!o || closing) return;
  closing = true;
  window.clearInterval(o.poll);
  window.clearInterval(o.tick);
  o.offGrow();
  o.offSurface();
  o.offRow();
  try {
    const cell = o.wrap.isConnected ? o.wrap.querySelector<HTMLElement>("[data-present]") : null;
    const dur = withMotion && !reduced() ? tokenMs("--grow-collapse-dur") || tokenMs("--grow-dur") : 0;
    if (dur && cell) {
      const radius = getComputedStyle(o.host).borderRadius || "0px";
      const ease = getComputedStyle(document.documentElement).getPropertyValue("--grow-ease").trim() || "ease";
      const end = frames.begin("present", "close");
      o.el.classList.remove("is-in");
      const anim = o.el.animate(
        [{ clipPath: clipOpen(0, radius) }, { clipPath: clipTo(o.host.getBoundingClientRect(), cell.getBoundingClientRect(), radius) }],
        { duration: dur, easing: ease, fill: "forwards" },
      );
      await anim.finished.catch(() => {});
      end();
    }
    o.el.remove();
    o.host.classList.remove("is-presenting");
    open = null;
    diag.log("present:close", { cause });
    if (o.grew && grownState()?.slot === o.slot) await collapseGrow("present", withMotion);
  } finally {
    open = null;
    closing = false;
  }
}

/** True while a view is open (Escape goes to it first). */
export const isPresenting = (): boolean => !!open;

// Escape closes the view before the grow sees it (the grow skips a key already spent). A
// right-click menu or the Compass on top takes the Escape first.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape" || !open || closing || e.defaultPrevented) return;
    if (document.querySelector(".ctx-menu")) return;
    // The Compass over the view takes its Esc first (2026-10-17: one Esc closed both).
    if (document.getElementById("compass")?.hidden === false) return;
    e.preventDefault();
    void closePresent("esc");
  },
  true,
);

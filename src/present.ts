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
import { appleNotesWanted, notesByAlbum } from "./album-notes";
import { parseNote, shortText, type Block } from "./album-notes-parse";
import { openContextMenu, type MenuItem } from "./context-menu";
import { wireListKeys } from "./list-keys";
import type { Track } from "./library";
import { tokenMs } from "./boot-cover";
import { bezierAt, parseBezier } from "./stepped-ease";
import * as frames from "./frames";
import * as diag from "./diag";
import { motionReduced } from "./motion";

export const PRESENT_HINTS = {
  close: "Back to the card (Esc)",
  checked: "When the app last asked Last.fm. Last.fm updates its counts in batches",
} as const;

/** The full note's hints (ONBOARDING.md §1). */
export const NOTES_HINTS = {
  song: "Plays this song, with the album after it",
  elsewhere: "Finds this song on Apple Music and plays it",
} as const;

/** The Settings row of each kind of box: off ends a view of that kind. */
const ROW_OF = { artist: "showArtistInfo", album: "showAlbumInfo", song: "showSongInfo", notes: "showAlbumInfo" } as const;

/** What the full note needs from its album level (media-levels.ts): the songs a mention plays. */
export interface NotesViewData {
  title: string;
  artist: string;
  /** The album's songs, in its order. Apple's whole album where it can be read (one call on a
   *  library album, kept for the session), else the songs the level holds. */
  songs: () => Promise<Track[]>;
  /** A mention's press: the song, with the album after it (his call N3 = A). */
  play: (t: Track, list: Track[]) => void;
  /** A mention's right-click: the song's own menu (media-menu.ts). */
  menu: (t: Track, list: Track[]) => MenuItem[];
  /** A bold name that is no song of this album: one catalog search by the artist and the name,
   *  then play it. False when nothing matched. */
  playElsewhere: (name: string) => Promise<boolean>;
}

/** How often an open view asks Last.fm again. */
const POLL_MS = 5 * 60 * 1000;
/** A stored answer younger than this is not asked again (Rust floors it at a minute). */
const FRESH_MS = 4 * 60 * 1000;
/** How often the "checked N min ago" line is redrawn. */
const AGE_TICK_MS = 30 * 1000;

type Counts = { playcount: number; listeners: number; fetchedAt: number };

interface Open {
  /** Null for a note in Midi or Mini outside a card slot. */
  slot: Slot | null;
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
  /** The full note's list keys and the like (nothing for the stats). */
  offExtra?: () => void;
  /** The box cell the view goes back into: the stats cell, or the About for a note. */
  back: string;
  /** A full note: the album's catalog id (card memory reads it). */
  notes?: string;
}

let open: Open | null = null;
let closing = false;

const reduced = () => motionReduced();
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
  const curve = parseBezier(getComputedStyle(b).getPropertyValue("--present-roll-ease")) ?? [0.33, 1, 0.68, 1];
  const t0 = performance.now();
  const step = (now: number) => {
    if (b.dataset.n !== String(to)) return; // a newer roll took over
    const k = Math.min(1, (now - t0) / dur);
    const e = bezierAt(curve, k);
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

/** A view whose card left the page (a swap, a surface change mid-open) is dropped without
 *  motion, so it never blocks the next open. */
function dropStale(): void {
  const o = open;
  if (!o || closing || o.host.isConnected) return;
  window.clearInterval(o.poll);
  window.clearInterval(o.tick);
  o.offGrow();
  o.offSurface();
  o.offRow();
  o.offExtra?.();
  open = null;
  diag.log("present:close", { cause: "gone", notes: !!o.notes });
}

/** A click landed on a box's stats cell (`[data-present]`). Max only. */
export async function openPresent(cell: HTMLElement): Promise<void> {
  dropStale();
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
    back: "[data-present]",
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
  o.offExtra?.();
  try {
    // The cell may have been drawn again while the view was open: find it again by its album.
    const wrap = o.wrap.isConnected ? o.wrap : o.notes ? o.host.querySelector<HTMLElement>(`[data-notes="${CSS.escape(o.notes)}"]`)?.closest<HTMLElement>("[data-info-box]") : null;
    const cell = wrap ? wrap.querySelector<HTMLElement>(o.back) : null;
    const dur = withMotion && !reduced() ? tokenMs("--grow-collapse-dur") || tokenMs("--grow-dur") : 0;
    if (dur && cell) {
      const radius = getComputedStyle(o.host).borderRadius || "0px";
      const ease = getComputedStyle(document.documentElement).getPropertyValue("--grow-ease").trim() || "ease";
      const end = frames.begin("present", "close");
      o.el.classList.remove("is-in");
      const anim = o.el.animate(
        [{ clipPath: clipOpen(0, radius) }, { clipPath: clipTo(o.el.getBoundingClientRect(), cell.getBoundingClientRect(), radius) }],
        { duration: dur, easing: ease, fill: "forwards" },
      );
      await anim.finished.catch(() => {});
      end();
    }
    o.el.remove();
    o.host.classList.remove("is-presenting");
    open = null;
    diag.log("present:close", { cause, notes: !!o.notes });
    // A note opened by the keyboard gives the focus back to its About.
    if (o.notes && document.activeElement === document.body) cell?.focus({ preventScroll: true });
    if (o.grew && grownState()?.slot === o.slot) await collapseGrow("present", withMotion);
  } finally {
    open = null;
    closing = false;
  }
}

// ── The full note (features/album-notes.md §2, §4; his calls N2, N3 = A, M1 = A) ─────────────
//
// A click on an album box's About, when Apple has a full note. In Max the card fills Max and the
// note grows from the cell over the card, as the stats do. In Midi and Mini it opens over the
// card's song list, inside the card: below the hero while the hero shows, else below the card's
// head. The note is built from text nodes (Apple's string is never set as HTML): the tagline
// small above the album's title, the short note in larger type, the full note, "From Apple
// Music" at the end (§7, his draft). A song heading is a row with its number and a play mark; a
// mention inside a sentence plays its song too. The view stays open while the song plays.

const songNum = (t: Track | undefined, i: number) => String(t?.trackNumber ?? i + 1);
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

/** A song named inside a sentence. A span with the button role, not a `<button>`: a button is
 *  an atomic inline box, so a line could break between the name and its comma (“Señorita / ,”,
 *  seen in the first run). list-keys.ts gives it the focus; Enter clicks it. */
function mention(text: string, hint: string, data: Record<string, string>, extra = ""): HTMLElement {
  const m = document.createElement("span");
  m.className = `notes__mention${extra ? ` ${extra}` : ""}`;
  m.setAttribute("role", "button");
  m.title = hint;
  Object.assign(m.dataset, data);
  m.textContent = text;
  return m;
}

/** The blocks as DOM: text nodes, and buttons for the songs. */
function noteBody(body: HTMLElement, blocks: Block[], list: Track[]): void {
  for (const b of blocks) {
    if (b.kind === "heading") {
      if (b.index === undefined || !list[b.index]) {
        const h = document.createElement("p");
        h.className = "notes__heading";
        h.textContent = b.s;
        body.append(h);
        continue;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "notes__song";
      row.dataset.noteSong = String(b.index);
      row.title = NOTES_HINTS.song;
      const num = document.createElement("span");
      num.className = "notes__num";
      num.textContent = songNum(list[b.index], b.index);
      const name = document.createElement("span");
      name.className = "notes__name";
      name.textContent = b.s;
      const mark = document.createElement("span");
      mark.className = "notes__play";
      mark.innerHTML = ICON_PLAY; // our own glyph, not Apple's text
      row.append(num, name, mark);
      body.append(row);
      continue;
    }
    const p = document.createElement("p");
    p.className = "notes__para";
    for (const part of b.parts) {
      if (part.t === "text") p.append(part.s);
      else if (part.t === "i") {
        const i = document.createElement("i");
        i.textContent = part.s;
        p.append(i);
      } else if (part.t === "mention" && list[part.index]) {
        p.append(mention(part.s, NOTES_HINTS.song, { noteSong: String(part.index) }));
      } else if (part.t === "b" && part.maybe) {
        p.append(mention(part.s, NOTES_HINTS.elsewhere, { noteSearch: part.s }, "notes__mention--elsewhere"));
      } else {
        const bold = document.createElement("b");
        bold.textContent = part.s;
        p.append(bold);
      }
    }
    body.append(p);
  }
}

/** Where the note sits in Midi and Mini: under the hero while it shows, else under the head;
 *  never so low that less than half the card is left for the note. */
function notesTop(host: HTMLElement, cell: HTMLElement): number {
  const hr = host.getBoundingClientRect();
  const head = host.querySelector<HTMLElement>(".panel__head")?.getBoundingClientRect();
  const headBottom = head ? head.bottom - hr.top : 0;
  const hero = cell.closest<HTMLElement>(".lib-hero")?.getBoundingClientRect();
  const heroBottom = hero ? hero.bottom - hr.top : headBottom;
  const top = Math.max(headBottom, heroBottom);
  return top > hr.height / 2 ? headBottom : top;
}

/** Open the album's full note from its box's About (`[data-notes]`). `still`: no motion (a
 *  card memory restore). */
export async function openNotes(cell: HTMLElement, data: NotesViewData | undefined, still = false): Promise<void> {
  dropStale();
  if (open || closing || !data) return;
  const albumId = cell.dataset.notes;
  const notes = albumId ? notesByAlbum(albumId) : undefined;
  const wrap = cell.closest<HTMLElement>("[data-info-box]");
  const max = currentSurface() === "max";
  const slot = slotHolding(cell);
  const host = (slot ? hostOf(slot) : null) ?? cell.closest<HTMLElement>(".panel");
  if (!albumId || !notes || notes.state !== "have" || !notes.standard || !wrap || !host) return;
  const from = cell.getBoundingClientRect();

  // The album's songs first (a library album may read Apple's whole album: one call, kept), so
  // the note draws once, with its mentions.
  const list = await data.songs().catch(() => [] as Track[]);
  if (open || closing || !cell.isConnected) return;
  const blocks = parseNote(notes.standard, list.map((t) => t.title));

  let grew = false;
  if (max && slot) {
    const already = grownState()?.slot === slot;
    if (!already) await fillCard(slot, "notes");
    if (currentSurface() !== "max" || !host.isConnected) return;
    grew = !already && grownState()?.slot === slot;
  }

  const el = document.createElement("div");
  el.className = "present present--notes";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Notes, ${data.title}, ${data.artist}`);
  el.innerHTML =
    `<div class="present__head"><div class="present__title">` +
    (notes.tagline ? `<span class="search__label">${esc(notes.tagline)}</span>` : "") +
    `<span class="present__name">${esc(data.title)}<span class="present__by"> · ${esc(data.artist)}</span></span></div>` +
    `<button class="panel__action present__close" type="button" data-present-close title="${PRESENT_HINTS.close}" aria-label="${PRESENT_HINTS.close}">${ICON_SHRINK}</button></div>` +
    `<div class="notes__body app-scroll" data-notes-body></div>`;
  const body = el.querySelector<HTMLElement>("[data-notes-body]")!;
  const short = shortText(notes.short);
  if (short) {
    const s = document.createElement("p");
    s.className = "notes__short";
    s.textContent = short;
    body.append(s);
  }
  noteBody(body, blocks, list);
  const fromLine = document.createElement("p");
  fromLine.className = "notes__from";
  fromLine.textContent = "From Apple Music";
  body.append(fromLine);
  if (!max) el.style.top = `${notesTop(host, cell)}px`;
  host.append(el);
  host.classList.add("is-presenting");

  // A song: its press plays it with the album after it; its right-click is the song's menu.
  const songAt = (t: EventTarget | null) => {
    const b = (t as HTMLElement | null)?.closest?.<HTMLElement>("[data-note-song]");
    return b ? list[Number(b.dataset.noteSong)] : undefined;
  };
  el.addEventListener("click", (e) => {
    const t = songAt(e.target);
    if (t) {
      diag.log("notes:play", { album: albumId, song: t.catalogId ?? t.title });
      return data.play(t, list);
    }
    const far = (e.target as HTMLElement).closest<HTMLElement>("[data-note-search]");
    if (far && !far.dataset.busy) {
      far.dataset.busy = "1";
      void data.playElsewhere(far.dataset.noteSearch ?? "").then((ok) => {
        diag.log("notes:elsewhere", { name: far.dataset.noteSearch, ok });
        if (ok) return void delete far.dataset.busy;
        // No match: plain bold text from now on (§4).
        const bold = document.createElement("b");
        bold.textContent = far.textContent;
        far.replaceWith(bold);
      });
    }
  });
  el.addEventListener("contextmenu", (e) => {
    const t = songAt(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, data.menu(t, list));
  });
  // The keyboard (list-keys.ts): the arrows walk the songs and mentions; Enter plays; the menu
  // key opens the song's menu. Escape is the view's own (below).
  const offKeys = wireListKeys(body, { rows: "[data-note-song], [data-note-search]" });

  const o: Open = {
    slot,
    host,
    el,
    wrap,
    grew,
    back: "[data-notes]",
    notes: albumId,
    read: async () => null,
    counts: { playcount: 0, listeners: 0, fetchedAt: 0 },
    poll: 0,
    tick: 0,
    offGrow: onGrowChange((s) => {
      if (open === o && !closing && grew && s?.slot !== o.slot) void closePresent("grow", false);
    }),
    offSurface: onSurfaceChange(() => {
      if (open === o) void closePresent("surface", false);
    }),
    // The box's row off, or *Notes from* turned away from Apple, ends the view.
    offRow: onSettingsChange((key) => {
      if (open !== o) return;
      if ((key === ROW_OF.notes && !setting(key)) || (key === "notesSource" && !appleNotesWanted())) void closePresent("row");
    }),
    offExtra: offKeys,
  };
  open = o;
  el.querySelector("[data-present-close]")?.addEventListener("click", () => void closePresent("button"));
  diag.log("present:open", { kind: "notes", album: albumId, songs: list.length, blocks: blocks.length, grew, surface: currentSurface() });

  const dur = still || reduced() ? 0 : tokenMs("--grow-dur");
  if (dur) {
    const radius = getComputedStyle(host).borderRadius || "0px";
    const end = frames.begin("present", "notes");
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--grow-ease").trim() || "ease";
    const anim = el.animate([{ clipPath: clipTo(el.getBoundingClientRect(), from, radius) }, { clipPath: clipOpen(0, radius) }], {
      duration: dur,
      easing: ease,
    });
    anim.onfinish = anim.oncancel = end;
  }
  el.classList.add("is-in");
  // The focus starts on the shrink square: on the note's body, list-keys would hand it to the
  // first song and scroll the note down to it (seen in Midi, the first run). Tab goes on in.
  el.querySelector<HTMLElement>("[data-present-close]")?.focus({ preventScroll: true });
}

/** The album whose note is open in `host`, for card memory (CARD-MEMORY.md); null when none. */
export const notesOpenIn = (host: HTMLElement): string | null => (open && !closing && open.notes && host.contains(open.el) ? open.notes : null);

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

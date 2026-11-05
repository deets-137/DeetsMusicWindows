// The listen pill on a song row (LISTENERS.md §10): the song's Last.fm plays, as a number alone.
//
// A list draws rows as HTML while it scrolls, so a known count is written into the row when it
// is drawn, and a redraw shows it at once. An unknown pill is empty and keeps its room, so a count
// that lands later moves nothing. Drawing one schedules a look: once the list rests, the empty
// pills on screen read the cache in one call, and what is left asks Last.fm, paced.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { askForms, exactCount, listenersFor, songInfoKey } from "./listeners";
import { mainArtist, pillCount, titleKey, topByTitle, type TopTrack } from "./lastfm-names";
import { setting } from "./settings-store";
import { WEB_ROOMS } from "./platform";
import * as diag from "./diag";
import { esc } from "./dom";

interface Known {
  playcount: number;
  listeners: number;
}

/** A list at rest for this long: a fling past rows asks nothing for them. */
const REST_MS = 300;
/** Last.fm asks for about 5 calls a second at most (LISTENERS.md §9.2). */
const ASK_GAP_MS = 250;
/** A song Last.fm could not answer is asked again after this long. */
const RETRY_MS = 5 * 60 * 1000;
/** Empty pills of one artist on screen that make their list worth its call: a list is 400 to
 *  800 KB, so a lone song keeps `track.getInfo` (LISTENERS.md §10.5). */
const ARTIST_MIN_SONGS = 2;
/** The artists' lists held in memory; the oldest goes first. */
const ARTISTS_HELD = 30;

const tops = new Map<string, Map<string, TopTrack>>(); // the artist, lower case → the list by title
const known = new Map<string, Known | null>(); // key → the counts; null: Last.fm has no plays
const tracks = new Map<string, Track>();
const missed = new Map<string, number>();
const waiting = new Set<string>();
let timer = 0;
let retry = 0;
let pumping = false;
let wired = false;

const hint = (c: Known): string =>
  `${c.playcount.toLocaleString()} plays and ${c.listeners.toLocaleString()} listeners on Last.fm`;

/** The pills show here: the row in Settings, and never in the web port. */
export const listenPillsOn = (): boolean => !WEB_ROOMS && setting("showListeners");

/** The pill for a song row. "" when it never shows; empty while its count is not known. */
export function listenPillHTML(t: Track): string {
  const key = songInfoKey(t);
  if (!key || t.unreleased || !listenPillsOn()) return "";
  wire();
  tracks.set(key, t);
  const c = known.get(key);
  if (c === undefined) look();
  return `<span class="listen-pill" data-listen="${esc(key)}"${c ? ` title="${esc(hint(c))}"` : ""}>${c ? pillCount(c.playcount) : ""}</span>`;
}

function wire(): void {
  if (wired) return;
  wired = true;
  // A scroll inside the rows already drawn draws nothing, but it shows new pills.
  document.addEventListener(
    "scroll",
    (e) => {
      if ((e.target as HTMLElement).classList?.contains("lib-view")) look();
    },
    { capture: true, passive: true },
  );
  // Back online: the songs that failed are asked now, not in five minutes.
  window.addEventListener("online", () => {
    missed.clear();
    look();
  });
}

function look(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void scan(), REST_MS);
}

/** On screen: laid out, and inside its list's box. A narrow list hides its pills, so it asks nothing. */
function seen(el: HTMLElement): boolean {
  if (!el.checkVisibility()) return false;
  const box = el.closest(".lib-view")?.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return !!box && r.bottom > box.top && r.top < box.bottom && r.right > 0 && r.left < window.innerWidth;
}

const emptyOnScreen = (): string[] => {
  const keys = new Set<string>();
  document.querySelectorAll<HTMLElement>(".listen-pill:empty").forEach((el) => {
    const key = el.dataset.listen!;
    if (!known.has(key) && Date.now() - (missed.get(key) ?? 0) > RETRY_MS && seen(el)) keys.add(key);
  });
  return [...keys];
};

function land(key: string, c: Known | null): void {
  known.set(key, c);
  if (!c) return;
  document.querySelectorAll<HTMLElement>(`.listen-pill[data-listen="${CSS.escape(key)}"]`).forEach((el) => {
    el.textContent = pillCount(c.playcount);
    el.title = hint(c);
  });
}

const counted = (state: string, playcount: number, listeners: number): Known | null =>
  state === "have" && playcount > 0 ? { playcount, listeners } : null;

async function scan(): Promise<void> {
  if (!listenPillsOn()) return;
  const keys = emptyOnScreen();
  if (!keys.length) return;
  const twoForms = keys.filter((k) => {
    const t = tracks.get(k);
    return !!t && askForms(t.artistName ?? "", t.title).length > 1;
  });
  const kept = await invoke<Record<string, { state: string; listeners: number; playcount: number }>>("lastfm_listen_counts", { ids: keys, twoForms }).catch(
    () => ({}) as Record<string, { state: string; listeners: number; playcount: number }>,
  );
  for (const key of keys) {
    const c = kept[key];
    if (c) land(key, counted(c.state, c.playcount, c.listeners));
    else waiting.add(key);
  }
  void pump();
}

const artistOf = (t: Track): string => mainArtist(t.artistName ?? "").toLowerCase();

/** One call for the artist's list, held for the session. A failure holds nothing. */
async function topOf(artist: string, name: string): Promise<Map<string, TopTrack> | null> {
  const [rows] = await Promise.all([
    invoke<TopTrack[]>("lastfm_artist_top", { artist: name }).catch(() => null),
    new Promise((r) => window.setTimeout(r, ASK_GAP_MS)),
  ]);
  if (!rows) return null;
  const top = topByTitle(rows);
  tops.set(artist, top);
  if (tops.size > ARTISTS_HELD) tops.delete(tops.keys().next().value!);
  return top;
}

/** Every song drawn by this artist that its list knows: the rows off screen too, so a scroll down
 *  the album finds them filled. What the list does not hold stays for `track.getInfo`. */
async function fillFrom(artist: string, top: Map<string, TopTrack>): Promise<void> {
  const rows: Array<{ id: string; listeners: number; playcount: number; url?: string }> = [];
  for (const [key, t] of tracks) {
    if (known.has(key) || artistOf(t) !== artist) continue;
    const hit = top.get(titleKey(t.title));
    if (hit && hit.playcount > 0) rows.push({ id: key, listeners: hit.listeners, playcount: hit.playcount, url: hit.url });
  }
  if (!rows.length) return;
  await invoke("lastfm_keep_counts", { rows }).catch(() => undefined);
  for (const row of rows) {
    waiting.delete(row.id);
    land(row.id, { playcount: row.playcount, listeners: row.listeners });
  }
  diag.log("listen:artist", { filled: rows.length });
}

/** The waiting songs by artist: an artist's list first, in place of a call for each song. An exact
 *  count asks Apple's names alone, so it never reads a list. */
async function fillByArtist(): Promise<void> {
  if (exactCount()) return;
  const byArtist = new Map<string, { name: string; songs: number }>();
  for (const key of waiting) {
    const t = tracks.get(key);
    if (!t?.artistName) continue;
    const artist = artistOf(t);
    const had = byArtist.get(artist);
    byArtist.set(artist, { name: mainArtist(t.artistName), songs: (had?.songs ?? 0) + 1 });
  }
  for (const [artist, { name, songs }] of byArtist) {
    if (!listenPillsOn()) return;
    if (!tops.has(artist) && songs < ARTIST_MIN_SONGS) continue;
    const top = tops.get(artist) ?? (await topOf(artist, name));
    if (top) await fillFrom(artist, top);
  }
}

/** Asks start one gap apart and do not wait for the answer before them: a song's round trip
 *  (200 to 400 ms a call) is not added to the gap. A song with two name forms is two calls, so it
 *  takes two gaps. A song scrolled away by its turn waits for the next look. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  await fillByArtist();
  let asked = 0;
  for (const key of [...waiting]) {
    waiting.delete(key);
    const t = tracks.get(key);
    if (!listenPillsOn() || !t || known.has(key) || !emptyOnScreen().includes(key)) continue;
    asked++;
    void listenersFor(t).then((c) => {
      if (c) return land(key, counted(c.state, c.playcount, c.listeners));
      missed.set(key, Date.now());
      window.clearTimeout(retry);
      retry = window.setTimeout(look, RETRY_MS + REST_MS);
    });
    const calls = Math.max(1, askForms(t.artistName ?? "", t.title).length);
    await new Promise((r) => window.setTimeout(r, ASK_GAP_MS * calls));
  }
  pumping = false;
  if (asked) diag.log("listen:asked", { asked });
  if (waiting.size) void pump();
}

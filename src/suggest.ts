// Suggest Less (docs/features/SUGGEST-LESS.md) — the front-end half of the marks.
//
// One list of marks on songs, artists and albums, loaded from the Rust table at boot (suggest.rs)
// and held in memory, so the player can ask "is this song marked?" at a song change with no call
// (suggest-match.ts is the rule). Three feeds keep it: our own marks (optimistic, then the Rust
// write, which sends a song's −1 to Apple when the Add to Library and ♥ consent is on), Apple's
// −1s read with the ♥ (favorites_reconcile), and R1 (§3a): Home's recent-plays read is asked
// again, so a −1 set on the phone reaches the list.
//
// What the marks do is three toggles in Settings › Playback: `suggestSkipWebs` (here: the web
// filter), `suggestSkipQueue` and `suggestSkipStations` (player.ts). This module never imports
// the player: the player imports it.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Track } from "./library";
import type { MenuItem } from "./context-menu";
import { libraryAddEnabled, onLibraryAddChange } from "./library-add";
import { applyRatings, dropLoved, isKnown, isLoved, onDislikesRead, onFavoritesChange, type Ratings } from "./favorites";
import { setting, onSettingsChange } from "./settings-store";
import { toast } from "./toast";
import * as diag from "./diag";
import { addMark, albumNameKey, emptySets, fold, matchSong, type MarkKind, type MarkSets, type MatchSong } from "./suggest-match";

/** One mark, as suggest.rs sends it. */
export interface Mark {
  kind: MarkKind;
  key: string;
  name?: string | null;
  artist?: string | null;
  source: "apple" | "local";
  synced: boolean;
  at: number;
}

const marks = new Map<string, Mark>(); // `${kind}:${key}` → mark
let sets: MarkSets = emptySets();
let ready = false;
let wired = false;

const listeners = new Set<() => void>();
/** The list changed (a mark, an Undo, a read, Clear). The Queue card and the player listen. */
export function onSuggestChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const id = (m: Pick<Mark, "kind" | "key">) => `${m.kind}:${m.key}`;

function rebuild(): void {
  sets = emptySets();
  for (const m of marks.values()) addMark(sets, m.kind, m.key, m.name, m.artist);
  listeners.forEach((cb) => cb());
}

function load(list: Mark[]): void {
  marks.clear();
  for (const m of list) marks.set(id(m), m);
  rebuild();
}

/** Load the list once at boot (zero Apple calls). */
export async function initSuggest(): Promise<void> {
  if (!wired) {
    wired = true;
    // Another Apple account: Rust dropped the −1s read from the last one (library.rs).
    void listen("apple-account-changed", () => void reload());
    // A read on screen found a −1 (favorites.ts `reconcile`).
    onDislikesRead(() => void reload());
    // A ♥ replaces a −1 (Apple keeps one rating per song): the song's mark goes. Rust has
    // deleted its row already (favorite_set, the Favorite Songs seed).
    onFavoritesChange(() => {
      let gone = false;
      for (const m of [...marks.values()]) {
        if (m.kind === "song" && isLoved({ catalogId: m.key } as Track)) {
          marks.delete(id(m));
          gone = true;
        }
      }
      if (gone) rebuild();
    });
    // The consent turned on: the marks made while it was off go to Apple, once (§3 rules).
    onLibraryAddChange(() => {
      if (libraryAddEnabled()) void push();
    });
    onSettingsChange((k) => {
      if (k === "suggestSkipStations" || k === "suggestSkipWebs" || k === "suggestSkipQueue")
        diag.log(setting(k) ? "suggest:arm" : "suggest:off", { row: k });
    });
  }
  await reload();
}

async function reload(): Promise<void> {
  try {
    load(await invoke<Mark[]>("suggest_list"));
    ready = true;
  } catch (e) {
    console.warn("[suggest] load", e);
  }
}

async function push(): Promise<void> {
  if (![...marks.values()].some((m) => m.kind === "song" && m.source === "local" && !m.synced)) return;
  try {
    const sent = await invoke<string[]>("suggest_push");
    sent.forEach(dropLoved);
    if (sent.length) await reload();
  } catch (e) {
    console.warn("[suggest] push", e);
  }
}

// ── reading the list ──────────────────────────────────────────────────────────

/** Which mark a song matches (§5c), or null. `extraId`: a queue row's other id. */
export const matchOf = (s: MatchSong | undefined, extraId?: string): MarkKind | null =>
  s && ready && marks.size ? matchSong(sets, s, extraId) : null;

export const songKey = (t: Pick<Track, "catalogId" | "libraryId">): string | undefined => t.catalogId ?? t.libraryId;

export function isSongMarked(t: Track | undefined): boolean {
  const k = t && songKey(t);
  return !!k && marks.has(`song:${k}`);
}

/** The artist mark under this name (or id), if any. */
function artistMark(name: string, catalogId?: string): Mark | undefined {
  if (catalogId && marks.has(`artist:${catalogId}`)) return marks.get(`artist:${catalogId}`);
  const n = fold(name);
  return [...marks.values()].find((m) => m.kind === "artist" && fold(m.name ?? m.key) === n);
}
function albumMark(title: string, artist: string, catalogId?: string): Mark | undefined {
  if (catalogId && marks.has(`album:${catalogId}`)) return marks.get(`album:${catalogId}`);
  const k = albumNameKey(title, artist);
  return [...marks.values()].find((m) => m.kind === "album" && albumNameKey(m.name ?? "", m.artist ?? "") === k);
}
export const isArtistMarked = (name: string, catalogId?: string): boolean => !!artistMark(name, catalogId);
export const isAlbumMarked = (title: string, artist: string, catalogId?: string): boolean => !!albumMark(title, artist, catalogId);

/** "12 songs, 2 artists, 1 album" — the Settings status line. */
export function countText(): string {
  const n = { song: 0, artist: 0, album: 0 };
  for (const m of marks.values()) n[m.kind]++;
  const part = (k: number, one: string) => (k ? `${k} ${one}${k === 1 ? "" : "s"}` : "");
  return [part(n.song, "song"), part(n.artist, "artist"), part(n.album, "album")].filter(Boolean).join(", ") || "No marks";
}
export const markCount = (): number => marks.size;

// ── writing ───────────────────────────────────────────────────────────────────

/** Mark or unmark, optimistic: the list changes now, Rust (and Apple, with the consent on, for a
 *  catalog song) is told, and a failure puts it back and says so — as the ♥ does. */
async function write(m: Mark, on: boolean, label: string, track?: Track): Promise<void> {
  const was = marks.get(id(m));
  if (on) marks.set(id(m), m);
  else marks.delete(id(m));
  rebuild();
  const apple = libraryAddEnabled();
  try {
    const saved = await invoke<Mark>("suggest_set", { mark: m, on, apple, track: track ?? null });
    if (on) marks.set(id(saved), saved);
    if (on && saved.synced) dropLoved(saved.key);
    diag.log("suggest:mark", { kind: m.kind, on, source: "local", synced: saved.synced });
  } catch (e) {
    if (was) marks.set(id(m), was);
    else marks.delete(id(m));
    rebuild();
    toast({ kind: "warn", text: `Couldn't update Suggest Less for “${label}”.` });
    throw e;
  }
}

const fresh = (kind: MarkKind, key: string, name?: string, artist?: string): Mark => ({
  kind, key, name: name ?? null, artist: artist ?? null, source: "local", synced: false, at: 0,
});

export function setSongMark(t: Track, on: boolean): Promise<void> {
  const key = songKey(t);
  if (!key) return Promise.reject(new Error("song has no id"));
  return write(fresh("song", key, t.title, t.artistName), on, t.title, t);
}

export interface ArtistMarkSubject {
  name: string;
  catalogId?: string;
}
export function setArtistMark(a: ArtistMarkSubject, on: boolean): Promise<void> {
  const old = artistMark(a.name, a.catalogId);
  const m = on ? fresh("artist", a.catalogId ?? fold(a.name), a.name) : old;
  return m ? write(m, on, a.name) : Promise.resolve();
}

export interface AlbumMarkSubject {
  title: string;
  artistName: string;
  catalogId?: string;
}
export function setAlbumMark(a: AlbumMarkSubject, on: boolean): Promise<void> {
  const old = albumMark(a.title, a.artistName, a.catalogId);
  const m = on ? fresh("album", a.catalogId ?? albumNameKey(a.title, a.artistName), a.title, a.artistName) : old;
  return m ? write(m, on, a.title) : Promise.resolve();
}

const errLog = (what: string) => (e: unknown) => console.error(`[suggest] ${what}`, e);

// ── the menu items (media-menu.ts puts them in group 5, next to Favorite) ───────

export function suggestSongItem(t: Track | undefined): MenuItem | null {
  if (!t || !songKey(t)) return null;
  const on = isSongMarked(t);
  return { label: on ? "Undo Suggest Less" : "Suggest Less", run: () => void setSongMark(t, !on).catch(errLog("song")) };
}

export function suggestArtistItem(a: ArtistMarkSubject | undefined): MenuItem | null {
  if (!a?.name) return null;
  const on = isArtistMarked(a.name, a.catalogId);
  return {
    label: on ? "Undo Suggest Less of This Artist" : "Suggest Less of This Artist",
    run: () => void setArtistMark(a, !on).catch(errLog("artist")),
  };
}

export function suggestAlbumItem(a: AlbumMarkSubject | undefined): MenuItem | null {
  if (!a?.title || !a.artistName) return null;
  const on = isAlbumMarked(a.title, a.artistName, a.catalogId);
  return {
    label: on ? "Undo Suggest Less of This Album" : "Suggest Less of This Album",
    run: () => void setAlbumMark(a, !on).catch(errLog("album")),
  };
}

// ── Settings › Playback › Clear ───────────────────────────────────────────────

/** Every mark goes from our list; Undo puts them back. Apple's −1s stay on Apple. */
export async function clearMarks(): Promise<void> {
  const before = await invoke<Mark[]>("suggest_clear");
  load([]);
  diag.log("suggest:clear", { n: before.length });
  toast({
    kind: "success",
    text: `Cleared ${before.length} Suggest Less mark${before.length === 1 ? "" : "s"}.`,
    timeout: 6000,
    actions: [{ label: "Undo", run: () => void invoke("suggest_restore", { marks: before }).then(reload).catch(errLog("restore")) }],
  });
}

// ── Apple's −1s: the reads ────────────────────────────────────────────────────

async function ask(ids: string[], why: "R1" | "web"): Promise<void> {
  if (!ids.length) return;
  diag.log("suggest:ask", { why, ids: ids.length });
  try {
    const r = await invoke<Ratings>("favorites_reconcile", { ids, why });
    applyRatings(r);
    await reload();
  } catch (e) {
    console.warn(`[suggest] ask ${why}`, e);
  }
}

/** R1 (§3a, his pick): Home's recent-plays read came back. Ask Apple about every one of them
 *  again, an id with a ♥ row too: a −1 set on the phone joins the list, one cleared there goes.
 *  One call per Home read (up to 100 ids). */
export function recheckRecent(played: Track[]): void {
  const ids = [...new Set(played.map((t) => t.catalogId).filter((x): x is string => !!x))].slice(0, 100);
  void ask(ids, "R1");
}

/** The web's Apple check (1B, §4): the candidate songs never asked, nearest degree first, at
 *  most `cap` of them. Runs with **Leave out of webs** off too: it is how Apple's −1s reach the
 *  list. A second build of the same web asks nothing (every asked id keeps its mirror row). */
export async function checkWeb(songs: { track: Track; degree: number }[], cap: number): Promise<void> {
  const ids: string[] = [];
  for (const s of [...songs].sort((a, b) => a.degree - b.degree)) {
    const c = s.track.catalogId;
    if (!c || isKnown(c) || ids.includes(c)) continue;
    ids.push(c);
    if (ids.length >= cap) break;
  }
  await ask(ids, "web");
}

/** **Leave out of webs** (§4): the candidates with no mark, when the row is on. */
export function webKeep<S extends { track: Track; anchor?: boolean }>(songs: S[]): S[] {
  if (!setting("suggestSkipWebs") || !marks.size) return songs;
  // The seed song you picked leads the web whatever its mark: a pick always plays (§0).
  const kept = songs.filter((s) => s.anchor || !matchOf(s.track));
  if (kept.length !== songs.length) diag.log("suggest:web", { dropped: songs.length - kept.length });
  return kept;
}

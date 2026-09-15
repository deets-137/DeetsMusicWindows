// Artist views (ARTIST-VIEW.md) — what the Library and Search artist views share: the
// Library artist's catalog facts (photo + featured playlists, Rust-cached), "Your
// Playlists" matching over the stored playlists, the shelf markup, and a shelf tile's menu.

import { invoke } from "@tauri-apps/api/core";
import type { Artwork, Track } from "./library";
import type { Playlist } from "./search";
import { materializeTrack } from "./search";
import { creditIndex } from "./artist-credit";
import { tracks as libraryTracks, addTransientTracks } from "./track-store";
import { playlistsCached, playlistSongIndex, playlistTracks, addToPlaylistItem, songs } from "./playlists";
import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { esc } from "./collection-card";
import { mosaicHTML } from "./mosaic";
import type { MenuItem } from "./context-menu";

// ── the Library artist's catalog facts (§4) ─────────────────────────────────────
export interface LibraryArtistInfo {
  catalogId?: string;
  artwork?: Artwork;
  featuredPlaylists?: Playlist[];
  /** Apple's top songs for the artist, most popular first (the "Popular" sort). */
  topSongs?: Track[];
}

/** One song's play tallies (stats.ts), keyed by `libraryId ?? catalogId`. */
export interface PlayCount {
  id: string;
  full: number;
  partial: number;
}

/** This app's play tallies for every song it has played (the "Most Played" sort). Zero Apple calls. */
export function playCounts(): Promise<Map<string, PlayCount>> {
  return invoke<PlayCount[]>("play_counts").then((rows) => new Map(rows.map((r) => [r.id, r])));
}

// One answer per artist name per session, so a re-render never re-invokes. The Rust side
// is cache-first anyway (0 calls when the saved row is current).
const infoMemo = new Map<string, Promise<LibraryArtistInfo | null>>();

/** The photo + featured playlists for a library artist. `songIds` are the artist's songs'
 *  catalog ids; the first one resolves the artist on a first open. */
export function libraryArtistInfo(name: string, songIds: (string | undefined)[]): Promise<LibraryArtistInfo | null> {
  let p = infoMemo.get(name);
  if (!p) {
    p = invoke<LibraryArtistInfo | null>("library_artist_info", { name, songId: songIds.find(Boolean) ?? null, featured: true });
    p.catch(() => infoMemo.delete(name)); // a failure tries again on the next open
    infoMemo.set(name, p);
  }
  return p;
}

/** The Library ⟳: the saved featured lists count as old, so each artist's next open fetches
 *  its list again (1 call). Ids and photo links stay. */
export function expireArtistInfo(): void {
  infoMemo.clear();
  invoke("library_artists_expire").catch((e) => console.warn("[artist] expire", e));
}

// ── Your Playlists (§3) ──────────────────────────────────────────────────────────
export interface PlaylistHit {
  p: Playlist;
  /** The playlist's songs that credit the artist. */
  count: number;
}
export interface YourPlaylists {
  hits: PlaylistHit[];
  /** Apple playlists never opened: their songs are unknown until checked. */
  unchecked: Playlist[];
}

const byName = (a: Playlist, b: Playlist) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The user's playlists with songs by `name` — the Artists grouping's credit parse, with the
 *  library vocabulary, so a song that features the artist counts. Zero Apple calls. */
export async function yourPlaylistsFor(name: string): Promise<YourPlaylists> {
  const [lists, index] = await Promise.all([playlistsCached(), playlistSongIndex()]);
  const byKey = new Map(lists.filter((p) => p.libraryId).map((p) => [p.libraryId!, p]));
  // A local playlist's exported Apple copy is the same playlist: list it once (PLAYLISTS.md §6).
  const linked = new Set(lists.map((p) => p.exportedAppleId).filter(Boolean));
  const shown = (p: Playlist | undefined): p is Playlist => !!p && !(p.source === "apple" && linked.has(p.libraryId));
  const credits = creditIndex(libraryTracks());
  const hits: PlaylistHit[] = [];
  for (const l of index.lists) {
    const p = byKey.get(l.key);
    if (!shown(p)) continue;
    let count = 0;
    for (const t of l.tracks) if (credits.namesOf(t).includes(name)) count++;
    if (count) hits.push({ p, count });
  }
  hits.sort((a, b) => b.count - a.count || byName(a.p, b.p));
  const unchecked = index.unchecked.map((k) => byKey.get(k)).filter(shown);
  return { hits, unchecked };
}

/** Unopened playlists fetched at once. Each fetch is 1 call per 100 songs, so one at a time
 *  was slow; a few in parallel stays gentle on Apple. */
const CHECK_PARALLEL = 4;

/** Check progress: `done` of `total` playlists fetched. */
export interface CheckProgress {
  done: number;
  total: number;
}

/** "Check N more playlists": fetch each unopened Apple playlist's songs, CHECK_PARALLEL at a
 *  time, reporting each finish. They are saved, so later checks of any artist read them free. */
export async function checkPlaylists(ps: Playlist[], onProgress: (p: CheckProgress) => void): Promise<void> {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < ps.length) {
      const p = ps[next++];
      try {
        await playlistTracks(p);
      } catch (e) {
        console.warn("[artist] check playlist", p.name, e);
      }
      onProgress({ done: ++done, total: ps.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_PARALLEL, ps.length) }, worker));
}

// ── shelf markup (both views) ─────────────────────────────────────────────────────
// Tiles reuse the Search card's tile + scroller classes, so a shelf looks the same in both
// cards. Each tile carries `data-shelf-item` (featured | yours | check) + `data-shelf-idx`;
// a featured tile also carries `data-playlist`, which makes it a drag source in Search.
const artURL = (art: Artwork | undefined, px: number): string | null =>
  art?.urlTemplate ? art.urlTemplate.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;

function tileArt(p: Playlist, seed: string): string {
  const url = artURL(p.artwork, 192);
  if (url) return `<img class="search__tile-art" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`;
  if (p.coverUrls?.length) return mosaicHTML("search__tile-art", p.coverUrls, seed);
  return `<div class="search__tile-art search__tile-art--empty" aria-hidden="true">♪</div>`;
}

const tile = (kind: string, idx: number, art: string, name: string, sub: string, extra = ""): string =>
  `<div class="search__tile" data-shelf-item="${kind}" data-shelf-idx="${idx}"${extra} role="button" tabindex="0">` +
  `${art}<span class="search__tile-name">${esc(name)}</span><span class="search__tile-sub">${esc(sub)}</span></div>`;

/** Featured Playlists + Your Playlists. `yours` undefined = still loading (the shelf waits);
 *  `progress` non-null = a check is running. `lead` / `tail` are the caller's own markup
 *  before and after (the Library's Albums shelf and its Songs label). An empty shelf is left
 *  out; "" when everything is. */
export function artistShelvesHTML(
  featured: Playlist[] | undefined,
  yours: YourPlaylists | undefined,
  progress: CheckProgress | null,
  lead = "",
  tail = "",
): string {
  const section = (label: string, tiles: string) =>
    tiles ? `<div class="search__label">${label}</div><div class="search__scroller search__scroller--playlists">${tiles}</div>` : "";
  const f = (featured ?? [])
    .map((p, i) =>
      tile("featured", i, tileArt(p, p.catalogId ?? p.name), p.name, p.curatorName ?? "Apple Music", ` data-playlist="${esc(p.catalogId ?? "")}"`),
    )
    .join("");
  let y = "";
  if (yours) {
    y = yours.hits.map((h, i) => tile("yours", i, tileArt(h.p, h.p.libraryId ?? h.p.name), h.p.name, songs(h.count))).join("");
    const n = yours.unchecked.length;
    if (n) {
      const glyph = `<div class="search__tile-art search__tile-art--empty" aria-hidden="true">${progress ? "…" : "+"}</div>`;
      y += progress
        ? tile("check", 0, glyph, `Checking ${progress.done} of ${progress.total}`, "playlists")
        : tile("check", 0, glyph, `Check ${n} more`, n === 1 ? "playlist" : "playlists");
    }
  }
  const body = lead + section("Featured Playlists", f) + section("Your Playlists", y) + tail;
  return body ? `<div class="lib-shelves">${body}</div>` : "";
}

/** A shelf playlist's right-click: play or queue its songs, or add them to a playlist.
 *  `catalog` songs join the store first, as a Search play does. */
export function playlistShelfMenu(load: () => Promise<Track[]>, context: string, catalog: boolean): MenuItem[] {
  const run = (how: "now" | "next" | "later") => () =>
    void load()
      .then((ts) => {
        if (!ts.length) return;
        if (catalog) {
          addTransientTracks(ts);
          ts.forEach(materializeTrack);
        }
        return how === "now" ? playTracks(ts, 0, context) : how === "next" ? queueTracksNext(ts, context) : queueTracksLater(ts, context);
      })
      .catch((e) => console.error("[artist] shelf menu", e));
  return [
    { label: "Play Now", run: run("now") },
    { label: "Play Next", run: run("next") },
    { label: "Add to Queue", run: run("later") },
    addToPlaylistItem(load),
  ].filter(Boolean) as MenuItem[];
}

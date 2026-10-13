// The library's derived album model and its pure helpers: one album key, the album groups,
// the play orders, the album as the menus take it. Moved out of library-card.ts (2026-10-13)
// so the album and artist levels (media-levels.ts, ARTIST-VIEW.md §10.1) read the same rules
// as the Library card without an import cycle. library-card.ts re-exports the ones other
// modules import from it.

import type { Artwork, Track } from "./library";
import type { AlbumSubject } from "./media-menu";

export interface AlbumGroup {
  key: string;
  name: string;
  artist: string;
  artwork?: Artwork;
  releaseDate?: string; // earliest track release
  addedRank?: number; // earliest-added track's rank
  count: number;
}

// Albums key on album name + COVER-ART URL, not the per-track artist. Every track on an
// album shares one cover URL, so this reunites tracks that credit a featured guest (which
// used to fragment the album into one entry per artist) and collapses various-artists
// compilations, while two same-named albums with different covers stay distinct. Tracks
// with no artwork fall back to the old name+artist key. The TRUE album identity (a real
// library/catalog album id) is a later catalog-hydrate upgrade; this is the cheap fix.
export const albumKey = (t: Track) => {
  const name = t.albumName ?? "Unknown Album";
  const art = t.artwork?.urlTemplate;
  return art ? `${name} ${art}` : `${name} ${t.artistName ?? ""}`;
};

export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  // Album's displayed artist = its DOMINANT track artist (a featured guest on one track
  // shouldn't relabel the whole album), tracked via per-artist counts.
  const map = new Map<string, AlbumGroup & { artistCounts: Map<string, number> }>();
  for (const t of tracks) {
    const key = albumKey(t);
    let g = map.get(key);
    if (!g) {
      g = { key, name: t.albumName ?? "Unknown Album", artist: "", count: 0, artistCounts: new Map() };
      map.set(key, g);
    }
    g.count++;
    const an = t.artistName ?? "";
    g.artistCounts.set(an, (g.artistCounts.get(an) ?? 0) + 1);
    if (!g.artwork && t.artwork) g.artwork = t.artwork;
    if (t.releaseDate && (!g.releaseDate || t.releaseDate < g.releaseDate)) g.releaseDate = t.releaseDate;
    // album's "added" = its MOST-RECENTLY-added track, so a freshly-touched album surfaces first
    if (t.addedRank != null && (g.addedRank == null || t.addedRank > g.addedRank)) g.addedRank = t.addedRank;
  }
  const groups = [...map.values()];
  for (const g of groups) {
    let best = -1;
    for (const [name, n] of g.artistCounts) if (n > best) { best = n; g.artist = name; }
  }
  return groups;
}

export function artURL(art: Artwork | undefined, px: number): string | null {
  if (!art?.urlTemplate) return null;
  const s = String(px);
  return art.urlTemplate.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg");
}
/** "3:41" for a track length; "" when unknown. */
export const fmtClock = (ms: number | undefined): string => {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const trackId = (t: Track) => t.libraryId ?? t.catalogId ?? `${t.title} ${t.artistName}`;

// The play_stats key is CATALOG-first (`record_play` in library.rs, to match the tracks PK).
// A library song carries both ids and they differ, so a library-first lookup misses every one.
export const playsKey = (t: Track) => t.catalogId ?? t.libraryId ?? "";

// One builder for songs and albums: a song is a 1-track list; an album is its tracks
// in disc/track order. "Play Now" plays the list from the top (a song → just that song;
// an album → the whole album as the new context). Next/Later insert without a rebuild.
export const albumOrder = (ts: Track[]): Track[] =>
  [...ts].sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
/** An artist's songs in album order: albums oldest first, each in disc/track order (a drag). */
export const artistOrder = (ts: Track[]): Track[] =>
  [...ts].sort(
    (a, b) =>
      (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") ||
      (a.albumName ?? "").localeCompare(b.albumName ?? "") ||
      (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
      (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
  );

/** A library album (its songs in disc/track order) as the menu builders take it
 *  (media-menu.ts, CONTEXT-MENUS.md). `pinKey`: the tile's own key, where it has one. */
export const libAlbum = (ts: Track[], pinKey?: string): AlbumSubject => ({
  title: ts[0]?.albumName ?? "Album",
  artistName: ts[0]?.artistName,
  artwork: ts[0]?.artwork,
  known: ts,
  pinKey,
});

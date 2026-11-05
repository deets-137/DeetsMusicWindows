// A playlist's saved sort, the pure part (PLAYLISTS.md §13): which sorts a playlist page offers,
// what counts as a saved sort, and the song order a saved sort gives. The page and every Play
// outside it read these, so the page and the Play never disagree. The store is in playlists.ts.
import type { SortDir, SortSpec } from "./collection-card";
import type { Track } from "./library";
import type { Playlist } from "./search";
import { sortItems } from "./sort-items";

export interface SavedSort {
  sortKey: string;
  sortDir: SortDir;
}

/** A playlist's identity everywhere: the page's `playlist:<key>`, a play's context, the store's row. */
export const playlistKey = (p: Playlist): string => p.libraryId ?? p.catalogId ?? p.name;

/** The sorts of a playlist page. `pos` is a song's authored position. */
export const playlistSorts = (pos: (t: Track) => number | undefined): SortSpec<Track>[] => [
  { key: "order", label: "Playlist Order", type: "num", get: pos },
  { key: "az", label: "A–Z", type: "str", get: (t) => t.title },
  { key: "artist", label: "Artist", type: "str", get: (t) => t.artistName },
];

const KEYS = new Set(playlistSorts(() => undefined).map((s) => s.key));

/** A stored sort, or null when it is not one this app offers (an old row, a hand edit). */
export function cleanSort(sortKey: unknown, sortDir: unknown): SavedSort | null {
  if (typeof sortKey !== "string" || !KEYS.has(sortKey)) return null;
  return sortDir === "asc" || sortDir === "desc" ? { sortKey, sortDir } : null;
}

/** The default needs no row: a playlist with no row opens in Playlist Order, ascending. */
export const isDefaultSort = (s: SavedSort): boolean => s.sortKey === "order" && s.sortDir === "asc";

/** The songs in the order the page shows. No saved sort: the list as given, the authored order. */
export function orderPlaylist(tracks: Track[], saved: SavedSort | null): Track[] {
  if (!saved || isDefaultSort(saved)) return tracks;
  const at = new Map(tracks.map((t, i) => [t, i]));
  const spec = playlistSorts((t) => at.get(t)).find((s) => s.key === saved.sortKey);
  return spec ? sortItems(tracks, spec, saved.sortDir, (t) => t.title) : tracks;
}

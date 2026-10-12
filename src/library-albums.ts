// Your library as albums (SEARCH-FIELDS.md §6): one grouping for every field that lists the
// albums in your library — the Diary picker and the Playlist Web seed field. Before
// 2026-10-12 each had its own copy, and the two disagreed on what "your library" is.

import { tracks } from "./track-store";
import { albumKey } from "./rewind";
import type { Track } from "./library";

const memo = new WeakMap<Track[], Track[][]>();

/** Your library songs grouped by album (`albumKey`), in the store's order. A catalog song the
 *  app only saw played is not your library. Memoized on the store's list, which a sync
 *  replaces, so a picker that runs on every key costs one grouping per sync. */
export function libraryAlbumGroups(): Track[][] {
  const list = tracks();
  const hit = memo.get(list);
  if (hit) return hit;
  const groups = new Map<string, Track[]>();
  for (const t of list) {
    if (!t.libraryId) continue;
    const k = albumKey(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out = [...groups.values()];
  memo.set(list, out);
  return out;
}

// Apple's editorial notes on an album (docs/features/album-notes.md): the read, and the page's
// memory of it. Rust (`album_notes`, notes.rs) keeps each album's notes a month; this module
// keeps the answers for the session, so a page drawn again has its About in the first paint (no
// jump, as listeners.ts does for Last.fm).
//
// An album is asked by its catalog id (a Full level, the Search pane) or, for a library album,
// by one of its catalog songs: the first open costs one call (the hop), and Rust remembers the
// song → album pair. The read needs the box's row on and *Notes from* to allow Apple: with
// either off it asks nothing.

import { invoke } from "@tauri-apps/api/core";
import { setting } from "./settings-store";
import * as diag from "./diag";

export interface AlbumNotes {
  state: "have" | "none";
  albumId: string;
  short?: string;
  standard?: string;
  tagline?: string;
  fetchedAt: number;
}

/** How a page names its album: the catalog id, else a catalog song of it (a library album). */
export interface NotesRef {
  albumId?: string;
  songId?: string;
}

const held = new Map<string, Promise<AlbumNotes | null>>();
const known = new Map<string, AlbumNotes | null>();

const keyOf = (r: NotesRef): string | null => (r.albumId ? `a:${r.albumId}` : r.songId ? `s:${r.songId}` : null);

/** Apple's notes may be shown: *Notes from* allows Apple (LISTENERS.md §8.4). The box's own
 *  row (`showAlbumInfo` / `showSongInfo`) is the caller's to check: one album, two pages. */
export const appleNotesWanted = (): boolean => {
  const s = setting("notesSource");
  return s === "both" || s === "apple";
};

/** The notes of an album; null with Apple not allowed, no ref, no album, or a failed read (the
 *  next ask tries again). Shared: two callers in flight make one call. */
export function notesFor(ref: NotesRef): Promise<AlbumNotes | null> {
  const key = keyOf(ref);
  if (!key || !appleNotesWanted()) return Promise.resolve(null);
  let p = held.get(key);
  if (!p) {
    p = invoke<AlbumNotes | null>("album_notes", { albumId: ref.albumId ?? null, songId: ref.songId ?? null }).then(
      (v) => {
        known.set(key, v);
        if (v) known.set(`a:${v.albumId}`, v); // a library album's answer also names its album
        diag.log("notes:read", { key, state: v?.state ?? null });
        return v;
      },
      (e) => {
        held.delete(key); // a miss is not an answer: ask again next time
        diag.log("notes:read", { key, failed: String(e).slice(0, 80) });
        return null;
      },
    );
    held.set(key, p);
  }
  return p;
}

/** The notes if they have landed this session: `undefined` while on their way (or never
 *  asked), `null` for no notes, Apple not allowed, or no ref. */
export function notesNow(ref: NotesRef): AlbumNotes | null | undefined {
  if (!appleNotesWanted()) return null;
  const key = keyOf(ref);
  if (!key) return null;
  if (known.has(key)) return known.get(key);
  return ref.albumId && ref.songId && known.has(`s:${ref.songId}`) ? known.get(`s:${ref.songId}`) : undefined;
}

/** The notes kept under an album id (the full view's open). */
export const notesByAlbum = (albumId: string): AlbumNotes | null | undefined => known.get(`a:${albumId}`);

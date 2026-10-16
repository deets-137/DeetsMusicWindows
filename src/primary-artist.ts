// A song's primary artist and its guests (ideas/apple-calls.md §5).
//
// A library song carries one credit string ("Girl Ultra, Buscabulla & Chromeo"). Apple also
// links it to ONE library artist (the sync page's `include=artists`, `Track.libraryArtist`),
// and the artist pass maps that library artist to its catalog artist (`artist_catalog`:
// "Girl Ultra" → 1207957662 "Girl Ultra"; "Toddla T & Jada Kingdom" → "Toddla T"). That
// catalog artist is the song's PRIMARY artist: Apple's own answer, not a parse, so a name
// with a comma or an `&` in it (Tyler, The Creator) stays one artist.
//
// The guests come from the enrichment read (`include=artists`, his call P2): every catalog
// artist of a song, in Apple's order. Only songs read since 2026-10-15 have them.
//
// Both maps are read from Rust (no Apple call): the primaries at each library load and after
// each sync (the artist pass may change a row), the guests at launch and after a read that
// may have added some. The name is NOT written into each track: a later artist pass corrects
// every song at once. A song with no library artist, or one whose library artist has no
// catalog twin, has no primary here and keeps today's way (the credit parse, artist-credit.ts).

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { usePrimaryLookup } from "./artist-credit";

export interface CatalogArtist {
  id: string;
  name: string;
}

let primaries = new Map<string, CatalogArtist>(); // library artist name → catalog artist
let guests = new Map<string, CatalogArtist[]>(); // song catalog id → its catalog artists
let version = 0;

/** The song's primary artist, when Apple linked it to one with a catalog twin. */
export function primaryOf(t: Track | undefined): CatalogArtist | undefined {
  return t?.libraryArtist ? primaries.get(t.libraryArtist) : undefined;
}

/** Every catalog artist of the song, the primary first, when a read since v19 stored them. */
export function songArtists(catalogId: string | undefined): CatalogArtist[] | undefined {
  return catalogId ? guests.get(catalogId) : undefined;
}

/** The library album's own artist; else undefined (the caller keeps its vote). */
export const albumArtistOf = (t: Track | undefined): string | undefined => t?.albumArtist || undefined;

/** Bumps whenever the primary map changes, so memoized derivations rebuild. */
export const primaryVersion = (): number => version;

usePrimaryLookup({ version: primaryVersion, nameOf: (t) => primaryOf(t)?.name });

const same = (a: Map<string, CatalogArtist>, b: Map<string, CatalogArtist>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || w.id !== v.id || w.name !== v.name) return false;
  }
  return true;
};

/** Read the primary map again. True when it changed (the caller re-renders). */
export async function loadPrimaries(): Promise<boolean> {
  try {
    const rows = await invoke<[string, string, string][]>("artist_primaries");
    const next = new Map(rows.map(([lib, id, name]) => [lib, { id, name }]));
    if (same(primaries, next)) return false;
    primaries = next;
    version++;
    return true;
  } catch (e) {
    console.warn("[primary-artist] primaries", e);
    return false;
  }
}

const toArtists = (list: [string, string][]): CatalogArtist[] => list.map(([id, name]) => ({ id, name }));

/** Read every stored guest list (at launch). */
export async function loadSongArtists(): Promise<void> {
  try {
    const rows = await invoke<[string, [string, string][]][]>("song_artists", { catalogIds: null });
    guests = new Map(rows.map(([cid, list]) => [cid, toArtists(list)]));
  } catch (e) {
    console.warn("[primary-artist] song artists", e);
  }
}

/** Re-read these songs' guests, after a read that may have stored them (the album color's
 *  palette read, the song credits pane). */
export async function noteSongArtists(catalogIds: (string | undefined | null)[]): Promise<void> {
  const ids = catalogIds.filter((c): c is string => !!c);
  if (!ids.length) return;
  try {
    const rows = await invoke<[string, [string, string][]][]>("song_artists", { catalogIds: ids });
    for (const [cid, list] of rows) guests.set(cid, toArtists(list));
  } catch (e) {
    console.warn("[primary-artist] song artists", e);
  }
}

// Catalog search data access (SEARCH.md). Thin wrappers over the Rust provider —
// the frontend only ever sees the normalized model. The Rust side also piggybacks
// every result into the enrichment caches (ISRC / preview / palette ride along free).

import { invoke } from "@tauri-apps/api/core";
import type { Artwork, Track } from "./library";
import type { Station } from "./radio";

export interface Album {
  libraryId?: string;
  catalogId?: string;
  title: string;
  artistName: string;
  artwork?: Artwork;
  genres: string[];
  releaseDate?: string;
  trackCount?: number;
  /** Apple's real add date, set only by `recent_added` (HOME.md §9.2). The library
   *  sync never fills it: it groups albums from tracks, which carry no date. */
  dateAdded?: string;
}

export interface Artist {
  libraryId?: string;
  catalogId?: string;
  name: string;
  artwork?: Artwork;
  /** Catalog genre names (absent when Apple sends none). */
  genres?: string[];
}

export interface Playlist {
  libraryId?: string;
  catalogId?: string;
  globalId?: string;
  name: string;
  description?: string;
  curatorName?: string;
  artwork?: Artwork;
  canEdit: boolean;
  isPublic: boolean;
  trackCount?: number;
  dateAdded?: string;
  lastModified?: string;
  /** "local" (our store, editable) | "apple" (read-only mirror); absent on search hits. */
  source?: string;
  /** Mirror classification: "user" | "catalog" | "smart" (PLAYLISTS.md §2). */
  kind?: string;
  /** Manual folder membership (Playlists card sections); absent = unfiled. */
  folderId?: number;
  /** Up to 100 distinct track-cover templates for the derived mosaic (no `artwork`; PLAYLISTS.md §11). */
  coverUrls?: string[];
  /** A local playlist's latest Apple Music copy (PLAYLISTS.md §6) and its last write (ms). */
  exportedAppleId?: string;
  exportedAt?: number;
  /** A local playlist's role: "replay" = made from listening, not editable by hand (PLAYLISTS.md §10.8). */
  role?: string;
  /** A temporary web playlist's days (PLAYLIST-WEB.md §10); absent = kept. */
  expireDays?: number;
  /** When a temporary playlist is deleted (ms): the later of its creation and its last play, plus its days. */
  expiresAt?: number;
}

export interface SearchResults {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  /** Catalog stations — the Radio card's model; a tap enters radio mode. */
  stations: Station[];
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
  topSongs: Track[];
  /** Apple's playlists that feature the artist (ARTIST-VIEW.md). */
  featuredPlaylists: Playlist[];
}

export type SearchType = "songs" | "albums" | "artists" | "playlists" | "stations";
export const ALL_TYPES: SearchType[] = ["songs", "albums", "artists", "playlists", "stations"];

/** A resolved catalog entity handle (drill-in targets — see `catalogRelated`). */
export interface NamedRef {
  id: string;
  name: string;
}

// Session cache for drill-in id resolution, keyed by (kind, id, rel). Lives in the
// data layer (not the search card) so any future caller — library/queue "Go to
// Artist" — shares the same memoized hops rather than re-fetching.
const relatedCache = new Map<string, NamedRef | null>();

/**
 * Resolve a catalog entity's first related resource ({id, name}) — the song→artist,
 * song→album, album→artist hops behind the "Go to …" verbs. `kind` is the SOURCE
 * type ("songs" | "albums"), `rel` the relationship ("artists" | "albums"). One
 * Apple `include=` fetch, memoized per (kind, id, rel), so repeat picks are free.
 */
export async function catalogRelated(
  kind: "songs" | "albums",
  id: string,
  rel: "artists" | "albums",
): Promise<NamedRef | null> {
  const key = `${kind}/${id}/${rel}`;
  const hit = relatedCache.get(key);
  if (hit !== undefined) return hit;
  const ref = await invoke<NamedRef | null>("catalog_related", { kind, id, rel });
  relatedCache.set(key, ref);
  return ref;
}

// ── the session cache for catalog panes (CARD-MEMORY.md §6) ──
// Every open of an album, a catalog playlist or an artist was an Apple call, and a remounted
// Search card opens its panes again. Memory only, never on disk (Apple's terms on stored
// catalog content, as the mosaic covers). A failed fetch is not kept. Insertion order is the
// recency: a hit moves to the end, the oldest entry goes past the cap.
const PANE_CAP = 30;
const SEARCH_CAP = 10;
const paneCache = new Map<string, Track[] | ArtistDetail>();
const searchCache = new Map<string, SearchResults>();
const inflight = new Map<string, Promise<unknown>>();

function remember<V>(cache: Map<string, V>, cap: number, key: string, fetch: () => Promise<V>, keep: (v: V) => boolean = () => true): Promise<V> {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  // Two opens of the same pane at once (a chip flight's prepare + its pane) share one call.
  const running = inflight.get(key) as Promise<V> | undefined;
  if (running) return running;
  const p = fetch()
    .then((v) => {
      if (!keep(v)) return v;
      cache.set(key, v);
      if (cache.size > cap) cache.delete(cache.keys().next().value as string);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Callers get their own arrays: a shuffle or a splice on a result must not change the cache.
const copyResults = (r: SearchResults): SearchResults => ({
  ...r,
  songs: [...r.songs],
  albums: [...r.albums],
  artists: [...r.artists],
  playlists: [...r.playlists],
  stations: [...r.stations],
});

/** Catalog search. `types` narrows the categories queried (default: all four). */
export function searchCatalog(term: string, types?: SearchType[]): Promise<SearchResults> {
  const key = `${term}|${(types ?? ALL_TYPES).join(",")}`;
  return remember(searchCache, SEARCH_CAP, key, () => invoke<SearchResults>("catalog_search", { term, types: types ?? null })).then(copyResults);
}

/** A catalog album's or playlist's tracks, authored order, music videos skipped. A list with
 *  an unreleased song is not kept, so each open asks Apple again and the song lights up on
 *  release day without a restart (SEARCH.md §Unreleased songs). */
export function collectionTracks(kind: "albums" | "playlists", id: string): Promise<Track[]> {
  return remember(
    paneCache,
    PANE_CAP,
    `${kind}:${id}`,
    () => invoke<Track[]>("catalog_collection_tracks", { kind, id }),
    (v) => !(v as Track[]).some((t) => t.unreleased),
  ).then((ts) => [...(ts as Track[])]);
}

/** A catalog artist's detail: albums + top songs. */
export function artistDetail(id: string): Promise<ArtistDetail> {
  return remember(paneCache, PANE_CAP, `artists:${id}`, () => invoke<ArtistDetail>("catalog_artist", { id })).then((v) => {
    const d = v as ArtistDetail;
    return { ...d, albums: [...d.albums], topSongs: [...d.topSongs], featuredPlaylists: [...d.featuredPlaylists] };
  });
}

/** Durable side of materialize-on-interaction (FAVORITES.md): upsert a catalog
 *  track into the unified store so its play stats always resolve to metadata. */
export function materializeTrack(track: Track): void {
  invoke("materialize_track", { track }).catch((e) =>
    console.warn("[search] materialize_track failed:", e),
  );
}

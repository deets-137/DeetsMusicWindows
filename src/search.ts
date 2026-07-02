// Catalog search data access (SEARCH.md). Thin wrappers over the Rust provider —
// the frontend only ever sees the normalized model. The Rust side also piggybacks
// every result into the enrichment caches (ISRC / preview / palette ride along free).

import { invoke } from "@tauri-apps/api/core";
import type { Artwork, Track } from "./library";

export interface Album {
  libraryId?: string;
  catalogId?: string;
  title: string;
  artistName: string;
  artwork?: Artwork;
  genres: string[];
  releaseDate?: string;
  trackCount?: number;
}

export interface Artist {
  libraryId?: string;
  catalogId?: string;
  name: string;
  artwork?: Artwork;
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
}

export interface SearchResults {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
  topSongs: Track[];
}

export type SearchType = "songs" | "albums" | "artists" | "playlists";
export const ALL_TYPES: SearchType[] = ["songs", "albums", "artists", "playlists"];

/** Catalog search. `types` narrows the categories queried (default: all four). */
export function searchCatalog(term: string, types?: SearchType[]): Promise<SearchResults> {
  return invoke<SearchResults>("catalog_search", { term, types: types ?? null });
}

/** A catalog album's or playlist's tracks, authored order, music videos skipped. */
export function collectionTracks(kind: "albums" | "playlists", id: string): Promise<Track[]> {
  return invoke<Track[]>("catalog_collection_tracks", { kind, id });
}

/** A catalog artist's detail: albums + top songs. */
export function artistDetail(id: string): Promise<ArtistDetail> {
  return invoke<ArtistDetail>("catalog_artist", { id });
}

/** Durable side of materialize-on-interaction (FAVORITES.md): upsert a catalog
 *  track into the unified store so its play stats always resolve to metadata. */
export function materializeTrack(track: Track): void {
  invoke("materialize_track", { track }).catch((e) =>
    console.warn("[search] materialize_track failed:", e),
  );
}

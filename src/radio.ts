// Radio data access (STATIONS.md §2–3). Thin invoke wrappers over the Rust radio
// commands, plus two local stores:
//
//  - a MODULE-LEVEL session cache — live lineup / Discovery / genres are
//    storefront-static (or per-user-stable), so a card remount costs zero Apple
//    calls; the card's ⟳ calls radioDropCaches() for an explicit refetch.
//  - the RECENTS store (localStorage) — the stations the user actually started,
//    newest first. recordStationPlay() is called by the radio-mode player wiring
//    (the follow-up batch); until then the shelf simply stays hidden.

import { invoke } from "@tauri-apps/api/core";
import type { Artwork } from "./library";

export interface Station {
  /** Catalog station id (`ra.…`; the personalized Discovery one is `ra.q-…`). */
  id: string;
  name: string;
  artwork?: Artwork;
  isLive: boolean;
  /** editorialNotes.short — the row tagline. */
  tagline?: string;
  contentRating?: string;
  /** Share link — the station probe's fallback queue descriptor (player.ts). */
  url?: string;
}

export interface StationGenre {
  id: string;
  name: string;
}

// ── session cache ──────────────────────────────────────────────────────────────
let liveCache: Station[] | null = null;
/** `undefined` = not fetched yet; `null` = fetched, none found (row hides). */
let myStationCache: Station | null | undefined;
let discoveryCache: Station | null | undefined;
let genresCache: StationGenre[] | null = null;
const genreStationsCache = new Map<string, Station[]>();

export function radioLive(): Promise<Station[]> {
  if (liveCache) return Promise.resolve(liveCache);
  return invoke<Station[]>("radio_live").then((s) => (liveCache = s));
}

/** My Station — the documented personalized station (`filter[identity]=personal`). */
export function radioMyStation(): Promise<Station | null> {
  if (myStationCache !== undefined) return Promise.resolve(myStationCache);
  return invoke<Station | null>("radio_my_station").then((s) => (myStationCache = s));
}

export function radioDiscovery(): Promise<Station | null> {
  if (discoveryCache !== undefined) return Promise.resolve(discoveryCache);
  return invoke<Station | null>("radio_discovery").then((s) => (discoveryCache = s));
}

export function radioGenres(): Promise<StationGenre[]> {
  if (genresCache) return Promise.resolve(genresCache);
  return invoke<StationGenre[]>("radio_genres").then((g) => (genresCache = g));
}

export function radioGenreStations(genre: StationGenre): Promise<Station[]> {
  const hit = genreStationsCache.get(genre.id);
  if (hit) return Promise.resolve(hit);
  return invoke<Station[]>("radio_genre_stations", { id: genre.id }).then((s) => {
    genreStationsCache.set(genre.id, s);
    return s;
  });
}

/** Synchronous cache peek for the drilled genre pane's live `list()` accessor. */
export function radioGenreStationsPeek(genreId: string): Station[] | undefined {
  return genreStationsCache.get(genreId);
}

/** The ⟳ action: forget everything so the next fetches hit Apple again. */
export function radioDropCaches(): void {
  liveCache = null;
  myStationCache = undefined;
  discoveryCache = undefined;
  genresCache = null;
  genreStationsCache.clear();
}

// ── recents (local) ────────────────────────────────────────────────────────────
const RECENTS_KEY = "deets.radio.recents";
const RECENTS_MAX = 6;

export function radioRecents(): Station[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? (JSON.parse(raw) as Station[]) : [];
    return Array.isArray(list) ? list.filter((s) => s && s.id && s.name) : [];
  } catch {
    return []; // corrupt store reads as empty; next play rewrites it
  }
}

/** Record a station start (newest-first, deduped, capped). Called by the radio-mode
 *  player wiring when a station actually plays — never by mere browsing. */
export function recordStationPlay(s: Station): void {
  const rest = radioRecents().filter((x) => x.id !== s.id);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([s, ...rest].slice(0, RECENTS_MAX)));
  } catch {
    /* storage unavailable — recents are a nicety */
  }
}

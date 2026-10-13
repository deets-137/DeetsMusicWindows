// Last.fm listener counts, front-end side (docs/features/LISTENERS.md).
//
// How many people on Last.fm have heard a song: the "rarity" of a song for a user who
// cares. Rust (`lastfm_listeners` in lastfm.rs) asks Last.fm once per song and caches the
// answer for a month; this module is the read side the UI will call. It makes no call of
// its own and holds a memory map, so a pane opened twice asks Rust once.
//
// Read side built 2026-10-12. No UI yet: nothing imports this module until the row that
// shows the number is designed (LISTENERS.md §4).

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { setting } from "./settings-store";

export interface ListenCount {
  /** "have" — Last.fm knows the song. "none" — it does not. */
  state: "have" | "none";
  /** Distinct Last.fm users who scrobbled it at least once. */
  listeners: number;
  /** Every scrobble of it, all users. */
  playcount: number;
  /** The song's page on last.fm. */
  url?: string;
  /** When Last.fm answered, ms since the epoch. */
  fetchedAt: number;
}

/** The same key `play_stats` and the Plays column use: catalog first, then library. */
const keyOf = (t: Track) => t.catalogId ?? t.libraryId ?? "";

const held = new Map<string, Promise<ListenCount | null>>();

/**
 * The Last.fm counts for a song. `null` when this build has no Last.fm key, the song has
 * no artist or title, or Last.fm could not be reached (the next ask tries again). The
 * promise is shared, so two callers in flight make one round trip.
 */
export function listenersFor(t: Track): Promise<ListenCount | null> {
  const key = keyOf(t);
  if (!key) return Promise.resolve(null);
  let p = held.get(key);
  if (!p) {
    p = invoke<ListenCount | null>("lastfm_listeners", { trackId: key, artist: t.artistName ?? "", title: t.title })
      .catch(() => {
        held.delete(key); // a miss is not an answer: ask again next time
        return null;
      });
    held.set(key, p);
  }
  return p;
}

/** An artist's Last.fm facts (`artist.getInfo`, LISTENERS.md §6). */
export interface ArtistInfo {
  state: "have" | "none";
  listeners: number;
  playcount: number;
  /** Last.fm's top tags, most applied first. */
  tags: string[];
  onTour: boolean;
  url?: string;
  fetchedAt: number;
}

const heldArtists = new Map<string, Promise<ArtistInfo | null>>();

/**
 * The Last.fm facts for an artist, by name. `null` when the row *Show artist info on the
 * artist's page* (`showArtistInfo`) is off (no call is made), this build has no key, or
 * Last.fm could not be reached. Shared per name, like `listenersFor`. Its own row since
 * 2026-10-12 (his call), when the DevTools flag `deets.dev.artistBox` was removed.
 */
export function artistInfoFor(name: string): Promise<ArtistInfo | null> {
  const key = name.trim().toLowerCase();
  if (!key || !setting("showArtistInfo")) return Promise.resolve(null);
  let p = heldArtists.get(key);
  if (!p) {
    p = invoke<ArtistInfo | null>("lastfm_artist_info", { name: name.trim() }).catch(() => {
      heldArtists.delete(key);
      return null;
    });
    heldArtists.set(key, p);
  }
  return p;
}

/** The artist facts box on a narrow card: open or folded under its *Artist Info* line. The
 *  last choice is kept for the next artist and across restarts (his call, 2026-10-12);
 *  closed by default. A per-viewer convenience, so localStorage, not a setting. */
const ARTIST_OPEN_KEY = "deets.artistInfo.open";
export function artistInfoOpen(): boolean {
  try {
    return localStorage.getItem(ARTIST_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** The *Artist Info* line was clicked: open or fold the box, and remember it. Handled in each
 *  artist view's click listener (collection-card.ts, search-card.ts). */
export function toggleArtistInfo(btn: HTMLElement): void {
  const wrap = btn.closest<HTMLElement>(".artist-info-wrap");
  if (!wrap) return;
  const open = wrap.dataset.open !== "1";
  wrap.dataset.open = open ? "1" : "0";
  btn.setAttribute("aria-expanded", String(open));
  try {
    localStorage.setItem(ARTIST_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* not kept: the box still opens now */
  }
}

/** 1234 → "1.2K", 4 567 890 → "4.6M"; under a thousand as is. For the row, when it exists. */
export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

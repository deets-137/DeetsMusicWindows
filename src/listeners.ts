// Last.fm listener counts, front-end side (docs/features/LISTENERS.md).
//
// How many people on Last.fm have heard a song: the "rarity" of a song for a user who
// cares. Rust (`lastfm_listeners` in lastfm.rs) asks Last.fm once per song and caches the
// answer for a month; this module is the read side the UI will call. It makes no call of
// its own and holds a memory map, so a pane opened twice asks Rust once.
//
// The song badge on Now Playing reads it (§4), the artist facts box (§6) and the album facts
// box (§7) too, with their open / folded state on a narrow card.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { setting } from "./settings-store";
import { albumForms } from "./lastfm-names";

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

/** An album's Last.fm facts (`album.getInfo`, LISTENERS.md §7). */
export interface AlbumInfo {
  state: "have" | "none";
  listeners: number;
  playcount: number;
  /** Last.fm's top tags, as given (the year tags kept, his call). */
  tags: string[];
  /** The wiki summary as Last.fm sends it (HTML); the box shows `wikiSentences` of it. */
  wiki?: string;
  url?: string;
  fetchedAt: number;
}

/**
 * One shared ask per key, and the answer kept once it lands. `now(key)` reads the kept answer
 * at once, so a view that draws again (or opens the same artist or album again) draws its box
 * in the FIRST paint: the hero does not draw centered and then jump (his ask, 2026-10-13: no
 * jitter). Only the very first open of a name waits for the answer.
 */
function asker<T>() {
  const held = new Map<string, Promise<T | null>>();
  const known = new Map<string, T | null>();
  return {
    ask(key: string, run: () => Promise<T | null>): Promise<T | null> {
      let p = held.get(key);
      if (!p) {
        p = run().then(
          (v) => {
            known.set(key, v);
            return v;
          },
          () => {
            held.delete(key); // a miss is not an answer: ask again next time
            return null;
          },
        );
        held.set(key, p);
      }
      return p;
    },
    now: (key: string): T | null | undefined => known.get(key),
    /** A fresh answer (presentation mode's re-read) replaces the kept one. */
    keep(key: string, v: T): void {
      known.set(key, v);
      held.set(key, Promise.resolve(v));
    },
  };
}

const artists = asker<ArtistInfo>();
const albums = asker<AlbumInfo>();
const artistKey = (name: string) => name.trim().toLowerCase();
const albumKey = (artist: string, album: string) => `${artist.trim().toLowerCase()}\u001f${album.trim().toLowerCase()}`;

/**
 * The Last.fm facts for an artist, by name. `null` when the row *Show artist info on the
 * artist's page* (`showArtistInfo`) is off (no call is made), this build has no key, or
 * Last.fm could not be reached. Shared per name, like `listenersFor`. Its own row since
 * 2026-10-12 (his call), when the DevTools flag `deets.dev.artistBox` was removed.
 */
export function artistInfoFor(name: string): Promise<ArtistInfo | null> {
  const key = artistKey(name);
  if (!key || !setting("showArtistInfo")) return Promise.resolve(null);
  return artists.ask(key, () => invoke<ArtistInfo | null>("lastfm_artist_info", { name: name.trim() }));
}

/** The artist's facts if they have landed already this session, for the first paint.
 *  `undefined` while the answer is still on its way (the box holds its place under reduced
 *  motion, info-box.ts); `null` for no answer and with the row off. */
export function artistInfoNow(name: string): ArtistInfo | null | undefined {
  return setting("showArtistInfo") ? artists.now(artistKey(name)) : null;
}

/**
 * The Last.fm facts for an album, by Apple's artist and album names. Last.fm is asked under
 * `albumForms` (Spotify's form first, then Apple's; LISTENERS.md §7.1). `null` when the row
 * *Show album info on the album's page* (`showAlbumInfo`) is off (no call), no key, or no
 * answer.
 */
export function albumInfoFor(artist: string, album: string): Promise<AlbumInfo | null> {
  const forms = albumForms(artist, album);
  if (!forms.length || !setting("showAlbumInfo")) return Promise.resolve(null);
  return albums.ask(albumKey(artist, album), () =>
    invoke<AlbumInfo | null>("lastfm_album_info", { artist: artist.trim(), album: album.trim(), forms }),
  );
}

/** The album's facts if they have landed already this session, for the first paint;
 *  `undefined` and `null` as `artistInfoNow` has them. */
export function albumInfoNow(artist: string, album: string): AlbumInfo | null | undefined {
  return setting("showAlbumInfo") ? albums.now(albumKey(artist, album)) : null;
}

/**
 * A fresh read for presentation mode (PresentationMode.md): Last.fm is asked when the stored
 * answer is older than `maxAgeMs` (Rust floors it at a minute), and the new answer replaces the
 * kept one, so the box shows it too. `null` with the row off, no key, or no answer.
 */
export async function artistInfoFresh(name: string, maxAgeMs: number): Promise<ArtistInfo | null> {
  const key = artistKey(name);
  if (!key || !setting("showArtistInfo")) return null;
  const v = await invoke<ArtistInfo | null>("lastfm_artist_info", { name: name.trim(), maxAgeMs }).catch(() => null);
  if (v) artists.keep(key, v);
  return v;
}

/** The album's fresh read, as `artistInfoFresh`. */
export async function albumInfoFresh(artist: string, album: string, maxAgeMs: number): Promise<AlbumInfo | null> {
  const forms = albumForms(artist, album);
  if (!forms.length || !setting("showAlbumInfo")) return null;
  const v = await invoke<AlbumInfo | null>("lastfm_album_info", { artist: artist.trim(), album: album.trim(), forms, maxAgeMs }).catch(() => null);
  if (v) albums.keep(albumKey(artist, album), v);
  return v;
}

/** A facts box on a narrow card: open or folded under its *Artist Info* / *Album Info* line.
 *  The last choice is kept for the next artist or album and across restarts (his call,
 *  2026-10-12; one choice for both boxes); closed by default. A per-viewer convenience, so
 *  localStorage, not a setting. */
const INFO_OPEN_KEY = "deets.artistInfo.open";
export function infoBoxOpen(): boolean {
  try {
    return localStorage.getItem(INFO_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** The *Artist Info* / *Album Info* line was clicked: open or fold the box, and remember it.
 *  Handled in each view's click listener (collection-card.ts, search-card.ts). */
export function toggleInfoBox(btn: HTMLElement): void {
  const wrap = btn.closest<HTMLElement>(".artist-info-wrap");
  if (!wrap) return;
  const open = wrap.dataset.open !== "1";
  wrap.dataset.open = open ? "1" : "0";
  btn.setAttribute("aria-expanded", String(open));
  try {
    localStorage.setItem(INFO_OPEN_KEY, open ? "1" : "0");
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

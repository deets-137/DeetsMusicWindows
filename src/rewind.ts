// Rewind data layer (DEETS-REWIND Phase B) — the read side of the play-event log.
//
// One Rust command (`play_events_since`) ships the windowed rows; everything else
// happens here: join to track metadata via the shared store, group by the chosen
// stat, rank by real minutes listened. Song/artist/album group off joined METADATA
// (every listen counts, wherever it was played from); playlist has no metadata
// equivalent, so it groups off the event's `context` tag — it measures "minutes
// listened FROM this playlist", which is the honest semantic.
//
// Scale note: even a heavy listening year is a few tens of thousands of small rows —
// one O(n) Map pass, sub-ms in V8. If the log ever outgrows memory (~500k+ rows),
// swap this module's internals for SQL rollups behind the same `topBy` signature.

import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";
import { trackById } from "./track-store";
import { playlistsCached } from "./playlists";
import type { Playlist } from "./search";

/** Mirrors Rust's `PlayEvent` (library.rs). `msListened: null` = never finalized. */
export interface PlayEvent {
  trackId: string;
  startedTs: number;
  msListened: number | null;
  completed: boolean;
  context: string | null;
}

export type RewindStat = "songs" | "artists" | "albums" | "playlists";
export type RewindWindow = "day" | "week" | "month" | "ytd" | "year";

export const STAT_LABELS: Record<RewindStat, string> = {
  songs: "Songs",
  artists: "Artists",
  albums: "Albums",
  playlists: "Playlists",
};
export const WINDOW_LABELS: Record<RewindWindow, string> = {
  day: "Past Day",
  week: "Past Week",
  month: "Past Month",
  ytd: "This Year",
  year: "Past Year",
};

/** One ranked leaderboard entry. `track` is the group's most-listened resolvable
 *  track — it supplies the artwork (the Library card's borrowed-album-art trick). */
export interface RewindRow {
  /** Group identity: track id / artist name / album key / playlist pid (per stat). */
  key: string;
  /** Group identity line: song title / artist name / album name / playlist name. */
  title: string;
  /** Secondary line: artist for songs+albums; absent for artists/playlists. */
  subtitle?: string;
  ms: number;
  plays: number;
  track?: Track;
  /** Every distinct resolvable track played in the group — the right-click menus'
   *  playable list (songs: the one track; albums: the played-subset fallback). */
  tracks: Track[];
}

const DAY_MS = 86_400_000;

/** Window start in epoch-ms. Rolling for all but YTD (local Jan 1), per design. */
export function windowStart(w: RewindWindow, now = Date.now()): number {
  switch (w) {
    case "day": return now - DAY_MS;
    case "week": return now - 7 * DAY_MS;
    case "month": return now - 30 * DAY_MS;
    case "year": return now - 365 * DAY_MS;
    case "ytd": return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  }
}

const playEventsSince = (sinceTs: number): Promise<PlayEvent[]> =>
  invoke<PlayEvent[]>("play_events_since", { sinceTs });

// Same id rule as the playlists card's `pid` — its context tags are `playlist:<pid>`.
export const pid = (p: Playlist): string => p.libraryId ?? p.catalogId ?? p.name;

// Same album identity rule as the Library card's `groupAlbums`: album name + cover-art
// URL (all of an album's tracks share one cover), falling back to name + artist for
// artless tracks — so featured-guest tracks don't fragment the album.
export const albumKey = (t: Track): string => {
  const name = t.albumName ?? "Unknown Album";
  const art = t.artwork?.urlTemplate;
  return art ? `${name} ${art}` : `${name} ${t.artistName ?? ""}`;
};

interface Group {
  title: string;
  subtitle?: string;
  ms: number;
  plays: number;
  /** Per-track ms within the group — argmax picks the representative artwork. */
  perTrack: Map<string, number>;
}

/** The card's one entry point: ranked rows for a stat × window, minutes-desc. */
export async function topBy(stat: RewindStat, window: RewindWindow): Promise<RewindRow[]> {
  const events = await playEventsSince(windowStart(window));
  // Playlist names resolve from the cached list (local + Apple mirrors). A tag whose
  // playlist was since deleted renders as "Unknown Playlist" rather than vanishing.
  const playlistNames = new Map<string, string>();
  if (stat === "playlists") {
    for (const p of await playlistsCached()) playlistNames.set(pid(p), p.name);
  }

  const groups = new Map<string, Group>();
  for (const e of events) {
    const t = trackById(e.trackId);
    let key: string;
    let title: string;
    let subtitle: string | undefined;
    switch (stat) {
      case "songs":
        key = e.trackId;
        title = t?.title ?? "Unknown";
        subtitle = t?.artistName ?? "";
        break;
      case "artists":
        title = t?.artistName ?? "Unknown";
        key = title;
        break;
      case "albums":
        key = t ? albumKey(t) : "Unknown Album";
        title = t?.albumName ?? "Unknown Album";
        subtitle = t?.artistName ?? "";
        break;
      case "playlists": {
        if (!e.context?.startsWith("playlist:")) continue;
        key = e.context.slice("playlist:".length);
        title = playlistNames.get(key) ?? "Unknown Playlist";
        break;
      }
    }
    let g = groups.get(key);
    if (!g) {
      g = { title, subtitle, ms: 0, plays: 0, perTrack: new Map() };
      groups.set(key, g);
    }
    const ms = e.msListened ?? 0; // unfinalized rows count the play, contribute 0 min
    g.ms += ms;
    g.plays += 1;
    g.perTrack.set(e.trackId, (g.perTrack.get(e.trackId) ?? 0) + ms);
  }

  const rows: RewindRow[] = [];
  for (const [key, g] of groups) {
    // Representative track = the group's most-listened RESOLVABLE track (its album
    // art stands in for artist/playlist images — zero Apple calls). `resolved`
    // collects every distinct resolvable track for the row's playable list, deduped
    // by object identity (a song seen under both its ids resolves to one Track).
    let rep: Track | undefined;
    let best = -1;
    const resolved = new Set<Track>();
    for (const [id, ms] of g.perTrack) {
      const t = trackById(id);
      if (!t) continue;
      resolved.add(t);
      if (ms > best) { best = ms; rep = t; }
    }
    rows.push({
      key, title: g.title, subtitle: g.subtitle, ms: g.ms, plays: g.plays,
      track: rep, tracks: [...resolved],
    });
  }
  rows.sort((a, b) => b.ms - a.ms || b.plays - a.plays || a.title.localeCompare(b.title));
  return rows;
}

/** "47 min" under an hour, "3 hr 12 min" past it, "<1 min" below the line (covers
 *  0 too — unfinalized rows contribute no minutes, and we don't invent any). */
export function fmtListen(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr} hr ${rem} min` : `${hr} hr`;
}

export const fmtPlays = (n: number): string => `${n} ${n === 1 ? "play" : "plays"}`;

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
import { primaryOf } from "./primary-artist";
import { playlistsCached } from "./playlists";
import type { Playlist } from "./search";
import { allPicks, dayLabel } from "./sotd";
import { windowStart, dayInWindow, todayStart, type RewindWindow } from "./rewind-window";

/** Mirrors Rust's `PlayEvent` (library.rs). `msListened: null` = never finalized. */
export interface PlayEvent {
  trackId: string;
  startedTs: number;
  msListened: number | null;
  completed: boolean;
  context: string | null;
}

export type RewindStat = "songs" | "artists" | "albums" | "playlists" | "picks";
export type { RewindWindow };
export { windowStart };

export const STAT_LABELS: Record<RewindStat, string> = {
  songs: "Songs",
  artists: "Artists",
  albums: "Albums",
  playlists: "Playlists",
  // Song of the Day (DeetsOTD.md §8.7). Not a leaderboard: a timeline, newest first. The
  // card leaves it out of the picker while the feature is off.
  picks: "Picks",
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
  /** Picks only: the row's own meta line ("Tue, Sep 16 · a note"), and the pick it is. The
   *  Picks view measures nothing, so `ms` and `plays` stay 0 there. */
  meta?: string;
  pickId?: number;
  /** Playlists only: the playlist no longer exists (its plays stay; nothing to play or drag). */
  gone?: boolean;
}

/** The one row for plays of deleted playlists whose names were never kept (before v22). */
export const DELETED_KEY = "deleted:";

/** The windowed log, oldest first. Shared with the Home card (home.ts). */
export const playEventsSince = (sinceTs: number): Promise<PlayEvent[]> =>
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
  // Picks are not measured, so they never touch the play log: they are the picks in the
  // window, newest first (R1, owner 2026-09-17).
  if (stat === "picks") return picksIn(window);
  return topSince(stat, windowStart(window));
}

/** Ranked rows over every play since `sinceTs` (0: the whole log) and before `untilTs` (the
 *  Rewind panel's Yesterday), minutes-desc. The panel's Top Listens orders them again by its
 *  middle box (rewind-btn.ts, `rankTop`). */
export async function topSince(
  stat: Exclude<RewindStat, "picks">,
  sinceTs: number,
  untilTs = Number.POSITIVE_INFINITY,
): Promise<RewindRow[]> {
  const events = (await playEventsSince(sinceTs)).filter((e) => e.startedTs < untilTs);
  // Playlist names resolve from the cached list (local + Apple mirrors). A playlist deleted
  // since keeps the name its plays remembered (schema v22: "Name (deleted)", his call
  // 2026-10-18); plays older than that memory share one "Deleted playlists" row. Nothing
  // reads "Unknown Playlist" any more (DEETS-REWIND.md §8, F1).
  const playlistNames = new Map<string, string>();
  let keptNames: Record<string, string> = {};
  if (stat === "playlists") {
    const [live, kept] = await Promise.all([
      playlistsCached(),
      invoke<Record<string, string>>("playlist_names").catch(() => ({})),
    ]);
    for (const p of live) playlistNames.set(pid(p), p.name);
    keptNames = kept;
  }
  const gone = new Set<string>();

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
      case "artists": {
        // A collaboration counts for its primary artist only (his call P1, ideas/apple-calls.md
        // §5.4), by catalog id, so "Girl Ultra, Buscabulla & Chromeo" and "Girl Ultra & Chromeo"
        // are one row, Girl Ultra's. A song with no primary keeps its credit string.
        const p = primaryOf(t);
        title = p?.name ?? t?.artistName ?? "Unknown";
        key = p ? `id:${p.id}` : title;
        break;
      }
      case "albums":
        key = t ? albumKey(t) : "Unknown Album";
        title = t?.albumName ?? "Unknown Album";
        subtitle = t?.albumArtist || t?.artistName || "";
        break;
      case "playlists": {
        if (!e.context?.startsWith("playlist:")) continue;
        key = e.context.slice("playlist:".length);
        const live = playlistNames.get(key);
        if (live !== undefined) title = live;
        else {
          const kept = keptNames[key];
          if (kept === undefined) key = DELETED_KEY;
          title = kept === undefined ? "Deleted playlists" : `${kept} (deleted)`;
          gone.add(key);
        }
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
      track: rep, tracks: [...resolved], gone: gone.has(key) || undefined,
    });
  }
  rows.sort((a, b) => b.ms - a.ms || b.plays - a.plays || a.title.localeCompare(b.title));
  return rows;
}

/** The Picks view's rows: every pick whose day falls in the window, newest first. Local. */
function picksIn(window: RewindWindow): RewindRow[] {
  return allPicks()
    .filter((p) => dayInWindow(p.day, window))
    .map((p) => ({
      key: `pick:${p.id}`,
      title: p.meta.title,
      subtitle: p.meta.artistName,
      ms: 0,
      plays: 0,
      track: p.meta,
      tracks: [p.meta],
      meta: `${dayLabel(p.day)}${p.note ? ` · ${p.note}` : ""}`,
      pickId: p.id,
    }));
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

/** Minutes listened today (since local midnight), in ms. An open play's minutes are in the log
 *  from its last 30 s save (stats.ts `checkpoint`). The Rewind panel's first row. */
export async function listenedToday(): Promise<number> {
  const events = await playEventsSince(todayStart());
  return events.reduce((sum, e) => sum + (e.msListened ?? 0), 0);
}

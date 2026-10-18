// Weekly Replay (NEXT-VERSION §4) — a generator over the Rewind ranking, nothing more.
//
// Two entry points: `makeReplayPlaylist` (the Rewind card's button — any window, a
// dated playlist filed under Replay) and `runWeeklyReplay` (the automatic run at boot:
// once per week on/after the chosen day, top 25 songs of the past 7 days by minutes
// listened, repeats allowed). Rolling by default (one "Replay" playlist, replaced);
// `replayKeep` makes each week its own dated playlist instead. All local SQLite —
// zero Apple calls.

import { setting } from "./settings-store";
import { topBy, WINDOW_LABELS, type RewindRow, type RewindWindow } from "./rewind";
import {
  playlistsCached, playlistCreate, playlistDelete, playlistAddTracks, playlistTracks, playlistRemovePositions, localId,
  foldersList, folderCreate, folderAssign,
} from "./playlists";
import type { Track } from "./library";
import type { Playlist } from "./search";
import * as diag from "./diag";
import { cancelled, registerEvent } from "./rules";
import { toast } from "./toast";

export const REPLAY_SIZE = 25;

/** Make playlist found nothing to put in it (an empty window or pick): the user's to see, not a
 *  failure of the app. The Rewind button tells the two apart. */
export class NothingToAdd extends Error {}
const REPLAY_MIN = 5; // a quieter week than this skips (the button never skips)
const FOLDER = "Replay";
const ROLLING_NAME = "Replay";
const LAST_RUN_KEY = "deets.replay.lastRun";

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The rows' playable tracks, deduped, top N. Songs rows carry one track each. */
const tracksOf = (rows: RewindRow[], n: number): Track[] => {
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const t = r.track ?? r.tracks[0];
    if (!t) continue;
    const key = t.catalogId ?? t.libraryId ?? `${t.title} ${t.artistName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length === n) break;
  }
  return out;
};

async function replayFolderId(): Promise<number> {
  const folders = await foldersList();
  const f = folders.find((x) => x.name === FOLDER);
  return f ? f.id : folderCreate(FOLDER);
}

async function fileUnderReplay(rowid: number): Promise<void> {
  const [fid, all] = await Promise.all([replayFolderId(), playlistsCached()]);
  const p = all.find((x) => x.libraryId === `local:${rowid}`);
  if (p) await folderAssign(p, fid);
}

/** Create a dated local playlist from `tracks`, filed under Replay. Returns its rowid. All or
 *  nothing: when adding the songs or filing it fails, the half-made playlist is deleted and the
 *  error goes on to the caller (DEETS-REWIND.md §8, F7). */
async function createReplay(name: string, tracks: Track[]): Promise<number> {
  const id = await playlistCreate(name, "replay");
  try {
    await playlistAddTracks(id, tracks);
    await fileUnderReplay(id);
  } catch (e) {
    await playlistDelete({ libraryId: `local:${id}`, name } as Playlist).catch((e2) =>
      diag.log("replay", `could not undo the half-made "${name}": ${String(e2)}`),
    );
    throw e;
  }
  return id;
}

/**
 * The Rewind card's button: the current Songs ranking → a dated playlist
 * ("Replay — Past Week, 8 Sep 2026"). Never skips a thin list. Returns the rowid.
 */
export async function makeReplayPlaylist(window: RewindWindow): Promise<number> {
  const rows = await topBy("songs", window);
  const tracks = tracksOf(rows, REPLAY_SIZE);
  if (!tracks.length) throw new NothingToAdd("nothing played in this window");
  const name = `Replay — ${WINDOW_LABELS[window]}, ${fmtDate(Date.now())}`;
  const id = await createReplay(name, tracks);
  diag.log("replay", `made "${name}" (${tracks.length} songs)`);
  return id;
}

/**
 * Rewind › Picks' own Make playlist (DeetsOTD.md §8.7): the window's Songs of the Day,
 * OLDEST first — a pick list reads as a timeline, not a ranking — filed under Replay like
 * the others. Zero Apple calls: every song is the pick's own stored copy.
 */
export async function makePicksPlaylist(window: RewindWindow): Promise<number> {
  const rows = await topBy("picks", window);
  const tracks = tracksOf([...rows].reverse(), Number.MAX_SAFE_INTEGER);
  if (!tracks.length) throw new NothingToAdd("no picks in this window");
  const name = `Songs of the Day — ${WINDOW_LABELS[window]}, ${fmtDate(Date.now())}`;
  const id = await createReplay(name, tracks);
  diag.log("replay", `made "${name}" (${tracks.length} picks)`);
  return id;
}

/**
 * Make playlist with rows picked on the Rewind card (his call K1, 2026-10-18): the picked rows'
 * songs in the order shown, each song once, filed under Replay like the others. The window is
 * in the name so the list says where the picks came from.
 */
export async function makePickedPlaylist(window: RewindWindow, picked: Track[]): Promise<number> {
  const tracks = tracksOf(picked.map((t) => ({ key: "", title: "", ms: 0, plays: 0, track: t, tracks: [t] })), Number.MAX_SAFE_INTEGER);
  if (!tracks.length) throw new NothingToAdd("the picked rows hold no songs");
  const name = `Replay — ${WINDOW_LABELS[window]}, picked, ${fmtDate(Date.now())}`;
  const id = await createReplay(name, tracks);
  diag.log("replay", `made "${name}" (${tracks.length} picked songs)`);
  return id;
}

/** Most recent occurrence of the chosen weekday at local midnight (today counts). */
function lastDue(day: string, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const want = DAY_INDEX[day] ?? 1;
  const back = (d.getDay() - want + 7) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/**
 * The automatic weekly run. Call once at boot after the track store loads. Runs when
 * the setting is on and the last run predates this week's due day; the past 7 days'
 * top 25 by minutes listened become the rolling "Replay" playlist (replaced), or a
 * dated one when `replayKeep` is on. Fewer than 5 songs: skip, log, try next launch.
 */
export async function runWeeklyReplay(force = false): Promise<void> {
  const due = lastDue(setting("replayDay"));
  if (!force) {
    if (!setting("replayAuto")) return;
    const last = Number(localStorage.getItem(LAST_RUN_KEY) ?? 0);
    if (last >= due) return;
    // A cancel event (RULEZ.md §4, route 7): a rule with Keep skips this week's Replay.
    registerEvent("replay.weekly");
    if (cancelled("replay.weekly", { card: "*" })) {
      try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* session-only */ }
      diag.log("replay", "weekly kept back by a rule");
      return;
    }
  }

  const rows = await topBy("songs", "week");
  const tracks = tracksOf(rows, REPLAY_SIZE);
  if (tracks.length < REPLAY_MIN) {
    diag.log("replay", `weekly skipped: only ${tracks.length} song(s) this week`);
    return;
  }

  if (setting("replayKeep")) {
    await createReplay(`Replay — ${fmtDate(due)}`, tracks);
  } else {
    // Rolling: the one "Replay" (local, marked replay) gets this week's songs in place of
    // last week's. The playlist stays the same one (its ID, pin, folder, place), so its plays
    // keep counting under one name in Rewind. Deleting and remaking it gave it a new ID each
    // week and left last week's plays nameless (DEETS-REWIND.md §8, F1). The role check keeps a
    // playlist the user named "Replay" by hand safe.
    const all = await playlistsCached();
    const old: Playlist | undefined = all.find((p) => p.source === "local" && p.role === "replay" && p.name === ROLLING_NAME);
    const id = old ? localId(old) : null;
    if (old && id != null) {
      const n = (await playlistTracks(old)).length;
      if (n) await playlistRemovePositions(old, [...Array(n).keys()]);
      await playlistAddTracks(id, tracks);
    } else await createReplay(ROLLING_NAME, tracks);
  }
  try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* session-only */ }
  diag.log("replay", `weekly made (${tracks.length} songs, keep=${setting("replayKeep")})`);
  toast({ kind: "success", text: `Replay updated: ${tracks.length} songs from this week.` });
}

// Dev-only: run the weekly make now, past the setting and the due-day gate (DEBUGGING.md
// §Toasts). It is the real run — it rewrites the Replay playlist in the dev data dir.
declare global {
  interface DeetsToastSim {
    replay?: () => Promise<unknown>;
  }
}
if (import.meta.env.DEV) {
  window.__toast.sim = {
    ...window.__toast.sim,
    replay: () => runWeeklyReplay(true),
  };
}

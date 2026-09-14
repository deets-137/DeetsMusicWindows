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
  playlistsCached, playlistCreate, playlistDelete, playlistAddTracks,
  foldersList, folderCreate, folderAssign,
} from "./playlists";
import type { Track } from "./library";
import type { Playlist } from "./search";
import * as diag from "./diag";
import { toast } from "./toast";

export const REPLAY_SIZE = 25;
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

/** Create a dated local playlist from `tracks`, filed under Replay. Returns its rowid. */
async function createReplay(name: string, tracks: Track[]): Promise<number> {
  const id = await playlistCreate(name, "replay");
  await playlistAddTracks(id, tracks);
  await fileUnderReplay(id);
  return id;
}

/**
 * The Rewind card's button: the current Songs ranking → a dated playlist
 * ("Replay — Past Week, 8 Sep 2026"). Never skips a thin list. Returns the rowid.
 */
export async function makeReplayPlaylist(window: RewindWindow): Promise<number> {
  const rows = await topBy("songs", window);
  const tracks = tracksOf(rows, REPLAY_SIZE);
  if (!tracks.length) throw new Error("nothing played in this window");
  const name = `Replay — ${WINDOW_LABELS[window]}, ${fmtDate(Date.now())}`;
  const id = await createReplay(name, tracks);
  diag.log("replay", `made "${name}" (${tracks.length} songs)`);
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
    // Rolling: drop the previous "Replay" (local, marked replay) and remake it, so the rowid
    // changes but the name and the folder stay put. The role check keeps a playlist the user
    // named "Replay" by hand safe.
    const all = await playlistsCached();
    const old: Playlist | undefined = all.find((p) => p.source === "local" && p.role === "replay" && p.name === ROLLING_NAME);
    if (old) await playlistDelete(old);
    await createReplay(ROLLING_NAME, tracks);
  }
  try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* session-only */ }
  diag.log("replay", `weekly made (${tracks.length} songs, keep=${setting("replayKeep")})`);
  toast({ kind: "success", text: `Replay updated: ${tracks.length} songs from this week.` });
}

// Dev-only: run the weekly make now, past the setting and the due-day gate (DEBUGGING.md
// §Toasts). It is the real run — it rewrites the Replay playlist in the dev data dir.
if (import.meta.env.DEV) {
  (window as any).__toast.sim = {
    ...(window as any).__toast.sim,
    replay: () => runWeeklyReplay(true),
  };
}

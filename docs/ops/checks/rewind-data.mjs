// The Rewind sweep's data probe (QUALITY-SWEEP.md §3, "Read the data"; DEETS-REWIND.md §8): the
// numbers behind its faults and guards, read from the app's database READ-ONLY. No app needed.
//
//   node docs/ops/checks/rewind-data.mjs            the live app's database, then the dev app's
//   node docs/ops/checks/rewind-data.mjs <db path>  one database
//
// Run it again after a fix: F1's "gone" count, F4's never-finalized count and F3's long rows
// should stop growing for new plays. Node 22+ (node:sqlite).
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DAY = 86_400_000;
const now = Date.now();

function probe(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const q = (label, sql) => {
    try {
      console.log(`  ${label}`, JSON.stringify(db.prepare(sql).all()));
    } catch (e) {
      console.log(`  ${label} ERR ${e.message}`);
    }
  };
  q("plays: all / past year / past week", `SELECT COUNT(*) n, SUM(started_ts >= ${now - 365 * DAY}) year, SUM(started_ts >= ${now - 7 * DAY}) week FROM play_events`);
  // F4: a play with no minutes (a close or a crash before the final write).
  q("F4 never finalized: all / past 30 days", `SELECT COUNT(*) n, SUM(started_ts >= ${now - 30 * DAY}) d30 FROM play_events WHERE ms_listened IS NULL`);
  // Guard: minutes counted against the song's length, for plays that finished.
  q("guard minutes vs length (completed, 90 days)", `
    SELECT COUNT(*) n,
      SUM(e.ms_listened < 0.5 * json_extract(t.json,'$.durationMs')) under_half,
      SUM(e.ms_listened > 1.5 * json_extract(t.json,'$.durationMs')) over_150pct,
      ROUND(AVG(1.0 * e.ms_listened / json_extract(t.json,'$.durationMs')), 3) avg_ratio
    FROM play_events e JOIN tracks t ON t.track_id = e.track_id
    WHERE e.completed = 1 AND e.ms_listened IS NOT NULL AND json_extract(t.json,'$.durationMs') > 0
      AND e.started_ts >= ${now - 90 * DAY}`);
  // Guard: one song under two keys (its library ID and its catalog ID both in the log).
  q("guard songs under both IDs", `
    SELECT COUNT(*) n FROM tracks t
    WHERE json_extract(t.json,'$.libraryId') IS NOT NULL AND json_extract(t.json,'$.catalogId') IS NOT NULL
      AND EXISTS (SELECT 1 FROM play_events e WHERE e.track_id = json_extract(t.json,'$.libraryId'))
      AND EXISTS (SELECT 1 FROM play_events e WHERE e.track_id = json_extract(t.json,'$.catalogId'))`);
  // F1: plays tagged with a local playlist that no longer exists ("Unknown Playlist").
  q("F1 local-playlist plays: live / gone / gone IDs", `
    SELECT SUM(lp.id IS NOT NULL) live, SUM(lp.id IS NULL) gone, COUNT(DISTINCT CASE WHEN lp.id IS NULL THEN e.context END) gone_ids
    FROM play_events e LEFT JOIN local_playlists lp ON e.context = 'playlist:local:' || lp.id
    WHERE e.context LIKE 'playlist:local:%'`);
  // F3: two listens on one row (the second start dropped) shows as a play over twice the song.
  q("F3 plays over twice the song", `
    SELECT COUNT(*) n FROM play_events e JOIN tracks t ON t.track_id = e.track_id
    WHERE e.ms_listened > 2 * json_extract(t.json,'$.durationMs') AND json_extract(t.json,'$.durationMs') > 0`);
  q("plays with no song row (Unknown)", `SELECT COUNT(DISTINCT e.track_id) ids, COUNT(*) n FROM play_events e LEFT JOIN tracks t ON t.track_id = e.track_id WHERE t.track_id IS NULL`);
}

const paths = process.argv[2]
  ? [process.argv[2]]
  : ["com.deetsmusic.app", "com.deetsmusic.dev"].map((d) => join(process.env.APPDATA ?? "", d, "deetsmusic.db"));
for (const p of paths) {
  console.log(p);
  if (existsSync(p)) probe(p);
  else console.log("  no database here");
}

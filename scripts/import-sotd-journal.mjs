// Import a Song of the Day journal into DeetsMusic, once (docs/integrations/DeetsOTD.md §8.13).
//
// A journal feed is a personal tool: only the owner has one, so no feed code ships in the
// app. This script is how eight months of picks come in, by hand, one time. It only READS
// the journal — both the DeetsOTD repo and the deets.solutions repo stay untouched.
//
// Source: `songs.json`, the public display export. It already has the journal day in `date`
// (America/Los_Angeles + a 5-hour grace) and it carries no private Discord ids.
//
//   node scripts/import-sotd-journal.mjs --dry-run
//   node scripts/import-sotd-journal.mjs --app dev
//   node scripts/import-sotd-journal.mjs --app installed
//
// Options:
//   --from <path>          a songs.json (default ../DeetsSolutions/sotd/songs.json)
//   --app installed|dev    which data dir to write (default dev)
//   --author <name>        whose posts to take (default Deets)
//   --dry-run              say what would happen, write nothing
//   --force                write even while DeetsMusic is open (restart it after)
//
// Rules:
//   - Idempotent. A row with the same day AND the same song is skipped, so a re-run after
//     new hand posts in Discord adds only the new ones.
//   - The per-day limit does not apply: the journal's two-pick days come in as they are.
//   - No `pick_posts` rows. An imported pick was already posted, by hand, months ago.
//   - The app must be closed. Not because the write would fail (WAL allows it) but because
//     the app's own picks mirror is only read at start.
//   - `picks` must exist: run the app once after build 1 before this.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const FROM = flag("from", join("..", "DeetsSolutions", "sotd", "songs.json"));
const APP = flag("app", "dev");
const AUTHOR = flag("author", "Deets");
const DRY = has("dry-run");

const IDENTIFIER = APP === "installed" ? "com.deetsmusic.app" : "com.deetsmusic.dev";
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!["installed", "dev"].includes(APP)) die(`--app takes installed or dev, not ${APP}`);
if (!existsSync(FROM)) die(`No journal at ${FROM}. Pass --from <path to songs.json>.`);

const dbPath = join(process.env.APPDATA ?? "", IDENTIFIER, "deetsmusic.db");
if (!existsSync(dbPath)) die(`No database at ${dbPath}. Run the ${APP} app once first, so it makes one.`);

// ── the journal ──────────────────────────────────────────────────────────────

/** The catalog id: `?i=<id>` on an album-track link, or `/song/<id>` on a bare song link. */
const catalogId = (url) => {
  if (!url) return null;
  return /[?&]i=(\d+)/.exec(url)?.[1] ?? /\/song\/(?:[^/]+\/)?(\d+)/.exec(url)?.[1] ?? null;
};

/** Apple's artwork URL ends in its size (`/600x600bb.jpg`); the app wants the template. */
const artworkOf = (url) => {
  if (!url) return undefined;
  const t = url.replace(/\/\d+x\d+([a-z-]*)\.(jpg|png|webp)$/i, "/{w}x{h}$1.{f}");
  if (t === url) return undefined; // not a shape we know: no artwork rather than a wrong one
  return { urlTemplate: t, width: 600, height: 600 };
};

/** The pick's `meta`: the song as the app's own Track, so a shelf tile draws with no fetch. */
const trackOf = (row, id) => ({
  catalogId: id,
  title: row.track_name ?? "Unknown",
  artistName: row.artist_name ?? "Unknown",
  albumName: row.album || undefined,
  durationMs: row.duration_sec ? Math.round(row.duration_sec * 1000) : undefined,
  genres: row.genre ? [row.genre] : [],
  hasLyrics: false,
  releaseDate: row.release_date || undefined,
  artwork: artworkOf(row.artwork_url),
});

const journal = JSON.parse(readFileSync(FROM, "utf8"));
const mine = (journal.songs ?? []).filter((s) => s.author === AUTHOR);
if (!mine.length) {
  const authors = [...new Set((journal.songs ?? []).map((s) => s.author))];
  die(`No posts by ${AUTHOR} in ${FROM}. It has: ${authors.join(", ")}`);
}

// ── the database ─────────────────────────────────────────────────────────────

let db;
try {
  db = new DatabaseSync(dbPath);
} catch (e) {
  die(`Could not open ${dbPath}: ${e.message}\nClose DeetsMusic first (the tray too).`);
}

const hasPicks = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='picks'").get();
if (!hasPicks) die("This database has no `picks` table yet. Run the app once after the Song of the Day build, then try again.");

// Is the app open? A `BEGIN IMMEDIATE` probe does NOT answer that: in WAL mode it succeeds
// whenever the app is simply not mid-write (measured 2026-09-18, with the app running). So
// look for the process instead. The rows land safely either way — what a running app misses
// is its own picks mirror, which is only read at start.
const running = () => {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq DeetsMusic.exe", "/NH"], { encoding: "utf8" });
    return /DeetsMusic/i.test(out);
  } catch {
    return false; // no tasklist: write anyway, which WAL makes safe
  }
};
if (!DRY && !has("force") && running()) {
  die("DeetsMusic is running. Close it (the tray icon too), or pass --force and restart it after.");
}

const seen = new Set(db.prepare("SELECT day, track_id FROM picks").all().map((r) => `${r.day}|${r.track_id}`));
const insert = db.prepare(
  "INSERT INTO picks(source, day, track_id, meta, note, marked_at) VALUES('import', ?, ?, ?, NULL, ?)",
);

let added = 0;
let skipped = 0;
const noLink = [];

if (!DRY) db.exec("BEGIN");
for (const row of mine) {
  const id = catalogId(row.apple_music_url);
  if (!id) {
    noLink.push(`${row.date}  ${row.track_name} — ${row.artist_name}`);
    continue;
  }
  const day = row.date;
  if (!day || seen.has(`${day}|${id}`)) {
    skipped += 1;
    continue;
  }
  seen.add(`${day}|${id}`);
  const markedAt = Date.parse(row.posted_at ?? "") || Date.parse(`${day}T12:00:00Z`);
  if (!DRY) insert.run(day, id, JSON.stringify(trackOf(row, id)), markedAt);
  added += 1;
}
if (!DRY) db.exec("COMMIT");
db.close();

console.log(`${DRY ? "Would add" : "Added"} ${added}, skipped ${skipped} already there, ${noLink.length} with no Apple link.`);
if (noLink.length) {
  console.log("No Apple link (not imported):");
  for (const line of noLink) console.log(`  ${line}`);
}
console.log(`${DRY ? "Nothing was written." : `Written to ${dbPath}.`}`);

//! Local library cache (SQLite) + sync orchestration.
//!
//! Rust owns the cache: it fetches pages via the provider, normalizes, and upserts
//! into SQLite. The frontend renders from the cache (instant) and triggers a sync
//! that refreshes it in the background (stale-while-revalidate), with progress
//! events on the `library-sync` channel.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use futures::StreamExt;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::apple::{self, AppleProvider, AppleState};
use crate::model::{Page, Track};
use crate::provider::MusicProvider;

/// Managed SQLite connection.
pub struct Db(pub Mutex<Connection>);

pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "-- The UNIFIED track store (FAVORITES.md): every track we've touched, not just
        -- synced library songs. Keyed by the CATALOG-FIRST canonical id
        -- (catalog_id ?? library_id) so a 'seen' catalog track that later joins the
        -- library keeps its row (and its feedback). source: 'library' = synced,
        -- 'seen' = materialized from an interaction (play / rating / feedback).
        CREATE TABLE IF NOT EXISTS tracks (
            track_id TEXT PRIMARY KEY,
            source   TEXT NOT NULL DEFAULT 'library',
            sort_key TEXT,
            json     TEXT NOT NULL
        );
        -- Cache bookkeeping that must die WITH the cache (a deleted db must full-sync):
        -- 'full_sync_at' = unix seconds of the last COMPLETE library pass.
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_sort ON tracks(sort_key);

        -- Per-track listening tallies, for a future data-vis. Keyed by the same
        -- catalog-first rule the tracks PK uses, so stats join to track metadata.
        -- partial = song started (became now-playing); full = playback crossed the
        -- listened-through threshold. last_played is epoch-ms of last start.
        CREATE TABLE IF NOT EXISTS play_stats (
            track_id      TEXT PRIMARY KEY,
            partial_count INTEGER NOT NULL DEFAULT 0,
            full_count    INTEGER NOT NULL DEFAULT 0,
            last_played   INTEGER
        );

        -- Append-only per-play event log (DEETS-REWIND §5a) — the timeline the
        -- cumulative counters can't answer: time-series, EXACT minutes listened,
        -- context attribution, skip depth. Two-step write: the row is appended at
        -- START (crash-safe — ms_listened NULL until finalized), then finalized at
        -- end-of-play with the real elapsed listen time. Same catalog-first key.
        CREATE TABLE IF NOT EXISTS play_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id    TEXT NOT NULL,
            started_ts  INTEGER NOT NULL,
            ms_listened INTEGER,
            completed   INTEGER NOT NULL DEFAULT 0,
            context     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_play_events_ts ON play_events(started_ts);",
    )
}

/// The canonical track key: catalog-first (FAVORITES.md). `catalog_id` is a stable
/// cross-source identity (99.8% of the library carries one); `library_id` is the
/// fallback for catalog-less items (uploads).
pub(crate) fn track_key(t: &Track) -> Option<String> {
    t.catalog_id
        .clone()
        .or_else(|| t.library_id.clone())
        .filter(|s| !s.is_empty())
}

// ── v2 migration: library-first → catalog-first keys + the unified store ─────

/// Does the DB predate v2 (tracks keyed by `library_id`, library-first)?
/// Opens its own short-lived connection so the caller can back the FILE up
/// before the main connection ever writes.
pub fn needs_v2_migration(db_path: &std::path::Path) -> bool {
    if !db_path.exists() {
        return false;
    }
    let Ok(conn) = Connection::open(db_path) else {
        return false;
    };
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name = 'library_id'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

/// One-time re-key of `tracks` + `play_stats` from library-first to catalog-first
/// (FAVORITES.md). Runs in a single transaction — any error rolls the whole thing
/// back. The caller backs up the DB file first. Idempotent: after a successful run
/// `needs_v2_migration` is false and this is never called again.
pub fn migrate_v2(conn: &mut Connection) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Schema: rename the PK column, add `source` (every pre-v2 row was synced).
    tx.execute_batch("ALTER TABLE tracks RENAME COLUMN library_id TO track_id;")
        .map_err(|e| format!("rename column: {e}"))?;
    tx.execute_batch(
        "ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'library';",
    )
    .map_err(|e| format!("add source column: {e}"))?;

    // 2. Re-key every row whose canonical id changes (library-first → catalog-first).
    let rows: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT track_id, json FROM tracks")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        mapped.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let mut rekeyed = 0usize;
    for (old_key, json) in rows {
        let t: Track = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        let Some(new_key) = track_key(&t) else { continue };
        if new_key == old_key {
            continue;
        }
        let collision: bool = tx
            .prepare("SELECT 1 FROM tracks WHERE track_id = ?1")
            .and_then(|mut s| s.exists([new_key.as_str()]))
            .map_err(|e| e.to_string())?;
        if collision {
            // Two library rows of the same catalog song — keep the survivor.
            tx.execute("DELETE FROM tracks WHERE track_id = ?1", [old_key.as_str()])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "UPDATE tracks SET track_id = ?1 WHERE track_id = ?2",
                [new_key.as_str(), old_key.as_str()],
            )
            .map_err(|e| e.to_string())?;
        }
        remap_stat(&tx, &old_key, &new_key)?;
        rekeyed += 1;
    }

    // 3. Version stamp (informational; detection is schema-based).
    tx.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', '2')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    crate::log::info(&format!("migration: v2 complete, {rekeyed} row(s) re-keyed to catalog-first"));
    Ok(())
}

// ── v3: favorites mirror + local playlist covers (NEXT-VERSION §2, §3) ─────────

/// Additive, idempotent, runs after every table init: a `favorites` table (the ♥
/// mirror, FAVORITES.md) and a `cover` column on `local_playlists` (a user-set cover,
/// stored as a data URL — local only, Apple's API cannot receive one). No backup:
/// nothing is rewritten, and `IF NOT EXISTS` / the column probe make a re-run a no-op.
pub fn migrate_v3(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS favorites (
            track_id  TEXT PRIMARY KEY,
            loved     INTEGER NOT NULL DEFAULT 1,
            synced_at INTEGER
        );",
    )
    .map_err(|e| format!("favorites table: {e}"))?;
    let has_cover: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('local_playlists') WHERE name = 'cover'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if has_cover == 0 {
        conn.execute_batch("ALTER TABLE local_playlists ADD COLUMN cover TEXT;")
            .map_err(|e| format!("add cover column: {e}"))?;
        crate::log::info("migration: v3 added local_playlists.cover");
    }
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', '3')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Move a play_stats row from `old` to `new`, merging tallies if `new` already has one.
fn remap_stat(tx: &rusqlite::Transaction, old: &str, new: &str) -> Result<(), String> {
    let old_row: Option<(i64, i64, Option<i64>)> = tx
        .query_row(
            "SELECT partial_count, full_count, last_played FROM play_stats WHERE track_id = ?1",
            [old],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    let Some((partial, full, last)) = old_row else {
        return Ok(());
    };
    let new_exists: bool = tx
        .prepare("SELECT 1 FROM play_stats WHERE track_id = ?1")
        .and_then(|mut s| s.exists([new]))
        .map_err(|e| e.to_string())?;
    if new_exists {
        tx.execute(
            "UPDATE play_stats SET
                 partial_count = partial_count + ?1,
                 full_count    = full_count + ?2,
                 last_played   = MAX(COALESCE(last_played, 0), COALESCE(?3, 0))
             WHERE track_id = ?4",
            rusqlite::params![partial, full, last, new],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM play_stats WHERE track_id = ?1", [old])
            .map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "UPDATE play_stats SET track_id = ?1 WHERE track_id = ?2",
            [new, old],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Upsert synced tracks. When `prune` is set (the sync fetched EVERY page, so `tracks`
/// is the complete current library), also delete cached rows that are no longer in it —
/// otherwise songs removed from the Apple library live in the cache forever, with stale
/// `added_rank`s corrupting the Added-Date order. Never prune from a partial sync.
fn write_tracks(conn: &mut Connection, tracks: &[Track], prune: bool) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = Vec::with_capacity(tracks.len());
    {
        // A sync write is authoritative: it also GRADUATES a 'seen' row to 'library'
        // (the track joined the library — same canonical key, so feedback rides along).
        let mut stmt = tx
            .prepare(
                "INSERT INTO tracks(track_id, source, sort_key, json) VALUES(?1, 'library', ?2, ?3)
                 ON CONFLICT(track_id) DO UPDATE SET
                     sort_key = excluded.sort_key, json = excluded.json, source = 'library'",
            )
            .map_err(|e| e.to_string())?;
        for t in tracks {
            let Some(id) = track_key(t) else { continue };
            let sort_key = format!("{}\u{1f}{}", t.title.to_lowercase(), t.artist_name.to_lowercase());
            let json = serde_json::to_string(t).map_err(|e| e.to_string())?;
            stmt.execute(rusqlite::params![id, sort_key, json])
                .map_err(|e| e.to_string())?;
            ids.push(id);
        }
    }
    if prune {
        // Diff via a temp table — thousands of ids exceed SQLite's parameter limit.
        tx.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS sync_ids(id TEXT PRIMARY KEY);
             DELETE FROM sync_ids;",
        )
        .map_err(|e| e.to_string())?;
        {
            let mut ins = tx
                .prepare("INSERT OR IGNORE INTO sync_ids(id) VALUES(?1)")
                .map_err(|e| e.to_string())?;
            for id in &ids {
                ins.execute([id]).map_err(|e| e.to_string())?;
            }
        }
        // Prune ONLY synced rows — 'seen' rows are interaction history, not library
        // membership, and a library sync must never delete them.
        tx.execute(
            "DELETE FROM tracks WHERE source = 'library' AND track_id NOT IN (SELECT id FROM sync_ids)",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sync_ids", []).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Read a page of cached tracks, ordered by title/artist.
#[tauri::command]
pub fn library_tracks(offset: u32, limit: u32, db: State<'_, Db>) -> Result<Page<Track>, String> {
    let conn = db.0.lock().unwrap();
    // Library views show synced rows only; 'seen' rows exist for feedback joins.
    let total: u32 = conn
        .query_row("SELECT COUNT(*) FROM tracks WHERE source = 'library'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT json FROM tracks WHERE source = 'library' ORDER BY sort_key LIMIT ?1 OFFSET ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![limit, offset], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let s = row.map_err(|e| e.to_string())?;
        let t: Track = serde_json::from_str(&s).map_err(|e| e.to_string())?;
        items.push(t);
    }
    let next_offset = (offset + limit < total).then_some(offset + limit);
    Ok(Page {
        items,
        total,
        next_offset,
    })
}

/// All materialized (`source = 'seen'`) rows — catalog-only tracks the user has
/// interacted with. The front-end store ingests these as TRANSIENTS at load so
/// historical feedback (play events / stats / Rewind) resolves to metadata across
/// sessions; library views still read only synced rows (`library_tracks`).
#[tauri::command]
pub fn seen_tracks(db: State<'_, Db>) -> Result<Vec<Track>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT json FROM tracks WHERE source = 'seen'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let s = row.map_err(|e| e.to_string())?;
        items.push(serde_json::from_str(&s).map_err(|e| e.to_string())?);
    }
    Ok(items)
}

/// A track's cumulative play tallies (see `record_play`).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayStat {
    pub track_id: String,
    pub partial_count: i64,
    pub full_count: i64,
    /// Epoch milliseconds of the most recent start; None until first played.
    pub last_played: Option<i64>,
}

/// Increment a track's play tally. `kind` is `"partial"` (the song became
/// now-playing — it *started*) or `"full"` (playback crossed the listened-through
/// threshold). Keyed by the CATALOG-FIRST canonical id (`catalog_id ?? library_id`)
/// to match the `tracks` PK, so stats join to track metadata. `full_count` is always
/// a subset of `partial_count` (every finish also started). Returns the updated row
/// so the caller can confirm/log without a separate read. Purely local — no Apple calls.
#[tauri::command]
pub fn record_play(
    catalog_id: Option<String>,
    library_id: Option<String>,
    kind: String,
    db: State<'_, Db>,
) -> Result<PlayStat, String> {
    let track_id = catalog_id.or(library_id).unwrap_or_default();
    if track_id.is_empty() {
        return Err("record_play: track has no id".into());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let conn = db.0.lock().unwrap();
    // One upsert per kind: create the row on first sight, else bump the tally.
    // `partial` also stamps last_played (the start); `full` leaves it (it follows a start).
    let sql = match kind.as_str() {
        "partial" => {
            "INSERT INTO play_stats(track_id, partial_count, full_count, last_played)
             VALUES(?1, 1, 0, ?2)
             ON CONFLICT(track_id) DO UPDATE SET
                 partial_count = partial_count + 1,
                 last_played = ?2"
        }
        // The insert arm seeds partial_count = 1, not 0: a "full" with no prior row
        // means the start went unrecorded (e.g. began before an app restart), and the
        // full ⊆ partial invariant must hold regardless of arrival order.
        "full" => {
            "INSERT INTO play_stats(track_id, partial_count, full_count, last_played)
             VALUES(?1, 1, 1, ?2)
             ON CONFLICT(track_id) DO UPDATE SET
                 full_count = full_count + 1"
        }
        other => return Err(format!("record_play: unknown kind '{other}'")),
    };
    conn.execute(sql, rusqlite::params![track_id, now_ms])
        .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT track_id, partial_count, full_count, last_played
         FROM play_stats WHERE track_id = ?1",
        rusqlite::params![track_id],
        |r| {
            Ok(PlayStat {
                track_id: r.get(0)?,
                partial_count: r.get(1)?,
                full_count: r.get(2)?,
                last_played: r.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Append a play-event row at song start (step 1 of the two-step write). Returns
/// the new row id so the caller can finalize it at end-of-play. Writing immediately
/// means the play survives a crash/force-quit (`ms_listened` stays NULL = unknown).
#[tauri::command]
pub fn record_event_start(
    catalog_id: Option<String>,
    library_id: Option<String>,
    context: Option<String>,
    db: State<'_, Db>,
) -> Result<i64, String> {
    let track_id = catalog_id.or(library_id).unwrap_or_default();
    if track_id.is_empty() {
        return Err("record_event_start: track has no id".into());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO play_events(track_id, started_ts, context) VALUES(?1, ?2, ?3)",
        rusqlite::params![track_id, now_ms, context],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// Finalize a play-event row at end-of-play (step 2): the real elapsed listen time
/// and whether it crossed the listened-through threshold.
#[tauri::command]
pub fn record_event_end(
    event_id: i64,
    ms_listened: i64,
    completed: bool,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE play_events SET ms_listened = ?2, completed = ?3 WHERE id = ?1",
        rusqlite::params![event_id, ms_listened.max(0), completed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One row from the play-event log, for the Rewind card (DEETS-REWIND Phase B).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayEvent {
    pub track_id: String,
    pub started_ts: i64,
    /// Real elapsed listen time; None = never finalized (in flight, or a crashed session).
    pub ms_listened: Option<i64>,
    pub completed: bool,
    pub context: Option<String>,
}

/// How many plays have ever started (one row per start). The Rewind card's 50-start
/// auto-reveal reads this once at boot, then counts starts in the renderer.
#[tauri::command]
pub fn play_event_count(db: State<'_, Db>) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    conn.query_row("SELECT COUNT(*) FROM play_events", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Read play events with `started_ts >= since_ts` (epoch-ms), oldest first. The time
/// windowing happens HERE (via idx_play_events_ts) so a day view never ships a year of
/// rows over IPC; all grouping/ranking lives in TS where the track-store join is.
#[tauri::command]
pub fn play_events_since(since_ts: i64, db: State<'_, Db>) -> Result<Vec<PlayEvent>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT track_id, started_ts, ms_listened, completed, context
             FROM play_events WHERE started_ts >= ?1 ORDER BY started_ts",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([since_ts], |r| {
            Ok(PlayEvent {
                track_id: r.get(0)?,
                started_ts: r.get(1)?,
                ms_listened: r.get(2)?,
                completed: r.get::<_, i64>(3)? != 0,
                context: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Materialize a non-library track into the unified store (`source = 'seen'`) so
/// feedback keyed to it (play stats, ratings, song-of-day) always resolves to
/// metadata. Called with the already-normalized Track we hold at interaction time
/// (a search result, the now-playing item) — a LOCAL upsert, no Apple call. Never
/// overwrites a 'library' row (the sync is authoritative for those).
#[tauri::command]
pub fn materialize_track(track: Track, db: State<'_, Db>) -> Result<(), String> {
    let Some(id) = track_key(&track) else {
        return Err("materialize_track: track has no id".into());
    };
    let sort_key = format!(
        "{}\u{1f}{}",
        track.title.to_lowercase(),
        track.artist_name.to_lowercase()
    );
    let json = serde_json::to_string(&track).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO tracks(track_id, source, sort_key, json) VALUES(?1, 'seen', ?2, ?3)
         ON CONFLICT(track_id) DO NOTHING",
        rusqlite::params![id, sort_key, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The same local upsert as `materialize_track`, for a batch under one lock — the
/// bridge's search route parks its hits so a later play-by-id resolves offline.
pub(crate) fn materialize_many(conn: &Connection, tracks: &[Track]) -> Result<(), String> {
    for track in tracks {
        let Some(id) = track_key(track) else { continue };
        let sort_key = format!("{}\u{1f}{}", track.title.to_lowercase(), track.artist_name.to_lowercase());
        let json = serde_json::to_string(track).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO tracks(track_id, source, sort_key, json) VALUES(?1, 'seen', ?2, ?3)
             ON CONFLICT(track_id) DO NOTHING",
            rusqlite::params![id, sort_key, json],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A track by its store key (catalog id, else library id) — library or seen rows.
pub(crate) fn track_by_id(conn: &Connection, id: &str) -> Option<Track> {
    conn.query_row("SELECT json FROM tracks WHERE track_id = ?1", [id], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
}

/// True when the store holds this id as a SYNCED library row (a `seen`/transient row
/// doesn't count — the same rule the front-end's `inLibrary` applies to the loaded
/// store). Used by the bridge/tray to hide "+" for songs already in the library.
pub(crate) fn in_library(conn: &Connection, id: &str) -> bool {
    conn.query_row("SELECT source FROM tracks WHERE track_id = ?1", [id], |r| r.get::<_, String>(0))
        .map(|s| s == "library")
        .unwrap_or(false)
}

/// Graduate tracks to `source='library'` after an explicit Add-to-Library (or insert
/// fresh library rows). Stamps a synthetic `added_rank` — Unix seconds, guaranteed
/// above every real rank (0..library-size) and monotonic — so a just-added track sorts
/// to the top of "Added Date" immediately; the next `dateAdded` sync overwrites both
/// the rank and the JSON with authoritative values. Called under the DB lock by the
/// add-to-library command. `added_rank` is a u32, so seconds (not ms) is required.
pub(crate) fn graduate_tracks(conn: &Connection, tracks: &[Track]) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0);
    for t in tracks {
        let Some(id) = track_key(t) else { continue };
        let sort_key = format!("{}\u{1f}{}", t.title.to_lowercase(), t.artist_name.to_lowercase());
        let mut row = t.clone();
        row.added_rank = Some(now);
        let json = serde_json::to_string(&row).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO tracks(track_id, source, sort_key, json) VALUES(?1, 'library', ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET
                 source = 'library', sort_key = excluded.sort_key, json = excluded.json",
            rusqlite::params![id, sort_key, json],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// One sync at a time. Overlapping invocations (double-triggered refresh, a card
// re-mount racing the startup sync) would double the Apple traffic and interleave
// progress events. The guard's Drop releases the flag on every exit path.
static SYNC_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct SyncFlagGuard;
impl Drop for SyncFlagGuard {
    fn drop(&mut self) {
        SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

/// A full pass is only due this often on its own; in between, a launch runs the
/// incremental pass (FUTURE-SETTINGS.md §21 — a Settings row later, not now).
const FULL_SYNC_EVERY_SECS: i64 = 6 * 60 * 60;
const META_FULL_SYNC_AT: &str = "full_sync_at";

fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).ok()
}
fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}
fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Sync library songs into the cache. `full: false` (the startup call) runs the
/// **incremental** pass when the last complete pass is under six hours old — newest
/// first, stop at the first page that holds a song we already have, upsert, never
/// prune — so an album added on the phone this morning is one or two requests, not
/// forty. `full: true` (the refresh button, or a stale cache) is the complete pass:
/// pages fetched in parallel (≤5 concurrent), failed pages retried once sequentially,
/// and on completion the rows no longer in the library are pruned and the timestamp
/// written. An incomplete full pass upserts what it got, emits `{phase:"error"}`, and
/// fails — silently dropping pages would mean songs quietly missing from the cache.
/// Emits `library-sync` progress events per page either way.
#[tauri::command]
pub async fn library_sync(
    full: Option<bool>,
    app: AppHandle,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    if SYNC_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return Err("library sync already in progress".into());
    }
    let _guard = SyncFlagGuard;

    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = std::sync::Arc::new(AppleProvider::new(dev, user));

    let last_full: Option<i64> = {
        let conn = db.0.lock().unwrap();
        meta_get(&conn, META_FULL_SYNC_AT).and_then(|v| v.parse().ok())
    };
    let age = last_full.map(|t| now_secs() - t);
    let incremental = !full.unwrap_or(true) && age.map(|a| a >= 0 && a < FULL_SYNC_EVERY_SECS).unwrap_or(false);

    app.emit("library-sync", serde_json::json!({ "phase": "start" })).ok();
    if incremental {
        return sync_incremental(&app, provider, &db, age.unwrap_or(0)).await;
    }
    crate::log::info(&format!(
        "library: full sync start ({})",
        match age {
            Some(a) => format!("last full pass {}h ago", a / 3600),
            None => "no full pass on record".into(),
        }
    ));

    let progress = |fetched: usize, total: u32| {
        app.emit(
            "library-sync",
            serde_json::json!({ "phase": "progress", "fetched": fetched, "total": total }),
        )
        .ok();
    };

    // First page tells us the total; fan out the rest.
    let first = provider.songs_page(0, 100, false).await?;
    let total = first.total;
    let mut all = first.items;
    progress(all.len(), total);

    let offsets: Vec<u32> = (100..total).step_by(100).collect();
    let mut pages = futures::stream::iter(offsets.into_iter().map(|off| {
        let p = provider.clone();
        async move { (off, p.songs_page(off, 100, false).await) }
    }))
    .buffer_unordered(5);

    let mut failed: Vec<(u32, String)> = Vec::new();
    while let Some((off, r)) = pages.next().await {
        match r {
            Ok(page) => {
                all.extend(page.items);
                progress(all.len(), total);
            }
            Err(e) => failed.push((off, e)),
        }
    }
    drop(pages);

    // Second chance: transient blips / throttles usually clear once the parallel
    // burst is over, so retry stragglers one at a time.
    let mut errors: Vec<String> = Vec::new();
    for (off, first_err) in failed {
        match provider.songs_page(off, 100, false).await {
            Ok(page) => {
                all.extend(page.items);
                progress(all.len(), total);
            }
            Err(e) => errors.push(format!("offset {off}: {first_err}; retry: {e}")),
        }
    }

    let complete = errors.is_empty();
    {
        let mut conn = db.0.lock().unwrap();
        write_tracks(&mut conn, &all, complete)?;
    }

    if !complete {
        let message = format!("{} page(s) failed: {}", errors.len(), errors.join(" | "));
        crate::log::error(&format!("library: sync aborted at {}/{total}, {message}", all.len()));
        app.emit(
            "library-sync",
            serde_json::json!({ "phase": "error", "message": message, "count": all.len(), "total": total }),
        )
        .ok();
        return Err(format!("library sync incomplete — {message}"));
    }

    {
        let conn = db.0.lock().unwrap();
        if let Err(e) = meta_set(&conn, META_FULL_SYNC_AT, &now_secs().to_string()) {
            crate::log::warn(&format!("library: full sync timestamp not written: {e}"));
        }
    }
    crate::log::info(&format!("library: full sync done, {} of {total} song(s)", all.len()));
    app.emit(
        "library-sync",
        serde_json::json!({ "phase": "done", "count": all.len(), "total": total }),
    )
    .ok();
    Ok(all.len() as u32)
}

/// The incremental pass: newest-added first, one page at a time, stop at the first
/// page that holds a song already cached (everything older is known too). Upserts
/// only — a removal on another device waits for the next full pass. The guard is a
/// page cap at the library total, so an unexpectedly all-new library ends anyway.
async fn sync_incremental(
    app: &AppHandle,
    provider: std::sync::Arc<AppleProvider>,
    db: &State<'_, Db>,
    age_secs: i64,
) -> Result<u32, String> {
    let mut offset = 0u32;
    let mut new_total = 0u32;
    let mut pages = 0u32;
    let mut total = 0u32;
    loop {
        let page = match provider.songs_page(offset, 100, true).await {
            Ok(p) => p,
            Err(e) => {
                crate::log::warn(&format!("library: incremental sync failed at offset {offset}: {e}"));
                app.emit("library-sync", serde_json::json!({ "phase": "error", "message": e, "count": new_total, "total": total })).ok();
                return Err(format!("library sync incomplete — {e}"));
            }
        };
        pages += 1;
        total = page.total;
        let (known, fresh) = {
            let mut conn = db.0.lock().unwrap();
            let known = {
                let mut stmt = conn
                    .prepare("SELECT 1 FROM tracks WHERE track_id = ?1 AND source = 'library'")
                    .map_err(|e| e.to_string())?;
                page.items
                    .iter()
                    .filter_map(track_key)
                    .filter(|id| stmt.exists([id.as_str()]).unwrap_or(false))
                    .count()
            };
            write_tracks(&mut conn, &page.items, false)?;
            (known, page.items.len() - known)
        };
        new_total += fresh as u32;
        app.emit("library-sync", serde_json::json!({ "phase": "progress", "fetched": new_total, "total": total })).ok();
        let next = page.next_offset;
        if known > 0 || next.is_none() || offset + 100 >= total {
            break;
        }
        offset = next.unwrap_or(offset + 100);
    }
    let count: u32 = {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM tracks WHERE source = 'library'", [], |r| r.get(0)).unwrap_or(0)
    };
    crate::log::info(&format!(
        "library: incremental sync done, {new_total} new in {pages} page(s); apple total {total}, cached {count} (last full pass {}h ago)",
        age_secs / 3600
    ));
    app.emit("library-sync", serde_json::json!({ "phase": "done", "count": count, "total": total })).ok();
    Ok(new_total)
}

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
fn track_key(t: &Track) -> Option<String> {
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
    println!("[library] v2 migration complete — {rekeyed} row(s) re-keyed to catalog-first");
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

/// Full sync of library songs into the cache. Pages are fetched in parallel
/// (≤5 concurrent); failed pages are retried once, sequentially. Emits `library-sync`
/// progress events per page. A complete sync also prunes cache rows no longer in the
/// library; an incomplete one upserts what it got, emits `{phase:"error"}`, and fails —
/// silently dropping pages would mean songs quietly missing from the cache.
#[tauri::command]
pub async fn library_sync(
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

    app.emit("library-sync", serde_json::json!({ "phase": "start" })).ok();

    let progress = |fetched: usize, total: u32| {
        app.emit(
            "library-sync",
            serde_json::json!({ "phase": "progress", "fetched": fetched, "total": total }),
        )
        .ok();
    };

    // First page tells us the total; fan out the rest.
    let first = provider.songs_page(0, 100).await?;
    let total = first.total;
    let mut all = first.items;
    progress(all.len(), total);

    let offsets: Vec<u32> = (100..total).step_by(100).collect();
    let mut pages = futures::stream::iter(offsets.into_iter().map(|off| {
        let p = provider.clone();
        async move { (off, p.songs_page(off, 100).await) }
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
        match provider.songs_page(off, 100).await {
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
        app.emit(
            "library-sync",
            serde_json::json!({ "phase": "error", "message": message, "count": all.len(), "total": total }),
        )
        .ok();
        return Err(format!("library sync incomplete — {message}"));
    }

    app.emit(
        "library-sync",
        serde_json::json!({ "phase": "done", "count": all.len(), "total": total }),
    )
    .ok();
    Ok(all.len() as u32)
}

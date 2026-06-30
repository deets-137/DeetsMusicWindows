//! Local library cache (SQLite) + sync orchestration.
//!
//! Rust owns the cache: it fetches pages via the provider, normalizes, and upserts
//! into SQLite. The frontend renders from the cache (instant) and triggers a sync
//! that refreshes it in the background (stale-while-revalidate), with progress
//! events on the `library-sync` channel.

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
        "CREATE TABLE IF NOT EXISTS tracks (
            library_id TEXT PRIMARY KEY,
            sort_key   TEXT,
            json       TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_sort ON tracks(sort_key);

        -- Per-track listening tallies, for a future data-vis. Keyed by the same
        -- `library_id ?? catalog_id` rule the tracks PK uses, so stats join to track
        -- metadata. partial = song started (became now-playing); full = playback
        -- crossed the listened-through threshold. last_played is epoch-ms of last start.
        CREATE TABLE IF NOT EXISTS play_stats (
            track_id      TEXT PRIMARY KEY,
            partial_count INTEGER NOT NULL DEFAULT 0,
            full_count    INTEGER NOT NULL DEFAULT 0,
            last_played   INTEGER
        );",
    )
}

fn upsert_tracks(conn: &mut Connection, tracks: &[Track]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO tracks(library_id, sort_key, json) VALUES(?1, ?2, ?3)
                 ON CONFLICT(library_id) DO UPDATE SET sort_key=excluded.sort_key, json=excluded.json",
            )
            .map_err(|e| e.to_string())?;
        for t in tracks {
            let id = t
                .library_id
                .clone()
                .or_else(|| t.catalog_id.clone())
                .unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let sort_key = format!("{}\u{1f}{}", t.title.to_lowercase(), t.artist_name.to_lowercase());
            let json = serde_json::to_string(t).map_err(|e| e.to_string())?;
            stmt.execute(rusqlite::params![id, sort_key, json])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Read a page of cached tracks, ordered by title/artist.
#[tauri::command]
pub fn library_tracks(offset: u32, limit: u32, db: State<'_, Db>) -> Result<Page<Track>, String> {
    let conn = db.0.lock().unwrap();
    let total: u32 = conn
        .query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT json FROM tracks ORDER BY sort_key LIMIT ?1 OFFSET ?2")
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
/// threshold). Keyed by `library_id ?? catalog_id` to match the `tracks` cache PK,
/// so stats join to track metadata. `full_count` is always a subset of
/// `partial_count` (every finish also started). Returns the updated row so the
/// caller can confirm/log without a separate read. Purely local — no Apple calls.
#[tauri::command]
pub fn record_play(
    catalog_id: Option<String>,
    library_id: Option<String>,
    kind: String,
    db: State<'_, Db>,
) -> Result<PlayStat, String> {
    let track_id = library_id.or(catalog_id).unwrap_or_default();
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
        "full" => {
            "INSERT INTO play_stats(track_id, partial_count, full_count, last_played)
             VALUES(?1, 0, 1, ?2)
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

/// Full sync of library songs into the cache. Pages are fetched in parallel
/// (≤5 concurrent), then upserted. Emits `library-sync` progress events.
#[tauri::command]
pub async fn library_sync(
    app: AppHandle,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = std::sync::Arc::new(AppleProvider::new(dev, user));

    app.emit("library-sync", serde_json::json!({ "phase": "start" })).ok();

    // First page tells us the total; fan out the rest.
    let first = provider.songs_page(0, 100).await?;
    let total = first.total;
    let mut all = first.items;
    app.emit(
        "library-sync",
        serde_json::json!({ "phase": "progress", "fetched": all.len(), "total": total }),
    )
    .ok();

    let offsets: Vec<u32> = (100..total).step_by(100).collect();
    let pages = futures::stream::iter(offsets.into_iter().map(|off| {
        let p = provider.clone();
        async move { p.songs_page(off, 100).await }
    }))
    .buffer_unordered(5)
    .collect::<Vec<_>>()
    .await;
    for r in pages {
        if let Ok(page) = r {
            all.extend(page.items);
        }
    }

    {
        let mut conn = db.0.lock().unwrap();
        upsert_tracks(&mut conn, &all)?;
    }

    app.emit(
        "library-sync",
        serde_json::json!({ "phase": "done", "count": all.len(), "total": total }),
    )
    .ok();
    Ok(all.len() as u32)
}

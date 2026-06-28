//! Local library cache (SQLite) + sync orchestration.
//!
//! Rust owns the cache: it fetches pages via the provider, normalizes, and upserts
//! into SQLite. The frontend renders from the cache (instant) and triggers a sync
//! that refreshes it in the background (stale-while-revalidate), with progress
//! events on the `library-sync` channel.

use std::sync::Mutex;

use futures::StreamExt;
use rusqlite::Connection;
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
        CREATE INDEX IF NOT EXISTS idx_tracks_sort ON tracks(sort_key);",
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

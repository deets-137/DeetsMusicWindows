//! Playlists — the local-first store + the read-only Apple mirror (docs/PLAYLISTS.md).
//!
//! **Local playlists** live in SQLite and are the only fully-editable copy (the public
//! Apple API can only create/append — the write ceiling). Each track row keeps a
//! denormalised `Track` snapshot so a playlist is self-contained even when it holds
//! catalog tracks that aren't in the library cache.
//!
//! **Apple playlists** are cached as a read-only MIRROR: `apple_playlists` holds the
//! flat normalized list (folders deliberately flattened — PLAYLISTS.md §2);
//! `apple_playlist_tracks` caches contents on first open, so re-opening a playlist
//! costs zero Apple calls. The flat list carries no lastModified, so a changed row's
//! json is the cheap staleness signal; the explicit ⟳ Sync (`fresh: true`) drops every
//! content cache.
//!
//! This session ships the read/play path; the local CRUD below is plumbing-ready but
//! has no UI callers until the creation-UX session.

use rusqlite::Connection;
use tauri::State;

use crate::apple::{self, AppleProvider, AppleState};
use crate::library::Db;
use crate::model::{Playlist, Track};
use crate::provider::MusicProvider;

pub fn init_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_playlists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            exported_apple_id TEXT,
            exported_at INTEGER
        );
        -- position is the authored order; json is the denormalised Track snapshot.
        CREATE TABLE IF NOT EXISTS local_playlist_tracks (
            playlist_id INTEGER NOT NULL,
            position    INTEGER NOT NULL,
            json        TEXT NOT NULL,
            PRIMARY KEY (playlist_id, position)
        );
        -- Apple mirror: one row per library playlist (normalized Playlist json),
        -- position = the order Apple returned.
        CREATE TABLE IF NOT EXISTS apple_playlists (
            playlist_id TEXT PRIMARY KEY,
            position    INTEGER NOT NULL,
            json        TEXT NOT NULL
        );
        -- On-demand content cache per mirror playlist (filled on first open).
        CREATE TABLE IF NOT EXISTS apple_playlist_tracks (
            playlist_id TEXT NOT NULL,
            position    INTEGER NOT NULL,
            json        TEXT NOT NULL,
            PRIMARY KEY (playlist_id, position)
        );
        -- Manual folders (PLAYLISTS.md §Folders): purely local metadata over the
        -- unified list. Members key on the front-end libraryId ('local:{rowid}' or
        -- the Apple playlist id), so mirrors are filable and membership survives a
        -- mirror re-sync. A playlist lives in at most one folder.
        CREATE TABLE IF NOT EXISTS playlist_folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playlist_folder_members (
            playlist_key TEXT PRIMARY KEY,
            folder_id    INTEGER NOT NULL
        );",
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── The unified list (local + mirror), read from cache — zero Apple calls ──────

#[tauri::command]
pub fn playlists_cached(db: State<'_, Db>) -> Result<Vec<Playlist>, String> {
    let conn = db.0.lock().unwrap();
    let mut out: Vec<Playlist> = Vec::new();

    // Folder membership, stamped onto both sources below (never baked into the
    // cached json — this read is the one source of folder truth).
    let folder_of: std::collections::HashMap<String, i64> = {
        let mut stmt = conn
            .prepare("SELECT playlist_key, folder_id FROM playlist_folder_members")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)?
    };

    // Local playlists (fully editable, no badge). The front-end keys on the
    // synthetic `local:{id}` — locals have no Apple identity by definition.
    // created_at serializes into date_added as RFC3339, the same shape as Apple's
    // ISO dates, so the "Added Date" sort covers both sources with one comparator.
    {
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.description, p.created_at,
                        (SELECT COUNT(*) FROM local_playlist_tracks t WHERE t.playlist_id = p.id)
                 FROM local_playlists p",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, u32>(4)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (id, name, description, created_at, n) = row.map_err(err)?;
            let key = format!("local:{id}");
            out.push(Playlist {
                folder_id: folder_of.get(&key).copied(),
                library_id: Some(key),
                name,
                description,
                can_edit: true,
                track_count: Some(n),
                source: Some("local".into()),
                kind: Some("user".into()),
                date_added: chrono::DateTime::from_timestamp_millis(created_at)
                    .map(|d| d.to_rfc3339()),
                ..Default::default()
            });
        }
    }

    // Apple mirror rows, in Apple's order (the front-end sorts client-side).
    {
        let mut stmt = conn
            .prepare("SELECT json FROM apple_playlists ORDER BY position")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?;
        for row in rows {
            let s = row.map_err(err)?;
            let mut p: Playlist = serde_json::from_str(&s).map_err(err)?;
            p.folder_id = p.library_id.as_ref().and_then(|id| folder_of.get(id)).copied();
            out.push(p);
        }
    }
    Ok(out)
}

// ── Apple mirror sync (read-in; stale-while-revalidate like songs) ─────────────

/// Refresh the flat mirror list from Apple. `fresh: false` (the once-per-session
/// auto-sync) keeps the content caches of unchanged playlists; `fresh: true` (the
/// explicit ⟳) drops them all, so every next open refetches current contents.
#[tauri::command]
pub async fn apple_playlists_sync(
    fresh: bool,
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
    let provider = AppleProvider::new(dev, user);

    let mut all: Vec<Playlist> = Vec::new();
    let mut offset = 0u32;
    for _ in 0..100 {
        // page cap defends against a runaway loop
        let page = provider.playlists_page(offset, 100).await?;
        let n = page.items.len();
        all.extend(page.items);
        match page.next_offset {
            Some(next) if n > 0 => offset = next,
            _ => break,
        }
    }

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;

    let old: std::collections::HashMap<String, String> = {
        let mut stmt = tx
            .prepare("SELECT playlist_id, json FROM apple_playlists")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)?
    };

    tx.execute("DELETE FROM apple_playlists", []).map_err(err)?;
    if fresh {
        tx.execute("DELETE FROM apple_playlist_tracks", []).map_err(err)?;
    }
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (i, p) in all.iter().enumerate() {
        let Some(id) = p.library_id.clone() else { continue };
        // The flat list never carries a track count — carry forward the one a prior
        // content fetch learned, so the overview keeps showing "N songs".
        let mut p2 = p.clone();
        if p2.track_count.is_none() {
            if let Some(op) = old.get(&id).and_then(|s| serde_json::from_str::<Playlist>(s).ok()) {
                p2.track_count = op.track_count;
            }
        }
        let json = serde_json::to_string(&p2).map_err(err)?;
        // A changed row is the staleness tell (no lastModified on the flat list) —
        // note pure content edits don't change any attribute, hence the `fresh` knob.
        if !fresh && old.get(&id).is_some_and(|oj| *oj != json) {
            tx.execute(
                "DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1",
                [id.as_str()],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT INTO apple_playlists(playlist_id, position, json) VALUES(?1, ?2, ?3)",
            rusqlite::params![id, i as i64, json],
        )
        .map_err(err)?;
        seen.insert(id);
    }
    // Playlists deleted on Apple: drop their orphaned content caches + folder rows.
    for id in old.keys() {
        if !seen.contains(id) {
            tx.execute(
                "DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1",
                [id.as_str()],
            )
            .map_err(err)?;
            tx.execute(
                "DELETE FROM playlist_folder_members WHERE playlist_key = ?1",
                [id.as_str()],
            )
            .map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    println!("[playlists] mirror synced — {} playlist(s)", all.len());
    Ok(all.len() as u32)
}

/// Backfill the "N songs" overview count for Apple mirror playlists that don't have
/// one yet (PLAYLISTS.md). The flat list carries no count and Apple rejects the
/// extend/include/fields tricks (probed 2026-07-02), so each uncounted playlist costs
/// ONE tiny `tracks?limit=1` call — it reads `meta.total`, not the contents. The
/// learned count is persisted onto the playlist row, so a playlist is counted at most
/// once ever, then served from cache. `buffer_unordered(5)` keeps the burst polite
/// (same 5-wide cap as `library_sync`). Returns how many were filled.
///
/// The front-end gates this on the eager-counts setting (FUTURE-SETTINGS §14): eager
/// backfill (this) vs. leaving "Playlist" on the tile until the user opens it.
#[tauri::command]
pub async fn apple_playlist_counts(
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    use futures::StreamExt;

    // Which mirror rows still lack a count? Lock only for the read.
    let missing: Vec<String> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT json FROM apple_playlists").map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        let mut ids = Vec::new();
        for row in rows {
            let p: Playlist = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if p.track_count.is_none() {
                if let Some(id) = p.library_id {
                    ids.push(id);
                }
            }
        }
        ids
    };
    if missing.is_empty() {
        return Ok(0);
    }

    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);

    // One tiny tracks?limit=1 per playlist → meta.total (an empty playlist 404s → 0).
    let mut stream = futures::stream::iter(missing.into_iter().map(|id| {
        let p = provider.clone();
        async move {
            let count = p.playlist_tracks_page(&id, 0, 1).await.map(|pg| pg.total);
            (id, count)
        }
    }))
    .buffer_unordered(5);

    let mut learned: Vec<(String, u32)> = Vec::new();
    while let Some((id, res)) = stream.next().await {
        match res {
            Ok(total) => learned.push((id, total)),
            Err(e) => eprintln!("[playlists] count backfill {id}: {e}"),
        }
    }
    drop(stream);

    // Persist each learned count back onto its playlist json, one transaction.
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    let mut filled = 0u32;
    for (id, total) in &learned {
        let json: Option<String> = tx
            .query_row(
                "SELECT json FROM apple_playlists WHERE playlist_id = ?1",
                [id.as_str()],
                |r| r.get(0),
            )
            .ok();
        let Some(json) = json else { continue };
        let Ok(mut p) = serde_json::from_str::<Playlist>(&json) else { continue };
        if p.track_count.is_some() {
            continue; // a concurrent open already learned it — don't clobber
        }
        p.track_count = Some(*total);
        let updated = serde_json::to_string(&p).map_err(err)?;
        tx.execute(
            "UPDATE apple_playlists SET json = ?1 WHERE playlist_id = ?2",
            rusqlite::params![updated, id],
        )
        .map_err(err)?;
        filled += 1;
    }
    tx.commit().map_err(err)?;
    Ok(filled)
}

/// A mirror playlist's tracks, authored order — cache-first (zero Apple calls after
/// the first open). On a fetch, the learned count is written back onto the playlist
/// row so the overview can show "N songs". An empty cached playlist refetches each
/// open (indistinguishable from never-fetched) — cheap, the 404 short-circuits.
#[tauri::command]
pub async fn apple_playlist_tracks(
    id: String,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<Vec<Track>, String> {
    {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT json FROM apple_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
            .map_err(err)?;
        let rows = stmt
            .query_map([id.as_str()], |r| r.get::<_, String>(0))
            .map_err(err)?;
        let mut cached: Vec<Track> = Vec::new();
        for row in rows {
            cached.push(serde_json::from_str(&row.map_err(err)?).map_err(err)?);
        }
        if !cached.is_empty() {
            return Ok(cached);
        }
    }

    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);

    let mut all: Vec<Track> = Vec::new();
    let mut offset = 0u32;
    for _ in 0..100 {
        let page = provider.playlist_tracks_page(&id, offset, 100).await?;
        all.extend(page.items); // post-filter (videos skipped); offset steps by limit regardless
        match page.next_offset {
            Some(next) if next > offset => offset = next,
            _ => break,
        }
    }

    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1",
        [id.as_str()],
    )
    .map_err(err)?;
    {
        let mut ins = tx
            .prepare("INSERT INTO apple_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)")
            .map_err(err)?;
        for (i, t) in all.iter().enumerate() {
            let json = serde_json::to_string(t).map_err(err)?;
            ins.execute(rusqlite::params![id, i as i64, json]).map_err(err)?;
        }
    }
    // Teach the overview row its real count.
    let row: Option<String> = tx
        .query_row(
            "SELECT json FROM apple_playlists WHERE playlist_id = ?1",
            [id.as_str()],
            |r| r.get(0),
        )
        .ok();
    if let Some(mut p) = row.and_then(|s| serde_json::from_str::<Playlist>(&s).ok()) {
        p.track_count = Some(all.len() as u32);
        tx.execute(
            "UPDATE apple_playlists SET json = ?2 WHERE playlist_id = ?1",
            rusqlite::params![id, serde_json::to_string(&p).map_err(err)?],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(all)
}

// ── Local CRUD (all SQLite, zero Apple calls; UI callers arrive with creation UX) ──

#[tauri::command]
pub fn playlist_create(
    name: String,
    description: Option<String>,
    db: State<'_, Db>,
) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    let now = now_ms();
    conn.execute(
        "INSERT INTO local_playlists(name, description, created_at, updated_at) VALUES(?1, ?2, ?3, ?3)",
        rusqlite::params![name, description, now],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn playlist_rename(id: i64, name: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE local_playlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, name, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn playlist_delete(id: i64, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM local_playlist_tracks WHERE playlist_id = ?1", [id])
        .map_err(err)?;
    tx.execute(
        "DELETE FROM playlist_folder_members WHERE playlist_key = ?1",
        [format!("local:{id}")],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM local_playlists WHERE id = ?1", [id])
        .map_err(err)?;
    tx.commit().map_err(err)
}

/// Append tracks (denormalised snapshots) to the end, preserving order.
#[tauri::command]
pub fn playlist_add_tracks(id: i64, tracks: Vec<Track>, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    let next: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM local_playlist_tracks WHERE playlist_id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    {
        let mut ins = tx
            .prepare("INSERT INTO local_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)")
            .map_err(err)?;
        for (i, t) in tracks.iter().enumerate() {
            ins.execute(rusqlite::params![id, next + i as i64, serde_json::to_string(t).map_err(err)?])
                .map_err(err)?;
        }
    }
    tx.execute("UPDATE local_playlists SET updated_at = ?2 WHERE id = ?1", rusqlite::params![id, now_ms()])
        .map_err(err)?;
    tx.commit().map_err(err)
}

/// Read a local playlist's tracks in stored order (needed by remove/reorder below;
/// playlists are small, so read-mutate-rewrite keeps positions trivially dense).
fn read_local_tracks(conn: &Connection, id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT json FROM local_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
        .map_err(err)?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

fn write_local_tracks(tx: &rusqlite::Transaction, id: i64, jsons: &[String]) -> Result<(), String> {
    tx.execute("DELETE FROM local_playlist_tracks WHERE playlist_id = ?1", [id])
        .map_err(err)?;
    let mut ins = tx
        .prepare("INSERT INTO local_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)")
        .map_err(err)?;
    for (i, j) in jsons.iter().enumerate() {
        ins.execute(rusqlite::params![id, i as i64, j]).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn playlist_remove_track(id: i64, position: i64, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let mut jsons = read_local_tracks(&conn, id)?;
    let pos = position as usize;
    if pos >= jsons.len() {
        return Err(format!("playlist_remove_track: position {position} out of range"));
    }
    jsons.remove(pos);
    let tx = conn.transaction().map_err(err)?;
    write_local_tracks(&tx, id, &jsons)?;
    tx.execute("UPDATE local_playlists SET updated_at = ?2 WHERE id = ?1", rusqlite::params![id, now_ms()])
        .map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn playlist_reorder(id: i64, from: i64, to: i64, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let mut jsons = read_local_tracks(&conn, id)?;
    let (f, t) = (from as usize, to as usize);
    if f >= jsons.len() || t >= jsons.len() {
        return Err(format!("playlist_reorder: {from}→{to} out of range"));
    }
    let moved = jsons.remove(f);
    jsons.insert(t, moved);
    let tx = conn.transaction().map_err(err)?;
    write_local_tracks(&tx, id, &jsons)?;
    tx.execute("UPDATE local_playlists SET updated_at = ?2 WHERE id = ?1", rusqlite::params![id, now_ms()])
        .map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn local_playlist_tracks(id: i64, db: State<'_, Db>) -> Result<Vec<Track>, String> {
    let conn = db.0.lock().unwrap();
    let jsons = read_local_tracks(&conn, id)?;
    let mut out = Vec::with_capacity(jsons.len());
    for j in jsons {
        out.push(serde_json::from_str(&j).map_err(err)?);
    }
    Ok(out)
}

// ── Folders (manual grouping over the unified list — all SQLite, zero Apple calls) ──

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistFolder {
    pub id: i64,
    pub name: String,
}

#[tauri::command]
pub fn playlist_folders_list(db: State<'_, Db>) -> Result<Vec<PlaylistFolder>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name FROM playlist_folders")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PlaylistFolder {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn playlist_folder_create(name: String, db: State<'_, Db>) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO playlist_folders(name, created_at) VALUES(?1, ?2)",
        rusqlite::params![name, now_ms()],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn playlist_folder_rename(id: i64, name: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE playlist_folders SET name = ?2 WHERE id = ?1",
        rusqlite::params![id, name],
    )
    .map_err(err)?;
    Ok(())
}

/// Delete a folder; its members become unfiled (the playlists themselves are untouched).
#[tauri::command]
pub fn playlist_folder_delete(id: i64, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM playlist_folder_members WHERE folder_id = ?1", [id])
        .map_err(err)?;
    tx.execute("DELETE FROM playlist_folders WHERE id = ?1", [id])
        .map_err(err)?;
    tx.commit().map_err(err)
}

/// File a playlist into a folder (`folder_id: Some`) or unfile it (`None`).
/// The key is the front-end libraryId — locals and Apple mirrors alike.
#[tauri::command]
pub fn playlist_folder_assign(
    playlist_key: String,
    folder_id: Option<i64>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    match folder_id {
        Some(fid) => conn
            .execute(
                "INSERT OR REPLACE INTO playlist_folder_members(playlist_key, folder_id) VALUES(?1, ?2)",
                rusqlite::params![playlist_key, fid],
            )
            .map_err(err)?,
        None => conn
            .execute(
                "DELETE FROM playlist_folder_members WHERE playlist_key = ?1",
                [playlist_key.as_str()],
            )
            .map_err(err)?,
    };
    Ok(())
}

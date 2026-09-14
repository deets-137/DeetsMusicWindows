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
                        (SELECT COUNT(*) FROM local_playlist_tracks t WHERE t.playlist_id = p.id),
                        p.cover, p.exported_apple_id, p.exported_at
                 FROM local_playlists p",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    (
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, u32>(4)?,
                        r.get::<_, Option<String>>(5)?,
                    ),
                    (r.get::<_, Option<String>>(6)?, r.get::<_, Option<i64>>(7)?),
                ))
            })
            .map_err(err)?;
        let rows: Vec<_> = rows.collect::<Result<_, _>>().map_err(err)?;
        for ((id, name, description, created_at, n, cover), (exported_apple_id, exported_at)) in rows {
            let key = format!("local:{id}");
            // Cover precedence (NEXT-VERSION §2): the user's own image (a data URL,
            // no {w}/{h} — `artURL` leaves it alone), else the artwork Apple gave the
            // playlist's exported copy (its mirror row, 2026-09-14), else the mosaic of
            // the first distinct track covers.
            let (artwork, cover_urls) = match cover {
                Some(data) if !data.is_empty() => (
                    Some(crate::model::Artwork { url_template: data, width: 0, height: 0, ..Default::default() }),
                    None,
                ),
                _ => match exported_apple_id.as_deref().and_then(|a| apple_copy_artwork(&conn, a)) {
                    Some(art) => (Some(art), None),
                    None => (None, mosaic_urls(&conn, "local_playlist_tracks", &id.to_string())?),
                },
            };
            out.push(Playlist {
                folder_id: folder_of.get(&key).copied(),
                library_id: Some(key),
                name,
                description,
                artwork,
                cover_urls,
                can_edit: true,
                track_count: Some(n),
                source: Some("local".into()),
                kind: Some("user".into()),
                date_added: chrono::DateTime::from_timestamp_millis(created_at)
                    .map(|d| d.to_rfc3339()),
                exported_apple_id,
                exported_at,
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
            // Apple often omits a playlist's artwork; the mosaic fills in from the
            // content cache once the playlist has been opened (no fetch here).
            if p.artwork.is_none() {
                if let Some(id) = p.library_id.as_deref() {
                    p.cover_urls = mosaic_urls(&conn, "apple_playlist_tracks", id)?;
                }
            }
            out.push(p);
        }
    }
    Ok(out)
}

/// The artwork Apple gave a local playlist's exported copy, read from its mirror row —
/// zero Apple calls. None when the copy is gone from the mirror or Apple sent no artwork.
fn apple_copy_artwork(conn: &Connection, apple_id: &str) -> Option<crate::model::Artwork> {
    let json: String = conn
        .query_row("SELECT json FROM apple_playlists WHERE playlist_id = ?1", [apple_id], |r| r.get(0))
        .ok()?;
    serde_json::from_str::<Playlist>(&json).ok()?.artwork
}

/// The first four DISTINCT track-cover templates of a playlist, in authored order,
/// for the derived mosaic (NEXT-VERSION §2). Reads the local snapshot rows only —
/// zero Apple calls; None when the playlist is empty or its contents are not cached.
fn mosaic_urls(conn: &Connection, table: &str, playlist_id: &str) -> Result<Option<Vec<String>>, String> {
    let sql = format!("SELECT json FROM {table} WHERE playlist_id = ?1 ORDER BY position LIMIT 40");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt.query_map([playlist_id], |r| r.get::<_, String>(0)).map_err(err)?;
    let mut urls: Vec<String> = Vec::new();
    for row in rows {
        let t: Track = match serde_json::from_str(&row.map_err(err)?) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if let Some(u) = t.artwork.map(|a| a.url_template) {
            if !urls.contains(&u) {
                urls.push(u);
                if urls.len() == 4 {
                    break;
                }
            }
        }
    }
    Ok(if urls.is_empty() { None } else { Some(urls) })
}

/// Set (a data URL the front-end already resized) or clear (`None`) a local
/// playlist's own cover. Local only: Apple's API cannot receive a playlist cover.
#[tauri::command]
pub fn playlist_set_cover(id: i64, cover: Option<String>, db: State<'_, Db>) -> Result<(), String> {
    if let Some(c) = &cover {
        if !c.starts_with("data:image/") || c.len() > 2_000_000 {
            return Err("playlist_set_cover: expected an image data URL under 2 MB".into());
        }
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE local_playlists SET cover = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, cover, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

// ── Export to Apple Music (PLAYLISTS.md §6) — create + append, the only Apple writes ──

/// One local or Apple-copy song as export sees it: the catalog id Apple accepts, and
/// the title the front-end names in its toasts.
struct ExportRow {
    catalog_id: String,
    title: String,
}

/// What an export would do, computed before any write so the front-end can ask first
/// when Apple can't copy a removal or an order.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    /// The Apple copy compared against; None when it is gone from the mirror.
    apple_id: Option<String>,
    add_ids: Vec<String>,
    add_titles: Vec<String>,
    removed_titles: Vec<String>,
    reordered: bool,
    /// Local songs with no catalog id (uploads) — Apple can't receive them.
    skipped: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    apple_id: String,
    added: u32,
    failed: u32,
    skipped: u32,
}

/// A local playlist's name, description, and latest Apple copy id.
fn export_head(conn: &Connection, id: i64) -> Result<(String, Option<String>, Option<String>), String> {
    conn.query_row(
        "SELECT name, description, exported_apple_id FROM local_playlists WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .map_err(err)
}

/// The local songs Apple can receive, in authored order, and how many it can't.
fn export_rows(conn: &Connection, id: i64) -> Result<(Vec<ExportRow>, u32), String> {
    let mut stmt = conn
        .prepare("SELECT json FROM local_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
        .map_err(err)?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
    let (mut out, mut skipped) = (Vec::new(), 0u32);
    for row in rows {
        match serde_json::from_str::<Track>(&row.map_err(err)?) {
            Ok(Track { catalog_id: Some(c), title, .. }) if !c.is_empty() => out.push(ExportRow { catalog_id: c, title }),
            _ => skipped += 1,
        }
    }
    Ok((out, skipped))
}

/// Compare the local order with the Apple copy. Duplicates are legal, so ids count as
/// multisets: the first min(local, apple) occurrences of an id are on both sides, the
/// rest of the local ones are additions, the rest of the Apple ones are removals.
/// Returns (local indexes to add, titles only Apple has, whether the order would differ
/// after the append — Apple puts added songs at the end).
fn export_diff<'a>(local: &'a [ExportRow], apple: &'a [ExportRow]) -> (Vec<usize>, Vec<String>, bool) {
    use std::collections::HashMap;
    let count = |rows: &'a [ExportRow]| {
        let mut n: HashMap<&'a str, usize> = HashMap::new();
        for r in rows {
            *n.entry(r.catalog_id.as_str()).or_default() += 1;
        }
        n
    };
    let (local_n, apple_n) = (count(local), count(apple));

    let mut seen: HashMap<&'a str, usize> = HashMap::new();
    let mut add = Vec::new();
    for (i, r) in local.iter().enumerate() {
        let k = seen.entry(r.catalog_id.as_str()).or_default();
        *k += 1;
        if *k > apple_n.get(r.catalog_id.as_str()).copied().unwrap_or(0) {
            add.push(i);
        }
    }
    seen.clear();
    let (mut kept, mut removed): (Vec<&'a str>, Vec<String>) = (Vec::new(), Vec::new());
    for r in apple {
        let k = seen.entry(r.catalog_id.as_str()).or_default();
        *k += 1;
        if *k > local_n.get(r.catalog_id.as_str()).copied().unwrap_or(0) {
            removed.push(r.title.clone());
        } else {
            kept.push(r.catalog_id.as_str());
        }
    }
    let after = kept.into_iter().chain(add.iter().map(|&i| local[i].catalog_id.as_str()));
    let reordered = after.zip(local).any(|(a, l)| a != l.catalog_id);
    (add, removed, reordered)
}

/// POST catalog ids to an Apple library playlist, 100 per call, in order. Returns
/// (added, failed); a failed call is logged and counted, and the rest still go.
async fn append_to_apple(client: &reqwest::Client, dev: &str, user: &str, apple_id: &str, ids: &[String]) -> (u32, u32) {
    let url = format!("https://api.music.apple.com/v1/me/library/playlists/{apple_id}/tracks");
    let (mut added, mut failed) = (0u32, 0u32);
    for chunk in ids.chunks(100) {
        let data: Vec<serde_json::Value> = chunk.iter().map(|c| serde_json::json!({ "id": c, "type": "songs" })).collect();
        let body = serde_json::json!({ "data": data });
        match apple::api_send(client, reqwest::Method::POST, dev, user, &url, Some(&body)).await {
            Ok((s, _)) if (200..300).contains(&s) => added += chunk.len() as u32,
            Ok((s, _)) => {
                failed += chunk.len() as u32;
                crate::log::warn(&format!("playlists: export append {apple_id} HTTP {s}"));
            }
            Err(e) => {
                failed += chunk.len() as u32;
                crate::log::warn(&format!("playlists: export append {apple_id}: {e}"));
            }
        }
    }
    (added, failed)
}

/// Compare a local playlist with its Apple copy (PLAYLISTS.md §6, fork 4A: read the
/// copy, one call per 100 songs). A copy no longer in the mirror is gone (fork 6A —
/// no Apple call to learn it). No writes.
#[tauri::command]
pub async fn playlist_export_plan(
    id: i64,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<ExportPlan, String> {
    let (local, skipped, apple_id) = {
        let conn = db.0.lock().unwrap();
        let (_, _, exported) = export_head(&conn, id)?;
        let (rows, skipped) = export_rows(&conn, id)?;
        let live = exported.filter(|a| {
            conn.query_row("SELECT 1 FROM apple_playlists WHERE playlist_id = ?1", [a.as_str()], |_| Ok(()))
                .is_ok()
        });
        (rows, skipped, live)
    };
    let Some(apple_id) = apple_id else {
        return Ok(ExportPlan { apple_id: None, add_ids: vec![], add_titles: vec![], removed_titles: vec![], reordered: false, skipped });
    };

    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);
    let mut apple_rows: Vec<ExportRow> = Vec::new();
    let mut offset = 0u32;
    for _ in 0..100 {
        let page = provider.playlist_tracks_page(&apple_id, offset, 100).await?;
        apple_rows.extend(page.items.into_iter().filter_map(|t| match t {
            Track { catalog_id: Some(c), title, .. } if !c.is_empty() => Some(ExportRow { catalog_id: c, title }),
            _ => None, // no catalog id: can't match it, and Apple can't remove it anyway
        }));
        match page.next_offset {
            Some(next) if next > offset => offset = next,
            _ => break,
        }
    }

    let (add, removed_titles, reordered) = export_diff(&local, &apple_rows);
    Ok(ExportPlan {
        add_ids: add.iter().map(|&i| local[i].catalog_id.clone()).collect(),
        add_titles: add.iter().map(|&i| local[i].title.clone()).collect(),
        apple_id: Some(apple_id),
        removed_titles,
        reordered,
        skipped,
    })
}

/// Write a local playlist to Apple Music. `mode`:
/// - `"new"`: create a library playlist (name + description — Apple takes no cover),
///   stamp its id at once (a partial failure still leaves a real Apple playlist), then
///   append every song with a catalog id.
/// - `"append"`: send `ids` (from a plan) to the current copy; drop that copy's content
///   cache so its next open shows the new songs.
#[tauri::command]
pub async fn playlist_export_apple(
    id: i64,
    mode: String,
    ids: Option<Vec<String>>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<ExportResult, String> {
    let (name, description, exported, rows, skipped) = {
        let conn = db.0.lock().unwrap();
        let (name, description, exported) = export_head(&conn, id)?;
        let (rows, skipped) = export_rows(&conn, id)?;
        (name, description, exported, rows, skipped)
    };
    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();

    match mode.as_str() {
        "new" => {
            let mut attributes = serde_json::json!({ "name": name });
            if let Some(d) = description.filter(|d| !d.is_empty()) {
                attributes["description"] = d.into();
            }
            let (status, body) = apple::api_send(
                &client,
                reqwest::Method::POST,
                &dev,
                &user,
                "https://api.music.apple.com/v1/me/library/playlists",
                Some(&serde_json::json!({ "attributes": attributes })),
            )
            .await?;
            if !(200..300).contains(&status) {
                return Err(format!("export: create HTTP {status}"));
            }
            // Apple sends this reply gzip-compressed whatever the request asks for; reqwest's
            // `gzip` feature decodes it (2026-09-14 — without it the id was unreadable).
            let Some(apple_id) = body["data"][0]["id"].as_str().map(String::from) else {
                let snippet: String = body.to_string().chars().take(300).collect();
                crate::log::warn(&format!("playlists: export create HTTP {status} returned no id; body {snippet}"));
                return Err("export: created on Apple Music, but its reply had no playlist id".into());
            };
            {
                let conn = db.0.lock().unwrap();
                conn.execute(
                    "UPDATE local_playlists SET exported_apple_id = ?2, exported_at = ?3 WHERE id = ?1",
                    rusqlite::params![id, apple_id, now_ms()],
                )
                .map_err(err)?;
            }
            let ids: Vec<String> = rows.into_iter().map(|r| r.catalog_id).collect();
            let (added, failed) = append_to_apple(&client, &dev, &user, &apple_id, &ids).await;
            crate::log::info(&format!(
                "playlists: exported local:{id} → {apple_id}, {added} added, {failed} failed, {skipped} skipped"
            ));
            Ok(ExportResult { apple_id, added, failed, skipped })
        }
        "append" => {
            let apple_id = exported.ok_or("export: this playlist has no Apple copy")?;
            let ids = ids.unwrap_or_default();
            let (added, failed) = append_to_apple(&client, &dev, &user, &apple_id, &ids).await;
            if added == 0 && failed > 0 {
                return Err(format!("export: append to {apple_id} failed"));
            }
            {
                let conn = db.0.lock().unwrap();
                conn.execute(
                    "UPDATE local_playlists SET exported_at = ?2 WHERE id = ?1",
                    rusqlite::params![id, now_ms()],
                )
                .map_err(err)?;
                conn.execute("DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1", [apple_id.as_str()])
                    .map_err(err)?;
            }
            crate::log::info(&format!("playlists: appended local:{id} → {apple_id}, {added} added, {failed} failed"));
            Ok(ExportResult { apple_id, added, failed, skipped: 0 })
        }
        _ => Err(format!("playlist_export_apple: bad mode '{mode}'")),
    }
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
    crate::log::info(&format!("playlists: mirror synced, {} playlist(s)", all.len()));
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
            Err(e) => crate::log::warn(&format!("playlists: count backfill {id}: {e}")),
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
        // Apple's generated Favorite Songs list is the only list-all of ♥ we get:
        // seed the favorites mirror from it (favorites.rs), same transaction.
        if crate::favorites::is_favorite_songs(&p) {
            let n = crate::favorites::seed_from_playlist(&tx, &all)?;
            crate::log::info(&format!("favorites: seeded {n} from Favorite Songs"));
        }
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

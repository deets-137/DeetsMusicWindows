//! Playlists — the local-first store + the read-only Apple mirror (docs/features/PLAYLISTS.md).
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

use crate::lock::LockExt;
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
pub async fn playlists_cached(app: tauri::AppHandle) -> Result<Vec<Playlist>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut out: Vec<Playlist> = Vec::new();

        // Folder membership, stamped onto both sources below (never baked into the
        // cached json — this read is the one source of folder truth).
        let folder_of: std::collections::HashMap<String, i64> = {
            let mut stmt = conn
                .prepare_cached("SELECT playlist_key, folder_id FROM playlist_folder_members")
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
            // `cover_at` only, never the cover itself: the image is served by its own link.
            let mut stmt = conn
                .prepare_cached(
                    "SELECT p.id, p.name, p.description, p.created_at,
                            (SELECT COUNT(*) FROM local_playlist_tracks t WHERE t.playlist_id = p.id),
                            CASE WHEN p.cover IS NOT NULL AND p.cover != '' THEN COALESCE(p.cover_at, p.updated_at) END,
                            p.exported_apple_id, p.exported_at, p.role,
                            p.expire_days, (SELECT MAX(e.started_ts) FROM play_events e
                                            WHERE p.expire_days IS NOT NULL AND e.context = 'playlist:local:' || p.id)
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
                            r.get::<_, Option<i64>>(5)?,
                        ),
                        (r.get::<_, Option<String>>(6)?, r.get::<_, Option<i64>>(7)?, r.get::<_, Option<String>>(8)?),
                        (r.get::<_, Option<u32>>(9)?, r.get::<_, Option<i64>>(10)?),
                    ))
                })
                .map_err(err)?;
            let rows: Vec<_> = rows.collect::<Result<_, _>>().map_err(err)?;
            for ((id, name, description, created_at, n, cover_at), (exported_apple_id, exported_at, role), (expire_days, last_play)) in rows {
                let key = format!("local:{id}");
                // Cover precedence (NEXT-VERSION §2): the user's own image (a cover:// link,
                // no {w}/{h} — `artURL` leaves it alone; `v` changes with the cover, so the
                // webview cache never shows an old one), else the artwork Apple gave the
                // playlist's exported copy (its mirror row, 2026-09-14), else the mosaic of
                // the first distinct track covers.
                let (artwork, cover_urls) = match cover_at {
                    Some(v) => (
                        Some(crate::model::Artwork { url_template: cover_link(id, v), width: 0, height: 0, ..Default::default() }),
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
                    role,
                    expire_days,
                    expires_at: expire_days.map(|d| expires_at(created_at, last_play, d)),
                    ..Default::default()
                });
            }
        }

        // Apple mirror rows, in Apple's order (the front-end sorts client-side).
        {
            let mut stmt = conn
                .prepare_cached("SELECT json FROM apple_playlists ORDER BY position")
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
    })
    .await
}

/// A temporary playlist's delete time (PLAYLIST-WEB.md §10): the later of its creation and
/// its last play, plus its days.
fn expires_at(created_at: i64, last_play: Option<i64>, days: u32) -> i64 {
    created_at.max(last_play.unwrap_or(0)) + days as i64 * 24 * 60 * 60 * 1000
}

/// The artwork Apple gave a local playlist's exported copy, read from its mirror row —
/// zero Apple calls. None when the copy is gone from the mirror or Apple sent no artwork.
fn apple_copy_artwork(conn: &Connection, apple_id: &str) -> Option<crate::model::Artwork> {
    let json: String = conn
        .query_row("SELECT json FROM apple_playlists WHERE playlist_id = ?1", [apple_id], |r| r.get(0))
        .ok()?;
    serde_json::from_str::<Playlist>(&json).ok()?.artwork
}

/// The most covers a derived mosaic draws (mosaic.ts `MOSAIC_MAX`).
const MOSAIC_MAX: i64 = 100;

/// Up to MOSAIC_MAX DISTINCT track-cover templates of a playlist, by first appearance in
/// authored order, for the derived mosaic (PLAYLISTS.md §11). SQLite reads the one JSON
/// field itself, so a long playlist costs no Rust parsing. Local snapshot rows only —
/// zero Apple calls; None when the playlist is empty or its contents are not cached.
fn mosaic_urls(conn: &Connection, table: &str, playlist_id: &str) -> Result<Option<Vec<String>>, String> {
    let sql = format!(
        "SELECT u FROM (SELECT json_extract(json, '$.artwork.urlTemplate') AS u, MIN(position) AS p
           FROM {table} WHERE playlist_id = ?1 GROUP BY u)
         WHERE u IS NOT NULL ORDER BY p LIMIT {MOSAIC_MAX}"
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let urls = stmt
        .query_map([playlist_id], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(if urls.is_empty() { None } else { Some(urls) })
}

/// The link a local playlist's own cover is served at (lib.rs registers the `cover`
/// scheme; on Windows WebView2 reaches a custom scheme as `http://<scheme>.localhost`).
fn cover_link(id: i64, version: i64) -> String {
    format!("http://cover.localhost/{id}?v={version}")
}

/// Answer a `cover.localhost` request: `/<rowid>` → the stored image bytes. The `v`
/// query only busts the webview cache, so the reply can be cached for good.
pub fn cover_response<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) -> tauri::http::Response<Vec<u8>> {
    use base64::Engine;
    use tauri::Manager;
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let Ok(id) = path.trim_start_matches('/').parse::<i64>() else { return not_found() };
    let Some(db) = app.try_state::<Db>() else { return not_found() };
    let data: Option<String> = {
        let conn = db.lock();
        conn.query_row("SELECT cover FROM local_playlists WHERE id = ?1", [id], |r| r.get(0))
            .ok()
            .flatten()
    };
    // "data:image/jpeg;base64,<payload>"
    let parsed = data.as_deref().and_then(|d| {
        let (head, payload) = d.strip_prefix("data:")?.split_once(',')?;
        let mime = head.strip_suffix(";base64")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(payload).ok()?;
        Some((mime.to_string(), bytes))
    });
    let Some((mime, bytes)) = parsed else { return not_found() };
    tauri::http::Response::builder()
        .header("Content-Type", mime)
        .header("Cache-Control", "max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}

/// Set (a data URL the front-end already resized) or clear (`None`) a local
/// playlist's own cover. Local only: Apple's API cannot receive a playlist cover.
#[tauri::command]
pub async fn playlist_set_cover(id: i64, cover: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        if let Some(c) = &cover {
            if !c.starts_with("data:image/") || c.len() > 2_000_000 {
                return Err("playlist_set_cover: expected an image data URL under 2 MB".into());
            }
        }
        let conn = db.lock();
        let now = now_ms();
        conn.execute(
            "UPDATE local_playlists SET cover = ?2, cover_at = ?3, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, cover, now],
        )
        .map_err(err)?;
        Ok(())
    })
    .await
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
    /// Titles of the local songs with no catalog id (uploads) — Apple can't receive them.
    skipped_titles: Vec<String>,
    /// The Apple copy's catalog ids as read, in Apple's order. The append hands them back, so
    /// the sync baseline after a Send is this list plus what was sent (§12), with no new read.
    apple_ids: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    apple_id: String,
    added: u32,
    failed: u32,
    skipped_titles: Vec<String>,
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

/// The local songs Apple can receive, in authored order, and the titles of the ones it
/// can't (no catalog id: an upload). The toasts name those songs (§10.5).
fn export_rows(conn: &Connection, id: i64) -> Result<(Vec<ExportRow>, Vec<String>), String> {
    let mut stmt = conn
        .prepare_cached("SELECT json FROM local_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
        .map_err(err)?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
    let (mut out, mut skipped) = (Vec::new(), Vec::new());
    for row in rows {
        match serde_json::from_str::<Track>(&row.map_err(err)?) {
            Ok(Track { catalog_id: Some(c), title, .. }) if !c.is_empty() => out.push(ExportRow { catalog_id: c, title }),
            Ok(t) => skipped.push(t.title),
            Err(_) => skipped.push("Unknown song".into()),
        }
    }
    Ok((out, skipped))
}

/// The local playlist's Apple copy while it is still in the mirror (fork 6A — no Apple
/// call to learn it); None when it never had one or the copy is gone.
fn live_copy(conn: &Connection, id: i64) -> Result<Option<String>, String> {
    let (_, _, exported) = export_head(conn, id)?;
    Ok(exported.filter(|a| {
        conn.query_row("SELECT 1 FROM apple_playlists WHERE playlist_id = ?1", [a.as_str()], |_| Ok(()))
            .is_ok()
    }))
}

/// Every song on an Apple library playlist, authored order. One Apple read per 100 songs.
async fn fetch_apple_tracks(provider: &AppleProvider, apple_id: &str) -> Result<Vec<Track>, String> {
    let mut all = Vec::new();
    let mut offset = 0u32;
    for _ in 0..100 {
        let page = provider.playlist_tracks_page(apple_id, offset, 100).await?;
        all.extend(page.items);
        match page.next_offset {
            Some(next) if next > offset => offset = next,
            _ => break,
        }
    }
    Ok(all)
}

/// Replace a mirror's content cache with `all`, teach the overview row its count, and
/// seed the favorites mirror when this is Apple's Favorite Songs. One transaction, shared
/// by the first open (`apple_playlist_tracks`) and by a refresh (`playlist_refetch`) so the
/// two paths can never write the cache differently.
fn store_tracks(conn: &mut Connection, id: &str, all: &[Track]) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1", [id])
        .map_err(err)?;
    {
        let mut ins = tx
            .prepare_cached("INSERT INTO apple_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)")
            .map_err(err)?;
        for (i, t) in all.iter().enumerate() {
            let json = serde_json::to_string(t).map_err(err)?;
            ins.execute(rusqlite::params![id, i as i64, json]).map_err(err)?;
        }
    }
    // Teach the overview row its real count.
    let row: Option<String> = tx
        .query_row("SELECT json FROM apple_playlists WHERE playlist_id = ?1", [id], |r| r.get(0))
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
            let n = crate::favorites::seed_from_playlist(&tx, all)?;
            crate::log::info(&format!("favorites: seeded {n} from Favorite Songs"));
        }
    }
    tx.commit().map_err(err)
}

/// The songs export can match: those with a catalog id. Rows without one can't be
/// matched, and Apple can't remove them anyway.
fn matchable(tracks: &[Track]) -> Vec<(usize, ExportRow)> {
    tracks
        .iter()
        .enumerate()
        .filter_map(|(i, t)| match &t.catalog_id {
            Some(c) if !c.is_empty() => Some((i, ExportRow { catalog_id: c.clone(), title: t.title.clone() })),
            _ => None,
        })
        .collect()
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

// ── The sync baseline (PLAYLISTS.md §12) ─────────────────────────────────────────────
//
// What the Apple copy held the last time DeetsMusic and it agreed: the catalog ids, as a
// multiset, in Apple's order. Saved at every point of agreement (import, export, Make a New
// Copy, Send, Get, Match). Settings › Apple Music › "Get songs from Apple copy" › Only new
// reads it: new = Apple now minus the baseline, so a song removed here on purpose stays out.
// Keyed by the LOCAL playlist; the Apple id is stored too, so a baseline taken from an older
// copy (before Make a New Copy) is never read against the new one. Zero Apple calls: every
// save rides a read or a write that happens anyway.

/// v17 (2026-09-29): the `playlist_apple_baseline` table. `ids` is a JSON array of catalog ids.
pub fn migrate_v17(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS playlist_apple_baseline (
            playlist_id INTEGER PRIMARY KEY,
            apple_id    TEXT NOT NULL,
            ids         TEXT NOT NULL,
            saved_at    INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("create playlist_apple_baseline: {e}"))?;
    crate::library::meta_set(conn, "schema_version", "17")
}

/// The baseline taken from this Apple copy, or None (never saved, or saved from another copy).
fn baseline_get(conn: &Connection, id: i64, apple_id: &str) -> Option<Vec<String>> {
    let (from, ids): (String, String) = conn
        .query_row("SELECT apple_id, ids FROM playlist_apple_baseline WHERE playlist_id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .ok()?;
    if from != apple_id {
        return None;
    }
    serde_json::from_str(&ids).ok()
}

/// The stored baseline whatever copy it came from: what a Match holds for its Undo.
fn baseline_raw(conn: &Connection, id: i64) -> Option<(String, Vec<String>)> {
    let (from, ids): (String, String) = conn
        .query_row("SELECT apple_id, ids FROM playlist_apple_baseline WHERE playlist_id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .ok()?;
    Some((from, serde_json::from_str(&ids).ok()?))
}

fn baseline_set(conn: &Connection, id: i64, apple_id: &str, ids: &[String]) -> Result<(), String> {
    conn.execute(
        "INSERT INTO playlist_apple_baseline(playlist_id, apple_id, ids, saved_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(playlist_id) DO UPDATE SET apple_id = ?2, ids = ?3, saved_at = ?4",
        rusqlite::params![id, apple_id, serde_json::to_string(ids).map_err(err)?, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

/// Only new (PLAYLISTS.md §12): the Apple rows that are new since the baseline, and that the
/// local playlist does not already hold. Multisets, first occurrences first: an id twice on
/// Apple and once in the baseline is new once. The local check keeps a song added on both
/// sides by hand from landing twice. Returns indexes into `apple`, in Apple's order.
fn new_since(apple: &[ExportRow], baseline: &[String], local: &[ExportRow]) -> Vec<usize> {
    use std::collections::HashMap;
    let mut base: HashMap<&str, usize> = HashMap::new();
    for b in baseline {
        *base.entry(b.as_str()).or_default() += 1;
    }
    let mut held: HashMap<&str, usize> = HashMap::new();
    for l in local {
        *held.entry(l.catalog_id.as_str()).or_default() += 1;
    }
    let mut out = Vec::new();
    for (i, r) in apple.iter().enumerate() {
        let id = r.catalog_id.as_str();
        if let Some(n) = base.get_mut(id).filter(|n| **n > 0) {
            *n -= 1;
            continue;
        }
        if let Some(n) = held.get_mut(id).filter(|n| **n > 0) {
            *n -= 1;
            continue;
        }
        out.push(i);
    }
    out
}

/// Match the Apple copy (PLAYLISTS.md §12): what making the local playlist the Apple copy
/// changes, by `track_key` (a catalog id, else a library id, else title + artist) as
/// multisets. Returns (songs added, songs removed, whether the two lists are the same list).
fn match_counts(local: &[String], apple: &[String]) -> (u32, u32, bool) {
    use std::collections::HashMap;
    let mut n: HashMap<&str, i64> = HashMap::new();
    for k in apple {
        *n.entry(k.as_str()).or_default() += 1;
    }
    for k in local {
        *n.entry(k.as_str()).or_default() -= 1;
    }
    let added = n.values().filter(|v| **v > 0).map(|v| *v as u32).sum();
    let removed = n.values().filter(|v| **v < 0).map(|v| (-*v) as u32).sum();
    (added, removed, local == apple)
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
    let (local, skipped_titles, apple_id) = {
        let conn = db.lock();
        let (rows, skipped) = export_rows(&conn, id)?;
        (rows, skipped, live_copy(&conn, id)?)
    };
    let Some(apple_id) = apple_id else {
        return Ok(ExportPlan { apple_id: None, add_ids: vec![], add_titles: vec![], removed_titles: vec![], reordered: false, skipped_titles, apple_ids: vec![] });
    };

    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);
    let apple_tracks = fetch_apple_tracks(&provider, &apple_id).await?;
    let apple_rows: Vec<ExportRow> = matchable(&apple_tracks).into_iter().map(|(_, r)| r).collect();

    let (add, removed_titles, reordered) = export_diff(&local, &apple_rows);
    Ok(ExportPlan {
        add_ids: add.iter().map(|&i| local[i].catalog_id.clone()).collect(),
        add_titles: add.iter().map(|&i| local[i].title.clone()).collect(),
        apple_id: Some(apple_id),
        removed_titles,
        reordered,
        skipped_titles,
        apple_ids: apple_rows.into_iter().map(|r| r.catalog_id).collect(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSongsResult {
    /// The Apple copy read; None when it is gone from the mirror (nothing was read).
    apple_id: Option<String>,
    /// Titles of the songs added to the end of the local playlist, in Apple's order.
    added_titles: Vec<String>,
    /// The songs themselves, only under `dry_run` (PLAYLIST-REFRESH.md §5.1). They ride
    /// the offer toast's own closure, so pressing [Get them] writes what was already read
    /// and the whole gesture costs ONE Apple read whether or not it is pressed.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tracks: Vec<Track>,
    /// Only under `dry_run`: the Apple copy's catalog ids as read. [Get them] hands them back,
    /// so the offer's write saves the sync baseline with no second read (§12).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    apple_ids: Vec<String>,
}

/// Get New Songs (PLAYLISTS.md §10.4, fork A): add the songs that are on the Apple copy but
/// not in the local playlist, at the end. `export_diff` with the sides swapped — the extra
/// Apple occurrences are the additions. Matched by catalog id. Nothing local is removed or
/// moved, so there is no confirm. One Apple read per 100 songs; the write is local only.
///
/// `since_sync` (Settings › Apple Music › Get songs from Apple copy › Only new, §12): add only
/// the songs that are new on the Apple copy since the saved baseline, so a song removed here
/// on purpose stays out. With no baseline for this copy yet, it falls back to the missing
/// songs once. Either way a real Get saves the baseline: the two sides agree now.
///
/// `dry_run` (PLAYLIST-REFRESH.md D9) reads and DOES NOT WRITE: the automatic refresh peeks,
/// then offers. "Re-read a cache" and "silently add songs to my playlist" are different
/// promises, and only the first is safe to make while nobody is watching.
#[tauri::command]
pub async fn playlist_get_apple_songs(
    id: i64,
    dry_run: Option<bool>,
    since_sync: Option<bool>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<GetSongsResult, String> {
    let dry = dry_run.unwrap_or(false);
    let (local, apple_id) = {
        let conn = db.lock();
        let (rows, _) = export_rows(&conn, id)?;
        (rows, live_copy(&conn, id)?)
    };
    let Some(apple_id) = apple_id else {
        return Ok(GetSongsResult { apple_id: None, added_titles: vec![], tracks: vec![], apple_ids: vec![] });
    };

    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);
    let apple_tracks = fetch_apple_tracks(&provider, &apple_id).await?;
    let (index, apple_rows): (Vec<usize>, Vec<ExportRow>) = matchable(&apple_tracks).into_iter().unzip();

    let baseline = if since_sync.unwrap_or(false) { baseline_get(&db.lock(), id, &apple_id) } else { None };
    let add = match &baseline {
        Some(base) => new_since(&apple_rows, base, &local),
        None => export_diff(&apple_rows, &local).0,
    };
    let tracks: Vec<Track> = add.iter().map(|&i| apple_tracks[index[i]].clone()).collect();
    let apple_ids: Vec<String> = apple_rows.into_iter().map(|r| r.catalog_id).collect();
    if dry {
        crate::log::info(&format!(
            "playlists: peeked {} new song(s) on {apple_id} for local:{id} ({})",
            tracks.len(),
            if baseline.is_some() { "since sync" } else { "missing" }
        ));
        return Ok(GetSongsResult {
            apple_id: Some(apple_id),
            added_titles: tracks.iter().map(|t| t.title.clone()).collect(),
            tracks,
            apple_ids,
        });
    }
    {
        let mut conn = db.lock();
        let tx = conn.transaction().map_err(err)?;
        if !tracks.is_empty() {
            append_in(&tx, id, &tracks)?;
        }
        baseline_set(&tx, id, &apple_id, &apple_ids)?;
        tx.commit().map_err(err)?;
    }
    crate::log::info(&format!(
        "playlists: got {} song(s) from {apple_id} into local:{id} ({})",
        tracks.len(),
        if baseline.is_some() { "since sync" } else { "missing" }
    ));
    Ok(GetSongsResult {
        apple_id: Some(apple_id),
        added_titles: tracks.into_iter().map(|t| t.title).collect(),
        tracks: vec![],
        apple_ids: vec![],
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchPlan {
    /// The Apple copy read; None when it is gone from the mirror (nothing was read).
    apple_id: Option<String>,
    /// Songs the match puts in, and songs it takes out (multisets, `track_key`).
    added: u32,
    removed: u32,
    /// The local playlist already is the Apple copy: same songs, same order.
    same: bool,
    /// The Apple copy's songs in Apple's order. The confirm's [Match] hands them back, so the
    /// write costs no second read.
    tracks: Vec<Track>,
}

/// Match the Apple Copy, step 1 (PLAYLISTS.md §12): read the Apple copy (one read per 100
/// songs) and count what the match would change, for the confirm. Writes nothing, except the
/// sync baseline when the two are already the same list (they agree, so it is a sync point).
#[tauri::command]
pub async fn playlist_match_plan(
    id: i64,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<MatchPlan, String> {
    let (local, apple_id) = {
        let conn = db.lock();
        let local: Vec<String> = read_local_tracks(&conn, id)?
            .iter()
            .map(|j| serde_json::from_str::<Track>(j).map(|t| track_key(&t)).unwrap_or_else(|_| j.clone()))
            .collect();
        (local, live_copy(&conn, id)?)
    };
    let Some(apple_id) = apple_id else {
        return Ok(MatchPlan { apple_id: None, added: 0, removed: 0, same: false, tracks: vec![] });
    };
    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);
    // A pre-release song stays out, as append_local keeps it out; the counts say the same.
    let tracks: Vec<Track> = fetch_apple_tracks(&provider, &apple_id).await?.into_iter().filter(|t| !t.unreleased).collect();
    let apple: Vec<String> = tracks.iter().map(track_key).collect();
    let (added, removed, same) = match_counts(&local, &apple);
    if same {
        let ids: Vec<String> = matchable(&tracks).into_iter().map(|(_, r)| r.catalog_id).collect();
        baseline_set(&db.lock(), id, &apple_id, &ids)?;
    }
    crate::log::info(&format!("playlists: match plan local:{id} ← {apple_id}: +{added} −{removed}, same {same}"));
    Ok(MatchPlan { apple_id: Some(apple_id), added, removed, same, tracks })
}

/// What a match replaced, whole: its Undo puts it back.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchUndo {
    /// The local rows as they were (the stored Track json, untouched).
    rows: Vec<String>,
    /// The baseline as it was: (Apple id, catalog ids), or None when there was none.
    baseline: Option<(String, Vec<String>)>,
}

/// Match the Apple Copy, step 2: the local playlist becomes `tracks` (the plan's read), same
/// songs, same order, and the baseline becomes those songs. One transaction. Returns what it
/// replaced, for Undo. Zero Apple calls.
#[tauri::command]
pub async fn playlist_match_apply(id: i64, apple_id: String, tracks: Vec<Track>, app: tauri::AppHandle) -> Result<MatchUndo, String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let rows = read_local_tracks(&conn, id)?;
        let baseline = baseline_raw(&conn, id);
        let jsons = tracks
            .iter()
            .filter(|t| !t.unreleased)
            .map(|t| serde_json::to_string(t).map_err(err))
            .collect::<Result<Vec<_>, _>>()?;
        let ids: Vec<String> = matchable(&tracks).into_iter().map(|(_, r)| r.catalog_id).collect();
        let tx = conn.transaction().map_err(err)?;
        write_local_tracks(&tx, id, &jsons)?;
        baseline_set(&tx, id, &apple_id, &ids)?;
        touch_playlist(&tx, id)?;
        tx.commit().map_err(err)?;
        crate::log::info(&format!("playlists: matched local:{id} to {apple_id}, {} → {} song(s)", rows.len(), jsons.len()));
        Ok(MatchUndo { rows, baseline })
    })
    .await
}

/// Undo a match: the old rows and the old baseline, back in one transaction.
#[tauri::command]
pub async fn playlist_match_undo(id: i64, undo: MatchUndo, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let tx = conn.transaction().map_err(err)?;
        write_local_tracks(&tx, id, &undo.rows)?;
        match &undo.baseline {
            Some((apple_id, ids)) => baseline_set(&tx, id, apple_id, ids)?,
            None => {
                tx.execute("DELETE FROM playlist_apple_baseline WHERE playlist_id = ?1", [id]).map_err(err)?;
            }
        }
        touch_playlist(&tx, id)?;
        tx.commit().map_err(err)?;
        crate::log::info(&format!("playlists: undid the match on local:{id}, {} song(s) back", undo.rows.len()));
        Ok(())
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// The new local playlist's rowid.
    id: i64,
    /// True when the copy took the original as its Apple copy (the user's own playlist).
    linked: bool,
}

/// Import to edit (PLAYLISTS.md §10.9): copy a mirror playlist into a new local playlist.
/// The user's own Apple playlist (`canEdit`) becomes the copy's Apple copy
/// (`exported_apple_id`), so the list shows one row and Send / Get New Songs work at once.
/// An Apple-made playlist (mix, editorial, smart) can't receive songs, so its copy is not
/// linked. The copy joins the original's folder. Songs come from the content cache when
/// the playlist was opened before (zero Apple calls), else one read per 100 songs.
#[tauri::command]
pub async fn playlist_import(
    apple_id: String,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<ImportResult, String> {
    let head: Playlist = {
        let conn = db.lock();
        let json: String = conn
            .query_row("SELECT json FROM apple_playlists WHERE playlist_id = ?1", [apple_id.as_str()], |r| r.get(0))
            .map_err(|_| format!("playlist_import: {apple_id} is not in the Apple mirror"))?;
        serde_json::from_str(&json).map_err(err)?
    };
    let tracks = apple_playlist_tracks(apple_id.clone(), apple_state, db.clone()).await?;

    let linked = head.can_edit;
    let mut conn = db.lock();
    let now = now_ms();
    // One transaction (2026-09-29): the playlist, its folder and its songs land together, or
    // nothing does. Three separate writes left an empty copy behind when the third failed.
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO local_playlists(name, description, created_at, updated_at, exported_apple_id) VALUES(?1, ?2, ?3, ?3, ?4)",
        rusqlite::params![head.name, head.description, now, linked.then(|| apple_id.clone())],
    )
    .map_err(err)?;
    let id = tx.last_insert_rowid();
    // The hidden original keeps its own membership, so it lists in place if the copy is deleted.
    tx.execute(
        "INSERT OR IGNORE INTO playlist_folder_members(playlist_key, folder_id)
         SELECT ?1, folder_id FROM playlist_folder_members WHERE playlist_key = ?2",
        rusqlite::params![format!("local:{id}"), apple_id],
    )
    .map_err(err)?;
    append_in(&tx, id, &tracks)?;
    // A linked copy starts in agreement with its original: the first sync baseline (§12).
    if linked {
        let ids: Vec<String> = matchable(&tracks).into_iter().map(|(_, r)| r.catalog_id).collect();
        baseline_set(&tx, id, &apple_id, &ids)?;
    }
    tx.commit().map_err(err)?;
    crate::log::info(&format!("playlists: imported {apple_id} → local:{id}, {} song(s), linked {linked}", tracks.len()));
    Ok(ImportResult { id, linked })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleAddResult {
    added: u32,
    failed: u32,
    /// Titles of the songs with no catalog id (uploads): Apple can't receive them.
    skipped_titles: Vec<String>,
}

/// Add songs straight to the user's own Apple playlist (PLAYLISTS.md §10.9). Only a mirror
/// row with `canEdit` accepts them. Apple appends at the end and nothing here can remove
/// them afterwards (the front-end asks once, first). Drops the playlist's content cache so
/// its next open shows the new songs, and raises its count by the songs added.
#[tauri::command]
pub async fn apple_playlist_add(
    apple_id: String,
    tracks: Vec<Track>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<AppleAddResult, String> {
    let can_edit = {
        let conn = db.lock();
        conn.query_row("SELECT json FROM apple_playlists WHERE playlist_id = ?1", [apple_id.as_str()], |r| r.get::<_, String>(0))
            .ok()
            .and_then(|j| serde_json::from_str::<Playlist>(&j).ok())
            .is_some_and(|p| p.can_edit)
    };
    if !can_edit {
        return Err(format!("apple_playlist_add: {apple_id} is not an editable Apple playlist"));
    }
    let (mut ids, mut skipped_titles) = (Vec::new(), Vec::new());
    for t in tracks.iter().filter(|t| !t.unreleased) {
        // Apple refuses a song it does not play yet; leave it out quietly, as append_local.
        match &t.catalog_id {
            Some(c) if !c.is_empty() => ids.push(c.clone()),
            _ => skipped_titles.push(t.title.clone()),
        }
    }
    if ids.is_empty() {
        return Ok(AppleAddResult { added: 0, failed: 0, skipped_titles });
    }

    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let (added, failed) = append_to_apple(&client, &dev, &user, &apple_id, &ids).await;
    if added == 0 {
        return Err(format!("apple_playlist_add: append to {apple_id} failed"));
    }
    {
        let conn = db.lock();
        conn.execute("DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1", [apple_id.as_str()])
            .map_err(err)?;
        let row: Option<String> = conn
            .query_row("SELECT json FROM apple_playlists WHERE playlist_id = ?1", [apple_id.as_str()], |r| r.get(0))
            .ok();
        if let Some(mut p) = row.and_then(|s| serde_json::from_str::<Playlist>(&s).ok()) {
            if let Some(n) = p.track_count {
                p.track_count = Some(n + added);
                conn.execute(
                    "UPDATE apple_playlists SET json = ?2 WHERE playlist_id = ?1",
                    rusqlite::params![apple_id, serde_json::to_string(&p).map_err(err)?],
                )
                .map_err(err)?;
            }
        }
    }
    crate::log::info(&format!("playlists: added to {apple_id}, {added} added, {failed} failed, {} skipped", skipped_titles.len()));
    Ok(AppleAddResult { added, failed, skipped_titles })
}

/// Put a just-created Apple copy into the mirror from Apple's create reply (a
/// library-playlists resource). A reply without attributes still gets a usable row: the
/// local name, the user's own kind, and the songs just added.
fn seed_created_copy(conn: &Connection, apple_id: &str, resource: &serde_json::Value, name: &str, songs: u32) -> Result<(), String> {
    let mut p = if resource["attributes"].is_object() { apple::playlist_from_library(resource) } else { Playlist::default() };
    p.library_id = Some(apple_id.to_string());
    if p.name.is_empty() {
        p.name = name.to_string();
    }
    p.can_edit = true; // DeetsMusic just made it in the user's library
    p.source = Some("apple".into());
    p.kind = Some("user".into());
    p.track_count = Some(songs);
    let pos: i64 = conn
        .query_row("SELECT COALESCE(MAX(position) + 1, 0) FROM apple_playlists", [], |r| r.get(0))
        .map_err(err)?;
    conn.execute(
        "INSERT OR REPLACE INTO apple_playlists(playlist_id, position, json) VALUES(?1, ?2, ?3)",
        rusqlite::params![apple_id, pos, serde_json::to_string(&p).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

/// Write a local playlist to Apple Music. `mode`:
/// - `"new"`: create a library playlist (name + description — Apple takes no cover),
///   stamp its id at once (a partial failure still leaves a real Apple playlist), then
///   append every song with a catalog id.
/// - `"append"`: send `ids` (from a plan) to the current copy; drop that copy's content
///   cache so its next open shows the new songs. `base` is the plan's `apple_ids`: with it,
///   the sync baseline is saved (§12).
#[tauri::command]
pub async fn playlist_export_apple(
    id: i64,
    mode: String,
    ids: Option<Vec<String>>,
    base: Option<Vec<String>>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<ExportResult, String> {
    let (name, description, exported, rows, skipped) = {
        let conn = db.lock();
        let (name, description, exported) = export_head(&conn, id)?;
        let (rows, skipped) = export_rows(&conn, id)?;
        (name, description, exported, rows, skipped)
    };
    let dev = apple::developer_token()?;
    let user = apple_state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();

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
                let conn = db.lock();
                conn.execute(
                    // An exported playlist is kept: its Apple copy cannot be deleted (PLAYLIST-WEB.md §10.3).
                    "UPDATE local_playlists SET exported_apple_id = ?2, exported_at = ?3, expire_days = NULL WHERE id = ?1",
                    rusqlite::params![id, apple_id, now_ms()],
                )
                .map_err(err)?;
            }
            let ids: Vec<String> = rows.into_iter().map(|r| r.catalog_id).collect();
            let (added, failed) = append_to_apple(&client, &dev, &user, &apple_id, &ids).await;
            // Apple lists a new playlist a few seconds after the create (2026-09-14: the sync
            // 0.8 s later still returned the old list, so the copy looked gone — no sigil, and
            // Apple Music ▸ offered Export again). Seed the mirror from the create reply now:
            // the copy is live at once, with zero extra Apple calls.
            {
                let conn = db.lock();
                seed_created_copy(&conn, &apple_id, &body["data"][0], &name, added)?;
                // The new copy holds what was sent: the first sync baseline for it (§12). A
                // song whose call failed is not on Apple, so it can never read as new there.
                baseline_set(&conn, id, &apple_id, &ids)?;
            }
            crate::log::info(&format!(
                "playlists: exported local:{id} → {apple_id}, {added} added, {failed} failed, {} skipped",
                skipped.len()
            ));
            Ok(ExportResult { apple_id, added, failed, skipped_titles: skipped })
        }
        "append" => {
            let apple_id = exported.ok_or("export: this playlist has no Apple copy")?;
            let ids = ids.unwrap_or_default();
            let (added, failed) = append_to_apple(&client, &dev, &user, &apple_id, &ids).await;
            if added == 0 && failed > 0 {
                return Err(format!("export: append to {apple_id} failed"));
            }
            {
                let conn = db.lock();
                conn.execute(
                    "UPDATE local_playlists SET exported_at = ?2 WHERE id = ?1",
                    rusqlite::params![id, now_ms()],
                )
                .map_err(err)?;
                conn.execute("DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1", [apple_id.as_str()])
                    .map_err(err)?;
                // The sync baseline (§12): the copy as the plan read it, plus what was sent.
                // After a partial failure the read alone; the songs that did go are in the
                // local playlist, so Only new never adds them twice.
                if let Some(mut base) = base {
                    if failed == 0 {
                        base.extend(ids.iter().cloned());
                    }
                    baseline_set(&conn, id, &apple_id, &base)?;
                }
            }
            crate::log::info(&format!("playlists: appended local:{id} → {apple_id}, {added} added, {failed} failed"));
            Ok(ExportResult { apple_id, added, failed, skipped_titles: vec![] })
        }
        _ => Err(format!("playlist_export_apple: bad mode '{mode}'")),
    }
}

// ── Apple mirror sync (read-in; stale-while-revalidate like songs) ─────────────

/// How long a sync keeps a just-exported copy that Apple's list doesn't show yet. Apple
/// caught up within 16 s on 2026-09-14; 30 s is about twice that (the user's call). A copy
/// deleted in the Music app inside this window looks live until the window ends.
const EXPORT_LIST_LAG_MS: i64 = 30 * 1000;

/// Refresh the flat mirror list from Apple. `fresh: false` (the once-per-session
/// auto-sync) keeps the content caches of unchanged playlists; `fresh: true` (the
/// explicit ⟳) drops them all, so every next open refetches current contents.
///
/// `fresh: false` is a background job (APPLE-CALLS.md §3): it skips its turn while Apple's
/// back-off holds. The ⟳ is the user's and always goes out.
#[tauri::command]
pub async fn apple_playlists_sync(
    fresh: bool,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    if fresh {
        return apple_playlists_sync_run(fresh, apple_state, db).await;
    }
    if crate::apple_calls::skip("apple_playlists_sync") {
        return Ok(0);
    }
    crate::apple_calls::background("apple_playlists_sync", apple_playlists_sync_run(fresh, apple_state, db)).await
}

async fn apple_playlists_sync_run(
    fresh: bool,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock_or_recover()
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

    let mut conn = db.lock();
    let tx = conn.transaction().map_err(err)?;

    let old: std::collections::HashMap<String, String> = {
        let mut stmt = tx
            .prepare_cached("SELECT playlist_id, json FROM apple_playlists")
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
    // A copy exported moments ago may not be in Apple's list yet: Apple lists a new playlist
    // a few seconds after the create. Keep its row (seeded by the export) through that window
    // instead of dropping it, or the playlist loses its sigil and offers Export again.
    let recent: Vec<String> = {
        let mut stmt = tx
            .prepare_cached("SELECT exported_apple_id FROM local_playlists WHERE exported_apple_id IS NOT NULL AND exported_at > ?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([now_ms() - EXPORT_LIST_LAG_MS], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)?
    };
    for id in recent {
        if seen.contains(&id) {
            continue;
        }
        let Some(json) = old.get(&id) else { continue };
        tx.execute(
            "INSERT INTO apple_playlists(playlist_id, position, json) VALUES(?1, ?2, ?3)",
            rusqlite::params![id, all.len() as i64, json],
        )
        .map_err(err)?;
        crate::log::info(&format!("playlists: kept just-exported {id} (not in Apple's list yet)"));
        seen.insert(id);
    }
    // Playlists gone from Apple's list: drop their content caches. Their folder and refresh
    // rows are the user's own filing and stay: Apple leaves a playlist out of one read now and
    // then, and deleting them lost the folders for good (2026-09-29). Both tables are read as
    // lookups keyed by a listed playlist, so a row for a playlist that is really gone does nothing.
    for id in old.keys() {
        if !seen.contains(id) {
            tx.execute(
                "DELETE FROM apple_playlist_tracks WHERE playlist_id = ?1",
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
///
/// A background job (APPLE-CALLS.md §3): it skips its turn while Apple's back-off holds.
#[tauri::command]
pub async fn apple_playlist_counts(
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    if crate::apple_calls::skip("apple_playlist_counts") {
        return Ok(0);
    }
    crate::apple_calls::background("apple_playlist_counts", apple_playlist_counts_run(apple_state, db)).await
}

async fn apple_playlist_counts_run(
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<u32, String> {
    use futures::StreamExt;

    // Which mirror rows still lack a count? Lock only for the read.
    let missing: Vec<String> = {
        let conn = db.lock();
        let mut stmt = conn.prepare_cached("SELECT json FROM apple_playlists").map_err(err)?;
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
        .lock_or_recover()
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
    let mut conn = db.lock();
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
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT json FROM apple_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
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
        .lock_or_recover()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);

    let all = fetch_apple_tracks(&provider, &id).await?;
    store_tracks(&mut db.lock(), &id, &all)?;
    stamp_refresh(&db.lock(), &id);
    Ok(all)
}

// -- Refresh (docs/features/PLAYLIST-REFRESH.md) ---------------------------------------

/// v11 (2026-09-20): the `playlist_refresh` table. It cannot live on `apple_playlists` --
/// that table is DELETEd whole and rebuilt on every sync, so a preference stored there is
/// wiped weekly. Keyed like `playlist_folder_members`, which survives a sync for the same
/// reason. NO ROW means "the default for this playlist's kind" (PLAYLIST-REFRESH.md D2), so
/// a mix Apple adds next month is on Daily without anything being written.
pub fn migrate_v11(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS playlist_refresh (
            playlist_key TEXT PRIMARY KEY,
            mode         TEXT NOT NULL,
            weekday      INTEGER,
            fetched_at   INTEGER
        );",
    )
    .map_err(|e| format!("create playlist_refresh: {e}"))?;
    crate::library::meta_set(conn, "schema_version", "11")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRow {
    /// A mirror's libraryId, or `local:<id>`.
    key: String,
    /// `daily` | `weekly` | `off` -- or `default`, written by a stamp on a playlist the
    /// user never chose for, which still means "this playlist's kind decides".
    mode: String,
    /// 0..6, weekly only (0 = Sunday, the way `Date.getDay()` counts).
    weekday: Option<i64>,
    /// When this playlist's songs were last read from Apple (ms).
    fetched_at: Option<i64>,
}

/// Every stored choice and stamp. A playlist with no row is on its kind's default, which
/// the front end works out -- nothing is written until the user chooses or a refresh runs.
#[tauri::command]
pub async fn playlist_refresh_rows(app: tauri::AppHandle) -> Result<Vec<RefreshRow>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT playlist_key, mode, weekday, fetched_at FROM playlist_refresh")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RefreshRow {
                    key: r.get(0)?,
                    mode: r.get(1)?,
                    weekday: r.get(2)?,
                    fetched_at: r.get(3)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    })
    .await
}

/// Set one playlist's choice. The stamp is kept: changing Daily to Weekly must not make a
/// playlist that was read an hour ago look unread.
#[tauri::command]
pub async fn playlist_refresh_set(key: String, mode: String, weekday: Option<i64>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        if !matches!(mode.as_str(), "daily" | "weekly" | "off") {
            return Err(format!("unknown refresh mode: {mode}"));
        }
        let conn = db.lock();
        conn.execute(
            "INSERT INTO playlist_refresh(playlist_key, mode, weekday, fetched_at)
             VALUES(?1, ?2, ?3, NULL)
             ON CONFLICT(playlist_key) DO UPDATE SET mode = ?2, weekday = ?3",
            rusqlite::params![key, mode, weekday],
        )
        .map_err(err)?;
        Ok(())
    })
    .await
}

/// Mark a playlist read now, without touching its mode. Best effort: a missing stamp only
/// costs one extra read on the next trigger, so a failure here must never fail the read
/// that earned it.
fn stamp_refresh(conn: &Connection, key: &str) {
    let _ = conn.execute(
        "INSERT INTO playlist_refresh(playlist_key, mode, weekday, fetched_at)
         VALUES(?1, 'default', NULL, ?2)
         ON CONFLICT(playlist_key) DO UPDATE SET fetched_at = ?2",
        rusqlite::params![key, now_ms()],
    );
}

/// The stamp alone, for the read-only path: an exported local playlist that was peeked
/// (PLAYLIST-REFRESH.md D9). The peek stamps whether or not the offer is taken, so a
/// dismissed offer comes back when the playlist is next due, not at the next hourly check.
#[tauri::command]
pub async fn playlist_refresh_stamp(key: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        stamp_refresh(&db.lock(), &key);
        Ok(())
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefetchResult {
    /// Songs on the playlist now.
    total: u32,
    /// Songs in the new list that were not in the old one. A mix REPLACES rather than
    /// appends, so this is the only count that means anything.
    added: u32,
}

/// Re-read a mirror's songs from Apple, whatever the cache holds (PLAYLIST-REFRESH.md §5).
/// One Apple read per 100 songs. On a failure the old cache AND the old stamp both stay, so
/// the next trigger tries again rather than waiting another day.
///
/// A background job (the hourly check and the refresh on open, APPLE-CALLS.md §3). While
/// Apple's back-off holds it returns `apple_calls::BUSY`, so the front end keeps the old stamp.
#[tauri::command]
pub async fn playlist_refetch(
    id: String,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<RefetchResult, String> {
    if crate::apple_calls::skip("playlist_refetch") {
        return Err(crate::apple_calls::BUSY.into());
    }
    crate::apple_calls::background("playlist_refetch", playlist_refetch_run(id, apple_state, db)).await
}

async fn playlist_refetch_run(
    id: String,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<RefetchResult, String> {
    let before: std::collections::HashSet<String> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT json FROM apple_playlist_tracks WHERE playlist_id = ?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([id.as_str()], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.filter_map(|r| r.ok())
            .filter_map(|j| serde_json::from_str::<Track>(&j).ok())
            .map(|t| track_key(&t))
            .collect()
    };

    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock_or_recover()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev, user);
    let all = fetch_apple_tracks(&provider, &id).await?;

    let added = all.iter().filter(|t| !before.contains(&track_key(t))).count() as u32;
    store_tracks(&mut db.lock(), &id, &all)?;
    stamp_refresh(&db.lock(), &id);
    crate::log::info(&format!(
        "playlists: refetched {id} -- {} song(s), {added} new",
        all.len()
    ));
    Ok(RefetchResult { total: all.len() as u32, added })
}

/// What counts as "the same song" across two reads. The catalog id when there is one (a
/// mix's songs always have one), the library id next, and title + artist as the last
/// resort, which is all a library-only row gives us.
fn track_key(t: &Track) -> String {
    t.catalog_id
        .clone()
        .or_else(|| t.library_id.clone())
        .unwrap_or_else(|| format!("{}|{}", t.title.to_lowercase(), t.artist_name.to_lowercase()))
}

// ── Local CRUD (all SQLite, zero Apple calls; UI callers arrive with creation UX) ──

/// `role`: None for a hand-made playlist, `"replay"` for one made from listening (§10.8).
/// `expire_days`: a temporary web playlist's days (PLAYLIST-WEB.md §10); None = kept.
#[tauri::command]
pub async fn playlist_create(name: String, description: Option<String>, role: Option<String>, expire_days: Option<u32>, app: tauri::AppHandle) -> Result<i64, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let now = now_ms();
        conn.execute(
            "INSERT INTO local_playlists(name, description, created_at, updated_at, role, expire_days) VALUES(?1, ?2, ?3, ?3, ?4, ?5)",
            rusqlite::params![name, description, now, role, expire_days],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    })
    .await
}

/// Keep Playlist (PLAYLIST-WEB.md §10.5): a temporary playlist becomes an ordinary one.
#[tauri::command]
pub async fn playlist_keep(id: i64, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        conn.execute("UPDATE local_playlists SET expire_days = NULL WHERE id = ?1", [id]).map_err(err)?;
        crate::log::info(&format!("playlists: kept temporary playlist id={id}"));
        Ok(())
    })
    .await
}

/// A deleted temporary playlist, whole: Undo makes it again from this.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiredPlaylist {
    id: i64,
    name: String,
    description: Option<String>,
    cover: Option<String>,
    folder_id: Option<i64>,
    expire_days: u32,
    /// The songs' saved json, in order.
    tracks: Vec<String>,
}

/// The expiry check (PLAYLIST-WEB.md §10.6): delete every temporary playlist past its time,
/// except the one that plays now (`playing` = the current queue context), and return them
/// whole for Undo. Local SQL only.
#[tauri::command]
pub async fn playlists_expire(playing: Option<String>, app: tauri::AppHandle) -> Result<Vec<ExpiredPlaylist>, String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let now = now_ms();
        let due: Vec<(i64, String, Option<String>, Option<String>, u32)> = {
            let mut st = conn
                .prepare_cached(
                    "SELECT p.id, p.name, p.description, p.cover, p.created_at, p.expire_days,
                            (SELECT MAX(e.started_ts) FROM play_events e WHERE e.context = 'playlist:local:' || p.id)
                     FROM local_playlists p WHERE p.expire_days IS NOT NULL",
                )
                .map_err(err)?;
            let rows = st
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, u32>(5)?,
                        r.get::<_, Option<i64>>(6)?,
                    ))
                })
                .map_err(err)?;
            rows.flatten()
                .filter(|(id, _, _, _, created, days, last)| {
                    now >= expires_at(*created, *last, *days) && playing.as_deref() != Some(&format!("playlist:local:{id}"))
                })
                .map(|(id, name, description, cover, _, days, _)| (id, name, description, cover, days))
                .collect()
        };
        let mut out = Vec::new();
        for (id, name, description, cover, expire_days) in due {
            let tracks: Vec<String> = {
                let mut st = conn
                    .prepare_cached("SELECT json FROM local_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
                    .map_err(err)?;
                let rows = st.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
                rows.flatten().collect()
            };
            let key = format!("local:{id}");
            let folder_id: Option<i64> = conn
                .query_row("SELECT folder_id FROM playlist_folder_members WHERE playlist_key = ?1", [&key], |r| r.get(0))
                .ok();
            let tx = conn.transaction().map_err(err)?;
            tx.execute("DELETE FROM local_playlist_tracks WHERE playlist_id = ?1", [id]).map_err(err)?;
            tx.execute("DELETE FROM playlist_folder_members WHERE playlist_key = ?1", [&key]).map_err(err)?;
            tx.execute("DELETE FROM local_playlists WHERE id = ?1", [id]).map_err(err)?;
            tx.commit().map_err(err)?;
            crate::log::info(&format!("playlists: expired temporary playlist id={id} days={expire_days} songs={}", tracks.len()));
            out.push(ExpiredPlaylist { id, name, description, cover, folder_id, expire_days, tracks });
        }
        Ok(out)
    })
    .await
}

/// Undo an expiry: the playlist again, with its name, songs, cover, folder and days. Its
/// clock starts now, so the next check does not delete it at once. Returns the new id.
#[tauri::command]
pub async fn playlist_restore(playlist: ExpiredPlaylist, app: tauri::AppHandle) -> Result<i64, String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let now = now_ms();
        let tx = conn.transaction().map_err(err)?;
        let has_cover = playlist.cover.as_deref().is_some_and(|c| !c.is_empty());
        tx.execute(
            "INSERT INTO local_playlists(name, description, created_at, updated_at, cover, cover_at, expire_days)
             VALUES(?1, ?2, ?3, ?3, ?4, ?5, ?6)",
            rusqlite::params![playlist.name, playlist.description, now, playlist.cover, has_cover.then_some(now), playlist.expire_days],
        )
        .map_err(err)?;
        let id = tx.last_insert_rowid();
        for (i, json) in playlist.tracks.iter().enumerate() {
            tx.execute(
                "INSERT INTO local_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)",
                rusqlite::params![id, i as i64, json],
            )
            .map_err(err)?;
        }
        if let Some(f) = playlist.folder_id {
            // Only into a folder that still exists.
            tx.execute(
                "INSERT OR REPLACE INTO playlist_folder_members(playlist_key, folder_id)
                 SELECT ?1, id FROM playlist_folders WHERE id = ?2",
                rusqlite::params![format!("local:{id}"), f],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        crate::log::info(&format!("playlists: restored expired playlist id={} as id={id}", playlist.id));
        Ok(id)
    })
    .await
}

#[tauri::command]
pub async fn playlist_rename(id: i64, name: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        conn.execute(
            "UPDATE local_playlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, name, now_ms()],
        )
        .map_err(err)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn playlist_delete(id: i64, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
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
        tx.execute("DELETE FROM playlist_apple_baseline WHERE playlist_id = ?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)
    })
    .await
}

/// Append tracks (denormalised snapshots) to the end, preserving order.
#[tauri::command]
pub async fn playlist_add_tracks(id: i64, tracks: Vec<Track>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        append_local(&mut conn, id, &tracks)
    })
    .await
}

/// The refresh offer's [Get them] (PLAYLIST-REFRESH.md): append only the held songs the
/// playlist does not hold yet, and say how many went in. The offer is sticky and can wait
/// in the queue while Get New Songs or a newer offer adds the same songs; a blind append
/// then put every song in twice (2026-09-29). Matched by catalog id; zero Apple calls.
///
/// `apple_id` + `apple_ids`: the peek's read of the Apple copy. Taking the offer is a sync
/// point, so the baseline is saved from that read (§12), in the same transaction.
#[tauri::command]
pub async fn playlist_add_new_tracks(
    id: i64,
    tracks: Vec<Track>,
    apple_id: Option<String>,
    apple_ids: Option<Vec<String>>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let (have, _) = export_rows(&conn, id)?;
        let mut held: std::collections::HashSet<String> = have.into_iter().map(|r| r.catalog_id).collect();
        let new: Vec<Track> = tracks
            .into_iter()
            .filter(|t| match &t.catalog_id {
                Some(c) if !c.is_empty() => held.insert(c.clone()),
                _ => true,
            })
            .collect();
        let tx = conn.transaction().map_err(err)?;
        if !new.is_empty() {
            append_in(&tx, id, &new)?;
        }
        if let (Some(a), Some(ids)) = (&apple_id, &apple_ids) {
            baseline_set(&tx, id, a, ids)?;
        }
        tx.commit().map_err(err)?;
        Ok(new.iter().filter(|t| !t.unreleased).count() as u32)
    })
    .await
}

fn append_local(conn: &mut Connection, id: i64, tracks: &[Track]) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    append_in(&tx, id, tracks)?;
    tx.commit().map_err(err)
}

/// `append_local` inside a caller's transaction, so an append can land with other writes or
/// not at all (Import to Edit, Get New Songs with its sync baseline).
fn append_in(tx: &rusqlite::Transaction, id: i64, tracks: &[Track]) -> Result<(), String> {
    // A pre-release album's unreleased songs stay out: the snapshot would keep the flag
    // (and no play data) past release day (model.rs `Track::unreleased`).
    let kept: Vec<Track>;
    let tracks = if tracks.iter().any(|t| t.unreleased) {
        kept = tracks.iter().filter(|t| !t.unreleased).cloned().collect();
        &kept[..]
    } else {
        tracks
    };
    let next: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM local_playlist_tracks WHERE playlist_id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    {
        let mut ins = tx
            .prepare_cached("INSERT INTO local_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)")
            .map_err(err)?;
        for (i, t) in tracks.iter().enumerate() {
            ins.execute(rusqlite::params![id, next + i as i64, serde_json::to_string(t).map_err(err)?])
                .map_err(err)?;
        }
    }
    touch_playlist(tx, id)
}

/// Stamp a local playlist as changed, and refuse a write to one that is gone: with no row to
/// stamp, the songs would land as orphans no view reads, and the toast would say "Added"
/// (an Undo after the playlist's delete, or a drop that raced it; 2026-09-29). The error
/// rolls the whole transaction back.
fn touch_playlist(tx: &rusqlite::Transaction, id: i64) -> Result<(), String> {
    let n = tx
        .execute("UPDATE local_playlists SET updated_at = ?2 WHERE id = ?1", rusqlite::params![id, now_ms()])
        .map_err(err)?;
    if n == 0 {
        return Err("That playlist was deleted.".into());
    }
    Ok(())
}

/// Read a local playlist's tracks in stored order (needed by remove/reorder below;
/// playlists are small, so read-mutate-rewrite keeps positions trivially dense).
fn read_local_tracks(conn: &Connection, id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT json FROM local_playlist_tracks WHERE playlist_id = ?1 ORDER BY position")
        .map_err(err)?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

fn write_local_tracks(tx: &rusqlite::Transaction, id: i64, jsons: &[String]) -> Result<(), String> {
    tx.execute("DELETE FROM local_playlist_tracks WHERE playlist_id = ?1", [id])
        .map_err(err)?;
    let mut ins = tx
        .prepare_cached("INSERT INTO local_playlist_tracks(playlist_id, position, json) VALUES(?1, ?2, ?3)")
        .map_err(err)?;
    for (i, j) in jsons.iter().enumerate() {
        ins.execute(rusqlite::params![id, i as i64, j]).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn playlist_remove_track(id: i64, position: i64, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let mut jsons = read_local_tracks(&conn, id)?;
        let pos = position as usize;
        if pos >= jsons.len() {
            return Err(format!("playlist_remove_track: position {position} out of range"));
        }
        jsons.remove(pos);
        let tx = conn.transaction().map_err(err)?;
        write_local_tracks(&tx, id, &jsons)?;
        touch_playlist(&tx, id)?;
        tx.commit().map_err(err)
    })
    .await
}

/// Remove a set of rows by their AUTHORED positions, in one transaction (2026-09-29): a picked
/// set went one call at a time, so a failure halfway left half the set removed. Every position
/// is checked before anything is written; a repeated position counts once.
#[tauri::command]
pub async fn playlist_remove_positions(id: i64, positions: Vec<i64>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let jsons = read_local_tracks(&conn, id)?;
        let gone: std::collections::HashSet<usize> = positions.iter().map(|&p| p as usize).collect();
        if let Some(bad) = positions.iter().find(|&&p| p < 0 || p as usize >= jsons.len()) {
            return Err(format!("playlist_remove_positions: position {bad} out of range"));
        }
        let kept: Vec<String> = jsons.into_iter().enumerate().filter(|(i, _)| !gone.contains(i)).map(|(_, j)| j).collect();
        let tx = conn.transaction().map_err(err)?;
        write_local_tracks(&tx, id, &kept)?;
        touch_playlist(&tx, id)?;
        tx.commit().map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn playlist_reorder(id: i64, from: i64, to: i64, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let mut jsons = read_local_tracks(&conn, id)?;
        let (f, t) = (from as usize, to as usize);
        if f >= jsons.len() || t >= jsons.len() {
            return Err(format!("playlist_reorder: {from}→{to} out of range"));
        }
        let moved = jsons.remove(f);
        jsons.insert(t, moved);
        let tx = conn.transaction().map_err(err)?;
        write_local_tracks(&tx, id, &jsons)?;
        touch_playlist(&tx, id)?;
        tx.commit().map_err(err)
    })
    .await
}

/// Insert tracks (denormalised snapshots) at authored position `at`, in order — a drop on
/// an open local playlist (DRAG-DROP.md §3). `at` past the end appends. One transaction.
#[tauri::command]
pub async fn playlist_insert_tracks(id: i64, at: i64, tracks: Vec<Track>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let mut jsons = read_local_tracks(&conn, id)?;
        let at = (at.max(0) as usize).min(jsons.len());
        let new = tracks
            .iter()
            .filter(|t| !t.unreleased) // as append_local

            .map(|t| serde_json::to_string(t).map_err(err))
            .collect::<Result<Vec<_>, _>>()?;
        jsons.splice(at..at, new);
        let tx = conn.transaction().map_err(err)?;
        write_local_tracks(&tx, id, &jsons)?;
        touch_playlist(&tx, id)?;
        tx.commit().map_err(err)
    })
    .await
}

/// Every stored playlist's songs, for the artist views' "Your Playlists" (ARTIST-VIEW.md §3):
/// all local playlists, and each Apple mirror playlist whose songs are cached. `unchecked`
/// lists the mirror playlists with no cached songs (a known-empty one, count 0, is skipped).
/// Zero Apple calls.
#[tauri::command]
pub async fn playlists_song_index(app: tauri::AppHandle) -> Result<crate::model::PlaylistSongIndex, String> {
    crate::db_thread::run(&app, move |db| {
        use std::collections::BTreeMap;
        let conn = db.lock();
        let mut groups: BTreeMap<String, Vec<Track>> = BTreeMap::new();
        let mut read = |sql: &str, key: &dyn Fn(String) -> String| -> Result<(), String> {
            let mut stmt = conn.prepare(sql).map_err(err)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(err)?;
            for row in rows {
                let (id, json) = row.map_err(err)?;
                // A snapshot that no longer parses is skipped, not fatal: the shelf is a hint.
                if let Ok(t) = serde_json::from_str::<Track>(&json) {
                    groups.entry(key(id)).or_default().push(t);
                }
            }
            Ok(())
        };
        read(
            "SELECT CAST(playlist_id AS TEXT), json FROM local_playlist_tracks ORDER BY playlist_id, position",
            &|id| format!("local:{id}"),
        )?;
        read("SELECT playlist_id, json FROM apple_playlist_tracks ORDER BY playlist_id, position", &|id| id)?;

        let mut unchecked = Vec::new();
        {
            let mut stmt = conn.prepare_cached("SELECT playlist_id, json FROM apple_playlists ORDER BY position").map_err(err)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(err)?;
            for row in rows {
                let (id, json) = row.map_err(err)?;
                if groups.contains_key(&id) {
                    continue;
                }
                let empty = serde_json::from_str::<Playlist>(&json).ok().and_then(|p| p.track_count) == Some(0);
                if !empty {
                    unchecked.push(id);
                }
            }
        }
        Ok(crate::model::PlaylistSongIndex {
            lists: groups.into_iter().map(|(key, tracks)| crate::model::PlaylistSongs { key, tracks }).collect(),
            unchecked,
        })
    })
    .await
}

#[tauri::command]
pub async fn local_playlist_tracks(id: i64, app: tauri::AppHandle) -> Result<Vec<Track>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let jsons = read_local_tracks(&conn, id)?;
        let mut out = Vec::with_capacity(jsons.len());
        for j in jsons {
            out.push(serde_json::from_str(&j).map_err(err)?);
        }
        Ok(out)
    })
    .await
}

// ── Folders (manual grouping over the unified list — all SQLite, zero Apple calls) ──

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistFolder {
    pub id: i64,
    pub name: String,
}

#[tauri::command]
pub async fn playlist_folders_list(app: tauri::AppHandle) -> Result<Vec<PlaylistFolder>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT id, name FROM playlist_folders")
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
    })
    .await
}

#[tauri::command]
pub async fn playlist_folder_create(name: String, app: tauri::AppHandle) -> Result<i64, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        conn.execute(
            "INSERT INTO playlist_folders(name, created_at) VALUES(?1, ?2)",
            rusqlite::params![name, now_ms()],
        )
        .map_err(err)?;
        Ok(conn.last_insert_rowid())
    })
    .await
}

#[tauri::command]
pub async fn playlist_folder_rename(id: i64, name: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        conn.execute(
            "UPDATE playlist_folders SET name = ?2 WHERE id = ?1",
            rusqlite::params![id, name],
        )
        .map_err(err)?;
        Ok(())
    })
    .await
}

/// Delete a folder; its members become unfiled (the playlists themselves are untouched).
#[tauri::command]
pub async fn playlist_folder_delete(id: i64, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let tx = conn.transaction().map_err(err)?;
        tx.execute("DELETE FROM playlist_folder_members WHERE folder_id = ?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM playlist_folders WHERE id = ?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)
    })
    .await
}

/// File a playlist into a folder (`folder_id: Some`) or unfile it (`None`).
/// The key is the front-end libraryId — locals and Apple mirrors alike.
#[tauri::command]
pub async fn playlist_folder_assign(playlist_key: String, folder_id: Option<i64>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
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
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(ids: &[&str]) -> Vec<ExportRow> {
        ids.iter().map(|c| ExportRow { catalog_id: c.to_string(), title: c.to_string() }).collect()
    }
    fn strs(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }
    fn picked(apple: &[&str], idx: &[usize]) -> Vec<String> {
        idx.iter().map(|&i| apple[i].to_string()).collect()
    }

    // The bug the baseline closes (2026-09-29): a song removed here came back on Get.
    #[test]
    fn new_since_keeps_a_removed_song_out_2026_09_29() {
        let apple = ["a", "b", "c"];
        let got = new_since(&rows(&apple), &strs(&["a", "b", "c"]), &rows(&["a", "c"]));
        assert!(got.is_empty(), "b was removed here on purpose");
        // The old diff brings it back: that is the default, and why the baseline exists.
        assert_eq!(picked(&apple, &export_diff(&rows(&apple), &rows(&["a", "c"])).0), strs(&["b"]));
    }

    #[test]
    fn new_since_adds_only_what_apple_gained() {
        let apple = ["a", "b", "d", "c", "e"];
        let got = new_since(&rows(&apple), &strs(&["a", "b", "c"]), &rows(&["a"]));
        assert_eq!(picked(&apple, &got), strs(&["d", "e"]));
    }

    #[test]
    fn new_since_counts_duplicates_as_a_multiset() {
        let apple = ["a", "a", "b"];
        // One "a" in the baseline: the second one is new.
        assert_eq!(picked(&apple, &new_since(&rows(&apple), &strs(&["a", "b"]), &[])), strs(&["a"]));
    }

    #[test]
    fn new_since_skips_a_new_song_the_playlist_already_holds() {
        let apple = ["a", "x"];
        // x is new on Apple, but it was added here by hand too: it must not land twice.
        assert!(new_since(&rows(&apple), &strs(&["a"]), &rows(&["a", "x"])).is_empty());
    }

    #[test]
    fn new_since_ignores_songs_gone_from_apple() {
        let apple = ["a"];
        assert!(new_since(&rows(&apple), &strs(&["a", "b", "c"]), &rows(&["a", "b"])).is_empty());
    }

    #[test]
    fn match_counts_adds_removes_and_order() {
        assert_eq!(match_counts(&strs(&["a", "b", "c"]), &strs(&["a", "b", "c"])), (0, 0, true));
        assert_eq!(match_counts(&strs(&["a", "b", "c"]), &strs(&["c", "b", "a"])), (0, 0, false));
        assert_eq!(match_counts(&strs(&["a", "x", "y"]), &strs(&["a", "b"])), (1, 2, false));
        assert_eq!(match_counts(&strs(&["a", "a"]), &strs(&["a"])), (0, 1, false));
        assert_eq!(match_counts(&[], &strs(&["a", "b"])), (2, 0, false));
    }

    #[test]
    fn baseline_is_read_only_for_its_own_copy() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);").unwrap();
        migrate_v17(&conn).unwrap();
        baseline_set(&conn, 7, "p.old", &strs(&["a", "b"])).unwrap();
        assert_eq!(baseline_get(&conn, 7, "p.old"), Some(strs(&["a", "b"])));
        assert_eq!(baseline_get(&conn, 7, "p.new"), None, "a baseline from an older copy is not read");
        baseline_set(&conn, 7, "p.new", &strs(&["c"])).unwrap();
        assert_eq!(baseline_raw(&conn, 7), Some(("p.new".to_string(), strs(&["c"]))));
    }
}

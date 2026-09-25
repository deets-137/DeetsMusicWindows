//! ♥ Favorites (FAVORITES.md, NEXT-VERSION §3): Apple's love rating, love only.
//!
//! Apple has no list-all-favorites endpoint, so a local `favorites` mirror backs the
//! filled state. Three feeds keep it honest: our own writes (write-through), the
//! generated "Favorite Songs" library playlist (the only list-all — seeded whenever
//! that playlist's tracks are fetched, zero extra calls), and a batched
//! `GET …/ratings/songs?ids=` for ids the playlist has not caught up with yet.
//! Keyed catalog-first like everything else; catalog-less uploads cannot be loved.

use crate::lock::LockExt;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::apple::{self, AppleState};
use crate::library::{self, Db};
use crate::model::Track;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now_s() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Upsert one mirror row.
pub(crate) fn set_local(conn: &Connection, id: &str, loved: bool) -> Result<(), String> {
    conn.execute(
        "INSERT INTO favorites(track_id, loved, synced_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(track_id) DO UPDATE SET loved = excluded.loved, synced_at = excluded.synced_at",
        rusqlite::params![id, loved as i64, now_s()],
    )
    .map_err(err)?;
    Ok(())
}

/// Seed the mirror from Apple's generated **Favorite Songs** playlist: every track in
/// it is loved. Rows not in it are left alone (the playlist can lag a fresh ♥ by a
/// while, and it only lists songs Apple could add to the library). Also parks the
/// tracks as `seen` rows so a favorites view can always resolve metadata.
pub(crate) fn seed_from_playlist(conn: &Connection, tracks: &[Track]) -> Result<usize, String> {
    library::materialize_many(conn, tracks)?;
    let mut n = 0usize;
    for t in tracks {
        let Some(id) = t.catalog_id.clone().filter(|s| !s.is_empty()) else { continue };
        set_local(conn, &id, true)?;
        n += 1;
    }
    Ok(n)
}

/// Is this mirror row Apple's generated Favorite Songs list? There is no type field:
/// the tell is the fixed name on a read-only library playlist with no catalog twin.
pub(crate) fn is_favorite_songs(p: &crate::model::Playlist) -> bool {
    p.name == "Favorite Songs" && !p.can_edit && p.global_id.is_none()
}

/// ♥ / un-♥ one song: `PUT …/ratings/songs/{id}` value 1, or `DELETE`. Write-through:
/// the mirror row flips only after Apple accepts, so the optimistic front-end can
/// roll back on an error. The track is parked as `seen` first (metadata for later).
#[tauri::command]
pub async fn favorite_set(
    track: Track,
    loved: bool,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let id = track
        .catalog_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or("favorite_set: no catalog id")?;
    let dev = apple::developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let url = format!("https://api.music.apple.com/v1/me/ratings/songs/{id}");
    let (status, body) = if loved {
        let payload = serde_json::json!({ "type": "rating", "attributes": { "value": 1 } });
        apple::api_send(&client, reqwest::Method::PUT, &dev, &user, &url, Some(&payload)).await?
    } else {
        apple::api_send(&client, reqwest::Method::DELETE, &dev, &user, &url, None).await?
    };
    if !(200..300).contains(&status) {
        return Err(format!("favorite HTTP {status}: {body}"));
    }
    let conn = db.lock();
    library::materialize_many(&conn, std::slice::from_ref(&track))?;
    set_local(&conn, &id, loved)?;
    crate::log::info(&format!("favorites: {} {id}", if loved { "loved" } else { "unloved" }));
    Ok(())
}

// ── Albums and playlists (CONTEXT-MENUS.md §3b, his calls F1A F2A F3A, 2026-09-24) ──
// The same mirror table, keyed `album:{id}` / `playlist:{id}` so no song id can collide.
// A Library album holds no album id (only its songs'), so a row `albumsong:{first song id}`
// mirrors the album's row: the Library menu reads it with no song → album lookup.

/// The ratings path segment for a collection kind, or an error for anything else.
fn collection_kind(kind: &str) -> Result<(&'static str, &'static str), String> {
    match kind {
        "albums" => Ok(("albums", "album")),
        "playlists" => Ok(("playlists", "playlist")),
        "library-playlists" => Ok(("library-playlists", "playlist")),
        _ => Err(format!("favorites: bad collection kind '{kind}'")),
    }
}

fn set_collection_local(conn: &Connection, prefix: &str, id: &str, alias: Option<&str>, loved: bool) -> Result<(), String> {
    set_local(conn, &format!("{prefix}:{id}"), loved)?;
    if let Some(song) = alias.filter(|s| !s.is_empty()) {
        set_local(conn, &format!("albumsong:{song}"), loved)?;
    }
    Ok(())
}

/// ♥ / un-♥ an album or playlist: `PUT …/ratings/{kind}/{id}` value 1, or `DELETE`.
/// Write-through, as `favorite_set`. `alias`: the album's first song, for the Library row.
#[tauri::command]
pub async fn favorite_collection_set(
    kind: String,
    id: String,
    alias: Option<String>,
    loved: bool,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let (path, prefix) = collection_kind(&kind)?;
    if id.is_empty() {
        return Err("favorite_collection_set: no id".into());
    }
    let dev = apple::developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let url = format!("https://api.music.apple.com/v1/me/ratings/{path}/{id}");
    let (status, body) = if loved {
        let payload = serde_json::json!({ "type": "rating", "attributes": { "value": 1 } });
        apple::api_send(&client, reqwest::Method::PUT, &dev, &user, &url, Some(&payload)).await?
    } else {
        apple::api_send(&client, reqwest::Method::DELETE, &dev, &user, &url, None).await?
    };
    if !(200..300).contains(&status) {
        return Err(format!("favorite {path} HTTP {status}: {body}"));
    }
    let conn = db.lock();
    set_collection_local(&conn, prefix, &id, alias.as_deref(), loved)?;
    crate::log::info(&format!("favorites: {} {prefix} {id}", if loved { "loved" } else { "unloved" }));
    Ok(())
}

/// Ask Apple once whether an album or playlist is loved (one `GET …/ratings/{kind}?ids=`).
/// The answer gets a mirror row either way, so it is never asked again on this install.
///
/// A background job (the app asks on its own, APPLE-CALLS.md §3): `apple_calls::BUSY` while
/// Apple's back-off holds, and no row is written, so it asks again next time.
#[tauri::command]
pub async fn favorite_collection_reconcile(
    kind: String,
    id: String,
    alias: Option<String>,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<bool, String> {
    if crate::apple_calls::skip("favorite_collection_reconcile") {
        return Err(crate::apple_calls::BUSY.into());
    }
    crate::apple_calls::background("favorite_collection_reconcile", favorite_collection_reconcile_run(kind, id, alias, state, db)).await
}

async fn favorite_collection_reconcile_run(
    kind: String,
    id: String,
    alias: Option<String>,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<bool, String> {
    let (path, prefix) = collection_kind(&kind)?;
    if id.is_empty() {
        return Err("favorite_collection_reconcile: no id".into());
    }
    let dev = apple::developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let url = format!("https://api.music.apple.com/v1/me/ratings/{path}?ids={id}");
    let (status, body) = apple::api_get(&client, &dev, &user, &url).await?;
    // 404 = no rating on it; anything else unexpected is an error.
    if status != 200 && status != 404 {
        return Err(format!("ratings {path} HTTP {status}: {body}"));
    }
    let loved = body
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| arr.iter().any(|r| r.pointer("/attributes/value").and_then(|v| v.as_i64()) == Some(1)))
        .unwrap_or(false);
    let conn = db.lock();
    set_collection_local(&conn, prefix, &id, alias.as_deref(), loved)?;
    crate::log::info(&format!("favorites: reconciled {prefix} {id}, loved={loved}"));
    Ok(loved)
}

/// Every loved id in the mirror — the front-end's in-memory set at boot.
#[tauri::command]
pub async fn favorites_cached(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT track_id FROM favorites WHERE loved = 1")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    })
    .await
}

/// Which ids the mirror already knows (loved or not) — so the front-end only asks
/// Apple about the rest.
#[tauri::command]
pub async fn favorites_known(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn.prepare_cached("SELECT track_id FROM favorites").map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconciled {
    pub loved: Vec<String>,
    pub unloved: Vec<String>,
}

/// Ask Apple about a batch of catalog ids the mirror has never seen (a ♥ set on the
/// phone). One `GET …/ratings/songs?ids=` per 100 ids; ids Apple omits are not loved.
/// Every asked id gets a mirror row either way, so it is never asked again on this
/// install (a later ♥ elsewhere shows up through the Favorite Songs seed).
///
/// A background job, like `favorite_collection_reconcile` (APPLE-CALLS.md §3).
#[tauri::command]
pub async fn favorites_reconcile(
    ids: Vec<String>,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<Reconciled, String> {
    if crate::apple_calls::skip("favorites_reconcile") {
        return Err(crate::apple_calls::BUSY.into());
    }
    crate::apple_calls::background("favorites_reconcile", favorites_reconcile_run(ids, state, db)).await
}

async fn favorites_reconcile_run(
    ids: Vec<String>,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<Reconciled, String> {
    let ids: Vec<String> = ids.into_iter().filter(|s| !s.is_empty()).collect();
    let mut out = Reconciled { loved: Vec::new(), unloved: Vec::new() };
    if ids.is_empty() {
        return Ok(out);
    }
    let dev = apple::developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    for chunk in ids.chunks(100) {
        let url = format!(
            "https://api.music.apple.com/v1/me/ratings/songs?ids={}",
            chunk.join(",")
        );
        let (status, body) = apple::api_get(&client, &dev, &user, &url).await?;
        // 404 = none of these ids carries a rating; anything else unexpected is an error.
        if status != 200 && status != 404 {
            return Err(format!("ratings HTTP {status}: {body}"));
        }
        let mut loved_here = std::collections::HashSet::new();
        if let Some(arr) = body.get("data").and_then(|d| d.as_array()) {
            for r in arr {
                let v = r.pointer("/attributes/value").and_then(|v| v.as_i64()).unwrap_or(0);
                if let Some(id) = r.get("id").and_then(|i| i.as_str()) {
                    if v == 1 {
                        loved_here.insert(id.to_string());
                    }
                }
            }
        }
        for id in chunk {
            if loved_here.contains(id) {
                out.loved.push(id.clone());
            } else {
                out.unloved.push(id.clone());
            }
        }
    }
    let conn = db.lock();
    for id in &out.loved {
        set_local(&conn, id, true)?;
    }
    for id in &out.unloved {
        set_local(&conn, id, false)?;
    }
    crate::log::info(&format!(
        "favorites: reconciled {} id(s), {} loved",
        out.loved.len() + out.unloved.len(),
        out.loved.len()
    ));
    Ok(out)
}

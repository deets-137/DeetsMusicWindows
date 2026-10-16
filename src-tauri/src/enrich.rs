//! Lazy catalog enrichment (roadmap #7) — the shared substrate.
//!
//! One demand-driven, cached catalog fetch yields everything the library payload
//! lacks: the album **palette** (`bgColor`/`textColors` → Album Color), the **ISRC**
//! (→ Deezer BPM for Stations), and the 30s **preview URL**. Never a batch pre-pass:
//! we fetch what a surface actually touches, in `?ids=` batches, and cache forever
//! (catalog metadata is stable).
//!
//! Two caches, one fetch:
//!   `track_catalog(catalog_id …)` — per-recording facts (ISRC, preview, cover URL)
//!   `album_palette(cover_url …)`  — per-cover colors (an album's tracks share one)
//! Palettes are stored under BOTH the requester's cover key and the catalog's own
//! artwork URL — library and catalog artwork URLs can differ for the same album, and
//! the double-write guarantees the next lookup by either key hits.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::apple::{self, api_get, AppleState};
use crate::library::Db;
use crate::lock::LockExt;

/// Documented ceiling for "Get Multiple Catalog Songs" by ids.
pub(crate) const BATCH: usize = 300;

pub fn init_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS track_catalog (
            catalog_id  TEXT PRIMARY KEY,
            isrc        TEXT,
            preview_url TEXT,
            cover_url   TEXT,
            fetched_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS album_palette (
            cover_url  TEXT PRIMARY KEY,
            bg         TEXT,
            c1         TEXT,
            c2         TEXT,
            fetched_at INTEGER NOT NULL
        );
        -- The Library artist view (ARTIST-VIEW.md §4), keyed by the library artist NAME.
        -- catalog_id '' = resolved, Apple has no match (never asked again). artwork and
        -- featured are normalized JSON (links only, never image bytes). featured_at 0 =
        -- expired (the Library refresh button). top_songs = Apple's top-songs view (the
        -- Popular sort), fetched and refreshed with featured.
        CREATE TABLE IF NOT EXISTS artist_catalog (
            name        TEXT PRIMARY KEY,
            catalog_id  TEXT NOT NULL,
            artwork     TEXT,
            featured    TEXT,
            featured_at INTEGER NOT NULL DEFAULT 0,
            top_songs   TEXT
        );",
    )?;
    // artist_catalog first shipped without top_songs (dev databases, 2026-09-15): add it.
    let has_top: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('artist_catalog') WHERE name = 'top_songs'",
        [],
        |r| r.get(0),
    )?;
    if has_top == 0 {
        conn.execute_batch("ALTER TABLE artist_catalog ADD COLUMN top_songs TEXT;")?;
    }
    Ok(())
}

/// v19 (2026-10-15, ideas/apple-calls.md §5): `artist_catalog.catalog_name` (the primary
/// artist's own name, from the artist pass) and `track_catalog.artists` (a song's catalog
/// artists in Apple's order, `[[id, name], …]` JSON, from the enrichment read: the guests).
/// Additive, idempotent.
pub fn migrate_v19(conn: &Connection) -> Result<(), String> {
    let has = |table: &str, col: &str| -> Result<bool, String> {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
            [col],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .map_err(|e| e.to_string())
    };
    let mut added = Vec::new();
    if !has("artist_catalog", "catalog_name")? {
        conn.execute_batch("ALTER TABLE artist_catalog ADD COLUMN catalog_name TEXT;")
            .map_err(|e| format!("add artist_catalog.catalog_name: {e}"))?;
        added.push("artist_catalog.catalog_name");
    }
    if !has("track_catalog", "artists")? {
        conn.execute_batch("ALTER TABLE track_catalog ADD COLUMN artists TEXT;")
            .map_err(|e| format!("add track_catalog.artists: {e}"))?;
        added.push("track_catalog.artists");
    }
    if !added.is_empty() {
        crate::log::info(&format!("migration: v19 added {}", added.join(", ")));
    }
    crate::library::meta_set(conn, "schema_version", "19")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Normalized palette handed to the frontend: `#rrggbb` strings, ready for CSS.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPalette {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c2: Option<String>,
}

impl AlbumPalette {
    fn is_empty(&self) -> bool {
        self.bg.is_none() && self.c1.is_none() && self.c2.is_none()
    }
}

/// Apple sends bare hex (`ff5500`); the frontend applies CSS. Normalize here.
fn css_hex(v: &serde_json::Value) -> Option<String> {
    v.as_str().map(|s| format!("#{}", s.trim_start_matches('#')))
}

// ── Storefront (cached — a prerequisite for every catalog call) ──────────────

pub(crate) fn cached_storefront(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = 'storefront'",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// The user's storefront id (e.g. "us"), fetched once and cached in `meta`.
pub(crate) async fn storefront(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    db: &State<'_, Db>,
) -> Result<String, String> {
    if let Some(sf) = cached_storefront(&db.lock()) {
        return Ok(sf);
    }
    let (status, body) = api_get(
        client,
        dev,
        mut_tok,
        "https://api.music.apple.com/v1/me/storefront",
    )
    .await?;
    if status != 200 {
        return Err(format!("me/storefront HTTP {status}"));
    }
    let sf = body["data"][0]["id"]
        .as_str()
        .ok_or("me/storefront: no id in response")?
        .to_string();
    db.lock()
        .execute(
            "INSERT INTO meta(key, value) VALUES('storefront', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [&sf],
        )
        .map_err(|e| e.to_string())?;
    Ok(sf)
}

// ── The fetch: one batch of catalog songs → cache rows ───────────────────────

struct FetchedSong {
    catalog_id: String,
    isrc: Option<String>,
    preview_url: Option<String>,
    cover_url: Option<String>,
    palette: AlbumPalette,
    /// For the credit collection (CREDITS.md §3) — not cached in `track_catalog`.
    title: String,
    artist_name: String,
    composer: Option<String>,
    /// Every credited catalog artist, `(id, name)` in Apple's order, the primary first
    /// (`include=artists`). None when the read did not carry them (a search result).
    artists: Option<Vec<(String, String)>>,
}

async fn fetch_catalog_songs(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    sf: &str,
    ids: &[String],
) -> Result<Vec<FetchedSong>, String> {
    // The guests ride the same read, cut to their names (ideas/apple-calls.md §5.4, P2).
    let url = format!(
        "https://api.music.apple.com/v1/catalog/{sf}/songs?ids={}&include=artists&fields[artists]=name",
        ids.join(",")
    );
    let (status, body) = api_get(client, dev, mut_tok, &url).await?;
    if status != 200 {
        return Err(format!("catalog/songs HTTP {status}"));
    }
    let songs = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let a = &v["attributes"];
                    let art = &a["artwork"];
                    Some(FetchedSong {
                        catalog_id: v["id"].as_str()?.to_string(),
                        isrc: a["isrc"].as_str().map(String::from),
                        preview_url: a["previews"][0]["url"].as_str().map(String::from),
                        cover_url: art["url"].as_str().map(String::from),
                        palette: AlbumPalette {
                            bg: css_hex(&art["bgColor"]),
                            c1: css_hex(&art["textColor1"]),
                            c2: css_hex(&art["textColor2"]),
                        },
                        title: a["name"].as_str().unwrap_or_default().to_string(),
                        artist_name: a["artistName"].as_str().unwrap_or_default().to_string(),
                        composer: a["composerName"].as_str().map(String::from),
                        artists: v["relationships"]["artists"]["data"].as_array().map(|arr| {
                            arr.iter()
                                .filter_map(|x| {
                                    let id = x["id"].as_str().filter(|s| !s.is_empty())?;
                                    let name = x["attributes"]["name"].as_str().filter(|s| !s.is_empty())?;
                                    Some((id.to_string(), name.to_string()))
                                })
                                .collect()
                        }),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(songs)
}

/// Upsert one fetched song into both caches. `extra_cover_key` is the requester's
/// cover URL when it differs from the catalog's (the double-write, see module doc).
fn write_song(conn: &Connection, s: &FetchedSong, extra_cover_key: Option<&str>) -> Result<(), String> {
    let now = now_ms();
    crate::credits::note_rows(
        conn,
        std::iter::once(crate::credits::CreditRow {
            catalog_id: &s.catalog_id,
            composer: s.composer.as_deref(),
            title: &s.title,
            artist_name: &s.artist_name,
        }),
    );
    // A read with no artists (a search result) keeps the ones a read stored before.
    let artists = s.artists.as_ref().filter(|a| !a.is_empty()).and_then(|a| serde_json::to_string(a).ok());
    conn.execute(
        "INSERT INTO track_catalog(catalog_id, isrc, preview_url, cover_url, fetched_at, artists)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(catalog_id) DO UPDATE SET
             isrc = excluded.isrc, preview_url = excluded.preview_url,
             cover_url = excluded.cover_url, fetched_at = excluded.fetched_at,
             artists = COALESCE(excluded.artists, track_catalog.artists)",
        rusqlite::params![s.catalog_id, s.isrc, s.preview_url, s.cover_url, now, artists],
    )
    .map_err(|e| e.to_string())?;

    if !s.palette.is_empty() {
        let mut keys: Vec<&str> = Vec::new();
        if let Some(c) = s.cover_url.as_deref() {
            keys.push(c);
        }
        if let Some(extra) = extra_cover_key {
            if s.cover_url.as_deref() != Some(extra) {
                keys.push(extra);
            }
        }
        for key in keys {
            conn.execute(
                "INSERT INTO album_palette(cover_url, bg, c1, c2, fetched_at)
                 VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(cover_url) DO UPDATE SET
                     bg = excluded.bg, c1 = excluded.c1, c2 = excluded.c2,
                     fetched_at = excluded.fetched_at",
                rusqlite::params![key, s.palette.bg, s.palette.c1, s.palette.c2, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Piggyback already-normalized catalog tracks (e.g. search results) into the
/// caches — they carry ISRC / preview / artwork palette for free, so every search
/// quietly warms the substrate. Local writes only.
pub(crate) fn cache_tracks(conn: &Connection, tracks: &[crate::model::Track]) -> Result<(), String> {
    for t in tracks {
        let Some(cid) = t.catalog_id.as_deref().filter(|s| !s.is_empty()) else {
            continue;
        };
        let art = t.artwork.as_ref();
        let song = FetchedSong {
            catalog_id: cid.to_string(),
            isrc: t.isrc.clone(),
            preview_url: t.preview_url.clone(),
            cover_url: art.map(|a| a.url_template.clone()),
            palette: AlbumPalette {
                bg: art.and_then(|a| a.bg_color.as_deref()).map(|c| format!("#{}", c.trim_start_matches('#'))),
                c1: art
                    .and_then(|a| a.text_colors.as_ref())
                    .and_then(|v| v.first())
                    .map(|c| format!("#{}", c.trim_start_matches('#'))),
                c2: art
                    .and_then(|a| a.text_colors.as_ref())
                    .and_then(|v| v.get(1))
                    .map(|c| format!("#{}", c.trim_start_matches('#'))),
            },
            // The writer credits ride the same payload, at no extra call (CREDITS.md §3).
            title: t.title.clone(),
            artist_name: t.artist_name.clone(),
            composer: t.composer.clone(),
            artists: None,
        };
        write_song(conn, &song, None)?;
    }
    Ok(())
}

// ── The guests pass (his call G1 = A, ideas/apple-calls.md §5.6) ─────────────

/// Library songs whose catalog artists were never read: a catalog id, and no `artists` in
/// `track_catalog` (no row, or a row from before v19 or from a search result). `'[]'` marks a
/// song read with none (Apple did not return it, or listed no artist), so it is never asked
/// again.
fn guests_pending(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT json_extract(t.json, '$.catalogId') FROM tracks t
             LEFT JOIN track_catalog c ON c.catalog_id = json_extract(t.json, '$.catalogId')
             WHERE t.source = 'library'
               AND json_extract(t.json, '$.catalogId') IS NOT NULL
               AND json_extract(t.json, '$.catalogId') <> ''
               AND c.artists IS NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// After a read, every asked id with no artists stored gets `'[]'`: asked, none.
fn mark_read(conn: &Connection, ids: &[String]) -> Result<(), String> {
    let now = now_ms();
    let mut stmt = conn
        .prepare_cached(
            "INSERT INTO track_catalog(catalog_id, fetched_at, artists) VALUES(?1, ?2, '[]')
             ON CONFLICT(catalog_id) DO UPDATE SET artists = COALESCE(track_catalog.artists, '[]')",
        )
        .map_err(|e| e.to_string())?;
    for id in ids {
        stmt.execute(rusqlite::params![id, now]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// One read of up to 300 songs (`BATCH`) for their catalog artists, stored as the guests
/// pass stores them (`write_song`, then `'[]'` for the rest). Returns each returned song's
/// artists, the primary first. Shared with the artist pass's S3 fill (apple.rs).
pub(crate) async fn read_song_artists(
    client: &reqwest::Client,
    dev: &str,
    user: &str,
    sf: &str,
    ids: &[String],
    db: &Db,
) -> Result<std::collections::HashMap<String, Vec<(String, String)>>, String> {
    let songs = fetch_catalog_songs(client, dev, user, sf, ids).await?;
    let conn = db.lock();
    let mut out = std::collections::HashMap::new();
    for s in &songs {
        if let Err(e) = write_song(&conn, s, None) {
            crate::log::warn(&format!("song guests: write {}: {e}", s.catalog_id));
        }
        out.insert(s.catalog_id.clone(), s.artists.clone().unwrap_or_default());
    }
    if let Err(e) = mark_read(&conn, ids) {
        crate::log::warn(&format!("song guests: mark: {e}"));
    }
    Ok(out)
}

/// The pass after a library sync: read the catalog artists of every library song that has
/// none stored, 300 songs a call. The first pass after v19 reads the whole library once (about
/// 14 calls for 4,042 songs); after that, only the songs the sync just added. The same read
/// stores each song's ISRC, preview, palette and writer credits (`write_song`), at no extra
/// call. A background job (APPLE-CALLS.md §3): it skips its turn while Apple's back-off holds
/// and stops at the first failed call. Never fatal. `song-artists` tells the front end.
pub async fn guests_pass(app: &tauri::AppHandle, dev: &str, user: &str, db: &State<'_, Db>) {
    use tauri::Emitter;
    if crate::apple_calls::skip("song_guests") {
        return;
    }
    crate::apple_calls::background("song_guests", async {
        let todo = {
            let conn = db.lock();
            match guests_pending(&conn) {
                Ok(t) => t,
                Err(e) => return crate::log::warn(&format!("song guests: read failed: {e}")),
            }
        };
        if todo.is_empty() {
            return;
        }
        let client = apple::http_client();
        let sf = match storefront(&client, dev, user, db).await {
            Ok(sf) => sf,
            Err(e) => return crate::log::warn(&format!("song guests: storefront: {e}")),
        };
        let (mut calls, mut read, mut with) = (0usize, 0usize, 0usize);
        for chunk in todo.chunks(BATCH) {
            let got = match read_song_artists(&client, dev, user, &sf, chunk, db).await {
                Ok(g) => g,
                Err(e) => {
                    crate::log::warn(&format!("song guests: stopped after {calls} call(s): {e}"));
                    break;
                }
            };
            calls += 1;
            read += got.len();
            with += got.values().filter(|a| !a.is_empty()).count();
        }
        crate::log::info(&format!(
            "song guests: {} song(s) to read, {read} read in {calls} call(s), {with} with artists",
            todo.len()
        ));
        if calls > 0 {
            app.emit("song-artists", serde_json::json!({ "read": read })).ok();
        }
    })
    .await
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnrichSummary {
    pub requested: usize,
    pub cached: usize,
    pub fetched: usize,
    pub missing: usize,
}

/// Batch-enrich catalog ids into the caches (ISRC / preview / cover / palette).
/// Cache-first: only misses are fetched, in `?ids=` chunks. The substrate call for
/// Stations' ISRC backfill and any bulk consumer; the NP card uses `album_palette`.
#[tauri::command]
pub async fn catalog_enrich(
    catalog_ids: Vec<String>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<EnrichSummary, String> {
    let requested = catalog_ids.len();

    // Cache check (scoped — never hold the lock across an await).
    let misses: Vec<String> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT 1 FROM track_catalog WHERE catalog_id = ?1")
            .map_err(|e| e.to_string())?;
        catalog_ids
            .into_iter()
            .filter(|id| !id.is_empty())
            .filter(|id| !stmt.exists([id.as_str()]).unwrap_or(false))
            .collect()
    };
    let cached = requested - misses.len();
    if misses.is_empty() {
        return Ok(EnrichSummary { requested, cached, fetched: 0, missing: 0 });
    }

    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock_or_recover()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let sf = storefront(&client, &dev, &user, &db).await?;

    let mut fetched = 0usize;
    for chunk in misses.chunks(BATCH) {
        let songs = fetch_catalog_songs(&client, &dev, &user, &sf, chunk).await.map_err(|e| {
            crate::log::warn(&format!("enrich: batch of {} failed: {e}", chunk.len()));
            e
        })?;
        fetched += songs.len();
        let conn = db.lock();
        for s in &songs {
            write_song(&conn, s, None)?;
        }
    }
    Ok(EnrichSummary {
        requested,
        cached,
        fetched,
        missing: misses.len() - fetched,
    })
}

/// The stored catalog artists of songs, `[catalog id, [[artist id, name], …]]`, the primary
/// first (ideas/apple-calls.md §5.4, P2): the guests in *Go to Artist ▸*. `None` = every song
/// that has them (the front end's map at launch); a list = just those (after a read that may
/// have added some). Network-free: a song not read since v19 has none, and shows the primary
/// artist only.
#[tauri::command]
pub async fn song_artists(
    catalog_ids: Option<Vec<String>>,
    app: tauri::AppHandle,
) -> Result<Vec<(String, Vec<(String, String)>)>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let parse = |id: String, json: String| serde_json::from_str::<Vec<(String, String)>>(&json).ok().map(|a| (id, a));
        let mut out = Vec::new();
        match catalog_ids {
            None => {
                let mut stmt = conn
                    .prepare_cached("SELECT catalog_id, artists FROM track_catalog WHERE artists IS NOT NULL")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .map_err(|e| e.to_string())?;
                for row in rows {
                    let (id, json) = row.map_err(|e| e.to_string())?;
                    out.extend(parse(id, json));
                }
            }
            Some(ids) => {
                let mut stmt = conn
                    .prepare_cached("SELECT artists FROM track_catalog WHERE catalog_id = ?1 AND artists IS NOT NULL")
                    .map_err(|e| e.to_string())?;
                for id in ids.into_iter().filter(|i| !i.is_empty()) {
                    if let Ok(json) = stmt.query_row([id.as_str()], |r| r.get::<_, String>(0)) {
                        out.extend(parse(id, json));
                    }
                }
            }
        }
        Ok(out)
    })
    .await
}

/// Read these songs from Apple **now**, for their writer credits (CREDITS.md §8).
///
/// `catalog_enrich` above is cache-first on `track_catalog`, so a song enriched before the
/// credit collection existed would never be fetched again and its credits would never
/// arrive. This one always asks. It is the song pane's "we have not collected this yet"
/// path, and the user pressed something to get here — so one call for one song is honest.
///
/// Returns how many songs came back with a `composerName`.
#[tauri::command]
pub async fn credits_fetch(
    catalog_ids: Vec<String>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<usize, String> {
    let ids: Vec<String> = catalog_ids.into_iter().filter(|i| !i.is_empty()).collect();
    if ids.is_empty() {
        return Ok(0);
    }
    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock_or_recover()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let sf = storefront(&client, &dev, &user, &db).await?;

    let mut with_credits = 0usize;
    for chunk in ids.chunks(BATCH) {
        let songs = fetch_catalog_songs(&client, &dev, &user, &sf, chunk).await?;
        let conn = db.lock();
        for s in &songs {
            if s.composer.is_some() {
                with_credits += 1;
            }
            // Writes `song_credits` too, including the NULL row that records "Apple has
            // none for this song" — which is what stops us asking again forever.
            write_song(&conn, s, None)?;
        }
        // A song Apple did not return at all still gets a row, so the pane can say we
        // asked. Without it the song looks un-read for ever.
        for id in chunk {
            if !songs.iter().any(|s| &s.catalog_id == id) {
                crate::credits::note_rows(
                    &conn,
                    std::iter::once(crate::credits::CreditRow {
                        catalog_id: id,
                        composer: None,
                        title: "",
                        artist_name: "",
                    }),
                );
            }
        }
    }
    crate::log::info(&format!("credits: read {} song(s), {with_credits} with credits", ids.len()));
    Ok(with_credits)
}

/// The NP card's palette lookup: cache-first by cover URL; on a miss with a catalog
/// id, fetch that one song, cache (double-keyed), and return. `None` = no palette
/// available (stay on the theme fallback).
#[tauri::command]
pub async fn album_palette(
    cover_url: String,
    catalog_id: Option<String>,
    apple_state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<Option<AlbumPalette>, String> {
    // Cache hit?
    {
        let conn = db.lock();
        let hit = conn
            .query_row(
                "SELECT bg, c1, c2 FROM album_palette WHERE cover_url = ?1",
                [&cover_url],
                |r| {
                    Ok(AlbumPalette {
                        bg: r.get(0)?,
                        c1: r.get(1)?,
                        c2: r.get(2)?,
                    })
                },
            )
            .ok();
        if let Some(p) = hit {
            return Ok((!p.is_empty()).then_some(p));
        }
    }

    let Some(cid) = catalog_id.filter(|c| !c.is_empty()) else {
        return Ok(None); // no catalog identity — unfetchable, theme fallback stands
    };

    let dev = apple::developer_token()?;
    let user = apple_state
        .user_token
        .lock_or_recover()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let sf = storefront(&client, &dev, &user, &db).await?;

    let songs = fetch_catalog_songs(&client, &dev, &user, &sf, &[cid]).await?;
    let conn = db.lock();
    match songs.first() {
        Some(s) => {
            write_song(&conn, s, Some(&cover_url))?;
            Ok((!s.palette.is_empty()).then(|| s.palette.clone()))
        }
        None => {
            // The id 404'd out of the catalog: cache the empty palette under the
            // requested key so we don't re-fetch on every track change.
            conn.execute(
                "INSERT OR IGNORE INTO album_palette(cover_url, bg, c1, c2, fetched_at)
                 VALUES(?1, NULL, NULL, NULL, ?2)",
                rusqlite::params![cover_url, now_ms()],
            )
            .map_err(|e| e.to_string())?;
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-15 (G1 = A, ideas/apple-calls.md §5.6): the guests pass reads each library song
    /// once. A song with stored artists, or marked `[]` (asked, none), is not asked again; a
    /// seen song and a song with no catalog id are never asked.
    #[test]
    fn guests_pass_asks_each_library_song_once_2026_10_15() {
        let conn = Connection::open_in_memory().unwrap();
        crate::library::init_db(&conn).unwrap();
        init_tables(&conn).unwrap();
        migrate_v19(&conn).unwrap();
        let put = |id: &str, source: &str, json: &str| {
            conn.execute("INSERT INTO tracks(track_id, source, json) VALUES(?1, ?2, ?3)", [id, source, json]).unwrap();
        };
        put("1", "library", r#"{"catalogId":"1","title":"a"}"#);
        put("2", "library", r#"{"catalogId":"2","title":"b"}"#);
        put("3", "seen", r#"{"catalogId":"3","title":"c"}"#);
        put("i.4", "library", r#"{"libraryId":"i.4","title":"d"}"#);
        // Song 2 was read before v19 (a row with no artists): it is still to read.
        conn.execute("INSERT INTO track_catalog(catalog_id, fetched_at) VALUES('2', 0)", []).unwrap();
        let mut todo = guests_pending(&conn).unwrap();
        todo.sort();
        assert_eq!(todo, vec!["1".to_string(), "2".to_string()]);
        // One read: song 1 came back with its artists, song 2 did not come back.
        conn.execute("INSERT INTO track_catalog(catalog_id, fetched_at, artists) VALUES('1', 0, '[[\"9\",\"A\"]]')", []).unwrap();
        mark_read(&conn, &todo).unwrap();
        assert!(guests_pending(&conn).unwrap().is_empty());
        let kept: String = conn.query_row("SELECT artists FROM track_catalog WHERE catalog_id = '1'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, r#"[["9","A"]]"#);
    }
}

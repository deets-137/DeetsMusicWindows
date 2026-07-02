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

/// Documented ceiling for "Get Multiple Catalog Songs" by ids.
const BATCH: usize = 300;

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
        );",
    )
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

fn cached_storefront(conn: &Connection) -> Option<String> {
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
    if let Some(sf) = cached_storefront(&db.0.lock().unwrap()) {
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
    db.0.lock()
        .unwrap()
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
}

async fn fetch_catalog_songs(
    client: &reqwest::Client,
    dev: &str,
    mut_tok: &str,
    sf: &str,
    ids: &[String],
) -> Result<Vec<FetchedSong>, String> {
    let url = format!(
        "https://api.music.apple.com/v1/catalog/{sf}/songs?ids={}",
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
    conn.execute(
        "INSERT INTO track_catalog(catalog_id, isrc, preview_url, cover_url, fetched_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(catalog_id) DO UPDATE SET
             isrc = excluded.isrc, preview_url = excluded.preview_url,
             cover_url = excluded.cover_url, fetched_at = excluded.fetched_at",
        rusqlite::params![s.catalog_id, s.isrc, s.preview_url, s.cover_url, now],
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
        };
        write_song(conn, &song, None)?;
    }
    Ok(())
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
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT 1 FROM track_catalog WHERE catalog_id = ?1")
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
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = storefront(&client, &dev, &user, &db).await?;

    let mut fetched = 0usize;
    for chunk in misses.chunks(BATCH) {
        let songs = fetch_catalog_songs(&client, &dev, &user, &sf, chunk).await?;
        fetched += songs.len();
        let conn = db.0.lock().unwrap();
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
        let conn = db.0.lock().unwrap();
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
        .lock()
        .unwrap()
        .clone()
        .ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = storefront(&client, &dev, &user, &db).await?;

    let songs = fetch_catalog_songs(&client, &dev, &user, &sf, &[cid]).await?;
    let conn = db.0.lock().unwrap();
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

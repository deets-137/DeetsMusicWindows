//! The Diary — an album journal (docs/features/DIARY.md). The user picks an album, listens,
//! and writes a note and a score for each song and for the album. All local: nothing here
//! talks to Apple, and none of it is in the `query` export (LOCAL-DATA.md) — a diary is
//! private until the owner decides otherwise.
//!
//! **One entry per album.** The key is the album's catalog id, else its library id, else
//! its title and artist. Picking an album that already has an entry opens that entry and
//! refreshes its song list; the notes stay.
//!
//! **Scores are the numbers the user typed** (his call 7B, 2026-09-24). A score is any
//! finite number from 0 up; the scale's top (`scale_max`) is any number above 0. Changing
//! the scale never changes a score by itself: `diary_rescale` is its own command, and the
//! front end asks first (or follows Settings › Diary › When you change a scale).
//!
//! **Dates are the user's local day as text** (`YYYY-MM-DD`), written by the front end,
//! because the review date is a day on the user's calendar, not an instant. NULL = not kept.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::library::Db;
use crate::model::{Album, Track};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// v14 (2026-09-24): the diary tables (DIARY.md §3). Additive, idempotent.
pub fn migrate_v14(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS diary_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            album_key   TEXT NOT NULL UNIQUE,
            album_json  TEXT NOT NULL,
            tracks_json TEXT NOT NULL,
            scale_max   REAL NOT NULL DEFAULT 10,
            score       REAL,
            note        TEXT NOT NULL DEFAULT '',
            review_date TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS diary_songs (
            entry_id   INTEGER NOT NULL,
            song_key   TEXT NOT NULL,
            score      REAL,
            note       TEXT NOT NULL DEFAULT '',
            note_date  TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (entry_id, song_key)
        );",
    )
    .map_err(|e| format!("create diary tables: {e}"))?;
    crate::library::meta_set(conn, "schema_version", "14")
}

/// The entry's key: catalog id, else library id, else title + artist (lowercased).
fn album_key(a: &Album) -> String {
    if let Some(c) = a.catalog_id.as_deref().filter(|s| !s.is_empty()) {
        return format!("c:{c}");
    }
    if let Some(l) = a.library_id.as_deref().filter(|s| !s.is_empty()) {
        return format!("l:{l}");
    }
    format!("n:{}|{}", a.title.to_lowercase(), a.artist_name.to_lowercase())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarySong {
    pub song_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    pub note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_date: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntry {
    pub id: i64,
    pub album: Album,
    pub tracks: Vec<Track>,
    pub scale_max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    pub note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_date: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub songs: Vec<DiarySong>,
}

/// One shelf tile: the album, its scale and score, and how far the notes got.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarySummary {
    pub id: i64,
    pub album: Album,
    pub scale_max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_date: Option<String>,
    pub updated_at: i64,
    pub song_count: usize,
    /// Songs with a score or a note.
    pub songs_done: i64,
}

/// Every entry, the newest touched first (the shelf's order).
#[tauri::command]
pub fn diary_list(db: State<'_, Db>) -> Result<Vec<DiarySummary>, String> {
    let conn = db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.album_json, e.tracks_json, e.scale_max, e.score, e.review_date, e.updated_at,
                    (SELECT COUNT(*) FROM diary_songs s
                      WHERE s.entry_id = e.id AND (s.score IS NOT NULL OR s.note <> ''))
             FROM diary_entries e ORDER BY e.updated_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, Option<f64>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (id, album, tracks, scale_max, score, review_date, updated_at, songs_done) = row.map_err(err)?;
        let Ok(album) = serde_json::from_str::<Album>(&album) else { continue };
        let song_count = serde_json::from_str::<Vec<Value>>(&tracks).map(|v| v.len()).unwrap_or(0);
        out.push(DiarySummary { id, album, scale_max, score, review_date, updated_at, song_count, songs_done });
    }
    Ok(out)
}

fn read_entry(conn: &Connection, id: i64) -> Result<DiaryEntry, String> {
    let (album, tracks, scale_max, score, note, review_date, created_at, updated_at) = conn
        .query_row(
            "SELECT album_json, tracks_json, scale_max, score, note, review_date, created_at, updated_at
             FROM diary_entries WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, Option<f64>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| format!("diary: no entry {id}"))?;
    let mut stmt = conn
        .prepare("SELECT song_key, score, note, note_date, updated_at FROM diary_songs WHERE entry_id = ?1")
        .map_err(err)?;
    let songs = stmt
        .query_map([id], |r| {
            Ok(DiarySong {
                song_key: r.get(0)?,
                score: r.get(1)?,
                note: r.get(2)?,
                note_date: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(DiaryEntry {
        id,
        album: serde_json::from_str(&album).map_err(err)?,
        tracks: serde_json::from_str(&tracks).unwrap_or_default(),
        scale_max,
        score,
        note,
        review_date,
        created_at,
        updated_at,
        songs,
    })
}

#[tauri::command]
pub fn diary_get(id: i64, db: State<'_, Db>) -> Result<DiaryEntry, String> {
    read_entry(&db.lock(), id)
}

/// Open the album's entry, making it when there is none. An existing entry takes the new
/// song list (a pre-release album gains its songs this way); its notes and scores stay.
/// `today` is the user's local day: a new entry's review date starts on it (fork 8B).
#[tauri::command]
pub fn diary_open(album: Album, tracks: Vec<Track>, today: Option<String>, db: State<'_, Db>) -> Result<DiaryEntry, String> {
    let key = album_key(&album);
    let album_json = serde_json::to_string(&album).map_err(err)?;
    let tracks_json = serde_json::to_string(&tracks).map_err(err)?;
    let now = now_ms();
    let conn = db.lock();
    let found: Option<i64> = conn
        .query_row("SELECT id FROM diary_entries WHERE album_key = ?1", [&key], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let id = match found {
        Some(id) => {
            // An empty list never replaces a real one (a failed fetch hands over nothing).
            if !tracks.is_empty() {
                conn.execute(
                    "UPDATE diary_entries SET album_json = ?1, tracks_json = ?2 WHERE id = ?3",
                    params![album_json, tracks_json, id],
                )
                .map_err(err)?;
            }
            id
        }
        None => {
            conn.execute(
                "INSERT INTO diary_entries(album_key, album_json, tracks_json, review_date, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
                params![key, album_json, tracks_json, today, now],
            )
            .map_err(err)?;
            crate::log::info(&format!("diary: new entry {}", conn.last_insert_rowid()));
            conn.last_insert_rowid()
        }
    };
    read_entry(&conn, id)
}

/// A score from the patch: a finite number, 0 or more. `Ok(None)` = cleared.
fn score_of(v: &Value) -> Result<Option<f64>, String> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => match n.as_f64() {
            Some(x) if x.is_finite() && x >= 0.0 => Ok(Some(x)),
            _ => Err("diary: a score is a number, 0 or more".into()),
        },
        _ => Err("diary: a score is a number, 0 or more".into()),
    }
}

/// A day from the patch: `YYYY-MM-DD`, or null to clear it.
fn day_of(v: &Value) -> Result<Option<String>, String> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) if s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-' => Ok(Some(s.clone())),
        _ => Err("diary: a date is YYYY-MM-DD".into()),
    }
}

/// Change the album's own fields. Only the keys present in `patch` change; null clears.
/// Keys: `score`, `note`, `reviewDate`, `scaleMax` (the scale alone — the scores stay).
#[tauri::command]
pub fn diary_update(id: i64, patch: Value, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.lock();
    if let Some(v) = patch.get("score") {
        conn.execute("UPDATE diary_entries SET score = ?1 WHERE id = ?2", params![score_of(v)?, id]).map_err(err)?;
    }
    if let Some(v) = patch.get("note") {
        let note = v.as_str().unwrap_or_default();
        conn.execute("UPDATE diary_entries SET note = ?1 WHERE id = ?2", params![note, id]).map_err(err)?;
    }
    if let Some(v) = patch.get("reviewDate") {
        conn.execute("UPDATE diary_entries SET review_date = ?1 WHERE id = ?2", params![day_of(v)?, id]).map_err(err)?;
    }
    if let Some(v) = patch.get("scaleMax") {
        let max = v.as_f64().filter(|x| x.is_finite() && *x > 0.0).ok_or("diary: a scale's top is a number above 0")?;
        conn.execute("UPDATE diary_entries SET scale_max = ?1 WHERE id = ?2", params![max, id]).map_err(err)?;
    }
    conn.execute("UPDATE diary_entries SET updated_at = ?1 WHERE id = ?2", params![now_ms(), id]).map_err(err)?;
    Ok(())
}

/// Change one song's note, score or note date. Same patch rules as `diary_update`
/// (keys `score`, `note`, `noteDate`). A song with nothing left is deleted.
#[tauri::command]
pub fn diary_song_set(entry_id: i64, song_key: String, patch: Value, db: State<'_, Db>) -> Result<(), String> {
    if song_key.is_empty() {
        return Err("diary: empty song key".into());
    }
    let now = now_ms();
    let mut conn = db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT OR IGNORE INTO diary_songs(entry_id, song_key, updated_at) VALUES(?1, ?2, ?3)",
        params![entry_id, song_key, now],
    )
    .map_err(err)?;
    if let Some(v) = patch.get("score") {
        tx.execute(
            "UPDATE diary_songs SET score = ?1 WHERE entry_id = ?2 AND song_key = ?3",
            params![score_of(v)?, entry_id, song_key],
        )
        .map_err(err)?;
    }
    if let Some(v) = patch.get("note") {
        tx.execute(
            "UPDATE diary_songs SET note = ?1 WHERE entry_id = ?2 AND song_key = ?3",
            params![v.as_str().unwrap_or_default(), entry_id, song_key],
        )
        .map_err(err)?;
    }
    if let Some(v) = patch.get("noteDate") {
        tx.execute(
            "UPDATE diary_songs SET note_date = ?1 WHERE entry_id = ?2 AND song_key = ?3",
            params![day_of(v)?, entry_id, song_key],
        )
        .map_err(err)?;
    }
    tx.execute(
        "UPDATE diary_songs SET updated_at = ?1 WHERE entry_id = ?2 AND song_key = ?3",
        params![now, entry_id, song_key],
    )
    .map_err(err)?;
    tx.execute(
        "DELETE FROM diary_songs WHERE entry_id = ?1 AND song_key = ?2
           AND score IS NULL AND note = '' AND note_date IS NULL",
        params![entry_id, song_key],
    )
    .map_err(err)?;
    tx.execute("UPDATE diary_entries SET updated_at = ?1 WHERE id = ?2", params![now, entry_id]).map_err(err)?;
    tx.commit().map_err(err)
}

/// Move every score on the entry from one scale to another in proportion (7/10 → 3.5/5) and
/// set the scale to `to_max`. Only on the user's say-so: the ask toast, or the Rescale
/// setting (fork 7B). `from_max` is explicit because the ask comes AFTER the scale changed:
/// the entry already reads the new top while the toast waits.
#[tauri::command]
pub fn diary_rescale(id: i64, from_max: f64, to_max: f64, db: State<'_, Db>) -> Result<(), String> {
    let ok = |x: f64| x.is_finite() && x > 0.0;
    if !ok(to_max) || !ok(from_max) {
        return Err("diary: a scale's top is a number above 0".into());
    }
    let k = to_max / from_max;
    let mut conn = db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "UPDATE diary_entries SET scale_max = ?1, score = score * ?2, updated_at = ?3 WHERE id = ?4",
        params![to_max, k, now_ms(), id],
    )
    .map_err(err)?;
    tx.execute("UPDATE diary_songs SET score = score * ?1 WHERE entry_id = ?2", params![k, id]).map_err(err)?;
    tx.commit().map_err(err)?;
    crate::log::info(&format!("diary: rescaled entry {id}"));
    Ok(())
}

/// Delete an entry and its songs' notes.
#[tauri::command]
pub fn diary_delete(id: i64, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM diary_songs WHERE entry_id = ?1", [id]).map_err(err)?;
    tx.execute("DELETE FROM diary_entries WHERE id = ?1", [id]).map_err(err)?;
    tx.commit().map_err(err)?;
    crate::log::info(&format!("diary: deleted entry {id}"));
    Ok(())
}

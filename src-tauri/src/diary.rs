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

/// v15 (2026-09-24): Done and folders (DIARY.md §9). `done_at` = when the entry was marked
/// done (NULL = in progress); `folder_id` = the user folder it is filed in (NULL = none). The
/// In progress and Completed rows are drawn from `done_at`, so they are not folders here.
/// Additive, idempotent.
pub fn migrate_v15(conn: &Connection) -> Result<(), String> {
    let has = |col: &str| -> Result<bool, String> {
        let mut stmt = conn.prepare("SELECT name FROM pragma_table_info('diary_entries')").map_err(err)?;
        let names = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?.collect::<Result<Vec<_>, _>>().map_err(err)?;
        Ok(names.iter().any(|n| n == col))
    };
    if !has("done_at")? {
        conn.execute("ALTER TABLE diary_entries ADD COLUMN done_at INTEGER", []).map_err(|e| format!("add done_at: {e}"))?;
    }
    if !has("folder_id")? {
        conn.execute("ALTER TABLE diary_entries ADD COLUMN folder_id INTEGER", []).map_err(|e| format!("add folder_id: {e}"))?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS diary_folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("create diary_folders: {e}"))?;
    crate::library::meta_set(conn, "schema_version", "15")
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<i64>,
    /// Set only by the `diary_open` that made the entry: the card grows once for a new entry
    /// and selects its first song (DIARY.md §4a).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub created: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryFolder {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
}

/// Every entry, the newest touched first (the shelf's order).
#[tauri::command]
pub fn diary_list(db: State<'_, Db>) -> Result<Vec<DiarySummary>, String> {
    list_entries(&db.lock())
}

fn list_entries(conn: &Connection) -> Result<Vec<DiarySummary>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.album_json, e.tracks_json, e.scale_max, e.score, e.review_date, e.updated_at,
                    (SELECT COUNT(*) FROM diary_songs s
                      WHERE s.entry_id = e.id AND (s.score IS NOT NULL OR s.note <> '')),
                    e.done_at, e.folder_id
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
                r.get::<_, Option<i64>>(8)?,
                r.get::<_, Option<i64>>(9)?,
            ))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (id, album, tracks, scale_max, score, review_date, updated_at, songs_done, done_at, folder_id) = row.map_err(err)?;
        let Ok(album) = serde_json::from_str::<Album>(&album) else { continue };
        let song_count = serde_json::from_str::<Vec<Value>>(&tracks).map(|v| v.len()).unwrap_or(0);
        out.push(DiarySummary { id, album, scale_max, score, review_date, updated_at, song_count, songs_done, done_at, folder_id });
    }
    Ok(out)
}

fn read_entry(conn: &Connection, id: i64) -> Result<DiaryEntry, String> {
    let (album, tracks, scale_max, score, note, review_date, created_at, updated_at, done_at, folder_id) = conn
        .query_row(
            "SELECT album_json, tracks_json, scale_max, score, note, review_date, created_at, updated_at, done_at, folder_id
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
                    r.get::<_, Option<i64>>(8)?,
                    r.get::<_, Option<i64>>(9)?,
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
        done_at,
        folder_id,
        created: false,
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
    open_entry(&db.lock(), &album, &tracks, today)
}

fn open_entry(conn: &Connection, album: &Album, tracks: &[Track], today: Option<String>) -> Result<DiaryEntry, String> {
    let key = album_key(album);
    let album_json = serde_json::to_string(album).map_err(err)?;
    let tracks_json = serde_json::to_string(tracks).map_err(err)?;
    let now = now_ms();
    let find = |k: &str| -> Result<Option<i64>, String> {
        conn.query_row("SELECT id FROM diary_entries WHERE album_key = ?1", [k], |r| r.get(0)).optional().map_err(err)
    };
    let mut found = find(&key)?;
    // A library album learns its catalog id later (the front end hops song → album for the
    // export's link): the entry it already has, under its library or name key, is re-keyed.
    if found.is_none() && key.starts_with("c:") {
        let older = Album { catalog_id: None, ..album.clone() };
        let mut alt = vec![album_key(&older)];
        if album.library_id.is_some() {
            alt.push(album_key(&Album { catalog_id: None, library_id: None, ..album.clone() }));
        }
        for k in alt {
            if let Some(id) = find(&k)? {
                conn.execute("UPDATE diary_entries SET album_key = ?1 WHERE id = ?2", params![key, id]).map_err(err)?;
                found = Some(id);
                break;
            }
        }
    }
    let created = found.is_none();
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
    let mut entry = read_entry(conn, id)?;
    entry.created = created;
    Ok(entry)
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
    update_entry(&db.lock(), id, &patch)
}

fn update_entry(conn: &Connection, id: i64, patch: &Value) -> Result<(), String> {
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
    set_song(&mut db.lock(), entry_id, &song_key, &patch)
}

fn set_song(conn: &mut Connection, entry_id: i64, song_key: &str, patch: &Value) -> Result<(), String> {
    if song_key.is_empty() {
        return Err("diary: empty song key".into());
    }
    let now = now_ms();
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

/// Mark an entry done (now) or in progress again (the check button toggles, his call
/// 2026-09-24). Returns the new `done_at`. Other triggers will hang off this later (§9).
#[tauri::command]
pub fn diary_set_done(id: i64, done: bool, db: State<'_, Db>) -> Result<Option<i64>, String> {
    mark_done(&db.lock(), id, done)
}

fn mark_done(conn: &Connection, id: i64, done: bool) -> Result<Option<i64>, String> {
    let now = now_ms();
    let at = done.then_some(now);
    conn.execute(
        "UPDATE diary_entries SET done_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![at, now, id],
    )
    .map_err(err)?;
    crate::log::info(&format!("diary: entry {id} {}", if done { "done" } else { "in progress" }));
    Ok(at)
}

/// The user's folders, oldest first (a new folder appears at the end, his call 2026-09-24).
#[tauri::command]
pub fn diary_folders(db: State<'_, Db>) -> Result<Vec<DiaryFolder>, String> {
    let conn = db.lock();
    let mut stmt = conn.prepare("SELECT id, name, created_at FROM diary_folders ORDER BY created_at, id").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(DiaryFolder { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn diary_folder_create(name: String, db: State<'_, Db>) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("diary: a folder needs a name".into());
    }
    let conn = db.lock();
    conn.execute("INSERT INTO diary_folders(name, created_at) VALUES(?1, ?2)", params![name, now_ms()]).map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn diary_folder_rename(id: i64, name: String, db: State<'_, Db>) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("diary: a folder needs a name".into());
    }
    db.lock().execute("UPDATE diary_folders SET name = ?1 WHERE id = ?2", params![name, id]).map_err(err)?;
    Ok(())
}

/// Delete a folder. Its entries stay: they only leave the folder (they still sit in In
/// progress or Completed).
#[tauri::command]
pub fn diary_folder_delete(id: i64, db: State<'_, Db>) -> Result<(), String> {
    let mut conn = db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute("UPDATE diary_entries SET folder_id = NULL WHERE folder_id = ?1", [id]).map_err(err)?;
    tx.execute("DELETE FROM diary_folders WHERE id = ?1", [id]).map_err(err)?;
    tx.commit().map_err(err)
}

/// File an entry in a folder, or take it out (`folder` = None). One folder per entry.
#[tauri::command]
pub fn diary_file(id: i64, folder: Option<i64>, db: State<'_, Db>) -> Result<(), String> {
    db.lock()
        .execute("UPDATE diary_entries SET folder_id = ?1 WHERE id = ?2", params![folder, id])
        .map_err(err)?;
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

// ── Export (DIARY.md §10) ────────────────────────────────────────────────────
// One text for every way out: the tile's Export row, the Compass, the CLI and the agent.
//
//   ## OPIA by VITA | 7.5/10
//   Sep 24, 2026
//   The album note.
//
//   ## 3. PLEASER | 8/10
//   Sep 25, 2026          (only when it differs from the review's day)
//   The song note.
//
//   https://music.apple.com/album/6801682028
//
// A field that is not there is left out; a song with no note and no score is left out whole.

/// A song's key inside its entry — the same rule as `songKeyOf` in src/diary.ts.
fn song_key_of(t: &Track) -> String {
    t.catalog_id
        .clone()
        .or_else(|| t.library_id.clone())
        .unwrap_or_else(|| format!("pos:{}-{}", t.disc_number.unwrap_or(1), t.track_number.unwrap_or(0)))
}

/// A score or a top as text: up to four places, no trailing zeros (7, 7.5, 2.6767).
fn fmt_num(x: f64) -> String {
    let s = format!("{x:.4}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-" { "0".into() } else { s.to_string() }
}

/// "Sep 24, 2026" for a `YYYY-MM-DD` day ("" when it is not one).
fn fmt_day(day: &str) -> String {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let mut it = day.split('-').map(|p| p.parse::<u32>().ok());
    match (it.next().flatten(), it.next().flatten(), it.next().flatten()) {
        (Some(y), Some(m), Some(d)) if (1..=12).contains(&m) => format!("{} {d}, {y}", MONTHS[(m - 1) as usize]),
        _ => String::new(),
    }
}

pub fn export_text(e: &DiaryEntry) -> String {
    let scored = |s: Option<f64>| s.map(|x| format!(" | {}/{}", fmt_num(x), fmt_num(e.scale_max))).unwrap_or_default();
    let mut blocks: Vec<String> = Vec::new();
    let mut head = format!("## {}", e.album.title);
    if !e.album.artist_name.is_empty() {
        head.push_str(&format!(" by {}", e.album.artist_name));
    }
    head.push_str(&scored(e.score));
    let mut album = vec![head];
    if let Some(d) = e.review_date.as_deref().map(fmt_day).filter(|d| !d.is_empty()) {
        album.push(d);
    }
    if !e.note.trim().is_empty() {
        album.push(e.note.trim().to_string());
    }
    blocks.push(album.join("\n"));
    for (i, t) in e.tracks.iter().enumerate() {
        let key = song_key_of(t);
        let Some(s) = e.songs.iter().find(|s| s.song_key == key) else { continue };
        if s.score.is_none() && s.note.trim().is_empty() {
            continue;
        }
        let n = t.track_number.map(|n| n as usize).unwrap_or(i + 1);
        let mut lines = vec![format!("## {n}. {}{}", t.title, scored(s.score))];
        if let Some(d) = s.note_date.as_deref().filter(|d| Some(*d) != e.review_date.as_deref()).map(fmt_day).filter(|d| !d.is_empty()) {
            lines.push(d);
        }
        if !s.note.trim().is_empty() {
            lines.push(s.note.trim().to_string());
        }
        blocks.push(lines.join("\n"));
    }
    if let Some(id) = e.album.catalog_id.as_deref().filter(|s| !s.is_empty()) {
        blocks.push(format!("https://music.apple.com/album/{id}"));
    }
    blocks.join("\n\n")
}

#[tauri::command]
pub fn diary_export(id: i64, db: State<'_, Db>) -> Result<String, String> {
    Ok(export_text(&read_entry(&db.lock(), id)?))
}

// ── The agent and the CLI (DIARY.md §10; AGENT.md) ───────────────────────────
// Read and write, behind Settings › Connections › Agents use the Diary (his call 2026-09-24;
// off by default, and only the user can turn it on). The bridge checks the switch; these
// only do the work. Every write tells the window (`diary-changed`) so an open Diary redraws.

/// The refusal while the switch is off (the bridge answers it 403, the CLI exits 6).
pub const AGENT_OFF: &str = "The Diary is off for agents. Turn on Agents use the Diary in DeetsMusic › Settings › Connections.";

/// `GET /diary` — every entry, newest touched first. `GET /diary?id=N` — one entry, with its
/// songs and the export text.
pub fn agent_read(conn: &Connection, id: Option<i64>) -> Result<Value, String> {
    let Some(id) = id else {
        let folders: std::collections::HashMap<i64, String> = {
            let mut stmt = conn.prepare("SELECT id, name FROM diary_folders").map_err(err)?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(err)?;
            rows.collect::<Result<_, _>>().map_err(err)?
        };
        let entries: Vec<Value> = list_entries(conn)?
            .iter()
            .map(|s| {
                serde_json::json!({
                    "id": s.id,
                    "title": s.album.title,
                    "artist": s.album.artist_name,
                    "score": s.score.map(|x| format!("{}/{}", fmt_num(x), fmt_num(s.scale_max))),
                    "done": s.done_at.is_some(),
                    "folder": s.folder_id.and_then(|f| folders.get(&f).cloned()),
                    "reviewDate": s.review_date,
                    "songsWritten": s.songs_done,
                    "songCount": s.song_count,
                })
            })
            .collect();
        return Ok(serde_json::json!({ "entries": entries }));
    };
    let e = read_entry(conn, id)?;
    let songs: Vec<Value> = e
        .tracks
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let s = e.songs.iter().find(|s| s.song_key == song_key_of(t));
            serde_json::json!({
                "n": t.track_number.map(|n| n as usize).unwrap_or(i + 1),
                "title": t.title,
                "score": s.and_then(|s| s.score).map(fmt_num),
                "note": s.map(|s| s.note.clone()).filter(|n| !n.is_empty()),
                "noteDate": s.and_then(|s| s.note_date.clone()),
                "unreleased": t.unreleased,
            })
        })
        .collect();
    Ok(serde_json::json!({
        "entry": {
            "id": e.id,
            "title": e.album.title,
            "artist": e.album.artist_name,
            "scale": fmt_num(e.scale_max),
            "score": e.score.map(fmt_num),
            "note": e.note,
            "reviewDate": e.review_date,
            "done": e.done_at.is_some(),
            "songs": songs,
        },
        "text": export_text(&e),
    }))
}

/// The song `n` of an entry: its track number, else its place in the list (1-based).
fn song_at(e: &DiaryEntry, n: u32) -> Result<String, String> {
    e.tracks
        .iter()
        .find(|t| t.track_number == Some(n))
        .or_else(|| e.tracks.get((n as usize).wrapping_sub(1)))
        .map(song_key_of)
        .ok_or_else(|| format!("entry {} has no song {n}", e.id))
}

fn today_local() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// `POST /diary` — `{action, id?, album?, song?, value?}`:
/// add (album: album:<catalog id>) · note · score · date (id, song? = the album when absent,
/// value; an empty value clears) · done (id, value on | off; on when absent).
pub async fn agent_write(app: &tauri::AppHandle, body: &Value) -> Result<Value, String> {
    use tauri::{Emitter, Manager};
    let action = body.get("action").and_then(Value::as_str).unwrap_or("");
    let text = |k: &str| body.get(k).map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string())).unwrap_or_default();
    let id = body.get("id").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())));
    let song = body.get("song").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))).map(|n| n as u32);
    let value = text("value");
    let message = match action {
        "add" => {
            let album = text("album");
            let cid = album.strip_prefix("album:").unwrap_or(&album).trim().to_string();
            if cid.is_empty() {
                return Err("add needs an album: album:… from search".into());
            }
            let tracks = crate::apple::catalog_collection_tracks(
                "albums".into(),
                cid.clone(),
                app.state::<crate::apple::AppleState>(),
                app.state::<Db>(),
            )
            .await?;
            let t0 = tracks.first().ok_or("Apple Music lists no songs on that album")?;
            let a = Album {
                catalog_id: Some(cid),
                title: t0.album_name.clone().unwrap_or_else(|| "Unknown Album".into()),
                artist_name: t0.artist_name.clone(),
                artwork: t0.artwork.clone(),
                ..Default::default()
            };
            let e = open_entry(&app.state::<Db>().lock(), &a, &tracks, Some(today_local()))?;
            let verb = if e.created { "Added" } else { "Opened (already in the Diary)" };
            format!("{verb}: {} by {} — entry {}.", e.album.title, e.album.artist_name, e.id)
        }
        "note" | "score" | "date" | "done" => {
            let id = id.ok_or("this action needs the entry's id — see diary list")?;
            let db = app.state::<Db>();
            let mut conn = db.lock();
            let e = read_entry(&conn, id)?;
            let what = match song {
                Some(n) => format!("song {n} of {}", e.album.title),
                None => e.album.title.clone(),
            };
            match action {
                "done" => {
                    let on = !matches!(value.trim(), "off" | "false" | "no");
                    mark_done(&conn, id, on)?;
                    format!("{} is {}.", e.album.title, if on { "done" } else { "in progress again" })
                }
                "note" => {
                    let patch = match song {
                        // A song note's day is set when its first word goes in, as in the card.
                        Some(n) => {
                            let key = song_at(&e, n)?;
                            let had = e.songs.iter().any(|s| s.song_key == key && (!s.note.is_empty() || s.note_date.is_some()));
                            let mut p = serde_json::json!({ "note": value });
                            if !had && !value.is_empty() {
                                p["noteDate"] = today_local().into();
                            }
                            set_song(&mut conn, id, &key, &p)?;
                            p
                        }
                        None => {
                            let p = serde_json::json!({ "note": value });
                            update_entry(&conn, id, &p)?;
                            p
                        }
                    };
                    let _ = patch;
                    if value.is_empty() { format!("Cleared the note on {what}.") } else { format!("Wrote the note on {what}.") }
                }
                "score" => {
                    let v = value.trim().replace(',', ".");
                    let score: Value = if v.is_empty() || v == "clear" {
                        Value::Null
                    } else {
                        let x: f64 = v.parse().map_err(|_| format!("{value:?} is not a number"))?;
                        if !(x.is_finite() && x >= 0.0 && x <= e.scale_max) {
                            return Err(format!("a score on this entry is a number from 0 to {}", fmt_num(e.scale_max)));
                        }
                        serde_json::json!(x)
                    };
                    let p = serde_json::json!({ "score": score });
                    match song {
                        Some(n) => set_song(&mut conn, id, &song_at(&e, n)?, &p)?,
                        None => update_entry(&conn, id, &p)?,
                    }
                    match score.as_f64() {
                        Some(x) => format!("Scored {what} {}/{}.", fmt_num(x), fmt_num(e.scale_max)),
                        None => format!("Cleared the score on {what}."),
                    }
                }
                _ => {
                    // date
                    let v = value.trim();
                    let day: Value = if v.is_empty() || v == "clear" { Value::Null } else if v == "today" { today_local().into() } else { v.into() };
                    match song {
                        Some(n) => set_song(&mut conn, id, &song_at(&e, n)?, &serde_json::json!({ "noteDate": day }))?,
                        None => update_entry(&conn, id, &serde_json::json!({ "reviewDate": day }))?,
                    }
                    match day.as_str() {
                        Some(d) => format!("Dated {what} {}.", fmt_day(d)),
                        None => format!("Cleared the date on {what}."),
                    }
                }
            }
        }
        other => return Err(format!("{other:?} is not a diary action — use add, note, score, date or done")),
    };
    crate::log::info(&format!("diary: agent {action}")); // ids and verbs only (LOGGING.md)
    let _ = app.emit("diary-changed", ());
    Ok(serde_json::json!({ "ok": true, "message": message }))
}

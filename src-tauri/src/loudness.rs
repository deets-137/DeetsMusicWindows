//! Match loudness storage (SOUND.md §3A — phase 5).
//!
//! The front end measures a song while it plays (the element worklet's K-weighted meter,
//! BS.1770-4) and saves one row when at least 80 % was heard without a jump forward. It loads
//! every row once at launch (a few thousand small rows) and keeps them in memory, so picking a
//! song's gain needs no round trip. A later full listen replaces the row.

use rusqlite::Connection;

/// v7 (2026-09-16): the `loudness` table. `lufs` is integrated loudness; `peak_db` the sample
/// peak in dBFS, both with MusicKit's volume divided out; `heard` the fraction measured.
pub fn migrate_v7(conn: &Connection) -> Result<(), String> {
    let has: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'loudness'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if has == 0 {
        conn.execute_batch(
            "CREATE TABLE loudness (
                song_id     TEXT PRIMARY KEY,
                lufs        REAL NOT NULL,
                peak_db     REAL NOT NULL,
                heard       REAL NOT NULL,
                measured_at INTEGER NOT NULL
            );",
        )
        .map_err(|e| format!("create loudness: {e}"))?;
        crate::log::info("migration: v7 added the loudness table");
    }
    crate::library::meta_set(conn, "schema_version", "7")
}

/// Every measurement: `[song_id, lufs, peak_db]`.
#[tauri::command]
pub async fn loudness_all(app: tauri::AppHandle) -> Result<Vec<(String, f64, f64)>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn.prepare_cached("SELECT song_id, lufs, peak_db FROM loudness").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    })
    .await
}

#[tauri::command]
pub async fn loudness_save(song_id: String, lufs: f64, peak_db: f64, heard: f64, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        if song_id.is_empty() || !lufs.is_finite() || !peak_db.is_finite() {
            return Err("loudness_save: bad measurement".into());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let conn = db.lock();
        conn.execute(
            "INSERT INTO loudness(song_id, lufs, peak_db, heard, measured_at) VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(song_id) DO UPDATE SET lufs = ?2, peak_db = ?3, heard = ?4, measured_at = ?5",
            rusqlite::params![song_id, lufs, peak_db, heard, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Forget measurements (the panel's action). Returns how many rows went.
#[tauri::command]
pub async fn loudness_forget(app: tauri::AppHandle) -> Result<usize, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let n = conn.execute("DELETE FROM loudness", []).map_err(|e| e.to_string())?;
        crate::log::info(&format!("loudness: forgot {n} measurement(s)"));
        Ok(n)
    })
    .await
}

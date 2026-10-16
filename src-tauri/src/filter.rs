//! Filter rules and Rulez Playlists (docs/features/filter-rules.md).
//!
//! A filter rule is a condition asked of each song in a pool. The page holds the condition
//! and runs it (filter-eval.ts, the rules engine's `evalCond`, his call F2). This module keeps
//! the store (one row per saved filter; a row with a playlist is a Rulez Playlist) and gives
//! the page, in ONE read, the songs of the sources and the facts it cannot read itself:
//! play counts, the Diary, Song of the Day, playlists, pins, Last.fm counts.
//!
//! **The read never takes the app's lock** (§13.1a). It opens the file read-only on a
//! blocking thread of its own; the database is in WAL mode, so the read and the writer do
//! not wait for each other. Every write here goes through the database thread as usual.
//!
//! **A hand edit wins** (§13.1a). Every hand edit to a Rulez Playlist (an add, a remove, a
//! move) changes its Keep or Never list and adds one to its `version`, in the same
//! transaction as the edit. A pass writes only when the version is the one it started on.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::Value;
use tauri::Emitter;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const DAY_MS: i64 = 86_400_000;

/// v21 (2026-10-16): the `filter_rules` table (filter-rules.md §3). Additive, idempotent.
/// `json` is the rule as the page writes it (name, condition, sources, order, limit).
/// `playlist_id` set = a Rulez Playlist (a `local_playlists` row with role `rulez`).
/// `keep` / `never`: JSON lists of song keys. `version`: one more on every hand or rule edit.
pub fn migrate_v21(conn: &Connection) -> Result<(), String> {
    let had: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'filter_rules'", [], |r| r.get(0))
        .map_err(err)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS filter_rules (
            id          TEXT PRIMARY KEY,
            json        TEXT NOT NULL,
            position    INTEGER NOT NULL,
            playlist_id INTEGER,
            refresh     TEXT,
            keep        TEXT NOT NULL DEFAULT '[]',
            never       TEXT NOT NULL DEFAULT '[]',
            version     INTEGER NOT NULL DEFAULT 0,
            made_at     INTEGER,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_filter_rules_playlist ON filter_rules(playlist_id);",
    )
    .map_err(|e| format!("filter_rules table: {e}"))?;
    if had == 0 {
        crate::log::info("migration: v21 added filter_rules");
    }
    crate::library::meta_set(conn, "schema_version", "21")
}

// ── the store ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FilterRow {
    pub id: String,
    pub rule: Value,
    pub playlist_id: Option<i64>,
    pub refresh: Option<String>,
    pub keep: Vec<String>,
    pub never: Vec<String>,
    pub version: i64,
    pub made_at: Option<i64>,
}

const SELECT_ROW: &str = "SELECT id, json, playlist_id, refresh, keep, never, version, made_at FROM filter_rules";

fn row_of(r: &rusqlite::Row) -> rusqlite::Result<FilterRow> {
    let list = |s: String| serde_json::from_str::<Vec<String>>(&s).unwrap_or_default();
    Ok(FilterRow {
        id: r.get(0)?,
        rule: serde_json::from_str(&r.get::<_, String>(1)?).unwrap_or(Value::Null),
        playlist_id: r.get(2)?,
        refresh: r.get(3)?,
        keep: list(r.get(4)?),
        never: list(r.get(5)?),
        version: r.get(6)?,
        made_at: r.get(7)?,
    })
}

fn list_rows(conn: &Connection) -> Result<Vec<FilterRow>, String> {
    let mut st = conn.prepare_cached(&format!("{SELECT_ROW} ORDER BY position, id")).map_err(err)?;
    let rows = st.query_map([], row_of).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

fn changed(app: &tauri::AppHandle) {
    app.emit("filters-changed", ()).ok();
}

#[tauri::command]
pub async fn filters_list(app: tauri::AppHandle) -> Result<Vec<FilterRow>, String> {
    crate::db_thread::run(&app, move |db| list_rows(&db.lock())).await
}

/// Save a filter (new or changed). A Rulez Playlist's name follows the rule's name. Returns the
/// new version: a pass that started before this save writes nothing.
#[tauri::command]
pub async fn filter_save(id: String, rule: Value, app: tauri::AppHandle) -> Result<i64, String> {
    let out = crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let json = serde_json::to_string(&rule).map_err(err)?;
        let now = now_ms();
        let tx = conn.transaction().map_err(err)?;
        let n = tx
            .execute("UPDATE filter_rules SET json = ?2, version = version + 1, updated_at = ?3 WHERE id = ?1", params![id, json, now])
            .map_err(err)?;
        if n == 0 {
            tx.execute(
                "INSERT INTO filter_rules(id, json, position, updated_at)
                 VALUES(?1, ?2, (SELECT COALESCE(MAX(position) + 1, 0) FROM filter_rules), ?3)",
                params![id, json, now],
            )
            .map_err(err)?;
        }
        let name = rule.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !name.is_empty() {
            tx.execute(
                "UPDATE local_playlists SET name = ?2, updated_at = ?3
                 WHERE id = (SELECT playlist_id FROM filter_rules WHERE id = ?1) AND name <> ?2",
                params![id, name, now],
            )
            .map_err(err)?;
        }
        let v: i64 = tx.query_row("SELECT version FROM filter_rules WHERE id = ?1", [&id], |r| r.get(0)).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(v)
    })
    .await?;
    changed(&app);
    Ok(out)
}

/// Delete a saved filter. A Rulez Playlist's songs stay, as an ordinary playlist.
#[tauri::command]
pub async fn filter_delete(id: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let tx = conn.transaction().map_err(err)?;
        tx.execute(
            "UPDATE local_playlists SET role = NULL WHERE role = 'rulez' AND id = (SELECT playlist_id FROM filter_rules WHERE id = ?1)",
            [&id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM filter_rules WHERE id = ?1", [&id]).map_err(err)?;
        tx.commit().map_err(err)
    })
    .await?;
    changed(&app);
    Ok(())
}

/// Tie a saved filter to a playlist the page just made (role `rulez`): it is a Rulez Playlist now.
#[tauri::command]
pub async fn filter_attach(id: String, playlist_id: i64, refresh: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let n = conn
            .execute(
                "UPDATE filter_rules SET playlist_id = ?2, refresh = ?3, version = version + 1, updated_at = ?4 WHERE id = ?1",
                params![id, playlist_id, refresh, now_ms()],
            )
            .map_err(err)?;
        if n == 0 {
            return Err("That filter was deleted.".into());
        }
        Ok(())
    })
    .await?;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn filter_set_refresh(id: String, refresh: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        db.lock()
            .execute("UPDATE filter_rules SET refresh = ?2, updated_at = ?3 WHERE id = ?1", params![id, refresh, now_ms()])
            .map(|_| ())
            .map_err(err)
    })
    .await?;
    changed(&app);
    Ok(())
}

/// The editor's Undo on a Keep or Never song: the lists as the page now has them.
#[tauri::command]
pub async fn filter_set_lists(id: String, keep: Vec<String>, never: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        db.lock()
            .execute(
                "UPDATE filter_rules SET keep = ?2, never = ?3, version = version + 1, updated_at = ?4 WHERE id = ?1",
                params![id, serde_json::to_string(&keep).map_err(err)?, serde_json::to_string(&never).map_err(err)?, now_ms()],
            )
            .map(|_| ())
            .map_err(err)
    })
    .await?;
    changed(&app);
    Ok(())
}

/// A pass's result. `tracks: None` = the list did not change: only the time is stamped (Daily
/// and Weekly read it). False when the version moved on (a hand edit or a rule edit came in
/// while the pass ran): nothing is written, and the page runs a new pass.
#[tauri::command]
pub async fn filter_write(id: String, version: i64, tracks: Option<Vec<crate::model::Track>>, app: tauri::AppHandle) -> Result<bool, String> {
    crate::db_thread::run(&app, move |db| {
        let mut conn = db.lock();
        let tx = conn.transaction().map_err(err)?;
        let row: Option<(i64, Option<i64>)> = tx
            .query_row("SELECT version, playlist_id FROM filter_rules WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(err)?;
        let Some((now_version, Some(playlist))) = row else { return Ok(false) };
        if now_version != version {
            return Ok(false);
        }
        if let Some(tracks) = &tracks {
            let jsons = tracks.iter().map(|t| serde_json::to_string(t).map_err(err)).collect::<Result<Vec<_>, _>>()?;
            crate::playlists::rewrite_local(&tx, playlist, &jsons)?;
        }
        tx.execute("UPDATE filter_rules SET made_at = ?2 WHERE id = ?1", params![id, now_ms()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(true)
    })
    .await
}

// ── hand edits on a Rulez Playlist (F4) ─────────────────────────────────────

/// A song's key in a stored Track's json: catalog first, as `library::track_key`.
pub(crate) fn json_key(json: &str) -> Option<String> {
    ids_key(json).map(|(k, _)| k)
}

/// Keep and Never follow the hand (filter-rules.md §13.2): a song you add stays, a song you
/// remove stays out, a move puts the playlist in your order. In the caller's transaction, so
/// the edit and its record land together. True when the playlist is a Rulez Playlist.
pub(crate) fn on_hand(tx: &rusqlite::Transaction, playlist_id: i64, added: &[String], removed: &[String], moved: bool) -> Result<bool, String> {
    let row: Option<(String, String, String, String)> = tx
        .query_row("SELECT id, json, keep, never FROM filter_rules WHERE playlist_id = ?1", [playlist_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()
        .map_err(err)?;
    let Some((id, json, keep, never)) = row else { return Ok(false) };
    let mut keep: Vec<String> = serde_json::from_str(&keep).unwrap_or_default();
    let mut never: Vec<String> = serde_json::from_str(&never).unwrap_or_default();
    for k in added {
        never.retain(|x| x != k);
        if !keep.contains(k) {
            keep.push(k.clone());
        }
    }
    for k in removed {
        keep.retain(|x| x != k);
        if !never.contains(k) {
            never.push(k.clone());
        }
    }
    let mut rule: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
    if moved {
        rule["order"] = serde_json::json!({ "by": "hand", "dir": "asc" });
    }
    tx.execute(
        "UPDATE filter_rules SET json = ?2, keep = ?3, never = ?4, version = version + 1, updated_at = ?5 WHERE id = ?1",
        params![id, serde_json::to_string(&rule).map_err(err)?, serde_json::to_string(&keep).map_err(err)?, serde_json::to_string(&never).map_err(err)?, now_ms()],
    )
    .map_err(err)?;
    Ok(true)
}

/// A Rulez Playlist deleted: its filter goes with it.
pub(crate) fn on_playlist_delete(tx: &rusqlite::Transaction, playlist_id: i64) -> Result<bool, String> {
    Ok(tx.execute("DELETE FROM filter_rules WHERE playlist_id = ?1", [playlist_id]).map_err(err)? > 0)
}

/// A Rulez Playlist renamed: the rule's name follows.
pub(crate) fn on_playlist_rename(conn: &Connection, playlist_id: i64, name: &str) -> Result<bool, String> {
    let row: Option<(String, String)> = conn
        .query_row("SELECT id, json FROM filter_rules WHERE playlist_id = ?1", [playlist_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(err)?;
    let Some((id, json)) = row else { return Ok(false) };
    let mut rule: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
    rule["name"] = Value::String(name.to_string());
    conn.execute(
        "UPDATE filter_rules SET json = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, serde_json::to_string(&rule).map_err(err)?, now_ms()],
    )
    .map_err(err)?;
    Ok(true)
}

pub(crate) fn emit_changed(app: &tauri::AppHandle) {
    changed(app);
}

// ── the read (one per pass, off the lock) ───────────────────────────────────

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReadReq {
    /// The sources other than the library (the page holds the library's songs).
    #[serde(default)]
    pub sources: Vec<String>,
    /// The fact ids the rules read that only this read can give.
    #[serde(default)]
    pub facts: Vec<String>,
    /// Each Rewind window's start (ms), from the page's `windowStart`.
    #[serde(default)]
    pub since: HashMap<String, i64>,
    /// The library is in the pool: send every song's values (else only the pool's and `keys`').
    #[serde(default)]
    pub library: bool,
    /// Values for these songs too (a Rulez Playlist's songs now, for Keep).
    #[serde(default)]
    pub keys: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PoolSong {
    pub key: String,
    /// The source the song came from, for the editor's count.
    pub from: String,
    /// The stored Track, as stored: no parse and re-write (the library read's way).
    pub track: Box<RawValue>,
}

/// `facts`: one column per fact, song key → value, and only the songs that HAVE a value. The
/// page fills the rest: 0 for a count, false for a yes / no, [] for the playlists, and nothing
/// (missing) for a score or a date. Sparse, so a 20,000-song library is not 20,000 × N entries
/// (the gate, filter-rules.md §13.1b: 170 ms → see the test).
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReadOut {
    pub pool: Vec<PoolSong>,
    pub facts: HashMap<String, HashMap<String, Value>>,
    pub ms: u64,
}

/// The two ids of a stored Track, read without the rest of it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ids {
    catalog_id: Option<String>,
    library_id: Option<String>,
    #[serde(default)]
    unreleased: bool,
}
fn ids_key(json: &str) -> Option<(String, bool)> {
    let ids: Ids = serde_json::from_str(json).ok()?;
    Some((ids.catalog_id.or(ids.library_id)?, ids.unreleased))
}

#[tauri::command]
pub async fn filter_read(req: ReadReq) -> Result<ReadOut, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let path = crate::query::db_path().ok_or("the database is not open yet")?;
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(err)?;
        conn.busy_timeout(std::time::Duration::from_secs(2)).map_err(err)?;
        let mut out = read(&conn, &req, now_ms())?;
        out.ms = t0.elapsed().as_millis() as u64;
        crate::log::info(&format!(
            "filter: read sources={} facts={} pool={} values={} ms={}",
            req.sources.len(),
            req.facts.len(),
            out.pool.len(),
            out.facts.values().map(HashMap::len).sum::<usize>(),
            out.ms
        ));
        Ok(out)
    })
    .await
    .map_err(err)?
}

fn rows_of<T, F: FnMut(&rusqlite::Row) -> rusqlite::Result<T>>(conn: &Connection, sql: &str, p: impl rusqlite::Params, f: F) -> Result<Vec<T>, String> {
    let mut st = conn.prepare(sql).map_err(err)?;
    let rows = st.query_map(p, f).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// The pool and the facts. Pure over a connection, so `cargo test` runs it on a fixture.
pub(crate) fn read(conn: &Connection, req: &ReadReq, now: i64) -> Result<ReadOut, String> {
    let mut out = ReadOut::default();
    let mut in_pool: HashSet<String> = HashSet::new();
    let track_json = "SELECT t.json FROM tracks t";

    // ── the sources ──
    for s in &req.sources {
        let jsons: Vec<String> = match s.as_str() {
            "seen" => rows_of(conn, &format!("{track_json} WHERE t.source = 'seen'"), [], |r| r.get(0))?,
            "history" => rows_of(conn, &format!("{track_json} WHERE t.track_id IN (SELECT DISTINCT track_id FROM play_events)"), [], |r| r.get(0))?,
            "loved" => rows_of(conn, &format!("{track_json} JOIN favorites f ON f.track_id = t.track_id WHERE f.loved = 1"), [], |r| r.get(0))?,
            "sotd" => rows_of(conn, "SELECT meta FROM picks ORDER BY day DESC", [], |r| r.get(0))?,
            "diary" => {
                let lists: Vec<String> = rows_of(conn, "SELECT tracks_json FROM diary_entries ORDER BY created_at DESC", [], |r| r.get(0))?;
                lists
                    .iter()
                    .filter_map(|l| serde_json::from_str::<Vec<Box<RawValue>>>(l).ok())
                    .flatten()
                    .map(|v| v.get().to_string())
                    .collect()
            }
            "pins" => rows_of(
                conn,
                "SELECT COALESCE(p.data, t.json) FROM pins p LEFT JOIN tracks t ON t.track_id = substr(p.key, 6)
                 WHERE p.kind = 'song' AND COALESCE(p.data, t.json) IS NOT NULL ORDER BY p.pinned_at DESC",
                [],
                |r| r.get(0),
            )?,
            w if w.starts_with("rewind:") => {
                let since = req.since.get(&w[7..]).copied().unwrap_or(now);
                rows_of(
                    conn,
                    &format!("{track_json} WHERE t.track_id IN (SELECT DISTINCT track_id FROM play_events WHERE started_ts >= ?1)"),
                    [since],
                    |r| r.get(0),
                )?
            }
            p if p.starts_with("playlist:local:") => {
                let id: i64 = p[15..].parse().map_err(|_| format!("bad source {p}"))?;
                rows_of(conn, "SELECT json FROM local_playlist_tracks WHERE playlist_id = ?1 ORDER BY position", [id], |r| r.get(0))?
            }
            p if p.starts_with("playlist:") => {
                rows_of(conn, "SELECT json FROM apple_playlist_tracks WHERE playlist_id = ?1 ORDER BY position", [&p[9..]], |r| r.get(0))?
            }
            "library" => Vec::new(), // the page's own
            other => return Err(format!("unknown source {other}")),
        };
        for j in jsons {
            let Some((key, unreleased)) = ids_key(&j) else { continue };
            if unreleased || !in_pool.insert(key.clone()) {
                continue;
            }
            let track = RawValue::from_string(j).map_err(err)?;
            out.pool.push(PoolSong { key, from: s.clone(), track });
        }
    }

    // ── the facts: sparse columns ──
    let asks: HashSet<&str> = req.facts.iter().map(String::as_str).collect();
    if asks.is_empty() {
        return Ok(out);
    }
    // Without the library, only the pool's songs and the asked keys.
    let only: Option<HashSet<String>> = (!req.library).then(|| in_pool.iter().cloned().chain(req.keys.iter().cloned()).collect());
    let facts = &mut out.facts;
    let mut column = |fact: &str, rows: Vec<(String, Value)>| {
        let col = facts.entry(fact.to_string()).or_default();
        for (k, v) in rows {
            if only.as_ref().map_or(true, |o| o.contains(&k)) {
                col.insert(k, v);
            }
        }
    };
    let pairs = |sql: &str| -> Result<Vec<(String, i64)>, String> { rows_of(conn, sql, [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) };
    let days = |ts: i64| Value::from((now - ts).max(0) / DAY_MS);

    if asks.contains("inLibrary") {
        let ks: Vec<String> = rows_of(conn, "SELECT track_id FROM tracks WHERE source = 'library'", [], |r| r.get(0))?;
        column("inLibrary", ks.into_iter().map(|k| (k, Value::Bool(true))).collect());
    }
    if asks.contains("addedDays") {
        column("addedDays", pairs("SELECT track_id, ts FROM added_at")?.into_iter().map(|(k, ts)| (k, days(ts))).collect());
    }
    if asks.contains("plays") || asks.contains("finishes") || asks.contains("lastPlayedDays") {
        let rows = rows_of(conn, "SELECT track_id, partial_count, full_count, last_played FROM play_stats", [], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<i64>>(3)?))
        })?;
        if asks.contains("plays") {
            column("plays", rows.iter().map(|(k, p, _, _)| (k.clone(), Value::from(*p))).collect());
        }
        if asks.contains("finishes") {
            column("finishes", rows.iter().map(|(k, _, f, _)| (k.clone(), Value::from(*f))).collect());
        }
        if asks.contains("lastPlayedDays") {
            column("lastPlayedDays", rows.iter().filter_map(|(k, _, _, l)| l.map(|l| (k.clone(), days(l)))).collect());
        }
    }
    if asks.contains("skips") {
        let rows = pairs("SELECT track_id, COUNT(*) FROM play_events WHERE ms_listened IS NOT NULL AND completed = 0 GROUP BY track_id")?;
        column("skips", rows.into_iter().map(|(k, n)| (k, Value::from(n))).collect());
    }
    for (w, name) in [("day", "Day"), ("week", "Week"), ("month", "Month"), ("year", "Year"), ("ytd", "Ytd")] {
        let plays = format!("plays{name}");
        let minutes = format!("minutes{name}");
        if !asks.contains(plays.as_str()) && !asks.contains(minutes.as_str()) {
            continue;
        }
        let since = req.since.get(w).copied().unwrap_or(now);
        let rows = rows_of(
            conn,
            "SELECT track_id, COUNT(*), COALESCE(SUM(ms_listened), 0) FROM play_events WHERE started_ts >= ?1 GROUP BY track_id",
            [since],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
        )?;
        if asks.contains(plays.as_str()) {
            column(&plays, rows.iter().map(|(k, n, _)| (k.clone(), Value::from(*n))).collect());
        }
        if asks.contains(minutes.as_str()) {
            column(&minutes, rows.iter().map(|(k, _, ms)| (k.clone(), Value::from(ms / 60_000))).collect());
        }
    }
    if asks.contains("diaryScore") {
        // The latest score when a song is in two entries (a later insert wins).
        let rows = rows_of(conn, "SELECT song_key, score FROM diary_songs WHERE score IS NOT NULL ORDER BY updated_at", [], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })?;
        column("diaryScore", rows.into_iter().map(|(k, s)| (k, Value::from(s))).collect());
    }
    if asks.contains("inDiary") {
        let mut rows = Vec::new();
        for l in rows_of(conn, "SELECT tracks_json FROM diary_entries", [], |r| r.get::<_, String>(0))? {
            for v in serde_json::from_str::<Vec<Box<RawValue>>>(&l).unwrap_or_default() {
                if let Some((k, _)) = ids_key(v.get()) {
                    rows.push((k, Value::Bool(true)));
                }
            }
        }
        column("inDiary", rows);
    }
    if asks.contains("sotd") {
        let ks: Vec<String> = rows_of(conn, "SELECT DISTINCT track_id FROM picks", [], |r| r.get(0))?;
        column("sotd", ks.into_iter().map(|k| (k, Value::Bool(true))).collect());
    }
    if asks.contains("pinned") {
        let ks: Vec<String> = rows_of(conn, "SELECT substr(key, 6) FROM pins WHERE kind = 'song'", [], |r| r.get(0))?;
        column("pinned", ks.into_iter().map(|k| (k, Value::Bool(true))).collect());
    }
    if asks.contains("listeners") {
        let rows = pairs("SELECT track_id, listeners FROM listen_counts WHERE listeners IS NOT NULL")?;
        column("listeners", rows.into_iter().map(|(k, n)| (k, Value::from(n))).collect());
    }
    if asks.contains("inPlaylist") {
        let mut lists: HashMap<String, Vec<Value>> = HashMap::new();
        let mut add = |k: Option<(String, bool)>, p: String| {
            if let Some((k, _)) = k {
                let l = lists.entry(k).or_default();
                if !l.iter().any(|x| x.as_str() == Some(p.as_str())) {
                    l.push(Value::String(p));
                }
            }
        };
        for (id, j) in rows_of(conn, "SELECT playlist_id, json FROM local_playlist_tracks", [], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            add(ids_key(&j), format!("local:{id}"));
        }
        for (id, j) in rows_of(conn, "SELECT playlist_id, json FROM apple_playlist_tracks", [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            add(ids_key(&j), id);
        }
        column("inPlaylist", lists.into_iter().map(|(k, l)| (k, Value::Array(l))).collect());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(n: usize) -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE tracks(track_id TEXT PRIMARY KEY, source TEXT, sort_key TEXT, json TEXT);
             CREATE TABLE play_stats(track_id TEXT PRIMARY KEY, partial_count INTEGER, full_count INTEGER, last_played INTEGER);
             CREATE TABLE play_events(id INTEGER PRIMARY KEY, track_id TEXT, started_ts INTEGER, ms_listened INTEGER, completed INTEGER, context TEXT);
             CREATE INDEX idx_play_events_ts ON play_events(started_ts);
             CREATE TABLE added_at(track_id TEXT PRIMARY KEY, ts INTEGER);
             CREATE TABLE favorites(track_id TEXT PRIMARY KEY, loved INTEGER, synced_at INTEGER);
             CREATE TABLE diary_entries(id INTEGER PRIMARY KEY, album_key TEXT, album_json TEXT, tracks_json TEXT, created_at INTEGER);
             CREATE TABLE diary_songs(entry_id INTEGER, song_key TEXT, score REAL, note TEXT, updated_at INTEGER);
             CREATE TABLE picks(id INTEGER PRIMARY KEY, source TEXT, day TEXT, track_id TEXT, meta TEXT, note TEXT, marked_at INTEGER);
             CREATE TABLE pins(key TEXT PRIMARY KEY, kind TEXT, data TEXT, pinned_at INTEGER);
             CREATE TABLE listen_counts(track_id TEXT PRIMARY KEY, state TEXT, listeners INTEGER, playcount INTEGER, url TEXT, fetched_at INTEGER);
             CREATE TABLE local_playlist_tracks(playlist_id INTEGER, position INTEGER, json TEXT);
             CREATE TABLE apple_playlist_tracks(playlist_id TEXT, position INTEGER, json TEXT);",
        )
        .unwrap();
        let tx = c.unchecked_transaction().unwrap();
        for i in 0..n {
            let json = format!(r#"{{"catalogId":"c{i}","title":"Song {i}","artistName":"A{}","genres":["Jazz"],"hasLyrics":false}}"#, i % 50);
            tx.execute("INSERT INTO tracks VALUES(?1, 'library', ?1, ?2)", params![format!("c{i}"), json]).unwrap();
            tx.execute("INSERT INTO play_stats VALUES(?1, ?2, ?3, ?4)", params![format!("c{i}"), i % 9, i % 4, 1_000 + i as i64]).unwrap();
            for d in 0..(i % 5) {
                tx.execute(
                    "INSERT INTO play_events(track_id, started_ts, ms_listened, completed) VALUES(?1, ?2, ?3, ?4)",
                    params![format!("c{i}"), 10 * DAY_MS - d as i64 * DAY_MS, 60_000, (d % 2) as i64],
                )
                .unwrap();
            }
        }
        tx.execute("INSERT INTO tracks VALUES('s1', 'seen', 's1', '{\"catalogId\":\"s1\",\"title\":\"Seen\",\"artistName\":\"X\",\"genres\":[],\"hasLyrics\":false}')", []).unwrap();
        tx.execute("INSERT INTO diary_songs VALUES(1, 'c3', 8.5, '', 1)", []).unwrap();
        tx.execute("INSERT INTO diary_entries VALUES(1, 'k', '{}', '[{\"catalogId\":\"c3\",\"title\":\"Song 3\"},{\"catalogId\":\"c4\",\"title\":\"Song 4\"}]', 1)", []).unwrap();
        tx.execute("INSERT INTO picks VALUES(1, 'app', '2026-10-16', 'c7', '{\"catalogId\":\"c7\",\"title\":\"Song 7\"}', NULL, 1)", []).unwrap();
        tx.execute("INSERT INTO listen_counts VALUES('c2', 'ok', 900, 1000, NULL, 1)", []).unwrap();
        tx.execute("INSERT INTO local_playlist_tracks VALUES(5, 0, '{\"catalogId\":\"c1\"}')", []).unwrap();
        tx.execute("INSERT INTO apple_playlist_tracks VALUES('p.abc', 0, '{\"catalogId\":\"c1\"}')", []).unwrap();
        tx.execute("INSERT INTO tracks VALUES('u1', 'seen', 'u1', '{\"catalogId\":\"u1\",\"title\":\"Soon\",\"unreleased\":true}')", []).unwrap();
        tx.commit().unwrap();
        c
    }

    fn req(sources: &[&str], facts: &[&str], library: bool) -> ReadReq {
        ReadReq {
            sources: sources.iter().map(|s| s.to_string()).collect(),
            facts: facts.iter().map(|s| s.to_string()).collect(),
            since: HashMap::from([("week".to_string(), 8 * DAY_MS)]),
            library,
            keys: Vec::new(),
        }
    }

    #[test]
    fn facts_are_sparse_columns() {
        let c = fixture(10);
        let out = read(&c, &req(&[], &["plays", "diaryScore", "inDiary", "sotd", "listeners", "inPlaylist", "playsWeek", "skips"], true), 10 * DAY_MS).unwrap();
        let f = |fact: &str, k: &str| out.facts.get(fact).and_then(|m| m.get(k)).cloned();
        assert_eq!(f("plays", "c3"), Some(Value::from(3)));
        assert_eq!(f("diaryScore", "c3"), Some(Value::from(8.5)));
        assert_eq!(f("diaryScore", "c2"), None); // missing: the page leaves it missing
        assert_eq!(f("inDiary", "c4"), Some(Value::Bool(true)));
        assert_eq!(f("inDiary", "c5"), None); // false: the page fills it
        assert_eq!(f("sotd", "c7"), Some(Value::Bool(true)));
        assert_eq!(f("listeners", "c2"), Some(Value::from(900)));
        assert_eq!(f("inPlaylist", "c1"), Some(serde_json::json!(["local:5", "p.abc"])));
        // c4 played on days 10, 9, 8, 7: three since day 8.
        assert_eq!(f("playsWeek", "c4"), Some(Value::from(3)));
        // c4: d = 1 and 3 have completed = 1; d = 0 and 2 are skips.
        assert_eq!(f("skips", "c4"), Some(Value::from(2)));
        assert!(out.pool.is_empty()); // the library's songs are the page's
    }

    #[test]
    fn sources_make_one_pool_with_no_repeats() {
        let c = fixture(10);
        let out = read(&c, &req(&["seen", "sotd", "diary", "playlist:local:5", "playlist:p.abc", "rewind:week"], &["plays"], false), 10 * DAY_MS).unwrap();
        let keys: Vec<&str> = out.pool.iter().map(|p| p.key.as_str()).collect();
        assert!(keys.contains(&"s1") && keys.contains(&"c7") && keys.contains(&"c3") && keys.contains(&"c1"));
        assert!(!keys.contains(&"u1")); // an unreleased song stays out
        let mut sorted = keys.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), keys.len());
        // Without the library, values only for the pool's songs.
        assert!(out.facts["plays"].keys().all(|k| keys.contains(&k.as_str())));
        assert!(read(&c, &req(&["nope"], &[], false), 0).is_err());
    }

    /// The gate (filter-rules.md §13.1b): the Rust read for 20,000 songs. The time is printed,
    /// never asserted (a debug build and a busy machine are slower); measure with `--release`.
    #[test]
    fn the_gate_read_of_twenty_thousand_songs() {
        let c = fixture(20_000);
        let t0 = std::time::Instant::now();
        let out = read(&c, &req(&[], &["plays", "lastPlayedDays", "playsWeek", "minutesWeek", "skips", "inPlaylist", "diaryScore", "inDiary"], true), 10 * DAY_MS).unwrap();
        let ms = t0.elapsed().as_millis();
        let bytes = serde_json::to_string(&out).unwrap().len();
        println!("[gate] rust read, 20,000 songs: {ms} ms, reply {} KB", bytes / 1024);
        assert_eq!(out.facts["plays"].len(), 20_000);
    }
}

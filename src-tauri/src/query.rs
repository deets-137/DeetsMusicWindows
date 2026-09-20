//! Read-only SQL over the user's own data, for agents and the `deetsmusic sql` command
//! (docs/LOCAL-DATA.md). Zero Apple calls.
//!
//! **The security model (LOCAL-DATA.md §5).** The user writes the SQL, so the danger is what
//! that SQL can reach, not injection into our own queries. Every query runs on a FRESH
//! in-memory database that holds only the exported tables (`songs`, `playlists`,
//! `playlist_songs`, `pins`, and — while Settings › Connections › Agents read play history is on —
//! `plays` and `play_counts`). The app's own tables are never in that database, so no query can
//! name them. On top of that, in order:
//! 1. The copy is made from the app's file opened `mode=ro`, then DETACHed before any user SQL.
//! 2. Limits: no attached databases, SQL text ≤ 8 KB, strings ≤ 1 MB, shallow expressions.
//! 3. `PRAGMA query_only = ON`.
//! 4. The authorizer allows SELECT, reads of the exported tables, recursive CTEs and a short
//!    list of functions; it denies everything else (ATTACH, PRAGMA, writes, unknown functions).
//! 5. One statement only, and SQLite must call it read-only.
//! 6. A progress handler stops the query after 2 s; the reply stops at 500 rows and cuts each
//!    text cell at 1,000 characters.
//!
//! Why not views over the real file with an authorizer (the first design): tested 2026-09-16,
//! SQLite reports a `WITH` name as the "accessor" exactly as it reports a view, so a query could
//! dress a read of an internal table up as a read through an allowed view. The in-memory copy
//! removes the internal tables from reach instead of trying to fence them.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::limits::Limit;
use rusqlite::types::ValueRef;
use rusqlite::{Batch, Connection};
use serde::Deserialize;
use serde_json::{json, Value};

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

const SQL_MAX: usize = 8 * 1024;
const TIME_MAX: Duration = Duration::from_secs(2);
const ROWS_MAX: usize = 500;
const CELL_MAX: usize = 1000;

const TABLES: &[&str] = &["songs", "playlists", "playlist_songs", "pins", "row_order"];
const HISTORY_TABLES: &[&str] = &["plays", "play_counts"];
/// The one refusal that is a setting, not a bad query: the bridge answers it 403 (CLI exit 6).
pub const HISTORY_OFF: &str = "Play history is off. Turn on Agents read play history in DeetsMusic › Settings › Connections.";

/// Functions a query may call. Everything else is refused (guard 4). No `load_extension`,
/// nothing that makes large blobs, nothing that reads files or the clock of the connection.
const FUNCTIONS: &[&str] = &[
    // aggregates and windows
    "count", "sum", "total", "avg", "min", "max", "group_concat", "string_agg",
    "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile", "lag", "lead",
    "first_value", "last_value", "nth_value",
    // text
    "length", "lower", "upper", "substr", "substring", "instr", "replace", "trim", "ltrim", "rtrim",
    "like", "glob", "printf", "format", "char", "unicode",
    // logic and numbers
    "coalesce", "ifnull", "iif", "nullif", "typeof", "abs", "round", "floor", "ceil", "ceiling",
    // dates
    "date", "time", "datetime", "julianday", "strftime", "unixepoch",
];

/// From `lib.rs` setup: where the app's database lives.
pub fn set_db_path(path: PathBuf) {
    let _ = DB_PATH.set(path);
}

/// The copy (guard 1). Plain SQL over the attached file; ids use the same `song:` / `playlist:`
/// prefixes the other agent tools take, so a row can be played at once.
const BUILD: &str = "
CREATE TABLE songs(id TEXT, title TEXT, artist TEXT, album TEXT, length_s INTEGER, genre TEXT,
  release_date TEXT, in_library INTEGER, added_rank INTEGER, added_at TEXT);
INSERT INTO songs SELECT 'song:' || t.track_id,
  json_extract(t.json, '$.title'), json_extract(t.json, '$.artistName'), json_extract(t.json, '$.albumName'),
  CAST(round(json_extract(t.json, '$.durationMs') / 1000.0) AS INTEGER),
  (SELECT group_concat(g.value, ', ') FROM json_each(t.json, '$.genres') g),
  json_extract(t.json, '$.releaseDate'), t.source = 'library', json_extract(t.json, '$.addedRank'),
  (SELECT strftime('%Y-%m-%dT%H:%M:%S', a.ts / 1000, 'unixepoch', 'localtime') FROM src.added_at a WHERE a.track_id = t.track_id)
  FROM src.tracks t;

CREATE TABLE playlists(id TEXT, name TEXT, source TEXT, song_count INTEGER);
INSERT INTO playlists SELECT 'playlist:local:' || p.id, p.name, 'DeetsMusic',
  (SELECT count(*) FROM src.local_playlist_tracks x WHERE x.playlist_id = p.id) FROM src.local_playlists p;
INSERT INTO playlists SELECT 'playlist:' || p.playlist_id, json_extract(p.json, '$.name'), 'Apple Music',
  (SELECT count(*) FROM src.apple_playlist_tracks x WHERE x.playlist_id = p.playlist_id) FROM src.apple_playlists p;

CREATE TABLE playlist_songs(playlist_id TEXT, position INTEGER, song_id TEXT);
INSERT INTO playlist_songs SELECT 'playlist:local:' || x.playlist_id, x.position + 1,
  'song:' || coalesce(json_extract(x.json, '$.catalogId'), json_extract(x.json, '$.libraryId')) FROM src.local_playlist_tracks x;
INSERT INTO playlist_songs SELECT 'playlist:' || x.playlist_id, x.position + 1,
  'song:' || coalesce(json_extract(x.json, '$.catalogId'), json_extract(x.json, '$.libraryId')) FROM src.apple_playlist_tracks x;

CREATE TABLE pins(id TEXT, kind TEXT, pinned_at TEXT, act TEXT);
INSERT INTO pins SELECT p.key, p.kind,
  strftime('%Y-%m-%dT%H:%M:%S', p.pinned_at / 1000, 'unixepoch', 'localtime'), p.act FROM src.pins p;

CREATE TABLE row_order(scope TEXT, id TEXT, rank INTEGER);
INSERT INTO row_order SELECT r.scope, r.id, r.rank FROM src.row_order r;
";

const BUILD_HISTORY: &str = "
CREATE TABLE plays(song_id TEXT, started_at TEXT, listened_s INTEGER, finished INTEGER, skipped INTEGER, context TEXT);
INSERT INTO plays SELECT 'song:' || e.track_id,
  strftime('%Y-%m-%dT%H:%M:%S', e.started_ts / 1000, 'unixepoch', 'localtime'),
  e.ms_listened / 1000, e.completed, (e.ms_listened IS NOT NULL AND e.completed = 0), e.context
  FROM src.play_events e;

CREATE TABLE play_counts(song_id TEXT, starts INTEGER, finishes INTEGER, last_played TEXT);
INSERT INTO play_counts SELECT 'song:' || s.track_id, s.partial_count, s.full_count,
  strftime('%Y-%m-%dT%H:%M:%S', s.last_played / 1000, 'unixepoch', 'localtime') FROM src.play_stats s;
";

/// Why the authorizer said no, for the reply (guard 7).
type Reason = Arc<Mutex<Option<String>>>;

/// A locked-down connection holding the copy.
fn open(history: bool) -> Result<(Connection, Reason), String> {
    let path = DB_PATH.get().ok_or("the database is not open yet")?;
    let url = url::Url::from_file_path(path).map_err(|_| "the database path is not a file path".to_string())?;
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;

    // 1. The copy, from the file opened read-only, then let the file go.
    conn.execute("ATTACH DATABASE ?1 AS src", [format!("{url}?mode=ro")]).map_err(|e| format!("copy: {e}"))?;
    let built = conn
        .execute_batch(BUILD)
        .and_then(|_| if history { conn.execute_batch(BUILD_HISTORY) } else { Ok(()) });
    conn.execute_batch("DETACH DATABASE src").map_err(|e| format!("copy: {e}"))?;
    built.map_err(|e| format!("copy: {e}"))?;

    // 2. Limits. No database can be attached from here on.
    conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
    conn.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, SQL_MAX as i32);
    conn.set_limit(Limit::SQLITE_LIMIT_LENGTH, 1_000_000);
    conn.set_limit(Limit::SQLITE_LIMIT_EXPR_DEPTH, 100);
    conn.set_limit(Limit::SQLITE_LIMIT_COMPOUND_SELECT, 20);
    conn.set_limit(Limit::SQLITE_LIMIT_FUNCTION_ARG, 16);
    conn.set_limit(Limit::SQLITE_LIMIT_VARIABLE_NUMBER, 32);
    conn.set_limit(Limit::SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 200);
    conn.set_limit(Limit::SQLITE_LIMIT_TRIGGER_DEPTH, 0);
    conn.set_limit(Limit::SQLITE_LIMIT_WORKER_THREADS, 0);
    // A sort that outgrows 8 MB spills to a temp file instead of growing in memory.
    conn.execute_batch("PRAGMA cache_size = -8000;").map_err(|e| e.to_string())?;

    // 3. No writes, even to the copy.
    conn.execute_batch("PRAGMA query_only = ON;").map_err(|e| e.to_string())?;

    // 4. The authorizer: allow a short list, deny the rest.
    let reason: Reason = Arc::new(Mutex::new(None));
    let why = reason.clone();
    conn.authorizer(Some(move |ctx: AuthContext<'_>| {
        let deny = |msg: String| {
            why.lock().unwrap().get_or_insert(msg);
            Authorization::Deny
        };
        match ctx.action {
            AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
            AuthAction::Read { table_name, .. } => {
                let t = table_name.to_ascii_lowercase();
                let listed = TABLES.contains(&t.as_str())
                    || (history && HISTORY_TABLES.contains(&t.as_str()))
                    || t == "sqlite_schema"
                    || t == "sqlite_master";
                match ctx.database_name {
                    // A stored table: only the listed ones.
                    Some("main") if listed => Authorization::Allow,
                    // A `WITH` result or a subquery has no database (tested 2026-09-16). It holds
                    // nothing of its own: every stored table inside it is checked on its own read.
                    None => Authorization::Allow,
                    // `temp`, or anything else.
                    _ => deny(unknown_table(table_name, history)),
                }
            }
            AuthAction::Function { function_name } => {
                if FUNCTIONS.contains(&function_name.to_ascii_lowercase().as_str()) {
                    Authorization::Allow
                } else {
                    deny(format!("The function {function_name}() is not allowed here."))
                }
            }
            AuthAction::Pragma { .. } => deny("PRAGMA is not allowed. Only SELECT is.".into()),
            AuthAction::Attach { .. } | AuthAction::Detach { .. } => deny("ATTACH is not allowed. Only SELECT is.".into()),
            _ => deny("Only SELECT is allowed.".into()),
        }
    }));
    Ok((conn, reason))
}

fn table_list(history: bool) -> String {
    let mut t: Vec<&str> = TABLES.to_vec();
    if history {
        t.extend(HISTORY_TABLES);
    }
    t.join(", ")
}

fn unknown_table(name: &str, history: bool) -> String {
    if !history && HISTORY_TABLES.contains(&name.to_ascii_lowercase().as_str()) {
        return HISTORY_OFF.into();
    }
    format!("Unknown table: {name}. Tables: {}.", table_list(history))
}

/// A SQLite error in plain words. The database holds only the exported tables, so its own
/// messages cannot name anything internal; they are passed on, cut short.
fn plain(e: rusqlite::Error, reason: &Reason, history: bool, started: Instant) -> String {
    if let Some(r) = reason.lock().unwrap().take() {
        return r;
    }
    let msg = e.to_string();
    if msg.contains("interrupted") {
        return format!("Stopped after {} s. Make the query smaller.", started.elapsed().as_secs().max(TIME_MAX.as_secs()));
    }
    if let Some(name) = msg.strip_prefix("no such table: ") {
        return unknown_table(name.trim_start_matches("main."), history);
    }
    if msg.contains("attempt to write a readonly database") {
        return "Only SELECT is allowed.".into();
    }
    msg.chars().take(200).collect()
}

fn cell(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => {
            let s = String::from_utf8_lossy(t);
            if s.chars().count() > CELL_MAX {
                json!(format!("{}…", s.chars().take(CELL_MAX).collect::<String>()))
            } else {
                json!(s)
            }
        }
        ValueRef::Blob(b) => json!(format!("<{} bytes>", b.len())),
    }
}

/// Run one read-only statement (guards 5 and 6). `params` binds values for the library tool.
fn run(conn: &Connection, reason: &Reason, history: bool, sql: &str, params: &[Value]) -> Result<Value, String> {
    let started = Instant::now();
    if sql.len() > SQL_MAX {
        return Err(format!("The query is too long ({} bytes). The limit is {} KB.", sql.len(), SQL_MAX / 1024));
    }
    let deadline = started + TIME_MAX;
    conn.progress_handler(1000, Some(move || Instant::now() > deadline));

    let mut batch = Batch::new(conn, sql);
    let mut stmt = match batch.next() {
        Ok(Some(s)) => s,
        Ok(None) => return Err("The query is empty.".into()),
        Err(e) => return Err(plain(e, reason, history, started)),
    };
    // A second statement, even a refused one, is refused as a whole.
    match batch.next() {
        Ok(None) => {}
        Ok(Some(_)) | Err(_) => {
            reason.lock().unwrap().take();
            return Err("One statement at a time.".into());
        }
    }
    if !stmt.readonly() {
        return Err("Only SELECT is allowed.".into());
    }
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let binds: Vec<rusqlite::types::Value> = params
        .iter()
        .map(|p| match p {
            Value::Number(n) if n.is_i64() => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
            Value::Number(n) => rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0)),
            Value::String(s) => rusqlite::types::Value::Text(s.clone()),
            _ => rusqlite::types::Value::Null,
        })
        .collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(binds)).map_err(|e| plain(e, reason, history, started))?;
    let mut out = Vec::new();
    let mut truncated = false;
    loop {
        match rows.next() {
            Ok(Some(r)) => {
                if out.len() == ROWS_MAX {
                    truncated = true;
                    break;
                }
                out.push(Value::Array((0..columns.len()).map(|i| r.get_ref(i).map(cell).unwrap_or(Value::Null)).collect()));
            }
            Ok(None) => break,
            Err(e) => return Err(plain(e, reason, history, started)),
        }
    }
    Ok(json!({ "columns": columns, "rows": out, "truncated": truncated, "ms": started.elapsed().as_millis() as u64 }))
}

/// `POST /query {sql}` — the user's own SELECT. Logs the size, the rows and the time, never the SQL.
pub fn query(sql: &str, history: bool) -> Result<Value, String> {
    let started = Instant::now();
    let (conn, reason) = open(history)?;
    let res = run(&conn, &reason, history, sql, &[]);
    match &res {
        Ok(v) => crate::log::info(&format!(
            "query: {} bytes → {} row(s){} in {} ms",
            sql.len(),
            v["rows"].as_array().map_or(0, |r| r.len()),
            if v["truncated"].as_bool() == Some(true) { " (cut at 500)" } else { "" },
            started.elapsed().as_millis()
        )),
        Err(e) => crate::log::info(&format!("query: {} bytes refused: {e}", sql.len())),
    }
    res
}

// ── the structured tool: list what=library (LOCAL-DATA.md §6) ────────────────

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SongsReq {
    sort: Option<String>,
    order: Option<String>,
    limit: Option<u32>,
    artist: Option<String>,
    genre: Option<String>,
    shorter_than: Option<Value>,
    longer_than: Option<Value>,
}

/// `83`, `"83"`, `"1:23"` → seconds.
fn seconds(v: &Value) -> Result<i64, String> {
    let bad = || format!("{v} is not a length. Use seconds (83) or m:ss (1:23).");
    match v {
        Value::Number(n) => n.as_f64().map(|f| f.round() as i64).ok_or_else(bad),
        Value::String(s) => {
            let s = s.trim();
            if let Some((m, sec)) = s.split_once(':') {
                let m: i64 = m.trim().parse().map_err(|_| bad())?;
                let sec: i64 = sec.trim().parse().map_err(|_| bad())?;
                Ok(m * 60 + sec)
            } else {
                s.parse::<f64>().map(|f| f.round() as i64).map_err(|_| bad())
            }
        }
        _ => Err(bad()),
    }
}

/// `%text%` with LIKE's own wildcards escaped, so a name with `%` or `_` matches literally.
fn contains(text: &str) -> Value {
    let t: String = text.trim().chars().take(100).collect();
    let esc = t.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    json!(format!("%{esc}%"))
}

/// Every piece of SQL here is a fixed string picked from a list; the user's text only ever
/// arrives as a bound parameter. It runs through the same locked connection as `query`.
pub fn songs(r: SongsReq, history: bool) -> Result<Value, String> {
    let sort = r.sort.as_deref().unwrap_or("title").trim().to_ascii_lowercase();
    let (key, default_desc, needs_history) = match sort.as_str() {
        "title" => ("s.title COLLATE NOCASE", false, false),
        "artist" => ("s.artist COLLATE NOCASE", false, false),
        "album" => ("s.album COLLATE NOCASE", false, false),
        "length" => ("s.length_s", false, false),
        "added" => ("s.added_rank", true, false),
        "plays" => ("starts", true, true),
        "last_played" => ("c.last_played", true, true),
        "skips" => ("skips", true, true),
        other => return Err(format!("sort {other:?} is not one of: title, artist, album, length, added, plays, last_played, skips.")),
    };
    if needs_history && !history {
        return Err(HISTORY_OFF.into());
    }
    let desc = match r.order.as_deref().map(|o| o.trim().to_ascii_lowercase()) {
        None => default_desc,
        Some(o) if o == "desc" => true,
        Some(o) if o == "asc" => false,
        Some(o) => return Err(format!("order {o:?} is not asc or desc.")),
    };
    let limit = r.limit.unwrap_or(20).clamp(1, 100);

    let mut sql = String::from("SELECT s.id, s.title, s.artist, s.album, s.length_s");
    if history {
        sql.push_str(", coalesce(c.starts, 0) AS starts, coalesce(c.finishes, 0) AS finishes, c.last_played, coalesce(k.skips, 0) AS skips");
    }
    sql.push_str(" FROM songs s");
    if history {
        sql.push_str(" LEFT JOIN play_counts c ON c.song_id = s.id");
        sql.push_str(" LEFT JOIN (SELECT song_id, count(*) AS skips FROM plays WHERE skipped GROUP BY song_id) k ON k.song_id = s.id");
    }
    sql.push_str(" WHERE s.in_library = 1");
    let mut params: Vec<Value> = Vec::new();
    if let Some(a) = r.artist.as_deref().filter(|a| !a.trim().is_empty()) {
        sql.push_str(" AND s.artist LIKE ? ESCAPE '\\'");
        params.push(contains(a));
    }
    if let Some(g) = r.genre.as_deref().filter(|g| !g.trim().is_empty()) {
        sql.push_str(" AND s.genre LIKE ? ESCAPE '\\'");
        params.push(contains(g));
    }
    if let Some(v) = &r.shorter_than {
        sql.push_str(" AND s.length_s < ?");
        params.push(json!(seconds(v)?));
    }
    if let Some(v) = &r.longer_than {
        sql.push_str(" AND s.length_s > ?");
        params.push(json!(seconds(v)?));
    }
    if sort == "length" || sort == "last_played" {
        sql.push_str(&format!(" AND {key} IS NOT NULL"));
    }
    sql.push_str(&format!(" ORDER BY {key} {}, s.title COLLATE NOCASE LIMIT ?", if desc { "DESC" } else { "ASC" }));
    params.push(json!(limit));

    let (conn, reason) = open(history)?;
    let res = run(&conn, &reason, history, &sql, &params)?;
    // Rows as objects: the CLI and MCP print them without knowing column positions.
    let cols: Vec<String> = res["columns"].as_array().into_iter().flatten().filter_map(|c| c.as_str().map(String::from)).collect();
    let songs: Vec<Value> = res["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|row| {
            let mut o = serde_json::Map::new();
            for (i, c) in cols.iter().enumerate() {
                o.insert(c.clone(), row.get(i).cloned().unwrap_or(Value::Null));
            }
            Value::Object(o)
        })
        .collect();
    crate::log::info(&format!("query: library sort={sort} → {} song(s)", songs.len()));
    Ok(json!({ "songs": songs, "sort": sort, "history": history }))
}

#[cfg(test)]
mod tests {
    //! The guards, attacked one by one (LOCAL-DATA.md §5). `cargo test --lib query`.
    use super::*;

    /// One fixture file for the whole run (DB_PATH is set once per process).
    fn fixture() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let path = std::env::temp_dir().join(format!("deets-query-test-{}.db", std::process::id()));
            let _ = std::fs::remove_file(&path);
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                r#"
                CREATE TABLE tracks(track_id TEXT PRIMARY KEY, source TEXT, sort_key TEXT, json TEXT);
                INSERT INTO tracks VALUES('111', 'library', '', '{"title":"Welcome","artistName":"Ginger Root","albumName":"City Slicker","durationMs":40500,"genres":["Indie Pop"],"addedRank":5}');
                INSERT INTO tracks VALUES('222', 'library', '', '{"title":"100%_Pure","artistName":"A_B","durationMs":200000,"genres":["Pop"],"addedRank":6}');
                INSERT INTO tracks VALUES('333', 'seen', '', '{"title":"Seen Only","artistName":"X","durationMs":120000,"genres":[]}');
                CREATE TABLE added_at(track_id TEXT PRIMARY KEY, ts INTEGER);
                CREATE TABLE local_playlists(id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO local_playlists VALUES(3, 'Mine');
                CREATE TABLE local_playlist_tracks(playlist_id INTEGER, position INTEGER, json TEXT);
                INSERT INTO local_playlist_tracks VALUES(3, 0, '{"catalogId":"111"}');
                CREATE TABLE apple_playlists(playlist_id TEXT, position INTEGER, json TEXT);
                CREATE TABLE apple_playlist_tracks(playlist_id TEXT, position INTEGER, json TEXT);
                CREATE TABLE play_events(id INTEGER PRIMARY KEY, track_id TEXT, started_ts INTEGER, ms_listened INTEGER, completed INTEGER, context TEXT, lastfm TEXT);
                INSERT INTO play_events VALUES(1, '111', 1789594440820, 40000, 1, 'library', 'sent');
                INSERT INTO play_events VALUES(2, '222', 1789594540820, 5000, 0, 'library', NULL);
                CREATE TABLE play_stats(track_id TEXT PRIMARY KEY, partial_count INTEGER, full_count INTEGER, last_played INTEGER);
                INSERT INTO play_stats VALUES('111', 3, 2, 1789594440820);
                CREATE TABLE pins(key TEXT PRIMARY KEY, kind TEXT, data TEXT, pinned_at INTEGER, act TEXT);
                INSERT INTO pins VALUES('song:111', 'song', NULL, 1789594440820, NULL);
                CREATE TABLE row_order(scope TEXT, id TEXT, rank INTEGER, PRIMARY KEY(scope, id));
                INSERT INTO row_order VALUES('home.shelves', 'pinned', 0);
                CREATE TABLE meta(key TEXT, value TEXT);
                INSERT INTO meta VALUES('secret', 'internal');
                "#,
            )
            .unwrap();
            drop(c);
            set_db_path(path);
        });
    }

    fn q(sql: &str) -> Result<Value, String> {
        fixture();
        query(sql, true)
    }

    fn refused(sql: &str) -> String {
        match q(sql) {
            Ok(v) => panic!("{sql:?} should be refused, got {v}"),
            Err(e) => e,
        }
    }

    #[test]
    fn reads_the_exported_tables() {
        let v = q("select id, title, length_s, genre from songs where in_library order by length_s").unwrap();
        assert_eq!(v["rows"][0], json!(["song:111", "Welcome", 41, "Indie Pop"]));
        let v = q("select p.name, s.title from playlist_songs x join playlists p on p.id = x.playlist_id join songs s on s.id = x.song_id").unwrap();
        assert_eq!(v["rows"][0], json!(["Mine", "Welcome"]));
        let v = q("select song_id, finished, skipped from plays order by started_at").unwrap();
        assert_eq!(v["rows"], json!([["song:111", 1, 0], ["song:222", 0, 1]]));
        let v = q("select id, kind from pins").unwrap();
        assert_eq!(v["rows"], json!([["song:111", "song"]]));
        let v = q("select scope, id, rank from row_order").unwrap();
        assert_eq!(v["rows"], json!([["home.shelves", "pinned", 0]]));
        assert!(q("with recursive r(n) as (select 1 union all select n + 1 from r where n < 5) select count(*) from r").is_ok());
        assert!(q("select name from sqlite_schema").is_ok());
    }

    #[test]
    fn internal_tables_are_out_of_reach() {
        for sql in [
            "select * from meta",
            "select * from tracks",
            "select * from main.play_events",
            "with songs as (select * from tracks) select * from songs",
            "select * from src.meta",
            "select * from temp.sqlite_master",
        ] {
            let e = refused(sql);
            assert!(!e.contains("internal"), "{sql}: {e}");
        }
        assert!(refused("select * from meta").starts_with("Unknown table: meta"));
    }

    #[test]
    fn nothing_but_select() {
        assert_eq!(refused("delete from songs"), "Only SELECT is allowed.");
        assert_eq!(refused("update songs set title = 'x'"), "Only SELECT is allowed.");
        assert_eq!(refused("insert into songs(id) values('x')"), "Only SELECT is allowed.");
        assert_eq!(refused("create temp table t(a)"), "Only SELECT is allowed.");
        assert_eq!(refused("drop table songs"), "Only SELECT is allowed.");
        assert!(refused("pragma query_only = 0").contains("PRAGMA"));
        assert!(refused("pragma table_info(songs)").contains("PRAGMA"));
        assert!(refused("attach database 'x.db' as x").contains("ATTACH"));
        assert!(refused("vacuum into 'copy.db'").contains("SELECT"));
        assert!(refused("begin").contains("SELECT"));
    }

    #[test]
    fn one_statement() {
        assert_eq!(refused("select 1; select 2"), "One statement at a time.");
        assert_eq!(refused("select 1; delete from songs"), "One statement at a time.");
        assert!(q("select 1; -- a trailing comment").is_ok());
    }

    #[test]
    fn functions_are_listed() {
        assert!(refused("select load_extension('evil')").contains("load_extension"));
        assert!(refused("select randomblob(1000000000)").contains("randomblob"));
        assert!(refused("select readfile('C:/Windows/win.ini')").to_lowercase().contains("readfile"));
        assert!(q("select upper(title), round(avg(length_s), 1) from songs group by title").is_ok());
    }

    #[test]
    fn limits_hold() {
        let started = Instant::now();
        let e = refused("with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r");
        assert!(e.starts_with("Stopped after"), "{e}");
        assert!(started.elapsed() < Duration::from_secs(4));
        // No value past 1 MB is ever built: printf answers NULL, replace() stops with an error.
        assert_eq!(q("select printf('%.*c', 2000000, 'x')").unwrap()["rows"][0][0], Value::Null);
        assert!(refused("select replace(printf('%.*c', 900000, 'x'), 'x', 'xxxx')").to_lowercase().contains("too big"));
        assert!(refused(&format!("select '{}'", "x".repeat(9000))).contains("too long"));
        let v = q("with recursive r(n) as (select 1 union all select n + 1 from r where n < 600) select n from r").unwrap();
        assert_eq!(v["rows"].as_array().unwrap().len(), ROWS_MAX);
        assert_eq!(v["truncated"], json!(true));
    }

    #[test]
    fn history_off_hides_plays() {
        fixture();
        assert_eq!(query("select * from plays", false).unwrap_err(), HISTORY_OFF);
        assert_eq!(query("select * from play_counts", false).unwrap_err(), HISTORY_OFF);
        assert!(query("select * from songs", false).is_ok());
        let r = SongsReq { sort: Some("plays".into()), ..Default::default() };
        assert_eq!(songs(r, false).unwrap_err(), HISTORY_OFF);
    }

    #[test]
    fn library_tool_binds_its_text() {
        fixture();
        let r = SongsReq { sort: Some("length".into()), longer_than: Some(json!("0:30")), ..Default::default() };
        let v = songs(r, true).unwrap();
        assert_eq!(v["songs"][0]["title"], json!("Welcome"));
        assert_eq!(v["songs"].as_array().unwrap().len(), 2, "a seen-only song is not in the library");
        // LIKE wildcards in the text match literally.
        let r = SongsReq { artist: Some("_".into()), ..Default::default() };
        assert_eq!(songs(r, true).unwrap()["songs"].as_array().unwrap().len(), 1);
        let r = SongsReq { artist: Some("' or 1=1 --".into()), ..Default::default() };
        assert_eq!(songs(r, true).unwrap()["songs"].as_array().unwrap().len(), 0);
        let r = SongsReq { sort: Some("title; drop table songs".into()), ..Default::default() };
        assert!(songs(r, true).is_err());
        let r = SongsReq { order: Some("desc, (select 1)".into()), ..Default::default() };
        assert!(songs(r, true).is_err());
        let r = SongsReq { sort: Some("skips".into()), ..Default::default() };
        assert_eq!(songs(r, true).unwrap()["songs"][0]["title"], json!("100%_Pure"));
    }

    #[test]
    fn the_file_is_never_written() {
        fixture();
        let path = DB_PATH.get().unwrap().clone();
        let before = std::fs::read(&path).unwrap();
        let _ = query("delete from songs", true);
        let _ = query("select * from songs", true);
        assert_eq!(before, std::fs::read(&path).unwrap());
    }
}

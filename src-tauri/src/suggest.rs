//! Suggest Less (docs/features/SUGGEST-LESS.md): our list of marks on songs, artists and albums.
//!
//! Apple's name for a song rating of −1 is Suggest Less. Apple has no list of −1 songs, so the
//! list holds what we read (`source = 'apple'`, from `favorites_reconcile`) and what was marked
//! here (`source = 'local'`). A local song mark is sent to Apple as −1 when the Add to Library
//! and ♥ consent is on (`synced = 1` once Apple has it). Artist and album marks are local only:
//! the API has no artist ratings, and the web builds from songs. The match itself is the
//! front-end's (suggest-match.ts): the player must answer at once, with no call.

use crate::lock::LockExt;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
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

/// v20 (2026-10-16): the `suggest_less` table (SUGGEST-LESS.md §3). Additive, idempotent.
/// `key`: a song's catalog id (or its library id when it has none); an artist's catalog id or
/// folded name; an album's catalog id or `folded album|folded artist`. `name` / `artist` are the
/// words the front-end matches on and Settings shows.
pub fn migrate_v20(conn: &Connection) -> Result<(), String> {
    let had: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'suggest_less'", [], |r| r.get(0))
        .map_err(err)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS suggest_less (
            kind   TEXT NOT NULL,
            key    TEXT NOT NULL,
            name   TEXT,
            artist TEXT,
            source TEXT NOT NULL DEFAULT 'local',
            synced INTEGER NOT NULL DEFAULT 0,
            at     INTEGER NOT NULL,
            PRIMARY KEY (kind, key)
        );",
    )
    .map_err(|e| format!("suggest_less table: {e}"))?;
    if had == 0 {
        crate::log::info("migration: v20 added suggest_less");
    }
    library::meta_set(conn, "schema_version", "20")
}

/// One mark, as the front-end holds it.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub kind: String,
    pub key: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default = "local")]
    pub source: String,
    #[serde(default)]
    pub synced: bool,
    #[serde(default)]
    pub at: i64,
}

fn local() -> String {
    "local".into()
}

fn kind_ok(kind: &str) -> Result<(), String> {
    match kind {
        "song" | "artist" | "album" => Ok(()),
        _ => Err(format!("suggest: bad kind '{kind}'")),
    }
}

/// A key Apple can rate: a catalog song id. A library id (`i.…`) has no rating route.
fn rateable(kind: &str, key: &str) -> bool {
    kind == "song" && !key.is_empty() && !key.starts_with("i.") && !key.contains('|')
}

pub(crate) fn list(conn: &Connection) -> Result<Vec<Mark>, String> {
    // An Apple row knows only its id: its words come from the song's stored row, when we have one.
    let mut stmt = conn
        .prepare_cached(
            "SELECT s.kind, s.key,
                    COALESCE(s.name, json_extract(t.json, '$.title')),
                    COALESCE(s.artist, json_extract(t.json, '$.artistName')),
                    s.source, s.synced, s.at
             FROM suggest_less s LEFT JOIN tracks t ON s.kind = 'song' AND t.track_id = s.key
             ORDER BY s.at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Mark {
                kind: r.get(0)?,
                key: r.get(1)?,
                name: r.get(2)?,
                artist: r.get(3)?,
                source: r.get(4)?,
                synced: r.get::<_, i64>(5)? != 0,
                at: r.get(6)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

fn put(conn: &Connection, m: &Mark) -> Result<(), String> {
    conn.execute(
        "INSERT INTO suggest_less(kind, key, name, artist, source, synced, at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(kind, key) DO UPDATE SET name = COALESCE(excluded.name, name),
             artist = COALESCE(excluded.artist, artist), source = excluded.source,
             synced = excluded.synced, at = excluded.at",
        params![m.kind, m.key, m.name, m.artist, m.source, m.synced as i64, if m.at > 0 { m.at } else { now_s() }],
    )
    .map_err(err)?;
    Ok(())
}

fn remove(conn: &Connection, kind: &str, key: &str) -> Result<usize, String> {
    conn.execute("DELETE FROM suggest_less WHERE kind = ?1 AND key = ?2", params![kind, key]).map_err(err)
}

/// Apple says −1 on these songs (a ratings read): an `apple` row each. A local row that Apple
/// now holds is marked synced; its source stays `local`.
pub(crate) fn note_apple(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for id in ids {
        conn.execute(
            "INSERT INTO suggest_less(kind, key, source, synced, at) VALUES('song', ?1, 'apple', 1, ?2)
             ON CONFLICT(kind, key) DO UPDATE SET synced = 1",
            params![id, now_s()],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Apple says no −1 on these asked songs: the mark was cleared on another device. Only an
/// `apple` row goes; a mark made here is never deleted by a read (§3 rules).
pub(crate) fn clear_apple(conn: &Connection, ids: &[String]) -> Result<usize, String> {
    let mut n = 0;
    for id in ids {
        n += conn
            .execute("DELETE FROM suggest_less WHERE kind = 'song' AND key = ?1 AND source = 'apple'", [id])
            .map_err(err)?;
    }
    Ok(n)
}

/// A ♥ replaces a −1 (Apple keeps one rating per song): the song's mark goes.
pub(crate) fn forget_song(conn: &Connection, id: &str) -> Result<usize, String> {
    remove(conn, "song", id)
}

/// Every mark — the front-end's sets at boot (zero Apple calls).
#[tauri::command]
pub async fn suggest_list(app: tauri::AppHandle) -> Result<Vec<Mark>, String> {
    crate::db_thread::run(&app, move |db| list(&db.lock())).await
}

async fn rate(state: &State<'_, AppleState>, id: &str, on: bool) -> Result<(), String> {
    let dev = apple::developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = apple::http_client();
    let url = format!("https://api.music.apple.com/v1/me/ratings/songs/{id}");
    let (status, body) = if on {
        let payload = serde_json::json!({ "type": "rating", "attributes": { "value": -1 } });
        apple::api_send(&client, reqwest::Method::PUT, &dev, &user, &url, Some(&payload)).await?
    } else {
        apple::api_send(&client, reqwest::Method::DELETE, &dev, &user, &url, None).await?
    };
    // 404 on a DELETE: there was no rating to clear, which is what we wanted.
    if (200..300).contains(&status) || (!on && status == 404) {
        Ok(())
    } else {
        Err(format!("suggest HTTP {status}: {body}"))
    }
}

/// Mark or unmark. `apple`: the consent is on, so a catalog song's −1 goes to Apple first
/// (`PUT` value −1, or `DELETE` on Undo), and the list changes only once Apple accepts — the
/// optimistic front-end rolls back on an error, as the ♥ does. With the consent off the mark
/// stays here (`synced = 0`) and goes up when the consent turns on (`suggest_push`).
/// `track`: the song's metadata, parked as a `seen` row so the list can always name it.
#[tauri::command]
pub async fn suggest_set(
    mark: Mark,
    on: bool,
    apple: bool,
    track: Option<Track>,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<Mark, String> {
    kind_ok(&mark.kind)?;
    if mark.key.is_empty() {
        return Err("suggest_set: no key".into());
    }
    let send = apple && rateable(&mark.kind, &mark.key);
    if send {
        rate(&state, &mark.key, on).await?;
    }
    let conn = db.lock();
    if let Some(t) = &track {
        library::materialize_many(&conn, std::slice::from_ref(t))?;
    }
    let out = Mark { source: "local".into(), synced: send, at: now_s(), ..mark };
    if on {
        put(&conn, &out)?;
        // Apple now holds −1 in place of a ♥.
        if send {
            crate::favorites::set_local(&conn, &out.key, false)?;
        }
    } else {
        remove(&conn, &out.kind, &out.key)?;
    }
    crate::log::info(&format!("suggest: {} {} {} synced={send}", if on { "mark" } else { "unmark" }, out.kind, out.key));
    Ok(out)
}

/// Settings › Clear: every mark goes from our list. Apple's −1s stay on Apple (a later read may
/// bring one back). Returns what was cleared, so Undo can put it back.
#[tauri::command]
pub async fn suggest_clear(app: tauri::AppHandle) -> Result<Vec<Mark>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let before = list(&conn)?;
        conn.execute("DELETE FROM suggest_less", []).map_err(err)?;
        crate::log::info(&format!("suggest: cleared {} mark(s)", before.len()));
        Ok(before)
    })
    .await
}

/// Undo of Clear: the marks come back as they were.
#[tauri::command]
pub async fn suggest_restore(marks: Vec<Mark>, app: tauri::AppHandle) -> Result<(), String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        for m in &marks {
            kind_ok(&m.kind)?;
            put(&conn, m)?;
        }
        Ok(())
    })
    .await
}

/// The consent turned on: send the −1 of every local song mark Apple does not have yet, once.
/// One `PUT` per song; a failure leaves that row unsynced for the next time.
#[tauri::command]
pub async fn suggest_push(state: State<'_, AppleState>, db: State<'_, Db>) -> Result<Vec<String>, String> {
    let pending: Vec<String> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare("SELECT key FROM suggest_less WHERE kind = 'song' AND source = 'local' AND synced = 0")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    let mut sent = Vec::new();
    for id in pending.iter().filter(|k| rateable("song", k)) {
        match rate(&state, id, true).await {
            Ok(()) => {
                let conn = db.lock();
                conn.execute("UPDATE suggest_less SET synced = 1 WHERE kind = 'song' AND key = ?1", [id]).map_err(err)?;
                crate::favorites::set_local(&conn, id, false)?;
                sent.push(id.clone());
            }
            Err(e) => crate::log::warn(&format!("suggest: push {id} failed: {e}")),
        }
    }
    if !pending.is_empty() {
        crate::log::info(&format!("suggest: pushed {} of {} local mark(s)", sent.len(), pending.len()));
    }
    Ok(sent)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        library::init_db(&conn).unwrap();
        migrate_v20(&conn).unwrap();
        conn
    }

    #[test]
    fn apple_read_adds_and_clears_only_apple_rows() {
        let conn = db();
        put(&conn, &Mark { kind: "song".into(), key: "1".into(), name: Some("A".into()), artist: None, source: "local".into(), synced: false, at: 0 }).unwrap();
        note_apple(&conn, &["1".into(), "2".into()]).unwrap();
        let l = list(&conn).unwrap();
        assert_eq!(l.len(), 2);
        let one = l.iter().find(|m| m.key == "1").unwrap();
        assert_eq!(one.source, "local");
        assert!(one.synced, "Apple holds the local mark now");
        // Cleared on the phone: the Apple row goes, the local one stays.
        assert_eq!(clear_apple(&conn, &["1".into(), "2".into()]).unwrap(), 1);
        let l = list(&conn).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].key, "1");
        migrate_v20(&conn).unwrap(); // idempotent
    }

    #[test]
    fn only_catalog_songs_are_rateable() {
        assert!(rateable("song", "1440818839"));
        assert!(!rateable("song", "i.abc"));
        assert!(!rateable("artist", "123"));
        assert!(!rateable("album", "a|b"));
    }
}

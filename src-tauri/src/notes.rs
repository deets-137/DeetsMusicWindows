//! Apple's editorial notes on an album (docs/features/album-notes.md): the short line, the full
//! text and the tagline Apple Music's editors write. The album's facts box shows the short note
//! in its About cell, and a click opens the full note (src/notes-view.ts).
//!
//! Cached in `album_notes` for a month, as Last.fm's facts are (LISTENERS.md); an album with no
//! notes is kept as `none`, so it is not asked again within the month. A library album has no
//! catalog id of its own, so it is reached through one of its songs: `album_note_songs` keeps
//! song → album, and the first open costs the hop (1 call, the album's notes ride along).
//!
//! **Seeded at no call** from an album Apple sent anyway: the Full level's album read
//! (`catalog_collection_tracks`) and the song → album hop (`catalog_related`).
//!
//! The read is a background job (APPLE-CALLS.md §3): while Apple's back-off holds it answers
//! `apple_calls::BUSY`, and the box keeps what it has.

use crate::lock::LockExt;
use serde::Serialize;
use tauri::AppHandle;

/// How long a kept answer stands. Editors rarely rewrite a note; a month keeps the calls rare.
const NOTES_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;

pub fn init_tables(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS album_notes (
            album_id    TEXT PRIMARY KEY,
            state       TEXT NOT NULL,
            short       TEXT,
            standard    TEXT,
            tagline     TEXT,
            fetched_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS album_note_songs (
            song_id     TEXT PRIMARY KEY,
            album_id    TEXT NOT NULL,
            fetched_at  INTEGER NOT NULL
        );",
    )
}

/// One album's notes, as the renderer sees them.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlbumNotes {
    /// "have" — Apple has a short or a full note. "none" — it has neither.
    pub state: &'static str,
    /// The catalog album the notes belong to.
    pub album_id: String,
    /// `editorialNotes.short`: one line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short: Option<String>,
    /// `editorialNotes.standard`: the full note, as Apple sends it (`<i>`, `<b>`, `<br />`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard: Option<String>,
    /// `editorialNotes.tagline`: "New Album and Interview".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    pub fetched_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn text(v: &serde_json::Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// The notes of an album resource. None when the resource carries no attributes (a bare
/// relationship): that says nothing, so nothing is kept.
pub(crate) fn from_album(v: &serde_json::Value, at: i64) -> Option<AlbumNotes> {
    let id = v["id"].as_str()?;
    let a = v.get("attributes")?;
    if !a.is_object() {
        return None;
    }
    let n = &a["editorialNotes"];
    let short = text(&n["short"]);
    let standard = text(&n["standard"]);
    Some(AlbumNotes {
        state: if short.is_some() || standard.is_some() { "have" } else { "none" },
        album_id: id.to_string(),
        short,
        standard,
        tagline: text(&n["tagline"]),
        fetched_at: at,
    })
}

fn cached(conn: &rusqlite::Connection, album_id: &str) -> Option<AlbumNotes> {
    conn.query_row(
        "SELECT state, short, standard, tagline, fetched_at FROM album_notes WHERE album_id = ?1",
        [album_id],
        |r| {
            let state: String = r.get(0)?;
            Ok(AlbumNotes {
                state: if state == "have" { "have" } else { "none" },
                album_id: album_id.to_string(),
                short: r.get(1)?,
                standard: r.get(2)?,
                tagline: r.get(3)?,
                fetched_at: r.get(4)?,
            })
        },
    )
    .ok()
}

fn album_of_song(conn: &rusqlite::Connection, song_id: &str) -> Option<String> {
    conn.query_row("SELECT album_id FROM album_note_songs WHERE song_id = ?1", [song_id], |r| r.get(0)).ok()
}

fn store(conn: &rusqlite::Connection, n: &AlbumNotes, song: Option<&str>) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO album_notes(album_id, state, short, standard, tagline, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![n.album_id, n.state, n.short, n.standard, n.tagline, n.fetched_at],
    );
    if let Some(s) = song {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO album_note_songs(song_id, album_id, fetched_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![s, n.album_id, n.fetched_at],
        );
    }
}

/// An album Apple sent anyway: keep its notes, at no call. `song`: the song it was reached
/// through (the hop), so a library album finds it next time. Two small writes on the caller's
/// lock, beside its own (`cache_tracks`). Never fails its caller.
pub(crate) fn seed(conn: &rusqlite::Connection, album: &serde_json::Value, song: Option<&str>) {
    if let Some(n) = from_album(album, now_ms()) {
        store(conn, &n, song);
    }
}

/// The notes of an album, by its catalog id, or by one of its songs (a library album). Cache
/// first; one call when the row is missing or older than a month. `Ok(None)`: Apple has no such
/// album or song. A network failure is an `Err` and keeps nothing, so the next open asks again.
#[tauri::command]
pub async fn album_notes(
    album_id: Option<String>,
    song_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, crate::apple::AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<AlbumNotes>, String> {
    let album_id = album_id.filter(|s| !s.is_empty());
    let song_id = song_id.filter(|s| !s.is_empty());
    if album_id.is_none() && song_id.is_none() {
        return Ok(None);
    }
    let (aid, sid) = (album_id.clone(), song_id.clone());
    let hit = crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let id = aid.or_else(|| sid.as_deref().and_then(|s| album_of_song(&conn, s)));
        Ok(id.and_then(|id| cached(&conn, &id)))
    })
    .await?;
    if let Some(n) = hit {
        if now_ms() - n.fetched_at < NOTES_TTL_MS {
            return Ok(Some(n));
        }
    }
    if crate::apple_calls::skip("album_notes") {
        return Err(crate::apple_calls::BUSY.into());
    }
    crate::apple_calls::background("album_notes", fetch(album_id, song_id, app, state, db)).await
}

async fn fetch(
    album_id: Option<String>,
    song_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, crate::apple::AppleState>,
    db: tauri::State<'_, crate::library::Db>,
) -> Result<Option<AlbumNotes>, String> {
    let dev = crate::apple::developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    // Only the fields the box needs (APPLE-CALLS.md S5): the name for the log, the notes.
    const FIELDS: &str = "fields[albums]=name,editorialNotes";
    let url = match (&album_id, &song_id) {
        (Some(a), _) => format!("https://api.music.apple.com/v1/catalog/{sf}/albums/{a}?{FIELDS}"),
        (None, Some(s)) => format!("https://api.music.apple.com/v1/catalog/{sf}/songs/{s}?include=albums&{FIELDS}&fields[songs]=name"),
        (None, None) => return Ok(None),
    };
    let (status, body) = crate::apple::api_get(&client, &dev, &user, &url).await?;
    if status == 404 {
        crate::log::info(&format!("notes: {} not in the catalog", album_id.as_deref().or(song_id.as_deref()).unwrap_or("")));
        return Ok(None);
    }
    if status != 200 {
        return Err(format!("album notes HTTP {status}"));
    }
    let album = if album_id.is_some() {
        &body["data"][0]
    } else {
        &body["data"][0]["relationships"]["albums"]["data"][0]
    };
    let Some(n) = from_album(album, now_ms()) else {
        crate::log::info(&format!("notes: {} has no album", song_id.as_deref().unwrap_or("")));
        return Ok(None);
    };
    crate::log::info(&format!("notes: {} {}", n.album_id, n.state));
    let (stored, song) = (n.clone(), if album_id.is_none() { song_id } else { None });
    crate::db_thread::run(&app, move |db| {
        store(&db.lock(), &stored, song.as_deref());
        Ok(())
    })
    .await?;
    Ok(Some(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_from_an_album_resource() {
        let v = serde_json::json!({
            "id": "6782852893",
            "attributes": { "name": "Rrromeo", "editorialNotes": {
                "short": " The CDMX artist dives into ’80s pop. ",
                "standard": "Intro.<br />\n<b>Denisse</b>\n“Words.”",
                "tagline": "New Album and Interview"
            } }
        });
        let n = from_album(&v, 7).unwrap();
        assert_eq!(n.state, "have");
        assert_eq!(n.album_id, "6782852893");
        assert_eq!(n.short.as_deref(), Some("The CDMX artist dives into ’80s pop."));
        assert_eq!(n.tagline.as_deref(), Some("New Album and Interview"));
        assert_eq!(n.fetched_at, 7);
    }

    #[test]
    fn an_album_without_notes_is_none_and_a_bare_relationship_says_nothing() {
        let none = serde_json::json!({ "id": "1", "attributes": { "name": "Single" } });
        assert_eq!(from_album(&none, 1).unwrap().state, "none");
        let blank = serde_json::json!({ "id": "2", "attributes": { "editorialNotes": { "short": "  " } } });
        assert_eq!(from_album(&blank, 1).unwrap().state, "none");
        let bare = serde_json::json!({ "id": "3", "type": "albums" });
        assert!(from_album(&bare, 1).is_none());
    }

    #[test]
    fn kept_by_album_and_found_by_song() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_tables(&conn).unwrap();
        let v = serde_json::json!({ "id": "a1", "attributes": { "editorialNotes": { "short": "Hi." } } });
        let n = from_album(&v, 5).unwrap();
        store(&conn, &n, Some("s1"));
        assert_eq!(album_of_song(&conn, "s1").as_deref(), Some("a1"));
        assert_eq!(cached(&conn, "a1"), Some(n));
        assert!(cached(&conn, "a2").is_none());
    }
}

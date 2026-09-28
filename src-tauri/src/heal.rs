//! The catalog heal (QUEUE.md §A library song Apple sends with no play id, 2026-09-28).
//!
//! Apple sends some library songs with an EMPTY `playParams`: no catalog id and no play id.
//! The copy the library points to was pulled (a re-release under a new id is the usual
//! cause). MusicKit takes a `playLater` of such a library id without an error and leaves the
//! song out, so the song never plays and the queue repair loops on it.
//!
//! We know it at the library pull, so the heal runs then: after each sync, one catalog
//! search per such song (title + artist), and the match is stored as a PLAY-ONLY id
//! (`catalog_heal`). The song keeps its library id as its key, so its plays, ♥, pins and
//! notes stay where they are; only the id sent to MusicKit changes (player.ts `playId`), and
//! the Library answers "in your library" for the new id too (track-store.ts).
//!
//! The match (his calls, 2026-09-28): the title and the artist must match; a hit on the same
//! album wins; else a hit within 3 s of the length. No match: the song is not playable, and
//! the heal searches again after 7 days.

use crate::apple::{developer_token, AppleProvider, AppleState};
use crate::library::{meta_set, Db};
use crate::lock::LockExt;
use crate::model::Track;
use crate::provider::MusicProvider;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// A song with no match is searched again after this long.
const RETRY_NONE_SECS: i64 = 7 * 24 * 3600;
/// A hit on another album counts only within this many ms of the song's length.
const LENGTH_SLACK_MS: u64 = 3000;
/// Searches per pass. A first pass on a big library with many pulled songs spreads over
/// several syncs instead of one burst of calls.
const PASS_CAP: usize = 50;
/// Hits read per search.
const SEARCH_LIMIT: u32 = 10;

/// Additive, idempotent: the `catalog_heal` table. One row per library id checked.
/// `catalog_id` NULL = no match (`how` = "none"), searched again after RETRY_NONE_SECS.
pub fn migrate_v16(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS catalog_heal (
            library_id TEXT PRIMARY KEY,
            catalog_id TEXT,
            how        TEXT NOT NULL,
            checked_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("catalog_heal table: {e}"))?;
    meta_set(conn, "schema_version", "16")
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Lowercase, every run of non-letters/digits one space: "I’m Alright" = "I'm Alright".
fn norm(s: &str) -> String {
    let mapped: String = s.chars().map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' }).collect();
    mapped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The catalog copy of a library song among search hits, and how it matched
/// ("album" | "length"). Pure; the rules are under test below.
pub(crate) fn pick_match<'a>(lib: &Track, hits: &'a [Track]) -> Option<(&'a str, &'static str)> {
    let (title, artist) = (norm(&lib.title), norm(&lib.artist_name));
    let gap = |h: &Track| match (lib.duration_ms, h.duration_ms) {
        (Some(a), Some(b)) => Some(a.abs_diff(b)),
        _ => None,
    };
    let same: Vec<&Track> = hits
        .iter()
        .filter(|h| h.catalog_id.is_some() && !h.unreleased)
        .filter(|h| norm(&h.title) == title && norm(&h.artist_name) == artist)
        .collect();
    let closest = |list: Vec<&'a Track>| list.into_iter().min_by_key(|h| gap(h).unwrap_or(u64::MAX));
    if let Some(album) = lib.album_name.as_deref().map(norm).filter(|a| !a.is_empty()) {
        let on_album: Vec<&Track> = same.iter().copied().filter(|h| h.album_name.as_deref().map(norm).as_deref() == Some(album.as_str())).collect();
        if let Some(h) = closest(on_album) {
            return h.catalog_id.as_deref().map(|id| (id, "album"));
        }
    }
    let near: Vec<&Track> = same.into_iter().filter(|h| gap(h).is_some_and(|g| g <= LENGTH_SLACK_MS)).collect();
    closest(near).and_then(|h| h.catalog_id.as_deref().map(|id| (id, "length")))
}

/// Library songs Apple sent with no play id, not healed and not checked in the last 7 days.
fn pending(conn: &Connection, now: i64) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT json FROM tracks
             WHERE json_extract(json, '$.catalogId') IS NULL
               AND json_extract(json, '$.playParams.id') IS NULL
               AND json_extract(json, '$.libraryId') IS NOT NULL
               AND json_extract(json, '$.libraryId') NOT IN
                   (SELECT library_id FROM catalog_heal WHERE catalog_id IS NOT NULL OR checked_at >= ?1)",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([now - RETRY_NONE_SECS], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).filter_map(|j| serde_json::from_str::<Track>(&j).ok()).collect())
}

fn store(conn: &Connection, library_id: &str, hit: Option<(&str, &str)>, now: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO catalog_heal(library_id, catalog_id, how, checked_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(library_id) DO UPDATE SET catalog_id = excluded.catalog_id, how = excluded.how,
             checked_at = excluded.checked_at",
        rusqlite::params![library_id, hit.map(|h| h.0), hit.map(|h| h.1).unwrap_or("none"), now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One search for one song; the result is stored. Err = the call failed (nothing stored).
async fn heal_one(provider: &AppleProvider, sf: &str, db: &Db, t: &Track) -> Result<Option<String>, String> {
    let Some(lib) = t.library_id.as_deref() else { return Ok(None) };
    let term = format!("{} {}", t.title, t.artist_name);
    let hits = provider.search(sf, &term, &["songs".to_string()], SEARCH_LIMIT).await?.songs;
    let hit = pick_match(t, &hits);
    let conn = db.lock();
    store(&conn, lib, hit, now_secs())?;
    match hit {
        Some((id, how)) => crate::log::info(&format!("catalog heal: \"{}\" {lib} → {id} ({how})", t.title)),
        None => crate::log::info(&format!("catalog heal: \"{}\" {lib} has no catalog copy", t.title)),
    }
    Ok(hit.map(|h| h.0.to_string()))
}

/// The pass after a library sync. Runs as a background job (APPLE-CALLS.md): it skips its
/// turn while Apple's back-off holds, and stops at the first failed call. Never fatal.
pub async fn pass(app: &AppHandle, dev: &str, user: &str, db: &State<'_, Db>) {
    if crate::apple_calls::skip("catalog_heal") {
        return;
    }
    crate::apple_calls::background("catalog_heal", async {
        let todo = {
            let conn = db.lock();
            match pending(&conn, now_secs()) {
                Ok(t) => t,
                Err(e) => return crate::log::warn(&format!("catalog heal: read failed: {e}")),
            }
        };
        if todo.is_empty() {
            return;
        }
        let provider = AppleProvider::new(dev.to_string(), user.to_string());
        let sf = match crate::enrich::storefront(&crate::apple::http_client(), dev, user, db).await {
            Ok(sf) => sf,
            Err(e) => return crate::log::warn(&format!("catalog heal: storefront: {e}")),
        };
        let (mut healed, mut none) = (0, 0);
        for t in todo.iter().take(PASS_CAP) {
            match heal_one(&provider, &sf, db, t).await {
                Ok(Some(_)) => healed += 1,
                Ok(None) => none += 1,
                Err(e) => {
                    crate::log::warn(&format!("catalog heal: stopped: {e}"));
                    break;
                }
            }
        }
        crate::log::info(&format!("catalog heal: {} song(s) to check, {healed} healed, {none} with no copy", todo.len()));
        if healed + none > 0 {
            app.emit("catalog-heal", serde_json::json!({ "healed": healed, "none": none })).ok();
        }
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heals {
    /// (library id, catalog id): play this catalog id for this library song.
    healed: Vec<(String, String)>,
    /// Library ids with no catalog copy, checked in the last 7 days: not playable.
    none: Vec<String>,
}

/// The heal map for the player and the track store (loaded at launch and on `catalog-heal`).
#[tauri::command]
pub async fn catalog_heals(app: AppHandle) -> Result<Heals, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut stmt = conn
            .prepare_cached("SELECT library_id, catalog_id FROM catalog_heal WHERE catalog_id IS NOT NULL OR checked_at >= ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([now_secs() - RETRY_NONE_SECS], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Heals { healed: vec![], none: vec![] };
        for (lib, cat) in rows.filter_map(|r| r.ok()) {
            match cat {
                Some(c) => out.healed.push((lib, c)),
                None => out.none.push(lib),
            }
        }
        Ok(out)
    })
    .await
}

/// The backstop (player.ts): MusicKit left a library id out of an insert. Heal that one song
/// now, unless it was healed or checked in the last 7 days. Returns the catalog id to play.
#[tauri::command]
pub async fn catalog_heal_one(
    library_id: String,
    app: AppHandle,
    state: State<'_, AppleState>,
    db: State<'_, Db>,
) -> Result<Option<String>, String> {
    let (track, known) = {
        let conn = db.lock();
        let known: Option<(Option<String>, i64)> = conn
            .query_row(
                "SELECT catalog_id, checked_at FROM catalog_heal WHERE library_id = ?1",
                [&library_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        (crate::library::track_by_id(&conn, &library_id), known)
    };
    match known {
        Some((Some(c), _)) => return Ok(Some(c)),
        Some((None, at)) if at >= now_secs() - RETRY_NONE_SECS => return Ok(None),
        _ => {}
    }
    // Only a song Apple sent with no play id, as in the pass: an uploaded song plays by its
    // library id, and a song with a catalog id has its own fallback (dead ids).
    let Some(track) = track.filter(|t| t.catalog_id.is_none() && t.play_params.id.is_none()) else { return Ok(None) };
    let dev = developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let provider = AppleProvider::new(dev.clone(), user.clone());
    let sf = crate::enrich::storefront(&crate::apple::http_client(), &dev, &user, &db).await?;
    let id = heal_one(&provider, &sf, &db, &track).await?;
    app.emit("catalog-heal", serde_json::json!({ "healed": id.is_some() as u8, "none": id.is_none() as u8 })).ok();
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(id: Option<&str>, title: &str, artist: &str, album: &str, ms: u64) -> Track {
        let mut t: Track = serde_json::from_value(serde_json::json!({
            "title": title, "artistName": artist, "albumName": album, "durationMs": ms,
            "genres": [], "hasLyrics": false,
        }))
        .unwrap();
        t.catalog_id = id.map(String::from);
        t
    }

    #[test]
    fn same_album_wins_2026_09_28() {
        // Lawn: the album copy and the single both come back; the library song is on "Re-Do".
        let lib = song(None, "Lawn", "CHRIS CASEY", "Re-Do", 184_993);
        let hits = [
            song(Some("6811218382"), "Lawn", "CHRIS CASEY", "Lawn - Single", 184_993),
            song(Some("6811221291"), "Lawn", "CHRIS CASEY", "Re-Do", 185_000),
        ];
        assert_eq!(pick_match(&lib, &hits), Some(("6811221291", "album")));
        // A library song from the single picks the single.
        let single = song(None, "Lawn", "CHRIS CASEY", "Lawn - Single", 184_993);
        assert_eq!(pick_match(&single, &hits), Some(("6811218382", "album")));
    }

    #[test]
    fn another_album_needs_the_length_2026_09_28() {
        let lib = song(None, "Lawn", "CHRIS CASEY", "Re-Do", 184_993);
        let deluxe = [song(Some("1"), "Lawn", "CHRIS CASEY", "Re-Do (Deluxe)", 186_500)];
        assert_eq!(pick_match(&lib, &deluxe), Some(("1", "length")));
        let remix = [song(Some("2"), "Lawn", "CHRIS CASEY", "Re-Do (Deluxe)", 205_000)];
        assert_eq!(pick_match(&lib, &remix), None);
    }

    #[test]
    fn title_and_artist_must_match_2026_09_28() {
        let lib = song(None, "I'm Alright", "Jack Louii & April", "I'm Alright - Single", 136_438);
        // Curly apostrophe and case are the same song.
        let ok = [song(Some("1"), "I’m alright", "Jack Louii & April", "I’m Alright - Single", 136_438)];
        assert_eq!(pick_match(&lib, &ok), Some(("1", "album")));
        let other = [song(Some("2"), "I'm Alright", "Someone Else", "I'm Alright - Single", 136_438)];
        assert_eq!(pick_match(&lib, &other), None);
    }

    #[test]
    fn an_unreleased_hit_does_not_count_2026_09_28() {
        let lib = song(None, "Lawn", "CHRIS CASEY", "Re-Do", 184_993);
        let mut h = song(Some("1"), "Lawn", "CHRIS CASEY", "Re-Do", 184_993);
        h.unreleased = true;
        assert_eq!(pick_match(&lib, &[h]), None);
    }
}

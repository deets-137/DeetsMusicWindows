//! Writer credits, collected from every Apple song read (docs/CREDITS.md).
//!
//! Apple's public API gives `composerName` on a song: the writers as ONE flat
//! string, with no roles ("JENNIE, Daniel Aged, Deb Never, Romil Hemnani, Jelli &
//! Saya Gray"). It rides reads the app already makes — search, album tracklists,
//! artist top-songs, the enrichment batch — so collecting it costs **no extra
//! Apple call**. We only ever dropped it at the parse step.
//!
//! This module writes what those reads carry into one table, and reads it back
//! for `credits_stats`. It decides nothing. The producer-web idea it feeds
//! (docs/CREDITS.md §5) is designed, not built: this is the data pass that has to
//! run first, so the decision is made on real coverage instead of a guess.
//!
//! One row per catalog song we have seen. `composer` is NULL when Apple sent
//! none, so the table carries its own denominator: coverage is the share of rows
//! that have one.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::library::Db;
use crate::model::Track;

pub fn init_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS song_credits (
            catalog_id  TEXT PRIMARY KEY,
            composer    TEXT,
            title       TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            seen_at     INTEGER NOT NULL
        );",
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// One song's credit, as any read path can describe it.
pub struct CreditRow<'a> {
    pub catalog_id: &'a str,
    pub composer: Option<&'a str>,
    pub title: &'a str,
    pub artist_name: &'a str,
}

/// Write one batch. A song read again keeps its row and gains a composer if this
/// read has one and the saved row does not (a library payload usually omits it;
/// the catalog read carries it). Credits never change, so a row is never
/// overwritten with NULL. A failure is silent by design: this is a background
/// collection, and it must never break the read it rides on.
pub fn note_rows<'a>(conn: &Connection, rows: impl Iterator<Item = CreditRow<'a>>) {
    let now = now_ms();
    for r in rows {
        if r.catalog_id.is_empty() {
            continue;
        }
        let _ = crate::dbhealth::watch(
            "credits",
            conn.execute(
                "INSERT INTO song_credits(catalog_id, composer, title, artist_name, seen_at)
                 VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(catalog_id) DO UPDATE SET
                     composer = COALESCE(excluded.composer, composer),
                     seen_at  = excluded.seen_at",
                rusqlite::params![
                    r.catalog_id,
                    r.composer.filter(|c| !c.trim().is_empty()),
                    r.title,
                    r.artist_name,
                    now
                ],
            ),
        );
    }
}
/// `note_rows` over normalized tracks, for a caller that already holds the lock.
pub fn note_tracks(conn: &Connection, tracks: &[Track]) {
    note_rows(
        conn,
        tracks.iter().filter_map(|t| {
            Some(CreditRow {
                catalog_id: t.catalog_id.as_deref().filter(|s| !s.is_empty())?,
                composer: t.composer.as_deref(),
                title: &t.title,
                artist_name: &t.artist_name,
            })
        }),
    );
}


// ── Reading it back ─────────────────────────────────────────────────────────

/// Name suffixes Apple writes after a comma ("Manuel Seal, Jr."): a comma before
/// one of these is part of the name, not a separator.
const SUFFIXES: [&str; 8] = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "esq."];

/// Split one `composerName` into names. Apple separates with ", " and puts " & "
/// before the last. The split is textual and imperfect by design: a person can
/// still appear under several strings ("Diplo", "Thomas Wesley Pentz",
/// "Thomas Pentz, Jr." are all one man). CREDITS.md §4.
pub fn split_composer(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in s.split(',') {
        for name in part.split('&') {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            // A bare suffix belongs to the name before it.
            if SUFFIXES.contains(&name.to_lowercase().as_str()) {
                if let Some(prev) = out.last_mut() {
                    prev.push_str(", ");
                    prev.push_str(name);
                    continue;
                }
            }
            out.push(name.to_string());
        }
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditName {
    pub name: String,
    /// Songs in the table that credit this name.
    pub songs: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditsStats {
    /// Catalog songs seen.
    pub songs: u32,
    /// Of those, the ones Apple gave a `composerName`.
    pub with_composer: u32,
    /// Distinct name strings.
    pub names: u32,
    /// Names credited on more than one song — the edges a producer web would have.
    pub shared_names: u32,
    /// The 25 most-credited names.
    pub top: Vec<CreditName>,
    /// Epoch-ms of the first and the newest row (how long this has been collecting).
    pub first_seen: i64,
    pub last_seen: i64,
}

/// What the collection has gathered so far. No Apple call.
#[tauri::command]
pub fn credits_stats(db: State<'_, Db>) -> Result<CreditsStats, String> {
    let conn = db.lock();
    let (songs, with_composer, first_seen, last_seen) = conn
        .query_row(
            "SELECT COUNT(*), COUNT(composer), COALESCE(MIN(seen_at), 0), COALESCE(MAX(seen_at), 0)
             FROM song_credits",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT composer FROM song_credits WHERE composer IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let mut counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        for name in split_composer(&row) {
            *counts.entry(name).or_insert(0) += 1;
        }
    }
    let shared_names = counts.values().filter(|n| **n > 1).count() as u32;
    let names = counts.len() as u32;
    let mut top: Vec<CreditName> =
        counts.into_iter().map(|(name, songs)| CreditName { name, songs }).collect();
    top.sort_by(|a, b| b.songs.cmp(&a.songs).then_with(|| a.name.cmp(&b.name)));
    top.truncate(25);

    Ok(CreditsStats { songs, with_composer, names, shared_names, top, first_seen, last_seen })
}

// -- The song pane's reads (CREDITS.md §7) -----------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SongCredit {
    /// "have" — Apple sent credits and here they are.
    /// "none" — we HAVE read this song, and Apple sent no `composerName` at all.
    ///
    /// A song absent from the map is a third state: we have never read it. The three must
    /// stay apart, because only one of them is our fault to fix (CREDITS.md §8).
    pub state: &'static str,
    /// Apple's line, as sent. Empty when `state` is "none".
    pub composer: String,
    /// The same line split into names, for the clickable chips.
    pub names: Vec<String>,
}

/// The credits we hold for these songs. **No Apple call.** A song we have never read is
/// absent from the map; a song we read that Apple gave nothing for comes back as "none".
#[tauri::command]
pub fn credits_for(
    catalog_ids: Vec<String>,
    db: State<'_, Db>,
) -> Result<std::collections::HashMap<String, SongCredit>, String> {
    let mut out = std::collections::HashMap::new();
    if catalog_ids.is_empty() {
        return Ok(out);
    }
    let conn = db.lock();
    let mut stmt = conn
        .prepare("SELECT composer FROM song_credits WHERE catalog_id = ?1")
        .map_err(|e| e.to_string())?;
    for id in catalog_ids {
        if id.is_empty() {
            continue;
        }
        // A row with a NULL composer is the "none" answer: we asked Apple and it had none.
        if let Ok(composer) = stmt.query_row([&id], |r| r.get::<_, Option<String>>(0)) {
            let credit = match composer {
                Some(c) if !c.trim().is_empty() => {
                    let names = split_composer(&c);
                    SongCredit { state: "have", composer: c, names }
                }
                _ => SongCredit { state: "none", composer: String::new(), names: Vec::new() },
            };
            out.insert(id, credit);
        }
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterSong {
    pub catalog_id: String,
    pub title: String,
    pub artist_name: String,
    /// What you already have: 3 loved, 2 played, 1 in your library, 0 seen only.
    pub mine: u8,
    /// The stored track, when the app holds one — the row plays only then. A song the
    /// credit collection met through a web read was never materialized, so it has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<crate::model::Track>,
}

/// Every song we have collected that credits this writer, yours first.
///
/// This is the whole producer-web idea at its smallest (CREDITS.md §5): the name string
/// is the node, and the answer is a join over what the app has already read. It reaches
/// nothing we have not seen — which is why the pane also offers an Apple search.
#[tauri::command]
pub fn songs_by_writer(name: String, db: State<'_, Db>) -> Result<Vec<WriterSong>, String> {
    let wanted = name.trim().to_lowercase();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.lock();
    // LIKE narrows the scan; `split_composer` then decides, so "Ali" never matches "Alicia".
    let like = format!("%{}%", wanted.replace('%', "").replace('_', ""));
    let mut stmt = conn
        .prepare(
            "SELECT c.catalog_id, c.title, c.artist_name, c.composer,
                    (SELECT 1 FROM tracks t WHERE t.track_id = c.catalog_id AND t.source = 'library'),
                    (SELECT partial_count FROM play_stats p WHERE p.track_id = c.catalog_id),
                    (SELECT 1 FROM favorites f WHERE f.track_id = c.catalog_id AND f.loved = 1),
                    (SELECT t.json FROM tracks t WHERE t.track_id = c.catalog_id)
             FROM song_credits c
             WHERE c.composer IS NOT NULL AND lower(c.composer) LIKE ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&like], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<i64>>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out: Vec<WriterSong> = Vec::new();
    for (catalog_id, title, artist_name, composer, in_lib, plays, loved, json) in rows.flatten() {
        if !split_composer(&composer).iter().any(|n| n.to_lowercase() == wanted) {
            continue;
        }
        let mine = if loved.is_some() {
            3
        } else if plays.unwrap_or(0) > 0 {
            2
        } else if in_lib.is_some() {
            1
        } else {
            0
        };
        let track = json.and_then(|j| serde_json::from_str::<crate::model::Track>(&j).ok());
        out.push(WriterSong { catalog_id, title, artist_name, mine, track });
    }
    out.sort_by(|a, b| b.mine.cmp(&a.mine).then_with(|| a.artist_name.cmp(&b.artist_name)).then_with(|| a.title.cmp(&b.title)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::split_composer;

    #[test]
    fn splits_apple_composer_lines() {
        assert_eq!(
            split_composer("JENNIE, Daniel Aged, Deb Never, Romil Hemnani, Jelli & Saya Gray"),
            ["JENNIE", "Daniel Aged", "Deb Never", "Romil Hemnani", "Jelli", "Saya Gray"]
        );
        // One name only.
        assert_eq!(split_composer("KETTAMA"), ["KETTAMA"]);
        // A suffix after a comma stays with its name.
        assert_eq!(
            split_composer("Jermaine Dupri, Usher Raymond IV & Manuel Seal, Jr."),
            ["Jermaine Dupri", "Usher Raymond IV", "Manuel Seal, Jr."]
        );
        // Quotes inside a name survive.
        assert_eq!(
            split_composer("Tayla Parx, Amanda \"Kiddo A.I.\" Ibanez & ZICO"),
            ["Tayla Parx", "Amanda \"Kiddo A.I.\" Ibanez", "ZICO"]
        );
        assert!(split_composer("   ").is_empty());
    }
}

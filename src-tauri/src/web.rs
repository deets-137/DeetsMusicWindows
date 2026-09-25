//! The playlist web (PLAYLIST-WEB.md): an artist, the artists they make songs with, and
//! theirs, out to a reach of 1–3 degrees. Returns candidate songs with their degree; the
//! front end filters by genre, caps and orders them (zero Apple calls for that part).
//!
//! Apple calls are kept low on purpose (the user's standing rule):
//!  - artists are read in batches of 25 (`artists?ids=…&views=…`) and albums in batches of
//!    50 (`albums?ids=…&include=tracks&include[songs]=artists`);
//!  - the last degree reads top songs only — no albums;
//!  - only the seed's views are paged past Apple's first 10;
//!  - a "feat." name resolves from what is known first: names Apple sent in this or an
//!    earlier read, and the Library artist view's `artist_catalog`. Only then a search, on
//!    the seed's songs only (at most `SEED_LOOKUPS`), and the answer — a miss too — is saved;
//!  - every artist read is saved in `web_artists` for `ARTIST_TTL_MS`, so a second build, a
//!    bigger reach or a Retry reads only what is missing, old or failed. `fresh` reads the
//!    web's artists again (the panel's "Read again").
//!
//! Measured 2026-09-16 on Samara Cyn, reach 3 with 15 artists a degree: 18 calls.
//!
//! A web starts from an artist, a song or an album (§9). A song's or album's leads are the
//! seed artists (degree 0); its guests, and every other artist on an album, go first into
//! degree 1. The song or album itself is the `anchor`: it leads the playlist. An album's full
//! tracklist is read once and saved in `web_albums` (1 call, 0 after).

use crate::lock::LockExt;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::apple::{api_get, artist_from_catalog, developer_token, track_from_catalog_song, AppleState};
use crate::library::Db;
use crate::model::{Album, Artist, Artwork, Track};

const ARTIST_BATCH: usize = 25;
const ALBUM_BATCH: usize = 50;
/// The seed's collaborators all go on to degree 1; after that, the best-linked few.
const SEED_FANOUT: usize = 40;
const DEGREE_FANOUT: usize = 15;
const SEED_LOOKUPS: usize = 10;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// A saved artist read counts as current this long (Apple's credits change slowly).
const ARTIST_TTL_MS: i64 = 7 * DAY_MS;
/// Credit text that is not an artist: never searched (a "Music" search cost a call, 2026-09-17).
const NOT_NAMES: [&str; 2] = ["music", "variousartists"];
/// The newest build's number. An older build stops before its next Apple call (§5b).
static BUILD_GEN: AtomicU64 = AtomicU64::new(0);
/// A name Apple's search did not match is asked again after this long.
const NAME_MISS_TTL_MS: i64 = 30 * DAY_MS;

pub fn init_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "-- The playlist web's artist reads (PLAYLIST-WEB.md §5). json = Stored. ok = 0 when a
        -- part of the read failed: the next build (Retry) reads the artist again.
        CREATE TABLE IF NOT EXISTS web_artists (
            catalog_id TEXT PRIMARY KEY,
            json       TEXT NOT NULL,
            ok         INTEGER NOT NULL,
            fetched_at INTEGER NOT NULL
        );
        -- A \"feat.\" name looked up by search: normalized name → catalog id ('' = no match).
        CREATE TABLE IF NOT EXISTS web_names (
            name       TEXT PRIMARY KEY,
            catalog_id TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );
        -- An album seed's full tracklist (§9.5). key = 'album:<id>' or 'song:<a track's id>'
        -- (a library album is found through one of its songs); json = AlbumRead.
        CREATE TABLE IF NOT EXISTS web_albums (
            key        TEXT PRIMARY KEY,
            json       TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );
        -- The seeds webs were built from, all three kinds (the panel's Web before). json = WebSeed.
        CREATE TABLE IF NOT EXISTS web_seed_list (
            kind     TEXT NOT NULL,
            id       TEXT NOT NULL,
            json     TEXT NOT NULL,
            built_at INTEGER NOT NULL,
            PRIMARY KEY (kind, id)
        );",
    )?;
    // Before §9 the artist seeds were the paged artist reads: copy them over once.
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM web_seed_list", [], |r| r.get(0))?;
    if count == 0 {
        let mut st = conn.prepare_cached("SELECT catalog_id, json, fetched_at FROM web_artists")?;
        let rows: Vec<(String, String, i64)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.flatten().collect();
        for (id, json, at) in rows {
            let Ok(s) = serde_json::from_str::<Stored>(&json) else { continue };
            if !s.paged {
                continue;
            }
            if let Ok(seed) = serde_json::to_string(&WebSeed::Artist { artist: s.artist }) {
                conn.execute(
                    "INSERT OR IGNORE INTO web_seed_list(kind, id, json, built_at) VALUES('artist', ?1, ?2, ?3)",
                    rusqlite::params![id, seed, at],
                )?;
            }
        }
    }
    Ok(())
}

/// Where a web starts (§9). The panel sends it and "Web before" gives it back.
#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WebSeed {
    Artist { artist: Artist },
    Song { track: Track },
    /// A library album has no catalog id: `song_id` (one of its songs) finds it.
    #[serde(rename_all = "camelCase")]
    Album { album: Album, song_id: Option<String> },
}

impl WebSeed {
    fn kind(&self) -> &'static str {
        match self {
            WebSeed::Artist { .. } => "artist",
            WebSeed::Song { .. } => "song",
            WebSeed::Album { .. } => "album",
        }
    }
    fn title(&self) -> &str {
        match self {
            WebSeed::Artist { artist } => &artist.name,
            WebSeed::Song { track } => &track.title,
            WebSeed::Album { album, .. } => &album.title,
        }
    }
}

/// An album seed's tracklist, as saved: each song with its main credits (id, name).
#[derive(Serialize, Deserialize, Clone)]
struct AlbumRead {
    album: Album,
    tracks: Vec<(Track, Vec<(String, String)>)>,
}

/// One artist, as saved.
#[derive(Serialize, Deserialize, Clone)]
struct Stored {
    artist: Artist,
    top: Vec<Track>,
    /// Songs on the artist's singles and appears-on albums that credit the artist.
    credited: Vec<Track>,
    /// Other artists on those songs: id → songs shared.
    links: HashMap<String, u32>,
    /// Albums were read (false: top songs only — a last-degree read).
    full: bool,
    /// The views were read past Apple's first 10 (a seed read).
    paged: bool,
}

struct Row {
    s: Stored,
    ok: bool,
    fetched_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebSong {
    pub track: Track,
    pub degree: u8,
    pub artist_id: String,
    /// The song credits a seed artist (their own songs and their features), or is on the album seed.
    pub seed: bool,
    /// The seed song itself, or a song of the seed album (§9): it leads the playlist.
    pub anchor: bool,
    /// What you already have: 3 ♥, 2 played, 1 in your library, 0 new to you.
    pub mine: u8,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebArtist {
    pub id: String,
    pub name: String,
    pub degree: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebResult {
    /// "artist", "song" or "album".
    pub kind: &'static str,
    /// The seed artist; for a song or an album, its artist line (the status line's "by ...").
    pub seed: Artist,
    /// The song's or album's genres: the chips the panel picks for a new seed (§9.1, 2A).
    pub genres: Vec<String>,
    pub artists: Vec<WebArtist>,
    pub songs: Vec<WebSong>,
    /// Apple calls this build made (0 when every read was saved).
    pub calls: u32,
    /// Artists whose read failed in part or whole: a Retry reads only these.
    pub failed: u32,
    /// Epoch-ms of the oldest saved read the web used.
    pub oldest: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    degree: u8,
    artists: usize,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// "A, B & C" → ["A", "B", "C"]; "A x B" → ["A", "B"] (Apple credits some joint songs so).
/// A line that is itself one known artist ("Chloe x Halle") is kept whole by `line_names`.
fn split_names(s: &str) -> Vec<String> {
    s.replace(" x ", ",").replace(" X ", ",").split([',', '&']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// The names inside "(feat. …)" / "[with …]" in a title.
fn feat_names(title: &str) -> Vec<String> {
    for (i, c) in title.char_indices() {
        let close = match c {
            '(' => ')',
            '[' => ']',
            _ => continue,
        };
        let rest = &title[i + 1..];
        for word in ["feat. ", "feat ", "featuring ", "with "] {
            // ASCII words: a match means the same byte length in the title.
            if rest.len() >= word.len() && rest.is_char_boundary(word.len()) && rest[..word.len()].eq_ignore_ascii_case(word) {
                let inner = &rest[word.len()..];
                let end = inner.find(close).unwrap_or(inner.len());
                return split_names(&inner[..end]);
            }
        }
    }
    Vec::new()
}

/// Every name credited on a song: the artist line (split and whole) and the feat. part.
fn credited_names(t: &Track) -> Vec<String> {
    let mut names = split_names(&t.artist_name);
    names.push(t.artist_name.clone());
    names.extend(feat_names(&t.title));
    names
}

/// Instrumentals and speed edits are the same song again.
fn is_variant(title: &str) -> bool {
    let t = title.to_lowercase();
    ["instrumental", "sped up", "slowed", "a cappella", "acapella"].iter().any(|w| t.contains(w))
}

/// What an Apple call read, for the log line's split (§5b).
#[derive(Clone, Copy)]
enum Call {
    Artists,
    Views,
    Albums,
    Song,
    Search,
}

struct Apple {
    client: reqwest::Client,
    dev: String,
    user: String,
    sf: String,
    calls: u32,
    /// Calls by `Call`, in its order.
    by: [u32; 5],
    /// This build's number (BUILD_GEN).
    gen: u64,
}

impl Apple {
    /// A newer build started: this one makes no more calls.
    fn stale(&self) -> bool {
        BUILD_GEN.load(Ordering::SeqCst) != self.gen
    }

    async fn get(&mut self, url: &str, kind: Call) -> Result<serde_json::Value, String> {
        if self.stale() {
            return Err("web: a newer build started".into());
        }
        self.calls += 1;
        self.by[kind as usize] += 1;
        let (status, body) = api_get(&self.client, &self.dev, &self.user, url).await?;
        if status != 200 {
            return Err(format!("HTTP {status}"));
        }
        Ok(body)
    }

    /// "calls=31 (artists 2, views 0, albums 18, song 1, search 10)".
    fn split(&self) -> String {
        let [a, v, al, s, q] = self.by;
        format!("calls={} (artists {a}, views {v}, albums {al}, song {s}, search {q})", self.calls)
    }
}

/// The names on an artist line: the whole line when it is one known artist, else its parts.
fn line_names(b: &Build<'_>, line: &str) -> Vec<String> {
    if b.names.get(&norm(line)).is_some_and(|i| !i.is_empty()) {
        vec![line.to_string()]
    } else {
        split_names(line)
    }
}

/// One build's working state: the names it knows and the database.
struct Build<'a> {
    db: &'a Db,
    /// Normalized name → catalog id ("" = looked up, no match).
    names: HashMap<String, String>,
    /// Names looked up by search in this build, saved at the end.
    new_names: Vec<(String, String)>,
    /// Names searched this build: at most SEED_LOOKUPS.
    asked: HashSet<String>,
    failed: HashSet<String>,
}

impl Build<'_> {
    /// Names already known, at zero calls: the Library artist view's ids (`artist_catalog`)
    /// and earlier web lookups (a miss older than NAME_MISS_TTL_MS is forgotten).
    fn load_names(db: &Db) -> HashMap<String, String> {
        let conn = db.lock();
        let mut names = HashMap::new();
        if let Ok(mut st) = conn.prepare_cached("SELECT name, catalog_id FROM artist_catalog WHERE catalog_id <> ''") {
            if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                for (n, id) in rows.flatten() {
                    names.insert(norm(&n), id);
                }
            }
        }
        let cutoff = now_ms() - NAME_MISS_TTL_MS;
        if let Ok(mut st) = conn.prepare_cached("SELECT name, catalog_id FROM web_names WHERE catalog_id <> '' OR fetched_at > ?1") {
            if let Ok(rows) = st.query_map([cutoff], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                for (n, id) in rows.flatten() {
                    names.entry(n).or_insert(id);
                }
            }
        }
        // Artists read by earlier webs: a song seed's leads are often here.
        if let Ok(mut st) = conn.prepare_cached("SELECT json_extract(json, '$.artist.name'), catalog_id FROM web_artists") {
            if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))) {
                for (n, id) in rows.flatten() {
                    if let Some(n) = n {
                        names.entry(norm(&n)).or_insert(id);
                    }
                }
            }
        }
        names
    }

    /// The ids of an artist line's leads from names already known: the whole line first
    /// ("Simon & Garfunkel" is one artist), then each name in it. None when one is unknown.
    fn leads_known(&self, line: &str) -> Option<Vec<String>> {
        let known = |n: &str| self.names.get(&norm(n)).filter(|i| !i.is_empty()).cloned();
        if let Some(id) = known(line) {
            return Some(vec![id]);
        }
        let parts = split_names(line);
        let mut ids: Vec<String> = Vec::new();
        for n in &parts {
            let id = known(n)?;
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        (!ids.is_empty()).then_some(ids)
    }

    fn album_row(&self, key: &str) -> Option<(AlbumRead, i64)> {
        let conn = self.db.lock();
        conn.query_row("SELECT json, fetched_at FROM web_albums WHERE key = ?1", [key], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .ok()
        .and_then(|(json, at)| serde_json::from_str::<AlbumRead>(&json).ok().map(|a| (a, at)))
    }

    fn save_album(&self, keys: &[String], a: &AlbumRead) {
        let Ok(json) = serde_json::to_string(a) else { return };
        let conn = self.db.lock();
        for k in keys {
            if let Err(e) = conn.execute(
                "INSERT OR REPLACE INTO web_albums(key, json, fetched_at) VALUES(?1, ?2, ?3)",
                rusqlite::params![k, json, now_ms()],
            ) {
                crate::log::warn(&format!("web: save album {e}"));
            }
        }
    }

    fn remember(&mut self, name: &str, id: &str) {
        self.names.entry(norm(name)).or_insert_with(|| id.to_string());
    }

    /// Every song a web read touches carries its writers, at no extra call
    /// (CREDITS.md §3). A web is the richest source we have: one build reads
    /// dozens of artists' songs, and the collection keeps them after the
    /// `web_artists` rows expire.
    fn note_credits(&self, tracks: &[Track]) {
        let conn = self.db.lock();
        crate::credits::note_tracks(&conn, tracks);
    }

    fn row(&self, id: &str) -> Option<Row> {
        let conn = self.db.lock();
        conn.query_row("SELECT json, ok, fetched_at FROM web_artists WHERE catalog_id = ?1", [id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        })
        .ok()
        .and_then(|(json, ok, at)| serde_json::from_str::<Stored>(&json).ok().map(|s| Row { s, ok: ok != 0, fetched_at: at }))
    }

    fn save(&self, id: &str, s: &Stored, ok: bool) {
        let Ok(json) = serde_json::to_string(s) else { return };
        let conn = self.db.lock();
        if let Err(e) = conn.execute(
            "INSERT OR REPLACE INTO web_artists(catalog_id, json, ok, fetched_at) VALUES(?1, ?2, ?3, ?4)",
            rusqlite::params![id, json, ok as i64, now_ms()],
        ) {
            crate::log::warn(&format!("web: save artist {e}"));
        }
    }

    fn save_names(&self) {
        let conn = self.db.lock();
        for (n, id) in &self.new_names {
            let _ = crate::dbhealth::watch(
                "web names",
                conn.execute(
                    "INSERT OR REPLACE INTO web_names(name, catalog_id, fetched_at) VALUES(?1, ?2, ?3)",
                    rusqlite::params![n, id, now_ms()],
                ),
            );
        }
    }
}

/// Read the artists in `ids` that are not saved, or saved but old, failed, or without the
/// albums (`full`) or the paging (the seed) this degree needs. `fresh` reads all of them.
async fn read_artists(apple: &mut Apple, b: &mut Build<'_>, ids: &[String], full: bool, seeds: &HashSet<String>, fresh: bool) -> Result<(), String> {
    let need: Vec<String> = ids
        .iter()
        .filter(|id| {
            fresh
                || match b.row(id) {
                    Some(r) => {
                        !r.ok
                            || now_ms() - r.fetched_at > ARTIST_TTL_MS
                            || (full && !r.s.full)
                            || (full && seeds.contains(id.as_str()) && !r.s.paged)
                    }
                    None => true,
                }
        })
        .cloned()
        .collect();
    let views = if full { "top-songs,singles,appears-on-albums" } else { "top-songs" };
    let sf = apple.sf.clone();

    for batch in need.chunks(ARTIST_BATCH) {
        let url = format!("https://api.music.apple.com/v1/catalog/{sf}/artists?ids={}&views={views}", batch.join(","));
        let body = match apple.get(&url, Call::Artists).await {
            Ok(b) => b,
            Err(e) if apple.stale() => return Err(e),
            // A seed artist's own read failing is the build failing; any other batch is a gap.
            Err(e) if batch.iter().any(|i| seeds.contains(i)) => return Err(format!("web: artists {e}")),
            Err(e) => {
                crate::log::warn(&format!("web: artists {e}"));
                b.failed.extend(batch.iter().cloned());
                continue;
            }
        };
        let mut stored: HashMap<String, (Stored, bool)> = HashMap::new(); // id → (read, ok)
        let mut album_owners: HashMap<String, Vec<String>> = HashMap::new();

        for a in body["data"].as_array().cloned().unwrap_or_default() {
            let Some(id) = a["id"].as_str().map(String::from) else { continue };
            let artist = artist_from_catalog(&a);
            b.remember(&artist.name, &id);
            let top: Vec<Track> = a["views"]["top-songs"]["data"]
                .as_array()
                .map(|arr| arr.iter().filter(|s| s["type"].as_str() == Some("songs")).map(track_from_catalog_song).collect())
                .unwrap_or_default();
            b.note_credits(&top);
            let mut ok = true;
            let mut paged = false;
            if full {
                for view in ["singles", "appears-on-albums"] {
                    let mut list = a["views"][view]["data"].as_array().cloned().unwrap_or_default();
                    // The seed only: the rest of the view, one call up to 100.
                    if seeds.contains(&id) && a["views"][view]["next"].is_string() {
                        let url = format!("https://api.music.apple.com/v1/catalog/{sf}/artists/{id}/view/{view}?limit=100");
                        match apple.get(&url, Call::Views).await {
                            Ok(page) => list = page["data"].as_array().cloned().unwrap_or(list),
                            Err(e) if apple.stale() => return Err(e),
                            Err(e) => {
                                crate::log::warn(&format!("web: seed view {view} {e}"));
                                ok = false;
                            }
                        }
                    }
                    for al in list {
                        if let Some(aid) = al["id"].as_str() {
                            album_owners.entry(aid.to_string()).or_default().push(id.clone());
                        }
                    }
                }
                paged = seeds.contains(&id);
            }
            let s = Stored { artist, top, credited: Vec::new(), links: HashMap::new(), full, paged };
            stored.insert(id, (s, ok));
        }
        // Apple left an id out of its answer: nothing to save, and a Retry asks again.
        for id in batch {
            if !stored.contains_key(id) {
                b.failed.insert(id.clone());
            }
        }

        // The albums' tracklists, with each song's artists (ids and names).
        let album_ids: Vec<String> = album_owners.keys().cloned().collect();
        let mut lookups: Vec<(String, String)> = Vec::new(); // (owner, name): the seed's unknown names
        for chunk in album_ids.chunks(ALBUM_BATCH) {
            let url = format!(
                "https://api.music.apple.com/v1/catalog/{sf}/albums?ids={}&include=tracks&include[songs]=artists",
                chunk.join(",")
            );
            let body = match apple.get(&url, Call::Albums).await {
                Ok(v) => v,
                Err(e) if apple.stale() => return Err(e),
                Err(e) => {
                    crate::log::warn(&format!("web: albums {e}"));
                    for aid in chunk {
                        for owner in album_owners.get(aid).into_iter().flatten() {
                            if let Some(e) = stored.get_mut(owner) {
                                e.1 = false; // saved as failed: a Retry reads it again
                            }
                        }
                    }
                    continue;
                }
            };
            for alb in body["data"].as_array().cloned().unwrap_or_default() {
                let owners = alb["id"].as_str().and_then(|i| album_owners.get(i)).cloned().unwrap_or_default();
                for t in alb["relationships"]["tracks"]["data"].as_array().cloned().unwrap_or_default() {
                    if t["type"].as_str() != Some("songs") {
                        continue;
                    }
                    // Apple's artists here are the main credits only; "feat." artists are not in it.
                    let rel: Vec<(String, String)> = t["relationships"]["artists"]["data"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| Some((x["id"].as_str()?.to_string(), x["attributes"]["name"].as_str().unwrap_or("").to_string())))
                                .collect()
                        })
                        .unwrap_or_default();
                    for (rid, rname) in &rel {
                        if !rname.is_empty() {
                            b.remember(rname, rid);
                        }
                    }
                    let track = track_from_catalog_song(&t);
                    let keys: HashSet<String> = credited_names(&track).iter().map(|n| norm(n)).collect();
                    for owner in &owners {
                        let Some((s, _)) = stored.get_mut(owner) else { continue };
                        let me = norm(&s.artist.name);
                        if !keys.contains(&me) {
                            continue;
                        }
                        s.credited.push(track.clone());
                        let mut linked: HashSet<String> = rel.iter().map(|(rid, _)| rid.clone()).filter(|rid| rid != owner).collect();
                        for n in line_names(b, &track.artist_name).into_iter().chain(feat_names(&track.title)) {
                            if norm(&n) == me {
                                continue;
                            }
                            match b.names.get(&norm(&n)) {
                                Some(i) if !i.is_empty() && i != owner => {
                                    linked.insert(i.clone());
                                }
                                Some(_) => {}
                                None if seeds.contains(owner) => lookups.push((owner.clone(), n)),
                                None => {}
                            }
                        }
                        for l in linked {
                            *s.links.entry(l).or_default() += 1;
                        }
                    }
                }
            }
        }

        // The seed's "feat." names nothing else resolved: one search each, a few at most.
        for (owner, name) in lookups {
            let id = lookup(apple, b, &name).await?;
            if !id.is_empty() && id != owner {
                if let Some((s, _)) = stored.get_mut(&owner) {
                    *s.links.entry(id).or_default() += 1;
                }
            }
        }

        for (id, (s, ok)) in stored {
            if ok {
                b.failed.remove(&id);
            } else {
                b.failed.insert(id.clone());
            }
            b.save(&id, &s, ok);
        }
    }
    Ok(())
}

/// A name's catalog id: known names first, then one artist search (at most SEED_LOOKUPS a
/// build). The answer, a miss too, is saved. "" = no match.
async fn lookup(apple: &mut Apple, b: &mut Build<'_>, name: &str) -> Result<String, String> {
    let key = norm(name);
    if let Some(i) = b.names.get(&key) {
        return Ok(i.clone());
    }
    if key.is_empty() || NOT_NAMES.contains(&key.as_str()) || b.asked.len() >= SEED_LOOKUPS || !b.asked.insert(key.clone()) {
        return Ok(String::new());
    }
    let mut u = url::Url::parse(&format!("https://api.music.apple.com/v1/catalog/{}/search", apple.sf)).map_err(|e| e.to_string())?;
    u.query_pairs_mut().append_pair("term", name).append_pair("types", "artists").append_pair("limit", "1");
    let hit = match apple.get(u.as_str(), Call::Search).await {
        Ok(v) => {
            let a = &v["results"]["artists"]["data"][0];
            match (a["id"].as_str(), a["attributes"]["name"].as_str()) {
                (Some(i), Some(n)) if norm(n) == key => i.to_string(),
                _ => String::new(),
            }
        }
        Err(e) if apple.stale() => return Err(e),
        // Apple refuses some artist searches outright (a 401 on "Sherwyn"): a miss.
        Err(_) => String::new(),
    };
    b.names.insert(key.clone(), hit.clone());
    b.new_names.push((key, hit.clone()));
    Ok(hit)
}

/// An album seed's full tracklist with each song's main credits (§9.5): saved for
/// ARTIST_TTL_MS, so 1 call the first time and 0 after. Returns the read and when it was made.
async fn read_album(apple: &mut Apple, b: &mut Build<'_>, album: &Album, song_id: Option<&str>, fresh: bool) -> Result<(AlbumRead, i64), String> {
    let mut keys: Vec<String> = Vec::new();
    if let Some(id) = &album.catalog_id {
        keys.push(format!("album:{id}"));
    }
    if let Some(id) = song_id {
        keys.push(format!("song:{id}"));
    }
    if keys.is_empty() {
        return Err("web: the album has no catalog id".into());
    }
    let saved = if fresh { None } else { keys.iter().find_map(|k| b.album_row(k)).filter(|(_, at)| now_ms() - at <= ARTIST_TTL_MS) };
    let (read, at) = match saved {
        Some(hit) => hit,
        None => {
            const INC: &str = "include=tracks&include[songs]=artists";
            let sf = apple.sf.clone();
            let url = match (&album.catalog_id, song_id) {
                (Some(id), _) => format!("https://api.music.apple.com/v1/catalog/{sf}/albums/{id}?{INC}"),
                (None, Some(sid)) => format!("https://api.music.apple.com/v1/catalog/{sf}/songs/{sid}/albums?{INC}"),
                (None, None) => unreachable!(),
            };
            let body = apple.get(&url, Call::Albums).await.map_err(|e| format!("web: album {e}"))?;
            let mut data = body["data"][0].clone();
            if data.is_null() {
                return Err("web: Apple has no such album".into());
            }
            // A relationship route may leave out `include`: read the album itself (one call more).
            if data["relationships"]["tracks"]["data"].as_array().is_none() {
                let id = data["id"].as_str().ok_or("web: Apple has no such album")?.to_string();
                crate::log::info("web: the album route left out its tracks; reading the album");
                let body = apple
                    .get(&format!("https://api.music.apple.com/v1/catalog/{sf}/albums/{id}?{INC}"), Call::Albums)
                    .await
                    .map_err(|e| format!("web: album {e}"))?;
                data = body["data"][0].clone();
            }
            let mut tracks = Vec::new();
            for t in data["relationships"]["tracks"]["data"].as_array().cloned().unwrap_or_default() {
                if t["type"].as_str() != Some("songs") {
                    continue;
                }
                let rel: Vec<(String, String)> = t["relationships"]["artists"]["data"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| Some((x["id"].as_str()?.to_string(), x["attributes"]["name"].as_str().unwrap_or("").to_string())))
                            .collect()
                    })
                    .unwrap_or_default();
                tracks.push((track_from_catalog_song(&t), rel));
            }
            let read = AlbumRead { album: crate::apple::album_from_catalog(&data), tracks };
            b.note_credits(&read.tracks.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>());
            if let Some(id) = &read.album.catalog_id {
                let k = format!("album:{id}");
                if !keys.contains(&k) {
                    keys.push(k);
                }
            }
            b.save_album(&keys, &read);
            (read, now_ms())
        }
    };
    for (_, rel) in &read.tracks {
        for (id, name) in rel {
            if !name.is_empty() {
                b.remember(name, id);
            }
        }
    }
    Ok((read, at))
}

/// A seed, taken apart: who is read at degree 0, who goes first into degree 1, and what
/// leads the playlist.
struct SeedParts {
    leads: Vec<String>,
    forced: Vec<String>,
    anchor: Vec<Track>,
    genres: Vec<String>,
    /// The artist line and cover a song or album seed shows as `WebResult::seed`.
    line: String,
    cover: Option<Artwork>,
    /// When the album read was made (a saved read counts toward `oldest`).
    at: Option<i64>,
    /// The seed as saved in "Web before": an album carries Apple's own title, artist and id.
    saved: WebSeed,
}

/// `id` into `list` once, unless it is empty or one of `not`.
fn push_id(list: &mut Vec<String>, id: String, not: &[String]) {
    if !id.is_empty() && !not.contains(&id) && !list.contains(&id) {
        list.push(id);
    }
}

async fn seed_parts(apple: &mut Apple, b: &mut Build<'_>, seed: &WebSeed, fresh: bool) -> Result<SeedParts, String> {
    match seed {
        WebSeed::Artist { artist } => {
            let id = artist.catalog_id.clone().ok_or("web: the artist has no catalog id")?;
            Ok(SeedParts {
                leads: vec![id],
                forced: vec![],
                anchor: vec![],
                genres: vec![],
                line: artist.name.clone(),
                cover: artist.artwork.clone(),
                at: None,
                saved: seed.clone(),
            })
        }
        WebSeed::Song { track } => {
            let leads = match b.leads_known(&track.artist_name) {
                Some(ids) => ids,
                None => {
                    // A lead not known by name: the song's own credits, one call.
                    let cid = track.catalog_id.clone().ok_or("web: the song has no catalog id")?;
                    let url = format!("https://api.music.apple.com/v1/catalog/{}/songs/{cid}?include=artists", apple.sf);
                    let body = apple.get(&url, Call::Song).await.map_err(|e| format!("web: song {e}"))?;
                    let mut ids = Vec::new();
                    for x in body["data"][0]["relationships"]["artists"]["data"].as_array().cloned().unwrap_or_default() {
                        let Some(id) = x["id"].as_str() else { continue };
                        if let Some(n) = x["attributes"]["name"].as_str() {
                            b.remember(n, id);
                        }
                        push_id(&mut ids, id.to_string(), &[]);
                    }
                    if ids.is_empty() {
                        return Err("web: Apple has no artist for this song".into());
                    }
                    ids
                }
            };
            let mut forced = Vec::new();
            for n in feat_names(&track.title) {
                let id = lookup(apple, b, &n).await?;
                push_id(&mut forced, id, &leads);
            }
            Ok(SeedParts {
                leads,
                forced,
                anchor: vec![track.clone()],
                genres: track.genres.clone(),
                line: track.artist_name.clone(),
                cover: track.artwork.clone(),
                at: None,
                saved: seed.clone(),
            })
        }
        WebSeed::Album { album, song_id } => {
            let (read, at) = read_album(apple, b, album, song_id.as_deref(), fresh).await?;
            let line = read.album.artist_name.clone();
            // A compilation has no lead: the web grows from the artists on its songs.
            let leads = if norm(&line) == "variousartists" {
                Vec::new()
            } else if let Some(ids) = b.leads_known(&line) {
                ids
            } else {
                let mut ids = Vec::new();
                for n in line_names(b, &line) {
                    let id = lookup(apple, b, &n).await?;
                    push_id(&mut ids, id, &[]);
                }
                ids
            };
            // Every other artist on the album, the most songs first; a tie keeps album order.
            let mut count: HashMap<String, u32> = HashMap::new();
            let mut seen: Vec<String> = Vec::new();
            for (t, rel) in &read.tracks {
                let mut on: Vec<String> = Vec::new();
                for (id, _) in rel {
                    push_id(&mut on, id.clone(), &leads);
                }
                for n in feat_names(&t.title) {
                    let id = lookup(apple, b, &n).await?;
                    push_id(&mut on, id, &leads);
                }
                for id in on {
                    let c = count.entry(id.clone()).or_insert(0);
                    if *c == 0 {
                        seen.push(id);
                    }
                    *c += 1;
                }
            }
            let mut forced = seen.clone();
            forced.sort_by(|x, y| count[y].cmp(&count[x])); // stable: album order within a count
            let genres = if read.album.genres.is_empty() {
                read.tracks.first().map(|(t, _)| t.genres.clone()).unwrap_or_default()
            } else {
                read.album.genres.clone()
            };
            Ok(SeedParts {
                leads,
                forced,
                anchor: read.tracks.iter().map(|(t, _)| t.clone()).collect(),
                genres,
                line,
                cover: read.album.artwork.clone(),
                at: Some(at),
                saved: WebSeed::Album { album: read.album.clone(), song_id: song_id.clone() },
            })
        }
    }
}

/// What you already have, by catalog id: 3 ♥, 2 played, 1 in your library.
fn mine_by_id(db: &Db) -> HashMap<String, u8> {
    let conn = db.lock();
    let mut out: HashMap<String, u8> = HashMap::new();
    let mut add = |sql: &str, level: u8| {
        if let Ok(mut st) = conn.prepare(sql) {
            if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                for id in rows.flatten() {
                    let e = out.entry(id).or_insert(0);
                    *e = (*e).max(level);
                }
            }
        }
    };
    add("SELECT track_id FROM tracks WHERE source = 'library'", 1);
    add("SELECT track_id FROM play_stats WHERE partial_count > 0 OR full_count > 0", 2);
    add("SELECT track_id FROM favorites WHERE loved = 1", 3);
    out
}

/// Build the web around `seed` (an artist, a song or an album) out to `reach` degrees (1–3).
/// `fresh` reads its artists (and an album's tracklist) from Apple again instead of the saved reads.
#[tauri::command]
pub async fn web_build(
    seed: WebSeed,
    reach: u8,
    fresh: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, Db>,
) -> Result<WebResult, String> {
    let reach = reach.clamp(1, 3);
    let fresh = fresh.unwrap_or(false);
    let dev = developer_token()?;
    let user = state.user_token.lock_or_recover().clone().ok_or("not connected to Apple Music")?;
    let client = crate::apple::http_client();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    // A newer build makes this one stop before its next Apple call: a Reach press during a build
    // no longer reads the same artists twice (2026-09-17: 8TEEN reach 1 and 2 overlapped, 49 calls).
    let gen = BUILD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let mut apple = Apple { client, dev, user, sf, calls: 0, by: [0; 5], gen };
    let mut b = Build { db: &db, names: Build::load_names(&db), new_names: Vec::new(), asked: HashSet::new(), failed: HashSet::new() };
    let out = build_web(&seed, reach, fresh, &app, &mut apple, &mut b, &db).await;
    b.save_names(); // a stopped or failed build keeps the names it searched
    let what = format!("seed={}:{} reach={reach} fresh={fresh}", seed.kind(), seed.title());
    match out {
        Ok(r) => {
            crate::log::info(&format!(
                "web: built {what} artists={} songs={} {} failed={}",
                r.artists.len(),
                r.songs.len(),
                apple.split(),
                r.failed
            ));
            Ok(r)
        }
        Err(e) if apple.stale() => {
            crate::log::info(&format!("web: stopped {what} (a newer build started) {}", apple.split()));
            Err(e)
        }
        Err(e) => {
            crate::log::warn(&format!("web: failed {what} {} {e}", apple.split()));
            Err(e)
        }
    }
}

async fn build_web(
    seed: &WebSeed,
    reach: u8,
    fresh: bool,
    app: &tauri::AppHandle,
    apple: &mut Apple,
    b: &mut Build<'_>,
    db: &Db,
) -> Result<WebResult, String> {
    let parts = seed_parts(apple, b, &seed, fresh).await?;
    if parts.leads.is_empty() && parts.forced.is_empty() {
        return Err("web: no artist to start from".into());
    }
    let seeds: HashSet<String> = parts.leads.iter().cloned().collect();
    let mut degree_of: HashMap<String, u8> = parts.leads.iter().map(|id| (id.clone(), 0)).collect();
    let mut order: Vec<(String, u8)> = parts.leads.iter().map(|id| (id.clone(), 0)).collect();
    let mut frontier = parts.leads.clone();

    for d in 0..=reach {
        let _ = app.emit("web-progress", Progress { degree: d, artists: frontier.len() });
        read_artists(apple, b, &frontier, d < reach, &seeds, fresh).await?;
        if d == reach {
            break;
        }
        // Rank the next degree: linked from more artists of this degree first, then by songs
        // shared. Ties keep the order they were found in.
        let mut score: HashMap<String, (HashSet<String>, u32)> = HashMap::new();
        let mut seen_order: Vec<String> = Vec::new();
        for id in &frontier {
            let Some(r) = b.row(id) else { continue };
            let mut links: Vec<(&String, &u32)> = r.s.links.iter().collect();
            links.sort_by(|x, y| y.1.cmp(x.1).then(x.0.cmp(y.0)));
            for (other, shared) in links {
                if degree_of.contains_key(other) {
                    continue;
                }
                let e = score.entry(other.clone()).or_insert_with(|| {
                    seen_order.push(other.clone());
                    (HashSet::new(), 0)
                });
                e.0.insert(id.clone());
                e.1 += shared;
            }
        }
        let rank = |id: &String| seen_order.iter().position(|x| x == id).unwrap_or(usize::MAX);
        let mut ranked: Vec<String> = score.keys().cloned().collect();
        ranked.sort_by(|x, y| {
            let (sx, sy) = (&score[x], &score[y]);
            sy.0.len().cmp(&sx.0.len()).then(sy.1.cmp(&sx.1)).then(rank(x).cmp(&rank(y)))
        });
        // A song's guests and an album's other artists go first into degree 1 (§9.4).
        let mut next: Vec<String> = Vec::new();
        if d == 0 {
            for id in &parts.forced {
                if !degree_of.contains_key(id) {
                    push_id(&mut next, id.clone(), &[]);
                }
            }
        }
        for id in ranked {
            push_id(&mut next, id, &[]);
        }
        next.truncate(if d == 0 { SEED_FANOUT } else { DEGREE_FANOUT });
        for id in &next {
            degree_of.insert(id.clone(), d + 1);
            order.push((id.clone(), d + 1));
        }
        frontier = next;
    }
    let seed_artist = match &seed {
        WebSeed::Artist { .. } => b.row(&parts.leads[0]).ok_or("web: Apple has no such artist")?.s.artist,
        _ => Artist { name: parts.line.clone(), catalog_id: parts.leads.first().cloned(), artwork: parts.cover.clone(), ..Default::default() },
    };
    // A seed song credits any seed artist, by the name Apple gives them.
    let seed_keys: HashSet<String> = parts.leads.iter().filter_map(|id| b.row(id)).map(|r| norm(&r.s.artist.name)).collect();
    let mine = mine_by_id(db);
    let mut songs: Vec<WebSong> = Vec::new();
    let mut artists: Vec<WebArtist> = Vec::new();
    let mut keys: HashSet<String> = HashSet::new();
    let mut oldest = parts.at.unwrap_or_else(now_ms);
    let first_lead = parts.leads.first().cloned().unwrap_or_default();
    // One song once: the same recording (ISRC), or the same title and artist line.
    let mut once = |t: &Track| {
        let by_name = format!("{}|{}", norm(&t.title), norm(&t.artist_name));
        if keys.contains(&by_name) || t.isrc.as_ref().is_some_and(|i| keys.contains(i)) {
            return false;
        }
        keys.insert(by_name);
        if let Some(i) = &t.isrc {
            keys.insert(i.clone());
        }
        true
    };
    let level = |t: &Track| t.catalog_id.as_ref().and_then(|c| mine.get(c)).copied().unwrap_or(0);
    // The anchor first, so a lead's copy of the same song is the one dropped. You picked it:
    // no variant rule.
    for t in &parts.anchor {
        if once(t) {
            songs.push(WebSong { track: t.clone(), degree: 0, artist_id: first_lead.clone(), seed: true, anchor: true, mine: level(t) });
        }
    }
    for (id, d) in &order {
        let Some(r) = b.row(id) else { continue };
        oldest = oldest.min(r.fetched_at);
        artists.push(WebArtist { id: id.clone(), name: r.s.artist.name.clone(), degree: *d });
        for t in r.s.top.iter().chain(r.s.credited.iter()) {
            if is_variant(&t.title) || !once(t) {
                continue;
            }
            let seed_song = credited_names(t).iter().any(|x| seed_keys.contains(&norm(x)));
            songs.push(WebSong {
                track: t.clone(),
                degree: if seed_song { 0 } else { *d },
                artist_id: id.clone(),
                seed: seed_song,
                anchor: false,
                mine: level(t),
            });
        }
    }
    let failed = b.failed.len() as u32;
    save_seed(db, &parts.saved);
    Ok(WebResult { kind: seed.kind(), seed: seed_artist, genres: parts.genres, artists, songs, calls: apple.calls, failed, oldest })
}

/// Put a built seed at the top of "Web before".
fn save_seed(db: &Db, seed: &WebSeed) {
    let id = match seed {
        WebSeed::Artist { artist } => artist.catalog_id.clone(),
        WebSeed::Song { track } => track.catalog_id.clone(),
        WebSeed::Album { album, song_id } => album.catalog_id.clone().or_else(|| song_id.as_ref().map(|s| format!("song:{s}"))),
    };
    let (Some(id), Ok(json)) = (id, serde_json::to_string(seed)) else { return };
    let conn = db.lock();
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO web_seed_list(kind, id, json, built_at) VALUES(?1, ?2, ?3, ?4)",
        rusqlite::params![seed.kind(), id, json, now_ms()],
    ) {
        crate::log::warn(&format!("web: save seed {e}"));
    }
}

/// The seeds webs were built from, all kinds, newest first. The panel's field offers them,
/// filtered by its Artist · Song · Album row, before any search. Zero Apple calls.
#[tauri::command]
pub async fn web_seeds(app: tauri::AppHandle) -> Result<Vec<WebSeed>, String> {
    crate::db_thread::run(&app, move |db| {
        let conn = db.lock();
        let mut st = conn
            .prepare_cached("SELECT json FROM web_seed_list ORDER BY built_at DESC LIMIT 60")
            .map_err(|e| e.to_string())?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        Ok(rows.flatten().filter_map(|j| serde_json::from_str::<WebSeed>(&j).ok()).collect())
    })
    .await
}

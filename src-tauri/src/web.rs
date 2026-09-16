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

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::apple::{api_get, artist_from_catalog, developer_token, track_from_catalog_song, AppleState};
use crate::library::Db;
use crate::model::{Artist, Track};

const ARTIST_BATCH: usize = 25;
const ALBUM_BATCH: usize = 50;
/// The seed's collaborators all go on to degree 1; after that, the best-linked few.
const SEED_FANOUT: usize = 40;
const DEGREE_FANOUT: usize = 15;
const SEED_LOOKUPS: usize = 10;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// A saved artist read counts as current this long (Apple's credits change slowly).
const ARTIST_TTL_MS: i64 = 7 * DAY_MS;
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
        );",
    )
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
    /// The song credits the seed (its own songs and its features) — never genre-filtered.
    pub seed: bool,
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
    pub seed: Artist,
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

/// "A, B & C" → ["A", "B", "C"].
fn split_names(s: &str) -> Vec<String> {
    s.split([',', '&']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
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

struct Apple {
    client: reqwest::Client,
    dev: String,
    user: String,
    sf: String,
    calls: u32,
}

impl Apple {
    async fn get(&mut self, url: &str) -> Result<serde_json::Value, String> {
        self.calls += 1;
        let (status, body) = api_get(&self.client, &self.dev, &self.user, url).await?;
        if status != 200 {
            return Err(format!("HTTP {status}"));
        }
        Ok(body)
    }
}

/// One build's working state: the names it knows and the database.
struct Build<'a> {
    db: &'a Db,
    /// Normalized name → catalog id ("" = looked up, no match).
    names: HashMap<String, String>,
    /// Names looked up by search in this build, saved at the end.
    new_names: Vec<(String, String)>,
    failed: HashSet<String>,
}

impl Build<'_> {
    /// Names already known, at zero calls: the Library artist view's ids (`artist_catalog`)
    /// and earlier web lookups (a miss older than NAME_MISS_TTL_MS is forgotten).
    fn load_names(db: &Db) -> HashMap<String, String> {
        let conn = db.0.lock().unwrap();
        let mut names = HashMap::new();
        if let Ok(mut st) = conn.prepare("SELECT name, catalog_id FROM artist_catalog WHERE catalog_id <> ''") {
            if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                for (n, id) in rows.flatten() {
                    names.insert(norm(&n), id);
                }
            }
        }
        let cutoff = now_ms() - NAME_MISS_TTL_MS;
        if let Ok(mut st) = conn.prepare("SELECT name, catalog_id FROM web_names WHERE catalog_id <> '' OR fetched_at > ?1") {
            if let Ok(rows) = st.query_map([cutoff], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                for (n, id) in rows.flatten() {
                    names.entry(n).or_insert(id);
                }
            }
        }
        names
    }

    fn remember(&mut self, name: &str, id: &str) {
        self.names.entry(norm(name)).or_insert_with(|| id.to_string());
    }

    fn row(&self, id: &str) -> Option<Row> {
        let conn = self.db.0.lock().unwrap();
        conn.query_row("SELECT json, ok, fetched_at FROM web_artists WHERE catalog_id = ?1", [id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        })
        .ok()
        .and_then(|(json, ok, at)| serde_json::from_str::<Stored>(&json).ok().map(|s| Row { s, ok: ok != 0, fetched_at: at }))
    }

    fn save(&self, id: &str, s: &Stored, ok: bool) {
        let Ok(json) = serde_json::to_string(s) else { return };
        let conn = self.db.0.lock().unwrap();
        if let Err(e) = conn.execute(
            "INSERT OR REPLACE INTO web_artists(catalog_id, json, ok, fetched_at) VALUES(?1, ?2, ?3, ?4)",
            rusqlite::params![id, json, ok as i64, now_ms()],
        ) {
            crate::log::warn(&format!("web: save artist {e}"));
        }
    }

    fn save_names(&self) {
        let conn = self.db.0.lock().unwrap();
        for (n, id) in &self.new_names {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO web_names(name, catalog_id, fetched_at) VALUES(?1, ?2, ?3)",
                rusqlite::params![n, id, now_ms()],
            );
        }
    }
}

/// Read the artists in `ids` that are not saved, or saved but old, failed, or without the
/// albums (`full`) or the paging (the seed) this degree needs. `fresh` reads all of them.
async fn read_artists(apple: &mut Apple, b: &mut Build<'_>, ids: &[String], full: bool, seed_id: &str, fresh: bool) -> Result<(), String> {
    let need: Vec<String> = ids
        .iter()
        .filter(|id| {
            fresh
                || match b.row(id) {
                    Some(r) => {
                        !r.ok
                            || now_ms() - r.fetched_at > ARTIST_TTL_MS
                            || (full && !r.s.full)
                            || (full && id.as_str() == seed_id && !r.s.paged)
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
        let body = match apple.get(&url).await {
            Ok(b) => b,
            // The seed's own read failing is the build failing; any other batch is a gap.
            Err(e) if batch.iter().any(|i| i == seed_id) => return Err(format!("web: artists {e}")),
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
            let mut ok = true;
            let mut paged = false;
            if full {
                for view in ["singles", "appears-on-albums"] {
                    let mut list = a["views"][view]["data"].as_array().cloned().unwrap_or_default();
                    // The seed only: the rest of the view, one call up to 100.
                    if id == seed_id && a["views"][view]["next"].is_string() {
                        let url = format!("https://api.music.apple.com/v1/catalog/{sf}/artists/{id}/view/{view}?limit=100");
                        match apple.get(&url).await {
                            Ok(page) => list = page["data"].as_array().cloned().unwrap_or(list),
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
                paged = id == seed_id;
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
            let body = match apple.get(&url).await {
                Ok(v) => v,
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
                        for n in split_names(&track.artist_name).into_iter().chain(feat_names(&track.title)) {
                            if norm(&n) == me {
                                continue;
                            }
                            match b.names.get(&norm(&n)) {
                                Some(i) if !i.is_empty() && i != owner => {
                                    linked.insert(i.clone());
                                }
                                Some(_) => {}
                                None if owner == seed_id => lookups.push((owner.clone(), n)),
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
        let mut asked: HashSet<String> = HashSet::new();
        for (owner, name) in lookups {
            let key = norm(&name);
            let known = b.names.get(&key).cloned();
            let id = match known {
                Some(i) => i,
                None => {
                    if asked.len() >= SEED_LOOKUPS || !asked.insert(key.clone()) {
                        continue;
                    }
                    let mut u = url::Url::parse(&format!("https://api.music.apple.com/v1/catalog/{sf}/search")).map_err(|e| e.to_string())?;
                    u.query_pairs_mut().append_pair("term", &name).append_pair("types", "artists").append_pair("limit", "1");
                    let hit = match apple.get(u.as_str()).await {
                        Ok(v) => {
                            let a = &v["results"]["artists"]["data"][0];
                            match (a["id"].as_str(), a["attributes"]["name"].as_str()) {
                                (Some(i), Some(n)) if norm(n) == key => i.to_string(),
                                _ => String::new(),
                            }
                        }
                        // Apple refuses some artist searches outright (a 401 on "Sherwyn"): a miss.
                        Err(_) => String::new(),
                    };
                    b.names.insert(key.clone(), hit.clone());
                    b.new_names.push((key, hit.clone()));
                    hit
                }
            };
            if !id.is_empty() {
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

/// What you already have, by catalog id: 3 ♥, 2 played, 1 in your library.
fn mine_by_id(db: &Db) -> HashMap<String, u8> {
    let conn = db.0.lock().unwrap();
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

/// Build the web around `seed_id` out to `reach` degrees (1–3). `fresh` reads its artists
/// from Apple again instead of from the saved reads.
#[tauri::command]
pub async fn web_build(
    seed_id: String,
    reach: u8,
    fresh: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppleState>,
    db: tauri::State<'_, Db>,
) -> Result<WebResult, String> {
    let reach = reach.clamp(1, 3);
    let fresh = fresh.unwrap_or(false);
    let dev = developer_token()?;
    let user = state.user_token.lock().unwrap().clone().ok_or("not connected to Apple Music")?;
    let client = reqwest::Client::new();
    let sf = crate::enrich::storefront(&client, &dev, &user, &db).await?;
    let mut apple = Apple { client, dev, user, sf, calls: 0 };
    let mut b = Build { db: &db, names: Build::load_names(&db), new_names: Vec::new(), failed: HashSet::new() };

    let mut degree_of: HashMap<String, u8> = HashMap::from([(seed_id.clone(), 0)]);
    let mut order: Vec<(String, u8)> = vec![(seed_id.clone(), 0)];
    let mut frontier = vec![seed_id.clone()];

    for d in 0..=reach {
        let _ = app.emit("web-progress", Progress { degree: d, artists: frontier.len() });
        read_artists(&mut apple, &mut b, &frontier, d < reach, &seed_id, fresh).await?;
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
        let mut next: Vec<String> = score.keys().cloned().collect();
        next.sort_by(|x, y| {
            let (sx, sy) = (&score[x], &score[y]);
            sy.0.len().cmp(&sx.0.len()).then(sy.1.cmp(&sx.1)).then(rank(x).cmp(&rank(y)))
        });
        next.truncate(if d == 0 { SEED_FANOUT } else { DEGREE_FANOUT });
        for id in &next {
            degree_of.insert(id.clone(), d + 1);
            order.push((id.clone(), d + 1));
        }
        frontier = next;
    }
    b.save_names();

    let seed = b.row(&seed_id).ok_or("web: Apple has no such artist")?;
    let seed_key = norm(&seed.s.artist.name);
    let mine = mine_by_id(&db);
    let mut songs: Vec<WebSong> = Vec::new();
    let mut artists: Vec<WebArtist> = Vec::new();
    let mut keys: HashSet<String> = HashSet::new();
    let mut oldest = now_ms();
    for (id, d) in &order {
        let Some(r) = b.row(id) else { continue };
        oldest = oldest.min(r.fetched_at);
        artists.push(WebArtist { id: id.clone(), name: r.s.artist.name.clone(), degree: *d });
        for t in r.s.top.iter().chain(r.s.credited.iter()) {
            if is_variant(&t.title) {
                continue;
            }
            // One song once: the same recording (ISRC), or the same title and artist line.
            let by_name = format!("{}|{}", norm(&t.title), norm(&t.artist_name));
            if keys.contains(&by_name) || t.isrc.as_ref().is_some_and(|i| keys.contains(i)) {
                continue;
            }
            keys.insert(by_name);
            if let Some(i) = &t.isrc {
                keys.insert(i.clone());
            }
            let seed_song = credited_names(t).iter().any(|x| norm(x) == seed_key);
            let level = t.catalog_id.as_ref().and_then(|c| mine.get(c)).copied().unwrap_or(0);
            songs.push(WebSong {
                track: t.clone(),
                degree: if seed_song { 0 } else { *d },
                artist_id: id.clone(),
                seed: seed_song,
                mine: level,
            });
        }
    }
    let failed = b.failed.len() as u32;
    crate::log::info(&format!(
        "web: built seed={} reach={reach} fresh={fresh} artists={} songs={} calls={} failed={failed}",
        seed.s.artist.name,
        artists.len(),
        songs.len(),
        apple.calls
    ));
    Ok(WebResult { seed: seed.s.artist, artists, songs, calls: apple.calls, failed, oldest })
}

/// The artists webs were built from, newest first (a seed read is the one that pages its
/// views). The panel's artist field offers them before any search. Zero Apple calls.
#[tauri::command]
pub fn web_seeds(db: tauri::State<'_, Db>) -> Result<Vec<Artist>, String> {
    let conn = db.0.lock().unwrap();
    let mut st = conn
        .prepare("SELECT json FROM web_artists ORDER BY fetched_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    Ok(rows
        .flatten()
        .filter_map(|j| serde_json::from_str::<Stored>(&j).ok())
        .filter(|s| s.paged)
        .map(|s| s.artist)
        .take(20)
        .collect())
}

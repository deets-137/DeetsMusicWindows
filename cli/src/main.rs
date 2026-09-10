//! `deetsmusic` — the command-line and MCP client for the DeetsMusic bridge
//! (docs/AGENT.md). A thin, stateless HTTP client: every subcommand is one or two
//! requests to the app's loopback server, formatted for a human (default) or a
//! machine (`--json`). `deetsmusic mcp` serves the same operations as MCP tools over
//! stdio for Claude Code / small local models.
//!
//! Ids are PREFIXED everywhere (`song:…` `album:…` `playlist:…` `station:…`) so one
//! `play <id>` argument carries the kind — the shape a small tool-calling model can't
//! get wrong. Search first, then play by id.

use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::time::Duration;

const PORTS: [u16; 4] = [47825, 47826, 47827, 47828];
const IDS: [&str; 2] = ["com.deetsmusic.app", "com.deetsmusic.dev"];
const VERSION: &str = env!("CARGO_PKG_VERSION");

// ── CLI surface ───────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "deetsmusic", version, about = "Control DeetsMusic from the shell (or serve it as MCP tools).")]
struct Cli {
    /// Machine output: the bridge's JSON, untouched.
    #[arg(long, global = true)]
    json: bool,
    /// Bridge port (default: probe 47825–47828).
    #[arg(long, global = true, env = "DEETSMUSIC_PORT")]
    port: Option<u16>,
    /// Bridge token (default: read from the app's settings.json).
    #[arg(long, global = true, env = "DEETSMUSIC_TOKEN")]
    token: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args)]
struct SearchArgs {
    /// What to look for.
    query: String,
    #[arg(long, conflicts_with_all = ["artists", "playlists", "stations"])]
    albums: bool,
    #[arg(long, conflicts_with_all = ["albums", "playlists", "stations"])]
    artists: bool,
    #[arg(long, conflicts_with_all = ["albums", "artists", "stations"])]
    playlists: bool,
    #[arg(long, conflicts_with_all = ["albums", "artists", "playlists"])]
    stations: bool,
    /// Max hits.
    #[arg(short = 'n', long, default_value_t = 5)]
    limit: usize,
}

#[derive(Subcommand)]
enum Cmd {
    /// What's playing.
    Np,
    /// Bridge status: port, version, Apple Music connection.
    Status,
    /// Search the catalog (songs by default). Prints ids for `play` / `queue`.
    Search(SearchArgs),
    /// Radio stations: featured by default, `--genres`, or `--genre <id>`.
    Stations {
        #[arg(long, conflicts_with = "genre")]
        genres: bool,
        #[arg(long)]
        genre: Option<String>,
    },
    /// Your playlists (Apple mirror + local).
    Playlists,
    /// Play an id (song:… album:… playlist:… station:…), or a free-text song query.
    Play { target: String },
    /// Show the queue, add an id (next, or `--later` at the end), or `queue clear`.
    Queue {
        /// An id to add, or `clear`.
        target: Option<String>,
        #[arg(long)]
        later: bool,
    },
    Pause,
    Resume,
    Toggle,
    Next,
    Prev,
    Shuffle,
    Mute,
    /// Seek: `1:23`, `83` (seconds), or `45%`.
    Seek { position: String },
    /// Volume: `40`, `+5`, `-5` (percent).
    Vol { level: String },
    /// Session play history, newest first.
    History {
        #[arg(short = 'n', long, default_value_t = 20)]
        limit: usize,
    },
    /// Add the current song to your library.
    Add,
    /// Serve the same operations as MCP tools over stdio.
    Mcp,
}

// ── bridge client ─────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Client {
    base: String,
    token: String,
}

#[derive(Debug)]
struct Failure {
    status: u16,
    message: String,
}

impl Failure {
    fn exit_code(&self) -> i32 {
        match self.status {
            409 => 2, // not connected to Apple Music
            403 => 6, // Agent control is off in Settings
            400 => 3, // no match / bad id
            504 => 4, // the app window didn't answer
            0 => 5,   // no bridge found
            _ => 1,
        }
    }
}

fn settings_tokens() -> Vec<String> {
    let Some(appdata) = std::env::var_os("APPDATA") else { return vec![] };
    IDS.iter()
        .filter_map(|id| std::fs::read_to_string(std::path::Path::new(&appdata).join(id).join("settings.json")).ok())
        .filter_map(|s| serde_json::from_str::<Value>(&s).ok())
        .filter_map(|v| v.get("bridgeToken").or_else(|| v.get("bridge_token")).and_then(Value::as_str).map(String::from))
        .collect()
}

/// Find the bridge: the given port/token, else probe the port list with every token
/// the machine's DeetsMusic installs have (the dev build has its own settings.json).
fn connect(port: Option<u16>, token: Option<String>) -> Result<Client, Failure> {
    let tokens = match token {
        Some(t) => vec![t],
        None => settings_tokens(),
    };
    let ports: Vec<u16> = port.map(|p| vec![p]).unwrap_or_else(|| PORTS.to_vec());
    for p in ports {
        let base = format!("http://127.0.0.1:{p}");
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_millis(400)).build();
        let Ok(resp) = agent.get(&format!("{base}/health")).call() else { continue };
        if resp.status() != 200 {
            continue;
        }
        for t in &tokens {
            let ok = agent
                .get(&format!("{base}/health"))
                .set("Authorization", &format!("Bearer {t}"))
                .call()
                .ok()
                .and_then(|r| r.into_json::<Value>().ok())
                .and_then(|v| v.get("paired").and_then(Value::as_bool))
                .unwrap_or(false);
            if ok {
                return Ok(Client { base, token: t.clone() });
            }
        }
    }
    Err(Failure {
        status: 0,
        message: if tokens.is_empty() {
            "no bridge token found — is DeetsMusic installed? (or pass --token)".into()
        } else {
            "DeetsMusic isn't running (no bridge on 127.0.0.1:47825–47828)".into()
        },
    })
}

impl Client {
    fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, Failure> {
        let url = format!("{}{}", self.base, path);
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
        let req = agent.request(method, &url).set("Authorization", &format!("Bearer {}", self.token));
        let res = match body {
            Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
            None => req.call(),
        };
        match res {
            Ok(r) => r.into_json::<Value>().map_err(|e| Failure { status: 1, message: e.to_string() }),
            Err(ureq::Error::Status(code, r)) => {
                let msg = r
                    .into_json::<Value>()
                    .ok()
                    .and_then(|v| v.get("error").and_then(Value::as_str).map(String::from))
                    .unwrap_or_else(|| format!("HTTP {code}"));
                Err(Failure { status: code, message: msg })
            }
            Err(e) => Err(Failure { status: 1, message: e.to_string() }),
        }
    }
    fn get(&self, path: &str) -> Result<Value, Failure> {
        self.call("GET", path, None)
    }
    fn post(&self, path: &str, body: Value) -> Result<Value, Failure> {
        self.call("POST", path, Some(body))
    }
}

// ── formatting (shared by the CLI and the MCP tools) ─────────────────────────

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

fn mmss(secs: f64) -> String {
    let t = secs.max(0.0) as u64;
    format!("{}:{:02}", t / 60, t % 60)
}

fn track_line(t: &Value) -> String {
    let id = t.get("catalogId").and_then(Value::as_str).or_else(|| t.get("libraryId").and_then(Value::as_str)).unwrap_or("?");
    let album = s(t, "albumName");
    let tail = if album.is_empty() { String::new() } else { format!("  ·  {album}") };
    format!("song:{id}  {} — {}{tail}", s(t, "title"), s(t, "artistName"))
}

fn album_line(a: &Value) -> String {
    format!("album:{}  {} — {}", s(a, "catalogId"), s(a, "title"), s(a, "artistName"))
}

fn artist_line(a: &Value) -> String {
    format!("artist:{}  {}", s(a, "catalogId"), s(a, "name"))
}

fn playlist_line(p: &Value) -> String {
    let id = p.get("libraryId").and_then(Value::as_str).or_else(|| p.get("catalogId").and_then(Value::as_str)).unwrap_or("?");
    let n = p.get("trackCount").and_then(Value::as_u64).map(|n| format!("  ({n} songs)")).unwrap_or_default();
    let by = s(p, "curatorName");
    let by = if by.is_empty() { String::new() } else { format!(" — {by}") };
    format!("playlist:{id}  {}{by}{n}", s(p, "name"))
}

fn station_line(st: &Value) -> String {
    let live = if st.get("isLive").and_then(Value::as_bool).unwrap_or(false) { "  [LIVE]" } else { "" };
    let tag = s(st, "tagline");
    let tag = if tag.is_empty() { String::new() } else { format!("  — {tag}") };
    format!("station:{}  {}{live}{tag}", s(st, "id"), s(st, "name"))
}

fn np_line(v: &Value) -> String {
    if !v.get("active").and_then(Value::as_bool).unwrap_or(false) {
        return "Not playing".into();
    }
    let state = if v.get("playing").and_then(Value::as_bool).unwrap_or(false) { "▶" } else { "⏸" };
    let album = s(v, "album");
    let album = if album.is_empty() { String::new() } else { format!("  ·  {album}") };
    let time = if v.get("live").and_then(Value::as_bool).unwrap_or(false) {
        "LIVE".to_string()
    } else {
        format!(
            "{} / {}",
            mmss(v.get("currentTime").and_then(Value::as_f64).unwrap_or(0.0)),
            mmss(v.get("duration").and_then(Value::as_f64).unwrap_or(0.0))
        )
    };
    let vol = (v.get("volume").and_then(Value::as_f64).unwrap_or(0.0) * 100.0).round();
    let muted = if v.get("muted").and_then(Value::as_bool).unwrap_or(false) { " muted" } else { "" };
    format!("{state} {} — {}{album}  [{time}]  vol {vol}%{muted}", s(v, "title"), s(v, "artist"))
}

fn numbered(lines: Vec<String>) -> String {
    if lines.is_empty() {
        return "(no results)".into();
    }
    lines.iter().enumerate().map(|(i, l)| format!("{}. {l}", i + 1)).collect::<Vec<_>>().join("\n")
}

fn arr<'a>(v: &'a Value, k: &str) -> Vec<&'a Value> {
    v.get(k).and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
}

// ── operations (one per tool; the CLI subcommands are thin wrappers) ─────────

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Song,
    Album,
    Artist,
    Playlist,
    Station,
}

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>()
}

fn name_match(hay: &str, needle: &str) -> bool {
    let h = norm(hay);
    norm(needle).split_whitespace().all(|w| h.contains(w))
}

/// Search → (human lines, raw json). Stations come from the catalog search first, then
/// the featured / genre listings by name; your own playlists are matched by name
/// locally (they aren't in the catalog); everything else is one catalog search.
fn op_search(c: &Client, query: &str, kind: Kind, limit: usize) -> Result<(String, Value), Failure> {
    match kind {
        Kind::Station => {
            let cat = c.post("/search", json!({ "term": query, "types": ["stations"] }))?;
            let mut hits: Vec<Value> = arr(&cat, "stations").into_iter().cloned().collect();
            if hits.len() < limit {
                let featured = c.get("/stations?group=featured")?;
                hits.extend(arr(&featured, "stations").into_iter().filter(|st| name_match(s(st, "name"), query)).cloned());
            }
            if hits.len() < limit {
                let genres = c.get("/stations?group=genres")?;
                if let Some(g) = arr(&genres, "genres").into_iter().find(|g| name_match(s(g, "name"), query)) {
                    let list = c.get(&format!("/stations?group=genre:{}", s(g, "id")))?;
                    hits.extend(arr(&list, "stations").into_iter().cloned());
                }
            }
            hits.truncate(limit);
            Ok((numbered(hits.iter().map(station_line).collect()), json!({ "stations": hits })))
        }
        Kind::Playlist => {
            let mine = c.get("/playlists")?;
            let mut hits: Vec<Value> = arr(&mine, "playlists").into_iter().filter(|p| name_match(s(p, "name"), query)).cloned().collect();
            if hits.len() < limit {
                let cat = c.post("/search", json!({ "term": query, "types": ["playlists"] }))?;
                hits.extend(arr(&cat, "playlists").into_iter().cloned());
            }
            hits.truncate(limit);
            Ok((numbered(hits.iter().map(playlist_line).collect()), json!({ "playlists": hits })))
        }
        Kind::Song | Kind::Album | Kind::Artist => {
            let (t, key, f): (&str, &str, fn(&Value) -> String) = match kind {
                Kind::Song => ("songs", "songs", track_line),
                Kind::Album => ("albums", "albums", album_line),
                _ => ("artists", "artists", artist_line),
            };
            let res = c.post("/search", json!({ "term": query, "types": [t] }))?;
            let hits: Vec<Value> = arr(&res, key).into_iter().take(limit).cloned().collect();
            Ok((numbered(hits.iter().map(f).collect()), json!({ key: hits })))
        }
    }
}

fn op_stations(c: &Client, group: &str) -> Result<(String, Value), Failure> {
    let v = c.get(&format!("/stations?group={group}"))?;
    let lines: Vec<String> = if group == "genres" {
        arr(&v, "genres").iter().map(|g| format!("genre:{}  {}", s(g, "id"), s(g, "name"))).collect()
    } else {
        arr(&v, "stations").iter().map(|st| station_line(st)).collect()
    };
    Ok((numbered(lines), v))
}

fn op_playlists(c: &Client) -> Result<(String, Value), Failure> {
    let v = c.get("/playlists")?;
    Ok((numbered(arr(&v, "playlists").iter().map(|p| playlist_line(p)).collect()), v))
}

fn is_id(t: &str) -> bool {
    ["song:", "album:", "playlist:", "station:"].iter().any(|p| t.starts_with(p))
}

fn op_play(c: &Client, target: &str) -> Result<(String, Value), Failure> {
    let body = if is_id(target) { json!({ "id": target }) } else { json!({ "term": target }) };
    let v = c.post("/play", body)?;
    let line = if let Some(st) = v.get("station") {
        format!("Playing station: {}", s(st, "name"))
    } else {
        let tracks = arr(&v, "tracks");
        match tracks.len() {
            0 => "Playing".into(),
            1 => format!("Playing: {}", track_line(tracks[0])),
            n => format!("Playing {n} songs, starting with: {}", track_line(tracks[0])),
        }
    };
    Ok((line, v))
}

fn op_queue_add(c: &Client, id: &str, later: bool) -> Result<(String, Value), Failure> {
    let v = c.post("/queue", json!({ "id": id, "mode": if later { "later" } else { "next" } }))?;
    let tracks = arr(&v, "tracks");
    let what = match tracks.len() {
        0 => "nothing".into(),
        1 => track_line(tracks[0]),
        n => format!("{n} songs, starting with {}", track_line(tracks[0])),
    };
    Ok((format!("Queued {}: {what}", if later { "later" } else { "next" }), v))
}

fn op_queue_list(c: &Client) -> Result<(String, Value), Failure> {
    let v = c.get("/queue")?;
    let mut out = String::new();
    match v.get("current").filter(|x| !x.is_null()) {
        Some(cur) => out.push_str(&format!("Now: {}\n", track_line(cur))),
        None => out.push_str("Now: (nothing)\n"),
    }
    let up: Vec<String> = arr(&v, "upcoming").iter().map(|t| track_line(t)).collect();
    out.push_str(if up.is_empty() { "Up next: (empty)" } else { "Up next:\n" });
    if !up.is_empty() {
        out.push_str(&numbered(up));
    }
    Ok((out, v))
}

fn op_history(c: &Client, limit: usize) -> Result<(String, Value), Failure> {
    let v = c.get(&format!("/history?limit={limit}"))?;
    Ok((numbered(arr(&v, "plays").iter().map(|t| track_line(t)).collect()), v))
}

fn op_control(c: &Client, action: &str, value: Option<f64>) -> Result<(String, Value), Failure> {
    let v = c.post("/command", json!({ "kind": action, "value": value }))?;
    Ok((np_line(&v), v))
}

fn op_np(c: &Client) -> Result<(String, Value), Failure> {
    let v = c.get("/now-playing")?;
    Ok((np_line(&v), v))
}

fn op_add(c: &Client) -> Result<(String, Value), Failure> {
    let q = c.get("/queue")?;
    let Some(cur) = q.get("current").filter(|x| !x.is_null() && x.get("title").is_some()) else {
        return Err(Failure { status: 400, message: "nothing is playing".into() });
    };
    let v = c.post("/add", json!({ "track": cur }))?;
    Ok((format!("Added to library: {}", track_line(cur)), v))
}

// ── seek / volume parsing ─────────────────────────────────────────────────────

fn parse_seek(c: &Client, pos: &str) -> Result<f64, Failure> {
    let bad = || Failure { status: 3, message: format!("can't read position {pos:?} — use 1:23, 83, or 45%") };
    if let Some(p) = pos.strip_suffix('%') {
        return p.trim().parse::<f64>().map(|x| (x / 100.0).clamp(0.0, 1.0)).map_err(|_| bad());
    }
    let secs = if let Some((m, s)) = pos.split_once(':') {
        m.trim().parse::<f64>().map_err(|_| bad())? * 60.0 + s.trim().parse::<f64>().map_err(|_| bad())?
    } else {
        pos.trim().parse::<f64>().map_err(|_| bad())?
    };
    let np = c.get("/now-playing")?;
    let dur = np.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
    if dur <= 0.0 {
        return Err(Failure { status: 400, message: "nothing seekable is playing".into() });
    }
    Ok((secs / dur).clamp(0.0, 1.0))
}

fn parse_vol(c: &Client, level: &str) -> Result<f64, Failure> {
    let bad = || Failure { status: 3, message: format!("can't read volume {level:?} — use 40, +5, or -5") };
    let l = level.trim();
    if l.starts_with('+') || l.starts_with('-') {
        let delta = l.parse::<f64>().map_err(|_| bad())?;
        let cur = c.get("/now-playing")?.get("volume").and_then(Value::as_f64).unwrap_or(0.0) * 100.0;
        return Ok(((cur + delta) / 100.0).clamp(0.0, 1.0));
    }
    l.trim_end_matches('%').parse::<f64>().map(|x| (x / 100.0).clamp(0.0, 1.0)).map_err(|_| bad())
}

// ── MCP server (stdio, JSON-RPC, newline-delimited) ──────────────────────────
//
// Hand-rolled on purpose: the protocol subset a tool server needs is tiny
// (initialize · tools/list · tools/call · ping) and this keeps the binary dependency-
// free beyond an HTTP client. Seven tools, flat string/enum arguments, ids everywhere.

fn tools() -> Value {
    json!([
        { "name": "now_playing", "description": "What DeetsMusic is playing right now (title, artist, album, position, volume).",
          "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } },
        { "name": "search", "description": "Search Apple Music. Returns up to 5 numbered hits, each starting with an id like song:123 — pass that id to play or queue. Try a different query if nothing fits.",
          "inputSchema": { "type": "object", "required": ["query", "kind"], "additionalProperties": false, "properties": {
              "query": { "type": "string", "description": "Song title, artist, album, playlist, or station name." },
              "kind": { "type": "string", "enum": ["song", "album", "artist", "playlist", "station"] } } } },
        { "name": "stations", "description": "Browse radio stations: 'featured' (live stations, My Station, Discovery), 'genres' (list of genre ids), or 'genre:<id>' for one genre's stations.",
          "inputSchema": { "type": "object", "required": ["group"], "additionalProperties": false, "properties": {
              "group": { "type": "string", "description": "featured | genres | genre:<id>" } } } },
        { "name": "play", "description": "Play something NOW by id from search or stations: song:…, album:…, playlist:…, or station:…. Not a name — search first.",
          "inputSchema": { "type": "object", "required": ["id"], "additionalProperties": false, "properties": {
              "id": { "type": "string", "description": "A prefixed id, e.g. song:1440857781" } } } },
        { "name": "queue", "description": "Add a song, album, or playlist to the queue by id (position 'next' plays right after the current song, 'later' goes to the end). Stations can't be queued.",
          "inputSchema": { "type": "object", "required": ["id", "position"], "additionalProperties": false, "properties": {
              "id": { "type": "string", "description": "song:… album:… or playlist:…" },
              "position": { "type": "string", "enum": ["next", "later"] } } } },
        { "name": "control", "description": "Transport control. 'seek' and 'volume' take value 0-100 (percent); the others take no value.",
          "inputSchema": { "type": "object", "required": ["action"], "additionalProperties": false, "properties": {
              "action": { "type": "string", "enum": ["play", "pause", "next", "previous", "shuffle", "mute", "seek", "volume", "clear_queue"] },
              "value": { "type": "number", "description": "Percent, for seek and volume only." } } } },
        { "name": "list", "description": "List the queue (now playing + up next), your play history, or your playlists.",
          "inputSchema": { "type": "object", "required": ["what"], "additionalProperties": false, "properties": {
              "what": { "type": "string", "enum": ["queue", "history", "playlists"] } } } }
    ])
}

fn call_tool(c: &Client, name: &str, a: &Value) -> Result<String, Failure> {
    let str_arg = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let text = match name {
        "now_playing" => op_np(c)?.0,
        "search" => {
            let kind = match str_arg("kind").as_str() {
                "album" => Kind::Album,
                "artist" => Kind::Artist,
                "playlist" => Kind::Playlist,
                "station" => Kind::Station,
                _ => Kind::Song,
            };
            op_search(c, &str_arg("query"), kind, 5)?.0
        }
        "stations" => {
            let g = str_arg("group");
            op_stations(c, if g.is_empty() { "featured" } else { &g })?.0
        }
        "play" => {
            let id = str_arg("id");
            if !is_id(&id) {
                return Err(Failure { status: 400, message: format!("{id:?} is not an id — call search first and pass an id like song:123") });
            }
            op_play(c, &id)?.0
        }
        "queue" => {
            let id = str_arg("id");
            if !is_id(&id) {
                return Err(Failure { status: 400, message: format!("{id:?} is not an id — call search first and pass an id like song:123") });
            }
            op_queue_add(c, &id, str_arg("position") == "later")?.0
        }
        "control" => {
            let action = str_arg("action");
            let pct = a.get("value").and_then(Value::as_f64);
            let (kind, value) = match action.as_str() {
                "seek" | "volume" => (action.as_str(), Some((pct.unwrap_or(0.0) / 100.0).clamp(0.0, 1.0))),
                "clear_queue" => ("clear", None),
                other => (other, None),
            };
            op_control(c, kind, value)?.0
        }
        "list" => match str_arg("what").as_str() {
            "history" => op_history(c, 20)?.0,
            "playlists" => op_playlists(c)?.0,
            _ => op_queue_list(c)?.0,
        },
        other => return Err(Failure { status: 400, message: format!("unknown tool {other:?}") }),
    };
    Ok(text)
}

fn serve_mcp(port: Option<u16>, token: Option<String>) {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut client: Option<Client> = None;
    let reply = |out: &mut std::io::Stdout, id: Value, body: Value| {
        let msg = json!({ "jsonrpc": "2.0", "id": id, "result": body });
        let _ = writeln!(out, "{msg}");
        let _ = out.flush();
    };
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = s(&req, "method").to_string();
        let params = req.get("params").cloned().unwrap_or(json!({}));
        match method.as_str() {
            "initialize" => reply(
                &mut out,
                id,
                json!({
                    "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "deetsmusic", "version": VERSION },
                    "instructions": "Control DeetsMusic. Always search (or list stations) first, then play or queue by the returned id (song:… album:… playlist:… station:…)."
                }),
            ),
            "ping" => reply(&mut out, id, json!({})),
            "tools/list" => reply(&mut out, id, json!({ "tools": tools() })),
            "tools/call" => {
                let name = s(&params, "name").to_string();
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let result = match &client {
                    Some(c) => call_tool(c, &name, &args),
                    None => match connect(port, token.clone()) {
                        Ok(c) => {
                            let r = call_tool(&c, &name, &args);
                            client = Some(c);
                            r
                        }
                        Err(e) => Err(e),
                    },
                };
                // A dropped connection (app restarted on another port) re-probes next call.
                if matches!(&result, Err(f) if f.status == 0 || f.status == 1) {
                    client = None;
                }
                let (text, is_error) = match result {
                    Ok(t) => (t, false),
                    Err(f) => (format!("Error: {}", f.message), true),
                };
                reply(&mut out, id, json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }));
            }
            _ if id.is_null() => {} // notifications (initialized, cancelled) need no reply
            other => {
                let msg = json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("method not found: {other}") } });
                let _ = writeln!(out, "{msg}");
                let _ = out.flush();
            }
        }
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();
    if let Cmd::Mcp = cli.cmd {
        serve_mcp(cli.port, cli.token);
        return;
    }
    let c = match connect(cli.port, cli.token) {
        Ok(c) => c,
        Err(f) => {
            eprintln!("{}", f.message);
            std::process::exit(f.exit_code());
        }
    };
    let res: Result<(String, Value), Failure> = match cli.cmd {
        Cmd::Np => op_np(&c),
        Cmd::Status => c.get("/health").map(|v| {
            (
                format!(
                    "DeetsMusic {} on {}  ·  Apple Music {}",
                    s(&v, "version"),
                    c.base.trim_start_matches("http://"),
                    if v.get("connected").and_then(Value::as_bool).unwrap_or(false) { "connected" } else { "NOT connected" }
                ),
                v,
            )
        }),
        Cmd::Search(a) => {
            let kind = if a.albums { Kind::Album } else if a.artists { Kind::Artist } else if a.playlists { Kind::Playlist } else if a.stations { Kind::Station } else { Kind::Song };
            op_search(&c, &a.query, kind, a.limit)
        }
        Cmd::Stations { genres, genre } => {
            let g = if genres { "genres".to_string() } else if let Some(id) = genre { format!("genre:{}", id.trim_start_matches("genre:")) } else { "featured".into() };
            op_stations(&c, &g)
        }
        Cmd::Playlists => op_playlists(&c),
        Cmd::Play { target } => op_play(&c, &target),
        Cmd::Queue { target: None, .. } => op_queue_list(&c),
        Cmd::Queue { target: Some(t), .. } if t == "clear" => op_control(&c, "clear", None).map(|(_, v)| ("Queue cleared".into(), v)),
        Cmd::Queue { target: Some(t), later } => {
            if !is_id(&t) {
                Err(Failure { status: 3, message: format!("{t:?} is not an id — `deetsmusic search \"{t}\"` first, then queue the song:… id") })
            } else {
                op_queue_add(&c, &t, later)
            }
        }
        Cmd::Pause => op_control(&c, "pause", None),
        Cmd::Resume => op_control(&c, "play", None),
        Cmd::Toggle => op_control(&c, "play-pause", None),
        Cmd::Next => op_control(&c, "next", None),
        Cmd::Prev => op_control(&c, "previous", None),
        Cmd::Shuffle => op_control(&c, "shuffle", None),
        Cmd::Mute => op_control(&c, "mute", None),
        Cmd::Seek { position } => parse_seek(&c, &position).and_then(|f| op_control(&c, "seek", Some(f))),
        Cmd::Vol { level } => parse_vol(&c, &level).and_then(|f| op_control(&c, "volume", Some(f))),
        Cmd::History { limit } => op_history(&c, limit),
        Cmd::Add => op_add(&c),
        Cmd::Mcp => unreachable!(),
    };
    match res {
        Ok((text, v)) => {
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            } else {
                println!("{text}");
            }
        }
        Err(f) => {
            if cli.json {
                println!("{}", json!({ "error": f.message, "status": f.status }));
            } else {
                eprintln!("{}", f.message);
            }
            std::process::exit(f.exit_code());
        }
    }
}

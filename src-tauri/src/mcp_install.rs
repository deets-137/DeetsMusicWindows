//! Settings › Connections › Set up the DeetsMusic MCP (docs/integrations/MCP-INSTALL.md).
//!
//! The work is in `crates/mcp-install`, which the CLI shares (fork 1A). This module picks our
//! entry for this build, opens the `.mcpb` for Claude Desktop (fork 7A), and keeps *last used*:
//! which AI app last called the bridge through the MCP CLI, and when (fork 8B). Every command
//! reads or writes another app's files, so each one runs on a blocking thread (CLAUDE.md ›
//! Conventions). An agent reaches none of it (§7.8).

use mcp_install::{ClientId, Outcome, Server, State};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ── last used (fork 8B): in memory only, so it starts empty at each launch ──

static SEEN: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

/// The bridge calls this for each paired request that names its AI app (`X-Deets-Client`).
pub fn note_agent(name: &str) {
    let name: String = name.chars().take(64).collect();
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let map = seen.get_or_insert_with(HashMap::new);
    if !map.contains_key(&name) {
        crate::log::info(&format!("mcp-install: first call this run from {name}"));
    }
    map.insert(name, Instant::now());
}

fn seen() -> Vec<(String, Duration)> {
    let seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    seen.as_ref().map(|m| m.iter().map(|(k, t)| (k.clone(), t.elapsed())).collect()).unwrap_or_default()
}

// ── our entry for this build ──

/// The installed app's entry is `deetsmusic` (`deetsmusic-beta` for the beta), at the CLI it
/// ships. A dev build is `deetsmusic-dev` at the debug CLI, which reads only the dev token, so
/// it reaches this dev app and never replaces the installed app's entry (fork 4A).
fn server(app: &tauri::AppHandle) -> Server {
    if cfg!(debug_assertions) {
        let exe = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(r"..\cli\target\debug\deetsmusic.exe");
        let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
        let exe = std::path::PathBuf::from(exe.to_string_lossy().trim_start_matches(r"\\?\"));
        return Server { name: "deetsmusic-dev".into(), exe };
    }
    Server { name: crate::settings::cli_name().into(), exe: crate::settings::cli_path(app).into() }
}

/// `<resources>\mcpb\deetsmusic.mcpb`: only the installed full app has it; its shim starts the
/// full app's CLI (fork 7A).
fn bundle(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    if cfg!(debug_assertions) || crate::beta::is_beta() {
        return None;
    }
    let p = app.path().resource_dir().ok()?.join("mcpb").join("deetsmusic.mcpb");
    p.is_file().then_some(p)
}

// ── the commands ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    client: &'static str,
    label: &'static str,
    /// not-connected · connected · stale · manual · unreadable · extension
    state: &'static str,
    /// The command a stale or hand-made entry starts, or why the file could not be read.
    detail: Option<String>,
    /// Seconds since this app last called DeetsMusic through the MCP, this run.
    last_used: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    entry: String,
    rows: Vec<Row>,
    /// Claude Desktop can be connected from this build (the installed full app only).
    bundle: bool,
    /// MCP clients that called but are none of the three lines: (name, seconds ago).
    others: Vec<(String, u64)>,
}

#[tauri::command]
pub async fn mcp_detect(app: tauri::AppHandle) -> Panel {
    let s = server(&app);
    let has_bundle = bundle(&app).is_some();
    tauri::async_runtime::spawn_blocking(move || {
        let seen = seen();
        let last = |id: ClientId| seen.iter().filter(|(n, _)| mcp_install::client_for_agent(n) == Some(id)).map(|(_, d)| d.as_secs()).min();
        let rows = mcp_install::detect(&s)
            .into_iter()
            .map(|f| {
                let detail = match &f.state {
                    State::Stale { command } | State::Manual { command } => Some(command.clone()),
                    State::Unreadable(e) => Some(e.clone()),
                    _ => None,
                };
                Row { client: f.id.key(), label: f.id.label(), state: f.state.key(), detail, last_used: last(f.id) }
            })
            .collect();
        let others = seen.iter().filter(|(n, _)| mcp_install::client_for_agent(n).is_none()).map(|(n, d)| (n.clone(), d.as_secs())).collect();
        Panel { entry: s.name, rows, bundle: has_bundle, others }
    })
    .await
    .unwrap_or_else(|_| Panel { entry: String::new(), rows: vec![], bundle: false, others: vec![] })
}

#[derive(Serialize)]
pub struct Reply {
    /// done · open · ask · failed
    kind: &'static str,
    note: String,
}

fn reply(o: Outcome) -> Reply {
    match o {
        Outcome::Done(n) => Reply { kind: "done", note: n },
        Outcome::OpenBundle(n) => Reply { kind: "open", note: n },
        Outcome::AskReplace(n) => Reply { kind: "ask", note: n },
        Outcome::Failed(n) => Reply { kind: "failed", note: n },
    }
}

#[tauri::command]
pub async fn mcp_connect(client: String, replace: bool, app: tauri::AppHandle) -> Reply {
    let Some(id) = ClientId::from_key(&client) else { return Reply { kind: "failed", note: format!("unknown app: {client}") } };
    let s = server(&app);
    let out = tauri::async_runtime::spawn_blocking(move || mcp_install::connect(id, &s, replace))
        .await
        .unwrap_or_else(|e| Outcome::Failed(e.to_string()));
    let out = match out {
        Outcome::OpenBundle(note) => match bundle(&app) {
            Some(p) => {
                use tauri_plugin_opener::OpenerExt;
                match app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>) {
                    Ok(()) => Outcome::OpenBundle(note),
                    Err(e) => Outcome::Failed(format!("Could not open the DeetsMusic extension: {e}")),
                }
            }
            None => Outcome::Failed("This build has no Claude Desktop extension. Use Copy setup info below.".into()),
        },
        o => o,
    };
    let r = reply(out);
    crate::log::info(&format!("mcp-install: connect {client} → {}", r.kind));
    r
}

#[tauri::command]
pub async fn mcp_disconnect(client: String, app: tauri::AppHandle) -> Reply {
    let Some(id) = ClientId::from_key(&client) else { return Reply { kind: "failed", note: format!("unknown app: {client}") } };
    let s = server(&app);
    let out = tauri::async_runtime::spawn_blocking(move || mcp_install::disconnect(id, &s))
        .await
        .unwrap_or_else(|e| Outcome::Failed(e.to_string()));
    let r = reply(out);
    crate::log::info(&format!("mcp-install: disconnect {client} → {}", r.kind));
    r
}

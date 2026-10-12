//! Connect DeetsMusic's MCP server to the AI apps on this PC (docs/integrations/MCP-INSTALL.md).
//!
//! v1 has three lines (fork 9A): Claude Desktop, Claude Code, and Codex (the ChatGPT desktop
//! app reads the same `config.toml`, so one entry reaches both). Claude Desktop connects
//! through the `.mcpb` bundle (fork 7A): Claude shows its own install screen, so this crate
//! only says "open the bundle". Claude Code and Codex connect with their own command when it
//! is on PATH, else by a careful write of their file (fork 2A, §6).
//!
//! The CLI and the app both call this crate (fork 1A). The caller passes the server's name
//! and the exe, and does what an [`Outcome`] asks (open the bundle, show the note).

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientId {
    ClaudeDesktop,
    ClaudeCode,
    Codex,
}

impl ClientId {
    pub const ALL: [ClientId; 3] = [ClientId::ClaudeDesktop, ClientId::ClaudeCode, ClientId::Codex];

    pub fn key(self) -> &'static str {
        match self {
            ClientId::ClaudeDesktop => "claude-desktop",
            ClientId::ClaudeCode => "claude-code",
            ClientId::Codex => "codex",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ClientId::ClaudeDesktop => "Claude Desktop",
            ClientId::ClaudeCode => "Claude Code",
            ClientId::Codex => "Codex and ChatGPT",
        }
    }

    pub fn from_key(k: &str) -> Option<ClientId> {
        Self::ALL.into_iter().find(|c| c.key() == k)
    }

    /// The program's own command, for fork 2A's first rung.
    fn owner_cli(self) -> Option<&'static str> {
        match self {
            ClientId::ClaudeDesktop => None,
            ClientId::ClaudeCode => Some("claude"),
            ClientId::Codex => Some("codex"),
        }
    }
}

/// Our entry: `deetsmusic` (or `deetsmusic-beta`, `deetsmusic-dev`), the exe, `mcp`.
#[derive(Clone, Debug)]
pub struct Server {
    pub name: String,
    pub exe: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
    NotConnected,
    /// Our name, our exe.
    Connected,
    /// Our name, but the exe is gone or is another copy of DeetsMusic's: Connect repairs it.
    Stale { command: String },
    /// Our name, pointing at a program that is not DeetsMusic's: Connect asks first.
    Manual { command: String },
    /// The file would not parse, or could not be read. We never write it.
    Unreadable(String),
    /// Claude Desktop with no entry in its file: an extension may hold it, and we cannot read
    /// Claude's extension list. *Last used* (fork 8B) is the proof.
    Extension,
}

impl State {
    pub fn key(&self) -> &'static str {
        match self {
            State::NotConnected => "not-connected",
            State::Connected => "connected",
            State::Stale { .. } => "stale",
            State::Manual { .. } => "manual",
            State::Unreadable(_) => "unreadable",
            State::Extension => "extension",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Found {
    pub id: ClientId,
    pub config: Option<PathBuf>,
    pub state: State,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Finished; the note is one plain sentence for the user (what to do next, if anything).
    Done(String),
    /// Claude Desktop: the caller opens `deetsmusic.mcpb`, and Claude shows its install screen.
    OpenBundle(String),
    /// Our name already points at another program; connect again with `replace` to change it.
    AskReplace(String),
    Failed(String),
}

// ── paths ─────────────────────────────────────────────────────────────────────

const CLAUDE_PACKAGE: &str = "Claude_pzs8sxrjxfjjc";

fn env_path(k: &str) -> Option<PathBuf> {
    std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn home() -> Option<PathBuf> {
    env_path("USERPROFILE").or_else(|| env_path("HOME"))
}

/// The Store (MSIX) Claude Desktop reads a private copy of `%APPDATA%`, so its real file is
/// under `Packages\…\LocalCache` (§4.1). The classic installer reads `%APPDATA%\Claude`.
fn claude_desktop_config() -> Option<PathBuf> {
    let local = env_path("LOCALAPPDATA")?;
    let pkg = local.join("Packages").join(CLAUDE_PACKAGE);
    if pkg.is_dir() {
        return Some(pkg.join(r"LocalCache\Roaming\Claude\claude_desktop_config.json"));
    }
    Some(env_path("APPDATA")?.join(r"Claude\claude_desktop_config.json"))
}

fn claude_desktop_found() -> bool {
    let Some(local) = env_path("LOCALAPPDATA") else { return false };
    local.join("Packages").join(CLAUDE_PACKAGE).is_dir() || local.join("AnthropicClaude").is_dir()
}

fn codex_home() -> Option<PathBuf> {
    env_path("CODEX_HOME").or_else(|| Some(home()?.join(".codex")))
}

/// Codex keeps its folder even when only the ChatGPT desktop app or the Codex app is used.
/// The Store apps are a second sign: one `read_dir` of `Packages`, never a disk search.
fn codex_found() -> bool {
    if codex_home().is_some_and(|d| d.is_dir()) || which("codex").is_some() {
        return true;
    }
    let Some(local) = env_path("LOCALAPPDATA") else { return false };
    std::fs::read_dir(local.join("Packages"))
        .map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().starts_with("OpenAI.")))
        .unwrap_or(false)
}

fn config_path(id: ClientId) -> Option<PathBuf> {
    match id {
        ClientId::ClaudeDesktop => claude_desktop_config(),
        ClientId::ClaudeCode => Some(home()?.join(".claude.json")),
        ClientId::Codex => Some(codex_home()?.join("config.toml")),
    }
}

/// A command on PATH (`.exe`, then `.cmd`), or Claude Code's own install folder.
pub fn which(name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(h) = home() {
        dirs.push(h.join(r".local\bin"));
    }
    for d in dirs {
        for ext in ["exe", "cmd"] {
            let p = d.join(format!("{name}.{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

// ── detect ────────────────────────────────────────────────────────────────────

fn found(id: ClientId) -> bool {
    match id {
        ClientId::ClaudeDesktop => claude_desktop_found(),
        ClientId::ClaudeCode => which("claude").is_some() || home().is_some_and(|h| h.join(".claude.json").is_file()),
        ClientId::Codex => codex_found(),
    }
}

/// The apps found on this PC, in panel order, each with our entry's state. Every check is one
/// `exists`, one PATH lookup or one file read (§3). Never starts a program.
pub fn detect(s: &Server) -> Vec<Found> {
    ClientId::ALL.into_iter().filter(|&id| found(id)).map(|id| status(id, s)).collect()
}

pub fn status(id: ClientId, s: &Server) -> Found {
    let config = config_path(id);
    let state = match &config {
        None => State::Unreadable("no home folder".into()),
        Some(p) => match read(p) {
            Err(e) => State::Unreadable(e),
            Ok(None) => State::NotConnected,
            Ok(Some(text)) => match id {
                ClientId::Codex => toml_state(&text, s),
                _ => json_state(&text, "mcpServers", s),
            },
        },
    };
    // Claude Desktop with no entry in its file may still hold our extension.
    let state = if id == ClientId::ClaudeDesktop && state == State::NotConnected { State::Extension } else { state };
    Found { id, config, state }
}

fn read(p: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(p) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Is this command our exe? Case and slashes do not count on Windows.
fn same_path(a: &str, b: &Path) -> bool {
    let norm = |s: &str| s.trim_start_matches(r"\\?\").replace('/', "\\").to_lowercase();
    norm(a) == norm(&b.to_string_lossy())
}

fn judge(command: &str, s: &Server) -> State {
    if same_path(command, &s.exe) {
        return State::Connected;
    }
    let p = Path::new(command);
    let ours = p.file_name().is_some_and(|f| f.to_string_lossy().to_lowercase().starts_with("deetsmusic"));
    if !p.is_file() || ours {
        State::Stale { command: command.into() }
    } else {
        State::Manual { command: command.into() }
    }
}

// ── the pure edits (unit-tested; a text in, a text out) ──────────────────────

/// The state of `servers_key.<name>` in a JSON config.
pub fn json_state(text: &str, servers_key: &str, s: &Server) -> State {
    let v: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return State::Unreadable(e.to_string()),
    };
    match v.get(servers_key).and_then(|m| m.get(&s.name)) {
        None => State::NotConnected,
        Some(e) => judge(e.get("command").and_then(Value::as_str).unwrap_or(""), s),
    }
}

/// Set `servers_key.<name>` to `entry`; every other key keeps its place.
pub fn json_set(text: &str, servers_key: &str, name: &str, entry: Value) -> Result<String, String> {
    let mut v: Value = if text.trim().is_empty() { json!({}) } else { serde_json::from_str(text).map_err(|e| e.to_string())? };
    let root = v.as_object_mut().ok_or("the file is not a JSON object")?;
    let servers = root.entry(servers_key).or_insert_with(|| json!({}));
    let servers = servers.as_object_mut().ok_or_else(|| format!("`{servers_key}` is not an object"))?;
    servers.insert(name.into(), entry);
    Ok(pretty(&v))
}

/// Remove `servers_key.<name>`. `None` when there was nothing to remove.
pub fn json_remove(text: &str, servers_key: &str, name: &str) -> Result<Option<String>, String> {
    let mut v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let gone = v.get_mut(servers_key).and_then(Value::as_object_mut).and_then(|m| m.shift_remove(name)).is_some();
    Ok(gone.then(|| pretty(&v)))
}

fn pretty(v: &Value) -> String {
    let mut out = serde_json::to_string_pretty(v).unwrap_or_default();
    out.push('\n');
    out
}

/// The state of `[mcp_servers.<name>]` in Codex's `config.toml`.
pub fn toml_state(text: &str, s: &Server) -> State {
    let doc: toml_edit::DocumentMut = match text.parse() {
        Ok(d) => d,
        Err(e) => return State::Unreadable(e.to_string()),
    };
    match doc.get("mcp_servers").and_then(|t| t.get(&s.name)) {
        None => State::NotConnected,
        Some(e) => judge(e.get("command").and_then(|c| c.as_str()).unwrap_or(""), s),
    }
}

/// Set `[mcp_servers.<name>]`; comments and every other table are kept.
pub fn toml_set(text: &str, name: &str, exe: &str) -> Result<String, String> {
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
    if doc.get("mcp_servers").is_none() {
        let mut t = toml_edit::Table::new();
        t.set_implicit(true);
        doc.insert("mcp_servers", toml_edit::Item::Table(t));
    }
    // `get_mut`, not `doc[…]`: an index is a panic site, and its path would reach the exe (see `run`).
    let servers = doc.get_mut("mcp_servers").and_then(|t| t.as_table_mut()).ok_or("`mcp_servers` is not a table")?;
    let mut entry = toml_edit::Table::new();
    entry.insert("command", toml_edit::value(exe));
    let mut args = toml_edit::Array::new();
    args.push("mcp");
    entry.insert("args", toml_edit::value(args));
    servers.insert(name, toml_edit::Item::Table(entry));
    Ok(doc.to_string())
}

/// Remove `[mcp_servers.<name>]`. `None` when there was nothing to remove.
pub fn toml_remove(text: &str, name: &str) -> Result<Option<String>, String> {
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
    let gone = doc.get_mut("mcp_servers").and_then(|t| t.as_table_like_mut()).and_then(|t| t.remove(name)).is_some();
    Ok(gone.then(|| doc.to_string()))
}

// ── writing another app's file (§6) ──────────────────────────────────────────

/// Back up once (never over an older backup), then write a temp file and rename it over.
fn write_file(p: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if p.is_file() {
        let backup = PathBuf::from(format!("{}.deetsmusic-backup", p.display()));
        if !backup.exists() {
            std::fs::copy(p, &backup).map_err(|e| format!("backup: {e}"))?;
        }
    }
    let tmp = PathBuf::from(format!("{}.tmp", p.display()));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn edit(p: &Path, f: impl FnOnce(&str) -> Result<Option<String>, String>) -> Result<bool, String> {
    let text = read(p)?.unwrap_or_default();
    match f(&text)? {
        Some(out) => write_file(p, &out).map(|_| true),
        None => Ok(false),
    }
}

/// Run an app's own command with no console window; its stderr is the failure text.
/// `{ "type": "stdio", "command": exe, "args": ["mcp"], "env": {} }`, built by hand: `json!`
/// wraps a non-literal value in `.unwrap()`, a panic site in this crate (see `run`).
fn stdio_entry(exe: &str) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("type".into(), Value::from("stdio"));
    m.insert("command".into(), Value::from(exe));
    m.insert("args".into(), Value::Array(vec![Value::from("mcp")]));
    m.insert("env".into(), Value::Object(serde_json::Map::new()));
    Value::Object(m)
}

/// No indexing here: a panic site in this crate puts its absolute source path in the exe,
/// and the release check refuses that (RELEASE.md §1a; 0.26.0's first build, 2026-10-11).
pub fn run(argv: &[String]) -> Result<(), String> {
    let Some((prog, args)) = argv.split_first() else { return Err("no command to run".into()) };
    let mut cmd = std::process::Command::new(prog);
    cmd.args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("{prog}: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let msg = err.lines().chain(String::from_utf8_lossy(&out.stdout).lines().collect::<Vec<_>>()).find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
    Err(if msg.is_empty() { format!("{prog} exited with {}", out.status) } else { msg })
}

fn owner_add(id: ClientId, cli: &Path, s: &Server) -> Vec<String> {
    let exe = s.exe.to_string_lossy().into_owned();
    let c = cli.to_string_lossy().into_owned();
    match id {
        ClientId::ClaudeCode => vec![c, "mcp".into(), "add".into(), "-s".into(), "user".into(), s.name.clone(), "--".into(), exe, "mcp".into()],
        _ => vec![c, "mcp".into(), "add".into(), s.name.clone(), "--".into(), exe, "mcp".into()],
    }
}

fn owner_remove(id: ClientId, cli: &Path, s: &Server) -> Vec<String> {
    let c = cli.to_string_lossy().into_owned();
    match id {
        ClientId::ClaudeCode => vec![c, "mcp".into(), "remove".into(), "-s".into(), "user".into(), s.name.clone()],
        _ => vec![c, "mcp".into(), "remove".into(), s.name.clone()],
    }
}

fn next_step(id: ClientId) -> &'static str {
    match id {
        ClientId::ClaudeDesktop => "Restart Claude Desktop to finish.",
        ClientId::ClaudeCode => "Start a new Claude Code session to use it.",
        ClientId::Codex => "Start a new chat in Codex or ChatGPT to use it.",
    }
}

/// Connect one app. `replace` changes an entry of ours that points at another program (§6.7).
pub fn connect(id: ClientId, s: &Server, replace: bool) -> Outcome {
    let f = status(id, s);
    let Some(path) = f.config.clone() else { return Outcome::Failed("This PC has no home folder.".into()) };
    match &f.state {
        State::Connected => return Outcome::Done(format!("{} is already connected.", id.label())),
        State::Unreadable(e) => return Outcome::Failed(format!("DeetsMusic could not read {}: {e}", path.display())),
        State::Manual { command } if !replace => {
            return Outcome::AskReplace(format!("{}'s \"{}\" entry starts {command}. Replace it with DeetsMusic?", id.label(), s.name))
        }
        _ => {}
    }
    if id == ClientId::ClaudeDesktop {
        // A broken entry of ours in the file (an old hand setup) goes first, so Claude does not
        // show a failed server beside the extension.
        if matches!(f.state, State::Stale { .. }) {
            if let Err(e) = edit(&path, |t| json_remove(t, "mcpServers", &s.name)) {
                return Outcome::Failed(e);
            }
        }
        return Outcome::OpenBundle("Claude Desktop shows its install screen. Press Install there.".into());
    }
    let had = !matches!(f.state, State::NotConnected);
    let result = match id.owner_cli().and_then(which) {
        Some(cli) => {
            let removed = if had { run(&owner_remove(id, &cli, s)) } else { Ok(()) };
            removed.and_then(|_| run(&owner_add(id, &cli, s)))
        }
        None => {
            let exe = s.exe.to_string_lossy().into_owned();
            edit(&path, |t| match id {
                ClientId::Codex => toml_set(t, &s.name, &exe).map(Some),
                _ => json_set(t, "mcpServers", &s.name, stdio_entry(&exe)).map(Some),
            })
            .map(|_| ())
        }
    };
    if let Err(e) = result {
        return Outcome::Failed(e);
    }
    match status(id, s).state {
        State::Connected => Outcome::Done(format!("{} connected. {}", id.label(), next_step(id))),
        other => Outcome::Failed(format!("{} did not take the entry ({}).", id.label(), other.key())),
    }
}

/// Disconnect one app. Only an entry of ours is removed; a hand-made one is left alone.
pub fn disconnect(id: ClientId, s: &Server) -> Outcome {
    let f = status(id, s);
    let Some(path) = f.config.clone() else { return Outcome::Failed("This PC has no home folder.".into()) };
    let extension = "To remove the DeetsMusic extension, open Claude Desktop › Settings › Extensions.";
    match &f.state {
        State::Extension => return Outcome::Done(extension.into()),
        State::NotConnected => return Outcome::Done(format!("{} has no DeetsMusic entry.", id.label())),
        State::Manual { .. } => return Outcome::Done(format!("{}'s entry is not DeetsMusic's; DeetsMusic left it alone.", id.label())),
        State::Unreadable(e) => return Outcome::Failed(format!("DeetsMusic could not read {}: {e}", path.display())),
        State::Connected | State::Stale { .. } => {}
    }
    let result = match id.owner_cli().and_then(which) {
        Some(cli) => run(&owner_remove(id, &cli, s)),
        None => edit(&path, |t| match id {
            ClientId::Codex => toml_remove(t, &s.name),
            _ => json_remove(t, "mcpServers", &s.name),
        })
        .map(|_| ()),
    };
    match result {
        Err(e) => Outcome::Failed(e),
        Ok(()) if id == ClientId::ClaudeDesktop => Outcome::Done(format!("Removed from Claude Desktop's file. Restart Claude Desktop. {extension}")),
        Ok(()) => Outcome::Done(format!("{} disconnected.", id.label())),
    }
}

// ── the copied text, for the apps v1 does not connect (§1: Copy setup info) ──

/// `client`: `claude-desktop`, `claude-code`, `cursor`, `other-full` or `other-small`.
pub fn setup_text(client: &str, s: &Server) -> String {
    let path = s.exe.to_string_lossy();
    let small = client == "other-small";
    let json = format!(
        "{{\n  \"mcpServers\": {{\n    \"{}\": {{\n      \"command\": \"{}\",\n      \"args\": [{}]\n    }}\n  }}\n}}",
        s.name,
        path.replace('\\', "\\\\"),
        if small { "\"mcp\", \"--small\"" } else { "\"mcp\"" }
    );
    match client {
        // `-s user`: with no scope, Claude Code adds the server to the current folder only (§8a).
        "claude-code" => format!("claude mcp add -s user {} -- \"{path}\" mcp", s.name),
        "claude-desktop" | "cursor" => json,
        _ if small => format!("Command: {path}\nArguments: mcp --small\n\nAs JSON for an MCP config file:\n{json}"),
        _ => format!("Command: {path}\nArgument: mcp\n\nAs JSON for an MCP config file:\n{json}"),
    }
}

/// Which line of the panel an MCP client's `clientInfo.name` belongs to (fork 8B).
pub fn client_for_agent(name: &str) -> Option<ClientId> {
    let n = name.to_lowercase();
    if n.contains("claude-code") || n.contains("claude code") {
        Some(ClientId::ClaudeCode)
    } else if n.contains("claude") {
        Some(ClientId::ClaudeDesktop)
    } else if n.contains("codex") || n.contains("chatgpt") || n.contains("openai") {
        Some(ClientId::Codex)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> Server {
        Server { name: "deetsmusic".into(), exe: PathBuf::from(r"C:\Users\x\AppData\Local\DeetsMusic\cli\deetsmusic.exe") }
    }

    #[test]
    fn json_set_keeps_other_keys_and_their_order() {
        let text = r#"{"zeta":1,"mcpServers":{"other":{"command":"x","env":{"KEY":"secret"}}},"alpha":2}"#;
        let out = json_set(text, "mcpServers", "deetsmusic", json!({"command": "c", "args": ["mcp"]})).unwrap();
        let z = out.find("zeta").unwrap();
        let m = out.find("mcpServers").unwrap();
        let a = out.find("alpha").unwrap();
        assert!(z < m && m < a, "order kept: {out}");
        assert!(out.contains("secret"), "other servers kept");
        assert!(out.contains("deetsmusic"));
    }

    #[test]
    fn json_set_makes_a_missing_file() {
        let out = json_set("", "mcpServers", "deetsmusic", json!({"command": "c"})).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&out).unwrap()["mcpServers"]["deetsmusic"]["command"], "c");
    }

    #[test]
    fn json_refuses_a_broken_file() {
        assert!(json_set("{ not json", "mcpServers", "d", json!({})).is_err());
        assert!(matches!(json_state("{ not json", "mcpServers", &server()), State::Unreadable(_)));
    }

    #[test]
    fn json_remove_only_ours() {
        let text = r#"{"mcpServers":{"deetsmusic":{"command":"c"},"other":{"command":"x"}}}"#;
        let out = json_remove(text, "mcpServers", "deetsmusic").unwrap().unwrap();
        assert!(!out.contains("deetsmusic") && out.contains("other"));
        assert_eq!(json_remove(&out, "mcpServers", "deetsmusic").unwrap(), None);
    }

    #[test]
    fn json_state_reads_the_entry() {
        let s = server();
        let ours = format!(r#"{{"mcpServers":{{"deetsmusic":{{"command":"{}"}}}}}}"#, s.exe.display().to_string().replace('\\', "/").to_uppercase());
        assert_eq!(json_state(&ours, "mcpServers", &s), State::Connected, "case and slashes do not count");
        assert_eq!(json_state(r#"{"mcpServers":{}}"#, "mcpServers", &s), State::NotConnected);
        assert!(matches!(json_state(r#"{"mcpServers":{"deetsmusic":{"command":"C:\\gone\\deetsmusic.exe"}}}"#, "mcpServers", &s), State::Stale { .. }));
    }

    #[test]
    fn toml_set_keeps_comments_and_tables() {
        let text = "# my config\nmodel = \"x\"\n\n[mcp_servers.other]\ncommand = 'y' # keep me\n";
        let out = toml_set(text, "deetsmusic", r"C:\a b\deetsmusic.exe").unwrap();
        assert!(out.contains("# my config") && out.contains("# keep me"));
        let doc: toml_edit::DocumentMut = out.parse().unwrap();
        assert_eq!(doc["mcp_servers"]["deetsmusic"]["command"].as_str(), Some(r"C:\a b\deetsmusic.exe"));
        assert_eq!(doc["mcp_servers"]["deetsmusic"]["args"].as_array().unwrap().get(0).and_then(|v| v.as_str()), Some("mcp"));
        assert_eq!(doc["mcp_servers"]["other"]["command"].as_str(), Some("y"));
    }

    #[test]
    fn toml_set_on_an_empty_file() {
        let out = toml_set("", "deetsmusic", "c").unwrap();
        assert!(out.contains("[mcp_servers.deetsmusic]"), "{out}");
    }

    #[test]
    fn toml_remove_and_state() {
        let s = server();
        let text = toml_set("", "deetsmusic", &s.exe.to_string_lossy()).unwrap();
        assert_eq!(toml_state(&text, &s), State::Connected);
        let out = toml_remove(&text, "deetsmusic").unwrap().unwrap();
        assert_eq!(toml_state(&out, &s), State::NotConnected);
        assert_eq!(toml_remove(&out, "deetsmusic").unwrap(), None);
    }

    #[test]
    fn claude_code_text_is_user_scope() {
        assert!(setup_text("claude-code", &server()).starts_with("claude mcp add -s user deetsmusic -- "));
    }

    #[test]
    fn agent_names_map_to_lines() {
        assert_eq!(client_for_agent("claude-code"), Some(ClientId::ClaudeCode));
        assert_eq!(client_for_agent("claude-ai"), Some(ClientId::ClaudeDesktop));
        assert_eq!(client_for_agent("codex-mcp-client"), Some(ClientId::Codex));
        assert_eq!(client_for_agent("cursor-vscode"), None);
    }
}

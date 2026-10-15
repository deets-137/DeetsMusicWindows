---
status: shipped
shipped_in: 0.26.0
desk_test: passed 2026-10-13
sources: [crates/mcp-install/src/lib.rs, src-tauri/src/mcp_install.rs, src/mcp-panel.ts, cli/src/main.rs, mcpb/server/index.js, mcpb/manifest.json, scripts/mcpb-pack.mjs, src-tauri/src/velo.rs]
updated: 2026-10-14
---
# DeetsMusic — connect AI apps (`mcp_install`)

> **Designed 2026-09-16. All forks decided 2026-10-11 (§8a–§8c). BUILT 2026-10-11, shipped in 0.26.0; §8d is the as-built record, §9 the desk test (passed 2026-10-13, his).** The user asked for a Rust module that
> does the MCP setup for the user, a `deetsmusic mcp install` command that lets the user pick
> the AI app, and detection of the popular apps. A note from a Claude chat added a Settings screen
> that calls the same module, restart help, status and removal, a fallback for apps we do not detect,
> and install links where a client has them. This doc checks each part against the code and against
> this PC (probe, 2026-09-16).

**Terms used here.**
- **Client**: an AI app that starts MCP servers: Claude Desktop, Claude Code, Cursor, VS Code, and so on.
- **Entry**: the part of a client's config that starts our server. Its name is `deetsmusic`, its
  command is the path to `deetsmusic.exe`, and its argument is `mcp` (or `mcp --small`). AGENT.md §4.
- **Connect**: put a correct entry into a client. **Disconnect**: remove it.
- **Install link**: a URL that opens a client and makes the client show its own "Install this MCP
  server?" question. The client writes its own config.
- **Owner CLI**: the client's own command that adds a server (`claude mcp add`, `codex mcp add`,
  `code --add-mcp`). The client writes its own config.
- **MSIX**: the Windows package format. A packaged app sees a private copy of `%APPDATA%`.

---

## 1. What the user sees

**The command line.**

```
deetsmusic mcp install
  DeetsMusic found these AI apps on this PC:
    1  Claude Desktop     not connected
    2  Claude Code        not connected
    3  VS Code            not connected
    4  Codex              not connected
  Connect which? [all]: 1 2
  ✓ Claude Desktop connected. Restart Claude Desktop to finish.
  ✓ Claude Code connected. Start a new Claude Code session.

deetsmusic mcp install claude-desktop cursor [--small] [--yes]   # no question; for scripts
deetsmusic mcp status                                            # one line per found app
deetsmusic mcp uninstall [<client>… | --all]
deetsmusic mcp [--small]                                         # unchanged: serve the tools
```

The question shows only when stdin is a terminal. With `--json`, or with no terminal, the command
needs client names and asks nothing.

**The app.** Settings › Connections › under **Agent control**, a new row **Set up the DeetsMusic MCP** (named 2026-10-11, §8b) opens
a panel:

```
Connect AI apps
DeetsMusic found these apps on this PC:
  ☑ Claude Desktop   Not connected
  ☑ Claude Code      Not connected
  ☐ VS Code          Connected ✓           [Disconnect]
[ Connect ]
✓ Claude Desktop connected. Restart Claude Desktop to finish.  [Restart Claude Desktop]
Using a different AI app?  [Copy setup info]
```

- The panel lists **only the clients it detects**.
- A client that is not connected shows **checked**. The user presses **Connect**. We change another
  app's settings, so the user always confirms first.
- **Copy setup info** is today's **Copy setup for** row (`agent_setup_text`), moved into the panel.

---

## 2. Forks (decided 2026-10-11: 1A 2A 3B 4A 6A, 5 is moot for v1 — read §8c, which updates each one for the four apps)

### Fork 1 — Where the module lives

The CLI is a standalone crate on purpose (`cli/Cargo.toml`: no workspace tie to `src-tauri`, so
the two builds never share a target dir). The app must call the module directly, with no hidden
console window.

| | Option | Result |
|---|---|---|
| **A (recommended)** | A new path crate `crates/mcp-install/`. `cli/` and `src-tauri/` each list it as `{ path = "../crates/mcp-install" }`. | One copy of the code. Still no workspace, so still two target dirs. `agent_setup_text` moves into it. |
| B | The code lives in `cli/`. The app runs `deetsmusic.exe mcp install --json`. | The note rules this out: a hidden process, and a second failure point. |
| C | Two copies. | Rejected: the client formats change, and two copies drift. |

### Fork 2 — How each client gets the entry

Three ways exist. The table in §4 shows which ways each client has.

| Way | Good | Bad |
|---|---|---|
| **Owner CLI** | The client writes its own file. We read the result back at once (`claude mcp get`). | The command must be on PATH. Desktop-only users often lack it. |
| **Install link** | The client writes its own file and asks its own question. The format belongs to the client. | The client must open and the user must click again. We cannot see the result until the client writes its file. No link removes a server. |
| **Write the file** | Works with the client closed. Status is exact. | We own the format. Other servers' secrets are in the same file (§6). |

| | Option |
|---|---|
| **A (recommended)** | A ladder per client: **owner CLI → write the file → install link** only when the file cannot be parsed (VS Code comments). Disconnect always edits the file or uses the owner CLI. |
| B | **Install link first** wherever one exists (Cursor, VS Code, LM Studio), as the note says. Write the file elsewhere. |
| C | Write the file for every client. Links and owner CLIs are not used. |

Why A over B: the panel shows status and a Disconnect button. Both need us to read the file anyway.
A link adds a second click in another app and a gap where the panel cannot say "Connected".

### Fork 3 — Restart help

Claude Desktop reads its config only at start. Cursor, VS Code and LM Studio reload `mcp.json` on
change. Claude Code and Codex read it when a new session starts.

| | Option |
|---|---|
| **A (recommended)** | A **Restart Claude Desktop** button, only for Claude Desktop. It closes `Claude.exe` and starts it again (MSIX: `explorer.exe shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude`). The button text says what it does. Other clients get a message only. |
| B | A message for every client. No button. |

### Fork 4 — The dev build

A `dev:app` build must not overwrite the entry of the installed app (memory: stranger parity;
dev and installed share settings).

| | Option |
|---|---|
| **A (recommended)** | A debug build names its entry **`deetsmusic-dev`** and points it at `cli/dist/deetsmusic.exe`. Both entries can exist at once. |
| B | The panel and the command refuse to connect from a debug build. |

### Fork 5 — Full or small tools

| | Option |
|---|---|
| **A (recommended)** | `mcp` for every client except **LM Studio**, which gets `mcp --small` (local models). `--small` / `--full` on the command changes it. The panel has no switch. |
| B | A Full / Small choice on each row in the panel. |

### Fork 6 — Uninstall

An uninstall leaves entries that point at a deleted exe. The client then shows "server failed to
start" (AGENT-SETUP.md §5).

| | Option |
|---|---|
| **A (recommended)** | The NSIS `PREUNINSTALL` hook runs `deetsmusic.exe mcp uninstall --all --quiet` **before** it stops the exe. An update does not run it (the path stays the same). |
| B | Leave the entries. The table row in AGENT-SETUP.md §5 covers it. |

---

## 3. Detection

**Rule:** a client is "found" when its program **or** its config folder exists. We never start a
client to detect it. We never search the disk. Every check is one `Path::exists` or one PATH lookup.

**This PC, 2026-09-16:** found Claude Desktop (MSIX), Claude Code (`~\.local\bin\claude`), VS Code
(`%LOCALAPPDATA%\Programs\Microsoft VS Code`), Codex (MSIX `OpenAI.Codex_2p2nqsd0c76g0` and
`~\.codex\config.toml`). Not found: Cursor, Windsurf, LM Studio, Gemini CLI, Zed, Cline. No client
has a `deetsmusic` entry now.

---

## 4. Clients (v1)

"Checked" means read in the client's docs or on this PC on 2026-09-16. The build checks each row
again, because these formats have changed before.

| Client | Detect | Config (Windows) | Shape | Owner CLI | Install link | Checked |
|---|---|---|---|---|---|---|
| **Claude Desktop** | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc` (MSIX) · else `%LOCALAPPDATA%\AnthropicClaude` (classic) | MSIX: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`. Classic: `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers.deetsmusic = {command, args}` | — | — (see §4.1) | Path: anthropics/claude-code #26073, #25579. On this PC. |
| **Claude Code** | `claude` on PATH · `~\.local\bin\claude.exe` · `~\.claude.json` | `~\.claude.json` (user scope) | `mcpServers.deetsmusic = {type:"stdio", command, args}` | `claude mcp add -s user deetsmusic -- "<exe>" mcp` · `claude mcp remove -s user deetsmusic` · `claude mcp get deetsmusic` | — | On this PC |
| **Cursor** | `%LOCALAPPDATA%\Programs\cursor\Cursor.exe` · `~\.cursor` | `~\.cursor\mcp.json` | `mcpServers.deetsmusic = {command, args}` | — | `cursor://anysphere.cursor-deeplink/mcp/install?name=deetsmusic&config=<base64 JSON>` | cursor.com/docs (link). Base64 = the inner `{command,args}`: confirm at build. |
| **VS Code** | `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe` · `%ProgramFiles%\Microsoft VS Code` | `%APPDATA%\Code\User\mcp.json` (**JSON with comments**) | `servers.deetsmusic = {type:"stdio", command, args}` (key is `servers`) | `code --add-mcp "{\"name\":\"deetsmusic\",\"command\":…,\"args\":[\"mcp\"]}"` (add only) | `vscode:mcp/install?<URL-encoded {name,command,args}>` | code.visualstudio.com (shape, `--add-mcp`); link from VS Code's installer docs. On this PC. Needs Copilot agent mode to use tools. |
| **Codex** (CLI + app) | `codex` on PATH · `~\.codex` | `~\.codex\config.toml` | `[mcp_servers.deetsmusic]` `command`, `args` | `codex mcp add deetsmusic -- "<exe>" mcp` · `codex mcp remove deetsmusic` | — | File on this PC. |
| **LM Studio** | `~\.lmstudio` | `~\.lmstudio\mcp.json` | `mcpServers.deetsmusic = {command, args}` | — | `lmstudio://add_mcp?name=deetsmusic&config=<base64 inner JSON>` | lmstudio.ai/docs (link, inner object) |
| **Windsurf** | `~\.codeium\windsurf` | `~\.codeium\windsurf\mcp_config.json` | `mcpServers.deetsmusic = {command, args}` | — | — | Not checked |
| **Gemini CLI** | `~\.gemini` | `~\.gemini\settings.json` | `mcpServers.deetsmusic = {command, args}` | `gemini mcp add` (check) | — | Not checked |

**Not in v1:** Zed (`context_servers` in a JSONC settings file), Cline (config in VS Code
extension storage), Goose (YAML), JetBrains (UI only). **Copy setup info** covers them.
**ChatGPT desktop** runs no local MCP servers (AGENT-SETUP.md §2). The panel does not list it.

### 4.1 The Claude Desktop MSIX trap

The MSIX Claude Desktop reads `%APPDATA%\Claude\…` through its private copy, so the real file is
under `Packages\…\LocalCache\Roaming\Claude\`. DeetsMusic is **not** MSIX, so it must write the
`LocalCache` path directly. Claude's own **Edit Config** button opened the wrong file for some
users (#26073).

**Also true for this session.** This Claude Code session runs inside the Claude MSIX package. From
here, `%APPDATA%\Claude\claude_desktop_config.json` and the `LocalCache` file look identical (same
size, same time). So a test run from this session proves nothing about the real path. **Desk-test
from a normal terminal or the installed app** (CLAUDE.md: registry and AppData writes from this
session are not real).

**Claude Desktop Extensions (`.mcpb`).** Opening a `.mcpb` file makes Claude Desktop show its own
install question. That is the Claude version of an install link. It is not in v1: the bundle copies
the server into Claude's own folder, so that copy does not update with DeetsMusic. Revisit if the
MSIX path moves again.

---

## 5. The module

`crates/mcp-install/` (Fork 1A). Dependencies: `serde_json` with `preserve_order` (keeps the user's
key order), `toml_edit` (keeps Codex comments). Nothing async. It does not open URLs or start
programs. It returns what the caller must do, and the CLI and the app each do it their own way.

```rust
pub enum ClientId { ClaudeDesktop, ClaudeCode, Cursor, VsCode, Codex, LmStudio, Windsurf, GeminiCli }

pub struct Server { pub name: String, pub exe: PathBuf, pub small: bool }  // name: deetsmusic | deetsmusic-dev

pub enum State {
    NotConnected,
    Connected,                 // our name, command == our exe, args match
    Stale { command: String }, // our name, the exe is missing or is another path → "Repair"
    Manual { command: String },// our name, not our exe (someone set it up by hand) → Replace asks first
    Unreadable(String),        // parse error, JSONC we will not rewrite, file locked
}

pub struct Found { pub id: ClientId, pub label: &'static str, pub config: Option<PathBuf>, pub state: State }

pub enum Outcome {
    Done { restart: Restart },     // Restart::App(ClientId) | NewSession | None
    OpenLink(String),              // the caller opens it; status stays NotConnected until the client writes
    RunOwnerCli(Vec<String>),      // argv; the caller runs it hidden, then calls detect() again
    Failed(String),                // one plain sentence
}

pub fn detect() -> Vec<Found>;
pub fn connect(id: ClientId, s: &Server, replace_manual: bool) -> Outcome;
pub fn disconnect(id: ClientId, s: &Server) -> Outcome;
pub fn setup_text(id: Option<ClientId>, s: &Server) -> String;   // today's agent_setup_text
```

**The exe path.** The CLI passes `std::env::current_exe()`. The app passes `cli_path()` (moved from
`settings.rs`, which already strips the `\\?\` prefix some clients cannot start).

**Owner CLI note.** `RunOwnerCli` is a real process. In the app it runs with `CREATE_NO_WINDOW`, so
no console flashes. This is not the "shelling out" the note rejects: the note rejects the app
running **our own** CLI to do the work.

**The clap change.** `Cmd::Mcp { small }` becomes `Mcp { small, #[command(subcommand)] act:
Option<McpAct> }` with `args_conflicts_with_subcommands`. `deetsmusic mcp` and `deetsmusic mcp
--small` must keep working: every existing client entry uses them.

---

## 6. Writing another app's file

1. **Read, parse, change one key, write.** Keep every other key and its order. If the file does not
   parse, stop with `Unreadable` and never write. VS Code's `mcp.json` may contain comments. If it
   does, use `code --add-mcp` or the install link, and tell the user that Disconnect needs a
   hand edit.
2. **Back up once.** Before the first write, copy the file to `<file>.deetsmusic-backup` in the same
   folder (same permissions). Do not overwrite an older backup.
3. **Write safely.** Write `<file>.tmp` in the same folder, then rename it over the original.
4. **Other servers' secrets.** These files hold other servers' `env` values (API keys). Never log a
   file's contents. Never put one in a report (LOGGING.md › the report form). Log only
   `mcp-install: connect claude-desktop → ok` and the path.
5. **A missing file or folder** is created only when the client was detected (for example Claude
   Desktop is installed but has no config file yet).
6. **Claude Code's `~\.claude.json`** is rewritten by every open Claude Code session, so a direct
   write can be lost. Use the owner CLI. Write the file only when `claude` cannot be found, and
   then tell the user to close Claude Code first.
7. **Replace asks.** A `deetsmusic` entry that points somewhere else (`Manual`) is changed only
   after the user confirms (the panel asks; the CLI needs `--replace`).

---

## 7. The Settings panel — the build checklist (CLAUDE.md › Working style)

1. **Motion:** the panel gets `.pop` and `enterRows` on open. A result line that appears after
   Connect goes through `enterRows`.
2. **Tokens:** no new colors. The ✓ uses the existing success role. Grep before use.
3. **Hints:** the row "Set up the DeetsMusic MCP" ("Pick your AI app below and press Connect, then ask it to play something in a new chat"), the
   Restart button, Disconnect, Copy setup info. Add all to the ONBOARDING.md ledger.
4. **Toasts:** none. Results show in the panel.
5. **Settings keys:** none. State lives in the clients' files, not in `settings.json`.
6. **Log lines:** `diag.log` each connect, disconnect, restart and uninstall-hook run (§6.4 rule).
6a. **Scrollbars:** the list gets `app-scroll` and `scrollbar-gutter: stable`.
7. **Telemetry:** `dataset.frames` on the panel.
8. **Agent reach:** none. An agent must not connect itself to other apps.

Tauri commands: `mcp_detect`, `mcp_connect(client, replaceManual)`, `mcp_disconnect(client)`,
`mcp_restart(client)`, and `agent_setup_text` (kept, now a thin call into the crate).

---

## 8. Build order (when the user says go)

1. The crate: `detect`, `setup_text`, and `connect`/`disconnect` for Claude Desktop and Claude Code.
   Move `agent_setup_text` and `cli_path` into it.
2. `deetsmusic mcp install | status | uninstall`. Desk test from a normal terminal (§4.1).
3. Cursor, VS Code, Codex, LM Studio, Windsurf, Gemini CLI. Check each row of §4 first.
4. The Settings panel (§7). Replace the **Copy setup for** row.
5. The `PREUNINSTALL` hook (Fork 6), and the Restart button (Fork 3).
6. AGENT-SETUP.md §2 rewritten around the panel and the command. AGENT.md §4 gets the new commands.

## 8a. Research and build effort (2026-10-11)
> **Part:** designed · 2026-10-11 · forks 7–9 decided (the owner, 2026-10-11) · forks 1–6 decided 2026-10-11 (§8c)

**What changed outside since 2026-09-16** (read in the vendors' docs on 2026-10-11):
- **Claude Desktop: the `.mcpb` bundle is the one-click path.** A user double-clicks the file
  (or drags it in, or Settings › Extensions › Advanced settings › Install Extension…), and
  Claude Desktop shows its own install screen. A `node` bundle needs no runtime: Node ships
  with Claude Desktop. The directory no longer takes new `.mcpb` listings; a bundle is handed
  to the user. Source: claude.com/docs/connectors/building/mcpb, the MCPB manifest spec (github.com/modelcontextprotocol/mcpb).
- **The drift problem of §4.1 has a fix.** The bundle holds no server of ours. It holds a
  shim of about 30 lines of Node that starts `%LOCALAPPDATA%\DeetsMusic\cli\deetsmusic.exe mcp`
  and pipes stdin and stdout. The tools come from the installed exe, so the bundle never goes
  out of date. If the exe is missing, the shim answers with one MCP error: "DeetsMusic is not
  installed on this PC."
- **The ChatGPT desktop app now runs local MCP servers.** OpenAI's docs: "The ChatGPT desktop
  app, Codex CLI, and IDE extension share this configuration" (`~\.codex\config.toml`). So
  one Codex entry also reaches ChatGPT desktop. AGENT-SETUP.md §2 ("ChatGPT … cannot control
  DeetsMusic") is out of date. Which ChatGPT modes use it is not stated; the desk test checks.
- **Claude Code:** `claude mcp add` defaults to the *local* scope (this folder only). The
  entry needs `-s user`. Today's **Copy setup for** text omits it (settings.rs:401): a bug.
- **Codex:** `codex mcp add deetsmusic -- "<exe>" mcp`. No install link.

**New forks — decided (the owner, 2026-10-11): 7A the `.mcpb`, 8B *last used*, 9A the four
apps first.** His reason for 9A: the four apps with the strongest documentation and the most
likely users.

| # | Fork | Options | Recommendation (now his call) |
|---|---|---|---|
| **7** | Claude Desktop | **A** the `.mcpb` shim: Connect opens the bundle and Claude shows its own install screen · **B** write `claude_desktop_config.json` (§4.1 path trap, restart needed) | **A.** Claude owns its own file, and the MSIX trap is gone. Cost: we cannot read Claude's extension list, so status comes from fork 8, and Disconnect sends the user to Claude › Settings › Extensions |
| **8** | How the panel knows it works | **A** read each client's config only · **B** also a *last used* line: the CLI sends the MCP `clientInfo.name` to the bridge, the bridge keeps the time per client, and the panel says "Claude Desktop · used 2 min ago" | **B.** It proves the whole path (client → exe → bridge → app), not only a file. It is the only status we can get for the `.mcpb` |
| **9** | The v1 client list | **A** Claude Desktop, Claude Code, Codex + ChatGPT desktop; the rest in v2 · **B** all eight of §4 at once | **A.** These are the apps a beginner has. Cursor, VS Code, LM Studio, Windsurf and Gemini keep **Copy setup info** until v2 |

**Effort, with forks 1A–6A, 7A, 8B, 9A** (one load-bearing feature; it writes other apps'
files):

| Part | Size | Notes |
|---|---|---|
| `crates/mcp-install/`: detect, the Codex TOML edit, the Claude Code owner CLI, backup + atomic write, `setup_text` | ~500 lines Rust | Pure merge functions with unit tests (a file in → a file out) |
| The `.mcpb`: the Node shim, `manifest.json`, icon; packed at `npm run release`, shipped in the installer's resources | ~60 lines + a release step | Built once; the shim never changes with the app |
| `deetsmusic mcp install / status / uninstall` (the clap change, §5) | ~200 lines | `deetsmusic mcp` and `mcp --small` keep working |
| *Last used* (fork 8): CLI header, bridge map, one command | ~60 lines | No schema change: memory only, lost at restart |
| The Settings panel (§7 checklist, *Connect AI apps* replaces **Copy setup for**) | ~300 lines TS + CSS | Ledger, `NEW_MARKS`, the Compass, hints |
| `PREUNINSTALL` hook (fork 6) | small | Cannot remove the `.mcpb`; the shim's error covers it |
| Docs: AGENT-SETUP.md rewritten, AGENT.md, ONBOARDING.md, this doc's as-built | — | The guide page *Connect* (DOCS-ORG §13.10) covers it |

**Sittings: about three.** (1) The crate, the CLI and the tests, with Claude Code and Codex.
(2) The `.mcpb`, *last used* and the panel. (3) The uninstall hook, the docs and the desk test.
The desk test must run from the installed app or a normal terminal, not from a Claude session
(§4.1, MSIX), on Claude Desktop, Claude Code, Codex and ChatGPT desktop.

**Shipped ahead of B (2026-10-11, uncommitted at writing):** the `-s user` fix to the Claude
Code text in `agent_setup_text` (settings.rs) and in AGENT.md §4.

## 8b. Where the code and the state live (2026-10-11)
> **Part:** designed · 2026-10-11

Each part goes to the place that already holds its kind. Read against the tree on 2026-10-11.

| Part | Home | Why there |
|---|---|---|
| The install logic: detect, connect, disconnect, `setup_text`, the backup and the atomic write | **`crates/mcp-install/`**, a new path crate (fork 1A). `cli/Cargo.toml` and `src-tauri/Cargo.toml` each list it by path | The CLI is its own crate with no workspace (two target dirs, on purpose). A path crate is the one way both can call the same code with no hidden process. `crates/` is new; the AirPlay crate is a git dependency, so nothing sits there yet |
| `agent_setup_text`, `cli_path`, `cli_name` | **Move** from `src-tauri/src/settings.rs` into the crate; settings.rs keeps a thin `#[tauri::command]` | They are install logic, not settings. The beta name (`deetsmusic-beta`, BETA.md §6) moves with them |
| The app's commands: `mcp_detect`, `mcp_connect`, `mcp_disconnect`, `mcp_open_bundle`, `mcp_last_used` | **`src-tauri/src/mcp_install.rs`**, a new module, registered in `lib.rs` beside `agent_setup_text` | One module per outside thing, like `lastfm.rs` or `presence.rs`. Every command is `async` + `spawn_blocking`: it reads and writes other apps' files (CLAUDE.md › Conventions, check 9) |
| `deetsmusic mcp install / status / uninstall` | **`cli/src/main.rs`**, the `Cmd::Mcp` change of §5 | Where every CLI verb lives |
| The `.mcpb` source: the Node shim, `manifest.json`, `icon.png` | **`mcpb/`** at the repo root, beside `extension/` | The same kind of thing as the browser extension: a small outside package that ships inside the installer |
| Packing the `.mcpb` | **`scripts/mcpb-pack.mjs`**, called from `scripts/release.mjs` after `cli:build` | A zip with a manifest needs no tool of its own; the release already has a step list |
| Shipping it | **`tauri.conf.json` › `bundle.resources`**: `"../mcpb/dist/deetsmusic.mcpb": "mcpb/deetsmusic.mcpb"`, beside `cli/deetsmusic.exe` | The CLI and the extension ship this way. The *Connect* button opens `$INSTDIR\mcpb\deetsmusic.mcpb`, and Windows hands it to Claude Desktop |
| *Last used* (fork 8) | **CLI:** `serve_mcp` (`cli/src/main.rs`, the `initialize` arm) keeps `clientInfo.name` and sends it as an `X-Deets-Client` header on each bridge call. **App:** `bridge.rs` `handle` notes the name and the time in a memory map; `mcp_last_used` reads it | No database, no settings key: it is lost at restart, and the panel says "not used since DeetsMusic started" |
| The uninstall hook (fork 6) | **`src-tauri/src/velo.rs`** `before_uninstall` since Velopack (2026-10-15); up to 0.27 `src-tauri/nsis/hooks.nsh`, the `PREUNINSTALL` macro, before `DeetsStopCli` | It also stops the CLI and removes the autostart value there; the same "the path, never the name" rules apply. The CLI path is now `%LOCALAPPDATA%\DeetsMusic\current\cli\deetsmusic.exe`: re-run *Set up the DeetsMusic MCP* once after the move |
| The Settings UI | **Settings › Connections**, under *Agent control*. **Connect AI apps** replaces the **Copy setup for** row (`src/settings-card.ts`, the `setup` split row). *Copy setup info* stays inside the new part for the other apps | The row already sits there; a user who looks for it finds it in the same place |
| The panel code | **`src/mcp-panel.ts`**, a new module, opened from the row | settings-card.ts is already large; a panel with its own state is its own file, like `room-panel.ts` |
| Docs | AGENT-SETUP.md §2 rewritten around the panel; AGENT.md §4 the new verbs; ONBOARDING.md §1 the hints; `NEW_MARKS` one line; the guide page *Connect* (DOCS-ORG §13.10) | The build checklist (CLAUDE.md › Working style) |

**Settings keys: none.** Whether an app is connected lives in that app's own file (or, for
the `.mcpb`, in Claude Desktop), and *last used* lives in memory. Nothing goes into
`settings.json`, so no agent spec and no AGENT.md settings line. An agent cannot reach any of
it (§7.8: an agent must not connect itself to other apps).

**Decided (the owner, 2026-10-11):**
- **The panel is inline** in the Connections section, in the *My reports* idiom: a bordered
  `set__group` with a heading and one line per app. No popover. (Rejected: a dropdown panel
  on the row.) A line that appears after a press still goes through `enterRows` (§7.1).
- **The row's label is *Set up the DeetsMusic MCP*.** It replaces *Connect AI apps* in §1 and
  §7.3. The hint (the owner, 2026-10-11): "Pick your AI app below and press Connect, then ask it to play something in a new chat".

### 8c. Forks 1–6, read again after 7A and 9A (2026-10-11)

> **Decided (the owner, 2026-10-11): 1A, 2A, 3B, 4A, 6A.** Fork 5 is moot for v1 (every entry
> is `mcp`). The design is complete; the build waits for his go (one load-bearing feature in
> flight, CLAUDE.md › Working style).

7A (Claude Desktop through the `.mcpb`) and 9A (four apps first) change what forks 1–6 cover.
The four apps and how each one connects:

| App | How it connects in v1 | How it disconnects |
|---|---|---|
| Claude Desktop | Opens `deetsmusic.mcpb`; Claude shows its own install screen | The user removes it in Claude › Settings › Extensions |
| Claude Code | `claude mcp add -s user …` (its own command) | `claude mcp remove -s user deetsmusic` |
| Codex | `codex mcp add deetsmusic -- …` (its own command) | `codex mcp remove deetsmusic` |
| ChatGPT desktop | The Codex entry: the same file, one line in the panel for both | The same |

- **Fork 1 (where the code lives):** unchanged. Recommendation **A**, the path crate.
- **Fork 2 (how each app gets the entry):** smaller now. Claude Desktop has one way (the
  `.mcpb`). Claude Code and Codex: **A (recommended)** their own command, and when the command
  is not on PATH, write the file (`~\.claude.json` only when Claude Code is closed, §6.6;
  `config.toml` with `toml_edit`). **B** their own command only; no command, no Connect, and
  the panel shows *Copy setup info*.
- **Fork 3 (restart help):** the Restart button was for Claude Desktop, and a `.mcpb` install
  needs no restart. Claude Code and Codex read the entry at a new session. **Recommendation
  now B:** a message only, no button, in v1. Check at the desk test whether ChatGPT desktop
  needs a restart.
- **Fork 4 (the dev build):** **A (recommended)** a dev build connects Claude Code and Codex as
  `deetsmusic-dev` and never offers the `.mcpb` (a second bundle would need its own id and
  shim). **B** the panel and the command refuse in a dev build.
- **Fork 5 (full or small tools):** none of the four apps is a small local model. **v1: every
  entry is `mcp` (full).** The fork returns with LM Studio in v2.
- **Fork 6 (uninstall):** **A (recommended)** the `PREUNINSTALL` hook removes the Claude Code
  and Codex entries. It cannot remove the `.mcpb`; after an uninstall, the shim answers
  "DeetsMusic is not installed on this PC", and the user removes it in Claude. **B** leave
  every entry; AGENT-SETUP.md §5 tells the user.

## 8d. As built (2026-10-11)
> **Part:** built · 2026-10-11 · desk test §9 open

Where it differs from the design above, this section is the code.

- **`crates/mcp-install/`**: `detect`, `status`, `connect`, `disconnect`, `setup_text`,
  `client_for_agent`, and the pure edits (`json_set` / `json_remove` / `json_state`,
  `toml_set` / `toml_remove` / `toml_state`) with 10 unit tests. `npm run check` runs them.
  `ClientId` has three values: Claude Desktop, Claude Code, and Codex, labelled *Codex and
  ChatGPT* (fork 9A). `State` has a sixth value, `Extension`: Claude Desktop with no entry in
  its file (we cannot read Claude's extension list).
- **Differences from §5:** the crate runs the apps' own commands itself (`run`, with
  `CREATE_NO_WINDOW`), so the CLI and the app share one runner. `connect` returns
  `Done`, `OpenBundle`, `AskReplace` or `Failed`, and reads the file again after the command.
  `cli_path` stays in `settings.rs` (it needs the app's resource folder); `setup_text` moved.
- **`serde_json` `preserve_order` is now on for the whole app** (the feature unifies across
  the build). JSON maps keep insertion order instead of sorting. `npm run check` passed with it.
- **Claude Desktop with an old hand-made entry:** a `Stale` entry of ours is removed from its
  file before the `.mcpb` opens; a `Manual` one is left alone.
- **The CLI:** `deetsmusic mcp install`, `status` (also `--json`) and `uninstall`. The entry is
  `deetsmusic-dev` from a debug build and `deetsmusic-beta` from the beta. A Claude Desktop
  install from the CLI opens `<install>\mcpb\deetsmusic.mcpb` with Explorer.
- **Last used:** `serve_mcp` keeps `clientInfo.name` (printable, 64 characters) and sends it as
  `X-Deets-Client`; `bridge.rs` passes it to `mcp_install::note_agent` on a paired request only.
- **The `.mcpb`:** `mcpb/manifest.json` (manifest 0.3, `node`, Windows only) and
  `mcpb/server/index.js`. The shim finds `%LOCALAPPDATA%\DeetsMusic\cli\deetsmusic.exe`, else
  `where deetsmusic.exe`; it pipes stdio, and answers the not-installed sentence when neither
  exists. `mcpb/package.json` makes the folder CommonJS (the repo root is an ES module
  package). `mcpb/icon.png` is the app's 256 px icon. `npm run mcpb:pack` writes
  `mcpb/dist/deetsmusic.mcpb` with Windows' own tar. `cli:build` and the beta release step run
  it, because a missing resource fails even `tauri dev`.
- **The panel:** the `mcpsetup` split row (label, hint, a **Refresh** half), then the `mcpapps`
  html row (`src/mcp-panel.ts`), then **Copy setup info** (was *Copy setup for*). It looks again
  on mount, on Refresh, after each press, and on window focus. A New mark on `mcpsetup`.
- **Uninstall:** `PREUNINSTALL` runs `mcp uninstall --all --quiet` before `DeetsStopCli`, not on
  `/UPDATE`.
- **Words chosen inside his forks (for his review):** the state tags *Not connected ·
  Connected · Needs repair · Set up by hand · Cannot read · Extension*; the tag *Used just now /
  N min ago / N h ago*; the buttons *Connect · Disconnect · Repair · Replace · Sure? · Install ·
  Refresh*; the notes in the crate's `next_step` and `disconnect`; the shim's not-installed
  sentence; the manifest's description and author *Deets*; the row label *Copy setup info*.

## 9. Desk test (open, 2026-10-11)

Run it from the installed app or a normal terminal, **not from a Claude session** (§4.1: the
Claude MSIX package hides `%APPDATA%` writes). An installer needs `npm run release`, so steps
1–5 use the debug CLI (entry `deetsmusic-dev`) or the dev app; steps 6–8 need an installed build.

1. `cargo build --manifest-path cli/Cargo.toml`, then `cli\target\debug\deetsmusic.exe mcp status`:
   Claude Desktop, Claude Code, and Codex and ChatGPT are listed.
2. `… mcp install claude-code`: `claude mcp list` shows `deetsmusic-dev`. A new Claude Code
   session in ANY folder has its tools. Run it again: "already connected".
3. `… mcp install codex`: `~\.codex\config.toml` has `[mcp_servers.deetsmusic-dev]`, the other
   tables and comments are unchanged, and `config.toml.deetsmusic-backup` exists. Open the
   ChatGPT desktop app and the Codex app: do both list DeetsMusic's tools? Does ChatGPT need a
   restart? That decides fork 3's message.
4. Use DeetsMusic from Claude Code, then open the dev app › Settings › Connections: Claude
   Code's line says *Used just now*.
5. `… mcp uninstall claude-code codex`: both entries are gone; nothing else changed.
6. Installed build: Settings › Connections › **Install** on Claude Desktop. Claude shows its
   install screen. After Install, a new chat has DeetsMusic's tools, and after one call the line
   says *Used … ago*.
7. The panel's **Connect** and **Disconnect** on Claude Code and Codex, with the same checks.
8. Uninstall DeetsMusic: the Claude Code and Codex entries are gone; Claude Desktop's extension
   answers "DeetsMusic is not installed on this PC".

# DeetsMusic — connect AI apps (`mcp_install`)

> **Designed 2026-09-16. Not built. The forks in §2 are open.** The user asked for a Rust module that
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

**The app.** Settings › Connections › under **Agent control**, a new row **Connect AI apps** opens
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

## 2. Forks (open, the user decides)

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
3. **Hints:** the row "Connect AI apps" ("Sets up DeetsMusic in the AI apps on this PC"), the
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

## 9. Desk test (to fill in at build)

1. From a normal terminal: `deetsmusic mcp status` lists Claude Desktop, Claude Code, VS Code, Codex.
2. `deetsmusic mcp install claude-desktop`. Open the `LocalCache` file: the entry is there, the other
   servers are unchanged, the backup exists. Restart Claude Desktop: the DeetsMusic tools show.
3. Run it again: "already connected", no write.
4. Change the entry's command to a missing path: status says **Needs repair**. Install repairs it.
5. `deetsmusic mcp uninstall --all`: every entry is gone, the other servers are unchanged.
6. The panel: the same steps with the buttons, plus **Restart Claude Desktop**.
7. A dev build connects as `deetsmusic-dev` and leaves `deetsmusic` alone.

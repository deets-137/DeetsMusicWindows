# Release, install, uninstall

> Status: **the installer line is live** — 0.1.0 → 0.1.3 shipped, 0.1.3 is the first build
> whose installer stops the bundled CLI (below). Code: `package.json` (`release` script),
> `scripts/cli-dist.mjs`, `scripts/archive-installer.mjs`, `src-tauri/nsis/hooks.nsh`,
> `src-tauri/tauri.conf.json` (`bundle`).

House pattern, shared with DeetsAirplay / DeetsRGB: a hand-built **NSIS** installer, per-user,
no admin prompt, no auto-updater. Each shipped setup exe is kept in a local `installers/`
archive.

## 1. Cut a build

Three files hold the version and **must agree**: `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`. Tauri names the installer from `tauri.conf.json`;
`scripts/archive-installer.mjs` looks for it using `package.json`. A mismatch fails the
archive step with a message that says to check all three — deliberately, because the
alternative is an installer that silently never gets archived.

```bash
npm run release     # cli:build → tauri build → archive-installer
```

Three stages, and the order matters:

1. **`npm run cli:build`** — `cargo build --release` on `cli/`, then `scripts/cli-dist.mjs`
   stages the exe at `cli/dist/deetsmusic.exe`, where `bundle.resources` expects it.
   **`tauri build` alone ships the PREVIOUS CLI**, with no warning. Always use `npm run release`.
2. **`tauri build`** — bundles the front end into the exe, then runs `makensis`.
   ~3 min cold, ~1 min warm. Output:
   `src-tauri/target/release/bundle/nsis/DeetsMusic_<version>_x64-setup.exe` (~5.6 MB at 0.1.3).
3. **`scripts/archive-installer.mjs`** — copies that exe into `installers/`.

`installers/` is **gitignored** (~6 MB each), exactly as DeetsAirplay does it. The difference
is that DeetsAirplay fills it by hand and its archive drifted — 0.1.0 sitting in the folder
while the app said 0.1.1 — so here the copy is a build stage instead of a habit.

The archive earns its keep because `src-tauri/target/` is the only other copy, and
`cargo clean` takes it.

## 2. What ships inside

| Path after install | Source | Notes |
|---|---|---|
| `DeetsMusic.exe` | `src-tauri` release build | The app. `mainBinaryName` in `tauri.conf.json` — without it the exe takes the Cargo package name. |
| `cli\deetsmusic.exe` | `cli/dist/` via `bundle.resources` | The agent CLI + MCP server ([AGENT.md](AGENT.md)). |
| `extension\` | `extension/` via `bundle.resources` | Unpacked MV3 source + `install.html` ([EXTENSION.md](EXTENSION.md) §6). |
| `uninstall.exe` | NSIS | Also registered under Installed apps. |

Install root is `%LOCALAPPDATA%\DeetsMusic` (`installMode: currentUser`). User data lives
elsewhere and survives: `%APPDATA%\com.deetsmusic.app` holds `deetsmusic.db`,
`user-token.txt`, `settings.json`, `bridge.log`.

## 3. The NSIS hooks

`src-tauri/nsis/hooks.nsh` supplies three macros that Tauri splices into the generated
installer:

- **`NSIS_HOOK_PREINSTALL`** and **`NSIS_HOOK_PREUNINSTALL`** — stop the bundled CLI.
- **`NSIS_HOOK_POSTINSTALL`** — offer the browser extension walkthrough
  ([EXTENSION.md](EXTENSION.md) §6).

### Why the CLI has to be stopped (2026-09-09)

Tauri's template closes the **app** before it writes or deletes files. It knows nothing about
the CLI beside it, and that CLI is long-lived in practice: `deetsmusic mcp` serves an MCP
session for as long as the agent runs. Windows will not replace or delete a file a process
holds open.

What that actually cost, on the 0.1.2 → 0.1.3 changeover: uninstalling 0.1.2 removed the
registry entry and then failed on `cli\deetsmusic.exe`, leaving **every file on disk** while
Windows reported the app as not installed. A half-uninstall. An upgrade fails the same way,
more quietly — a new app paired with a stale CLI.

The macro matches **by path** (`$INSTDIR\cli\*`), not by image name. `target\debug\deetsmusic.exe`
carries the same name, and an uninstall has no business killing a dev build.

Two quoting traps, both invisible until an install fails: `$$_` is how NSIS emits a literal
`$_` for PowerShell, and `$\'` is how it emits a single quote — double quotes would close
PowerShell's own `-Command "…"` string.

## 4. Install

```bash
installers/DeetsMusic_<version>_x64-setup.exe
```

No admin prompt. Adds a Start Menu entry (right-click → *Pin to taskbar*) and the uninstaller,
then offers the extension walkthrough.

- The installer is **unsigned**, so SmartScreen warns on first run (*More info → Run anyway*).
  Silencing it needs a code-signing certificate.
- **Secrets**: an installed build looks in `%APPDATA%\com.deetsmusic.app\secrets\` first and
  falls back to the compile-time repo path. Copy `src-tauri/secrets/` there to make the install
  self-contained — see `src-tauri/secrets/README.md`.
- A dev build may keep running through an install; it lives in `target/debug` and nothing
  touches it. It does share the installed build's identifier and data dir, though — see
  [TRAY.md](TRAY.md) §6 on the single-instance guard, and use `npm run dev:app` to separate them.

## 5. Uninstall

```bash
"$LOCALAPPDATA/DeetsMusic/uninstall.exe"        # add /S for no prompts
```

Or Settings → Installed apps. The `PREUNINSTALL` hook stops the CLI first.

User data is **not** part of the install root, so this leaves it. Remove it deliberately:

```bash
rm -rf "$APPDATA/com.deetsmusic.app"
```

That costs the sign-in, the library cache (Apple calls to rebuild) and the extension pairing
token (re-pair needed). Keep the folder for an ordinary reinstall; delete it to test the
first-run path.

If a half-uninstall ever happens again — no registry entry, files still present — the
uninstaller is still on disk and can be re-run, or the folder deleted directly.

## 6. Why there is no updater

`tauri-plugin-updater` would need a signing key pair, a hosted `latest.json`, a public host
for the installer, a capability entry, and a check in the app. The blocker is hosting: the
updater fetches its manifest unauthenticated, so a private GitHub repo cannot serve it.

Deferred on cost/benefit while the user is the only installer. The cheap half — keeping every
shipped setup exe — is already automatic (§1). Revisit when someone else installs the app.

One thing an updater would not escape: it runs the same NSIS installer, so it meets the same
open-file rules, and the `PREINSTALL` hook is what makes that survivable.

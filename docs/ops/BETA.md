---
status: built
desk_test: open
sources: [src-tauri/src/beta.rs, src-tauri/tauri.beta.conf.json, src-tauri/icons-beta/, scripts/beta-icon.ps1, scripts/release.mjs, scripts/release-check.mjs, scripts/archive-installer.mjs, scripts/publish-update.mjs, scripts/cli-dist.mjs, src-tauri/nsis/hooks.nsh, cli/src/main.rs]
updated: 2026-09-23
---
# DeetsMusic Beta — a second app beside the full one

> **Part:** built · 2026-09-23. Decided and built the same day, on `oceanic-schmoves`. Its first job
> is to test Ocean. Not yet done: the spike rows withdrawn (§4.3), the first beta build, the desk
> test (§8), and the DeetsSupport deploy (§5, held by the owner).

**Terms.**
- **Full app** — the installed DeetsMusic that users have. Identifier `com.deetsmusic.app`.
- **Beta** — DeetsMusic Beta. A release build with its own identity, installed beside the full
  app. Identifier `com.deetsmusic.beta`.
- **Dev app** — `npm run dev:app`. It is not installed. It is not the beta (HANDOFF.md).
- **Flavor** — which of the two apps a build is. It is set at build time, never at run time.

## 1. The decisions (2026-09-23, the owner)

| Fork | Choice |
|---|---|
| Data on the first start | Copy once from the full app, then stay separate (§2) |
| Pull on demand | `deetsmusic-beta pull`: the running beta marks the pull and restarts itself. It also works when the beta is closed (§2.2) |
| What the copy takes | Library db + Apple sign-in, settings (settings.json AND localStorage), Last.fm login. **Not** `friends.json` |
| Update channel | Reuse `deetsmusic-test`. The old spike rows stay as relics, marked withdrawn (§4.3) |
| Release flow | Every release goes to the beta first (§4) |
| Version numbers | `0.14.0-beta.1`, `-beta.2` …, then the same code ships as `0.14.0` |
| Look | "DeetsMusic Beta" and a color-shifted icon: teal D, deep teal M (§3) |
| CLI and MCP | Its own `deetsmusic-beta` CLI that reaches only the beta; MCP entry `deetsmusic-beta` (§6) |
| Sign-in | Its own `deetsmusic-beta://` scheme; the sign-in Worker accepts it (§5) |

**Why a new flavor was necessary.** A build on the test channel changed only the channel. It
kept the full app's identifier, install folder, link scheme, Launch-at-startup value and
installer paths. Installing it would have REPLACED the full app and shared its data.

## 2. The copy

`beta.rs` runs at the top of `run()`, before `tauri::Builder`. It must run there: Tauri creates
the config windows BEFORE the setup hook (tauri 2.11 `app.rs` `fn setup`), and each WebView opens
its localStorage when it is created. The log is not open yet, so the lines wait in `NOTES`, and
setup writes them after `log::init` (`beta: first start: copied …`).

A copy is due when the beta has no `deetsmusic.db`, or when the `pull-requested` mark exists.

| What | From (full app) | How |
|---|---|---|
| Library cache | `%APPDATA%\com.deetsmusic.app\deetsmusic.db` | `VACUUM INTO` from a read-only connection (the full app may be running; its newest writes can be in the WAL). Written to a side name, then the beta's old db, `-wal` and `-shm` are removed and the side file takes the name |
| Apple sign-in | `user-token.txt`, `developer-token.json` | file copy |
| Last.fm login | `lastfm-session.json` | file copy |
| Rust settings | `settings.json` | the full app's file, with the beta's OWN `bridgeToken`, `airplayFirewallExe` and `windowPos` put back (dropped on the first start, so the beta makes its own). `autostartSeeded` is set true: the beta never adds itself to Windows start-up |
| Front-end settings | `%LOCALAPPDATA%\com.deetsmusic.app\EBWebView\Default\Local Storage` | the folder, whole, minus the LevelDB `LOCK` file. The beta's folder is removed first |

Never copied: `friends.json` (one friend code is one identity; two apps with it would take each
other's presence), the Song of the Day outlet file (so the beta can never post), the
extension marks, the logs.

The copy writes only inside the beta's two folders. It only reads the full app's.

### 2.1 Why the bridge token stays the beta's own

The CLI finds an app by its token (`settings_tokens()` in `cli/src/main.rs`). If the beta took
the full app's token, `deetsmusic` and `deetsmusic-beta` could each reach the wrong app.

### 2.2 The pull

- **Beta running.** `deetsmusic-beta pull` → `POST /beta/pull`. The route needs the CLI's token
  (a browser Origin is refused) and is not an agent route, so the MCP has no tool for it. The
  beta writes `pull-requested` holding its process id, replies, and calls `request_restart()`.
  Tauri starts the new process BEFORE the old one exits, so the new one waits (up to 10 s) for
  that process id to end. Until it ends, the old db is open and the single-instance lock would
  turn the new process away. Then it copies and opens.
- **Beta closed.** The CLI cannot reach a bridge. It writes the mark (process id 0: nothing to
  wait for) and starts `DeetsMusicBeta.exe` from the folder above the CLI.
- A full build has no `/beta/pull` route and its CLI has no `pull` command.

## 3. Identity

| | Full app | Beta |
|---|---|---|
| productName (Start menu, Installed apps, installer) | DeetsMusic | DeetsMusic Beta |
| mainBinaryName | `DeetsMusic.exe` | `DeetsMusicBeta.exe` |
| identifier / data folders | `com.deetsmusic.app` | `com.deetsmusic.beta` |
| install folder | `%LOCALAPPDATA%\DeetsMusic` | `%LOCALAPPDATA%\DeetsMusic Beta` |
| window titles | DeetsMusic | DeetsMusic Beta |
| icon | `src-tauri/icons/` | `src-tauri/icons-beta/` |
| link scheme | `deetsmusic` | `deetsmusic-beta` |
| Launch-at-startup value (HKCU Run) | `DeetsMusic` | `DeetsMusic Beta` |
| CLI | `cli\deetsmusic.exe` | `cli\deetsmusic-beta.exe` |
| `/health` `app` | DeetsMusic | DeetsMusic Beta |
| log start line | `data dir release` | `data dir beta` |

The overlay is `src-tauri/tauri.beta.conf.json`. `release.mjs --beta` adds the retitled windows
and writes `src-tauri/.tauri.beta.gen.json` (gitignored). Tauri merges an overlay as a JSON merge
patch, so the windows array must be the WHOLE array (the trap `dev-app.mjs` also notes), and
`null` removes the full CLI from `bundle.resources`.

The release check holds the beta's names fixed, the same as the full app's: a pinned beta taskbar
button needs them to stay the same.

**The icon.** `scripts/beta-icon.ps1` turns every hue of `app-icon.png` by 180° and writes
`app-icon-beta.png` (lightness, saturation and alpha stay). Then
`npx tauri icon app-icon-beta.png -o src-tauri/icons-beta` (delete its `android/` and `ios/`).
Run both again whenever `app-icon.png` changes.

## 4. Channel, versions, and the release flow

- The beta ALWAYS reads `deetsmusic-test` (`update.rs` `channel()`). A beta can never take a full
  release, which would install the other app.
- A beta version is `X.Y.Z-beta.N`, and a `-beta.N` version is always a beta. `release.mjs` and
  `publish-update.mjs` both refuse a mismatch in either direction, so the real channel never
  takes a beta build.
- Semver puts `0.14.0-beta.3` before `0.14.0` and `0.14.0` before `0.15.0-beta.1`. The beta
  never needs the final number.

### 4.1 The commands

1. Set `0.14.0-beta.1` in the version files of RELEASE.md §1, **except `extension/manifest.json`**:
   Chrome takes only numbers and dots there, so it stays on the last full version until the
   full release sets it. Run `cargo check` in `cli/` and `src-tauri/` so both lock files follow.
2. `npm run release -- --beta` → the beta CLI (`--features beta`, into `cli/target-beta`),
   `DEETSMUSIC_FLAVOR=beta`, the overlay, the signed build, `release-check --beta`, and the
   archive to `installers/beta/DeetsMusic_0.14.0-beta.1_x64-setup.exe`. The file keeps the plain
   name: it is the name the Worker serves (`update.js` `FILE`).
3. The first time only: install that setup exe by hand. Later betas arrive by the updater.
4. `npm run release:publish -- --beta` → `deetsmusic-test`. Release notes are optional here.
5. When the beta is good: set `0.14.0`, write its notes, then the normal RELEASE.md §0 steps.

### 4.2 Upgrading an old beta

A Tauri NSIS installer keeps the same install folder only while the product name stays the
same. The beta's name is fixed (§3), so each beta installs over the one before.

### 4.3 The spike rows

`deetsmusic-test` still holds `0.4.4-t1` and `0.4.4-t2` in update group 1, the beta's group. They
are live, so the beta's **Other versions…** list would offer them. A spike build has the FULL
app's identity, so installing one would install over the full app. Mark each one withdrawn: the
row and its file stay, and the Worker never offers it.

```
npm run release:publish -- --channel deetsmusic-test --withdraw 0.4.4-t1 --reason "Update spike build, kept as a record"
npm run release:publish -- --channel deetsmusic-test --withdraw 0.4.4-t2 --reason "Update spike build, kept as a record"
```

This writes to R2. It needs the owner's go-ahead.

## 5. Sign-in

The beta registers `deetsmusic-beta://` (the installer writes it from the overlay's deep-link
scheme), and `apple::link_scheme()` answers it. The sign-in page takes the scheme in `s`.
DeetsSupport `src/signin.js` now accepts `deetsmusic(-dev|-beta)`, uncommitted in that repo.
**Held, not deployed (the owner, 2026-09-23).** DeetsSupport holds no sockets, so its deploy
drops no room; the hold is his call, beside the wider question of deploying workers without a
drop ([WorkerDeploy.md](../ideas/WorkerDeploy.md)). Until the deploy, a sign-in started in the
beta shows the "start from DeetsMusic" page. The copy already carries the Apple sign-in, so the
beta does not need to sign in until the user token expires; `deetsmusic-beta pull` refreshes it.

The same Worker change fixes the version order: pre-release tags now compare part by part, with
numbers as numbers. Before it, `0.14.0-beta.10` sorted before `0.14.0-beta.9`.

Last.fm's link back uses the same scheme, so it waits for the same deploy.

## 6. CLI and MCP

- `deetsmusic-beta` is the same crate built with `--features beta`. It reads ONLY
  `com.deetsmusic.beta\settings.json` for its token, so it reaches only the beta.
  `deetsmusic` never reads the beta's token.
- Its MCP server name is `deetsmusic-beta`. Settings › Connections › Copy setup writes that name
  and the beta CLI's path (`settings.rs` `cli_name()`). An AI app can hold both entries.
- The installer stops both CLI names, and matches them by path inside its own folder only.

## 7. What the two apps still share

- **Invite links.** Room and friend invites say `deetsmusic://`. A person who gets one has the
  full app, so this is right. On this PC, a clicked invite opens the full app.
- **Last.fm.** Both apps scrobble. If both play at once, both send.
- **Discord Rich Presence.** Both apps can write to Discord's pipe. Turn it on in one app only.
- **The browser extension.** The beta installer never asks about it. The extension reaches the
  first bridge that answers.
- **Windows media controls.** Each app has its own session.

## 8. Desk test

1. `npm run release -- --beta` passes the release check. The archive is in `installers/beta/`.
2. Install it with the full app, its MCP CLIs and a `dev:app` running. **All of them are still
   running afterwards** (`Get-Process DeetsMusic*,deetsmusic*`, RELEASE.md §4a). The full app
   stays installed, and its Start menu entry is unchanged. The beta has its own Start menu entry,
   a teal icon, and "DeetsMusic Beta" in the taskbar.
3. First start: the beta opens signed in, with your library, theme, skin, surface and Settings.
   The log has `start: … data dir beta` and `beta: first start: copied library, …, localStorage`.
4. Both apps run at once. `deetsmusic status` names DeetsMusic; `deetsmusic-beta status` names
   DeetsMusic Beta.
5. Change a setting in the full app. `deetsmusic-beta pull`. The beta closes, opens again, and
   shows the change. The log has `beta: pull: copied …`.
6. Quit the beta. `deetsmusic-beta pull` starts it, and it has the copy.
7. Settings › Connections: the beta's Copy setup says `deetsmusic-beta`.
8. Launch at startup: turning it on in the beta adds `DeetsMusic Beta` to the Run key and leaves
   `DeetsMusic` alone.
9. After the Worker deploy: sign out of Apple in the beta, sign in again; the browser link comes
   back to the beta, not the full app.
10. Publish `-beta.2`. The beta offers it; the full app does not.

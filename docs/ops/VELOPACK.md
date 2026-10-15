---
status: designed
desk_test: none
sources: [src-tauri/src/velo.rs, src-tauri/src/update.rs, src/updater.ts, src-tauri/tauri.conf.json, src-tauri/src/lib.rs, src-tauri/src/settings.rs, src-tauri/src/bridge.rs, src-tauri/src/mcp_install.rs, src-tauri/src/media.rs, src-tauri/src/beta.rs, crates/mcp-install/src/lib.rs, cli/src/main.rs, scripts/release.mjs, scripts/sign.mjs, scripts/publish-update.mjs, scripts/release-check.mjs]
updated: 2026-10-15
---
# Velopack — updates that swap in place, like Discord's

> **Designed 2026-10-15; spike passed (§8a); BUILT the same day (§12), desk test open, not
> released, the Worker route not deployed.** The scope of a move from
> the NSIS installer and `tauri-plugin-updater` to Velopack. His decisions are §1. Both forks
> are closed (§1). An update took **2.4 s** from the press to the new app (today 8–11 s).
> Today's pipeline is [RELEASE.md](RELEASE.md) §0–§6. The spike code is on branch
> `velopack-spike`, behind `--features velopack`.

## 0. Terms

- **Velopack** — an installer and updater for desktop apps, written in Rust. It replaces
  Squirrel.Windows (Discord's updater). Docs: docs.velopack.io; crate: `velopack`.
- **`vpk`** — Velopack's packing tool (a .NET global tool: `dotnet tool install -g vpk`). The
  .NET 8 SDK is on this PC already (the signing dlib needs it).
- **Package** — one version's files, zipped as a `.nupkg`. A **full** package holds every file;
  a **delta** package holds binary patches against the version before it (Zstandard).
- **Feed** — `releases.<channel>.json`: every version, its package files, sizes and hashes.
- **`current\`** — the folder the app runs from. An update replaces it as a whole.
- **`Update.exe`** — Velopack's own exe at the install root. It applies an update after the app
  exits, starts the app again, and runs the uninstall.
- **Hook** — Velopack starts `DeetsMusic.exe` with `--veloapp-install`, `--veloapp-obsolete`
  (the old version, before an update), `--veloapp-updated` (the new version, after) or
  `--veloapp-uninstall`. The app does its work and exits: 30 s for install and uninstall,
  15 s for the two update hooks, then Velopack kills it. A hook shows no UI and cannot cancel.

## 1. His decisions (2026-10-15)

- **Move to Velopack.** An update must feel like Discord's: press, the app closes, it is back
  in a few seconds, no installer seen.
- **No migration path.** He is the only live user. He uninstalls the NSIS build by hand and
  installs the first Velopack build. Nothing is built to move an NSIS install over.
- The quick NSIS fix (quiet mode, faster hooks) was picked first, then dropped for this.
- **F1 A:** a downloaded update applies at the next start (Velopack's auto-apply), as Discord
  does. *Later* means "at the next start", not "ask again".
- **F2 C:** no extension question at install or on first start. The extension becomes
  experimental and reachable from Settings only ("even I don't use the extension anymore").
  The Settings rows get an *Experimental* mark with the build.
- **Start the spike** (§8), 2026-10-15.

## 2. Today against Velopack

| | Today (NSIS + tauri-plugin-updater) | Velopack |
|---|---|---|
| First install | Wizard: Welcome, close-the-app box, progress, Finish, extension question | One click: a splash, then the app opens |
| Folder | `%LOCALAPPDATA%\DeetsMusic\DeetsMusic.exe` | `%LOCALAPPDATA%\DeetsMusic\current\DeetsMusic.exe` + `Update.exe` |
| Update download | Whole installer (~9 MB), held in memory | A delta package, often a few hundred KB; full on a fallback |
| Update apply | App exits → NSIS passive window → stops the CLIs → writes files → relaunch: **8–11 s** (log, 0.26.0 and 0.26.1) | App exits → `Update.exe` swaps `current\` → relaunch. Target **≤ 3 s**, measured in the spike (§8 S3) |
| Trust | Authenticode on every exe + a minisign `.sig` on the installer, checked against the compiled key | Authenticode on every exe; the feed holds SHA-256 hashes. **No signature on the feed** — we add one (§4) |
| Uninstall | NSIS uninstaller, with a *Delete app data* box | `Update.exe --uninstall` from Installed apps, no UI |

## 3. The install layout

- `--packId DeetsMusic` keeps the root at `%LOCALAPPDATA%\DeetsMusic\`. The exe moves one level
  down to `current\`. `current\` is the same path for every version. So the paths that
  outlive one version stay right: the MCP entries in AI apps (`current\cli\deetsmusic.exe`),
  the start-with-Windows value, the taskbar pin, and the browser extension's unpacked folder
  (`current\extension`).
- Tauri's `resource_dir()` is the exe's folder in a release build. `cli_path()`
  (settings.rs), `bridge.rs`'s extension folder and `mcp_install.rs`'s `.mcpb` path need no
  change. `cli/src/main.rs`'s beta lookup (`exe.parent().parent()`) still lands in `current\`.
- **His one-time moves:** re-run *Set up the DeetsMusic MCP* (the CLI path changes once),
  re-pin the taskbar button, point Chrome's unpacked extension at `current\extension`, and fix
  the hand-added `…\DeetsMusic\cli` on his user PATH.
- `--packTitle DeetsMusic` names the Installed apps entry and the Start Menu shortcut;
  `--packAuthors "Aditya Sundaram"` is the publisher.
- Shortcuts: Start Menu only, as today (`--shortcuts StartMenuRoot`; Velopack's default adds a
  Desktop one).
- **The AUMID** (the Windows app id that the media flyout, the taskbar and notifications use):
  ~~`set_app_user_model_id("com.deetsmusic.app")`~~ — **wrong, found by the spike (§8a).**
  `Update.exe` writes `velopack.<packId>` on the Start Menu shortcut whatever the app sets, so
  a window with another id does not group with its pinned shortcut. The build leaves Velopack's
  default (`velopack.DeetsMusic`) on both. The media flyout reads the name from the shortcut
  (`--packTitle`). `media.rs`'s `is_self` matches `deetsmusic` and passes.
- WebView2: `--framework webview2` installs it when it is missing, as Tauri's NSIS bootstrapper
  does today.
- The deep link: release builds call `register_all()` on every start (lib.rs), so the
  `deetsmusic://` key follows the new exe with no change.

## 4. Trust: the signed feed

Today an update needs two keys: Authenticode on the files, and the minisign `.sig` on the
installer, checked against the public key compiled into the app. A hacked R2 bucket or Worker
alone cannot ship code to an install. Velopack checks each package against the feed's
SHA-256, but nothing signs the feed. A server that is hacked could serve a new feed and a
new package. **We keep the second key** (stop rule: maximum security).

- `release:publish` signs `releases.<channel>.json` with the existing minisign key (the
  password in Credential Manager, §6.6) and uploads `releases.<channel>.json.sig` beside it.
- The app uses its own `UpdateSource` (the crate's trait; `UpdateManager::new_boxed`). It
  fetches the feed and the `.sig`, checks the signature against the compiled public key (the
  `pubkey` that is now in `plugins.updater`), then hands the feed to Velopack. Velopack checks
  each package's SHA-256 against that feed. Chain: key → feed → hash → package.
- The source also refuses a feed entry above the size cap (§6.4, ~50 MB).

## 5. What each part becomes

### 5.1 The app (Rust)
- **`main.rs`:** `VelopackApp::build()…run()` is the FIRST line, before `beta::before_start` and
  before Tauri. A hook start must exit before the single-instance plugin forwards its arguments
  to the running app.
- **Hooks** (the NSIS macros move here, RELEASE.md §3):
  - `on_before_update_fast_callback` (the old version): stop our CLIs by path (the
    `DeetsStopCli` rule, §4a: a running MCP CLI holds `current\cli\deetsmusic.exe`). **The
    spike found that `Update.exe` does this itself** (§8a S4): before and after the swap it
    stops every process whose exe is inside the install root, matched by path. Ours stays as
    a first pass: it runs in the app, before the exit, and it logs the count.
  - `on_before_uninstall_fast_callback`: `mcp uninstall --all --quiet` through the
    `mcp-install` crate directly (it is a crate already), stop our CLIs, remove the
    start-with-Windows value when it points into this install (the `POSTUNINSTALL` rule).
  - `on_after_install_fast_callback`: nothing needed today. It is the place for a first-install
    mark if §10 F2 wants one.
  - `on_restarted`: the update-restart mark, next to queue-persist's `updateRestart`.
- **`update.rs`:** rewritten on `UpdateManager` + the signed source (§4). It keeps its rules
  and its commands (`update_status`, `update_check`, `update_download`, `update_install`,
  `update_versions`), so the front end changes little:
  - one download at a time: Velopack takes a global lock too; ours stays for the status;
  - progress: `download_updates` reports through `Sender<i16>`; forward it as today;
  - install: save, the AirPlay teardown (bounded, as now), then
    `wait_exit_then_apply_updates(asset, silent = true, restart = true, args)`, then exit;
  - a dev build never installs: `UpdateManager::new` fails outside an install, and the
    `cfg(debug_assertions)` guard stays;
  - `set_auto_apply_on_startup` follows §10 F1.
- **Rollback (§6.5):** a second source with a base URL of `…/rollback/<version>`. The Worker
  answers a feed that holds only that version; `UpdateOptions { AllowVersionDowngrade: true }`.
  The Settings list of older versions is unchanged.
- **Channels:** `deetsmusic` and `deetsmusic-test` stay; `vpk pack --channel` and
  `ExplicitChannel` carry them. `DEETSMUSIC_UPDATE_CHANNEL` stays the compile-time switch.
- **Remove:** `tauri-plugin-updater` (Cargo.toml, lib.rs, `plugins.updater` in
  tauri.conf.json; the `pubkey` moves into update.rs), `bundle.windows.nsis`, `src-tauri/nsis/`.

### 5.2 The front end
- `updater.ts`: the states and toasts stay. One wording changes: the restart toast no longer
  implies an installer. *Skip this version*, Ask / Automatic / Off, `minVersion` and the
  rollback list stay as they are.
- §10 F2 decides where the extension question goes.
- The *Delete app data* box leaves with NSIS. Its place is the draft in §11.

### 5.3 The build (`npm run release`)
1. `cli:build`, sign the CLI (as now).
2. `tauri build --no-bundle`: the exe only, no NSIS.
3. Stage the package folder: `DeetsMusic.exe`, `cli\`, `mcpb\`, `extension\` (the list now in
   `bundle.resources` moves into `release.mjs`).
4. `vpk pack --packId DeetsMusic --packVersion <v> --packDir <stage> --mainExe DeetsMusic.exe
   --packTitle DeetsMusic --packAuthors "Aditya Sundaram" --channel <channel> --icon
   icons/icon.ico --splashImage <§11> --framework webview2 --shortcuts StartMenuRoot
   --signTemplate "node scripts/sign.mjs {{file...}}"`. The sign template keeps the one tested
   signing path (Artifact Signing through signtool, §6.9). `--azureTrustedSignFile` is the
   fallback.
5. Deltas: `vpk pack` makes one when the previous full package is in its output folder, so
   `installers/` keeps the last full `.nupkg` (it is gitignored, as now).
6. `release-check` reads the new output: every exe signed (DeetsMusic.exe, the CLI,
   `Update.exe`, Setup.exe), the four version files equal, the feed present, no NSIS left.
7. `archive-installer.mjs` keeps `DeetsMusic-Setup.exe`, the full and delta `.nupkg` and the feed.

### 5.4 Publish (`npm run release:publish`) and the Worker
- R2: `<channel>/velopack/` holds the `.nupkg` files, `releases.<channel>.json` and its `.sig`.
  `<channel>/index.json` stays: the site's release list reads it.
- DeetsSupport `update.js`: a new route serves the feed and the packages from R2, answers before
  `KILL`, honors `KILL_UPDATE`, holds back a withdrawn version by leaving it out of the feed,
  and answers `/rollback/<version>`. The old `/update/<channel>?v=` route stays until the NSIS
  build is gone from his PC, then it goes. **A Worker deploy is his call.**
- The site's download button points at `DeetsMusic-Setup.exe`.

### 5.5 DeetsMusic Beta
- Its own `--packId DeetsMusicBeta`, root `%LOCALAPPDATA%\DeetsMusicBeta\`, its own channel and
  AUMID (`com.deetsmusic.beta`). `beta.rs` reads data folders only, so it needs no change.
  Beta-first is paused (BETA.md), so the beta moves after the full app.

## 6. What leaves with NSIS

| NSIS part | Where it goes |
|---|---|
| `DeetsStopCli`, `CheckIfAppIsRunning` override (§4a) | the before-update and before-uninstall hooks (§5.1) |
| `PREUNINSTALL` MCP removal | the before-uninstall hook, through the crate |
| `POSTUNINSTALL` start-with-Windows | the before-uninstall hook |
| `POSTINSTALL` extension question | §10 F2 |
| Welcome text, sidebar art, installer icon | the splash (§11) and `--icon` |
| *Delete app data* box | §11 draft |
| `scripts/installer-art.ps1`, `nsis/art/` | deleted, or kept for the splash |

## 7. Docs that change

RELEASE.md §0, §1, §2, §3, §4, §4a, §5, §6 (most of it); BETA.md; MCP-INSTALL.md (the CLI path);
EXTENSION.md (the folder); AGENT-SETUP.md (the CLI path); DEBUGGING.md (Velopack's log,
`%LOCALAPPDATA%\DeetsMusic\velopack.log`, into the report area); LOGGING.md; HANDOFF.md;
CLAUDE.md (this doc's line); the docs:check rules that read `hooks.nsh`, if any.

## 8. The spike (before the build)

Done on the test channel, with two builds `0.x.y-t1` and `-t2`, on his PC with the NSIS build
uninstalled.

- **S1** `run()` first in `main` with Tauri, the single-instance plugin and the beta overlay:
  a hook start exits in under 1 s and never reaches the running app.
- **S2** `vpk pack` of a `--no-bundle` Tauri build: Setup.exe installs; `resource_dir`, the CLI,
  the extension folder, the deep link and the media flyout's app name all work.
- **S3** t1 → t2: press → `start:` time from the log. Target ≤ 3 s; today 8–11 s.
- **S4** an update while two MCP CLIs run: the swap does not fail, and only our CLIs stop (by
  path, never by name: the dev build and the other app's CLI keep running).
- **S5** the signed source: a feed with a bad `.sig` is refused; a package with a wrong hash is
  refused.
- **S6** the sign template signs `Update.exe` and Setup.exe; SmartScreen shows the publisher.
- **S7** a delta download: its size, and the fallback to full when the delta is removed.
- **S8** uninstall from Installed apps: the MCP entries, start-with-Windows value and folder go;
  `%APPDATA%\com.deetsmusic.app` stays.

### 8a. Results (run by Claude, 2026-10-15)

**Setup.** Branch `velopack-spike`. `velopack` and `vpk` **1.2.161** (pinned, they must
match). `node scripts/velo-spike.mjs <version>` (removed when `release.mjs` took its steps, §12) built DeetsMusic Beta's identity
(`com.deetsmusic.beta`, its own data, CLI and deep link, so the live app is never touched)
with `--features velopack`, packs it as `DeetsMusicBeta` (title *DeetsMusic Beta VP*, so its
shortcut does not replace the NSIS beta's), channel `spike`, into `installers/velopack-spike/`,
which is also the feed the build reads (`DEETSMUSIC_VELO_FEED`). The spike's main window opens
CDP port 9333, so `update_check`, `update_download` and `update_install` were called from a
script. t1 = `0.27.1-beta.1`, t2 = `0.27.1-beta.2` (a version change only).

**Trap: install from a WMI-started process.** Setup.exe run from Claude's shell lands in
Claude's MSIX container: the files go to `…\Packages\Claude_…\LocalCache\Local\DeetsMusicBeta`
and the registry keys to its private hive (the deep link pointed there). Every install and
uninstall below was started through `Win32_Process.Create`, outside the container
(DEBUGGING.md §Sign-in has the same rule for the registry).

| Test | Result |
|---|---|
| **S1** hook starts | **Pass.** `--veloapp-obsolete` exited in 149 ms, `--veloapp-updated` in 55 ms, while the app ran. The running app logged nothing and kept its process. Inside a real update the `updated` hook took 467 ms (the new exe's cold start). |
| **S2** install | **Pass.** Setup.exe: no wizard, 1.2 s, then the app opened from `…\DeetsMusicBeta\current\DeetsMusicBeta.exe`. The CLI in `current\cli\` answered (`DeetsMusic … Apple Music connected`). The deep link points at `current\`. Installed apps: *DeetsMusic Beta VP*, publisher Aditya Sundaram, `Update.exe --uninstall`. Start Menu shortcut only. **Found:** the shortcut's AUMID is `velopack.DeetsMusicBeta`, not the id the app set (§3 corrected). **Not checked:** the media flyout's name (it needs playback). |
| **S3** update time | **Pass.** Press → new app's `start:` line **2.44 s** (11:40:23.541 → 11:40:25.979); bridge up at 2.50 s. NSIS today: 8–11 s. Split: 0.46 s in the old app (the AirPlay stop, the CLI stop and its 300 ms wait), ~1.5 s in `Update.exe` (wait, extract, both hooks, swap, shortcut), the rest the new app's start. No window of any kind showed. |
| **S4** CLIs during an update | **Pass.** Two spike MCP CLIs and one live-app CLI held open. The app stopped the two spike CLIs (`stopped 2 CLI process(es)`). The live app's CLI, the live app and the dev build kept running. `Update.exe` also checks for processes inside the install root, by path, before and after the swap (it found only itself). |
| **S5** signed feed | **Pass.** A feed changed by one byte: refused, `the feed's signature is not ours`. Both packages changed by one byte: the delta failed, Velopack fell back to the full package, that failed its size check, and nothing was applied. |
| **S6** signing | **Pass.** `vpk --signTemplate` through `sign.mjs` signed Setup.exe, `Update.exe`, the stub exe, `DeetsMusicBeta.exe` and the CLI: all *Valid*, *CN=Aditya Sundaram*. SmartScreen not tried (a local file has no web mark). |
| **S7** delta | **Pass.** t1 → t2 delta: **36 KB** (4 of 37 files patched) against a 15.6 MB full package. Velopack chose the delta (`1 deltas, 36173 bytes to fetch`). Fallback to full: seen in S5. |
| **S8** uninstall | **Pass** (on the real install). 1.3 s. It stopped the app and a spike CLI, and removed the folder, the start-with-Windows value (set by hand for the test), the Installed apps entry and the shortcut. `%APPDATA%\com.deetsmusic.beta` stayed. The beta's MCP was not set up in any AI app, so the removal there was not exercised. |

**Sizes.** Full package 15.6 MB, Setup.exe 23 MB (NSIS setup ~9 MB today: LZMA packs tighter
than the zip in a `.nupkg`). An update is usually a delta, so the size that matters is the
delta's. The first install is 23 MB.

**Other findings for the build.**
- The `start:` log line reads the Cargo version (`0.27.0`), the update status the Tauri config
  version (`0.27.1-beta.1`). The release's four version files keep them equal; the spike set
  only the config.
- `Update.exe` could not open the old app's process to wait for it (*Access is denied*), and
  went on; the app had already exited. Probably the WMI start (a process started from the
  Start Menu is the user's own); recheck on the first real build.
- Velopack's log is `%LOCALAPPDATA%\velopack\velopack_<packId>.log`: for the report area
  (§7).

## 9. Not known yet

- The media flyout's app name under `velopack.DeetsMusic` (S2 above): checked on the first real
  build, with playback.
- Whether the *Access is denied* wait (§8a) happens when the app starts from the Start Menu.
- The query string `HttpSource` adds to the feed request; the signed source fetches its own
  URLs, so this does not block anything.

## 10. The forks (closed 2026-10-15, his calls in §1)

**F1. What *Later* means once an update is downloaded.** He chose A.
- **A (recommended) — it applies at the next start.** Velopack's auto-apply: the next launch
  (a login with `--tray` included) swaps first, then opens. No second toast. Discord works
  this way. Cost: the update happens on a start you did not choose for it, and adds about
  1–2 s to that start.
- **B — the toast asks again at the next start**, as RELEASE.md §6.3 says today
  (`set_auto_apply_on_startup(false)`). Cost: one more toast per update.

**F2. Where the extension question goes** (the NSIS Finish page asks it once per PC today). He
chose C, and the extension becomes experimental.
- **A (recommended) — a toast on the first start after install**, asked once, with the same two
  marks (`extension-connected`, `extension-declined`). Cost: one toast on the first start.
- **B — a step in the first-run walk** (ONBOARDING.md). Cost: it waits for the walk, and Hop in
  is not built.
- **C — no question.** Settings › Connections › Extension install guide stays the way in. Cost: a
  new user may never learn the extension exists.

## 11. Drafts (for him to edit)

- **The splash** (shown while Setup.exe installs, a few seconds): his Deets head on the theme's
  dark background, 400 × 300. HE designs the picture; until then, none.
- **The *Delete app data* row** in Settings › Updates: "Delete my data — sign out and remove
  your library cache, settings and pairing from this PC. Uninstall the app from Windows'
  Installed apps." A confirm toast, then the app removes `%APPDATA%\com.deetsmusic.app` on its
  next exit.

## 12. As built (2026-10-15, branch `velopack-spike`)

> **Part:** built · 2026-10-15 — desk test open (§12.3). Where this differs from §3–§7, this is
> the code.

### 12.1 What changed

- **`src-tauri/src/velo.rs`** — `startup()` first in `run()` (lib.rs): the hooks
  (before-update: `stop_clis`; before-uninstall: `mcp uninstall --all --quiet` through the
  bundled CLI, `stop_clis`, the start-with-Windows value when it points into this install) and
  Velopack's apply-at-start (F1 A). No AUMID override (§3). `SignedSource`: reads
  `<base>/releases.<channel>.json` and `.sig` through the crate's own HTTP (`public-utils`),
  checks the signature against `PUBKEY`, then each asset: our package id, a SHA-256, ≤ 50 MB, a
  plain `.nupkg` name (`check_feed`, pure; `cargo test` holds the unsigned case). Packages
  download through Velopack's `HttpSource`. Rollback reads `rollback/<v>/…?v=<current>` with
  downgrades allowed. `discard()` deletes a downloaded package (Skip). `DEETSMUSIC_VELO_FEED`
  (build time) points a test build at a folder or URL; `release.mjs` refuses it.
- **`update.rs`** — the same commands and `Status` on Velopack; `update_discard` is new. A dev
  build answers "A dev build doesn't update." The size cap and the one-download rule stay.
- **Gone:** `tauri-plugin-updater` (Cargo, lib.rs, `plugins.updater`), `bundle.windows.nsis`
  (`bundle.active` is false), `src-tauri/nsis/hooks.nsh` and `sidebar.bmp`,
  `scripts/archive-installer.mjs`, the `extension-connected` mark in bridge.rs. Kept:
  `src-tauri/nsis/art/` and `scripts/installer-art.ps1` (the sprites, for the splash, §11).
- **`scripts/release.mjs`** — `--no-bundle` → stage → `vpk pack` (signs through `sign.mjs`,
  `--releaseNotes`, `--framework webview2`, `--shortcuts StartMenuRoot`) → sign the feed →
  `release-check`. Output and archive: `installers/velopack/<Id>-<channel>/`. Refuses a `vpk`
  that is not the crate's version.
- **`scripts/release-check.mjs`** — check 3: product + exe names, `PUBKEY` in velo.rs, Setup.exe,
  a signed feed with this version's full package and SHA-256s; check 4: the CLI, the staged exe
  and Setup.exe; check 11: `stop_clis` matches by full path.
- **`scripts/publish-update.mjs`** — to R2 `<channel>/vp/`: packages → `<Id>-<v>-Setup.exe` →
  `rollback/<v>/` feed → the feed (withdrawn versions left out), each feed signed; the index
  row `{ …, file, setup, velopack: true }`. `--withdraw` re-signs the feed without the version.
- **DeetsSupport `src/update.js`** (branch `velopack`, **not deployed**) — `GET
  /update/<channel>/vp/…` for the feed, packages, Setup and the group-checked rollback feed;
  `/releases` links a Velopack row's Setup; `/health` heads its package and Setup; `/versions`
  lists only Velopack versions to a Velopack install. The NSIS route is unchanged, so an NSIS
  install is never offered a Velopack version.
- **Front end** — `updater.ts`: the ready toast says "Restart now, or it installs the next time
  DeetsMusic starts."; Skip calls `update_discard`; the status line says "It installs when
  DeetsMusic next starts"; an install failure says "Couldn't install the update. Try again."
  `settings-card.ts`: *Extension install guide (experimental)* and its hint.

### 12.2 Decided inside his calls (for him to see)

- The wordings in §12.1's front-end line (toasts in TOASTS.md §5).
- The Experimental mark is words in the existing row, not a new tag style.
- The R2 layout `<channel>/vp/`, the Setup name `<Id>-<v>-Setup.exe`, a signed rollback feed per
  version, the feed cache of 60 s.
- A dev build no longer checks for updates (it had checked and downloaded, never installed).
- No splash until he designs one; Setup.exe shows Velopack's default.

### 12.3 Desk test (the beta first)

1. Uninstall the NSIS beta (Installed apps › DeetsMusic Beta). Set `package.json`,
   `tauri.conf.json`, both `Cargo.toml` to a beta version (`0.28.0-beta.1`).
2. `npm run release -- --beta`. Expect `release-check` ok.
3. Run `installers/velopack/DeetsMusicBeta-deetsmusic-test/DeetsMusicBeta-deetsmusic-test-Setup.exe`
   from Explorer. Look at: what the install shows, the time to the app, the Start Menu entry,
   pin it to the taskbar.
4. **His:** deploy DeetsSupport `velopack`, then `npm run release:publish -- --beta`.
5. Bump to `-beta.2`, `npm run release -- --beta`, publish. In the beta: Settings › Updates ›
   Check now → the toast → Restart now. Expect the app back in ~3 s on beta.2, the pin still one
   icon, music position kept.
6. Again with `-beta.3`, and press Later, then quit and start the beta: it starts on beta.3.
7. Skip a `-beta.4` after its download; quit and start: still beta.3.
8. Roll back from Settings › Updates to beta.3 (or the one before).
9. With music playing, the media flyout names the beta.
10. Uninstall from Installed apps: the folder and the entry go; `%APPDATA%\com.deetsmusic.beta`
    stays.

### 12.4 Results so far (run by Claude, 2026-10-15)

- **1.** The NSIS beta uninstalled silently through WMI (`uninstall.exe /S`): the folder and its
  Installed apps entry gone, `%APPDATA%\com.deetsmusic.beta` kept. The four files on
  `0.28.0-beta.1`.
- **2.** `npm run release -- --beta`: built, packed (full package 15.4 MB, Setup.exe 22.9 MB),
  the feed signed. The first run of `release-check` **failed on a wrong check of mine**: `vpk`
  signs copies, so the staged exe stays unsigned. Check 4 now reads the app exe and
  `Squirrel.exe` (installed as Update.exe) out of the full package: both *Valid*, timestamped,
  *CN=Aditya Sundaram*. Then `release-check` ok.
- **3.** Setup.exe through WMI: exited in 1.2 s, the app ready (bridge up) 2.0 s after the launch,
  `start: DeetsMusic 0.28.0-beta.1`, from `%LOCALAPPDATA%\DeetsMusicBeta\current\`. Its old data
  came with it (signed in: *Apple Music connected*). Installed apps: *DeetsMusic Beta*, publisher
  Aditya Sundaram, version shown as `0.28.0` (Velopack drops the pre-release tag there).
  Start Menu: *DeetsMusic Beta.lnk*, AUMID `velopack.DeetsMusicBeta`. The deep link points at
  `current\`. The update check answered **404**, as expected before the Worker deploy. What
  Setup.exe shows on screen: not seen (WMI); his look at the next install.
- **4.** DeetsSupport `velopack` deployed by Claude with his permission (version `aa7e600a`; it
  also shipped `201bd06` and `5907a15`). The old routes unchanged: live 0.27.0 → 204, health
  200. beta.1 published: the feed, its `.sig`, Setup.exe and the rollback feed answer; the site
  list links the Velopack Setup.exe; the app's check verified the real feed: "no update found".
- **5.** beta.2 published (delta **3.5 MB**: the app code changed; the spike's version-only delta
  was 36 KB). **Later (F1 A):** downloaded through the CLI in 2.95 s; the beta closed and started
  again → it came up on beta.2, ready **2.7 s** after the launch (a plain start: 2.0 s).
  **Restart now (his press, beta.2 → beta.3, 3.2 MB delta):** press → new app **1.9 s**
  (13:32:57.584 → 13:32:59.506). Velopack still logged *Access is denied* on its wait and went
  on; that beta.2 was also started through WMI, so a Start Menu start is still unchecked.
- **7. Skip** (beta.4, 4.5 MB delta): the agent's `update skip` (his Allow) deleted the
  downloaded package ("skipped; its downloaded package is deleted"); the next start stayed on
  beta.3. **Fixed first:** the agent's skip had set only the setting, which apply-at-start would
  have ignored; both skips now go through `skipVersion` (updater.ts).
- **8. Rollback** to beta.2 (his press): the full package (15.4 MB) in 2.1 s through the signed,
  group-checked rollback feed; press → beta.2 in **2.3 s**; `packages\` held only beta.2.
  **Found:** at the next start, Automatic downloaded beta.4 (two deltas, 7.7 MB) and would have
  installed it at the start after: the rollback set the skip to beta.3, the version it left,
  which replaced the skip of beta.4 (`updateSkip` holds one version). With NSIS's ask-again
  *Later* this was quiet; with apply-at-start it is an install. **Fixed:** a rollback keeps the
  newer of the old skip and the version it leaves (`rollbackSkip`, `src/update-rules.ts`, with
  `compareVersions`, which now orders `beta.10` after `beta.9`); `tests/update-rules.test.ts`.
  The fix is not in an installed beta yet: the next beta re-runs this step.
- **10. Uninstall** (`Update.exe --uninstall`, as Installed apps runs it, no `--silent`): 12.4 s
  (the spike's silent one: 1.3 s); the folder, the Installed apps entry and the shortcut gone;
  `%APPDATA%\com.deetsmusic.beta` kept; nothing left running.
- **8 again, with the fix (his go, 2026-10-15; Claude pressed the toasts):** beta.5 and beta.6
  built and published, both carrying `rollbackSkip`. Computer use was not available in this
  session, so the beta was started through WMI with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
  adding `--remote-debugging-port` (WMI's environment list replaces the whole block, so the
  current one goes with it), and *Allow* and *Restart now* were clicked in the page's DOM: the
  real toast buttons. Setup.exe `--silent` installed beta.6; the skip cleared (no skip).
  Rollback beta.6 → beta.5 (beta.6's code): 2.6 s, skip = beta.6. Rollback beta.5 → beta.4
  (beta.5's code, the case of the bug): 2.7 s, **skip stayed beta.6** (the old code: beta.5).
  Two starts, 40 s each: the automatic check offered beta.6 and downloaded nothing; both started
  on beta.4; `packages\` held only beta.4. **Passed.** The beta is left installed on beta.4,
  skipping beta.6 (*Check now* still offers it).
- **Open:** what Setup.exe and the uninstall show on screen; the *Access is denied* wait from a
  Start Menu start; the media flyout's name (step 9). The four version files stand at
  `0.28.0-beta.6`, the last published beta.

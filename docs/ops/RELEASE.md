---
status: sop
desk_test: none
sources: [scripts/sign.mjs, scripts/release.mjs, scripts/release-check.mjs, scripts/publish-update.mjs, scripts/cli-dist.mjs, src-tauri/src/velo.rs, src-tauri/src/update.rs, src/updater.ts, src/update-rules.ts]
updated: 2026-10-21
---
# Release, install, uninstall

> **Velopack since 0.28.0 (2026-10-16).** DeetsMusic installs and updates through Velopack: a
> per-user package, no admin prompt, no wizard, and an update that swaps in place in about 2 s.
> The design, the spike and the beta desk test are [VELOPACK.md](VELOPACK.md). Up to 0.27.0 it
> was a hand-built NSIS installer with `tauri-plugin-updater`; that runbook is kept word for
> word in [RELEASE-NSIS.md](../archive/RELEASE-NSIS.md), with the same section numbers. A
> pointer to this doc written before 2026-10-16 about the NSIS hooks, the passive install or
> the 0.4.x spike means that doc.
>
> Code: `package.json` (`release`, `release:check`, `release:publish`), `scripts/release.mjs`,
> `scripts/sign.mjs`, `scripts/release-check.mjs`, `scripts/publish-update.mjs`,
> `scripts/cli-dist.mjs`, `scripts/cred-read.ps1`, `scripts/cred-write.ps1`,
> `src-tauri/src/velo.rs`, `src-tauri/src/update.rs`, `src/updater.ts`, `src/update-rules.ts`,
> `DeetsSupport/src/update.js`.

## 0. The release pipeline at a glance

**Terms.**
- **Package** — one version's files as a `.nupkg`. A **full** package holds every file; a
  **delta** holds binary patches against the version before it.
- **Feed** — `releases.<channel>.json`: each version, its packages, their sizes and SHA-256.
- **Updater key** — a minisign key pair made by `tauri signer`. Its public half is compiled
  into every install (`PUBKEY` in velo.rs). It signs the **feed**; an install refuses a feed
  whose `.sig` does not match (§6.6, VELOPACK.md §4). It protects **updates**.
- **Authenticode signature** — the Windows signature that puts a publisher name on an exe. It
  comes from Azure Artifact Signing. It protects **first installs and trust in Windows** (§6.9).
- **Channel** — `deetsmusic` (real installs) or `deetsmusic-test` (DeetsMusic Beta). Compiled
  into the build; an install only ever sees its own channel.
- **Beta is paused (the owner, 2026-09-24).** Releases go straight to the live channel. When it
  runs: `npm run release -- --beta` on a `-beta.N` version, then
  `npm run release:publish -- --beta` ([BETA.md](BETA.md) §4).

**The commands, in order:**

| Step | Command | What it does | Needs |
|---|---|---|---|
| 1 | set the version, write the notes | the same version in the six files (§1), and a `## <version> — <date>` entry in [RELEASE-NOTES.md](RELEASE-NOTES.md) in the same commit. `vpk pack` puts that entry in the package; publish copies it to the update offer and the website, and refuses to run without it | — |
| 1a | `node docs/ops/checks/smooth.mjs` | **The motion monitor, before every release (his call, 2026-10-18).** Claude runs it: the motion set and the full player, every skin, each clip watched for a flash, a snap, a jitter, a teleport and a row jump ([checks/README.md](checks/README.md) §2a). Then `node docs/ops/checks/smooth.mjs --dev` (since 2026-10-19): the full player on the dev app at his window sizes (portrait, landscape Max, Midi), with no other session driving it and no edits in progress. A hit not in that section's baseline stops the release until its frames are read and it is fixed or added to the baseline with the reason. About 40 minutes on the web demo, so it can run while the build does; the dev run about 12 minutes, after the build. The result goes in the release log's Notes (§0a) | the demo run: nothing (the runner serves the demo itself, its own Vite and headless Edge); `--dev`: `npm run dev:app` running and on screen |
| 2 | `npm run release` | `cli:build` → sign the CLI → `tauri build --no-bundle` → stage the exe and its resources → `vpk pack` (signs every exe through `sign.mjs`; writes the full package, the delta, Setup.exe and the feed) → delete the Portable.zip → sign the feed → `release-check` → copy Setup.exe to `installers/DeetsMusic_<version>_x64-setup.exe` (§1) | both secrets below, the signing tools (§6.9), `vpk` at the crate's version (`dotnet tool install -g vpk --version 1.2.161`) |
| 3 | install + test | `installers/DeetsMusic_<version>_x64-setup.exe`, by hand. **From Claude's shell, start it through WMI** (§4) | — |
| 4 | `npm run release:publish` | uploads the packages, Setup.exe, the version's rollback feed and then the feed to R2 `<channel>/vp/`, each feed signed; adds the row to the channel index; installs start to update (§6.7). Then builds the web demo and commits + pushes it to `../DeetsSolutions` master, which deploys the site (WEB-DEMO.md §9.8) | `../DeetsSupport` checkout, wrangler login; the updater key; `../DeetsSolutions` on master |
| 5 | check the publish | the routes in §0b, *Check a publish* | — |
| 0 | `npm run release -- --beta` then `npm run release:publish -- --beta` | DeetsMusic Beta on `deetsmusic-test`, before step 1 ([BETA.md](BETA.md) §4.1) | the same as step 2 |

**The secrets and keys:**

| Item | Where | Used by | If lost / leaked |
|---|---|---|---|
| Updater private key (encrypted file) | `Documents\Deets' Secrets\deetsmusic-updater.key` + an off-PC copy | `release.mjs` and `publish-update.mjs` → `tauri signer sign` (the feeds) | Lost = no install can update again; runbooks §6.6 |
| Updater key password | Credential Manager `DeetsMusicUpdaterKey` + iCloud Passwords | `release.mjs`, `publish-update.mjs` | §6.6 |
| Azure client secret (`Deets Release Signing`) | Credential Manager `DeetsMusicAzureSigning`. **Expires 2027-03-14** | `release.mjs` → `sign.mjs` | Make a new one in a minute; runbook §6.9 |
| Artifact Signing dlib + `metadata.json` | `%LOCALAPPDATA%\DeetsTools\artifact-signing\` | `sign.mjs` | Download again (§6.9) |
| Build key (one line) | `Documents\Deets' Secrets\deetsmusic-build-key.txt` | `build.rs` → the exe → `X-Deets-Build` on the mint and report intake; the Worker's `BUILD_KEYS` secret | Lost = make a new one and add it to `BUILD_KEYS` (a list) before the next release; leaked = nothing, it was always readable from the exe (§7a) |
| Last.fm API key + secret | `Documents\Deets' Secrets\lastfm.json` | `build.rs` → the exe (`DEETS_LASTFM_KEY` / `_SECRET`); `release-check` fails a build without it | Lost = make a new API account at Last.fm; leaked = readable from the exe anyway, like the build key |
| Cloudflare account (Worker, R2) | wrangler login in `../DeetsSupport` | `release:publish`, the update route | Secure it first in any key incident (§6.6) |

**Why two signatures.** A stolen updater key alone cannot push an update: the attacker also needs
the Worker, R2 or the DNS record. Authenticode gives the installer a publisher name that Windows
and users can check, and it opens a possible second lock (§6.6).


## 0a. What went out (the release log)

One row per build published to the `deetsmusic` channel since the first public one. The text
of each is in [RELEASE-NOTES.md](RELEASE-NOTES.md). "Hand test" is §0 step 3. From the release
after 0.30.0, each row's Notes start with the motion monitor's result (§0 step 1a): "motion: no
new hit", or the hits and what was done.

| Version | Date | Commit | Hand test | Notes |
|---|---|---|---|---|
| 0.4.3 | 2026-09-14 | — | — | the first release on the channel |
| 0.5.0 | 2026-09-15 | `eecec19` | — | `yupdates` fast-forwarded into `main` |
| 0.9.0 | 2026-09-17 | — | — | 7.71 MB |
| 0.9.5 | 2026-09-17 | `7691a66` | — | 7.4 MB |
| 0.10.0 | 2026-09-18 | `5850210` | skipped, his call | rooms, credits, stage column, card memory |
| 0.10.1 | 2026-09-18 | `1ff8c56` | skipped, his call | the ten commits 0.10.0 missed |
| 0.11.0 | 2026-09-18 | `3893ff1` | skipped, his call | Song of the Day, Pins, the bar's sums |
| 0.12.0 | 2026-09-20 | — | skipped | Friends. **Withdrawn**: froze with Discord sharing on |
| 0.12.1 | 2026-09-20 | `d81f312` | skipped | hotfix. **Withdrawn**, same freeze |
| 0.12.2 | 2026-09-20 | `53a5858` | — | the Discord freeze fixed; carries the whole 0.12 line's notes |
| 0.13.0 | 2026-09-21 | `0091992` | skipped, his call (small reach, tested in dev) | the quick panel, the N badges, the docs re-org |
| 0.13.1 | 2026-09-22 | `d86bf00` | skipped, his call ("release and publish"): §0b reads it high risk (player.ts + `np_command` in de31ff7, logging only) | Web in the title bar; `player:pause` names who paused; the web demo |
| 0.14.0 | 2026-09-23 | `62d516a` | skipped, his call ("Desk tests all look good. Publish"): §0b reads it high risk (Rust `NpState.pinned`, np-bus tray commands, the beta flavor) | one right-click menu per media type, Start a Web, the Ocean heavy swell + album light. The first release after beta `0.14.0-beta.2` (published the same day on `deetsmusic-test`) |
| 0.14.1 | 2026-09-24 | `e2d8e3d` | skipped, his call ("Ship as 0.14.1"); the hook commands were tested from a 32-bit NSIS test installer ([RELEASE-NSIS.md](../archive/RELEASE-NSIS.md) §4a) | hotfix: the 0.14.0 update aborted while MCP CLIs held `cli\deetsmusic.exe` (RELEASE-NSIS.md §4a). Beta `0.14.1-beta.1` first. Its notes carry 0.14.0's |
| 0.14.5 | 2026-09-25 | `1e19a9b` | skipped, his call ("good enough to publish all of this"): §0b reads it high risk (Rust `diary.rs` schema v14–v15, `wallpaper.rs`, `favorites.rs`, `bridge.rs`; `player.ts` queue alignment). The features were desk-tested in dev | the Diary card, Full \| Lib, the Glass canvas (Covers / Picture), unreleased songs dimmed, album and playlist favorites, the queue fix. 7.9 MB. **No beta**: beta-first paused from this release (§0) |
| 0.14.6 | 2026-09-25 | `5f1abb5` | skipped, his call ("publish it too please, I've tested adequately"): §0b reads it high risk (Rust: the database thread over 73 commands, `lock_or_recover` everywhere, the watchdog, the AirPlay crate 0.4.1 reconnect; `player.ts` MusicKit retry; the Sound meter). Every part was desk-tested in dev | the AirPlay reconnect, play after an offline start, Adaptive sound hidden, Undo, the database thread, the Glass canvas dim 15. 8.4 MB. The update route answered `latest: 0.14.6` and the installer URL 200 after publish |
| 0.14.7 | 2026-09-26 | `5fe868c` | skipped, his call ("ear test passed, will stress test in live"; "release 0.14.7"): §0b reads it high risk (`player.ts` room clock + settle, `room.ts` Listen Along keep-playing, Friends, Rust `friend_code` + the log label). Claude desk-tested it on two dev apps (FRIENDS.md §18.8, ROOMS.md §18.8) | add friends from a room, Listen Along keeps the host playing, rooms in sync to the millisecond, the Diary's playing-album box. The rooms worker was deployed first (`0561f70f`, 41/41 live). 8.5 MB. The update route answered `latest: 0.14.7`, the health route 0.14.7, and the installer URL 200 after publish |
| 0.14.8 | 2026-09-26 | `b6f1f40` | skipped, his call ("publish it"): §0b reads it low risk (Diary CSS and card render code only; the rest is docs). Claude desk-tested it on the dev app (DIARY.md §4d) | the Diary in a narrow or short card. 8.5 MB. The update route answered 0.14.8 with its notes, the health route 0.14.8, and the installer URL 200 after publish |
| 0.25.0 | 2026-09-26 | `6526b0d` | skipped, his call ("Merge, build and publish", told that six desk tests were his and open): §0b reads it high risk (the settings store's shape — theme and skin moved in, the rule keys; the startup path — `initRules`, the look before the first paint; sharing, `presence.ts` / `friends.ts`; `sound.ts` output presets; `sleep.ts`). Claude desk-tested every step on the dev app and ran the perf comparison (RULES.md §18) | the rules engine: the Grow on album or artist row, the look schedule on rules, the coloured dots (green a rule, red your pick, yellow New). Version jump from 0.14.8, his call ("a big foundational change"). `rules-rulez` fast-forwarded into `main`. 8.5 MB. The update route answered `latest: 0.25.0` with its notes, the health route 0.25.0, and the installer URL 200 after publish |
| 0.25.1 | 2026-09-27 | `1b23fd5` | done, his ("Tested, publish it"): §0b read it high risk (Rust `user_files.rs`, `apple.rs` `apple_check` live, `bridge.rs` rules routes; `player.ts` network-drop recovery and the dead-next heal) | the Rulez card and its recipes, your own pictures and sound clips, the theme crossfade, network-drop recovery, the song-played-twice fix, Discord on stations. 8.6 MB. The update route answered `latest: 0.25.1` with its notes, the health route 0.25.1, and the installer URL 200 after publish |
| 0.25.4 | 2026-10-04 | `96d077d` | skipped, his call ("publish a v0.25.4 for me to install on live"): §0b reads it high risk (`player.ts` the mid-song stall reload and the Play check's order; Rust `airplay.rs` the retune at a song change, `settings.rs` a new key). Neither desk test was run (QUEUE.md §Mid-song stall, AIRPLAY.md §13.4–§13.5) | the mid-song stall reload, the AirPlay stats line and delay memory. Carries 0.25.3's notes: 0.25.3 was built and installed by hand, never published. 0.25.2 (published 2026-09-28, the channel's version before this one) has no row here. 8.8 MB. The health route answered 0.25.4 and the update offer from 0.25.2 carried its notes after publish |
| 0.26.0 | 2026-10-11 | `8377f6e` | skipped, his call (asked, "Publish when built"): §0b reads it high risk (Rust `safe_file` and `settings.rs` per-field reads, twelve file-writing commands off the UI thread, the new `mcp_install.rs` + `crates/mcp-install`, `tray.rs` restore). Two desk tests open (MAX-CARDS.md §7, MCP-INSTALL.md §9) | Layout for Max, Hide cards, MCP setup, the Rulez pass, the quick panel folds, Press at 16⅔ rpm, the title-bar drag. Version jump from 0.25.4, his call. Check 1 failed the first three builds on `crates/mcp-install` panic paths (§0b). 9.2 MB. The health route answered 0.26.0 and the update offer from 0.25.4 carried its notes after publish |
| 0.26.1 | 2026-10-11 | `78e275c` | skipped, his call ("publish please", after Claude stopped on §0b): §0b reads it high risk. The diff is front-end only (the DevTools flag removed), but it turns on the full player for live installs: a cover size change calls `refreshPlayerState()` in `player.ts`, and the Press record swaps its picture | the full player on for everyone. 9.2 MB. The health route answered 0.26.1 and the update offer from 0.26.0 carried its notes after publish. The web demo went to DeetsSolutions master |
| 0.27.0 | 2026-10-14 | `dffa80e` | done, his ("I've thoroughly desk tested so we can push straight to release / publishing"): §0b reads it high risk (Rust `usage.rs`, `lastfm.rs`, `gpu.rs`, the AirPlay sends off the UI thread; `player.ts` unshuffle and the History play; the startup path, `platform.ts`) | usage counts, the Last.fm facts boxes and Presentation mode, the listener counts, unshuffle, History plays from the click, the graphics fallback, one search box, the Full \| Lib switch. The 2026-10-13 build (`e6bffef`) was never published; this one was cut again from `main`. 9.3 MB. The health route answered 0.27.0 and the update offer from 0.26.1 carried its notes after publish. The web demo went to DeetsSolutions master (`3c9c35e`) |
| 0.28.0 | 2026-10-16 | `f4a8013` | done, his (installed by hand from Setup.exe, then "let's publish"): §0b reads it high risk (Velopack replaces the updater: `velo.rs`, `update.rs`; schema v19; `tray-icon` 0.24.2 and the scale-change subclass; the startup path, Max on a new install) | **The first Velopack release.** Updates in about 2 s, a new icon, readable text colors, the primary artist, fewer Apple calls, the window inside the work area, the tray hover text. No migration: a 0.27.0 install is uninstalled by hand (VELOPACK.md §1). Package 14.6 MB, Setup.exe 22.8 MB. The health route, the signed feed and its `.sig`, the rollback feed and the Setup.exe all answered 200 after publish. The web demo first failed on a duplicate key in `demo/handlers.ts` (from `354dcc7`); fixed and pushed (DeetsSolutions `37dc118`). The website first showed the package's 14.6 MB for the Setup.exe; DeetsSupport `75f387a` (deployed the same day) sends `setup_size`, and `/releases` answered 22795744 bytes |
| 0.29.0 | 2026-10-16 | `2721524` | skipped, his call ("publish it actually, i'll test on live. Feel confident across desk testing with beta and dev app"): §0b reads it high risk (package identity: `identity.rs` in Velopack's install / update / uninstall hooks and at each start, `--shortcuts None`, the exe's `<msix>` manifest; Suggest Less schema v20, filter rules schema v21; rooms) | Suggest Less, Library Filter \| Rulez Playlists, rooms with long queues and stations, the quick glyph column, Expand Player, the updates button, New playlist opens Search, **package identity and the city icon** (IDENTITY.md; his desk test §9.2 on live). Package 15.1 MB. The live feed listed 0.29.0 full and delta, with its `.sig`. The web demo first failed: the demo's Vite config had no `virtual:release-notes` (from the updates button, `cabffbb`); the plugin moved to `vite-release-notes.ts` for both configs, and `demo:publish -- --push` went out. His one move: pin the new button, unpin the old one |
| 0.30.0 | 2026-10-18 | `4bfcba6` | skipped, his call ("mint a new release, 0.30.0 which we can publish directly"): §0b reads it high risk (`player.ts` the license heal and the end-stall watch, `license-watch.ts` cuts a hung license request; Rust `notes.rs`, `display.rs`, the AirPlay stall watch on a Tokio task, crate 0.4.2; Rewind schema v22) | Apple's album notes, the song facts box on Song Credits, *Notes from*, the Diary renamed Album Reviews, the card reveal in reading order, the license and end-stall heals, Spin FPS, the Rewind sweep fixes, the full player's four edges in Max. `v-thirty` fast-forwarded into `main`. Package 15.9 MB, Setup.exe 23.5 MB. The health route answered 0.30.0; the signed feed (full and delta from 0.29.0), its `.sig`, the rollback feed and a HEAD of the Setup.exe answered 200; `/releases` had 0.30.0 as `latest` with size 23471416, the Setup.exe's bytes. The web demo went to DeetsSolutions master |
| 0.31.0 | 2026-10-21 | `869c581` | skipped, his call ("let's publish 0.31.0 please"): §0b reads it high risk (Rust `gpu.rs` the quiet restart while hidden, `net.rs` the ping, `tray.rs`, `airplay.rs`, `apple_calls.rs`; `fetch-wrap.ts` on every fetch; `player.ts`; the startup path, `main.ts`). His four desk tests passed 2026-10-20 (WORKLOG.md) | **motion: not run.** The demo run (2026-10-21 01:28) stopped on its first clip (`no Page.loadEventFired in 90000 ms`); `--dev` last ran 2026-10-19. Metal, the Rewind and Network buttons in the Max title bar, the graphics card back by itself and *Reduce motion*, the card grow shell, the full player's grow in Max. `v-thirtyone` fast-forwarded into `main`. Packed 2026-10-20, published the next day from `869c581` (checked out for the publish, so the web demo carries no later commit). Package 16.0 MB, Setup.exe 23.6 MB. The health route answered 0.31.0; the signed feed (full and delta from 0.30.0), its `.sig`, the rollback feed and a HEAD of the Setup.exe answered 200; `/releases` had 0.31.0 as `latest` with size 23554832, the Setup.exe's bytes. The web demo went to DeetsSolutions master |
| 1.0.0 | 2026-10-23 | `4e6fa3e` | his call ("Commit merge and push, then publish"): §0b reads it high risk (the startup screen, the CSP enforced, the tray, Happy, the first sign-in's sync order, the extension out of the bridge). He ran 0.99.0, the same code with the enforced CSP, on his PC that day: no `csp-` block lines in its log; every desk test passed (his word) | **motion: the demo run passed by an A/B against 0.31.0, no new fault; `--dev` skipped, his call** ([the checks archive](checks/README.md) §2a, *The 1.0.0 run*). **The first public release.** 0.32.0 and 0.99.0 were never published: the package folder was put back to the live feed (0.28.0 … 0.31.0), so the delta is from 0.31.0 (6.6 MB; it removes only the parked extension's 31 files). **Update group 2**: no rollback to a 0.x version. Notes: his three lines. `grand-opening` fast-forwarded into `main`, both pushed. Package 14.8 MB, Setup.exe 23.1 MB. `/releases` had 1.0.0 as `latest` with size 23098800, the Setup.exe's bytes; the signed feed (1.0.0 full and delta, then 0.31.0), its `.sig`, the 1.0.0 rollback feed, both packages and a HEAD of the Setup.exe (`/vp/DeetsMusic-1.0.0-Setup.exe`) answered 200; `versions?v=1.0.0` answered group 2 and no versions; a rollback to 0.31.0 from 1.0.0 answered 404 (the target and its rollback feed); the health route answered ok. The web demo went to DeetsSolutions master (`1b1886b`); the site's demo answered 200 |

### 0b. When Claude may publish without the hand test (his rule, 2026-09-21)

Step 3 (the hand install test) may be skipped, and Claude publishes on its own after
`npm run release`, **only when every change since the last published version is low risk to
the app's integrity**: no hang, no freeze, and music still plays. A UI-only change is low
risk. Read the whole diff from the last row of §0a, not only the commit messages.

**High risk — stop, do not publish, and tell him it needs a hand test:**
- any Rust change that runs in the app (`src-tauri/src/`, `crates/`), above all a
  `#[tauri::command]`, a thread, a lock, a pipe or a socket (0.12.0 froze this way);
- playback: `player.ts`, `queue.ts`, MusicKit calls, the audio graph (`sound`, AirPlay, vinyl
  clock), the media keys;
- anything networked that runs by itself: rooms, Friends, Discord, Last.fm, the updater
  (`velo.rs`, `update.rs`, `updater.ts`);
- the database schema or migrations, the settings store's shape, the startup path;
- a feature whose own desk test was never run where it could reach playback (rooms 0.10.0 is
  the example: it was never tested with two apps).
- the fetch wrap (`src/fetch-wrap.ts`, speedtest.md §6): it sits under every MusicKit request,
  so a release that changes it runs `node docs/ops/checks/fetch-wrap.mjs` on `dev:built` first
  and is never published without his hand test.

**Low risk — publish, then report:** CSS, tokens, markup and render code of a card or panel,
hover hints, wording, docs, scripts that do not ship.

When in doubt, it is high risk. The report names the version, the risk call and why, and the
checks run (*Check a publish*, below).

What the log taught:
- **A withdrawal is not a fix.** The updater offers only a NEWER version, so an install
  already on a withdrawn build is offered nothing until a hotfix ships. Withdrawn rows stay on
  the website with their reason (which users read, so he picks the wording).
  `release:publish -- --withdraw <v>` also signs the feed again without that version (§6.7).
- **A withdrawn version's notes never reach an update offer.** The release that replaces it
  carries the whole line's notes (DOCS-ORG.md §12 is the real fix; not built).
- **The signing service fails now and then.** A single signing failure during `vpk pack` means
  nothing; run `npm run release` again before you dig (§6.9).
- **A release deploys no worker.** After a theme, skin, palette or font change, run
  `npm run signin:assets` and deploy DeetsSupport by hand. After any worker deploy, curl the
  route: `node --check` passes an unresolved import that returns 1101 live.
- **A path crate outside `src-tauri/` puts its panic sites' full paths in the exe** (0.26.0,
  2026-10-11: `crates/mcp-install` failed check 1 three builds running). Cargo gives a crate
  outside the package an absolute source path, so every `x[i]`, `doc["key"]`, `.unwrap()` and
  `json!({ "k": expr })` (it unwraps the expression) in non-test code leaks it. Use `get`,
  `split_first` and `?`, and build a JSON object by hand when a value is not a literal.
- **The web demo can fail after a good publish** (0.28.0: a duplicate key in
  `demo/handlers.ts` failed its `tsc`). The publish stands; fix it and run
  `npm run demo:publish -- --push`. Run `npx tsc --noEmit -p demo` before a release that
  touched `demo/`.
- **Check a publish** (base `https://music-api.deets.solutions/update/deetsmusic`):
  `/health` names the new version; `/vp/releases.deetsmusic.json` and its `.sig` answer 200;
  `/vp/rollback/<v>/releases.deetsmusic.json?v=<v>` answers 200; `/releases` has the new
  version as `latest`, its `url` on `/vp/DeetsMusic-<v>-Setup.exe` and its `size` equal to the
  Setup.exe's bytes; a `HEAD` of that URL answers 200.
- **An NSIS install (0.27.0 and older) is never offered a Velopack version.** Its updater asks
  the old route, which answers from NSIS rows only: 204 to 0.27.0, an offer of 0.27.0 to an
  older one. Moving to 0.28.0 is a hand install (§4b).

## 1. Cut a build

**Six files hold the version**, and all six are checked (since 2026-09-26). The browser
extension's `extension/manifest.json` was a seventh until it left v1 (2026-10-23, EXTENSION.md,
parked); leave it alone.

| File | Checked by | If it is stale |
|---|---|---|
| `package.json` | `release-check` | `vpk pack --packVersion` reads it; caught |
| `src-tauri/tauri.conf.json` | `release-check` | the app's own version (Settings, the update check) reads it; caught |
| `src-tauri/Cargo.toml` | `release-check` | caught. The `start:` log line reads it |
| `cli/Cargo.toml` | `release-check` | caught. It is what `deetsmusic --version` and the MCP server info report |
| `src-tauri/Cargo.lock` + `cli/Cargo.lock` | `docs:check` check 5 (so `npm run check` and the pre-push hook) | cargo rewrites them during the build, so the release is fine but the tree is left dirty and the version commit is incomplete |

Bump the manifest by hand, and run `cargo check` in `cli/` and in `src-tauri/` before the
version commit, so both locks are in it rather than in the next one.

```bash
npm run release     # secrets → cli:build → sign cli → tauri build --no-bundle → stage → vpk pack (signs) → sign the feed → release-check → the versioned copy
```

`scripts/release.mjs` runs the stages, and the order matters:

0. **Read the secrets first** — the updater key file and password (§6.6) and the Azure client
   secret (§6.9). A missing one fails here, before the slow build. It also refuses a `vpk` that
   is not the velopack crate's version, and a version that does not match `--beta`.
1. **`npm run cli:build`** — `cargo build --release` on `cli/`, then `scripts/cli-dist.mjs`
   stages the exe at `cli/dist/deetsmusic.exe`, where `bundle.resources` expects it.
2. **Sign the CLI** — `scripts/sign.mjs` on `cli/dist/deetsmusic.exe`. It is a resource, and
   resources are not signed by the build.
3. **`tauri build --no-bundle`** (`bundle.active` is false): the front end into the exe, no
   installer. tauri-build still copies `bundle.resources` next to the exe.
4. **Stage** — `src-tauri/target/velopack-stage/` gets the exe and every resource
   (`cli\`, `mcpb\`; the beta's map drops the full CLI). Then
   **`scripts/identity-pack.mjs`** adds the signed identity package `DeetsMusic.identity.msix`,
   its logos (`Assets\`) and `resources.pri` (IDENTITY.md §3.1; `makepri` and `makeappx` from
   the Windows SDK, signed by `sign.mjs`).
5. **`vpk pack`** into `installers/velopack/<Id>-<channel>/`, with `--signTemplate` calling
   `sign.mjs` on every exe it packs (§6.9), `--releaseNotes` from RELEASE-NOTES.md,
   `--framework webview2`, `--shortcuts None` (since 2026-10-16: the identity package is the
   Start entry, IDENTITY.md §3.5), `--channel`. The previous full package
   in that folder makes the delta. Then the Portable.zip that `vpk` always writes is deleted:
   nothing publishes it.
6. **Sign the feed** `releases.<channel>.json` with the updater key (`tauri signer sign`).
7. **`scripts/release-check.mjs`** — the gate (§1a). It reads the Velopack output: no repo
   paths in the exe; the versions agree; **no dev telemetry in the shipped JS** (check 5: a
   stray `VITE_PERF` in the release environment would ship a rAF loop and a log-writing
   observer to every user); the product and exe names unchanged (the taskbar pin), `PUBKEY` in
   velo.rs, Setup.exe present, a signed feed with this version's full package and SHA-256s
   (check 3); the CLI, the app exe and `Update.exe` (read out of the full package) and
   Setup.exe signed (check 4); `TOKENS.md` current; the Last.fm and build keys built in;
   **no synchronous `#[tauri::command]` that blocks the UI thread** (check 9); the docs check
   (check 10); `stop_clis` matching by full path (check 11).
   - Check 9 (2026-09-20): a sync command runs on the thread that paints, so a wait in one
     freezes the window (FRIENDS.md §8.11). It walks calls three deep, follows `crate::x::f(`
     and `x::f(` into other modules (2026-10-13: the walk had stopped at `bridge.rs`, so
     `np_publish` froze the window 6 s in a LAN drop, AIRPLAY.md §13.6), counts a send on the
     AirPlay session as a blocker, and skips bodies handed to `spawn` / `spawn_blocking`.
     `log.rs:append` is allowed, as `log_event` is. It also names a sync command that takes
     `db.lock()`; the fix for that one is `crate::db_thread::run`, not `spawn_blocking`: one
     thread in arrival order, so two quick writes cannot swap (DB-HEALTH.md §2a). A BLOCKERS
     row may carry `{ soft: true }` to warn instead of fail while a sweep is under way.
8. **The versioned copy** — Setup.exe to `installers/DeetsMusic_<version>_x64-setup.exe` (a
   beta's to `installers/beta/`), only after the check passed (§1b).

Publishing is a separate command, run after the installed build is tested (§6.7).

**Before a Worker deploy that follows a theme, skin, palette or font change:** run
`npm run signin:assets` here, then `npx wrangler deploy` in `../DeetsSupport`. The hosted
sign-in page (DATA-ARCHITECTURE.md §2a) serves a COPY of the app's look, and the copy is
only as fresh as the last run. The app never needs the Worker for a release; the Worker
needs the app's look.

## 1a. Stranger parity — the live app must behave like a stranger's install (2026-09-13)

**What slipped.** The installed 0.3.1 on the dev PC logged `token: source=local`: it read the
repo's MusicKit key through a compile-time source path, never used the Worker or its 401 heal,
and broke when that key was rotated. The fallback was documented as intended, so no code
review or diff-based release check would have flagged it. Only runtime evidence from the
installed build showed it. Three layers now guard this:

1. **Structural.** Anything that reads the source tree is compiled out of release builds with
   `#[cfg(debug_assertions)]` — not a runtime `cfg!` check — so the path string is not in
   the exe at all (`apple.rs` `repo_secrets_dir`).
2. **Automated gate.** `npm run release` runs `scripts/release-check.mjs` after the pack
   and the feed signature, and before the versioned copy (§1 step 7). It fails when the exe
   contains an absolute path into the repo (build output under `src-tauri\target\` is
   allowed), when the version files disagree, when the pin settings changed, `PUBKEY` is
   missing or the feed is unsigned, or when the CLI, the app exe, `Update.exe` or Setup.exe
   lacks a Valid, timestamped Authenticode signature from `bundle.publisher` (§6.9).
   Run it alone with `npm run release:check`.
3. **Checklist on the INSTALLED build — when relevant, not on every release.** Run it before
   any key change, and before a release whose changes touch these paths or the code next to
   them: sign-in and sign-out (`apple.rs` auth, `main.ts` Account, the hosted sign-in page),
   the developer token and the Worker (`ensure_developer_token`, the 401 heal), MusicKit
   configure and authorization, Apple health and the offline or reconnect handling, and
   anything that reads the source tree or secrets. A release of UI-only work (drag and drop,
   cards, settings rows) can skip it; the automated gate above still runs. When in doubt, run
   it. Read the installed log (Settings › Bugs › App log):
   - [ ] the `start:` line shows the new version, and the next line is `token: source=worker`;
   - [ ] sign in from zero (Account › sign out, then sign in) — the page loads, Apple accepts;
   - [ ] signed out, press play → "Sign in to Apple Music to play songs." with **Sign in**;
   - [ ] launch offline → the offline toast, and recovery when the network returns;
   - [ ] **first release with Last.fm (then after any change to `lastfm.rs` or the key):** connect
     Last.fm from zero and check the link back — [LASTFM.md §9 "OPEN"](../integrations/LASTFM.md). Needed once:
     the dev test (2026-09-16) connected by the checks alone, without the link;
   - [ ] **Do NOT force a revoke with `__music.unauthorize()`.** It calls MusicKit's
     `_webPlayerLogout`, which logs the sign-in token out AT APPLE (2026-09-13: the token went
     from 200 to 403 on `/v1/me/storefront`, and it was the same token the installed app used,
     so the live app was signed out too). A revoke test needs a method that clears only
     MusicKit's local copy, and never a token copied from the installed app. Not built yet.

   A second Windows user account (no repo, no app data) is the cheapest real stranger; not
   set up yet.

### Key changes (rotation, revoke) — runbook

Written after the 2026-09-13 rotation, where the revoke broke the installed app because its
token source had not been checked first.

1. **Before anything:** read every live app's log for its token source (`token: source=…`).
   A `local` line in an installed build is a bug — stop and fix it first (§1a).
2. Create the new key in the Apple portal. Copy the `.p8` to `Documents\Deets' Secrets` and
   note its id and purpose in that folder's README. **Never delete a `.p8`.**
3. Put it in the Worker without echoing it: `npx wrangler secret bulk <temp json file>`
   (sends `APPLE_P8` + `KEY_ID` together, so the Worker never pairs a new key with an old id;
   delete the temp file in a `finally`). A PowerShell pipe into `secret bulk` does not work.
4. Verify with status codes only: `/health` ok; a fresh `/token` has the new `kid`; Apple
   answers 200 to it several times in a row.
5. **Only then** revoke the old key. Expect Apple to answer inconsistently for 15+ minutes
   after a revoke (seen 2026-09-13: 200/401 flipping for every key on the team, including a
   brand-new one). Watch with a status-only loop before declaring it done.
6. Re-check each live app: the log shows a `token: 401 … refetching` line followed by a
   successful play, with no restart.

## 1b. The installers folder (his calls, 2026-10-16)

`installers/` is **gitignored**. His calls: the whole history is kept, and the top level reads
by version.

- **The top level** — `DeetsMusic_<version>_x64-setup.exe` for every release, one sorted list:
  the NSIS installers (each with its updater `.sig`) up to 0.27.0, then Velopack's Setup.exe from
  0.28.0 (no `.sig`: the feed carries the signature now). `release.mjs` copies each Setup.exe
  here under its version, because `vpk` names it by channel only and overwrites it on the next
  build. A beta's copy goes to `installers/beta/`, so the top level holds real releases only.
- **`velopack/<Id>-<channel>/`** — `vpk`'s own folder: every full and delta `.nupkg`, the latest
  Setup.exe, the feed and its `.sig`. It is the base of the next delta. **Never prune it:**
  `release:publish` copies this local feed into the live one, so a package deleted here leaves
  the live feed too.

The test builds (`dev/`, `beta/`, `velopack-spike/`) were deleted on 2026-10-16; none reached
live. R2 holds every published version as well; the local folder is the copy that survives a
lost bucket, and `src-tauri/target/` is not one (`cargo clean` takes it).

## 2. What ships inside

Since Velopack the app files sit in `current\` under the install root; `current\` is the same
path for every version (VELOPACK.md §3).

| Path after install | Source | Notes |
|---|---|---|
| `current\DeetsMusic.exe` | `src-tauri` release build | The app. `mainBinaryName` in `tauri.conf.json` — without it the exe takes the Cargo package name. |
| `current\cli\deetsmusic.exe` | `cli/dist/` via `bundle.resources` | The agent CLI + MCP server ([AGENT.md](../integrations/AGENT.md)). |
| `current\mcpb\deetsmusic.mcpb` | `mcpb/dist/` via `bundle.resources` | The Claude Desktop extension that *Set up the DeetsMusic MCP* installs ([MCP-INSTALL.md](../integrations/MCP-INSTALL.md), 0.26.0). |
| `Update.exe` | Velopack | Applies updates, and is the uninstaller Installed apps runs (`Update.exe --uninstall`). |
| `DeetsMusic.exe` (root) | Velopack | A stub that starts `current\DeetsMusic.exe`. |
| `packages\` | Velopack | The current full package and a downloaded update waiting for the next start. |

Every exe above (and the setup exe) carries an Authenticode signature from *Aditya Sundaram*,
from the first release after 0.4.3. Check one with **Properties › Digital Signatures**, or
`Get-AuthenticodeSignature`.

Install root is `%LOCALAPPDATA%\DeetsMusic` (per user, the same root as the NSIS
installs up to 0.27). Velopack's log is `%LOCALAPPDATA%\velopack\velopack_DeetsMusic.log`. User data lives
elsewhere and survives: `%APPDATA%\com.deetsmusic.app` holds `deetsmusic.db`,
`user-token.txt`, `settings.json`, `deetsmusic.log`, `developer-token.json`, the user's own
pictures and sounds (`files\`), and the Friends and Song of the Day files
(DATA-ARCHITECTURE.md §8).

## 3. The Velopack hooks

Velopack starts `DeetsMusic.exe` with one argument at four moments: `--veloapp-install`,
`--veloapp-obsolete` (the old version, before an update), `--veloapp-updated` (the new version,
after) and `--veloapp-uninstall`. `velo.rs` `startup()` is the first thing `run()` does
(lib.rs), so a hook start does its work and exits before Tauri and the single-instance plugin
start. A hook shows no UI and cannot cancel; Velopack kills it after 30 s (install, uninstall)
or 15 s (the two update hooks).

- **Before an update** (the old version): `stop_clis` stops our CLIs in `current\cli\`, by full
  path, and logs the count. `Update.exe` also stops every process whose exe is inside the
  install root, by path, before and after the swap (VELOPACK.md §8a S4); ours runs first, in
  the app, before the exit.
- **Before an uninstall:** `mcp uninstall --all --quiet` through the bundled CLI (our MCP entry
  leaves every AI app), `stop_clis`, and the start-with-Windows value is removed when it points
  into this install.
- **After an install, after an update:** nothing. The browser extension is not shipped since
  2026-10-23 (EXTENSION.md, parked); an update removes the old `current\extension\`. The song
  comes back after an update because the app writes it before it exits (`flushForRestart`,
  queue-persist, §6.3), not through a hook.

**Why the CLIs must stop.** Windows will not replace or delete a file a process holds open, and
the CLI is long-lived in practice: `deetsmusic mcp` serves an MCP session for as long as the AI
app runs. A held `current\cli\deetsmusic.exe` would fail the swap. Under NSIS this caused a
half-uninstall (0.1.2) and an aborted update (0.14.0): [RELEASE-NSIS.md](../archive/RELEASE-NSIS.md)
§3 and §4a.

**Start with Windows.** The app writes the value (`settings.rs` `autostart_write`). An update
keeps it: `current\` is the same path for every version. The uninstall hook removes it. The
app's `autostart_seeded` flag is in the app data, so a reinstall that keeps the data does not
turn start-with-Windows on again. **Desk test:** install, check the value
(`reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v DeetsMusic`), update (the
value stays), then uninstall (the value is gone).

## 4. Install

Run `installers/DeetsMusic_<version>_x64-setup.exe` (the website serves the same file as
`DeetsMusic-<version>-Setup.exe`). No wizard, no admin prompt: it unpacks for about 1–2 s,
adds the Start Menu entry and the Installed apps entry, and opens the app. Velopack's default
screen shows meanwhile (no splash is set; VELOPACK.md §11). WebView2 is installed first when it
is missing (`--framework webview2`).

- **From Claude's shell, start it through WMI** (`Win32_Process.Create`), or it lands in
  Claude's MSIX container (VELOPACK.md §8a). To drive the installed app over CDP, add
  `--remote-debugging-port` through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` in the WMI
  environment (VELOPACK.md §12.4).
- The Setup.exe and every exe in the package are **Authenticode-signed** by *Aditya Sundaram*
  (§6.9). **SmartScreen checks only files with the web mark** (a browser download). A locally
  built Setup.exe and an update carry no mark, so they never show it. A browser download can
  still warn until the publisher builds download reputation for that version; the steps for
  each browser are on the website and in [RELEASE-NOTES.md](RELEASE-NOTES.md)'s header.
- **`npm run tauri dev` and the installed app share `%APPDATA%\com.deetsmusic.app`** (same
  identifier). Anything a dev run writes to `settings.json` the installed build reads. Use
  `npm run dev:app` (own identifier) when testing anything that seeds a one-shot state.
- **Secrets**: a release build reads no local MusicKit key. It takes its developer token from
  the mint, as a stranger's install does (§1a, §7; `apple.rs`, "debug builds only", since
  2026-09-13). Only a debug build reads `apple.json` + the `.p8`, from the app data dir or the
  repo.

### 4a. What an update and an uninstall stop

**The rule: by full path inside this install, never by name.** Several related processes run
on this PC at once: the full app, DeetsMusic Beta ([BETA.md](BETA.md)), the dev build, and a
`deetsmusic` CLI for every AI app that has the MCP open. An update or an uninstall must stop
only its own. The code is `velo.rs` `stop_clis` (§3); `Update.exe` keeps the same rule for the
install root.

| App | Stops | Leaves running |
|---|---|---|
| Full app | its own exe and the CLIs in `%LOCALAPPDATA%\DeetsMusic\current\cli\` | the beta, the dev build, CLIs anywhere else |
| Beta | its own exe and the CLIs in `%LOCALAPPDATA%\DeetsMusicBeta\current\cli\` | the full app, the dev build, CLIs anywhere else |

**What still stops.** An update of an app stops ITS OWN CLIs: Windows will not replace an exe
that a process holds open. An AI app that had that CLI open loses its DeetsMusic tools until it
starts them again.

**The gate.** release-check 11 fails the build when `stop_clis` no longer matches by the full
path under `cli\`. The NSIS installer killed by name and took the dev build and every MCP CLI
with it (2026-09-23); the history and its fix are [RELEASE-NSIS.md](../archive/RELEASE-NSIS.md)
§4a.

**Desk test.** With the full app, its MCP CLIs and a `dev:app` running, update the beta. All of
them are still running afterwards (`Get-Process DeetsMusic*,deetsmusic*`).

### 4b. Moving from an NSIS install (0.27.0 and older)

There is no migration path (his call, VELOPACK.md §1). An NSIS install is never offered a
Velopack version (§0b), so it stays on 0.27.0. To move:

1. Settings › Apps › Installed apps › DeetsMusic › Uninstall. **Leave *Delete app data* off.**
2. Run the 0.28.0 (or newer) Setup.exe from `deets.solutions/deetsmusic/`.

The library, settings and pins stay: they are in `%APPDATA%\com.deetsmusic.app`, not in the
install folder. The exe moves from the install root to `current\`, so a few things that hold
the old path need one hand step (VELOPACK.md §3): run *Set up the DeetsMusic MCP* again (the
CLI path changed), pin the taskbar button again, and fix a hand-added `…\DeetsMusic\cli` on the user PATH.

## 5. Uninstall

Settings › Apps › Installed apps › DeetsMusic › Uninstall. It runs
`"%LOCALAPPDATA%\DeetsMusic\Update.exe" --uninstall` (add `--silent` for no UI) and asks no
questions. The uninstall hook (§3) removes our MCP entry from the AI apps, stops the CLIs and
removes the start-with-Windows value; Velopack stops what runs in the folder and deletes it,
the shortcut and the Installed apps entry (1.3 s silent, 12.4 s from Installed apps;
VELOPACK.md §12.4). There is no *Delete app data* box: the row that would replace it is a draft
for him (VELOPACK.md §11).

User data is **not** part of the install root, so the uninstall leaves it. Remove it
deliberately:

```bash
rm -rf "$APPDATA/com.deetsmusic.app"
```

That costs the sign-in and the library cache (Apple calls to rebuild). The bridge token is
new too; the CLI and the MCP read it from the file, so nothing needs to pair. Keep the folder for an ordinary reinstall; delete it to test the
first-run path (or use `npm run dev:fresh`, ONBOARDING.md).

## 6. The updater

> **Velopack since 0.28.0** (built 2026-10-15, VELOPACK.md §12; beta desk test passed §12.6;
> live 2026-10-16). Code: `src-tauri/src/velo.rs` (the hooks, `SignedSource`, the feed checks),
> `src-tauri/src/update.rs` (the commands and the status), `src/updater.ts` (Settings ›
> Updates and the toasts), `src/update-rules.ts` (pure: `compareVersions`, `rollbackSkip`),
> `scripts/release.mjs`, `scripts/publish-update.mjs`, and `DeetsSupport/src/update.js`.

**How an update travels:** `npm run release` signs every exe (Authenticode) and the feed (the
updater key) → `release:publish` puts the packages, Setup.exe, the version's rollback feed and
the feed in R2 `<channel>/vp/`, and a row in `<channel>/index.json` → the app's `SignedSource`
reads `GET music-api.deets.solutions/update/<channel>/vp/releases.<channel>.json` and its
`.sig`, checks the signature against `PUBKEY`, then checks each entry (our package id, a
SHA-256, under the size cap, a plain `.nupkg` name) → Velopack downloads the delta (or the full
package) and checks its SHA-256 → *Restart now* hands the swap to `Update.exe`, and the new app
is back in about 2 s (1.9–2.4 s measured); *Later* means the next start applies it. A dev build
has no install and does not check ("A dev build doesn't update.").

### 6.1 Terms

- **Signed feed** — the feed plus `releases.<channel>.json.sig`, a minisign signature by the
  updater key. Chain: key → feed → SHA-256 → package.
- **Rollback feed** — `rollback/<version>/releases.<channel>.json` (+ `.sig`): a feed that
  holds only that version's full package, the target of a rollback to it.
- **Channel group** — a set of versions that share a compatible cache database (§6.5).
- **Apply at start** — a downloaded package waits in `packages\` and is installed the next time
  the app starts (his call, VELOPACK.md §1 F1 A).

### 6.2 Host — a Worker route + R2

- **The routes** (`DeetsSupport/src/update.js`), all under `music-api.deets.solutions/update/<channel>`:
  - `/vp/releases.<channel>.json` and `.sig` — the feed every install reads (cached 60 s);
  - `/vp/<Id>-<v>-<channel>-full.nupkg` and `-delta.nupkg` — the packages;
  - `/vp/<Id>-<v>-Setup.exe` — a first install (the website's download);
  - `/vp/rollback/<v>/releases.<channel>.json[.sig]?v=<current>` — a rollback feed, answered
    only inside the running version's group;
  - `/releases` — the website's list; `/health` — heads the latest package and Setup.exe;
    `/versions` — the rollback list.
- **R2:** bucket `deetsmusic-releases`, `<channel>/index.json` and `<channel>/vp/…`. R2 storage
  is free to 10 GB and egress is free, so every version is kept. The NSIS installers up to
  0.27.0 stay at `<channel>/DeetsMusic_<v>_x64-setup.exe` for the website's history.
- The route answers from R2, **never D1**, the same rule as `/token`.
- **`KILL` must not block this route.** A bad release must stay fixable by an update, so the
  update route checks `KILL_UPDATE` (its own var) instead.
- This is a file channel for **signed files only**. It never serves code the app loads
  (support.md "config yes, code no").
- **The website reads `/releases`** (behind `deets.solutions/deetsmusic/`): every row, newest
  first; `latest` is the newest live non-pre-release. A row carries version, date, notes, and —
  only when it has an installer and is not withdrawn — a download URL and a size. For a
  Velopack row the URL is its Setup.exe and the size is `setup_size`, the Setup.exe's bytes
  (2026-10-16; before it the site showed the smaller package size). `Cache-Control: public,
  max-age=300`. Two kinds of row the updater never sees:
  - **History rows** — 0.1.3 to 0.4.1 shipped before the updater; notes and a date only.
  - **Withdrawn releases stay listed**, notes and all, marked withdrawn and with no download.
    An optional `withdrawn_reason` says why.
- **The old route** `/update/<channel>?v=<current>` still answers NSIS installs, from NSIS rows
  only (§0b, §4b).

### 6.3 Behavior — download in the background, apply at the next start

Settings row, verb-first per the label style: **Updates — Automatic / Ask / Off**.

- **Automatic** — check at launch and every 6 hours; download in the background; a toast
  offers **Restart now** / **Later**. *Later* means the update installs the next time
  DeetsMusic starts (his call F1 A), not "ask again".
- **Ask** — the toast offers **Download** first, then the restart toast.
- **Off** — no check. The Settings row still has **Check now**.
- Every offer has **Skip this version**: the version is stored in `settings.json` and its
  downloaded package is deleted (`update_discard`), so the next start does not install it.
- An update restart restores the song, paused, at its position, even when Restore on launch is
  off (`updateRestart` in queue-persist).
- The update stops our CLIs (§3), so an open MCP session ends.
- `minVersion` from the remote config (in the `/token` response) makes an update required: it
  downloads whatever the mode. The `notice` string becomes a notice toast (TOASTS.md §5).
- The toast wordings are TOASTS.md §5 (`updater.ts` rows).

### 6.4 Download rules — one at a time

- **One download in flight.** Velopack takes a global lock; `update.rs` keeps its own for the
  status, and a check while a download runs does nothing.
- **One waiting package.** `packages\` holds the current full package and at most one
  downloaded update; Skip deletes it.
- **Size cap.** `SignedSource` refuses a feed entry above 50 MB (`SIZE_CAP`, velo.rs), and
  Velopack checks each download's SHA-256 against the signed feed.
- A delta is usually a few MB (0.28.0 betas: 3.2–4.5 MB); several missed versions chain their
  deltas, or fall back to the full package (~15 MB).

### 6.5 Rollback — previous version, plus a list

- Settings shows **Roll back to <previous>** — one press.
- Under it, **Other versions…** lists older versions **in the same channel group** only.
- The app reads that version's rollback feed (§6.1) with downgrades allowed; the Worker
  answers it only inside the running version's group.
- A rollback keeps the newer of the old skip and the version it leaves as the skip
  (`rollbackSkip`, `src/update-rules.ts`), or apply-at-start would install the newer version
  again at the next start (found in the beta desk test, VELOPACK.md §12.4).
- **Why the group rule:** the cache db migrates forward. A migration that only adds tables and
  columns leaves the db readable by an older build; one that re-keys rows does not. **Release
  rule:** a destructive migration starts a new channel group (`package.json`
  `deetsmusic.updateGroup`), and the index carries the group per version.
- **Group 2 starts at 1.0.0 (his call, 2026-10-23):** no install of 1.0.0 or later can roll back
  to a 0.x version. 0.28.0 … 0.31.0 stay group 1 in the index; a 0.x install still updates
  forward to 1.0.0 (an update ignores the group). Roll back shows *No earlier version to roll
  back to yet* until 1.0.1 is published.
- Versions compare with `compareVersions` (update-rules.ts and the Worker): a pre-release sorts
  before its release, and `beta.10` after `beta.9`.

### 6.6 Signing — the updater key, password in Credential Manager

- `npx tauri signer generate` made the key pair. The **public key** is `PUBKEY` in velo.rs
  (compiled into every install; up to 0.27 it was `plugins.updater.pubkey`). The **private
  key** signs every feed: `release.mjs` signs the local feed after the pack, and
  `publish-update.mjs` signs each feed it uploads (the rollback feed, the feed, and the feed
  again on `--withdraw`), through `tauri signer sign` with `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Why it matters:** the signature is the defence if the Worker, R2 or DNS is taken. The
  private key **never goes into Cloudflare** or the repo.
- **Lost key = no install can update again.** Every install trusts only its compiled public
  key, and a new key can only ship in a release whose feed is signed by the old one.
- **Not Authenticode.** This key does not give an exe a publisher name. Authenticode is a
  separate signature from Azure Artifact Signing (§6.9).

**Where things live — two copies of each, in two places:**

| Item | Copy 1 (this PC) | Copy 2 (off this PC) |
|---|---|---|
| Key password | Windows Credential Manager — the release scripts read it | iCloud Passwords (end-to-end encrypted, two-factor) |
| Private key file (encrypted form only) | `Documents\Deets' Secrets`, noted in its README | USB drive or OneDrive — **never iCloud Drive** |

1. The key file and its password never share an account.
2. The key file is only ever stored encrypted.
3. On the day the key is made, sign a test file using **copy 2 of both** to prove the backup.
4. The scripts pass the password only to `tauri signer sign`; they never print or write it.

**Runbook — the key file is copied, but the password is not known to anyone else.** The file is
encrypted, so it is not usable. Make a new key when convenient and rotate (below). Not urgent.

**Runbook — the key AND its password are exposed.** An attacker also needs the update route
(the Worker, R2 or the DNS record) to push a fake feed. So:
1. Secure Cloudflare first: change the password, check two-factor sign-in, revoke API tokens.
2. Set `KILL_UPDATE` until step 4 ships, if the route itself is in doubt.
3. `npx tauri signer generate` a new key; store it and back it up as above.
4. Ship a release whose feed is **signed with the OLD key** and whose app carries the **NEW**
   `PUBKEY`. Installs that take it trust only the new key from then on.
5. Raise `minVersion` to that release, so every install is pushed to take it.
6. Installs that never update keep trusting the old key. That gap cannot be closed from here.

**Runbook — the key is LOST (both copies).** No install can verify an update again. There is
no fix inside the updater. The recovery is the config channel, which does not use the key:
1. Make a new key and a release with the new public key.
2. Put it where a person can download it by hand (the website's Setup.exe).
3. Set the remote `notice` to say so, with the download link. Every install reads it on the
   `/token` fetch.

**Possible second lock (not decided):** the app could also require every exe in a downloaded
package to carry a valid Authenticode signature with CN `Aditya Sundaram` before it applies it.
Then a stolen updater key plus a taken Worker is still not enough.

Why Credential Manager over a typed prompt: the password protects a copied key file, and
both options protect that equally. Neither protects against malware running as the user.
The vault lets a Claude session run a full release; a prompt would not.

**The same key signs a CSP relaxation** (`architecture/CSP.md` §7, §12.2): when a release's
Content Security Policy blocks something it must not (a new MusicKit host), `npm run csp:relax --
--add "connect-src https://…" --versions "0.32.*"` (or `--mode report`) signs it and prints the
D1 command that puts it in DeetsSupport's `/config`. Installs fetch it at start and use it from
the next launch. `--withdraw` prints the command that takes it out. Each release's mode is
`RELEASE_MODE` in `csp.rs` (report for the first release with the policy, then enforce).

### 6.7 Publish step

`npm run release:publish`, run only after the installed build passed its checks.
`npm run release` does the signing; publish never builds. From
`installers/velopack/<Id>-<channel>/` to R2 `<channel>/vp/`, in this order, so an install
never reads a feed that names a package not yet uploaded:

1. the version's full package and its delta (when there is one);
2. Setup.exe as `<Id>-<version>-Setup.exe`;
3. `rollback/<version>/releases.<channel>.json` + `.sig`;
4. `releases.<channel>.json` + `.sig`: the local feed without withdrawn versions, signed.

Then `<channel>/index.json` gets `{ version, group, notes, pub_date, size, file, setup,
setup_size, velopack: true }`. `size` is the full package's bytes, `setup_size` the
Setup.exe's. `notes` is the version's RELEASE-NOTES.md entry up to its first `###`, stored
with `\n` line endings whatever the checkout uses. Then, on `deetsmusic`, the web demo is built
and pushed (§0b: a demo failure never undoes the publish).

The flags (`scripts/publish-update.mjs`):
- `--beta` — DeetsMusic Beta to `deetsmusic-test`; it needs a `-beta.N` version, and a
  `-beta.N` version needs it.
- `--replace` — overwrite a version already in the index.
- `--withdraw <v> --reason "<text>"` — marks the row withdrawn, stores the reason (shown on the
  public page, so written in plain words for a user), and signs the feed again without that
  version: the Worker cannot change a signed file.
- `--notes-only <v>` — refreshes one row's `notes` from RELEASE-NOTES.md without an upload.
- `--history` — a notes-only row for every `## <version>` in RELEASE-NOTES.md that the index
  lacks (run once for 0.1.3–0.4.1; safe to re-run).
- **A publish to `deetsmusic` stops when RELEASE-NOTES.md has no entry for the version**
  (2026-09-16: 0.6.3 and 0.7.0 went live with empty notes before this). The test channel is
  not checked.

### 6.8 Test a change to the updater — the beta channel

A change to `velo.rs`, `update.rs`, `updater.ts`, the Worker's update route or the scripts is
tested on DeetsMusic Beta (`deetsmusic-test`) before a live release. The beta is a second
installed app with its own data, CLI and deep link, so the live app is never touched
([BETA.md](BETA.md)).

1. Set a `-beta.N` version, `npm run release -- --beta`, install
   `installers/beta/DeetsMusicBeta_<version>_x64-setup.exe`, `npm run release:publish -- --beta`.
2. Bump to `-beta.N+1`, build and publish the same way. Do not install it.
3. In the installed beta: Settings › Updates › Check now → the toast → **Restart now**. Expect
   the app back in about 2 s, the song at its position, the pin still one icon.
4. The rest of the walk is VELOPACK.md §12.3: *Later* then a restart, Skip, a rollback, the
   media flyout's name, the uninstall.

`DEETSMUSIC_VELO_FEED` (build time) points a test build at a folder or URL instead of the
Worker; `release.mjs` refuses it for a release. **The pin holds only while `productName`,
`mainBinaryName` and the package id stay fixed** (release-check 3): a new `productName` is a
second install (ideas/whitelabel.md §10.4).

### 6.9 Authenticode — Azure Artifact Signing (set up 2026-09-14/15)

> Status: **working since 0.5.0.** Since 0.28.0 the signatures go through `vpk pack
> --signTemplate`. A browser download names the publisher and still warns until the download
> reputation builds (RELEASE-NOTES.md header).

**Terms.** *Authenticode* is the Windows signature that puts a publisher name on an exe. It is
separate from the updater key (§6.6). *Artifact Signing* is Azure's service for it (formerly
Trusted Signing); Azure holds the key and issues a certificate that lasts about 3 days, so every
signature is timestamped.

**What is set up (Azure portal):**

| Item | Value |
|---|---|
| Signing account | `DeetsSolutions` — resource group `DeetsSolutions`, East US, Basic ($9.99/month, 5,000 signatures, 1 profile) |
| Endpoint | `https://eus.codesigning.azure.net` |
| Identity | Individual, Public — validated 2026-09-15 |
| Certificate profile | `deetsmusic`, Public Trust. Subject `CN=Aditya Sundaram, O=Aditya Sundaram, L=San Jose, S=ca, C=US` (street and postal code left out on purpose) |
| App registration (Entra ID) | `Deets Release Signing` — client `436ce300-2b76-486f-800c-e6207a3e4720`, tenant `7715e97a-6856-491f-9861-c797da0b5288`. One role only: *Artifact Signing Certificate Profile Signer* on the account |
| Client secret | Windows Credential Manager, target `DeetsMusicAzureSigning` (save it with `scripts/cred-write.ps1 -Target DeetsMusicAzureSigning -Kind azure`; it trims and checks the paste). **Expires 2027-03-14** — renew before then (runbook below). |

The user's own account holds *Artifact Signing Identity Verifier* and *Certificate Profile Signer*.
Owner alone can neither validate nor sign.

**What signs what (`npm run release`):** every signature goes through `scripts/sign.mjs`.
1. `release.mjs` reads the secret before the build, so a missing one fails first. The tenant and
   client IDs and the secret go only into the child processes' environment.
2. After `cli:build`, it signs `cli/dist/deetsmusic.exe`, a resource the build does not sign.
   `vpk` then skips it as already signed (its log: "3 file(s) will be signed, 1 will be
   skipped").
3. `vpk pack --signTemplate "node sign.mjs {{file...}}"` signs the app exe, the stub
   (`DeetsMusic.exe` at the install root), `Update.exe` (`Squirrel.exe` in the package) and
   Setup.exe. **`tauri.conf.json` has no `signCommand`**, and `tauri build --no-bundle` signs
   nothing; only `npm run release` makes a signed build.
4. `release-check` check 4 fails the release unless the CLI, the app exe and `Squirrel.exe`
   (read out of the full package) and Setup.exe have a **Valid**, timestamped signature whose
   CN equals `bundle.publisher`.
   **Trap (2026-10-15):** `vpk` signs copies, so the staged exe in
   `src-tauri/target/velopack-stage/` stays **NotSigned** after a good build. Check the package
   or the installed `%LOCALAPPDATA%\DeetsMusic\current\DeetsMusic.exe`.

**The x86 warning (read 2026-10-16).** `vpk pack` logs *No architecture specified with
--runtime, defaulting to x86*. The package is still `win-x64` (read from the main exe); only
`Update.exe` and the stub are `vpk`'s 32-bit copies, as in every beta that passed the desk
test. A 32-bit `Update.exe` runs on 64-bit Windows. Adding `--runtime win-x64` would ship the
64-bit copies, untested; leave it until a beta tries it.

**Tools on the signing PC (not in the repo):**
- `signtool.exe` — Windows SDK, x64. `sign.mjs` picks the newest `10.*` SDK.
- Microsoft's dlib — NuGet `Microsoft.ArtifactSigning.Client` **1.0.128**, the `bin\x64` folder,
  copied to `%LOCALAPPDATA%\DeetsTools\artifact-signing\1.0.128\`. Needs the .NET 8 runtime.
  (The download: `https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/1.0.128/microsoft.artifactsigning.client.1.0.128.nupkg`, a zip.)
- `%LOCALAPPDATA%\DeetsTools\artifact-signing\metadata.json` — endpoint, `DeetsSolutions`,
  `deetsmusic`, and `ExcludeCredentials` listing every credential except the environment one,
  so it never opens a browser or uses an `az login`.
- Override the folder with `DEETS_SIGNING_TOOLS`. A new dlib version: change the path in `sign.mjs`.

**Rejected (2026-09-15):** `artifact-signing-cli` / `trusted-signing-cli` (cargo). Its help
lists the client-secret options, but it refuses to run without the Azure CLI installed.

**The first checks** (2026-09-15, on NSIS builds 0.4.4-t1 → t2: the first signed file, the
first signed release, the updater `.sig` made after the signature, the first browser download)
are in [RELEASE-NSIS.md](../archive/RELEASE-NSIS.md) §6.9. Still open: the day a new version
downloads with no Edge warning (download reputation), which ends the Installing lines in the
release notes.

**Runbook — the secret expires or leaks.** Entra ID › App registrations › Deets Release Signing ›
Certificates & secrets: add a new secret, run
`powershell -NoProfile -File scripts/cred-write.ps1 -Target DeetsMusicAzureSigning -Kind azure`
with it, run a test signature, then delete the old secret.
A leaked secret can sign files as *Aditya Sundaram* until it is deleted — delete it first, then
renew. Update the expiry date above.

**Cost:** $9.99/month while the account exists, even with no release. Deleting the account ends
it; signatures already made stay valid (they are timestamped).

**A signing step can fail once and pass on a re-run.** The first `npm run release` for 0.11.0
(NSIS, 2026-09-18) died with "failed to run node.exe" on one file, and the identical command
passed the next time; the full case is [RELEASE-NSIS.md](../archive/RELEASE-NSIS.md) §6.9.
**Read the error before digging:**
- `sign.mjs` prints `[sign] signtool failed on <file>` when the signer itself fails, and the
  Artifact Signing banner (`Version: 1.0.128`, `Submitting digest…`) for every file it tries.
- When neither appears for the failed file, `sign.mjs` never ran: the caller could not start
  the process. A transient spawn failure on a file just written (Defender scanning it) is the
  usual cause of that shape on Windows.

**So: run it again first.** If it repeats on the same file twice in a row, look at whether
`node.exe` is still where the caller names it and whether Defender holds the output folder.
**No automatic retry:** a retry around a signing stage hides exactly the repeated failure that
would matter, and the re-run is one command.

## 7. Distributing a usable build — the developer token

> Decided 2026-09-09: **long token lifetime · open endpoint, rate-limited by IP · the dev
> seam keeps local signing.** **The worker is live (2026-09-11):** `DeetsSupport` is deployed on
> both hosts, `/token` mints a 60-day ES256 token that Apple accepts (search → 200, corrupted
> signature → 401), wrong `User-Agent` → 403. **Repo 2 is built the same day**: the cache, the
> dev seam, the 429/offline fallback and the once-per-process 401 refetch in `apple.rs`;
> `player.ts` re-runs `configure` on `developer-token-changed`. **Desk-tested 2026-09-11** with
> `apple.json` moved away: one `GET /token` 200 in the Cloudflare tail, `source=worker` in the
> log, playback fine (Order step 4 done). **The 401 refetch is desk-tested too:** a cached token
> with a dead signature → search hits 401 → `refetching once` in the log, one `/token` in the
> Cloudflare tail, the search succeeds on the retry; and with MusicKit already configured on
> the dead token, playback works after the refetch without a restart (the
> `developer-token-changed` reconfigure). **The dead first run is desk-tested via `KILL`:** no key,
> no cache, mint 503 → the window opens, the log reads `no developer token: no local MusicKit key
> and mint switched off (503)`, and a search shows the same text. The offline case shares that
> branch (only the string differs). The launch toast for it is built ([TOASTS.md](../architecture/TOASTS.md) §5,
> 2026-09-13; shipped, but no test result against `KILL` is on record).
> Steps 1–5 done: public releases on the `deetsmusic` channel get their token this way.

### The problem

`developer_token()` (`apple.rs`) signs an ES256 JWT from a MusicKit `.p8`, and a MusicKit key
needs a **paid Apple Developer membership**. So today the app only runs for someone who has
their own key. A working public binary would have to carry the `.p8` — which is exactly the
file that must never ship.

So a **Cloudflare Worker mints the token instead**, on `deets.solutions` infrastructure. The
key becomes a Worker secret and never leaves Cloudflare.

### What this buys, and what it cannot

It cannot verify that the caller really is DeetsMusic. Anything shipped in a public binary
can be extracted, including any secret it would use to prove itself. There is no client
attestation for an open-source desktop app, so the endpoint is deliberately **open**, and
honest about it. (The build key of §7a does not change this: it is a ledge against an
accidental clone, not proof.)

What it does buy, which is enough:

- **The `.p8` never ships.** The whole point.
- **Tokens expire**, so a leaked one dies without revoking the key.
- **A kill switch, rate limits and usage visibility**, all changeable without a new release.

It also stays clean on privacy: the mint only mints developer tokens. The **music-user token
never passes through the Worker**: the hosted sign-in page hands it to the app by a deep link
(DATA-ARCHITECTURE.md §2a), and the loopback page stays on this PC. Say that plainly wherever
the app is published. (Read 2026-10-14: the same Worker has two other routes that do carry
something from the app, each the user's to turn off: anonymous usage counts with no ID,
[USAGE-COUNTS.md](../features/USAGE-COUNTS.md), and a bug report the user sends from Settings ›
Bugs. The README › Privacy paragraph says both.)

### The one implementation constraint

`developer_token()` is **synchronous and called ~25 times** — `apple.rs`, `enrich.rs`,
`library.rs`, `playlists.rs`, and `player.ts` through the `apple_developer_token` command.
Today each call re-signs locally, which costs microseconds.

A Worker fetch per call would put a network round-trip in front of every Apple request. So
the token **must be cached**: fetched once, held in a `static`, persisted to app data with its
expiry. `developer_token()` stays sync and reads that cache, and **all ~25 call sites stay
untouched**. Anything else turns a small change into an async refactor of the whole Apple layer.

### Repo 1 — the Worker (new sibling repo)

> **Superseded 2026-09-11.** The mint is no longer its own repo. It is one route on
> **`DeetsSupport`**, the support worker for every Deets app — status, suggestions, issues,
> anonymous report intake and remote config. Scoped in
> **`DeetsSolutions/docs/support.md`**, which is now the source of truth for the repo, the
> hosts and the schema. What stays true below: the zero-dependency house pattern, the
> WebCrypto signing notes, the secrets, and the rate-limit binding.
>
> Two things that repo's scope pins down, and that this repo depends on:
>
> - The app compiles in **`music-api.deets.solutions/token`** — a second custom-domain route
>   on that one worker, never the `support.` host. That keeps a future split a route move
>   rather than a release.
> - **`/token` returns before any D1 call**, so the boards cannot take down app startup.

Mirrors **DeetsAccounts** exactly, which is the house pattern for a Worker: **no
`package.json` and no dependencies**, plain `src/index.js`, a commented `wrangler.jsonc`, and a
subdomain route. The static site repo holds no Worker code.

```
DeetsSupport/              (renamed 2026-09-11 from the proposed DeetsMusicToken; hosts
                           support.deets.solutions + music-api.deets.solutions — the
                           siblings are api / radio-api / cities-api / mahjong-api / id)
  wrangler.jsonc           name, main, compatibility_date, KILL var, ratelimit binding, routes
  src/index.js             /token via plain WebCrypto, plus the support routes
  schema.sql               D1 — see support.md
  README.md                setup + deploy, in the accounts-setup.md style
```

- **Signing**: WebCrypto `importKey("pkcs8", …)` with `ECDSA` / `P-256`, then `sign` with
  `SHA-256`. Its output is raw `r||s`, which is **already** what JWS ES256 wants — no DER
  unwrapping. Zero dependencies, so the no-dependency rule holds.
- **Stateless**: sign per request. No D1, no KV. Long-lived tokens make caching pointless, and
  a per-request signature avoids handing every client one shared token with one shared expiry.
- **Secrets** — `npx wrangler secret put APPLE_P8`, `… TEAM_ID`, `… KEY_ID`. The `.p8` is
  pasted as a secret; it is never committed, exactly as in this repo.
- **Rate limiting by IP** is a rate-limit binding in `wrangler.jsonc`, **not** a dashboard
  rule (revised 2026-09-10: the binding is versioned with the code). **30 per 60 s**, fail
  OPEN if the binding is absent (raised from 10 on 2026-09-11 — see "What the rate limit is
  actually for" below).
  **Measured 2026-09-11, two corrections to the house pattern:** (1) declare it under the
  top-level **`ratelimits`** key — the older `unsafe.bindings` form deploys as "Unsafe
  Metadata" and never trips (DeetsAccounts, DeetsRadio, DeetsCities, DeetsMahjong and DeetsPoker
  carried that form and were inert — all five moved to `ratelimits` and redeployed the same
  day; DeetsCities also moved off namespace 2001, which it shared with DeetsAccounts, since
  bindings on one namespace share a counter); (2) the binding counts per
  isolate and syncs lazily, so a burst over fresh connections passes while one reused
  connection trips at ~26/30 and holds at 429. Enough for a runaway client loop (reqwest
  pools its connection); not a wall against a scan, which was never claimed.
- **Kill switch**: a `KILL` var; when set, every request gets 503. Flipping it is a
  `wrangler deploy` of the Worker, never a release of the app.
- **No Origin check.** A desktop app sends no browser Origin; the endpoint is open by design.
- Deploy: `npx wrangler deploy`. Local: `npx wrangler dev --port <free port>`.

One deviation from the DeetsAccounts convention worth noting: its design doc lives in
`DeetsSolutions/docs/`. This Worker's consumer is **this app**, not the site, so the design
doc is this section, and `wrangler.jsonc` should point back here.

### Repo 2 — DeetsMusic (this one)

All of it inside `apple.rs`, plus one call in `lib.rs`:

1. `ensure_developer_token()` — run once in `lib.rs` `setup()`, after `set_app_data_dir`.
   **The dev seam:** if `apple.json` is present, sign locally exactly as now; otherwise fetch
   from the Worker. So the dev loop never depends on the network, and a contributor with their
   own MusicKit key still builds fully offline.
2. Cache `{ token, exp }` in a `static`, persisted to `<app_data>/developer-token.json`.
   Read the file first; if more than **30 days** remain, done, zero network. Otherwise fetch.
   `reqwest` here is async-only, so the one fetch runs as
   `tauri::async_runtime::block_on` inside `setup()` with a short timeout (~8 s) — it must
   finish before the webview asks for the token to configure MusicKit. Place it after
   `set_app_data_dir` and before the user-token seed.
3. `developer_token()` becomes a sync cache read. Signature unchanged, so no caller moves.
4. Errors must name the cause — no local key *and* no network is a real first-run state, and
   "could not read apple.json" would be the wrong message for it.

Document the new file in [DATA-ARCHITECTURE.md](../architecture/DATA-ARCHITECTURE.md) §8 alongside
`settings.json` when it lands.

### Repo 3 — DeetsSolutions

Only if the Worker gets a page. The DNS record is created by `wrangler` on first deploy.

### Order

1. Worker repo: sign, deploy to the subdomain, confirm with `curl` that the JWT verifies and
   that Apple accepts it.
2. Add the Cloudflare rate-limiting rule (the `ratelimit` binding, not a dashboard rule).
3. This repo: the cache + the dev seam, behind the local-key fallback so nothing breaks first.
4. Test a build with `apple.json` **moved away**, which is the state a stranger installs into.
5. Cut the release, attach the installer, then publish.

### Decided 2026-09-10 (build day is 2026-09-11)

- ~~**Lifetime 150 days**~~ / ~~**startup-only refresh**~~ — both revised 2026-09-11, below.
- ~~**Name / host:** `DeetsMusicToken`~~ — **settled 2026-09-11:** the route
  `music-api.deets.solutions/token` on the **`DeetsSupport`** worker
  (`DeetsSolutions/docs/support.md`). The Backends row is added.

### Revised 2026-09-11 — recovery, not the door

The endpoint stays **open and rate-limited by IP**; that fork is closed (three alternatives
were re-tested against the code and all three are dead: client attestation is impossible in a
public binary; a Turnstile-style human check cannot run, because `ensure_developer_token()`
runs in `setup()` before any webview exists; per-install registration in KV/D1 stops no script
and would put user data in the Worker, which breaks the privacy claim above).

The control that actually matters is **how fast the key can be rotated and how fast every
install recovers**. Two earlier decisions worked against that, so both change:

- **Lifetime 60 days, refresh margin 15 days** (was 150/30). A scraped token cannot be
  revoked, so its lifetime *is* the blast radius. Cost: ~6 startup fetches per install per
  year instead of ~2. Still one fetch at startup, still zero network per Apple call.
- **Refetch once on a 401 from Apple** (was startup-only). The old reasoning — "a refresh
  would mint from the same key" — held while `apple.rs` signed locally. Once the **Worker**
  signs, a rotated key means the Worker mints from a *different* key, so one refetch heals the
  install. Without it, rotating the key leaves honest users broken until the margin passes.
  Guard it with a local cooldown (one refetch per process, or per hour) so an Apple outage
  cannot loop.

Free hardening, no further decision needed:

- Require `User-Agent: DeetsMusic/<version>`; answer anything else **403**. Not security —
  it sheds drive-by scanners and keeps the logs readable.
- Respond `Cache-Control: no-store`. **Never log the token or the client IP.**
- `KEY_ID` is a secret, not a var, so the key can be swapped without a code change.
- The cached token is a bearer credential: it must reach only Rust and the webview
  (`apple_developer_token`). It must **never** appear on the loopback bridge or the agent
  routes. That invariant holds today — keep it.

### 7a. The build key — a ledge against an accidental clone (2026-09-18)

> Decided 2026-09-18 (forks 1A/2A/3A/4A): **one compiled-in key · checked on the mint and
> report intake only · dev builds carry it when the file exists · rotated only after an abuse
> case.** Built the same day; the Worker code is written and **not yet deployed**, and the
> `BUILD_KEYS` secret is **not set** (see "Turning it on").

**Why.** The repo is public under MIT. Before this, `git clone` + `cargo build` produced an app
that minted Apple tokens from Deets' Worker and posted reports into Deets' inbox, because the
only gate was the `DeetsMusic/` User-Agent prefix. The key turns that accident into a deliberate
act: a clone author must either bring their own back end or pull the key out of the installer.

**What it is not.** Proof. The key sits in a public exe and a strings tool reads it out. The
shared token itself (one per 7-day window, in every install's app data) is the bigger prize and
the key does nothing for it. Nothing more is claimed; the "What this buys" list above still holds.

**How it works.**

- `Documents\Deets' Secrets\deetsmusic-build-key.txt` holds one line (32 url-safe characters,
  made with `crypto.randomBytes(24)`). Override the path with `DEETSMUSIC_BUILD_KEY`.
- `src-tauri/build.rs` reads it and emits `DEETS_BUILD_KEY`, exactly the Last.fm pattern; the
  app reads it with `option_env!`. No file → a warning and a build that sends no header.
- `apple.rs` exports `build_key()` and `BUILD_HEADER` (`X-Deets-Build`). The mint fetch and the
  report post send the header when the key exists. A 403 from the mint logs `mint refused this
  build (403)` (or `… has no build key` when the build has none); a 403 `build` from intake shows
  "The support server doesn't take reports from this build of DeetsMusic."
- `release-check.mjs` item 8 refuses a release whose exe lacks the key.
- `DeetsSupport`: `buildRefused()` in `src/index.js`. `BUILD_KEYS` (a secret, comma list)
  unset or empty = the check is OFF and the deploy changes nothing. Set = a `DeetsMusic/`
  caller without a listed header gets 403 `build` on `GET /token` and `POST /posts`. Web
  callers never carry the header and are never asked. Updates and rooms are not checked
  (fork 2A): updates are signed, and a clone pulling one replaces itself with the real build;
  rooms are the lowest harm and their Worker is a third repo.

**Turning it on** (in this order, or older installs lose the mint):

1. Deploy the Worker: `npx wrangler deploy` in `../DeetsSupport`. Inert until step 3.
2. Ship a release with the key built in (the release check enforces it). Wait until every
   install in use is on it — an older install with no key keeps its cached token for up to
   14 days after step 3, then gets 403 and shows "no developer token".
   `CONFIG.minVersion` can hurry that along.
3. `npx wrangler secret put BUILD_KEYS` with the key. From then on the check is live.

**Rotation** (fork 4A: only after an abuse case): make a new line in the file, set `BUILD_KEYS`
to `old,new`, ship a release, drop `old` once the installs have moved. Never a per-release key.

**Desk test.** After step 3: `curl -A DeetsMusic/0.0 https://music-api.deets.solutions/token`
→ 403 `{"error":"build"}`; the same with `-H "X-Deets-Build: <key>"` → 200; the installed app's
log shows `token: source=worker` after `developer-token.json` is moved away; Settings › Bugs
sends a report and gets a code. A build without the key file (`DEETSMUSIC_BUILD_KEY=nul`)
logs `mint refused: this build has no build key (403)` and still plays on the dev `.p8`.

### What the rate limit is actually for (2026-09-11)

Two things it is **not**. It does not sit in front of Apple: `developer_token()` is called
once per operation and the string is then passed down (`library.rs:585` hands it to
`AppleProvider` for a whole sync; `enrich.rs:284` per batch), so after the cache lands those
are pure memory reads. **A 10,000-track library pull makes zero Worker requests.** And it is
weak anti-theft: a thief needs **one** token and then holds it for 60 days, which no per-IP
limit prevents.

Its real job is to stop a runaway client loop and keep the bill at zero. Judged that way a
tight number is all cost, so:

- **30 per 60 s per IP.** An honest install fetches ~8 times a **year** (one startup fetch,
  only inside the 15-day margin). The headroom is for shared addresses — office NAT, CGNAT,
  a campus, a busy VPN exit — where many installs can leave by one IP.
- **The client must survive a 429.** If the cached token is still inside its expiry, keep
  using it and retry at the next launch. A 429 must never block startup or sign the user out.
- **Cool down the 401 refetch: one per process.** That path is the only way a client can
  generate Worker requests in a tight loop.

### Revised 2026-09-13 — D.7 hardening (Apple terms pass)

Read against the Apple Developer Program License Agreement §3.3.6.D.7 ("not use developer
tokens or private keys … in any manner not expressly authorized") and §2.8 (no sharing access
to Apple services). Decided and built:

- **Lifetime 14 days, one shared token per 7-day window** (was 60 days, a new token per
  request). Every token in a window expires at the same instant, so the Worker hands out one
  token rather than an unlimited supply. Held per isolate and in the colo's Cache API, keyed by
  window + `KEY_ID` + origins; no KV, no D1. `iat` is never back-dated. The app's refresh
  margin drops to **3 days** (it must stay below the window). ~50 fetches per install per year.
- **Mint counter:** D1 `mint_counts` (day, served, limited), written with `waitUntil` after the
  response, errors dropped. No IP, token or UA. Read:
  `npx wrangler d1 execute deets-support --remote --command "SELECT * FROM mint_counts ORDER BY day DESC LIMIT 14"`.
- **`origin` claim — built, switched OFF** (`TOKEN_ORIGINS` var, empty). Probed 2026-09-13
  against `api.music.apple.com`: with a claim, Apple answers **401** to a request whose
  Origin is missing or unlisted (every reqwest call sent none), accepts **no wildcard and no
  bare host**, and matches host + port exactly. So the app now sends
  `Origin: http://tauri.localhost` on every Rust call to Apple, and the sign-in page binds a
  fixed port (47831–47833) instead of an ephemeral one. **Turn it on only once installs older
  than this change are gone** — an old install would get 401 on everything. There is no
  auto-updater, so that is a judgement call, not a date. Value: a lifted token stops working
  on anyone else's web page. It does not stop curl or a native client, which can fake Origin.
  The value to set: `http://tauri.localhost,http://127.0.0.1:47831,http://127.0.0.1:47832,http://127.0.0.1:47833`.
  A contributor without a local key running `npm run dev:app` (origin `localhost:<port>`)
  would also get 401s from MusicKit once it is on; the dev seam (a local `.p8`) is unaffected.
- **Separate key for the live mint (item 4)** — the user's portal step; see HANDOFF.

Compliance items shipped with it: the Apple Music icon replaces the Apple logo on the playlist
badge (Identity Guidelines); a trademark and non-affiliation notice (Settings › About, README);
a privacy section (README); MusicKit `app.build` reports the real version; the log redacts the
Music User Token by value (`log::register_secret`), since it is not JWT-shaped.

### The cost to name

This makes **one Apple account the dependency for every install**. If that key is throttled or
revoked, every copy stops working, and the membership is an ongoing cost. Apple's MusicKit and
Developer Program terms govern whether minting tokens for other people's installs is allowed at
all — that read is the user's, and it belongs before the app attracts traffic.

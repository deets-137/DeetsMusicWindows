# DeetsMusic — Handoff / Status

> Cold-start guide — read first. A lightweight Apple Music player for Windows 11:
> **Tauri v2 + WebView2**, vanilla **TypeScript** front-end, **Rust** back-end. Current
> surface is the **midi-player** (480×864 frameless window) showing a home **bento** of cards.
>
> **Where things stand:** the foundation (playback, queue, card/slot system, themes/skins,
> library + catalog data) and the feature cards (Library, Search, Playlists, Queue, History,
> Rewind, **Radio** incl. seeded right-click "Start Station") are built and user-verified.
> **The Apple-radio line is done.** Next: the **v1 push** — see [Next up](#next-up).

Deeper docs, by area:
[DESIGN.md](DESIGN.md) (product) · [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) (front-end tokens/cards) ·
[DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (back-end/data) · [QUEUE.md](QUEUE.md) (queue model +
playback windowing — **read before touching queue.ts/player.ts**) · [DEBUGGING.md](DEBUGGING.md)
(`__diag` log) · [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) (card system + surface seam) ·
[FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) (behaviors hardcoded now, to expose as toggles) · [SETTINGS.md](SETTINGS.md) (the settings store + card) ·
[UX-COVERUPS.md](UX-COVERUPS.md) (latency/jank ledger). Feature specs: [SEARCH.md](SEARCH.md) ·
[PLAYLISTS.md](PLAYLISTS.md) · [STATIONS.md](STATIONS.md) · [HOME.md](HOME.md) (the landing card — three shelves, all local) · [FAVORITES.md](FAVORITES.md) ·
[ALBUM-COLOR.md](ALBUM-COLOR.md) · [DEETS-REWIND.md](DEETS-REWIND.md) · [TRAY.md](TRAY.md) · [EXTENSION.md](EXTENSION.md) · [AGENT.md](AGENT.md) ·
[AIRPLAY.md](AIRPLAY.md) (play on a HomePod — the shared sender crate, and §11 sharing a speaker with DeetsAirplay) ·
[PROVIDERS.md](PROVIDERS.md) (Apple Music + Spotify at once — parked 2026-09-15, Spotify's dev-mode terms block it) ·
[TOASTS.md](TOASTS.md) (the notice primitive + every call site) · [ONBOARDING.md](ONBOARDING.md) (hover hints, right-click coverage, Settings › Tips, the sprite-led first run) · [RELEASE.md](RELEASE.md) (build, Authenticode signing, publish, the updater, install / uninstall — §0 is the overview). Ideas, not built:
[ideas/](ideas/README.md) (DeetsWeather, WeatherSkin, DeetsOTD, DeetsRecommends).

---

## Run it

Prereqs (one-time, already set up on this machine): **Rust** (`x86_64-pc-windows-msvc`) + **VS
2022 Build Tools** (C++ workload, for `link.exe`); **Node** + npm; **Apple Developer** creds in
`src-tauri/secrets/` (`apple.json`, the `.p8`, and a captured `user-token.txt` — launches
already signed in).

```bash
npm install
npm run tauri dev        # compiles Rust (first run slow), opens the window
npm run dev:app          # same, but SIDE BY SIDE with the installed app (see below)
npx tsc --noEmit         # typecheck front-end
npx vite build           # bundle-check
```

**Dev alongside the installed app (2026-09-09):** `npm run dev:app` merges
`src-tauri/tauri.dev.conf.json`, which changes only the identifier to `com.deetsmusic.dev`
(and the window titles). That gives the dev build its own `%APPDATA%\com.deetsmusic.dev`
(SQLite cache, settings.json, MUT) and its own WebView2 profile — two builds sharing one
profile is what produced the blank window with `ERR_CACHE_READ_FAILURE` on every module.
The bridge just takes the next free port (the extension and the CLI probe the list).
Seed the dev dir once by copying `deetsmusic.db` + `user-token.txt` from the release dir
(zero Apple calls); localStorage (theme/skin/layout) starts fresh.

Devtools **auto-open in dev** (`lib.rs` setup). Debug the player in the console:
`__diag.dump()` / `__diag.copy()` (ring buffer of transport + MusicKit events + desyncs,
auto-captures uncaught errors), `__music` (live instance), `__player.snap()`. Full reference:
[DEBUGGING.md](DEBUGGING.md).

**Dev telemetry + driving the app from a session (2026-09-12).** In dev every song click
(and Next) prints `[perf] click→sound N ms · model+render · setQueue · stream` to the
console and writes the same line, plus MusicKit's own request list, to the dev log
(`%APPDATA%\com.deetsmusic.dev\deetsmusic.log`). The `deetsmusic` MCP drives playback
(`play` returns after the song starts), so a session can run a play, tail the log, and
read the stage split without the devtools — that is how the click-to-sound pass was
measured and verified (cold vs warm, natural advance via `control seek 97`, dead ids,
the queue restore via a restart). Recipe and limits: [DEBUGGING.md](DEBUGGING.md)
"Driving it from outside" and `CLAUDE.md` "How to verify your work". None of it ships:
`src/perf.ts` is gated on Vite's `DEV` flag.

## Ship it (installable Windows app)

Full procedure — version sync, the build stages, Authenticode signing (§6.9), the NSIS hooks,
install, uninstall, publishing and the updater (§6, shipped in 0.4.3) — is in
**[RELEASE.md](RELEASE.md)**; §0 is the one-page overview of commands, secrets and keys. The
short version:

```bash
npm run release          # secrets → cli:build → sign → tauri build (signed + .sig) → release-check → archive; ~3 min cold
npm run release:publish  # after testing the installed build: R2 upload + update index → installs update
```

Produces `src-tauri/target/release/bundle/nsis/DeetsMusic_<version>_x64-setup.exe` + `.sig`
(~7 MB) and copies both into `installers/` (gitignored; pre-release versions go to
`installers/dev/`). Installs per-user to `%LOCALAPPDATA%\DeetsMusic` with **no admin prompt**.
A release needs two Credential Manager entries (`DeetsMusicUpdaterKey`,
`DeetsMusicAzureSigning`), the updater key file, and the signing tools in
`%LOCALAPPDATA%\DeetsTools\artifact-signing` (RELEASE.md §0 table).

Things that bite:

- **Use `npm run release`, not `tauri build`.** Only `release` runs `cli:build` first, which
  stages `cli/dist/deetsmusic.exe`. `tauri build` alone ships the **previous** CLI, silently.
- **The version lives in FOUR files** — `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` and **`cli/Cargo.toml`** (what `deetsmusic --version` reports) — and
  they must all agree or `release-check` fails, *after* the bundle is already built and
  signed. This note said "three" until 2026-09-15, when the 0.6.3 build tripped over the
  fourth; [RELEASE.md §2](RELEASE.md) always listed all four.
- **A running `deetsmusic mcp` blocks install AND uninstall.** Windows won't touch an open
  file; uninstalling 0.1.2 removed the registry entry and then left every file on disk. The
  0.1.3 `PREINSTALL`/`PREUNINSTALL` hooks stop the CLI first (RELEASE.md §3).
- **`target\release\DeetsMusic.exe` is unsigned after a good signed build.** Tauri signs a
  patched copy for the installer and writes the original back. Check the installed exe instead
  (RELEASE.md §6.9).
- **Save secrets with `scripts/cred-write.ps1`, not `cmdkey /pass`.** A paste into the hidden
  `cmdkey` prompt stored extra characters on 2026-09-15 (Azure: "Invalid client secret").
- **A secret expires:** the Azure client secret on **2027-03-14** (runbook RELEASE.md §6.9).

Icon: `app-icon.png` (the DM mark, DeetsAirplay/DeetsRGB lineage — transparent background,
scarlet `#E8341C` D + burgundy `#7A1A2E` M, 2026-09-09). Regenerate every size + the `.ico`
with `npx tauri icon app-icon.png` (delete the `android/` / `ios/` dirs it also emits); the
extension's icons are LANCZOS resizes of the same file.

---

## Next up

**2026-09-16 — 0.8.0 is live on the `deetsmusic` channel** (published 17:26 PDT; `main` =
`wakin-up` at `209c007`). It ships Sound, Last.fm, the playlist web, Stream quality, Fancy Glass
and the library reads for AI apps ([RELEASE-NOTES.md](RELEASE-NOTES.md) 0.8.0). Published at the
user's request without the hand install test of RELEASE.md §0 step 3: install it from
`installers/` and check it early.

**2026-09-16 — Sound: the user lives with it after it goes live, then reports back.** The Sound
panel (EQ + DeetsAdaptiveSound, phases 1–5) is built and committed on `wakin-up`
([SOUND.md](SOUND.md) §10–§11). Before any more Sound work: once it ships, the user tests it in daily
listening, gets a feel for each part (Equalizer, Match loudness, Fuller at low volume, Headphone
crossfeed, Compare) and reports back. Their report decides what stays, what changes and what goes
(SOUND.md §7 step 4). Do not start new Sound features until that report exists.
**First thing next build session:** grep the dev and installed logs for `sound:startLost` and
`sound:clockSlip` (the command is in SOUND.md §10.5). They watch for the lost song start that one
probe run showed on 2026-09-16.

**2026-09-15 — the listening-loop review: the transport pass is next.** A review of the daily
listening loop (repeat, shuffle, playing a whole album, the queue's end, the keyboard) found
the platform sound and the loop thin. Scoped with forks in
**[NEXT-VERSION.md §12–§17](NEXT-VERSION.md)**, in this order:
1. ✅ **Repeat button** (off / all / one) — §12, **BUILT 2026-09-15, shipped in 0.6.x**:
   after Shuffle, one cycling square, MusicKit `repeatMode` for *one*, a model lap for *all*
   with one buffering gap per lap, hidden in radio mode, persisted without a Settings row,
   agent + CLI verbs. **Rust (`bridge.rs`) and the CLI changed: restart the dev runner and
   `npm run cli:build` for the MCP binary.** Desk test: cycle the square (accent, the "1");
   *one* loops a song and Rewind counts each loop; *all* laps a short album (the gap at the
   wrap, then track 1 again); a station hides the square; `deetsmusic repeat all`.
2. ✅ **Play and Shuffle on a collection** — §13, **BUILT, shipped in 0.6.x**: a row of
   two half-width buttons under the hero of every song list (Library Songs root: at the top
   of the list; an album; the artist view, above its shelves; a playlist); Play = the rows in
   the current sort and filter; hover text names the list (a Library artist: every song by
   them in your library). The Search card's album, playlist and artist panes have the row too
   (the artist's: Apple's Top Songs). Desk test: Play on an album in Track Order; Popular on
   an artist; a ♥-filtered Songs root; View › Albums at the root drops the row; Shuffle turns
   the mode on; a Search artist's Shuffle plays its Top Songs shuffled.
3. ✅ **Shuffle mode** — §14, **DECIDED A + BUILT**: Settings › Playback › *Button is perma-shuffle*
   (default on) makes the Shuffle square a toggle; off = the one-shot. Desk test: press it
   (pressed look, Up Next shuffles), click a song in an album (the rest shuffled), press
   again (off; the next click plays in order); turn the row off and press (one-shot).
4. **Space for play / pause** — folds into the keyboard pass below (not a separate item).
5. ✅ **A Home card** — §15, **DESIGNED + BUILT 2026-09-15** ([HOME.md](HOME.md)): three mixed
   shelves (Recently Played from context runs · Recently Added, interleaved by kind, no dates ·
   a weekday/weekend × part-of-day bucket), right-click › Hide with undo, Settings › Home.
   Local but for a first-time artist photo (one call each, once ever). New in Rust:
   `added_at` + `added_at_map` (the add clock starts now) and `artist_photos`.
   Desk test: the three shelves; a playlist run shows as ONE playlist tile; Hide + Undo;
   Hide then play the same thing (it comes back); Settings › Home › Clear.
6. ✅ **A durable History card** — §16, **BUILT 2026-09-15**: reads `play_events` (14 days, 200
   rows) at mount and re-reads the last two hours on every log write; the card keeps its shape
   (hero + Previously), each row carries the time and a skip mark, and Settings › Playback ›
   *Show the day in History* (default off) puts the day in the row's subtitle. No Rust change.
7. ✅ **The playlist creation flow** — §11 → **§19, BUILT 2026-09-15, shipped in 0.6.3**:
   `Add to Playlist ▸` reached the four cards that lacked it (the Queue's rows and its Now
   Playing hero, History, the Now Playing cover) — which also means a station song files like
   any other, so "save a station's songs" is not needed. And **multi-select**
   (`src/row-pick.ts`): Ctrl+click, Shift+click, Ctrl+A, Escape. A picked set drags as ONE
   payload and right-clicks to *Add to Playlist ▸ New Playlist…*. A second pass the same day
   (§19d) took it to **every list in the app**: Library tiles (albums, artists), the Playlists
   overview, the Search card (results and drill panes), Rewind (not artists), plus *Remove N
   songs from Playlist*. Off in mini. **Shipped as 0.6.3, published to the `deetsmusic`
   channel 2026-09-15** (commits `13b879b` + `bb465ce` + `596e845`).
   No Rust change, so no dev-runner restart. Desk test: Ctrl+click five songs in the Library
   (the fill, the count row), Shift+click a run, sort the list (the picks hold), drag the set
   onto a playlist row (the ghost's count), right-click → New Playlist…, Escape; then the
   same in Up Next (Remove N songs) and History; and check mini picks nothing.
8. ✅ **A sleep timer** — §17, **DESIGNED + BUILT 2026-09-15 (branch `wakin-up`), desk-tested
   and shipped as 0.7.0, published to the `deetsmusic` channel 2026-09-16** (with §20 the
   full-time volume bar, §21 the fancy scrubbers, the hover-hint pass and the graphics ruler;
   `main` at `a129c86`). Next: the fancy-scrubber performance eval on `dev:built`.
   As built: an alarm clock left of the volume pill; its panel is a kitchen-timer dial
   (one turn = 120 min, 5-min clicks, turns back once a second), *End of song* / *End of Up
   Next* chips, a wind-down pill (the volume sinks over the last minutes, then the pause) and
   an every-day schedule (Sunset from the time zone, or a set time). The fade is a gain factor
   in `player.ts` (`setDuck`), never the stored level. No Rust change. Desk test: §17's list.
   **2026-09-16, same branch:** the Vol. pill now **grows in place on hover and scrubs
   there** (§20, fork A — the flyout is gone; mute and AirPlay sit in the grown pill), and
   the traffic lights follow Windows' order (minimize, maximize, close).
Not possible on this platform, so not planned: lyrics, crossfade, remove from
library (§12–§17 header). (Apple's Sound Check itself is not reachable; Match loudness in the Sound
panel does the same job in-app, SOUND.md §3A.) Spotify (PROVIDERS.md) is parked: Spotify's dev-mode terms block it. The vinyl disc
(VINYL.md) waits behind items 1–3.

**2026-09-15 — Authenticode signing (Azure Artifact Signing): WORKING, tested —
[RELEASE.md §6.9](RELEASE.md).** Signed 0.4.4-t1 and t2 were built and published to
`deetsmusic-test`; t1 was installed by hand and updated to t2 by itself; all installed exes are
Valid. `release-check` §4 no longer checks `target\release\DeetsMusic.exe` (Tauri writes the
unsigned original back after bundling). (That test build is long gone: the PC has run real
releases from the `deetsmusic` channel since 0.5.0.)
Earlier notes: Identity validated, profile `deetsmusic` made (CN `Aditya
Sundaram` = `bundle.publisher`, no change). Auth = app registration `Deets Release Signing`,
secret in Credential Manager `DeetsMusicAzureSigning` (user chose this over `az login`, so a
Claude session can run a release; expires 2027-03-14). Built: `scripts/sign.mjs` (signtool +
Microsoft's dlib from `%LOCALAPPDATA%\DeetsTools\artifact-signing`); `release.mjs` signs the CLI
after `cli:build` and passes the exe/installer `signCommand` in a temp `--config` file
(`tauri.conf.json` unchanged); `release-check.mjs` §4 requires a Valid, timestamped signature
with CN = publisher on all three; `scripts/cred-write.ps1` saves a secret safely.
`artifact-signing-cli` was rejected (needs the Azure CLI). Not committed.

**2026-09-14 — playlists §10.9, BUILT, not desk-tested: [PLAYLISTS.md §10.9](PLAYLISTS.md).**
Import to Edit (a mirror row's right-click or its hero cover; your own Apple playlist stays
linked as one row), Add to Playlist ▸ lists your own Apple playlists with the sigil (the
first add asks once), and the list splits into Local Playlists / Your Apple Playlists. New
Rust commands `playlist_import` + `apple_playlist_add`: **restart the dev runner.** Desk
test: import one of your own playlists (one row, Send New Songs), import an Apple mix
(unlinked), add a song to a throwaway Apple playlist (a REAL Apple write, the question
first), turn Export playlists off (the Apple rows leave the menu).

**2026-09-14 — the playlists wrap-up, BUILT, not desk-tested: [PLAYLISTS.md §10](PLAYLISTS.md)
"As built".** Drag to reorder (`src/row-drag.ts`, now shared with the queue), rename, the
*Apple Music ▸* menu (Send New Songs · Get New Songs · Make a New Copy), a red delete confirm,
named skipped uploads, covers served as `http://cover.localhost/` links, the README note, and
the Replay guard (`role`). **Schema v5; Rust changed: restart the dev runner.** Desk test: drag
in a short and a >200-song local playlist, drag the queue (it moved to the shared module),
rename, delete with songs, a Replay's menus, Get New Songs on an exported playlist (a real
Apple READ). Later: Import to edit, adding straight to Apple playlists (first-add confirm), a
separate Local Playlists section (§10.9). Idea raised: drag songs from any card into the Queue
(not designed).

**2026-09-14 — Playlist covers + Export to Apple Music: BUILT, not desk-tested** (branch
`optimus-deets`). The hero cover of a local playlist is a button (Choose Image… / Remove
Cover / Export ▸) and a file drop target ([NEXT-VERSION.md §2](NEXT-VERSION.md)). Export ▸
makes an Apple copy or adds new songs to it, and asks before a write Apple can't fully copy
([PLAYLISTS.md §6](PLAYLISTS.md)). Settings › Apple Music › **Export playlists** (default on).
Settings › Show notices lost **Off**; a toast that asks always shows ([TOASTS.md §4](TOASTS.md)).
Same session: **Settings regrouped** (Window / Look and feel / Playback / Apple Music / Playlists /
Rewind / Connections / Bugs / About) and **`requestSetting(rowId)`** opens the card at a row
(unfold, scroll, highlight); the Add to Library and Export notices are once-notices with a
**[Settings]** button ([SETTINGS.md §3](SETTINGS.md), TOASTS.md `onceKey`).
Also: **a network drop** showed MusicKit's own in-page error box ("loadSegmentError", `MKDialog`,
not an `alert()`) beside our offline toast. Fixed with `suppressErrorDialog: true` in both
`MusicKit.configure` calls, and the stopped song now **resumes where it stopped** when Apple
health next finds the network back ([TOASTS.md](TOASTS.md) §Apple health, offline row). Not yet
tested against a real Wi-Fi drop.
**Rust + `tauri.conf.json` changed: restart the dev runner.** An export is a REAL Apple
write — test with a throwaway playlist and delete its copies in the Music app.
**Export desk-tested the same night:** the first tries made empty copies because Apple's create
reply is gzip-compressed (fixed: `reqwest` `gzip` feature). An exported playlist now lists as
one row (the local one; the linked Apple copy is hidden), with the Apple Music sigil, the
copy's Apple artwork when it has no cover of its own, and "Exported on <date>" in its hero.

**2026-09-13 — Apple terms + D.7 pass, built, NOT yet desk-tested or deployed** (branch
`toast-time`; decisions and the origin probe in [RELEASE.md §7](RELEASE.md) "Revised
2026-09-13"). App: Apple Music icon on the playlist badge, Settings › About notice, README
privacy + trademarks, real MusicKit `app.build`, MUT redacted in the log, `Origin:
http://tauri.localhost` on every Rust call to Apple, sign-in on fixed ports 47831–47833,
refresh margin 3 days. Worker (`../DeetsSupport`, uncommitted, **deployed 2026-09-13**,
version `5771f7e5` + secrets): 14-day shared token per 7-day window, `mint_counts` table
(created with `--command`; `--file` imports fail with auth error 10000), `TOKEN_ORIGINS`
claim built but empty. **Key rotated:** the Worker signs with **`63Y9S9P5Z8` (DeetsMusic
PRD)**; `22CB27A4ZK` is **revoked**. Dev signs with **`WPYRNBYCRT` (DeetsMusic DEV)** —
`src-tauri/secrets/apple.json` points at it (the old `.p8` stays in that folder). Right after
the revoke Apple answered inconsistently for a while (the PRD Worker token flipped 200/401,
the brand-new DEV key returned 500, a local PRD token with the same claims got 200) — read as
Apple propagating the key changes; re-verify both keys before trusting either.
Every `.p8` is copied to `Documents\Deets' Secrets` (README there maps ids → apps;
`5685728SWS` is DeetsRadio). **Never delete a `.p8`.** Note: 0.3.0 installs keep a 15-day
margin, so against 14-day tokens they refetch on every launch until they update.

**2026-09-13 — Apple health: say why Apple Music stopped, heal without the user, NOT yet
desk-tested** (branch `toast-time`). Found live after the key rotation: MusicKit showed
"Unable to prepare for playback." as a native dialog, the Account row still said Connected,
the sign-in page said "Error: Unauthorized", and a play-only install never healed (only a
Rust call triggered the token refetch). Built: `apple_check` (which token Apple rejects, with
the bounded heal) + `apple_auth_status` (the page reports failures) in `apple.rs`;
`apple-health.ts` (one toast per cause, Account row states, 5-min recheck while Apple-side);
`requireSignIn` on every play path; every MusicKit `alert()` routed to player.ts; play retry
after a heal; the Worker `notice` shown at launch. Bounds and copy: [TOASTS.md](TOASTS.md)
§Apple health rows. **Rust changed: restart the dev runner.** Test: sign out → play (toast +
Sign in button); sign in; the installed 0.3.0 stays as it is until a new installer. The
hosted sign-in (DATA-ARCHITECTURE §2a, another session) can reuse `apple_auth_status`.
**Sign-in error routes closed (2026-09-13, same day).** Found live: MusicKit revokes its token
after one auth error and its `_webPlayerLogout` can log the token out AT APPLE; the loopback
page then returned that dead token from its own storage and said "Done!". Built: the page
clears its storage before MusicKit loads; Rust checks a delivered token (`/v1/me/storefront`
403 → failed sign-in, not saved); a `/v1/me` 403 anywhere emits `apple-signin-rejected` →
"Apple Music signed you out" (the launch-time sync no longer fails quietly); the restore
re-injects only when the health check says the sign-in still works; sign-out clears
MusicKit's in-memory token (`musicUserToken = ""`, no logout call). Decided: keep MusicKit's
own logout (option B); disabling it would modify MusicKit JS internals (Apple DPLA §3.3.6.D.1).
**Never call `__music.unauthorize()` in a test** (RELEASE.md §1a).
Then, found in the desk test: a sign-in after MusicKit had dropped its token left MusicKit
unauthorized until a restart (only `initPlayer` injected the token, and the failed plays
raised no error — MusicKit showed only its own dialog). Built: Rust emits
`user-token-changed` on capture (and clears the cached health answer), player.ts injects the
new token at once, and `requireSignIn` restores MusicKit before a play when it is signed in
but unauthorized. **Desk-verified 2026-09-13 in the dev app:** launch with a dead token →
"Apple Music signed you out"; Sign out → play → sign-in toast; Sign in → Apple's real screen
→ a song played with no restart. Shipped as **0.3.2**.

**Next version — the hosted sign-in page (DATA-ARCHITECTURE §2a) must handle these odd
cases, not only the happy path.** Carry every lesson from today into its design and desk test:
(1) never reuse a stored token (clear storage before MusicKit loads); (2) the app checks a
delivered token (`/v1/me/storefront`) before saving it; (3) a failure the page sees reaches the
app at once (`AuthStatus::Failed`), including Apple's `AUTHORIZATION_ERROR` on a closed window;
(4) a stale or second tab never says "Done"; (5) a token Apple logged out (MusicKit's own
`_webPlayerLogout`) leads to a working re-sign-in, not a loop; (6) the page says in plain words
what happened and what to do, for each of these; (7) Apple's post-rotation flapping (200/401
for 15+ min) does not end in a saved dead token. Test each one on purpose before shipping it.

**2026-09-13 — Library virtualization (option A, windowing): BUILT on `optimus-deets`,
measured, scripted checks pass, desk-tested and shipped (7dbf56f).** `src/collection-window.ts`; how it
works: UI-ARCHITECTURE.md §"Long lists: windowing"; before/after and the hand-test list:
**[LIBRARY-VIRTUALIZATION.md](LIBRARY-VIRTUALIZATION.md)** §Results (skin flip 395–558 →
16–40 ms; cold grid drag 75–82% dropped with 345 ms long tasks → 1–4%, worst 8–21 ms; DOM
23k → ~1k nodes). **Next RAM lever, documented not built:** WebView2 `MemoryUsageTargetLevel`
Low while hidden / minimized — DEBUGGING.md §"Memory: where the installed app's ~386 MB goes". Proven fallback if A stalls: option B (`content-visibility: auto` on rows / 60-tile
blocks), measured in DEBUGGING.md. Also shipped that day: the ambient skin layers
(compositor-only, `--ambient-fps`, paused when hidden) and Settings › Window › **Animate
backgrounds** — both need a fresh installer to reach the installed app.

**2026-09-13 — Hosted sign-in page + deep link: BUILT, Worker DEPLOYED (version
`0ef715d2`, 18:40), desk-tested end to end in Edge the same night** (branch `optimus-deets`). The browser sign-in now opens
`https://music-api.deets.solutions/signin` (the Worker's `/health` answering), else the
loopback page. The page returns the MUT with a `deetsmusic://auth?n=<nonce>&mut=…` link
(a debug build: `deetsmusic-dev://`), so the MUT never passes through the Worker. As built,
with the differences from the plan: **[DATA-ARCHITECTURE.md §2a](DATA-ARCHITECTURE.md)**;
test seams: DEBUGGING.md §Sign-in. Files: `apple.rs` (`begin_hosted`, `handle_link`,
`accept_token`), `lib.rs` (single-instance argv → `handle_link`; debug registers its
scheme), `plugins.deep-link` in both Tauri configs, `apple.ts`/`main.ts` (`connect(local)`,
the "Use local sign-in" link under the Account note), `scripts/signin-assets.mjs`
(`npm run signin:assets` copies the app's look into `../DeetsSupport/src/signin/`), and in
`../DeetsSupport`: `src/signin.js`, `wrangler.jsonc` rules, the router (uncommitted there).
**Verified in the dev app against a `wrangler dev --remote` preview:** the page renders
themed; every link case (stray, wrong nonce, replay, `error=`, refused token, real token
→ Connected, a hosted link after the local page took over); the Worker-down fallback; the
Account-row link. **Not yet verified (needs Apple's own window, the user's step):** Apple's
popup → the automatic `deetsmusic-dev://` return in Chrome and Edge, the Return button, the
Access Request screen's host name + icon, browser history not keeping the link, and a
Worker-page MUT (PRD key) working with the DEV key (§2a desk-test list). **Deployed
2026-09-13 evening** (`npm run signin:assets`, then `npx wrangler deploy` in `../DeetsSupport`;
that repo's changes are not committed yet). The live page answers at
`music-api.deets.solutions/signin`; a build falls back to the loopback page only when that
GET fails. Same evening: the Account button cancels a waiting sign-in on a second click,
and the local page reports its own close (§2a "Cancel"). **Desk test result (2026-09-13,
late): the full hosted sign-in works in Edge** — dialog → Open → Connected. The earlier
"Edge drops the link" was not a browser or app bug: the dev app had been launched from a
Claude desktop session, whose MSIX package redirects registry writes into a private hive,
so the scheme was never really registered (§2a "RESOLVED"; Known gotchas below). A
successful sign-in now shows "Sign-in complete! Enjoy!" (`success`, `all` tier). The
DeetsSupport page's "Signed in" copy was shortened to match; **it needs `npx wrangler deploy`
in `../DeetsSupport`**. Keep the loopback page for one release as decided (§2a fork 5).

> **Committed means tested.** Aditya runs the app constantly and tests as he goes, so
> anything already committed works unless this file says otherwise. Confirmed in use
> 2026-09-11: the extension, the mini/midi/max layouts, stations, and the CLI. Do not
> label committed work "untested" or add a test step for it to a roadmap.

**Public release (decided 2026-09-09, next session)** — the repo is already public and the
secret audit is clean (the `.p8`/MUT/`dev-dumps` were never committed in any branch). The
blocker is that a MusicKit key needs a **paid Apple membership**, so no ordinary subscriber can
run the app. Fix: a **Cloudflare Worker on deets.solutions mints the developer token** — long
lifetime, open endpoint rate-limited by IP, local signing kept as the dev seam. Full build
order, across all three repos, is **[RELEASE.md](RELEASE.md) §7**. Also still needed before
posting: **screenshots** (there are none anywhere), a **GitHub Release** with the installer
attached (none exist), and a plain note about SmartScreen (installers are signed from the
first release after 0.4.3, but a browser download can still warn until reputation builds —
RELEASE.md §6.9).

**Before release: polished keyboard control (added 2026-09-13).** Every action a mouse can do
must also work from the keyboard, with a visible focus ring. Known gaps: **Space does not
play / pause** (the shortcut set is Ctrl+K / Q / L / P / , only; media keys work through SMTC)
— the first key a new user presses, so it leads the pass; search result rows
are `role="button" tabindex="0"` but Enter/Space do not play them; hover-only controls (the
Search Add-to-Library square) only show on `:focus-within`. Scope still to design on paper:
a Tab order per card, arrow keys inside lists and grids, Enter/Space/Menu-key on rows, Escape
to pop a drill pane, focus return after a menu or pane closes, and the fixed shortcut set in
[NEXT-VERSION.md](NEXT-VERSION.md) (`Ctrl+K` Search and friends).

**2026-09-11 — the Worker grew into a support back end.** The mint is now one route on
**`DeetsSupport`**, which also holds the status / suggestions / issues boards, anonymous
report intake and **remote config** for every Deets app. Scope:
**`DeetsSolutions/docs/support.md`** (source of truth for the repo, hosts and schema);
RELEASE.md §7 stays the source of truth for the mint itself, and now says: **60-day token,
15-day margin, one refetch on a 401, 30 req/60 s per IP**. The app compiles in
`music-api.deets.solutions/token`, never the `support.` host.

**The worker is built and deployed (2026-09-11)** — `../DeetsSupport`, both hosts live, `/token`
smoke-tested against Apple; the repo has no commits yet. Decided the same day: config rides
`/token` from a `CONFIG` **var** (no D1 on the mint path); the app re-runs MusicKit configure
after a 401 refetch (an event from Rust); `/health` signs a throwaway token. **Step 2 is built
and desk-tested (same day: `apple.json` moved away → `source=worker`, playback fine; a dead
cached token → one 401 refetch heals search AND an already-configured MusicKit):** `apple.rs` resolves the token once in `setup()` — local key,
else `developer-token.json`, else the mint — and `api_get`/`api_post` retry once after a 401.
To test the stranger's path: move `src-tauri/secrets/apple.json` away and start the app; the
log line `token: source=worker` confirms it. **Rate-limit finding (same day):** the
`unsafe.bindings` ratelimit form is inert; use the top-level `ratelimits` key (done here and
in all five sibling workers, redeployed and pushed the same day). Then,
on this side: the rolling log file, the report form, and **My reports** in Settings. The page
design and the report fields are the user's own pass.

**0.2.2 installer built 2026-09-11 late (`installers/`), for a desk pilot the next day:** the
log, the incremental sync, deets-airplay 0.2.1 (its log rotates too; DeetsAirplay 0.1.2 was
built the same night). Branch `polish`, not yet merged to `main`.

**Logging: steps 1–4 of [LOGGING.md](LOGGING.md) built 2026-09-11, all four desk-verified
(the flush blocks, the unload flush, the incremental line `1 new in 1 page(s)`).**
`src-tauri/src/log.rs` is the rolling `<app_data>/deetsmusic.log` (512 KB × 2, dated lines,
three levels, a panic hook, JWT / `Bearer` scrubbed at the write boundary); the old
`bridge.log` is adopted as `deetsmusic.1.log` on first run and `bridge::log` is an alias.
Startup, token source, every Apple ≥ 400 (status + path), library sync, enrich batches,
AirPlay, sign-in outcomes, migration and the bridge now write to it. `diag.flush()` appends the
front-end ring on an uncaught error, on unload and from **Settings › Bugs › Open log folder**.
Still to do: step 5, the report form + My reports (support.md). **The log's first catch:** the
startup library sync was a full ~40-request pass on every launch; it is now **incremental**
inside a six-hour window (newest-first, stop at the first cached song, upsert only; the
refresh button and a stale cache still run the full pass, which stamps `meta.full_sync_at`
in the cache db) — FUTURE-SETTINGS.md §21 holds the window as a later Settings row. Also fixed that day: `npm run
dev:app` opened TWO full windows — the dev overlay's bare `windows` array replaced the real one
(JSON merge patch), so the tray label lost `tray.html` and loaded the app; the launcher now
stamps "(dev)" onto the full window objects.

**AirPlay: in v0.2.0, desk-tested in dev.** See [AIRPLAY.md](AIRPLAY.md): the sender is the
shared `deets-airplay` crate (git dependency on DeetsAirplay, pinned by `rev`; read that
repo's CLAUDE.md "Never" list before touching wire code). Decisions are locked in §5; v1 =
"All PC sound", the per-process path is parked for v2 (§10). **0.2.1 is desk-tested installed:
prompt shown, speaker plays.** Open: the firewall prompt frightens a first-time user — preface
it with an in-app confirmation or a toast (AIRPLAY.md §9 item 5; toasts exist now, TOASTS.md).

**2026-09-12 — the click-to-sound pass (branch `polish`, desk-tested via the MCP).**
Dev-only telemetry (`src/perf.ts`, [DEBUGGING.md](DEBUGGING.md)) measured every stage
from click to the media element's `playing` event, then five changes landed
([QUEUE.md](QUEUE.md) windowing, [UX-COVERUPS.md](UX-COVERUPS.md) §4–5): the track
store notifies only when a transient ingest added something and the Library card ignores
transient ingests (a full 3,895-row re-render on every click, 100–370 ms, gone); the click
click feeds the clicked song alone as a MediaItem descriptor from the cached play
parameters (`setQueue` ~5 ms; its network resolve, 130–1300 ms, gone), then grows by id
at once (8) and to 200 after 1.5 s — **MusicKit's auto-advance cannot load a descriptor
item** (found and fixed the same day: it ends with no item), so everything after the
clicked song is id-resolved; MusicKit + the Widevine module warm at idle 1.5 s after
launch; a song that fails to start heals by re-window (explicit Next, auto-advance, and a
dead id in the grow all verified). Our part of a click is now ~10 ms; what remains is MusicKit's own
teardown/lookup/license/buffering, 1.0–1.7 s warm and 1.7–1.9 s cold to audible. The
next levers were settled 2026-09-13: hover pre-insert **skipped**; the launch story is a
setting, [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) §22 *Play on launch* (last song / a
station / a playlist in order or shuffled / a song or album, plus starred playlists as a
random pool), documented, not built. Library windowing (option A) is **built** — see the
2026-09-13 entry above and [LIBRARY-VIRTUALIZATION.md](LIBRARY-VIRTUALIZATION.md) §Results.
**Same day, built and verified:** the queue **restores across sessions** — one JSON blob
in the cache db's `meta` (`queue-persist.ts`, QUEUE.md "Restore across sessions"), the
**Restore on launch** settings row (*Last song* default / *Up Next* / *Nothing*), Play
with nothing loaded resumes the restored plan. It restores the plan only: pre-feeding
MusicKit was probed and rejected (`setQueue` fetches nothing, no `prepareToPlay`;
UX-COVERUPS.md §4), so the first Play still pays the cold cost.

**The v1 push** — sequence discussed 2026-07-03 (each item still wants its own design/confirm
pass before building; the user directs):
1. ✅ **Settings card** — built 2026-09-10 as the **hybrid** ([SETTINGS.md](SETTINGS.md)):
   the title menu keeps Theme / Skin / Surface / Account + one **Settings…** row that
   summons the card; the card hosts the rehomed toggles (Always on Top, Minimize to Tray,
   hover menus, Library Add, the Extension block), eight FUTURE-SETTINGS rows (§1 §4 §5a
   §5b §7 §8 §14 §16) and the **Rewind gate** (hidden until 50 play starts). One typed
   store, `deets.settings`. In use.
2. **Release packaging** — secrets/cache out of `CARGO_MANIFEST_DIR` into proper app dirs,
   MUT into Windows Credential Manager, an installable build (the one true v1 blocker).
3. ✅ **SMTC / global hotkeys** — built 2026-09-10 as a **native session** (`src-tauri/src/smtc.rs`,
   registered on the main HWND from `setup`, fed by `np_publish`). The Chromium route was
   probed and found half-working: media keys toggled play, but WebView2 never registered a
   session, so the Win11 overlay stayed blank. The probe (`media-session.ts`) is deleted and
   Chromium's `HardwareMediaKeyHandling` is disabled in `tauri.conf.json` so a key press is
   handled once. Overlay buttons / keys / the overlay scrubber arrive as the same `np-command`
   events the tray panel sends. In use.

**Built 2026-09-08, in use** (each has its own doc — read it before
touching the area): the **tray icon + panel** and **Minimize to Tray** ([TRAY.md](TRAY.md));
the **browser extension + loopback bridge** ([EXTENSION.md](EXTENSION.md), source in
`extension/`, shipped inside the NSIS installer with a post-install prompt). The app icon is
now the DM mark (`app-icon.png` → `npx tauri icon`). The Web Store listing is the user's step.
**2026-09-09 polish:** tray left-click now pops the *app* as mini at the cursor
(TRAY.md §1; the panel moved to the right-click menu); the extension's status line
slides/crossfades instead of jumping; "Not it?" opens a mini Search card (songs +
albums, `/search`); the popup re-reads the tab every 2 s. **Pairing code dropped**: the
bridge trusts the extension's `Origin` (EXTENSION.md §3). Tray right-click *Open* now
restores the real app (full surface + pre-pop position). Mini = one wide column, one
card under Now Playing (user-led from here). **Surfaces:** all three width cutoffs are back
(mini: in < 340 / out > 350 · midi ↔ max at 820 ± 40; `minWidth` lowered to 320 so the
flip into mini is actually reachable) — the user is evaluating resize-into-mini alongside
the tray flyout and the menu pick. **Next:** the mini composition, piece by piece.
**2026-09-09, branch `maxmaxxing` (merged):** the **max composition** (stage + anchored
queue + 2×2 bento, [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) build order #4); the
mini transport row stacks its side buttons when they'd overflow; and the **agent/CLI
routes** on the bridge (`/command` `/play` `/queue` `/history`, [AGENT.md](AGENT.md)) —
plus the `deetsmusic` CLI + MCP binary in `cli/` and `npm run dev:app` for dev alongside the installed app.
**2026-09-09, 0.1.3 (installer line, user-tested):** **one instance only** — the pinned
taskbar button now activates the running app instead of starting a second process
([TRAY.md](TRAY.md) §5); *Open DeetsMusic* is one **clean cut** (hide → resize hidden →
place → show) instead of a visible grow-and-travel; the window **position survives** × and
restart (`settings.json` → `windowPos`); and the NSIS installer **stops the bundled CLI**
before install/uninstall, which is what a half-uninstall of 0.1.2 cost us
([RELEASE.md](RELEASE.md)). `npm run release` now archives each setup exe into `installers/`.

**2026-09-10, branch `release-prep` (merged):** **stations in Search** (a fifth search type,
[SEARCH.md](SEARCH.md)); the **native Windows media session** (`smtc.rs`, item 3 above); the
**radio UX pass** ([STATIONS.md](STATIONS.md) §3b — the station is Up Next's last row, Stop
Station in three right-click menus, the station resumes after a break-out block, Stop leaves
the last song paused); **Library Add now defaults ON**. Second batch, same day: the **Add to
Library square** on Now Playing (+ / spinner / ✓, [FAVORITES.md](FAVORITES.md)); the **max
stage volume row** (mute · slider · a hidden AirPlay square; the titlebar pill stays;
`onVolumeChange` in `player.ts` keeps every control in step); the **Settings card + hybrid
menu** ([SETTINGS.md](SETTINGS.md) — one `deets.settings` store, the v1 rows, the Rewind gate
at 50 play starts; **Play Now now defaults to "Song and rest of list"**). Third batch, same day: **AirPlay**
([AIRPLAY.md](AIRPLAY.md)) — `../DeetsAirplay` is now a library crate (`crates/airplay`) this app
depends on (git, pinned by `rev`); the "Play on" panel behind the AirPlay square (pill
panel in mini/midi, stage row in max), **v1 = "All PC sound"** (loopback of the default
output; the PC keeps playing), one volume slider driving the speaker, now-playing text +
cover to the speaker, no Settings rows. **Connected and played on the desk.** The per-process
"DeetsMusic only" path is built, probe-verified, and parked for v2 behind `V2_PER_PROCESS`
(AIRPLAY.md §10 lists the five things learned about it). Also that evening: **per-speaker
remembered volume** (20 % on a speaker's first use), **Settings › Agents** (Agent control
switch, default on, gating the six agent routes with a 403; "Copy setup for" Claude Desktop /
Claude Code / Cursor / Other; the plain-words [AGENT-SETUP.md](AGENT-SETUP.md)), and
**Start with Windows** (HKCU Run key, `--tray` launch starts hidden; seeded once on the first
installed run, DeetsAirplay pattern).

**Deferred, when prioritized:** **DeetsWeather** ([ideas/DeetsWeather.md](ideas/DeetsWeather.md);
its own-station premise needs a rethink — that engine was dropped) · **CLI / local-agent
control** · **mini/max surface compositions** · **virtualized scrolling** (only once libraries
get large).

---

## State of play

**Live: 0.6.2** (2026-09-15, `deetsmusic` channel, install-tested). It added the per-view
**open sizes** (Settings › Window: Mini 385 × 550, NP 405 × 675, Midi 495 × 670, Max
1100 × 820, each a floor as well as a default; FUTURE-SETTINGS §8a), the **AirPlay speaker
claim** on crate 0.3.0 (AIRPLAY.md §11 — one-directional: we write claims, we do not read
them), and two scroll/render fixes in the card engine.

### Built ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights wired to min/max/close.
- **Themes** (palette → theme → skin, all CSS-variable driven): `lilac`, `green`, `sepia`,
  `moonlight`, `black-yellow`, `black-red`. Title menu (click the title) with Theme / Skin /
  Surface flyouts, a **Settings…** row (summons the Settings card, [SETTINGS.md](SETTINGS.md)),
  and the Account row. A first launch with
  no saved choice follows the OS light/dark preference, landing on Press × Lilac or
  Retro-Future × Black & Red; retired ids (`fairy`/`glade`/`hornet`/`viper`/`desk`/`cyberstorm`)
  migrate via the `RETIRED` maps in `theme.ts` / `skin.ts` and the pre-paint script in
  `index.html` — keep all three in sync.
- **Skins**: `vanilla` (borderless + editorial underline; hidden from the picker since
  2026-09-10, block kept as the base), `press` (riso print shop —
  square trim, halftone stock, offset `--ink-2` plate), `ocean` (recessed cards + SVG wave
  trains), `glass` (frosted, drifting aurora), `retro-future` (lightning storm layer).
  Shared `[data-skin]` base + per-skin deltas; nav/motion/geometry fully tokenized (new
  capabilities like `--hover-lift` / `--panel-backdrop` default to no-ops).
- **Card + slot system** (`cards.ts`, `layout.ts`; [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md)):
  every card is a mountable registry module. Midi bento = anchored **Now Playing** + **two
  swappable content slots**, each slot's **title is a card picker** (persisted, root-only).
  **Surface seam** (`data-surface` mini/midi/max) exists with size-band resize + per-surface
  remembered sizes; mini/max inherit the midi layout until composed.
- **Apple auth**: loopback browser sign-in (themed page), MUT persisted across restarts.
- **Playback** (the load-bearing DRM risk is dead — full-song plays in WebView2): `player.ts`
  configures MusicKit JS in the webview, injects the captured MUT directly (no `authorize()`
  popup), plays. Live drag-to-seek scrubber + volume (shared `slider.ts`, persisted). Catalog→
  library id fallback; **dead-id self-healing** (stale catalog ids don't sink a feed batch).
- **Queue model** (`queue.ts`, [QUEUE.md](QUEUE.md)): history / current / upcoming of lightweight
  handles; origin-based stacking (manual picks survive a new context); backgrounded pre-click
  backlog reachable via Previous. Player keeps it **live-synced to MusicKit** (model-follow) and
  feeds MusicKit a bounded **window** with gapless **re-windowing** (forward top-up +
  Previous-past-the-edge). Manual queueing (Play Now/Next/Add) + Up-Next drag-reorder, all gapless.
- **Data**: `library_sync` pulls all songs → SQLite → **collection-card engine**
  (`collection-card.ts`) with per-context Sort/View/Search. **Lazy catalog enrichment**
  (`enrich.rs`) pulls only what you touch (palette / ISRC / previews ride every fetch). Unified
  `tracks` store on the catalog-first key (`seen`→`library` graduation). **Play-event log**
  (`play_events`, real `ms_listened`) — the un-backfillable clock is running.
- **Feature cards** (all on the collection-card engine unless noted):
  - **Library** — Songs / Albums / Artists (albums/artists derived from songs), drill-in, click
    a song to play + queue the rest in sort order. **Artists consolidate by PARSED credit**
    (2026-07-03, `src/artist-credit.ts`): a vocabulary of solo-proven names splits compound
    credits ("Drake & Future" → both; "Earth, Wind & Fire" stays whole), multi-indexed so a
    collab lands under every credited artist (placement toggle: FUTURE-SETTINGS §19). True
    catalog artist identity is still the post-v1 hydrate below.
  - **Search** ([SEARCH.md](SEARCH.md)) — standalone sectioned discovery (songs/albums/artists/
    playlists), enrichment piggyback, transient + materialized catalog tracks.
  - **Playlists** ([PLAYLISTS.md](PLAYLISTS.md)) — Apple mirror + local store; overview → detail;
    New Playlist, Add to Playlist ▸ submenu, remove-track, empty-only delete. **Folders**
    (2026-07-03, §3a): manual folders + kind auto-clusters (Your Playlists / Apple Mixes /
    From Apple Music) as collapsible sections under the Folders sort; Move to Folder ▸ files
    locals AND mirrors (local metadata, zero Apple calls). Rename, drag-reorder,
    delete with songs, mosaic covers and export / import all built 2026-09-14 (PLAYLISTS.md §10).
  - **Queue** (`qcard.ts`) + **History** (`history-card.ts`) — Now Playing + Up Next / session
    play log; shared row markup (`queue-rows.ts`).
  - **Rewind** ([DEETS-REWIND.md](DEETS-REWIND.md)) — listening leaderboard (stat × time-window)
    over the play-event log.
  - **Radio** ([STATIONS.md](STATIONS.md)) — Apple's live / My Station / Discovery / genre
    stations as shelves (Recently Played · For You · Live · Genres); activate → **radio-mode
    playback** (station queue owned by MusicKit; break-out to a finite queue at the song
    boundary; transport caps + LIVE marker; station plays populate History/Rewind durably).
    Data: `radio.ts` + `radio_live`/`radio_my_station`/`radio_discovery`/`radio_genres`/
    `radio_genre_stations`/`radio_seed_station`/`catalog_song_artist` in `apple.rs`. **Seeded
    "Start Station"** right-click verb on every song surface + artists (Search, and Library
    Artists tiles via a lazy two-hop song→artist-id resolve — `src/start-station.ts`, gated
    builders, session-cached). **The own-station generator engine (Deezer BPM, scope toggle,
    thumbs) is DROPPED** — Apple curated is the whole radio story; §4 of the spec is
    research-record only.
- **Album Color** ([ALBUM-COLOR.md](ALBUM-COLOR.md)): real Apple palettes → `--album-*` runtime
  roles → the rotating Now-Playing aurora (Glass-only display).
- **Add to Library** ([FAVORITES.md](FAVORITES.md)): ➕ add a catalog song/album to iCloud Music
  Library, gated behind the **Library Add** settings toggle (default on since 2026-09-10), on Search / Playlists /
  **Queue / History** right-click menus (incl. the now-playing hero). Apple's API is add-only.
- **Go to Artist / Go to Album** (2026-07-06, [SEARCH.md](SEARCH.md)): drill-in right-click verbs on
  **every** song/album surface (Search, Library, Playlists, Rewind, Queue, History, Now Playing —
  NP gained its first menu). Shared builders in `src/go-to.ts`; the id hop is `catalog_related` in
  `apple.rs` (session-cached via `catalogRelated`). Most surfaces route to the **catalog** detail in
  the Search card; the **Library drills IN-PLACE** over the user's library (`LibNav` in
  `library-card.ts`). In-place vs Search is a toggle: FUTURE-SETTINGS §20.

- **2026-09-15 — one hover-hint box** ([ONBOARDING.md](ONBOARDING.md) §1a): `src/hint.ts`
  replaced the native `title` tooltip everywhere — a themed box in the menu material, with a
  second line, so a cut-off song row shows the full song AND artist. **Central by adoption:**
  no call site changed. The engine sweeps every `title` into `data-hint`, removes the
  attribute, and a MutationObserver keeps doing it for new nodes and later `title` writes, so
  all 81 hint sites (68 in markup, 13 set from code) moved in one step. Row hints come from a
  shape table (`SHAPES`), one delegated handler covering Library, Search, Queue, Rewind,
  History, Home, the Artist shelves and Now Playing. Three Settings rows: Show hover hints,
  Hints appear after, Name songs on hover. Shipped in 0.7.0 (2026-09-16).
- **2026-09-15 — Press record player** ([VINYL.md](VINYL.md)): Record player Spin / Still / Off
  (default Off), Show record on, Spin speed (33⅓ / 45 / 78, default 33⅓), Show record plate. The
  cover (Now Playing + tray panel) turns at the chosen rate, locked to the song so each disc starts
  and ends upright at any speed; song changes slide the discs.
  Four desk-test rounds, each fault found with the new dev telemetry (`[perf] vinyl show / snap /
  song`, `__vinyl.sample`) and a computed-transform angle trace (VINYL.md §8–§9). Open: the frame
  cost of a full-rate spin (its own optimization session); Apple artwork-rule reading in §10.
  Committed db65b5c, shipped.
- **2026-09-15 — skin-only settings** ([UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) §3 *Skin-only
  settings*, [SETTINGS.md](SETTINGS.md) §3): Look and feel rows that show only under their
  skin (`when` + `onSkinChange`), a new **range** (slider) row kind, and `src/skin-settings.ts`.
  **Glass** (user: "perfect"): Canvas glow · Dim canvas · Backlight · Tint cards. **Ocean**: Draw
  card edges Soft / Sand (grainy card edges, off by default) + Sand width. Awaiting a full desk
  pass on Ocean.
- **2026-09-14/15 — self-update + signed releases** ([RELEASE.md](RELEASE.md) §0, §6, §6.9):
  `tauri-plugin-updater` behind the DeetsSupport Worker + R2 (`deetsmusic` and `deetsmusic-test`
  channels; Settings › Updates Automatic / Ask / Off, Skip, Roll back within a channel group,
  `minVersion` for a required update); shipped in 0.4.3. Every build is signed twice: the
  updater `.sig` (minisign key) and Authenticode via Azure Artifact Signing (`scripts/sign.mjs`).
  Tested end to end with a signed t1 → t2 update on the test channel.
- **2026-09-13 — toasts** ([TOASTS.md](TOASTS.md)): the primitive, the `toasts` tier
  setting, and the ten call sites above. Desk-tested and shipped; every later call site is a row in TOASTS.md §5.
- **2026-09-12 — the NEXT-VERSION batch, all desk-verified** ([NEXT-VERSION.md](NEXT-VERSION.md)):
  search pins · playlist covers (user / Apple / mosaic; schema v3 `cover`) · ♥ favorites
  (`favorites.rs` + `favorites.ts`, seeded from Apple's Favorite Songs; the Library ♥
  filter) · weekly Replay (`replay.ts`, three Playback rows) · Search square + Ctrl
  shortcuts · theme/skin View Transitions (`appearance.ts`) · album-colored NP text with
  the contrast guard (Glass) · Glass menus at 90% · explicit badge. Surface-change motion
  (fork B) was tried and walked back the same day (NEXT-VERSION §10). **Next talk: the
  playlist creation flow** (NEXT-VERSION §11).

### Not built yet ⬜
- **Two services, one library (2026-09-15) — PARKED.** Designed in the morning
  (**[PROVIDERS.md](PROVIDERS.md)**), stopped the same day after the Spotify facts were checked
  (its §9): the owner needs Premium, the ISRC is gone so there is no merge key, search is capped
  at 10, and Developer Policy III.5 forbids mixing another service's content. Reopen only if
  Spotify's dev-mode terms change.
- **The listening-loop items (2026-09-15)** — repeat · Play / Shuffle on a collection · a
  shuffle mode (open question) · Space + the keyboard pass · a Home card · a durable History
  card · the playlist creation flow · a sleep timer. **[NEXT-VERSION.md §11–§17](NEXT-VERSION.md)**
  and "Next up" above. (NEXT-VERSION §1–§8 are built; ♥ favorites shipped there 2026-09-12.
  **Ratings / 👎 are off the roadmap.**)
- **Real album/artist data + artist photos in the Library card** — Library's Albums/Artists are
  derived from song artwork + initials (Search's artist drill already shows real photos). Scoped
  2026-07-03: **bigger than it looks** — the Artists overview shows hundreds at once, so lazy
  per-touch enrichment can't fill it (needs an eager one-time backfill, a deliberate exception
  to the enrichment doctrine with a §14-style opt-out) *and* it needs new schema (artist cache
  table), so it should bundle with the deferred schema-versioning work as one post-v1 pass.
  (Start Station on artist tiles does NOT wait for this — shipped via the lazy two-hop resolve.)
- **Play on launch** ([FUTURE-SETTINGS.md §22](FUTURE-SETTINGS.md)) — documented, not built.
- **The AirPlay claim guard (2026-09-15)** — the speaker-sharing work
  ([AIRPLAY.md §11](AIRPLAY.md)) is **one-directional**, and this is the missing half.
  DeetsAirplay (the tray sender, the same crate underneath) reads the machine-wide claim file
  and refuses — or offers a **Take over** on — a speaker this app is holding. This app *writes*
  a claim but never *reads* one, so it will still connect straight over a speaker DeetsAirplay
  has, and the user gets a SETUP failure with nothing in it to act on. A receiver takes one
  sender; whoever loses that race loses it silently.
  - **Already done, so this is a one-function job:** the pin is at crate **0.3.0**
    (`d735d14b213a79b9af2206cab9bfde689324b093`, bumped for 0.6.2) so `claim` is in scope, and
    `start_live` already calls `session.describe_send(...)` — `Send::All` for the default-output
    capture, `Send::Apps([exe])` for the per-process path. We write a complete claim. We simply
    never look at anyone else's.
  - **The guard**, in `connect_speaker` (`src-tauri/src/airplay.rs`, right after the
    `AirplayState` is taken and before `stop_live`) — the mirror of the one in DeetsAirplay's
    own `src-tauri/src/lib.rs`:
    ```rust
    if let Some(other) = claim::on_speaker(&speaker.name) {
        return Err(format!("{} is already playing on {}.", other.app, speaker.name));
    }
    ```
    `connect_speaker` already funnels a failure into `state.error`, which the dropdown's state
    line shows, so the sentence reaches the user with no UI work. `claim` reports only a process
    that is *actually alive* (pid **and** exe name must match), so a crashed sender never leaves
    a speaker looking taken, and `on_speaker` never returns our own claim.
  - **Say it better than a refusal:** the claim carries `send`, so when the holder is
    DeetsAirplay sending `Send::All`, our audio is *already on that speaker* — the honest line is
    nearer "DeetsAirplay is already sending this PC's sound to Living Room" than "you can't".
    `other.send.carries("deetsmusic.exe")` answers that directly.
  - **The limit, deliberately:** we can offer no "Take over" of our own. DeetsAirplay has no
    bridge for us to ask, so the guard can only name the holder and leave the user to disconnect
    it there. Giving it a listener is a bigger decision than this entry — don't smuggle it in.
- Built since this list was written, so no longer here: the hosted sign-in page + deep link
  (2026-09-13), the CLI / agent control, the mini and max compositions, library windowing,
  playlist rename / drag-reorder / export.

---

## Measuring graphics (2026-09-16)

`npm run dev:app` is a poor stand-in for the installed app when the question is draw cost.
DevTools **auto-opens in dev and renders in the app's own GPU process**, and vite serves
unbundled JS with many `<style>` tags. So:

```
npm run dev:perf                          # dev, DevTools held shut
npm run dev:built                         # release-shaped bundle, DevTools shut  <- measure here
npm run dev:built -- --gpu=off            # and pretend the machine has no GPU
npm run bench appearance -- --passes 3    # repeatable; refuses to run on a noisy machine
```

Three rules learned the hard way, all in DEBUGGING.md:

- **Judge by frames / ms, never the main-thread trace alone.** `will-change` on the rising
  panels cut style recalc 766 -> 260 ms while delivered frames fell 229 -> 50 fps: the cost
  moved to raster, where the main-thread view cannot see it.
- **Check the `@N Hz` and `[perf] gpu` lines first.** A stale refresh sample once judged a
  244 Hz display as 34 Hz, making every drop percentage wrong in the forgiving direction.
- **One reading from this PC means nothing** — the same switch measured 36 to 236 fps run to
  run. That is what `bench.mjs` and its noise gate are for.

Where it is heading: FUTURE-SETTINGS.md §25, settings for the heaviest features.

**Graphics pass 2026-09-16 — PAUSED, uncommitted** (the user moved other work ahead of it):
- ✅ **Fancy Glass** (Settings › Look and feel, Glass only, default off): the painted frost with a
  still aurora and locked sliders 65 / 85 / 40 / 10, or the live blur and the sliders. Built,
  typechecked, **awaiting desk test**. SETTINGS.md row; numbers in DEBUGGING.md §Fancy Glass
  and the Ocean swell.
- 🟨 **Composited card lists** (`--scroller-layer`, Ocean / Glass / Retro-Future only): built,
  half checked. What is done and what is left: DEBUGGING.md §The composited-scroller pass.
- ⬜ **Swell:** measure Animate backgrounds › Reduced under `--gpu=off`, then maybe a hint line.
- ⬜ Found on the way, older than these changes: a very fast wheel spin (≈ 15,000 px/s) shows
  blank rows in the windowed Library for a few frames (collection-window.ts fills its buffer only
  after the scroll pauses).

## Known gotchas
- **Registry writes from a Claude desktop session are not real (2026-09-13).** The Claude
  app is an MSIX package: every process it starts — its shells, and `npm run dev:app` run
  from them — writes `HKCU\Software\Classes` into a private hive. Those processes read the
  keys back; Edge and every other program do not. This hid the `deetsmusic-dev://` scheme
  for a whole session of "Edge drops the link". Anything that must reach the real registry
  (the deep-link scheme, file associations) has to be written, and checked, from a process
  started outside the package — the user's own terminal, or WMI (DEBUGGING.md §Sign-in).
- **The tray flyout hides the taskbar button, and that used to spawn a second process** —
  `set_skip_taskbar(true)` on a pop (and a hidden window after × to tray) leaves Windows
  nothing to match the pinned shortcut against, so a click on the pin *launched* the exe
  again: second tray icon, second writer on the SQLite file, bridge failed over to port
  47826. Fixed by `tauri-plugin-single-instance`, which **must stay FIRST in the builder**
  (`lib.rs`) or the duplicate opens the DB and takes a port before it's turned away. Its
  callback is `tray::show_main`. See [TRAY.md](TRAY.md) §5 — including why two DeetsMusic
  taskbar icons in dev are expected, and why a debug build flashes a console.
- **A running `deetsmusic mcp` blocks install and uninstall** — Windows won't replace or
  delete an open file, and the CLI is long-lived (an MCP session lasts as long as the agent).
  Uninstalling 0.1.2 removed the registry entry and then left every file on disk. The NSIS
  `PREINSTALL`/`PREUNINSTALL` hooks stop it by path; see [RELEASE.md](RELEASE.md) §3.
- **No in-app OAuth popups** (Tauri/WebView2) — auth is browser-loopback by design (via
  `tauri-plugin-opener`, cross-platform); don't try to "fix" `authorize()` in the webview.
- **Liberation + skin fonts aren't on Windows** — bundled locally; the loopback page serves them
  too (embedded) so it matches the app.
- **Dev-oriented paths**: secrets/cache resolve from `CARGO_MANIFEST_DIR`; release needs them in
  proper app dirs + the MUT in Windows Credential Manager. `dev-dumps/` holds **real account
  data** — gitignored, don't commit.
- **Playback transport races (MusicKit)** — three load-bearing rules, all in `player.ts`:
  - `changeToMediaAtIndex` **already starts playback**: never `play()` after it, and never call
    `changeToMediaAtIndex(0)` on a fresh queue (setQueue sits at 0 — the call makes MusicKit
    double-play against itself). `play()` belongs only on the pos-0 path, guarded by `!isPlaying`.
  - **Leaving a station needs `stop()`, not `pause()`** — a paused continuous controller stays
    primed to advance and AbortErrors the next `setQueue`. The station break-out loads with
    `stopFirst` + `noBack` (block at index 0, clean pos-0 path).
  - MusicKit re-issues `play()` on its **own un-awaited promise chains** during transitions,
    surfacing benign "Uncaught (in promise)" races we can't try/catch. A scoped
    `unhandledrejection` filter (`installMusicKitRejectionFilter`) swallows exactly two messages
    (`play() without a previous stop()/pause()`, `interrupted by a new load request`); everything
    else propagates.
- **Stale catalog ids reject whole feed batches** — `setQueue`/`playNext`/`playLater` are
  all-or-nothing; the player self-heals (session denylist + library-id fallback + rebuild/retry;
  `player:deadIds` diag). See [QUEUE.md §Dead ids](QUEUE.md).
- **Catalog tracks resolve through two layers** — the track-store `transient` map (session
  display) and Rust `source='seen'` rows (durable stats joins). `handlesFrom` feeds both on every
  play; `loadTracks` ingests seen rows at startup. Station plays go through `stationFollow`, whose
  gate skips only the **station container** (`ra.…`) item — NOT on kind/type (station-fed songs
  don't reliably report `kind:"song"`, and gating on it silently dropped every station play from
  history). If a catalog/station song shows "Unknown", that funnel broke, not the queue/log.
- **Model-follow keys off `music.queue.position`** (replays `advance()`/`previous()` on position
  change, suppressed during (re)loads via `loadingContext`, and off entirely in radio `mode`). If
  a MusicKit build reports position differently, fall back to matching `nowPlayingItem` by id.
- **Covers self-heal — don't add per-`<img>` onerror** — emit the `<img>` with a bare `data-art`
  marker; one capture-phase listener in `artwork-heal.ts` owns all retry (backoff + cache-bust +
  focus/visibility resume sweep). Chromium negative-caches a failed cover, so this is the only
  thing that recovers a sleep/wake-killed image.
- **Transport latency to cover up** — nav within MusicKit's window is gapless; anything **outside**
  it (rewind past the backlog, seek, scrub a DRM stream) forces a fresh `setQueue` and **buffers**.
  Needs a UX cover-up (loading state / optimistic icon), not a silent freeze. See [UX-COVERUPS.md](UX-COVERUPS.md).
- **Collection-card CSS traps** — the list/grid density hook is `data-grid`, NOT `data-density`
  (the buttons use `data-density`; reusing it makes the click handler swallow every tile click).
  Restore scroll *after* a pane mounts (in `slide()`), never while detached. `.coll-pane`'s
  transform traps `position: fixed`, so Sort/View popovers **portal to `<body>`**. Every card
  renders music through **`musicCell`** (row-vs-tile + density in one place) — keep new cards on it.
- **Added-Date needs a re-sync** — old cache rows lack `addedRank` until a refresh re-fetches with
  `sort=dateAdded`.

---

## Key decisions (the "why")
- **Data ≠ playback** — library fetching is plain REST (no DRM); the whole data layer was built
  without touching the DRM question.
- **Full-song DRM plays in WebView2** (confirmed) — MusicKit JS in the renderer, MUT injected
  directly. The MUT necessarily reaches the renderer for this one path.
- **Queue model is the source of truth**, decoupled from MusicKit; the player feeds MusicKit a
  bounded window (cheap setQueue + gapless play) and mirrors position back. Lightweight handles
  (ids), not full Tracks — cheap on huge libraries; metadata resolves via the shared track store.
- **Normalization in a Rust `MusicProvider` trait** — UI is provider-agnostic (a second provider
  slots behind the same seam; only playback is MusicKit-specific).
- **Unified `Track`** with both IDs optional (not split library/catalog types).
- **Persisted SQLite cache + sync-on-open** (stale-while-revalidate) — instant launches, offline
  browse; ~76 polite calls per refresh.
- **Loopback browser auth** as the permanent flow, not a workaround.

---

## File map
```
index.html                  home markup (titlebar, settings menu, bento)
swatch.html                 standalone color reference
src/main.ts                 window controls, settings menu, account, toggles, initLayout
src/cards.ts                card registry + CardDef/CardInstance (mountable-card contract)
src/layout.ts               midi layout: anchored NP + 2 swappable slots + picker + slot LRU
src/layout-bus.ts           card-summon bus (requestCard/onCardRequest)
src/now-playing-card.ts     Now Playing transport strip (+ radio LIVE caps)
src/collection-card.ts      reusable navigable browser engine (contexts/groupings, Sort/View/
                            Search, push/pop pane-slide, list(view) state hook)
src/library-card.ts         Library contexts/groupings + drill-in; shared musicCell + trackMenu
src/artist-credit.ts        credit-string parser: vocabulary-gated split → consolidated Artists
src/search.ts / search-card.ts    catalog search data + Search card (SEARCH.md)
src/playlists.ts / playlists-card.ts   playlists data + card (PLAYLISTS.md); Add-to-Playlist ▸
src/qcard.ts                Queue card: Now Playing + Up Next + jump-to-item + right-click menus
src/history-card.ts         History card: the durable play log (hero + "Previously")
src/queue-rows.ts           shared queue-row rendering (entry→Track resolve, .qrow markup)
src/rewind.ts / rewind-card.ts    Rewind data + leaderboard card (DEETS-REWIND)
src/radio.ts / radio-card.ts      Radio data (session cache + recents) + stations browser card
src/library-add.ts          Add-to-Library toggle + gated menu-item builders (FAVORITES.md)
src/start-station.ts        seeded "Start Station" gated menu-item builder (STATIONS.md §2)
src/go-to.ts                "Go to Artist/Album" menu-item builders + drill-intent bus (SEARCH.md)
src/player.ts               MusicKit engine: init/MUT-inject, windowed loadFromModel, transport,
                            model-follow, radio mode (playStation/stationFollow/stopStation)
src/queue.ts                queue model (history/current/upcoming, backlog, stacking, radio ops)
src/track-store.ts          shared in-memory library: one load, id→Track index + notify
src/row-pick.ts             multi-select over rows (Ctrl / Shift picks; NEXT-VERSION §19)
src/stats.ts                play-stats recorder: partial/full counters + play-event log
src/album-color.ts          NP aurora data path: current album palette → --album-* inline
src/context-menu.ts         shared popover: cursor/element-anchored; action/input/submenu items
src/dropdown.ts             shared dropdown primitive + menu-mode fan-out
src/theme.ts / skin.ts / surface.ts / storm.ts    token-tier switches + surface bands + storm layer
src/slider.ts               shared slider primitive (scrubber, volume)
src/diag.ts                 diagnostics ring buffer + window.__diag
src/toast.ts                the transient-notice primitive + window.__toast (TOASTS.md)
src/artwork-heal.ts         cover-<img> self-healing (data-art marker; capture-phase retry)
src/styles.css              app rules (imports token sheets first)
src/styles/qcard.css        Queue/History/Rewind card styling
src/styles/toast.css        the toast host (per-surface position) + strip
src/styles/{palette,themes,skin,fonts}.css + fonts/    the three token tiers + bundled fonts
src-tauri/src/lib.rs        Tauri builder: state, DB open, command registry, devtools
src-tauri/src/apple.rs      dev-token signing, loopback auth, AppleProvider, catalog + radio cmds
src-tauri/src/model.rs      normalized model (Track/Album/Artist/Playlist/Station/…)
src-tauri/src/provider.rs   MusicProvider trait
src-tauri/src/library.rs    SQLite cache + sync + play_stats/play_events + unified track store
src-tauri/src/enrich.rs     lazy catalog enrichment: storefront cache, batch fetch, palette cache
src-tauri/src/playlists.rs  playlists: local store + CRUD, Apple mirror sync + content cache
src-tauri/src/tray.rs       tray icon/menu, window policy, single-instance activation (TRAY.md)
src-tauri/src/settings.rs   back-end settings.json: minimizeToTray, readWindowsMedia,
                            bridgeToken, windowPos
src-tauri/src/bridge.rs     loopback bridge: Hub state relay + extension/agent routes
src-tauri/src/media.rs      Windows media session (GSMTC) + master volume
src-tauri/nsis/hooks.nsh    NSIS hooks: stop the CLI pre-(un)install, offer the extension
cli/                        the `deetsmusic` binary: CLI + MCP server (AGENT.md)
extension/                  MV3 browser extension source (EXTENSION.md)
scripts/dev-app.mjs         generates the dev identifier config for `npm run dev:app`
scripts/cli-dist.mjs        stages cli/dist/deetsmusic.exe for bundle.resources
scripts/release.mjs         `npm run release`: reads secrets, builds, signs, checks, archives (RELEASE.md §1)
scripts/sign.mjs            Authenticode signing: signtool + Azure Artifact Signing dlib (RELEASE.md §6.9)
scripts/release-check.mjs   the release gate: repo paths, versions, pin/updater, signatures (§1a)
scripts/archive-installer.mjs   copies each shipped setup exe + .sig into installers/ (pre-release → dev/)
scripts/publish-update.mjs  `npm run release:publish`: R2 upload + update index, withdraw, notes (§6.7)
scripts/cred-read.ps1       reads a Credential Manager secret for release.mjs (never printed)
scripts/cred-write.ps1      saves a secret to Credential Manager, trimmed and checked
src-tauri/src/update.rs     the updater: channel, check, in-memory verified download, install
src/updater.ts              Settings › Updates + the update toasts (RELEASE.md §6.3)
installers/                 local archive of shipped NSIS installers (gitignored)
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

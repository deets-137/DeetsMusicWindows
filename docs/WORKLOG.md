---
status: sop
desk_test: none
sources: []
updated: 2026-09-25
---
# DeetsMusic — Work log

> **What this is.** The record of each sitting: what was built, what was decided, the desk-test
> scripts, what was left. **Newest first. One `##` per sitting, dated.** Append; never correct
> an old entry — a later entry says what changed. A fact that is still true belongs in
> [HANDOFF.md](HANDOFF.md), not here (DOCS-ORG.md §7). HANDOFF's **Open now** list points into
> this file for the detail.

## 2026-09-26 — the Diary's playing-album box

His ask: the Diary's "Add an album" box becomes a row, with the playing album first. Forks
decided: nothing playing = the + box alone; an album with an entry reads "Continue"; both boxes
1.5 × a tile; the + turns the whole row into the bar and the album box fades. Built in
`diary-card.ts` (`nowHTML`, `paintNow`, `openNow`, `fadeOut`) and `diary.css`. Spec and desk
test: DIARY.md §4c. tsc, vite build and docs:check pass. Desk test open.

## 2026-09-25, afternoon — Shots: the paper design
- **His ask:** a way to record each section and feature of the app, for a full user guide
  and a short marketing overview.
- **Decided (him):** pictures and short clips; from the web demo first, the dev app only for
  the desktop-only parts; made by a script, run again before each release; the guide rule
  holds for marketing too (Claude outlines, he writes every word); MP4 with a poster; the shot
  list lives in `docs/guide/`; shots stay local for now (U10 open, he is checking hosting
  cost); the marketing page's home is decided later; ffmpeg by `winget install Gyan.FFmpeg`
  (he started the install).
- **Written:** [SHOTS.md](guide/SHOTS.md), status `project`, and its line in CLAUDE.md. No code.
- **Left:** forks F1–F4 (SHOTS.md §9). The next sitting starts at SHOTS.md §11.

## 2026-09-25, later — the consistency pass desk test; the log review
- **Desk test:** he passed all three parts of the 2026-09-25 script.
- **The 401 on a playlist refresh:** at 11:03 the dev app's refresh got HTTP 401 on two of 28
  playlists (Get Up!, Hip-Hop/R&B Hits: 2016). The same request sent to Apple later, with the
  same key and headers, got 200, and so did `playlist_refetch` in the app. Apple refused it
  for a short time. The refresh already keeps the old cache and stamp, so the next check
  retries. It shows now only because `console.error` reaches the file. His call: keep it.
- **Missed by the codemod:** 11 `lock().unwrap()` split over three lines (the user-token
  reads in apple.rs, enrich.rs, library.rs, playlists.rs). Now `lock_or_recover()`.
- **The log review** (dev and installed, 2026-09-23 to 2026-09-25). Nothing to fix:
  - `window:unhandledrejection` "reading 'includes'" ×22 and `ReferenceError` in
    diary-card.ts / diary.ts / library-add.ts: dev only, 2026-09-23 to 2026-09-24, about 1 s
    after a Vite reload while those files were being edited. None in 0.14.5 or in today's
    dev sessions.
  - The `cubic-bezier(0.4` easing error in diary-card.ts: dev only, 2026-09-24 18:28, the
    same kind of mid-edit reload.
  - "The window stopped answering 1,800 s ago" ×4 on the installed app: the PC slept. The
    AirPlay capture line after one of them counts 7,699 s for a 10 s window.
  - `MEDIA_LICENSE` on the installed app: the 2026-09-24 pause, still left for its own fork.
  - Dev library-sync 401s on 2026-09-24: the same short Apple refusal, and the toast shows.
- **His calls from the review:** two fixes built.
  - **The rejection stack:** `window:unhandledrejection` carries `at`, its top three stack
    frames (diag.ts `topFrames`, DEBUGGING.md). Checked in the dev app with a test rejection.
  - **The sleep false alarm:** the watchdog times its own 2 s sleep. When that sleep took 7 s or more,
    it writes `ui: the PC was asleep for N s` and does not do the stall check (LOGGING.md
    §The freeze watchdog). Decided inside his choice: the 7 s limit (the beat + the stall
    limit), and whole seconds with no thousands separator, like the other log lines.
- **Desk test (restart: new Rust):** put the PC to sleep for a minute or more with the dev
  app open, then wake it. The log has `ui: the PC was asleep for N s` and no "stopped
  answering" line. **Passed** the same day: `ui: the PC was asleep for 100 s`.
- **Seen on that wake:** the dev page reloads when the PC wakes. This is almost certainly
  Vite's client reconnecting to the dev server. The sync ran before the network was up, so
  the offline toast showed. The installed app's four wakes kept one session and showed no
  toast, so this happens in dev only.
- **An AirPlay lead** (installed log, 2026-09-24): after the 17:00 wake, every
  SET_PARAMETER got os error 10054 from 17:04 to 17:06, then a new connect at 17:06:40
  brought the sound back. Open: was that connect his? If yes, AIRPLAY.md §13.3 is a real
  bug, and the wake line is the moment to reconnect.
- **"Nothing is playing in the dev app":** the wake reload ran with no network, so the
  MusicKit `<script>` failed. `whenMusicKitLoaded` waits for `musickitloaded` with no
  timeout, so every click stopped after `perf:model` with no word. A live launch with no
  network (autostart before Wi-Fi) does the same. His call: retry, and tell on click. Built
  (TOASTS.md §5, the offline row): the script's `onerror` sets a flag; `player.ts` loads it
  again on `online`, every 30 s and on a play click; the click shows the offline toast,
  forced, and is not replayed. Decided inside his choice: 30 s; the existing offline copy
  (it reads "check your internet" even if only Apple's CDN is down).
- **Cover Wallpaper:** he set the locked dim to 15 (step 8 of COVER-WALLPAPER.md §6).
- **Desk test, No MusicKit:** turn Wi-Fi off. In the dev app press Ctrl+R (or put the PC to
  sleep and wake it). Click a song: the "can't reach Apple Music" toast shows. Turn Wi-Fi
  on and wait up to 30 s. Click a song: it plays. The log has `player:musicKitRetry`.
  **Passed** the same day (the log: `player:configured` 224 s after that page load).
- **Merged:** `clode-eval` into `main` (fast-forward) and pushed, by his word.
- **AirPlay after sleep (AIRPLAY.md §13.3):** the code settled what he could not remember.
  Nothing in the app reconnects after a failed send, so the 17:06:40 connect was his. The crate's
  keep-alive only logged its failures, so the session never died. His calls: detect by 3 failed
  keep-alives (crate 0.4.1), reconnect 3 tries, silent then pause, a toast both ways. Built;
  the decisions inside his calls and the desk test are in §13.3. **Desk test passed** the
  same day. DeetsAirplay committed and pushed (`6fe2922`, crate 0.4.1; the tray app builds),
  the `rev` bumped, the local `[patch]` file deleted.
- **The 429 toast (APPLE-CALLS.md §3):** his words: "Apple Music is busy right now. Try again
  in N seconds." (`warn`, timed). It is built with the telemetry pass, which is next.
- **Sound (SOUND.md §11a):** his answer to "keep it?": the Equalizer stays, Adaptive sound goes,
  hidden behind a DevTools flag, the `loudness` table left, a release-note line only. Found on
  the way: the Ocean heave and the Room bob read the meter, which ran only with Adaptive sound.
  His call: the meter follows the graph (the Equalizer or the AirPlay tap). Built, desk test in
  §11a, committed with the docs sweep. **Desk test passed** the same day; merged into `main`.
- **Cover Wallpaper:** his word, "It looks good as is": the "As built" review is done;
  COVER-WALLPAPER.md is shipped (0.14.5), desk test passed.
- **0.14.6 published** (`5f1abb5`), by his word; the hand test skipped by his call ("I've tested
  adequately"). Release check clean, 8.4 MB; the update route answers `latest: 0.14.6`; the
  demo pushed to DeetsSolutions (`6c0a946`). RELEASE.md §0a has the row.
- **The telemetry pass, parts 1 and 2 (his word: "start the telemetry pass"):** built in the
  order the docs set (the pause fixes with the counter), the AirPlay part after their desk test.
  - **The counter and the 429 back-off** (APPLE-CALLS.md §6): `apple_calls.rs`; `observe()`
    after every reply of the four functions; a `tokio::task_local` scope marks background jobs;
    `RunEvent::Exit` writes the quit line; the `apple-busy` toast with his words;
    `apple_force_429` for the desk test (dev only).
  - **The pause labels** (DEBUGGING.md): `songEnd` after a 1 s wait, `player:stall` /
    `stall-end`; the rule is `src/pause-rules.ts` with 3 unit tests (33 in all).
  - Decided inside the design: a module of its own; the background list (§6); empty result vs
    `BUSY` per job; `apple_check` reads a 429 as a good token; the dedupe is 6 s by time; the
    counter's diag twin is the hourly line (the `diag` tool shows it live) plus
    `apple_calls_status` (not wired to the agent). Known gap: a user 429 can also show the
    call's own failure toast.
  - **Desk test:** the pause labels passed his test. The forced 429 (APPLE-CALLS.md §5 steps
    2–3) was run by Claude in the dev app and behaved as designed. Open: the hourly line
    (step 1). Committed and pushed on `clode-eval`, not merged.
  - Seen on the way: the `deetsmusic` diag MCP tool read the installed app's ring, not the dev
    app's, while both ran; `scripts/webview-eval.mjs` read the dev ring.
- **Docs sweep (his ask):** HANDOFF said "Live: 0.14.1", "every release goes beta first" and
  "branch `darn-critics`": now 0.14.5 live, beta-first paused, every local branch merged into
  `main`, and a line for what is on `main` and not released. Also: CLAUDE.md's co-author
  trailer (Opus 5.5) and its SOUND.md line; SOUND.md's header points to §11a; DB-HEALTH §2
  records `lock_or_recover`; DEBUGGING's pause table gains `airplay:lost`; AIRPLAY §13.2 marks
  `airplay: drop` built in part; AGENT.md's Sound key list; `updated:` dates. `.gitignore` now
  holds `src-tauri/.cargo/`, which Cargo.toml's comment already claimed. In DeetsAirplay,
  docs/architecture.md describes the keep-alive drop.

## 2026-09-25 — the codebase evaluation and the consistency pass
- **Read:** two sessions (the repo health read and the app consistency read) merged into one
  plan. The health checks were clean: tsc, `cargo check` 0 warnings, `cargo test` 33/33,
  docs:check, `npm audit`. The gaps: no front-end tests, no CI, ~150 raw
  `Mutex::lock().unwrap()` outside `Db::lock`, 199 `console.error` calls that never reached
  the log file, and 73 sync commands that take the database lock on the UI thread.
- **His word: "fix everything that doesn't need me first."** Built:
  - release-check check 9 names a sync command that takes `db.lock()`. It is SOFT (one
    warning, 73 names) until those commands move off the UI thread. RELEASE.md §1.
  - `diag.ts` copies `console.error` (to the file now) and `console.warn` (to the ring).
    LOGGING.md, revision 2026-09-25.
  - One scrollbar rule set: seven hand copies folded into the `app-scroll` rule in
    styles.css. `.slot-picker__menu` and `.ctx-menu__fly` gain the hover color they had lost.
  - `src/dom.ts` holds `el` (was in three panels) and `esc` (was in two, plus `escAttr`).
  - "Could not" → "Couldn't" in three strings. Diary menu rows in Title Case (Mark as Done,
    Mark in Progress, Delete Entry). The date pill's values stay in sentence case.
  - The extension's style copy re-synced (`pack.cjs --styles-only`).
- **Checked and dropped:** `pick:suggest` is a Home tile id, not a localStorage key. The
  Quick and Room panels do carry `app-scroll` (in index.html). The Room panel's missing
  gutter is his call of 2026-09-18, not a gap.
- **Desk test:** scroll the Library, Queue, Search, a Playlist web panel, a right-click
  flyout with many rows and the slot picker. Each bar looks as before, and the flyout and the
  slot picker thumbs now darken on hover. Right-click a Diary tile: the rows read Mark as
  Done / Mark in Progress / Delete Entry. In the dev app, run `console.error("test")` in
  DevTools, then check that the log file has a `fe: console:error` line.
- **His calls, later the same sitting:** A1 with Cancel, B and C as recommended. Built:
  - **The destructive-action rule** (TOASTS.md §6): what can be undone runs at once and
    offers Undo; what cannot asks first, with Cancel. New Undo on Remove from Playlist
    (one and a picked set), Delete Folder (Playlists and Diary), Remove Cover and Generate
    Cover › Mosaic. Keep → Cancel on Diary Delete Entry, Song of the Day Withdraw and the
    replaced pick's posts; those two go info → warn.
  - Decided inside his choice: Delete Playlist keeps its question (a restore is a new id
    with no Apple link, pins or place, so it is not an undo). The unmark ask keeps "Keep":
    that button unmarks and keeps the post, so it is not a decline. An undone folder is a
    new id: a moved folder row goes back to the default order.
  - **`lock_or_recover()`** (src-tauri/src/lock.rs): all 150 raw `lock().unwrap()` now
    recover from a poisoned mutex, and the first one is logged with its file and line.
  - **Empty states end with a period:** Compass "Nothing here yet.", the three Diary
    section empties, the web builder's "No songs match. Pick fewer genres."
- **Desk test, the second part:** remove a song from a hand-made playlist, then press Undo:
  it comes back at the same place. Do the same with three picked songs (Ctrl+click), with
  Remove Cover, with Generate Cover › Mosaic and with Delete Folder in Playlists and in
  the Diary. Right-click a Diary tile › Delete Entry: the buttons read Delete / Cancel.
- **CI and tests, researched by the consistency session:** of ~30 past bugs, ~6 a unit
  test on pure logic would have caught (the 2026-07-02 "Unknown" queue rows, sampleHz
  2026-09-16, the `\\?\` path 2026-09-16, loadLayout 2026-09-17, the menu pin subject
  2026-09-23, reconcileUpcoming 2026-09-24); 2 a push-time CI (both the 2026-09-21 docs
  re-org: the Guide button stub, publish-update.mjs); 4 only a static gate (the 0.12.0
  freeze, autostart, the Db poison, the 0.11.0 version files); ~18 only a hand test or
  telemetry. No case where tsc / cargo on push would have caught what his hand-off habit
  missed. Its pick: narrow vitest tests on media-menu, queue, row-pick, list-keys and the
  loadLayout parse, plus `npm run check` and a pre-push hook; no hosted CI.
- **His calls, the third round:** the built-in test runner, one database thread, the
  scrollbar gutter left as is. Built:
  - **The database thread** (`src-tauri/src/db_thread.rs`, DB-HEALTH.md §2a): the 73 sync
    commands that took `db.lock()` are `async fn` + `crate::db_thread::run`, one thread,
    first in first out. 70 were moved by a one-off codemod, the three Last.fm ones by
    hand; `lastfm_heard` keeps its network `flush` off that thread. The bridge's two
    direct calls now await. Check 9's database rule is hard. Commands that returned a
    bare value now return `Result` (the front end sees the same value on success).
  - **Tests:** `tests/` on Node 24's own runner, no dependency. `tests/setup.mjs` adds
    `.ts` to extensionless imports and stubs `localStorage`, `addEventListener` and
    Tauri's window label. 30 tests: queue.ts, row-pick.ts, and three rules moved into
    pure files for it — `queue-sync.ts` (reconcile's expected ids and suffix plan, the
    2026-09-24 bug), `layout-rules.ts` (loadLayout's check), `frame-period.ts` (sampleHz,
    the 2026-09-16 bug). `npm run check` (~15 s) and `.githooks/pre-push`, which
    `npm install` wires through the `prepare` script.
  - CLAUDE.md checklist 6a: `scrollbar-gutter: stable` is no longer automatic.
- **Desk test, the third part (restart the dev runner: new Rust):** play a few songs, open
  Diary, tap a song score several times fast, and add, reorder and remove playlist songs.
  Everything saves as before. Start a library sync (the Library card's Refresh library button) and
  click around the Playlists card while it runs: the window keeps painting. Last.fm
  (if connected): a play past half still scrobbles.
- **Left for him:** HANDOFF.md › Open now › The consistency pass.

## 2026-09-24 — the queue is the master; the heave flood
- **Report:** a song dragged into the Queue card showed for a second, then a different song
  played (twice). Read from `plays`, `list queue` and one `player:np` line: the drag never
  reached MusicKit. `reconcileUpcoming` deduped against every id MusicKit held up to
  `current`, and Breaking News had played earlier in the run. The index-only follow then ran
  one step off and wrote no play rows for The City or Save Me from Myself.
- **His call:** fix B, then "the queue the user sees is the source of truth": correct
  MusicKit on drift, fork (a) — jump to the model's song at the song change. Built:
  QUEUE.md §The model is the master (no dedup in reconcile, prefix alignment + repair on
  every edit, `correctDrift`). Desk test in that section. Decided inside his choice: the 5 s
  `DRIFT_GAP_MS` loop guard; "followed" when the model has run out; the live-entry count in
  `mkUpcomingIndex`.
- **Heave flood:** the idle MusicKit element's exact-zero meter hops reached the Ocean heave,
  which logged `ocean:heave` on/off ~17 times a second. The 300-event ring held ~18 s, so
  every player event was lost. `sound.ts` now drops exact-zero hops at the source.
- **Pause (not a bug of ours):** `MEDIA_LICENSE` on The City → "Playback stopped". No
  auto-retry exists for it; left for its own fork.
- Nothing committed. The installed app has neither fix until a release.
- **Hero menus** (CONTEXT-MENUS.md §3a, his calls 1A 2A 3A 4B 5A, 6 later): a right-click
  anywhere on an album / playlist / artist hero opens the view's own menu, nothing
  destructive; Shuffle joins every album and playlist menu; Add to Library for Apple's
  playlists (Rust: `apple_add_to_library` takes `playlists`); Compass `shuffle <name>`. Desk
  test in §3a.
- **♥ on albums and playlists** (CONTEXT-MENUS.md §3b, F1A F2A F3A): the `favorites` table
  with `album:` / `playlist:` keys and an `albumsong:` pointer row for Library albums (my call
  inside F1A, so "ask once" holds with no album id); a hero asks Apple once per install; two
  new Rust commands `favorite_collection_set` / `_reconcile`. Desk test in §3b.
- **Desk tests:** he passed all three the same day (the queue master, the hero menus, the ♥).

## 2026-09-24 — Cover Wallpaper and Diary Done copy built

- **Cover Wallpaper BUILT** (COVER-WALLPAPER.md, "As built" first). Glass › Skin settings ›
  Canvas `Aurora | Covers | Picture`, Tiles `One cover | Few | Some | Many` (One cover = 1A, for
  his side-by-side pick), Picture (Choose, or drop a file on the row), Aurora color
  `Cover | Theme`. New: `wallpaper.ts`, `wallpaper-worker.ts`, `wallpaper.rs` (the user picture
  in the app data folder, the `wallpaper.localhost` scheme, two async commands),
  `paletteFromPixels`. skin.css: `--canvas-go/-stop/-pause` feed the aurora; the frost paint
  split into glow, soft copy and ground; the `--wallpaper-*` tokens. Settings: a row a choice
  reveals now enters through `enterRows` (every such row, not only these).
- **Diffusion added** (his ask the same sitting: the wallpaper felt too sharp; his calls: a soft
  blur, as a slider). Settings › Diffusion 0–100%, default 30 (≈ 6 px); the picture bleeds 48 px
  past the window so the blur never darkens the edge. COVER-WALLPAPER.md "As built", §6 step 7a.
- **The swap** (his question: why the center tile always seemed replaced; the dev log showed 3
  slots per album change — center, the tile it grew from, one new queue album; his call A):
  the old center album now shrinks into the tile the new one left. COVER-WALLPAPER.md "As built".
- **His layout call (after the commit `5650dd3`):** the mosaic stays the default (Tiles: Some),
  and One cover stays as a Tiles choice. No code change.
- **Bug fixed: the Covers canvas did not draw at app open** (found by the Library session from
  the dev log). The grid can make more tiles than the Tiles count asks (21 for Many at
  1100 × 910), so the boot draw read an album key past the list and threw; the throw left the
  draw marked "in flight", which blocked every later draw of the same album. Now the keys are
  counted from the slots made, and a `finally` always clears the in-flight mark.
- **Diary: Done copies the Export BUILT** (DIARY.md §7): one `onDiaryDone` listener; the check's
  hint names the copy.
- Checks: `npx tsc --noEmit`, `npx vite build`, `cargo check`, `npm run tokens`,
  `npm run docs:check`. Not run in the app. **Desk tests:** COVER-WALLPAPER.md §6 and DIARY.md
  §8 step 11f. A Rust file was added: restart the dev runner.

## 2026-09-24 — desk tests closed, three calls, docs only

- **The Diary desk test passed** (DIARY.md §8), every step but 11e. 11e (the `diary` CLI and
  the MCP tool) waits for the next beta release and a fresh install, by his call.
- **Passed, his word:** Unreleased songs (SEARCH.md), the web demo (WEB-DEMO.md §10), Quick
  settings (§10.1 and §11.1), Sound (§10.4 steps 4–10).
- **Two follow-ups from those:** the web demo should show the album light more prominently
  (WEB-DEMO.md §10, forks first); he is weighing whether to keep Sound at all (SOUND.md §11).
- **His calls:** Cover Wallpaper builds both 1A and 1B, he picks at the end · a user call that
  gets a 429 shows a toast (APPLE-CALLS.md §3) · marking a Diary entry done copies its Export
  (DIARY.md §7).
- He asked for docs + commit + push only; the build was stopped before any code. **Next
  session:** HANDOFF.md › Open now › "The next session" — Cover Wallpaper (both layouts), then
  the Diary Done copy, then the telemetry pass.

## 2026-09-24 — docs only: Cover Wallpaper, Apple calls, pause and AirPlay telemetry

- **Cover Wallpaper designed** (COVER-WALLPAPER.md, status designed). His calls: 1B mosaic
  (1A built too, for a side-by-side test) · 2B album-colored aurora · 3B redraw per album · 4A
  Glass only · tiles pill Few/Some/Many (6/12/20) · TA tiles stay in place, gentle per-tile
  fade · dim locked higher with the wallpaper · back to the aurora when nothing plays · user
  pictures U1A–U5A (Canvas pill Aurora/Covers/Picture, one picture, colors from it, cover-fit)
  · Aurora color row `Cover | Theme`. What I decided inside: §3.1, §3.5, §8.
- **Apple rate limits: no evidence.** No 429 in any log (installed, beta, dev,
  2026-09-17 → 09-24). Nothing counts calls. Designed APPLE-CALLS.md: A the counter, B the 429
  back-off. Build later.
- **Pauses the user did not cause: none real.** Of 93 `outside` pauses, 92 were song changes;
  one 17.5 s gap at ~22:14 on 09-23 lines up with AirPlay. Designed the fixes (DEBUGGING.md
  §What the 2026-09-24 read found) and the AirPlay stall / switch-speed tracking + the
  after-sleep unknown (AIRPLAY.md §13).
- Next session: build Cover Wallpaper. Then the telemetry pass (APPLE-CALLS A + B, the pause
  fixes, AIRPLAY §13.2). The sleep desk test (AIRPLAY §13.3) needs no code.

## 2026-09-24 — branch `darn-critics`: unreleased songs, and the Diary card

- **Unreleased songs** (his calls 1A · 2B toast · 3A). OPIA by VITA showed all 12 songs as out.
  Probed Apple: an unreleased song has no `playParams`, no length and no preview, and no date
  of its own. `Track.unreleased` now carries it; every sink keeps it out (queue, store, library,
  playlists, the pane cache). The album page dims the rows, says "Coming 09/25 · 2 of 12 songs
  out", toasts on a click, and offers only Go to Artist. Desk test: SEARCH.md §Unreleased songs.
- **The Diary card** (his calls 4A · 5ABC · 6B · 7B · 8B, and 7B's Settings row). An album
  journal: schema v14 (`diary.rs`), `diary-card.ts`, Settings › Diary › Rescale scores
  (Ask default), Add to Diary on every album menu. The 6B foot panel was chosen from a mockup
  of three layouts. What I decided inside his calls: DIARY.md §6. Desk test: DIARY.md §8.
- Not committed. Both features need his desk test.
- **Later the same sitting** (committed `99fbddf` first, then polish): the score split pill
  (5 · 10 · 100 · a field), dates moved right; Grow on open (`diaryGrow`, `growCardTaller`);
  the foot waits for a song; song right-click menu; double-click plays (the row rebuild ate the
  dblclick); header "Diary: <album>"; Done button + In progress / Completed rows + folders and
  arranging (schema v15); the + menu's searching Entry field (`InputItem.onInput`) and the
  cover → search-bar morph (two bugs: a custom property keeps `calc()` as text, and a comma
  split cut `cubic-bezier`); Export (Rust `export_text`), the Compass Diary group and Add to
  Diary, and `/diary` + `deetsmusic diary` + the MCP `diary` tool behind Agents use the Diary
  (off by default). Desk tests: DIARY.md §8.

## 2026-09-24 — 0.14.1: the installer could not stop the MCP CLIs

- **His report:** the 0.14.0 install aborted: *Can't write …\DeetsMusic\cli\deetsmusic.exe*.
  "Is this caused by our new guard?"
- **Read, not guessed:** four `deetsmusic.exe` CLIs (MCP servers of four Claude sessions, all
  started before the install) held the file, and none was stopped. A 32-bit NSIS test
  installer running the hook's exact command found all four and matched none: the installer's
  PowerShell is 32-bit and reads every 64-bit process's `.Path` as empty. So `DeetsStopCli` had
  never matched anything; the template's kill by name hid it until the new guard removed that.
  The app count was blind too (nsExec returned PowerShell's output as "?").
- **Fixed** (`hooks.nsh`, RELEASE.md §4a): the path from `Win32_Process.ExecutablePath`,
  `Stop-Process -Id`, the count as the exit code. Tested in the 32-bit test installer: 4 of 4
  CLIs counted; a scratch process in a test folder stopped; the CLIs outside it untouched.
  release-check 11 now fails `Get-Process` / `$$_.Path` in hooks.nsh.
- **Shipped:** `0.14.1-beta.1` on `deetsmusic-test`, then `0.14.1` (`e2d8e3d`), notes carrying
  0.14.0's. Offer and `/health` checked. The spike rows `0.4.4-t1/t2` were withdrawn (his go).
- **Open:** a real update over running MCP CLIs — his PC is the first one.
- **Then:** it passed. His PC updated 0.14.0 → 0.14.1 over five running MCP CLIs: "Update
  installed fine, no abort this time." The demo at deets.solutions/deetsmusic/demo serves the
  0.14.1 build (`main-WnFJWdVY.js`, DeetsSolutions `668009c`).

## 2026-09-23 — 0.14.0 released, beta first; `oceanic-schmoves` into `main`

- **His word:** "Desk tests all look good. Publish main to 0.14.0 (and 0.14.0-beta.2 for the
  beta) please. Then merge into main."
- **Beta:** `0.14.0-beta.2` (`e0b3d77`) built with `release -- --beta`, published to
  `deetsmusic-test`. Its offer answers from `-beta.1`. Its `/health` answers `no_installer`, as
  designed: that check counts only non-pre-release rows, and the beta channel has none.
- **Full:** `0.14.0` (`62d516a`), all seven version files (the manifest too), notes in
  RELEASE-NOTES.md. Release check clean. Published; the offer answers from 0.13.1 and
  `/health` says 0.14.0. The web demo went to DeetsSolutions master (only its own path).
- **Risk call:** §0b reads it high risk (Rust `NpState.pinned`); published on his explicit
  word, the installed-build hand test skipped by his call (RELEASE.md §0a).
- **Merge:** `main` fast-forwarded to the branch (no commits of its own; a trial merge was clean).
- **Still open:** the spike rows on `deetsmusic-test` (BETA.md §4.3, needs his go-ahead); the
  Ocean perf check (OCEAN.md §6).

## 2026-09-23 — One right-click menu per media type (branch `oceanic-schmoves`)

- **His ask:** "right clicking on the same media type should have the same menu open across
  the app". An audit found six cards that built song menus by hand, no common artist menu,
  and three bugs (a song in an album view pinned the album; Copy Link on artist, genre and
  picked lists copied the first song's album; a Library pick read "Play Now").
- **His forks** (CONTEXT-MENUS.md §6): 1A take-away rows last · 2B a tile goes to its own kind,
  a song does not · 3A a song row pins the song · 4A an artist off the library plays Apple's
  Top Songs · 5A Copy Link for artists and public playlists · 6A the tray gets Pin and Start
  Station · 7B the card title's "Pin" stays. Plus **Start a Web** on songs, albums and
  artists: that label, a toast then the flight, after Start Station.
- **Built:** `src/media-menu.ts` (song · album · artist · playlist · station · list · set ·
  tile builders, one 7-group order); every card moved onto it and `trackMenu` is gone.
  `startWebItem` / `webFrom` (web.ts), `menuSource` (context-menu.ts), the artist pane request
  (go-to.ts), `copyArtistLinkItem` / `copyPlaylistLinkItem`, catalog playlist pins
  (`catalogPlaylistTile`), tray `pin` / `start-station` commands and `NpState.pinned` (Rust).
- **Checks:** `npx tsc --noEmit`, `npx vite build`, `cargo check`, `docs:check` pass. The Rust
  field needs a dev-runner restart.
- **Desk test:** CONTEXT-MENUS.md §8. Not run yet.

## 2026-09-23 — Ocean album light (branch `oceanic-schmoves`)

- **His ask:** the album color heavier under the waves. A slider: neon lines and glows at the
  maximum, today's sea at the minimum.
- **His forks** (OCEAN.md §7): neon crests + a stronger deep glow on one slider; all rows, near
  brightest; pulses with the heave; "Album light", default 0.
- **Built:** a neon mode in `ocean-texture.ts` (lines only, each body erases the light behind),
  two `.ocean__neon` layers per band for the crossfade, `paintNeon` / `asNeon` /
  `setAlbumLight` in `ocean.ts`, `oceanLight` key + row + N mark + agent spec, three tokens.
- **Caught on the way:** importing ocean.ts from skin-settings.ts grew the chunk that the tray
  panel loads from 44 kB to 250 kB. ocean.ts now reads the key itself.
- **His word at the desk:** "Its perfect actually".
- **Then:** the sea took Apple's `textColor1` by name (near grey on half the library). Now it
  calls `albumColor()` (album-slots.ts), the most colorful of the three, the same ranking as the
  NP aurora's rim. The rule for future uses is ALBUM-COLOR.md §The album's one color.
- **Left:** a bench at 100 on `dev:built`.

## 2026-09-23 — DeetsMusic Beta: a second installed app (branch `oceanic-schmoves`)

- **His ask:** a permanent beta build, installed beside the full app. Its first job is Ocean.
- **Found first:** a test-channel build changed only the channel. It shared the identifier,
  install folder, link scheme, Run value and installer paths, so it would have replaced the full
  app. The spike rows `0.4.4-t1/t2` are live in group 1 on `deetsmusic-test`, so a beta's
  rollback list would have offered a build with the full app's identity.
- **His forks** (BETA.md §1): copy once + `deetsmusic-beta pull` (stage, then restart); copy db +
  Apple sign-in + settings + Last.fm, not Friends; reuse `deetsmusic-test`, spike rows withdrawn
  as relics; beta first for every release; `-beta.N` versions; teal color-shifted icon; own CLI and
  MCP name; own `deetsmusic-beta://` scheme.
- **Built:** `beta.rs` (flavor, the copy before the Builder, the pull, the wait for the old
  process), `tauri.beta.conf.json`, `icons-beta/` from `scripts/beta-icon.ps1`, the flavor in
  `update.rs` / `apple.rs` / `log.rs` / `settings.rs` / `bridge.rs`, the CLI `beta` feature with
  `pull`, `--beta` in release / release-check / archive / publish, `hooks.nsh` made flavor-neutral.
  DeetsSupport: `signin.js` takes `deetsmusic-beta`; `update.js` orders `beta.10` after `beta.9`.
- **Decided inside his choices** (listed for him at hand-off): the beta keeps its own bridge
  token, firewall exe path and window position; it never enrolls in Launch at startup; the beta
  installer never asks about the extension; `DeetsMusicBeta.exe` has no space; the beta
  installer is archived under the plain `DeetsMusic_<v>` name (the Worker's `FILE` rule) in
  `installers/beta/`; beta release notes are optional.
- **Checked:** `cargo check` (app, CLI, beta CLI) clean. Nothing built or installed yet.
- **Left:** the two `--withdraw` runs (an R2 write), the first `-beta.1` build, desk test
  BETA.md §8. The DeetsSupport deploy is HELD (his call).
- **Correction, same sitting:** I told him a DeetsSupport deploy drops room sockets. It does not:
  only the rooms and friends workers hold sockets. He asked for a way to deploy a worker without
  dropping connections ("perhaps a backup / second path"); written up as ideas/WorkerDeploy.md.
- **Add a room member as a friend** (his ask): a member carries no friend code, so it needs a
  rooms-worker relay. Designed in FRIENDS.md §18; he chose F1A offer on press, F2A ask toast, F3A
  mint on Add, F4A silent Not now, F5A no setting. Not built; waits on a rooms deploy.
- **First beta built:** `0.14.0-beta.1` (`npm run release -- --beta`), signed, release check ok,
  archived in `installers/beta/`. The docs checker wanted the extension manifest on `-beta.1`,
  which Chrome refuses; `docs-check.mjs` now skips the manifest on a beta version and compares
  `shipped_in` on x.y.z only.
- **Installer stops by path only** (his ask before installing: "every update / install of the beta
  doesn't kill all related processes"). Found: the beta was safe, but the FULL installer's Tauri
  close matched `DeetsMusic.exe` by name without case, so it killed the dev build and every
  `deetsmusic.exe` CLI on the PC (five MCP servers were running at the time). hooks.nsh now
  replaces `CheckIfAppIsRunning` with a full-path match inside `$INSTDIR`; release-check 11 guards
  it. RELEASE.md §4a. The beta was rebuilt with it.
- **Installed (him):** the rebuilt `0.14.0-beta.1`, with the full app, its CLIs and the rest
  running — "everything still running". BETA.md §8 step 2 passed; the other steps are open.

## 2026-09-23 — the Ocean sea, second round: the heavy swell (branch `oceanic-schmoves`)

- **His word on the first round:** "looks more like a swimming pool now. i prefered the older
  ocean that felt deep, ominous, and powerful."
- **His forks:** the old swell made heavier · "Card opacity" slider, default solid ("the old
  cards were designed to be sunken to give that deep ocean feel") · keep the heave, the ripples
  and album color as a glow from the deep · Fancy Ocean dropped. OCEAN.md §2.
- **Built:** `seaRows` + `swellLayer` (Gerstner crests in perspective, opaque wave bodies in the
  water's color, three bands at 360 / 720 / 1200 px), the band markup and CSS, the glow
  (`@property --ocean-glow-color`), flattened ripples in the crest ink, `oceanCardOpacity`
  (replaces `oceanFancy` and `oceanClarity`, which never shipped). The caustics are gone.
- **Desk test:** OCEAN.md §5. **Open:** the bench (OCEAN.md §6).

## 2026-09-22 — the Ocean sea (branch `oceanic-schmoves`)

- **Why:** he asked whether Ocean's SVGs were worth a redo. The review found the swell hidden
  behind opaque cards (it showed only in the 12 px gaps), no real depth, and six full-window
  masked layers that were Ocean's whole cost without a graphics card. A shimmer I predicted
  from the 1 px crest is not there (his check). Verdict: redo the swell, keep the skin.
- **His forks:** under the cards (see-through) · caustics + swell · album color as light in the
  water · breathes with the music, hold calm when the Sound graph is not routed · ripples on
  play + drop · Water clarity slider · Fancy Ocean toggle (like Fancy Glass), on by default,
  off = still light + rolling swell. OCEAN.md §2.
- **Built:** `ocean-texture.ts` (photon-mapped caustics, lit swell crests, both tile),
  `ocean-worker.ts`, `ocean.ts`, new `.ocean` markup and CSS (no masks), `oceanFancy` /
  `oceanClarity` with New marks and agent specs, `onPlayIntent` (player.ts), `onDragLand`
  (row-drag.ts), `lookupPalette` shared by the NP card and the sea (album-color.ts).
- **Desk test:** OCEAN.md §5. **Open:** the bench for Fancy Ocean's cost line (OCEAN.md §6).

## 2026-09-22 — docs sweep against `main`

- **Why:** a cloud session checked the docs against the code on `main` (0.13.0, `de31ff7`).
  His local commits since then (0.13.1) were not pushed, so they were not checked.
- **Fixed:** HANDOFF's State of play said Live 0.9.0; its Not built yet list held shipped work
  (playlist refresh, movable rows, the sticky toast queue, the keyboard pass, rooms, AirPlay);
  Open now still named the web demo's unpushed branch. AGENT.md §4 gained `tracks`, `pick`,
  `diag`, `go`, `grow`, and its MCP table the `diag` tool.
- **His word, 2026-09-22:** the Friends desk test (FRIENDS.md §17) PASSED, and the `/j/` Listen
  Along page is deployed on the rooms worker. FRIENDS.md, ROOMS.md and HANDOFF say so now.
- **Merged into `main`** after his 0.13.1 commits were pushed. The merge was clean; HANDOFF now
  says Live 0.13.1.

## 2026-09-21 (late) — pause-source telemetry (for 0.13.1)

- **Why:** his music paused 14 s into "new trick" with no gesture in the ring. No
  `np-bus:command` either, so the tray, media keys and HomePod were unlikely; the pause
  source could not be named.
- **Built:** `player:pause {why, …}` on every playing → paused/stopped change, and
  `player:exit` on `pagehide` (DEBUGGING.md §Why did it pause). Rust stamps `from` on
  `np-command`. `outside` = no note from our code: MusicKit or WebView2 itself.
- Decided inside his ask: the 5 s note window; the `why` words; `room:<source>` for our own
  press inside a room. Ships with 0.13.1, not released. Desk test in that section, not run.

## 2026-09-21 (evening) — the web demo (branch `demo-time`)

- **Designed and built in one sitting** (WEB-DEMO.md). His forks: the real `src/` with a shim
  (1A), every surface, skin and theme (2A), a silent clock (3A), `deets.solutions/deetsmusic/demo`
  (4A), a plain box in each skin's card style, the copy step inside `release:publish`, the app's
  own hover hints.
- **The seam turned out smaller than planned:** `@tauri-apps/api` talks to Rust through one
  global, so the shim defines it and no import is aliased. **No file in `src/` changed.**
- Checked in Chrome, in the site frame too (§9.6). Desk test §10 is not run.
- `../DeetsSolutions` has a local `demo-time` branch with the page and the copied build, not
  committed and not pushed: that repo deploys from `master`, so the page goes live only when
  he says.
- Open: Settings shows every section, not only the look rows (§9.7).
- His pass on the page, same sitting: the look reaches the app's box only; the size buttons
  went (the walk and the cog's N guide instead); *Start over* stays; his line; *App page* +
  *GitHub* in the page bar; no `[ph]` left.

## 2026-09-21 (later) — the N on the title bar cog, and 0.13.0

- **The cog's N** (QUICK-SETTINGS.md §11). The panel helps a new user most, and the walk stays
  as it is. His calls: the N shows until the first press on the cog, and again while any
  `NEW_MARKS` entry is unseen; the first press clears it; existing users see it once too.
  Inside that: the corner disc of §8 with no ring (the title bar has no surface), on the
  button so it does not turn with the gear; *Show the tour again* brings it back. **§11.1 is
  not run.**
- **The re-org, felt out in a real sitting.** It helped: the CLAUDE.md line led straight to
  `NEW_MARKS` and §10, the part marker rule, a fast `docs:check`. It missed: this sitting
  started without HANDOFF or WORKLOG; HANDOFF's "Ship it" still said the version lives in
  four files (RELEASE.md §1 and `docs:check` knew seven); the release log lived only in
  Claude's memory; and moving `AGENT-SETUP.md` broke the Guide button of shipped apps until
  the stub. Fixed: HANDOFF's line, RELEASE.md §0 and §6 say seven, the log is RELEASE.md §0a,
  and `docs:check` now fails when a path a shipped app opens has no file (check 19).
- **0.13.0** — the quick panel, the New badges, the search-term right-click, the Roll back
  list fix, and the re-org. Cut from `dockin`; `main` fast-forwards to it. Publish waits for
  his word on the hand install test (§0 step 3).

## 2026-09-21 — the docs re-org, steps 1–5 (branch `dockin`)

DOCS-ORG.md §11.1a–§11.5a has the whole record. In short: every doc has front matter (status,
shipped_in, desk_test, sources, updated); `npm run docs:check` checks links, mentions, section
pointers, front matter, seven version files and `ideas/`, and the release check warns on it until
2026-09-28; the docs moved into `architecture/ cards/ features/ integrations/ ops/`
(`scripts/docs-move.mjs`); `cards/SURFACES-AND-CARDS.md` is a generated copy
(`npm run docs:copies`); `docs/AGENT-SETUP.md` is a stub for old installs' Guide button;
`CLAUDE.md` is one line per doc; and this file took HANDOFF's "Next up". The first public
release is 0.4.3 (the owner): no `shipped_in` may be older. Doc paths in DeetsSolutions,
DeetsMusicRooms, DeetsMusicFriends and DeetsSupport were re-pointed (comments and READMEs only).
**Not merged into `thirteen` yet** — the owner merges it after he has felt out the effects.


## 2026-09-20 — Branch `thirteen`: the quick panel, NOT RELEASED

> Built, committed and pushed on `thirteen`, not in any release yet. He wants **one more
> thing done in another session before the release**; ask him what it is.
>
> - **The cog's quick panel** (QUICK-SETTINGS.md): ten squares (Apple Music, Discord, then
>   five app icons from his sketches in `docs/assets/quick-settings/`, then Updates and
>   bugs, Reset and a cog = All settings). A square shows its Settings rows through the
>   card's own code (`mountSettingsParts`). He tried it in the dev app on 2026-09-20.
> - **New badges:** an N on each square until its first press (`quickSeen`), and an N beside
>   a NEW setting until hovered (`NEW_MARKS`, §10; CLAUDE.md checklist 5a). **§10.1 is the
>   one desk test NOT RUN.**
> - **Search:** a right-click on a search term pill: Pin / Remove from Recent, or Unpin.
> - **The cog changed its job:** it used to open Settings at full size. Release notes must
>   say so, because a user who presses it gets the panel now.

## 2026-09-20 — 0.12.2: the freeze on live, fixed, desk-tested and PUBLISHED

> **DONE.** Turning on *Share activity on Discord* froze the whole window — `AppHangB1`, three
> times, on the owner's own install. The cause and the rebuild are **FRIENDS.md §8.11**: the
> three `presence` commands were synchronous, so they ran their blocking named-pipe I/O on the
> UI thread, with no deadline, under a lock that the one thread that could have freed them also
> needed. `presence.rs` is rebuilt around one owner thread and overlapped I/O with timeouts.
>
> **Desk test §17a PASSED 2026-09-20** (the owner). **0.12.2 published the same day**;
> 0.12.0 and 0.12.1 stay **WITHDRAWN**, listed with their reason and no download. Checked
> against the live worker: an install on 0.11.1, 0.12.0 **or** 0.12.1 is now offered 0.12.2, so
> the frozen builds are unstuck.
>
> **Two guards came out of it, and they are the part that outlives this bug:**
> `release-check` **check 9** fails a build where a synchronous `#[tauri::command]` can reach a
> blocking call — verified by running it against the 0.12.0 `presence.rs`, which it names
> through three levels of helpers — and **`src-tauri/src/watchdog.rs`** (LOGGING.md) writes the
> line a frozen app cannot write for itself, naming the command in flight. The watchdog SHIPS.
> `autostart_get`/`autostart_set` were the one other offender and are fixed.

## 2026-09-20 — Desk tests: ALL PASSED

> **DONE. The owner desk-tested all four on 2026-09-20 and confirmed them**, and Discord Rich
> Presence — built the same day, after them — was confirmed live from the app as well
> (*"Playing, I see it accurately on discord"*). **There is no open desk test in this repo**,
> with one exception named below: the Rich Presence BUTTONS cannot be seen by the account that
> sets them, so they wait for a second Discord account (FRIENDS.md §8.4 item 3).
>
> **Then FRIENDS ITSELF was built, later on 2026-09-20 (FRIENDS.md §16), so there is ONE open
> desk test again: FRIENDS.md §17.** Steps 1–6 need one PC; steps 7–14 need **two** — two PCs,
> or the dev app beside the installed app, which have separate data dirs and therefore separate
> friend codes. The `deetsmusic-friends` worker is already deployed at
> `musicfriends.deets.solutions`, and `../DeetsMusicFriends/scripts/check.mjs` passes 18 of 18
> against it, so what §17 tests is the APP, not the wire.
>
> The four scripts are kept below. They are how these features get re-tested after a change,
> and they are the record of what "passed" meant.

**Four features were built on 2026-09-20 and all four were confirmed the same day.** They share
one sitting and one dev app. Run them in this order if you run them again — the toast queue
first, because playlist refresh's own offer is a sticky toast and step R11 leans on the queue
being right; then pins, then **movable rows**, the two whose gestures are all yours.

**Read this before you start.** Three of the four write to the schema — `playlist_refresh` is
**v11**, `pins.act` is **v12**, `row_order` is **v13** — and they are in **one untested tree**,
which is the case the one-load-bearing-feature rule exists to prevent. You asked for it that way and it is built that
way; the cost is that if something goes wrong on a real database, the first question is *which
migration*. Both are additive and idempotent, and neither touches a row that already exists.

**The doc pass is done** (2026-09-20): TOASTS §4a.7, PLAYLIST-REFRESH §10, PINS §8.6 and
MOVABLE-ROWS §12 are each marked **PASSED 2026-09-20**, and their as-built sections now record
what has been seen to work, not only what was built.

Start once, and leave it running for both:

```bash
npm run dev:app
```

Everything below that says *I fire* is `node scripts/webview-eval.mjs "<expr>"` from this
session, which runs one expression in the dev app's webview exactly as if it were typed into
its console (DEBUGGING.md §Driving the webview). **You can type any of them yourself** — they
are all on `window.__toast` and `window.__refresh`. Set Settings › Menus, hints and notices ›
Show notices to **Everything** before you start.

---

### Test 1 — the sticky toast queue (TOASTS.md §4a.7)
Past the cap of 3, a sticky toast used to be **destroyed** with its buttons unrun — a Reset
Undo, a delete confirm, the export question. It now **waits**. One file, `src/toast.ts`; no
schema, no token, no setting, and no call site changed.

Past the cap of 3, a sticky toast used to be **destroyed** with its buttons unrun — a Reset
Undo, a delete confirm, the export question. It now waits. Two read-back calls carry the proof,
and I read them, not you: `__toast.waiting()` lists what is in the queue, ask-first, and
`deetsmusic diag` shows `toast:queued` · `toast:dequeued` · `toast:dupe` · `toast:dropped {why}`.

| # | I fire | You confirm on screen |
|---|---|---|
| 1 | `__toast.queue(4)` | **Three** toasts, not four. Dismiss one → the fourth arrives, with the normal slide. Before this build the FIRST was destroyed instead |
| 2 | `__toast.queue(3)` then `__toast.push({text:"timed"})` | The timed one shows and **no sticky disappears**. Four are up for its ~3 s, then it goes by itself |
| 3 | `__toast.demo()` ×3 | Three timed, then a sticky: the oldest **timed** yields, exactly as before |
| 4 | queue one, then `dismiss()` it before a slot frees | It **never appears**, even after you dismiss two |
| 5 | queue one, `update()` it, then free a slot | The **new** text shows, not the original |
| 6 | queue a `dismissKey` notice, silence that key, free a slot | It does **not** appear |
| 7 | the same text twenty times | **Three** show (they fill the stack as any three do); nothing queues behind them |
| 8 | twenty different stickies | Three show, ten wait, seven are dropped — dismiss repeatedly and count ten arrivals |
| 9 | fill the stack + queue, then switch surface (title menu › Surface, midi → max) | The stack moves with the surface **and the queue survives** — keep dismissing, they keep arriving |
| 10 | Windows *Show animations* off, then free a slot | A waiting toast still arrives, **without the slide** |
| 11 | `__toast.queue(3)`, `__toast.queue(2)`, `__toast.queue(1,"ask")` | Free a slot: the **ask** appears before the two offers that were queued ahead of it |
| 12 | fill the stack, queue one ask, wait 30 s | Free a slot → **nothing appears**. Repeat with an offer → it still appears after a minute |

Steps 1, 2, 7, 11 and 12 are the ones that can only be judged by eye. The rest I can also
confirm from the diag ring if you would rather watch fewer.

---

### Test 2 — playlist refresh (PLAYLIST-REFRESH.md §10)

The bug: a mirrored Apple playlist cached its songs **once, ever**, so New Music Mix served
last Friday's songs until you pressed ⟳. Three read-backs are mine:

| I run | It says |
|---|---|
| `__refresh.all()` | every covered playlist: its mode, whether that is a stored choice or its kind's default, when it was last read, and whether it is due |
| `__refresh.due()` | just the ones due right now |
| `__refresh.check()` | runs the day-change check on demand, whatever the date says |

**A note on the very first run.** Nothing has ever been stamped, so **every covered playlist
is due**. That is correct and it is also the loudest the feature will ever be: the first
`__refresh.check()` will read up to 25 playlists from Apple. Expect it to take a moment and to
end with one toast. After that, stamps exist and the rest of the test is quiet.

| # | I fire | You confirm on screen |
|---|---|---|
| **R1** | — | Right-click a playlist from **Apple Mixes**: a **Refresh ▸** row, badge reading **Daily**. Right-click one of **Your Apple Playlists**: the same row, badge **Off** |
| **R2** | — | On that mix, open **Refresh ▸ Weekly ▸ Fri**. The parent badge now reads **Weekly · Fri**, and re-opening shows the tick on **Fri**. Open **Weekly ▸** with the window at its RIGHT edge: the second flyout flips to the left instead of running off |
| **R3** | — | Re-open the menu — still *Weekly · Fri*. Restart the app — still *Weekly · Fri*. Press **⟳** in the Playlists header, then re-open: **still there**. R3 is the step that catches a preference stored in the table the sync wipes |
| **R4** | `__refresh.all()` | (I read it.) That playlist reads `mode: "weekly"`, `set: true`; the others read their kind's default with `set: false` |
| **R5** | — | Set it back to **Daily**. Open a catalog mix that has never been opened: it reads from Apple **before** its rows draw, and if its songs changed a toast names it and the count. Open it again at once: **no** second read, rows are instant |
| **R6** | `__refresh.check()` | With several due: one toast, either *“…” has N new songs.* for a single playlist or *N playlists updated.* for several. **Never one toast per playlist** |
| **R7** | `__refresh.check()` | Run it twice in a row. The second time: **no toast at all** — due, refetched, nothing changed is silent by design |
| **R8** | — | Settings › Playlists › **Refresh playlists by themselves** → off. `__refresh.check()` does nothing and opening a due playlist does not read. Switch it back on: every per-playlist choice is still there |
| **R9** | — | Turn the Wi-Fi off, then open a due playlist: a **warn** toast, the old songs still show, and nothing is lost. Wi-Fi back on, open it again: it reads and the warn does not repeat |
| **R10** | — | Right-click a playlist you made here that was **never exported**: there is **no Refresh row**. Export it to Apple once — the row appears, reading **Off** |
| **R11** | — | Set that exported playlist to **Daily**, add a song to its Apple copy from the Music app, then `__refresh.check()`: a **sticky** toast offers *“…” has 1 new song on Apple Music.* with **[Get them]**, and your playlist is **unchanged** until you press. Press **Dismiss** and run the check again — it offers **again**. Press **[Get them]** — the song lands |
| **R12** | — | Ctrl+Space, type **refresh** → *Refresh playlists now* runs the same check. Typing **stale** finds it too |
| **R13** | — | The 25-per-check cap only shows with 30+ due mirrors. If your library has that many, `__refresh.check()` reads 25 and the rest read when opened. If it does not, skip R13 and say so |

**What neither of us can fake cheaply.** The *day change itself* — R6 and R7 use
`__refresh.check()`, which forces a check; only a real date change proves the hourly tick
notices one. If you want that covered, move the Windows clock forward one day with the app
open and watch for the toast within the hour. Otherwise it stays untested and the doc will
say so.

**If I need to make something stale** (to re-run R5 or R6 after the stamps are fresh), it is a
write to the dev database, so the app must be **closed** first:

```bash
python -c "import sqlite3,os; d=sqlite3.connect(os.path.expandvars(r'%APPDATA%\com.deetsmusic.dev\deetsmusic.db')); d.execute('UPDATE playlist_refresh SET fetched_at = fetched_at - 3*86400000'); d.commit(); print(d.total_changes)"
```

---

---

### Test 3 — pins, On Click (PINS.md §8.6)

Every pinned tile now carries its own verb: **Play · Shuffle · Open**, on a right-click **On
Click** row above Pin / Unpin. One pin, one verb, in all four Pinned shelves. A song pin and a
station pin are not asked — they play.

**Nothing changes until you change it.** Every pin that exists today has no verb, and no verb
means the rule its card already followed, which is Open for an album, a playlist and an artist.
That is the whole point of the default you chose.

These gestures are all yours; I read the `pin:act` and `ui:act` lines from the diag ring after
each one, and `__refresh` is not involved.

| # | You do | You confirm |
|---|---|---|
| **P1** | Right-click a pinned **album** tile in Library | **On Click ▸** above Pin / Unpin, badge reading **Open**, and the tick on Open inside |
| **P2** | Set it to **Play** | The tile plays instead of drilling |
| **P3** | Set it to **Shuffle** | It starts on a song that is not track 1 (try three times). With Settings › Playback › *Shuffle button stays on*, the toolbar Shuffle is **lit** afterwards — the same as pressing a card's own Shuffle |
| **P4** | Set it back to **Open** | It drills again |
| **P5** | Find the same pin on **Home** | It obeys the same verb. On **Open**, Home hops to the **Library** card at that album — Home has no detail of its own |
| **P6** | A pinned **playlist**, set to Play, then Open | Play plays; Open drills — in Playlists it opens in place, from Home it hops to the Playlists card |
| **P7** | Right-click a pinned **song** and a pinned **station** | **No On Click row.** Both still play on click |
| **P8** | A pinned album that is **not in your library** (pinned from Search), set to **Open** | It plays whole — there is no detail to open — and the log shows no error |
| **P9** | Re-pin something that has a verb set (Unpin is not involved: pin it again from its menu elsewhere) | The verb holds, and so does its place in the shelf (§7) |
| **P10** | Settings › Playback › **New pins open on click** = **Play**, then pin something new | The new pin plays on click. **An old pin keeps its own verb** |
| **P11** | Restart the app | Every per-pin verb is still there |
| **P12** | **Unpin** something, then pin it again from scratch | It starts on the Settings default again, not its old verb |

I can also confirm P11 and the storage from outside: the agent's SQL now exports the column,
so `select id, kind, act from pins` reads every verb.

---

### Test 4 — movable rows + the Settings search bar (MOVABLE-ROWS.md §13)

**Built 2026-09-20, in the same sitting as the three above.** Read
[MOVABLE-ROWS.md §13](features/MOVABLE-ROWS.md) before you start — it is the as-built section, and the
full desk test is §12 (20 steps). What follows is the short version and the things only you
can judge.

**The gesture is your own shape, so the first thing to check is the feel of it.** A section
header is its own grip **while it is held**: press it, hold still for **400 ms**, and it
swells, then lifts. Let go early and it just folds, exactly as before. Move early and the
press is dropped whole, so a scroll that starts on a header is never stolen. A pinned tile
has no header, so it carries a **grip bar** over the left of its cover — three dots, shown on
hover, pressed and dragged sideways.

**It writes to the schema: `row_order` is v13.** That is the fourth migration in this tree
(v11 playlist_refresh, v12 pins.act, v13 row_order). Additive, idempotent, and nothing that
exists is touched.

| # | You do | You confirm |
|---|---|---|
| **M1** | Hold a **Settings** section header, drag it above another, let go | It folds shut as it lifts, lands where the line showed, and opens again |
| **M2** | Close the card and summon it again; then restart the app | Your order is still there (it is in SQLite, not localStorage) |
| **M3** | Press a header and move **at once** | The card scrolls. No ghost, no fold change |
| **M4** | Press a header and let go **before** it swells | It folds, as it always did |
| **M5** | **Home**: hold a shelf's label, move *Pinned* to the top. Then play a song | The order holds across the rebuild. Leave it running past an hour boundary: the bucket shelf changes its label and keeps your place |
| **M6** | **Radio** (Featured view): move *Genres* above *Recents*. Switch to A–Z and back | The headers flatten out with no grip and no crash; your order is there on the way back |
| **M7** | **Playlists**: move a folder above another. Then hold a **playlist row** inside a folder and move it | The row stays inside its own section — it will not jump to another folder. A plain drag on that row still carries its songs to the Queue |
| **M8** | **Pinned tiles**: hover a pinned tile, press the grip bar, drag it one seat sideways | It moves. The same order shows on the Library, Playlists and Radio roots **and on Home**, which now follows your hand order instead of play counts (fork 12A) |
| **M9** | Drag a pinned tile by the **cover**, not the grip, onto the Queue card | It still carries its songs. This is the step that catches the gesture being wired wrong |
| **M10** | Settings › Window › **Move sections by holding** → Off | No header moves anywhere; the hover hint stops mentioning it. The tile grip still works |
| **M11** | Settings header's **search button**; type `tray` | Only *Minimize to Tray* shows, its section open, everything else hidden. No header can be moved while the field has text. Clear it: your folds are exactly as they were |
| **M12** | With **Cyber** on, search `glass` | The Glass-only rows do not appear — a row you cannot reach is never a result |
| **M13** | Press inside Library, then **Ctrl+F** | Library's own search field opens. Same in Playlists, Radio, Search and Settings |
| **M14** | Settings › Reset › **Row order** → Reset → Confirm | Everything goes back to its built-in order, and the toast's **Undo** puts your whole arrangement back |

**What I decided inside your forks** is listed in MOVABLE-ROWS.md §13.8 — eight items, the
two worth your eye being that the Settings row sits in *Window › Growing and drilling* (not
Playback), and that a **playlist row also moves by hold**, not by plain drag, because a plain
drag on that row already means two other things.

---

### Discord Rich Presence — built and confirmed 2026-09-20 (FRIENDS.md §8.10)

Your Discord profile reads **Listening to DeetsMusic**, with the song, the artist, the album,
the cover and a progress bar under it. It was measured against the real client before any code
was written (§8.4a), then built, then confirmed live from the app the same day.

**What the measurements settled**, because two of them shaped the build:

- **`type: 2` works** — the headline says *Listening to*, not *Playing*.
- **`status_display_type` is kept by Discord and ignored by the client.** Tried at 1 and at 2.
  So the headline is the **application's name**, which is the one thing you agreed to that did
  not come true (§8.4 item 1 warned it might not). Everything under the headline is Spotify's
  shape.
- **The Apple cover needs no upload.** Discord's media proxy took the plain `https` URL and
  rewrote it to `mp:external/…`. No asset keys, no extra Apple call, no logo fallback.

**Two gotchas worth keeping:**

1. Discord hides RPC activity unless **its own** Settings › Activity Privacy › *Share your
   detected activities with others* is on. The app cannot see that switch, so the Settings row's
   hint names it. A card that does not appear is this before it is anything else.
2. The card lives exactly as long as the pipe. Quitting DeetsMusic takes it down by itself.

**The one thing still open in the whole repo:** the two buttons (*Play on Apple Music*,
*Listen Along*) and the clickable song title are **invisible to the account that sets them** —
Discord's own guide says so, and the probe confirmed they are accepted. Reading them needs a
**second Discord account or a second person**, the way ROOMS.md §17 needed a second app. Until
then they are proven sent, not proven readable.

**And one thing waiting on you, not on me:** *Listen Along* points at
`https://rooms.deets.solutions/j/<CODE>`. That route is **written and committed in
`../DeetsMusicRooms` and NOT deployed** — a worker deploy drops every live room socket, so it
is your call when it goes out (it would carry the two parked `epoch` lines from ROOMS.md §18.7
at the same time). Until it is deployed, leave *Let my profile invite people to my room* off,
or the button leads to a 404.

`node scripts/discord-probe.mjs --id <app id> --case full --hold 120` re-asks every measurement
against a future Discord update without touching the app.

---

## Before 2026-09-21 — the older entries, as HANDOFF.md held them

> Moved verbatim from HANDOFF.md's "Next up" on 2026-09-21 (DOCS-ORG.md §7). Newest first,
> one bold dated paragraph per entry. Entries from 2026-09-21 on are one `##` per sitting.

**Both workers went out 2026-09-20 and are committed and pushed** — `deets-support`
(`2e36602`, the refreshed sign-in token sheets) and `deetsmusic-rooms` (`16e4421`, the `epoch`
deletion, ROOMS.md §18.7).

**2026-09-20 — four features designed on branch `twelve`. A and B are now BUILT.**

| | Feature | Doc | State |
|---|---|---|---|
| **A** | **The sticky toast queue** | [TOASTS.md](architecture/TOASTS.md) §4a | **BUILT 2026-09-20** (§4a.8). Desk test open — the table above |
| **B** | **Playlist refresh** | [PLAYLIST-REFRESH.md](features/PLAYLIST-REFRESH.md) | **BUILT 2026-09-20** (§11). Desk test open (§10, 13 steps). Schema **v11** |
| **C** | **Movable rows** | [MOVABLE-ROWS.md](features/MOVABLE-ROWS.md) | Scope closed (§0a), 10 mechanism forks open (§11.2) |
| **P** | **Pins › On Click** | [PINS.md](features/PINS.md) §8 | **BUILT 2026-09-20** (§8.7). Desk test open (§8.6). Schema **v12** |
| **D** | **A Settings search bar** | [MOVABLE-ROWS.md](features/MOVABLE-ROWS.md) §10 | 4 forks open (§11.3). Cheap — it reads the Compass's own `settingsRows()` index |

**Also closed on 2026-09-20: PINS.md §8.2a** — a new pin starts on **Play** for a song or a
station and **Open** for an album, playlist or artist (option C). Every fork in PINS §8 is now
closed, and it is the next thing that can be built; its `pins.act` column is **v12**, not the
v10 the doc used to say (v10 is Song of the Day, v11 is now `playlist_refresh`).

**What playlist refresh needs at the desk.** Steps 4, 5 and 12 of
[PLAYLIST-REFRESH.md §10](features/PLAYLIST-REFRESH.md) need a stamp moved back in SQLite or the
machine's clock moved forward a day — I can do both from this session (`query` over
`playlist_refresh`, and the clock is yours). Step 3 is the one that catches a preference
stored in the wrong table: set a choice, press **⟳**, re-open the menu.

**Why A came before B even though B was the decided one.** A fixes a live bug, not just a
missing feature: past the cap of 3, `toast.ts` **destroys** the loser (`victim.remove()`,
[toast.ts:256](../src/toast.ts)), and when all three live toasts are sticky the oldest sticky
goes **with its actions unrun**. So TOASTS.md §4's promises — *"a question always shows"* and
*"an Undo always shows too"* — can both break today: a Settings › Reset **Undo**, the export
question that gates an Apple write, or B's own `[Get them]` offer can vanish unseen. B's §7.2
notice is only trustworthy once A exists.

**Why B is the biggest user-visible win.** A mirrored Apple playlist caches its songs **once,
forever**. The once-per-session sync evicts only when a flat-list attribute changed, and Apple
rewrites **New Music Mix** every Friday without changing one — so it serves last week's songs
until you press ⟳. The owner hit this on 2026-09-19. PLAYLIST-REFRESH.md §0 has the proof and
the code comment that predicted it.

**Two schema-touching pieces must not share a tree** (the one-load-bearing-feature rule):
B's `playlist_refresh` table (§6, now v11) and C's `rank` column on `pins` (§5.2). C's pinned tiles are
its own hand-over for that reason, and they also need a **sideways** drag axis that
`row-drag.ts` does not have.

**What the owner decided this session, all recorded in the docs:** PLAYLIST-REFRESH D1–D10
(§3, including F1/F2/F3 settled in §9) and MOVABLE-ROWS §0a (sections everywhere; items only
for pinned tiles and playlist rows — radio stations and Home's other shelf tiles are out).
PLAYLIST-REFRESH §1 also settles, from signals we already have and with **no new Apple call**,
how to tell Apple's playlists from the user's — `canEdit` and `globalId` give `user` /
`catalog` / `smart`, which is what the defaults key on.

**Not started, and not to be started without an answer:** every fork listed above.

**2026-09-19 — Friends is designed and scheduled to be built** ([FRIENDS.md](integrations/FRIENDS.md)): a friend
code that stands for one person, presence, a friend's row as the way into a room, and broadcasting
what you play to Discord. Decided: no heartbeat (D1), a friend's row opens a room (D2), a "busy —
your music is not affected" toast that also fixes Rooms' raw 429 (D3), and **a new worker,
`deetsmusic-friends`** (D4). Nine forks in §11 are still the owner's, and §10 is the build order —
its steps 1 to 3 (identity, the local friend list, the Discord channel post) need no worker at all.
The owner said "implement in the evening or tomorrow" (so 2026-09-19 or 2026-09-20).
**The desk tests are clear.** On 2026-09-19 the owner confirmed every open desk test in the repo has
been run and passed — ROOMS §16.4 and §17.4, DeetsOTD §8.11, PINS §6, HOME §10.10, COMPASS §7 (the
§7.10a calculator included), STAGE-COLUMN §8, CARD-MEMORY §9, CARD-GROW §14.8 and §15.5, AIRPLAY §11
and §12.4, LOCAL-DATA §11 step 9. Each doc now says PASSED with that date. **The one exception is
ROOMS §18.7** — the four race fixes, still uncommitted in `src/room.ts` and `src/player.ts`, which is
the one piece of open ground a Friends socket would sit beside.
A related design that is NOT part of this build: [ROOMS.md](integrations/ROOMS.md) §20, a room that writes no
SQLite rows (~450 rows → ~0). Build its shape in Friends first; leave the shipped Rooms alone.

**2026-09-18 — 0.10.0 is live on the `deetsmusic` channel** (`main` at `5850210`; installer
7.4 MB). It ships listening rooms ([ROOMS.md](integrations/ROOMS.md) §16), song credits and the song pane
([CREDITS.md](features/CREDITS.md) §7), the Max stage column ([STAGE-COLUMN.md](cards/STAGE-COLUMN.md)), card
memory ([CARD-MEMORY.md](cards/CARD-MEMORY.md)), the AirPlay speaker-only tap and its in-panel
permission question ([AIRPLAY.md](integrations/AIRPLAY.md) §9.5, §12), the Compass card shapes and the turning
needle ([COMPASS.md](features/COMPASS.md) §2c, §12), DB write health ([DB-HEALTH.md](ops/DB-HEALTH.md)) and the
list-place fix ([RELEASE-NOTES.md](ops/RELEASE-NOTES.md) 0.10.0). Published at the owner’s request
without the hand install test of RELEASE.md §0 step 3, and with these desk tests then open (**all
passed since; confirmed 2026-09-19**): ROOMS §16.4 (two apps in step — the release notes announce rooms as finished, the
owner’s call), STAGE-COLUMN §8, CARD-MEMORY, CARD-GROW §14, COMPASS 15–25, AIRPLAY §11 (the claim
guard). The route answers: `GET /update/deetsmusic?v=0.9.5` offers 0.10.0, and
`/update/deetsmusic/health` is `ok`.

~~**Not done with this release:** `npm run signin:assets` and a DeetsSupport `wrangler deploy`.~~
**DONE 2026-09-20.** `signin:assets` copied one changed file (`skin.css`, +46/−4 — the
`--room-*` and card-grow tokens) into `../DeetsSupport/src/signin/`, and the worker is
deployed (`ff345ccb-f770-4662-a470-6c04d29a6c17`; `music-api.deets.solutions/signin` = 200).
The rooms worker went out the same day with the `epoch` cleanup (ROOMS.md §18.7). Both
worker trees are **deployed but not committed**.

**Small, ready to do (owner takes it next dev cycle, 2026-09-17).** `src/web.ts:1028` defers a
row press with `window.setTimeout(() => activate(r))` for one reason only: picking rebuilt the
rows, the pressed row left the document, and `dropdown.ts` then read the press as a click away
and closed the panel. Its comment says exactly that. **The cause is fixed in the primitive**
(a target no longer in the document is not a click away, `src/dropdown.ts`; ROOMS.md §16.7 has
the whole story), so the workaround is dead weight and, worse, a pattern somebody will copy.
Remove the `setTimeout` and its comment, call `activate(r)` straight, then press a hit row in
the Playlists web panel: the panel must stay open and the rows must redraw as before.

**BUILT 2026-09-18 — NP renamed to Player.** The surface that holds Now
Playing alone is called three things today, and a hover hint papers over the gap instead of
closing it: the Surface menu says **NP**, the tray row and Keep on top offer **Player**, Settings
says **Player (NP) opens at** with the hint "called NP in the Surface menu", and the Compass says
**Player (NP)**. One thing, one name: **Player** everywhere. Found in the 2026-09-18 wording pass
over [SETTINGS-INVENTORY.md](architecture/SETTINGS-INVENTORY.md); it is the only naming slip a user can trip
over.

The Surface menu also changes shape. `Mini | NP` is one flyout item cut in two
(`.flyout__split`, the search-pin idiom, `index.html` around line 126). The halves were `flex: 3`
and `flex: 1`, so Mini took three quarters and NP one. **They are now EQUAL** — `flex: 1` each.
2/1 was tried first, on the idea that a half's width could preview how much the window holds;
at the desk "Player" did not fit a third, so the width stops carrying that meaning and the
label is simply legible. The labels are also **centred** now. That was a real bug, not a
side effect of the width: the half was `justify-content: space-between`, which pins the label
to the left edge and the dot to the right, and at three quarters' width with "Mini" in it that
read as ordinary menu-row alignment. **The radio dot is now out of the flow** — absolutely
placed in the half's own right padding — so it costs no width and the label centres on the
half itself. An in-flow dot slot cost each half a slot AND a gap, and balancing it with an
empty twin (tried first, 2026-09-18) cost a second of each and made the flyout too wide.

Where the name lives, all user-facing:
- `index.html` — `data-mini-choice="player"`'s label and its `title`.
- `src/settings-card.ts` — `sizeRow("sizeplayer", "Player (NP) opens at", …)`: drop the `(NP)`
  and the "called NP in the Surface menu" clause from its hint. The `trayView` and `alwaysOnTop`
  options already read **Player**; leave them.
- `src/compass.ts:318` — the `name === "NP" ? "Player (NP)" : name` special case goes away once
  the menu itself says Player. Update `SYNONYMS` so **NP** still FINDS it (an old habit must keep
  working), and add the term to [COMPASS-TERMS.md](features/COMPASS-TERMS.md).
- `src/styles.css` — the `.flyout__split` comment says "Mini takes three quarters, NP one";
  rewrite it with the new ratio and the new name.
- Store keys stay `sizePlayer` / `player`: they already say Player, and a key rename is a stored
  shape for no gain.

**As built.** All of the above, plus: `SYNONYMS` in `compass.ts` gained `np` and `nowplaying`
→ `player`, so an old habit still finds it, and the pair is listed in
[COMPASS-TERMS.md](features/COMPASS-TERMS.md). The name was updated in ONBOARDING.md's hint ledger,
COMPASS.md, SURFACES-AND-CARDS.md, SETTINGS.md §3 and SETTINGS-INVENTORY.md (the glossary keeps
an **NP** entry that points at Player, so a search for the old word lands somewhere).
**"NP card" is left alone everywhere** — that is shorthand for the Now Playing card, which is a
different thing from the surface. The dated design logs (FUTURE-SETTINGS.md, NEXT-VERSION.md,
RELEASE-NOTES.md) keep the old name: they record what was decided under the name it had.

**Desk test.** Title menu › Surface: the row reads **Mini | Player**, the two halves are the same
width, each label is centred in its half, and the flyout is no wider than the Midi / Max rows
below need. Click between the halves: neither word moves as the dot jumps across. Pick Player —
the window becomes the player alone. Settings › Window reads
**Player opens at**. Ctrl+Space, type `np` — the Player row comes back; type `player` — same row.

**BUILT 2026-09-18 — the Settings card is regrouped.** The wording pass shipped first; this is
the organization. He decided all four forks on 2026-09-18: **1C, 2A, 3C, 4A**.
[SETTINGS-INVENTORY.md](architecture/SETTINGS-INVENTORY.md) and [SETTINGS.md](architecture/SETTINGS.md) §3 are rewritten
around it. No store key changed, so there is no migration.

**What he chose.**
- **Fork 1 = C (mixed).** *Look and feel* becomes four real sections — **Look schedule**,
  **Motion**, **Skin settings**, **Menus, hints and notices** — which is how `RESET_GROUPS` has
  split it for months. **Window keeps one fold** and names its groups instead.
- **Fork 2 = A (a real Sound section)**, and Sleep answered the same way — **then amended the
  same day**: the rows were first taken OUT of the two panels, and he put them back. The
  preferences now live in **both** places. See "The amendment" below.
- **Fork 3 = C.** *Show the day in History* stays in Playback. *Export playlists* still moved from
  Apple Music to Playlists.
- **Fork 4 = A.** Window / Window sizes / Growing and drilling.

**As built.** Fifteen sections became **twenty**: Tips · Window · Look schedule · Motion · Skin
settings · Menus, hints and notices · Home · Playback · **Sound** · **Sleep** · AirPlay · Apple
Music · Last.fm · Playlists · Rewind · Connections · Updates · Reset · Bugs · About.
- **Nine Sound preferences are rows of Settings › Sound** (Avoid distortion, Lower the song by,
  Remember each output, Match songs to, Keep albums together, Songs not measured get, Follow the
  volume of, Blend amount, Ask to keep after) **and stay in the Sound panel**. The panel is
  unchanged from 0.10.1; only the card is new.
- **All four Sleep preferences are rows of Settings › Sleep** and **stay in the sleep panel**.
  Reset gained a **Sleep** group; it had none, which is the mismatch fork 2 asked about.
- `compassCloseAway` moved from Window to Menus, hints and notices, in the card, in `SPECS` and in
  the Reset groups.
- `agent-settings.ts` sections were renamed to match the card row for row, `theme` and `skin`
  included (they are now **Theme and skin**, the Reset row's name). The Compass prints these
  strings under a Settings row, so a name only `SPECS` knew was a name the user could not find.

**The amendment (same day, his call).** 2A as first built REMOVED the nine Sound rows and the four
Sleep rows from their panels, on the rule "live actions in the panel, preferences in the card". He
rejected that: **"first time users interacting with those panels won't be going to settings."** A
panel has to be finishable on its own. Both panels were restored exactly — `git checkout` of
`sound-panel.ts` and `sleep.ts`, the markup and the CSS put back at their original lines, the
token restored and TOKENS.md regenerated — and the card sections were kept. The preference is in
two places; the state is in one. Both controls call `setSetting` on the same key and both repaint
from `onSettingsChange`, so nothing can drift.

He chose this over the two other real options: undo 2A outright, or fork 2B (one card row with an
**[Open]** button). What decided it: **`compass.ts:339` builds the Compass's Settings rows from
`settingsRows()` — the CARD — not from `SPECS`.** Under 2B, Ctrl+Space could find "Sound" but
never "Blend amount". **Fact 1 of the original fork write-up claimed the Compass reads `SPECS`
and was wrong.** Nothing was built on it: fork 1's answer does not depend on it.

It costs one line of the user guide. "A control lives in exactly one place" now reads: one place,
unless a title-bar panel and the card serve different moments — the panel while you listen, the
card while you configure. Sound and Sleep are the only such pair. Rooms is not one: a live change
there is a room command, not a setting.

**Decided inside his choice** (none of these was a fork he saw):
1. **The sub-heading is `.set__sub-head`, not `.set__group`.** `.set__group` is the bordered
   My-reports family; a group of plain rows inside a section gets a name, not a box — the card's
   own rule is "a hairline groups the section; no boxes". Same type as a section header, no
   chevron, no count, no hairline, so nothing invites a click. It is skipped by the header's count
   and by the Compass index.
2. **Sound got sub-headings too** (*Equalizer*, *Adaptive sound*), by fork 1C's own logic: its nine
   rows serve one idea in two halves.
3. **Fork 4A's group is called *Growing and drilling*, not *Cards*.** Fork 3A would have used
   *Cards* for Home + History + Rewind. Two meanings of one word in one card.
4. **Keep on top moved up** into the *Window* group. It is a property of the window, not of a size.
5. **A section with every row gated off is not drawn at all** — no empty header. Splitting Skin
   settings out created that case: Cyber sets nothing of its own.
6. **"Lower the song by" is a slider in the card, not a menu.** The panel's control for the same
   key is a ± stepper; −24…+6 dB at half-decibel steps would be 61 menu entries. `RangeRow`
   gained an optional `step`, so the slider makes the same half-decibel move as the stepper
   (arrows step one, Shift ten) and the two controls can never land on values the other cannot
   reach. Nothing else uses `step`.
7. **"Sleep at" is a menu of the whole day in quarter hours** (96 entries, the dropdown scrolls).
   The panel's ‹ › moved in 15-minute steps and `agent-settings.ts` already declared
   `step: 15` over the full day; a shorter band would have left a stored time with no option.
8. ~~The Sound panel's review question shows its line of text.~~ **Undone by the amendment.** It
   was only needed because the "Keep:" pill had left the footer. The pill is back, the words are
   its tooltip again, and `--sound-foot-pill-w` and the sleep-panel rules are restored at their
   original lines. TOKENS.md is back to 493 rows.
9. The `.set__section` element is now keyed `data-sec="<title>"`, because the fold's enter-motion
   looked the section up by index and an undrawn section breaks that.

**Desk test.**
1. Settings: the header list reads as the twenty above. Every section but Tips and About starts
   folded — including ones you had open before, which is the known `deets.settings.folds` cost of
   a rename. Open each: no empty section, no count that disagrees with the rows.
2. **Window**: three sub-headings, *Window* · *Window sizes* · *Growing and drilling*. The count
   badge says 19, not 22 — a heading is not a setting. The first heading has no gap above it.
   *Keep on top* is in the first group. *Compass closes on outside click* is **not** here.
3. **Skin settings**: under Press it holds the four record rows; under Ocean, two; under Glass,
   five with Fancy Glass on. **Switch the skin to Cyber — the whole section disappears.** Switch
   back: it returns, folded or open as you left it.
4. **Sound**: the nine rows under two sub-headings. Set *Avoid distortion* to **By hand** —
   *Lower the song by* appears. Drag it: the readout moves in half decibels. Arrow keys step 0.5,
   Shift+arrow 5. Set it back to Limiter only — the row goes.
5. Open the **Sound panel** (title bar): it is exactly as it was in 0.10.1 — both folds hold their
   settings, and the footer still has the "Keep:" pill. **Now the duplication test:** change
   *Blend amount* to **Strong** in the panel, close it, open Settings › Sound — the row already
   reads Strong. Change it back in the card, reopen the panel — the pill already reads Medium.
   Do the same once with *Avoid distortion*, which has four values and a dependent row.
6. **Sleep**: set *Sleep every day* to **At a time** — *Sleep at* appears with a quarter-hour menu.
   Pick 11:15 PM. Open the **sleep panel**: its Every day pill says *At a time* and the time row
   says 11:15 PM. Press ‹ in the panel — the card row follows to 11:00 PM.
7. **Menus, hints and notices**: *Compass closes on outside click* is the last row and still works
   (open Ctrl+Space, click a card — it closes; turn the row off, repeat — it stays).
8. **Ctrl+Space**: type `blend` → *Blend amount*, sub **Sound**. Type `wind` → *Wind down*, sub
   **Sleep**. Type `fancy` → *Fancy scrubber* under **Motion**, *Fancy Glass* under **Skin
   settings**. Each sets inline, without opening the card.
9. **Reset**: the row list gained **Sleep**. Reset it — the four sleep rows go back to Off / 22:00
   / 5 min / off. Reset *Menus, hints and notices* — the Compass rule comes back on with the rest.
10. `deetsmusic settings list Sound` and `list Sleep` from the CLI print the same labels the card
    shows. `list "Look and feel"` now finds nothing; `list Motion` does.
11. With the Sound panel OPEN, run `deetsmusic settings set soundCrossfeedLevel light` — the
    panel's pill moves under the pointer. That is `onSettingsChange` doing the work both
    controls already depended on; it is why the duplication needs no code of its own.

**Explicitly not in scope:** "web" is a coined noun across five Playlists rows that the card
never defines (found in the same review). He looked at it on 2026-09-18 and does not mind it.

**DUE: a full system health check (owner's call, 2026-09-17).** Two parts, in this order, both
from [DEBUGGING.md](ops/DEBUGGING.md) "What the tools cannot yet see — the 2026-09-17 review".

1. **Build the tooling first** (the owner builds it in an evening session): items 1–3 together —
   heaviness rows with context (skin, surface, playing, AirPlay mode, Sound, record player, tray)
   and a per-process split by `--type`; a `scripts/perf-report.mjs` reader that prints p50 / p95 /
   worst per `[perf]` name, every `panic:` line and the AirPlay verdicts across both log
   generations; `host_cpu_pct` / `host_ws_mb` columns and an `airplay` scene in `bench.mjs`. Then
   items 4–7 as time allows (new scenes, memory columns, boot trend, log retention).
   Which app each tool sees: the sampler and the reader see the INSTALLED app (the bridge's
   `/now-playing` needs the pairing token from the installed `settings.json`; `/settings` is
   gated by Agent control, so it is optional); the bench sees the dev app only, by design.
2. **Then run the check, in a session, and write what it finds here.** Performance, weight,
   system load and feature jank, over the installed app and `dev:built`: the heaviness log
   over a day of real use with the new columns; every bench scene on every skin against the
   rows in `scripts/perf-history.csv`; the dev log's click→sound, frames and input percentiles;
   the AirPlay tap after §12's desk test (`worstGapMs`, `starved_packets`, host CPU); the
   Sound graph at 44.1 kHz.
   **Open leads to close on the way:** (a) the night of 2026-09-16, the installed tree climbed
   687 → 1374 MB and 2.5 → 288 % CPU over two hours on the AirPlay loopback, with the renderer
   and GPU process flat — the growth was in a process the sampler did not name; (b) `panic:
   cannot move state from Destroyed` (tao `event_loop/runner.rs:371`) at 01:57:08 the same
   night, 40 s after the relaunched 0.9.0 finished its sync — an exit-path bug; suspects are the
   tray Quit, the updater's restart and the AirPlay teardown, each of which can touch the window
   after tao destroyed it. Needs code reading plus a reproduction on the dev app, not tooling.

**2026-09-17 — bulk delete local playlists, and the list stopped jumping to the top.**
The owner asked for one thing and the work found two bugs under it.
- **Bulk delete** ([PLAYLISTS.md §10.3](features/PLAYLISTS.md)): Ctrl/Shift+click a run of playlists,
  right-click, *Delete N playlists*. Only the **local** ones go — an Apple mirror has no delete
  path, so it is counted and named, not touched. One red sticky question for the whole set
  (**always**, even when every playlist is empty: one gesture removes many rows), the deletes
  run one after the other, and one failure does not stop the rest. `card.dropPicks()` drops the
  picks after, or the count row keeps counting rows that have left the list.
- **A right-click after scrolling jumped the list to the top** — two independent causes, both
  fixed (UI-ARCHITECTURE.md "Keeping the list's place through a re-render"). (a) A row carries
  no `tabindex` until the keys reach it, so Chromium sent the focus of ANY press to the list's
  own box, and `list-keys.ts` moved that focus to row one. It now ignores a focus that arrived
  with a pointer press. This hit **every card that adopts the helper** — the collection cards,
  Queue, History, Home, Search — not only Playlists. (b) `renderViewInto` replaces the rows'
  HTML, which drops `scrollTop`; the multi-select pick re-rendered with no save-and-restore, so
  every Ctrl+click and Shift+click also jumped. `reload()`'s save-and-restore is now the shared
  `rerenderInPlace`, and the pick goes through it.
- **Density switch keeps your place** too (the owner's call): the same rows in the same order at
  a different size. Sort and the filter toggle still go to the top, unchanged.
- On the way: `initCollectionCard` now returns a **declared** `CollectionCardHandle`. It was
  inferred, and the no-`.coll-body` early-return stub made every new member optional — which is
  why `dropPicks()` read as possibly-undefined. The interface stops the stub drifting again, and
  it records that `snapshot()` really can return null.
- No Rust change, so no dev-runner restart. **Desk test:** scroll the Playlists list down, then
  right-click a row, Ctrl+click a row, Shift+click a run, and switch Lines → Tiles — the list
  must not move in any of them; Tab into the list must still land on the first row. Repeat the
  right-click in the Queue and History. Then pick three local playlists and delete them (the
  question's counts, [Delete All], the result toast), pick a mirror with them (it is named and
  stays), and pick mirrors alone (no item at all).

**2026-09-17 — 0.9.5 is live on the `deetsmusic` channel** (`main` at `7691a66`; installer 7.4 MB).
It ships the Compass and its commands, the list keys, the Genres view and the collection sorts, card
memory ([CARD-MEMORY.md](cards/CARD-MEMORY.md)), and the dev-only sound rate override
([RELEASE-NOTES.md](ops/RELEASE-NOTES.md) 0.9.5). Published at the user's request without the hand
install test of RELEASE.md §0 step 3; he tests on the live channel and polishes as he goes.

**2026-09-17 — the Compass: BUILT, shipped in 0.9.5, the desk test runs live ([COMPASS.md](features/COMPASS.md)).**
Ctrl+Space (or Ctrl+Shift+Space) drops a bar under the title bar in every surface: the cards,
surfaces, themes and skins; every Settings row (store-backed toggles and short choices act inline);
play / pause, next, previous, shuffle, repeat, mute, sleep in N minutes; the library's songs,
albums, artists, playlists and recent stations (Enter opens the owner, Ctrl+Enter plays); a last row
hands the term to the Search card. Zero Apple calls. The same pass added **Space for play / pause**
and Enter / Space on the Search card's rows (the keyboard pass, 5B). No Rust change. Desk test:
COMPASS.md §7. Decided alone (flag): the name, the second key, Open vs Play, the inert Settings
index, the empty state, the caps (§1 "Decided alone").

**2026-09-17 — 0.9.0 is live on the `deetsmusic` channel** (published 01:52 PDT; `main` at
`14111a7`, fast-forwarded from `grower-not-shower`). It ships card grow, song and album playlist
webs, temporary web playlists, the Add-to-Library + on song rows and the Cyber skin name
([RELEASE-NOTES.md](ops/RELEASE-NOTES.md) 0.9.0). Installer 7.71 MB (0.8.0: 7.62 MB). Published at the
user's request without the hand install test of RELEASE.md §0 step 3: the user tests it on the
live channel. Open for 2026-09-18: the web build's name-search cap (PLAYLIST-WEB.md §5b; read the
`search N` part of the `web: built` log lines first).

**2026-09-17 — DeetsMusicRooms (listening rooms): BUILT and the worker is LIVE. Two apps
playing in step is still unheard.** Friends join a room with an 8-character code
(`K7QM-4XHT`); every app follows one queue and one clock, and each plays through its own
MusicKit and its own Apple Music subscription — no audio passes between apps.

- **The worker is its own private repo**, `../DeetsMusicRooms` (github deets-137). Plain JS,
  no build step, `npx wrangler` — the house shape DeetsAccounts and DeetsSupport use.
  **Deployed to `rooms.deets.solutions`, no secrets attached and none needed.**
  `npx wrangler dev --port <n>` then `node scripts/check.mjs http://127.0.0.1:<n>` drives the
  whole protocol: 28 checks, green locally and against the live host. **Wrangler 4 or newer**,
  or the rate-limit binding is silently dropped.
- **The app side** is `src/room.ts`, `src/room-panel.ts`, the `RoomBridge` in `src/player.ts`,
  `queue.setRoomQueue`, and `src-tauri/src/rooms.rs` for the `deetsmusic://room` invite.
  The panel wears the Sound panel's clothes and carries the **stage** — hollow silhouettes on
  a light grid, the heads moving only to the loudness meter (ROOMS.md §16.6).
- **Apple terms are read** (§12): no clause names group listening, the design holds on every
  clause that touches it, and the one item it raised is decided — a guest's Pause never greys
  out; under Host only it stops that guest's own app (§12.3).
- **What is left is the one thing only the owner can do: hear two apps play in step (§16.4).**
  He has a Family plan and is testing it live. **That item stays open THROUGH release until he
  confirms** — if a build ships first, it ships with two-app playback unproven, and nothing
  should say rooms work before he says so. The frame cost of the stage is also unmeasured.
- The deets.solutions site is **out of scope** (§13); the site's own status row for the worker
  is written up in `DeetsSolutions/docs/rooms-status.md`, designed and not built.

As built, end to end: **[ROOMS.md](integrations/ROOMS.md) §16**.

**2026-09-16 — 0.8.0 is live on the `deetsmusic` channel** (published 17:26 PDT; `main` =
`wakin-up` at `209c007`). It ships Sound, Last.fm, the playlist web, Stream quality, Fancy Glass
and the library reads for AI apps ([RELEASE-NOTES.md](ops/RELEASE-NOTES.md) 0.8.0). Published at the
user's request without the hand install test of RELEASE.md §0 step 3. The user confirmed on
2026-09-17: 0.8.0 is installed and works well.

**2026-09-16 — Last.fm link back: DECIDED C, BUILT 2026-09-17 (`LINK_BACK = false`, LASTFM.md §4
step 4 updated); shipped in 0.9.0.** The installed 0.8.0 connect test
(LASTFM.md §9) passed: connected in 7 s (log 17:52:38 → 17:52:45). The browser did not return to
DeetsMusic, and the log has no `lastfm: link back arrived` line and no "ignored" line. The
`deetsmusic://` scheme is registered correctly (checked in the real HKCU through WMI). Cause:
Last.fm's desktop auth (our token from `auth.getToken`) ignores `cb`; only the web auth (no token)
redirects. **Done in 0.9.0:** `LINK_BACK = false` in `src-tauri/src/lastfm.rs`; the
3 s checks finish the connect, and the user returns to the app by hand. Rejected: A (the
app brings its window forward on "connected"; Windows can block the focus) and B (switch to web
auth, where the link is the only way to finish).

**2026-09-16 — Sound: the user lives with it after it goes live, then reports back.** The Sound
panel (EQ + DeetsAdaptiveSound, phases 1–5) is built, committed and shipped in 0.8.0
([SOUND.md](features/SOUND.md) §10–§11). Before any more Sound work: now that it has shipped, the user tests it in daily
listening, gets a feel for each part (Equalizer, Match loudness, Fuller at low volume, Headphone
crossfeed, Compare) and reports back. Their report decides what stays, what changes and what goes
(SOUND.md §7 step 4). Do not start new Sound features until that report exists.
**First thing next build session:** grep the dev and installed logs for `sound:startLost` and
`sound:clockSlip` (the command is in SOUND.md §10.5). They watch for the lost song start that one
probe run showed on 2026-09-16.

**2026-09-17 — the first report from daily listening: the Match loudness line.** The user read
"Measuring" on every play and took it for a measurement that never ends. Measuring was never
broken (70 rows in `loudness`); the line was. Two fixes, committed: a song that already has a
row now ends the line with *Measured.* instead of a percentage, and the percentage on a song
without one counts up live (`renderLoudStatus()` on `onPlayerProgress`). Desk test: SOUND.md
§9 steps 6 and 7. The repeat-one lap window was reviewed and deliberately left at 1.5 s
(SOUND.md, Repeat one and the listen). This is report item 1 of SOUND.md §11 — the rest of
the report is still owed before new Sound features.

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
5. ✅ **A Home card** — §15, **DESIGNED + BUILT 2026-09-15** ([HOME.md](features/HOME.md)): three mixed
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
[RELEASE.md §6.9](ops/RELEASE.md).** Signed 0.4.4-t1 and t2 were built and published to
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
`artifact-signing-cli` was rejected (needs the Azure CLI). Committed; every release since 0.5.0 is signed this way.

**2026-09-14 — playlists §10.9, BUILT, desk-tested, shipped in 0.4.1: [PLAYLISTS.md §10.9](features/PLAYLISTS.md).**
Import to Edit (a mirror row's right-click or its hero cover; your own Apple playlist stays
linked as one row), Add to Playlist ▸ lists your own Apple playlists with the sigil (the
first add asks once), and the list splits into Made Here / Your Apple Playlists. New
Rust commands `playlist_import` + `apple_playlist_add`: **restart the dev runner.** Desk
test: import one of your own playlists (one row, Send New Songs), import an Apple mix
(unlinked), add a song to a throwaway Apple playlist (a REAL Apple write, the question
first), turn Export playlists off (the Apple rows leave the menu).

**2026-09-14 — the playlists wrap-up, BUILT, desk-tested, shipped in 0.4.1: [PLAYLISTS.md §10](features/PLAYLISTS.md)
"As built".** Drag to reorder (`src/row-drag.ts`, now shared with the queue), rename, the
*Apple Music ▸* menu (Send New Songs · Get New Songs · Make a New Copy), a red delete confirm,
named skipped uploads, covers served as `http://cover.localhost/` links, the README note, and
the Replay guard (`role`). **Schema v5; Rust changed: restart the dev runner.** Desk test: drag
in a short and a >200-song local playlist, drag the queue (it moved to the shared module),
rename, delete with songs, a Replay's menus, Get New Songs on an exported playlist (a real
Apple READ). Later: Import to edit, adding straight to Apple playlists (first-add confirm), a
separate Made Here section (§10.9). Idea raised: drag songs from any card into the Queue
(not designed).

**2026-09-14 — Playlist covers + Export to Apple Music: BUILT, desk-tested, shipped in 0.4.1** (branch
`optimus-deets`). The hero cover of a local playlist is a button (Choose Image… / Remove
Cover / Export ▸) and a file drop target ([NEXT-VERSION.md §2](NEXT-VERSION.md)). Export ▸
makes an Apple copy or adds new songs to it, and asks before a write Apple can't fully copy
([PLAYLISTS.md §6](features/PLAYLISTS.md)). Settings › Apple Music › **Export playlists** (default on).
Settings › Show notices lost **Off**; a toast that asks always shows ([TOASTS.md §4](architecture/TOASTS.md)).
Same session: **Settings regrouped** (Window / Look and feel / Playback / Apple Music / Playlists /
Rewind / Connections / Bugs / About) and **`requestSetting(rowId)`** opens the card at a row
(unfold, scroll, highlight); the Add to Library and Export notices are once-notices with a
**[Settings]** button ([SETTINGS.md §3](architecture/SETTINGS.md), TOASTS.md `onceKey`).
Also: **a network drop** showed MusicKit's own in-page error box ("loadSegmentError", `MKDialog`,
not an `alert()`) beside our offline toast. Fixed with `suppressErrorDialog: true` in both
`MusicKit.configure` calls, and the stopped song now **resumes where it stopped** when Apple
health next finds the network back ([TOASTS.md](architecture/TOASTS.md) §Apple health, offline row). Shipped in
0.4.1; no test against a real Wi-Fi drop is on record.
**Rust + `tauri.conf.json` changed: restart the dev runner.** An export is a REAL Apple
write — test with a throwaway playlist and delete its copies in the Music app.
**Export desk-tested the same night:** the first tries made empty copies because Apple's create
reply is gzip-compressed (fixed: `reqwest` `gzip` feature). An exported playlist now lists as
one row (the local one; the linked Apple copy is hidden), with the Apple Music sigil, the
copy's Apple artwork when it has no cover of its own, and "Exported on <date>" in its hero.

**2026-09-13 — Apple terms + D.7 pass, built, Worker deployed, app part shipped in 0.3.1** (branch
`toast-time`; decisions and the origin probe in [RELEASE.md §7](ops/RELEASE.md) "Revised
2026-09-13"). App: Apple Music icon on the playlist badge, Settings › About notice, README
privacy + trademarks, real MusicKit `app.build`, MUT redacted in the log, `Origin:
http://tauri.localhost` on every Rust call to Apple, sign-in on fixed ports 47831–47833,
refresh margin 3 days. Worker (`../DeetsSupport`, since committed, **deployed 2026-09-13**,
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

**2026-09-13 — Apple health: say why Apple Music stopped, heal without the user, desk-verified
and shipped in 0.3.1; the sign-in fixes below in 0.3.2** (branch `toast-time`). Found live after the key rotation: MusicKit showed
"Unable to prepare for playback." as a native dialog, the Account row still said Connected,
the sign-in page said "Error: Unauthorized", and a play-only install never healed (only a
Rust call triggered the token refetch). Built: `apple_check` (which token Apple rejects, with
the bounded heal) + `apple_auth_status` (the page reports failures) in `apple.rs`;
`apple-health.ts` (one toast per cause, Account row states, 5-min recheck while Apple-side);
`requireSignIn` on every play path; every MusicKit `alert()` routed to player.ts; play retry
after a heal; the Worker `notice` shown at launch. Bounds and copy: [TOASTS.md](architecture/TOASTS.md)
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
**[LIBRARY-VIRTUALIZATION.md](architecture/LIBRARY-VIRTUALIZATION.md)** §Results (skin flip 395–558 →
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
with the differences from the plan: **[DATA-ARCHITECTURE.md §2a](architecture/DATA-ARCHITECTURE.md)**;
test seams: DEBUGGING.md §Sign-in. Files: `apple.rs` (`begin_hosted`, `handle_link`,
`accept_token`), `lib.rs` (single-instance argv → `handle_link`; debug registers its
scheme), `plugins.deep-link` in both Tauri configs, `apple.ts`/`main.ts` (`connect(local)`,
the "Use local sign-in" link under the Account note), `scripts/signin-assets.mjs`
(`npm run signin:assets` copies the app's look into `../DeetsSupport/src/signin/`), and in
`../DeetsSupport`: `src/signin.js`, `wrangler.jsonc` rules, the router (since committed there).
**Verified in the dev app against a `wrangler dev --remote` preview:** the page renders
themed; every link case (stray, wrong nonce, replay, `error=`, refused token, real token
→ Connected, a hosted link after the local page took over); the Worker-down fallback; the
Account-row link. **Not yet verified (needs Apple's own window, the user's step):** Apple's
popup → the automatic `deetsmusic-dev://` return in Chrome and Edge, the Return button, the
Access Request screen's host name + icon, browser history not keeping the link, and a
Worker-page MUT (PRD key) working with the DEV key (§2a desk-test list). **Deployed
2026-09-13 evening** (`npm run signin:assets`, then `npx wrangler deploy` in `../DeetsSupport`;
that repo's changes have since been committed). The live page answers at
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
order, across all three repos, is **[RELEASE.md](ops/RELEASE.md) §7**. Also still needed before
posting: **screenshots** (there are none anywhere), a **GitHub Release** with the installer
attached (none exist), and a plain note about SmartScreen (installers are signed from the
first release after 0.4.3, but a browser download can still warn until reputation builds —
RELEASE.md §6.9).

**Before release: polished keyboard control (added 2026-09-13; first slice built 2026-09-17).**
Every action a mouse can do must also work from the keyboard, with a visible focus ring. Built
2026-09-17 ([COMPASS.md](features/COMPASS.md)): **Space plays / pauses** when nothing that takes Space has
the focus; Enter / Space on the Search card's rows; **Ctrl+Space, the Compass** — a bar that
reaches every card, setting, transport verb and library item; and, later the same day, the
**list keys** (`src/list-keys.ts`, COMPASS.md §5): Tab into any list, arrows, Home / End,
Enter, the Menu key, Escape = Back, in every card. Still open: hover-only controls (the Search
Add-to-Library square) only show on `:focus-visible`; the Sort / View popovers take no arrows. The fixed shortcut set is in [NEXT-VERSION.md](NEXT-VERSION.md)
(`Ctrl+K` Search and friends).

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

**Logging: steps 1–4 of [LOGGING.md](ops/LOGGING.md) built 2026-09-11, all four desk-verified
(the flush blocks, the unload flush, the incremental line `1 new in 1 page(s)`).**
`src-tauri/src/log.rs` is the rolling `<app_data>/deetsmusic.log` (512 KB × 2, dated lines,
three levels, a panic hook, JWT / `Bearer` scrubbed at the write boundary); the old
`bridge.log` is adopted as `deetsmusic.1.log` on first run and `bridge::log` is an alias.
Startup, token source, every Apple ≥ 400 (status + path), library sync, enrich batches,
AirPlay, sign-in outcomes, migration and the bridge now write to it. `diag.flush()` appends the
front-end ring on an uncaught error, on unload and from **Settings › Bugs › Open log folder**.
Still to do: step 5, the report form + My reports (DeetsSolutions `docs/support.md`). **The log's first catch:** the
startup library sync was a full ~40-request pass on every launch; it is now **incremental**
inside a six-hour window (newest-first, stop at the first cached song, upsert only; the
refresh button and a stale cache still run the full pass, which stamps `meta.full_sync_at`
in the cache db) — FUTURE-SETTINGS.md §21 holds the window as a later Settings row. Also fixed that day: `npm run
dev:app` opened TWO full windows — the dev overlay's bare `windows` array replaced the real one
(JSON merge patch), so the tray label lost `tray.html` and loaded the app; the launcher now
stamps "(dev)" onto the full window objects.

**AirPlay: in v0.2.0, desk-tested in dev.** See [AIRPLAY.md](integrations/AIRPLAY.md): the sender is the
shared `deets-airplay` crate (git dependency on DeetsAirplay, pinned by `rev`; read that
repo's CLAUDE.md "Never" list before touching wire code). Decisions are locked in §5; v1 =
"All PC sound", the per-process path is parked for v2 (§10). **0.2.1 is desk-tested installed:
prompt shown, speaker plays.** Open: the firewall prompt frightens a first-time user — preface
it with an in-app confirmation or a toast (AIRPLAY.md §9 item 5; toasts exist now, TOASTS.md).

**2026-09-12 — the click-to-sound pass (branch `polish`, desk-tested via the MCP).**
Dev-only telemetry (`src/perf.ts`, [DEBUGGING.md](ops/DEBUGGING.md)) measured every stage
from click to the media element's `playing` event, then five changes landed
([QUEUE.md](features/QUEUE.md) windowing, [UX-COVERUPS.md](architecture/UX-COVERUPS.md) §4–5): the track
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
2026-09-13 entry above and [LIBRARY-VIRTUALIZATION.md](architecture/LIBRARY-VIRTUALIZATION.md) §Results.
**Same day, built and verified:** the queue **restores across sessions** — one JSON blob
in the cache db's `meta` (`queue-persist.ts`, QUEUE.md "Restore across sessions"), the
**Restore on launch** settings row (*Last song* default / *Up Next* / *Nothing*), Play
with nothing loaded resumes the restored plan. It restores the plan only: pre-feeding
MusicKit was probed and rejected (`setQueue` fetches nothing, no `prepareToPlay`;
UX-COVERUPS.md §4), so the first Play still pays the cold cost.

**The v1 push** — sequence discussed 2026-07-03 (each item still wants its own design/confirm
pass before building; the user directs):
1. ✅ **Settings card** — built 2026-09-10 as the **hybrid** ([SETTINGS.md](architecture/SETTINGS.md)):
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
touching the area): the **tray icon + panel** and **Minimize to Tray** ([TRAY.md](features/TRAY.md));
the **browser extension + loopback bridge** ([EXTENSION.md](integrations/EXTENSION.md), source in
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
queue + 2×2 bento, [SURFACES-AND-CARDS.md](architecture/SURFACES-AND-CARDS.md) build order #4); the
mini transport row stacks its side buttons when they'd overflow; and the **agent/CLI
routes** on the bridge (`/command` `/play` `/queue` `/history`, [AGENT.md](integrations/AGENT.md)) —
plus the `deetsmusic` CLI + MCP binary in `cli/` and `npm run dev:app` for dev alongside the installed app.
**2026-09-09, 0.1.3 (installer line, user-tested):** **one instance only** — the pinned
taskbar button now activates the running app instead of starting a second process
([TRAY.md](features/TRAY.md) §5); *Open DeetsMusic* is one **clean cut** (hide → resize hidden →
place → show) instead of a visible grow-and-travel; the window **position survives** × and
restart (`settings.json` → `windowPos`); and the NSIS installer **stops the bundled CLI**
before install/uninstall, which is what a half-uninstall of 0.1.2 cost us
([RELEASE.md](ops/RELEASE.md)). `npm run release` now archives each setup exe into `installers/`.

**2026-09-10, branch `release-prep` (merged):** **stations in Search** (a fifth search type,
[SEARCH.md](features/SEARCH.md)); the **native Windows media session** (`smtc.rs`, item 3 above); the
**radio UX pass** ([STATIONS.md](features/STATIONS.md) §3b — the station is Up Next's last row, Stop
Station in three right-click menus, the station resumes after a break-out block, Stop leaves
the last song paused); **Library Add now defaults ON**. Second batch, same day: the **Add to
Library square** on Now Playing (+ / spinner / ✓, [FAVORITES.md](features/FAVORITES.md)); the **max
stage volume row** (mute · slider · a hidden AirPlay square; the titlebar pill stays;
`onVolumeChange` in `player.ts` keeps every control in step); the **Settings card + hybrid
menu** ([SETTINGS.md](architecture/SETTINGS.md) — one `deets.settings` store, the v1 rows, the Rewind gate
at 50 play starts; **Play Now now defaults to "Song and rest of list"**). Third batch, same day: **AirPlay**
([AIRPLAY.md](integrations/AIRPLAY.md)) — `../DeetsAirplay` is now a library crate (`crates/airplay`) this app
depends on (git, pinned by `rev`); the "Play on" panel behind the AirPlay square (pill
panel in mini/midi, stage row in max), **v1 = "All PC sound"** (loopback of the default
output; the PC keeps playing), one volume slider driving the speaker, now-playing text +
cover to the speaker, no Settings rows. **Connected and played on the desk.** The per-process
"DeetsMusic only" path is built, probe-verified, and parked for v2 behind `V2_PER_PROCESS`
(AIRPLAY.md §10 lists the five things learned about it). Also that evening: **per-speaker
remembered volume** (20 % on a speaker's first use), **Settings › Agents** (Agent control
switch, default on, gating the six agent routes with a 403; "Copy setup for" Claude Desktop /
Claude Code / Cursor / Other; the plain-words [AGENT-SETUP.md](integrations/AGENT-SETUP.md)), and
**Start with Windows** (HKCU Run key, `--tray` launch starts hidden; seeded once on the first
installed run, DeetsAirplay pattern).

**Deferred, when prioritized:** **DeetsWeather** ([ideas/DeetsWeather.md](ideas/DeetsWeather.md);
its own-station premise needs a rethink — that engine was dropped) · **CLI / local-agent
control** · **mini/max surface compositions** · **virtualized scrolling** (only once libraries
get large).

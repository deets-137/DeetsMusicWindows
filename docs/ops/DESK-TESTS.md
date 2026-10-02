---
status: sop
desk_test: none
sources: [scripts/webview-eval.mjs, scripts/dev-app.mjs, src/diag.ts]
updated: 2026-10-01
---
# Desk tests — the runbook for an agent

The open desk tests, gathered from HANDOFF.md › Open now and the feature docs, as one list an
agent can run in its own session while the owner does other work. Written 2026-09-27 after a
sitting that left six untested pieces in one tree (the 2026-09-17 lesson: a wrong call in one
hides under the others).

Terms:
- **A desk test** is the numbered script in a feature doc, run through the app's own UI.
- **The dev app** is `npm run dev:app`: its own data folder, a CDP port, the `[perf]` and
  `diag` lines. **The second app** is `npm run dev:app -- --second`: its own identity and
  friend code, for rooms and friends.
- **Agent** = a Claude session can run it. **Owner** = it needs his eye, his hardware, his
  accounts, or the live install.

## 0. The prompt to give the agent

> Run the open desk tests in `docs/ops/DESK-TESTS.md`. Read §1 and §2 first, then run every
> row of §3 marked *agent*, in order, on the dev app (`npm run dev:app`, in the background; a
> second app where the row says two apps). Drive the app through its own UI over CDP
> (`scripts/webview-eval.mjs`), never by importing its modules. Do not change code. Write each
> row's result in §5 (pass · fail with what you saw · blocked with why), then one WORKLOG.md
> entry for the run. A fail is a finding, not a fix: describe it and move on. Stop and ask
> only if the dev app will not start.

## 1. Setup — what the agent has

- **Start:** `npm run dev:app` in the background. It is up when the runner's output holds
  `start: DeetsMusic` — read it with `grep -a` (the file has non-ASCII). Never match
  `Running .*deetsmusic`: cargo's color codes sit right after "Running". On a timeout, read the
  output file before reporting. The first run compiles Rust (slow).
- **Two apps:** `npm run dev:app -- --second` beside the first. Each has its own identity;
  friends and rooms work between them (FRIENDS.md §18.8 was run this way).
- **Drive it:** `node scripts/webview-eval.mjs "<expression>"` runs a console line in the
  main window, with a user gesture; `--second` reaches the second app. Click the app's own
  controls (`document.querySelector('[aria-label="Next"]').click()`), open menus by
  dispatching a `contextmenu` MouseEvent at a row, press keys with `KeyboardEvent`s on the
  focused element, read state from the DOM (`hidden`, classes, `getComputedStyle`), from
  `localStorage.getItem('deets.settings')` and from `__diag.dump()`. DEBUGGING.md § Driving
  the webview has the rules, and § The `__diag` console handle the ring.
- **Read what happened:** `__diag.dump()` in the window (the LIVE ring: `ui:act`, `player:*`,
  `rule*`, `grow:*`), then the log file `%APPDATA%\com.deetsmusic.dev\deetsmusic.log` for
  anything older. A complaint is read, never guessed (DEBUGGING.md § Recipe — the user reports
  a playback complaint).
- **Music:** a play through the UI needs the dev app signed in to Apple Music (its own data
  folder keeps the sign-in). If it is not, say so in §5 and run the rows that need no song.
- **The CLI and MCP** (`deetsmusic …`, the `deetsmusic` tools) reach the app whose port file
  they hold. Check which app answers (`deetsmusic diag` prints the app's identifier) before
  using them for a row.
- **A save to a front-end file reloads the page** and stops the song; a Rust change takes the
  CDP port down until the rebuild ends. Do not edit code during a run.
- **Restart:** kill the dev exe and the vite process (CLAUDE.md; the memory
  `deetsmusic-dev-runner-ops`), then relaunch. A Rust change is not watched by the runner.
- **After a hot update, reload before you judge the layout.** A `.ts` save in the middle of a
  render once left three empty cards and the Diary in the wrong slot; `location.reload()` put it
  right. It was the update, not the code (2026-09-27 night).
- **Another session may want the dev app** (DEBUGGING.md, "Two sessions, one dev app"). Ask
  before starting one; `dev:built` serves a bundle built once, so a `.ts` edit does not reach
  it, but its runner watches `src-tauri/`, so a Rust edit restarts it mid-bench.

**Tools found in the 2026-09-27 night run** (each one used for a row in §5):
- **The second app from the CLI:** `deetsmusic --port 47827 --token <bridgeToken>`, the token
  from `%APPDATA%\com.deetsmusic.second.dev\settings.json`. A setting write asks on that app;
  press its toast's Allow over CDP (`webview-eval.mjs --second`).
- **A drag between rows:** `PointerEvent`s (down on the row, a dozen moves, up) dispatched from
  `webview-eval.mjs` drive `row-drag.ts`. Drop inside the card's visible box: a point below the
  card's bottom edge hits nothing.
- **The Windows light / dark switch (look schedule, Windows mode):** write `AppsUseLightTheme`
  under `HKCU\…\Themes\Personalize` through a WMI-started `reg add` (this session's registry is
  private, CLAUDE.md), then broadcast `WM_SETTINGCHANGE` with `"ImmersiveColorSet"`
  (`SendMessageTimeout` to `HWND_BROADCAST`). The write alone changes nothing: programs wait for
  the broadcast. Put both back after.
- **Unplug on a desktop (the `charging` fact):** in the page, override the `BatteryManager`
  object's `charging` getter (`Object.defineProperty`) and dispatch `chargingchange` on it; the
  app's listener reads the new value. This tests the rule path, not the hardware.
- **A first run without losing the dev profile:** copy `%APPDATA%\com.deetsmusic.dev` and
  `%LOCALAPPDATA%\com.deetsmusic.dev\EBWebView` to the scratchpad (~700 MB, two minutes), run
  `dev:fresh`, then stop the app and copy both back.
- **A forced dead song:** a fake id in `/play`'s `tracks` is caught by the top-up's id check
  (`player:deadIds`) before MusicKit sees it, so it does NOT force the dead-next heal (B20).
- **The tray panel (2026-09-27 late night):** `node scripts/webview-eval.mjs --tray "<js>"`.
  In dev, `dev-app.mjs` gives the tray window the main window's browser arguments, so WebView2
  runs it in the same browser process and it is a target on the same CDP port (with none of its
  own it ran alone and no script could reach it: B2). Release builds are unchanged.
- **A network drop, held:** network emulation lasts only while its CDP session is open, so a
  drop test is one small Node script that keeps the socket: `Network.emulateNetworkConditions
  {offline}` + `setCacheDisabled`, then a seek past the buffer (MusicKit buffers a whole song in
  seconds, so a cut alone does nothing), with `invoke("apple_force_offline", {secs})` holding the
  app's own Apple check out.
- **An AirPlay speaker another app holds** refuses the dev app (`airplay: connect refused: the
  speaker is held by DeetsMusic`). The live app playing to it is his music: leave it.
- **Keys in a list:** send them to `document.activeElement`, never to `document`. A key
  outside a list stops its refocus watch (list-keys.ts), so a key on `document` hides the
  behavior you are testing.

## 2. The rules

1. **Through the UI, never through the modules.** `await import('/src/x.ts')` reaches a second
   copy of a module once Vite hot-updated it; the app's copy is another URL (DEBUGGING.md §
   Driving the webview). Click and press what the user would.
2. **Read `ui:act` before calling anything a mystery.** The owner presses things during a run;
   the ring says which presses were his (the `trusted` flag).
3. **No harnesses, no mock pages, no throwaway tooling.** The scripts above are the toolkit.
4. **A fail is a finding.** Write what you did, what you saw, what the doc said should happen,
   and the ring lines around it. Do not fix it; the owner decides.
5. **Each row's script is in its doc.** This file names the doc and section; the steps live
   there and are not copied here, so they cannot drift.
6. **Visual steps** (a color, a motion, an alignment) are read from computed style and the
   `[perf] frames` lines where a number exists; where only an eye can judge, write *needs his
   look* and what the DOM said.
7. **One WORKLOG entry per run**, dated, with the §5 table's summary line. HANDOFF.md › Open
   now is corrected in place for each row that closes.

## 3. The list

Order: the uncommitted work first (a fail there stops a commit), then the released work.

| # | What | The script | Apps | Who | Notes |
|---|---|---|---|---|---|
| A1 | List keys on Rewind, Diary and Rulez | [COMPASS.md §5a](../features/COMPASS.md) | one | agent | Focus a row, dispatch arrow / Enter / ContextMenu / Escape `KeyboardEvent`s on `document.activeElement`; read `document.activeElement` after each |
| A2 | The Sort / View pop on the dropdown primitive | [UI-ARCHITECTURE.md §4a](../architecture/UI-ARCHITECTURE.md), the Part under Toolbar (10 steps) | one | agent | Step 4 needs Settings › Menus › Open menus on hover on: set it through the Settings card, then dispatch `pointerenter` on the pill's `.lib-ctrl`. Step 10: `document.querySelectorAll('.lib-pop').length` |
| A3 | The Friends box takes the song menu | [CONTEXT-MENUS.md §8](../architecture/CONTEXT-MENUS.md) step 11 | two | agent | The second app plays a song the first app's library does not hold; right-click its box in the first app's Friends panel |
| A4 | Two Settings scrollers on the app's bar | §4 below | one | agent | |
| A5 | The hover-hint rows reach the agent | §4 below | one | agent | Needs the CLI against the dev app (§1) |
| A6 | The Diary's Done copies the Export | [DIARY.md §8](../features/DIARY.md) step 11f | one | agent | Committed 2026-09-24, never run |
| B1 | Go to Album grows, and the grow replaces the slide | [RULES.md §18](../architecture/RULES.md), *the grow replaces the slide* | one | agent | Also `deetsmusic diag --flush` (LOGGING.md § Reading it from outside) |
| B2 | The rules engine: the tray panel follows a look change | [RULES.md §18](../architecture/RULES.md), the owner's list | one | agent | The tray panel is `tray.html`, a second webview; read its `data-theme` after a rule changes the look |
| B3 | The rules engine: a real `dev:fresh` first run | RULES.md §18 · [ONBOARDING.md §5](../features/ONBOARDING.md) | one | agent | `npm run dev:fresh`; the walk should start; every `NEW_MARKS` key starts seen |
| B4 | The rules engine: a new Diary entry grows | RULES.md §18 | one | agent | |
| B5 | The rules engine: the "changes a user can see" list | RULES.md §18 | one | agent | Read each line against the app; a line that is not true is a finding |
| B6 | The rules engine: Windows mode in the look schedule | RULES.md §18 · [LOOK-SCHEDULE.md](../features/LOOK-SCHEDULE.md) | one | owner | Needs the Windows theme switched by hand |
| B7 | The rules engine: the Discord profile during a sharing pause; EQ per output with real headphones | RULES.md §18 | one | owner | His Discord account; his headphones |
| B8 | Rulez: Agent changes settings = Off | [AGENT.md §8](../integrations/AGENT.md) step 8 | one | agent | Through the CLI's `rules` verb |
| B9 | Rulez: hold-then-move a rule, the hover box per rule | [RULEZ.md §12](../features/RULEZ.md) | one | agent | The hold is `pointerdown`, wait past `holdMs`, then `pointermove`s; the box is `data-hint` read by hint.ts |
| B10 | Rulez: his look at the new words and the Go to opens row; the chime on a HomePod | RULEZ.md §10.2 · §5.4 step 8 | one | owner | |
| B11 | A rule's theme change crossfades; Live Theming once per song | [UX-COVERUPS.md §6c](../architecture/UX-COVERUPS.md) | one | agent | The crossfade is a `[perf] frames` line and a transition on `html`; the look must not flash the boot cover |
| B12 | The Diary's playing-album box | [DIARY.md §4c](../features/DIARY.md) step 1 | one | agent | Steps 2–7 passed 2026-09-26; step 1 and his look are open |
| B13 | New badges on pills, skin-only marks | [QUICK-SETTINGS.md §10a.1](../features/QUICK-SETTINGS.md) steps 1–5 | one | agent | Clear `quickSeen` in the store first, or use `dev:fresh` |
| B14 | The Apple call counter's hourly line | [APPLE-CALLS.md §5](../ops/APPLE-CALLS.md) step 1 | one | agent | An hour of normal use, then `[apple] calls 1h` and the `quit` line in the log |
| B15 | Ocean perf check: the album light at 0 and at 100 | [OCEAN.md §6](../features/OCEAN.md) | one | agent | On `npm run dev:built`, with music, with and without the GPU (`--gpu=off`); read `[perf] frames`, never the trace alone (DEBUGGING.md) |
| B16 | Diary 11e: the CLI / MCP path | DIARY.md §8 11e | installed | owner | Needs the installed build with the Diary CLI |
| B17 | Add a room member as a friend: the stress test on live | [FRIENDS.md §18.8](../integrations/FRIENDS.md) | live | owner | |
| B18 | Room sync + Listen Along: the stress test on live | [ROOMS.md §18.8](../integrations/ROOMS.md) · FRIENDS.md §16.2 | live | owner | |
| B19 | Discord's two buttons are readable | [FRIENDS.md §8.4](../integrations/FRIENDS.md) item 3 | live | owner | A second Discord account |
| B20 | The dead-next heal's double play | [QUEUE.md](../features/QUEUE.md) § The healed song played twice | live | owner | Cannot be forced; watch the next `player:deadNext` |

## 4. The two small scripts that live here

**A4 — the Settings scrollers (2026-09-27).**
1. Settings › Sleep › Sleep every day = At a time; open the *Sleep at* menu. It lists the whole
   day and scrolls. The bar is the app's: `getComputedStyle(document.querySelector('.set__menu:not([hidden])'), '::-webkit-scrollbar').width` is the `--scrollbar-w` token (8 px), not the OS
   bar's 17.
2. Settings › Bugs › App log: load the preview (the *Preview* action). With a long log it
   scrolls; the same read on `.set__preview`. An empty log shows *The log is empty.* with no bar.

**A5 — the hover-hint rows reach the agent (2026-09-27).**
1. `deetsmusic settings get`: three rows under *Menus, hints and notices* — *Show hover hints*,
   *Hints appear after*, *Name songs on hover* — with the card's labels and choices.
2. Settings › Connections › Agent changes settings = Allow. `deetsmusic settings set
   hoverHintDelay slow`: the reply names the new value; the Settings row's pill reads *A while*;
   the store (`deets.settings`) says `slow`; a hover on a button waits about 1.1 s.
3. = Ask: `set hoverSongNames off` → the sticky toast *An agent wants to set …* with Allow /
   Not now; Not now leaves the value; the reply said `pending`.
4. `set hoverHints off`: the hover box stops for buttons and rows alike; `on` brings it back.

## 5. Results

Fill one line per row and date it. A blocked row says what blocked it.

| # | Date | Result | Seen |
|---|---|---|---|
| A1 | 2026-09-27 | **fail** (one finding) | Arrows, Home / End, the Menu key (the rule's, the song's, the row's menu), Enter on a locked rule, Rewind's Enter = nothing, Escape drops Rewind's picks, the press gate: all pass. **Finding:** an Enter or Escape that redraws the list drops the focus to `<body>` — Rulez Enter (open) and Escape (fold), Diary Enter (open an entry) and Escape (back to the shelves; the doc wants the ring on a tile), Rewind after its menu closes. A keyboard user's next key then does nothing. Also: in the Diary picker ↓ from the field does not reach the results (arrows work once a result has the focus); in Rulez › Logs list-keys eats ↓, so the log does not scroll by arrow. Step 2 (Picks) not run |
| A2 | 2026-09-27 | pass (8 of 10) | 1, 2, 4–6, 8–10 pass: the pop 4 px under the pill, re-sorts and stays, View closes Sort, hover opens / bridges / closes, each pane its own keys, Enter lands on the choice in force, Escape rings the pill, a scroll closes, Playlists the same. §10: 4 `.lib-pop` with Library and Playlists both on screen (2 per card), steady over 4 swaps. 3 (window short) and 7 (grow + Escape) not run |
| A3 | 2026-09-27 | pass | Two dev apps. The box's menu: the §3.1 rows in the §2 order, then Copy their code · Rename, Remove; no Invite while not hosting. Play Next put the song after the loaded one. Pin and "stop A's playback" not run (no Stop control; a pause keeps the song on the box) |
| A4 | 2026-09-27 | pass | All 11 `.set__menu` carry `app-scroll`, bar 8 px = `--scrollbar-w`; the App log preview scrolls on the 8 px bar. The empty-log case not run |
| A5 | 2026-09-27 | pass | 1–4 as written; *A while* measured 1,136 ms; Not now left `always`, the reply said waiting |
| A6 | 2026-09-27 | pass | With the window focused: *Diary entry copied.*, the Export text on the clipboard; Mark in Progress: no toast. **Finding:** `navigator.clipboard.writeText` refuses a window without focus, so a Done while the window is behind (a CLI or agent `diary done`) toasts *Couldn't copy the Diary entry.* The two drag steps not run |
| B1 | 2026-09-27 | pass | Run on his *Vertical*. Home song › Go to Album, Library › an album: grown with a blank body at the first 100 ms sample, rows after, `placed: true`; Off: `frames slide push`, no grow; Back collapses; the cog as before. `--flush` exists in the repo's CLI only (the installed 0.25.0 CLI lacks it); it wrote 4 `placed:true` lines to the file |
| B2 | 2026-09-27 | blocked | The `tray` webview is not in the CDP target list, and the tray icon cannot be pressed from a script |
| B3 | 2026-09-27 | blocked | `dev:fresh` wipes the dev app's sign-in; waits for his yes |
| B4 | 2026-09-27 | pass | A new entry (Kind of Blue): `row:diaryGrow:0` grew it taller; Back collapsed it. Entry deleted after |
| B5 | 2026-09-27 | pass (3 of 4) | Vertical by default and the grow replacing the slide (B1); Pin keeps a new entry's grow over Back; the dots on Theme, Skin, the sharing rows. EQ for each output needs a second output (his) |
| B8 | 2026-09-27 | pass | Off: `rules add` and `rules off` refused with the row's name; `rules` still lists |
| B9 | — | skipped | Claude's part ran 2026-09-27 (RULEZ.md §12); his mouse test is what is open |
| B11 | 2026-09-27 | pass (3 of 6) | 1 and 6: one `frames theme-fade` (~600 ms) per cover color, no `appearance` line, no back-and-forth. 5: a rule holding Animate look changes off → the theme changed twice with no fade. On `dev:app` Glass drops 80–95% of the fade's frames (measure on `dev:built`). 2–3 his eye; 4 skipped (a hand pick) |
| B12 | 2026-09-27 | blocked | Step 1 needs nothing loaded; a paused song shows *Listening now*. Goes with B3 |
| B13 | 2026-09-27 | blocked | Needs a cleared `quickSeen`; goes with B3 |
| B14 | 2026-09-27 | pass | `[apple] calls 1h` at 17:28 and 18:28 (`me` had one 401), a `calls quit` line at 03:01 |
| B15 | 2026-09-27 | blocked | Needs the dev app restarted as `dev:built`; waits for his yes |

Summary line for WORKLOG.md: *N pass · N fail · N blocked · N owner-only, untouched.*

Run of 2026-09-27 evening: *11 pass · 1 fail · 5 blocked · 1 skipped · 8 owner-only, untouched.*

After the run (2026-09-28): A1's finding is fixed in list-keys.ts (COMPASS.md §5a); its re-test
is §5a steps 8–10, a new row **A1b** for the next run. A6's clipboard finding and B1's
installed-CLI note are in HANDOFF.md › Open now as the owner's forks. The blocked rows wait
where the table says.

| # | What | The script | Apps | Who | Notes |
|---|---|---|---|---|---|
| A1b | The focus stays through a redraw (the A1 fix) | [COMPASS.md §5a](../features/COMPASS.md) steps 8–10 | one | agent | Read `document.activeElement` after each Enter / Escape; it must be a row, never `<body>` |

**Run of 2026-09-27 night (Claude, his yes to `dev:fresh`, `dev:built`, the Windows theme flip
and a Diary write).** Left out as retests: B5's EQ per output (passed with a stood-in second
output, RULES.md §18 step 9), B9 (Claude's part ran; the feel is his), B16 on live (ran
2026-09-26; only the open-entry redraw was left, run on the dev app). B12 and B13 did not need
`dev:fresh`: an empty queue and a cleared `quickSeen` are enough.

| # | Date | Result | Seen |
|---|---|---|---|
| A1b | 2026-09-27 | **fail** (cause found) | Rulez Enter and Escape, Diary Enter: the focus still drops to `<body>`. The page runs the fix (`KEYS_OF_ROW` is served). **Cause:** WebView2 fires no `focusout` and no `blur` when it removes a focused element (tried on a bare button: zero events), and `onFocusOut` in list-keys.ts is the fix's only trigger. Step 10 (Rewind) not run, same cause |
| A2 | 2026-09-27 | pass (step 7); step 3 unreachable | 7: with the Library at Fill, the first Escape closes the pop and keeps the grow, the ring back on the pill; the second collapses. 3: the Sort pop is 86 px; at the lowest Max height (745 px, below it the window turns Midi) the pill sits ~280 px above the bottom, so the pop never lacks room below |
| A3 | 2026-09-27 | pass (Pin) | The second app played Autobahn (0 Kraftwerk rows in the first app's library); Pin on the Friends box → `pin:set`; the Home › Pinned tile played it (`playContext ctx: home`). Pin cleared after. Rename is the input row (not a button) |
| A4 | 2026-09-27 | empty case unreachable | Every area keeps the `start:` lines (`ALWAYS`, report.rs), so a running app's preview is never empty; *The log is empty.* shows only when the log cannot be read |
| A6 | 2026-09-27 | pass (drag steps) | Sunshine dragged into Completed: `drop-row done`, `done`, the copy ran (the window had no focus, so it toasted *Couldn't copy*, the known finding); dragged back: `undone`, no toast |
| B3 | 2026-09-27 | pass, signed-out step **unreachable** | Real wipe, then: the walk starts (`onboardingStep` 1), all 13 `NEW_MARKS` and the cog seen, no dot, the OS-dark pair (Black & Red, Cyber). **Finding:** lib.rs seeds `deetsmusic.db`, `user-token.txt` and `developer-token.json` from `com.deetsmusic.app` into an empty dev dir, so `dev:fresh` opens signed in while the installed app is signed in; the walk began at step 2. ONBOARDING.md §5's "everything goes: you are a stranger, signed out" is not true on this PC. The dev data was restored from a backup after |
| B6 | 2026-09-27 | pass | Look schedule = Windows mode; `AppsUseLightTheme` set through a WMI-started `reg add` plus a `WM_SETTINGCHANGE "ImmersiveColorSet"` broadcast (the write alone changes nothing: programs wait for the broadcast). Light → `daylight` true, `row:lookSchedule:day` took the skin (`why: daylight`); dark → back. Live Theming kept the theme, as its order says. Windows and the row put back |
| B11 | 2026-09-27 | pass (step 4) | A title-menu pick (Lilac) ran the cover: `frames appearance theme … 1601 ms`, no `theme-fade` |
| B12 | 2026-09-27 | pass (step 1) | Restore on launch = Off, a relaunch: *Not playing*; the Diary shows the + box alone, centered (538 against the body's 538). The row put back to Last song |
| B13 | 2026-09-27 | pass (1–4); step 5 obsolete | Setup: every mark seen but the four Glass Canvas rows, Canvas = Aurora. 1: Covers and Picture wear the dot, Aurora none. 2: a rest on Covers clears its dot only; the cog keeps its dot. 3: Covers → Tiles, Diffusion, Aurora color each wear one; a rest clears each; Picture keeps its dot. 4: Ocean → the cog and the look square go dark; Glass → both light again. 5 checks the N letter, which is a yellow dot since 2026-09-26 |
| B15 | 2026-09-27 | pass, one cost found | `dev:built`, music, League of Legends on the GPU (`--contended`). GPU on: 232 fps at 0 and at 100 (worst 13 / 21 ms, GPU process 35 / 40 %). `--gpu=off` (WARP): **34 fps at 0, 27 at 100** (worst 63 / 75 ms). OCEAN.md §6 asks for a word in the Animate backgrounds hint then: his call |
| B16 | 2026-09-27 | pass (the redraw) | Dev app, Agents use the Diary on: entry 1 open, `diary score 1 --song 3 8` → the open row read *8* at once; cleared; the row put back Off |
| B20 | 2026-09-27 | cannot be forced | Played [Autobahn, a fake id, a real song]: the top-up resolves ids before MusicKit (`player:deadIds … not-found`), so the fake never reaches MusicKit and the advance is clean. A dead-next needs a song that resolves and then fails to start. It stays a watch on live |
| 18a.3 | 2026-09-27 | pass (faked) | No battery on this PC. The page's `BatteryManager.charging` overridden, `chargingchange` fired: unplugged → the recipe holds `glassFancy`, `backgroundMotion`, `cardSwapMotion`, `appearanceMotion` (`why: fact:charging`), the Fancy scrubber and his own values untouched; plugged in → all four let go. The real unplug on a laptop stays his |

Summary: *12 pass (one faked) · 1 fail · 4 unreachable or not forceable · 3 left out as retests.*

**After the run, the same night: two fixes, re-tested.**

| # | Date | Result | Seen |
|---|---|---|---|
| A1b | 2026-09-27 | pass | The fix redone (COMPASS.md §5a, as built). 8: Rulez Enter → the same rule, open; Escape → folded, the ring on it; ↓ → the next rule. 9: Diary Enter → the first song row; Escape → the tile of the entry; the picker's ↓ from the field → a result. 10: Rewind Menu key, Escape → the ring on the row; ↓ moves; a mouse click on a Diary tile → no ring. The first try found a second bug, fixed: Rulez, still watching from step 8, took the ring when the Diary redrew; a key outside the list now stops the watch |
| B3 | 2026-09-27 | pass (step 1) | `dev:fresh` with `DEETS_NO_SEED`: no token or db seeded, `isAuthorized` false, the tour on *Step 1 of 5: Sign in to Apple Music*. The dev profile restored after |

**The hand tests Claude could reach (2026-09-27 late night, dev app, his ask).**

| # | Date | Result | Seen |
|---|---|---|---|
| B2 | 2026-09-27 | pass | With the tray on CDP (`--tray`): Live Theming on Sunshine's cover took the theme Moonlight → Black & Yellow, then a skin pick by hand Ocean → Glass; the tray panel's `data-theme` / `data-skin` matched the main window each time |
| Drop | 2026-09-27 | pass | WORKLOG 2026-09-27 14:00 (`d1805fc`): Sunshine at 65 s, the webview cut offline and the Apple check forced out, a seek past the buffer: the song stopped (`resumeArmed {at: 65}`). Network back, the check still out, Play: `resumeOnPlay {at: 65, used: true}`, `resumeSeek {at: 65, done: true}`, 73 s eight seconds later, hushed until the seek. No toast in the first second |
| B10 chime | 2026-09-27 | **not run** | The speaker refused the dev app: `connect refused: the speaker is held by DeetsMusic` — his live app was playing to Living Room. Not taken over. His, with the live app off the speaker |
| B11 | 2026-09-27 | pass (step 2); step 3 not reached | Ocean: one 629 ms fade; the six sea loops `paused` through it, their clock held at 18,426 ms, then on from 18,426. Glass: 590 ms; `aurora-drift` and the album aurora spin held at 3,638 ms, then on from there. Press (step 3): the Live Theming fade fell in the song-load gap, when the record is paused anyway; a mid-song rule fade could not be made without more holds on his profile. The record's group rule is in styles.css; his eye |
| Diary 4d | 2026-09-27 | pass (1, 2, 3, 5, 6); 4 his eye | DIARY.md §4d. 1: Midi 700 px: the two boxes 133 px side by side, nothing cut, no sideways scroll. 2: Midi 495 px, card 230: boxes one tile (96), the top row scrolls (208 in 180), the shelves stay put. 3: nothing loaded: the + box 144 = 1.5 × 96, centered. 5: Max 950, card 437: note 72 (the cap; 20 % = 75); Max 760, card 342: note 56 (= 20 %). 6: a tall inline height (what the drag sets) stops at half the entry: 188 / 140 |

**Run of 2026-10-01 (Claude, his ask: the 09-28 / 09-29 tests, the shots for the motion ones).**
`dev:built`, the installed app running beside it (dev bridge 47826). The shots lists and the drop
script are kept in [checks/](checks/README.md) for a later run.

| # | Date | Result | Seen |
|---|---|---|---|
| Web 11.3 | 2026-10-01 | pass (1–8) | PLAYLIST-WEB.md §11.3. 1–2: Start a Web on Now Playing at 1 % / 14 % → `web:play {from: menu, mode: replace, skip: false}`, the seed again from 0:00. 3: at 81 % → `skip: true`, *Talk Is Cheap* (the second song); Previous ×2 → the seed. 4: Skip off, 81 % → `skip: false`. 5: Play a web off → the Skip row hides, `web:make` only, the song plays on, the web opens in the Playlist card. 6: the panel (Song, *'Bout It*, Make playlist) → `from: panel`; the Compass `web bout it` → `from: compass`. 7: a web from another song → no `web:play`. 8: a While Always rule (added and removed with the CLI) → `mode: after`, the song plays on, the web at the top of Up Next. Both rows put back on. Steps 7's album / artist seeds not run. **Finding:** after step 8's insert, `player:insert {at:0, n:29}` → `reconcile {d:0, mk:76, expected:105}` → `player:misalign`, and no `player:repair` follows, though QUEUE.md says each misalign gets one. Still misaligned 100 s later. Nine test webs (local 8–16) are left in the dev profile; they expire 2026-10-08 |
| Next/Prev idle | 2026-10-01 | pass | QUEUE.md § Next and Previous before the first Play. Quit paused on *'Bout It*; cold start: Next → *Talk Is Cheap*, Next → *Bye, honey*, Previous → *Talk Is Cheap*, each paused at 0:00, MusicKit empty, one `player:idleSkip` each. `np_command next` (the tray's and the media keys' path) → `np-bus:command {from: tray}` + `idleSkip`. Play → *Bye, honey* plays. The real media key not pressed: Windows would send it to whichever app owns the media session (his live app). The dev tray panel shows *Not playing* for a restored, paused song, so its buttons go to the Windows source |
| Drop | 2026-10-01 | pass | `checks/drop.mjs net 25`, a seek to 85 % inside it: `loadSegmentError` → `resumeArmed {at: 131}`, the toast held 4.9 s, then *can't reach Apple Music*. Back: *Apple Music is working again* ~12 s after the network, `resumeAfterReconnect {at: 131}` (no press needed), hushed, `resumeSeek {done: true}` |
| 18a.3 | 2026-10-01 | pass (faked) | Battery saver turned on from its Rulez row; `drop.mjs battery off` → the four holds (`why: fact:charging`), `data-glass-fancy=off`, `data-bg-motion=reduced`; `on` → all four end, his values back. Recipe turned off after |
| Grow 19.1 | 2026-10-01 | pass (1–3) with one gap | Shots (`checks/grow-timing.json`, 5 skins): Midi, Max wide / tall / Fill, each with Escape; all 20 probes right. Collapse: the covered card fades in its own cell, no pill. **The gap:** the clip looks fully open at ~+90 ms; the rows come at +218 (Glass), so the card is still and empty ~130 ms. The old order (`--grow-rows-at: 1`): +89 to +417, ~330 ms. The new order also gives fewer frames over the open in every skin (50 / 63 / 46 / 62 / 26 against 81 / 76 / 72 / 75 / 63; headless Edge). His fork, step 4: 0.4, or ~0.25. Collapse: the grown card's rows go at once and come back after it (his eye). Steps 4 on WebView2 and 5 not run |
| Fade 6c | 2026-10-01 | pass (6c.1 1, 3; 6c.2 1, 2, 5) | Shots (`checks/theme-crossfade.json`, 5 skins): Compass and title menu → one `theme-fade … by=hand` each (535–578 ms), no `appearance`, `boot=-`; the panel gone by ~+50 ms, no ghost (Ocean strip read). A skin pick → the cover (`appearance` 928–1,115 ms). The grey middle at ~+280–330 ms, as known. The agent pick (6c.1 step 4), Settings › Reset and reduced motion not run |
| Launch | 2026-10-01 | **not met** (cause open) | DEBUGGING.md § Launch step 7, `dev:built -- --hidden`, three cold launches: `ready` 1,175 / 1,176 / 1,277, `warm` 2,793 / 2,810 / 2,854 (target 600–700 and 2,000–2,100). The machine is slower than on 09-29 (`module` 208–326 against 153–165), but the library → ready gap grew more: ~250 ms against ~50. Three launches with the window shown: the same shape. Steps 1–6 (his eye) not run |

Summary: *6 pass (one faked) · 1 not met · 2 findings (the step 8 misalign, the launch gap) · 1 fork (grow rows at).*


**Run of 2026-10-01 evening (Claude, his ask: the desk tests of the three untested pieces).** `dev:built`; the queue steps with the window hidden (League of Legends was running: load 78 %, so the cold launch numbers are noisy). Early moments were read with a probe installed before the page (CDP `Page.addScriptToEvaluateOnNewDocument`) on reloads.

| # | Date | Result | Seen |
|---|---|---|---|
| Launch 2, 5 | 2026-10-01 | pass | DEBUGGING.md § Launch. At `deets:window-shown`, three reloads: Sound, Sleep, Room, Web and the volume pill present; the look final (black-red/Glass), no change after it (two same-value writes under the cover) |
| Launch 3 | 2026-10-01 | **partial** | `warm` before the press every time (945–1,023 ms on reloads). Press → MusicKit `playing`: 1,280 / 1,612 ms at the lift's end against 1,021 / 1,055 ms 5 s later: a press right at the lift still waits ~250–550 ms for work that runs then. On cold launches `warm` lands 480–555 ms AFTER the lift (as on 09-29: 2,113 against 1,935) |
| Launch 4 | 2026-10-01 | pass | Ctrl+Space at the lift's end: the Compass open in 32 ms, twice |
| Launch 6 | 2026-10-01 | partial | After the launch the tray panel's look matches the main window (black-red/Glass, dark ground). A tray right-click DURING the launch cannot be pressed from a script |
| Launch 7 | 2026-10-01 | noisy | Three cold `--hidden` launches, Settings on screen: `ready` 1,349–1,405, `warm` 3,163–3,237 ms; every stage later than this afternoon (`module`, `library` too) with the CPU at 78 %. Re-run on a quiet machine. Step 1 (the taskbar, three times) is his |
| Repeats 2 | 2026-10-01 | **fail** (one finding) | QUEUE.md § Repeats in one insert. Add to Queue one song three times: model and MusicKit both hold the three copies, aligned, and Next steps 2 → 1 → 0 with the Queue card. **Finding:** a SKIP between two adjacent copies of one song does not start it: Next (and Previous within 3 s) lands on the copy, then `player:pause {why: outside}` ~1 s later, or MusicKit plays on from the old copy's place; no `perf:sound`. A song that ENDS into its copy plays it. A skip into a different song is fine |
| Repeats 4 | 2026-10-01 | pass | Up Next [Talk Is Cheap, Click Bait, Talk Is Cheap]: Move to Top on Click Bait, and a drag of the last copy to the top (`insertParts` on the reconcile): aligned each time |
| Settings 3b.1 | 2026-10-01 | pass | The window shows with 39 of 82 rows; all 82 318–462 ms after the lift (the idle fill) |
| Settings 3b.2 | 2026-10-01 | pass | Keep card places on restart on, Settings at 1,800 px, reload: 82 rows at the window-shown moment, no fill, back at 1,800. The setting put back off |
| Settings 3b.3 | 2026-10-01 | pass | During the lift: Rulez › the Diary grow rule › Open in Settings: 82 rows at once, `diarygrow` flashed |
| Settings 3b.4 | 2026-10-01 | noisy | See Launch 7 |

Summary: *8 pass · 2 partial · 1 fail (adjacent copies) · 2 noisy.* A slip during the run: a Compass Enter on *Agent changes settings* moved it Ask → Off (Enter cycles a choice row); put back to Ask at once.

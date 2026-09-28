---
status: sop
desk_test: none
sources: [scripts/webview-eval.mjs, scripts/dev-app.mjs, src/diag.ts]
updated: 2026-09-27
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

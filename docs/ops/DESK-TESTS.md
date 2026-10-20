---
status: sop
desk_test: none
sources: [scripts/webview-eval.mjs, scripts/dev-app.mjs, src/diag.ts]
updated: 2026-10-17
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
7. **Read the record before you run or report a row (2026-10-17, his ask).** The owner often
   runs a test and forgets to mark it. Read the log, the `diag` ring, the `plays` table and
   WORKLOG.md first. If they show the steps ran clean, mark the row passed and cite what you
   read. He can override. Logs rotate, so read them early.
8. **One WORKLOG entry per run**, dated, with the §5 table's summary line. HANDOFF.md › Open
   now is corrected in place for each row that closes.

## 3. The list

> **State on 2026-10-20: three rows are open,** **A11** (the Metal skin: the agent part done 2026-10-20, his look left), **A10** (the Network panel: §9 passed on his word
> 2026-10-19; only the fetch wrap's A/B is left, an agent's) and **B21** (deetsmeter's cold start, HANDOFF.md › Open
> now). Every other row passed: the runs of 2026-09-27 to 2026-10-12, his report of 2026-10-13,
> his word of 2026-10-17 (B22) and the live log of 2026-10-17 (B20, §5). The
> rows stay as a record and for a regression run; a new open test is a new row.

Order: the uncommitted work first (a fail there stops a commit), then the released work.

| # | What | The script | Apps | Who | Notes |
|---|---|---|---|---|---|
| A1 | List keys on Rewind, Diary and Rulez | [COMPASS.md §5a](../features/COMPASS.md) | one | agent | Focus a row, dispatch arrow / Enter / ContextMenu / Escape `KeyboardEvent`s on `document.activeElement`; read `document.activeElement` after each |
| A2 | The Sort / View pop on the dropdown primitive | [UI-ARCHITECTURE.md §4a](../architecture/UI-ARCHITECTURE.md), the Part under Toolbar (10 steps) | one | agent | Step 4 needs Settings › Menus › Open menus on hover on: set it through the Settings card, then dispatch `pointerenter` on the pill's `.lib-ctrl`. Step 10: `document.querySelectorAll('.lib-pop').length` |
| A3 | The Friends box takes the song menu | [CONTEXT-MENUS.md §8](../architecture/CONTEXT-MENUS.md) step 11 | two | agent | The second app plays a song the first app's library does not hold; right-click its box in the first app's Friends panel |
| A4 | Two Settings scrollers on the app's bar | §4 below | one | agent | |
| A5 | The hover-hint rows reach the agent | §4 below | one | agent | Needs the CLI against the dev app (§1) |
| A6 | The Diary's Done copies the Export | [DIARY.md §8](../features/DIARY.md) step 11f | one | agent | Committed 2026-09-24, never run |
| A7 | Hide cards: Settings › Cards, the picker's right-click, Undo, the lock, a restart | [HIDE-CARDS.md §9](../features/HIDE-CARDS.md) | one | agent + owner | Built 2026-10-10. Steps 1–8 an agent can run on the dev app; step 9 (the look of the locked rows) is his |
| A8 | Layout for Max: 4 cards, 2 columns, 2 rows, 1 card; grow, Rulez, the full player | [MAX-CARDS.md §7](../features/MAX-CARDS.md) | one | agent + owner | Built 2026-10-11. Passed: the owner ran it (2026-10-12) |
| A9 | Graphics fallback: the rule, the toast's three buttons, the restart, the GPU-process event, the row's three choices | [GRAPHICS-FALLBACK.md §8](../features/GRAPHICS-FALLBACK.md) | one | agent | Built 2026-10-11. Steps 1–3 and 6–8 on `dev:app -- --gpu=off`; step 4 relaunches the app; step 5 ends the dev app's GPU process by PID (match `com.deetsmusic.dev` in the command line, never the live app's) |
| A11 | The Metal skin: the cover change, the peek, the thumbwheel, the four rows, every theme and surface; the other skins unchanged | [metal.md §6.7](../features/metal.md), DESK-TESTS.md §6.6 · `docs/ops/checks/metal-*.json` | one | owner | **Agent part done 2026-10-20 (metal.md §6.7):** the break-it pass, the scripts cold and warm, the timing and paint traces, frames by time at pixel level; the independent design review reached 9/10. Left: his look, Midi / Mini / full player by hand, and the two forks (Sepia as brass, the type). Pause through the app's Play button (a direct `pause()` was resumed) |
| A10 | The Network panel: the title, the bars, the ping only while playing, Test, a drop, AirPlay; the fetch wrap's A/B | [speedtest.md §9](../features/speedtest.md) · `node docs/ops/checks/fetch-wrap.mjs` (§6.2) | one | owner, then agent | Built 2026-10-19 on `net-worked` in a cloud session: type-checked for Windows, never run. He runs §9 the evening of 2026-10-19; the A/B can be an agent's, on `dev:built`. Step 9 waits on the DeetsSupport deploy (his call) |
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
| B14 | The Apple call counter's hourly line | [APPLE-CALLS.md §5](APPLE-CALLS.md) step 1 | one | agent | An hour of normal use, then `[apple] calls 1h` and the `quit` line in the log |
| B15 | Ocean perf check: the album light at 0 and at 100 | [OCEAN.md §6](../features/OCEAN.md) | one | agent | On `npm run dev:built`, with music, with and without the GPU (`--gpu=off`); read `[perf] frames`, never the trace alone (DEBUGGING.md) |
| B16 | Diary 11e: the CLI / MCP path | DIARY.md §8 11e | installed | owner | Needs the installed build with the Diary CLI |
| B17 | Add a room member as a friend: the stress test on live | [FRIENDS.md §18.8](../integrations/FRIENDS.md) | live | owner | |
| B18 | Room sync + Listen Along: the stress test on live | [ROOMS.md §18.8](../integrations/ROOMS.md) · FRIENDS.md §16.2 | live | owner | |
| B19 | Discord's two buttons are readable | [FRIENDS.md §8.4](../integrations/FRIENDS.md) item 3 | live | owner | A second Discord account |
| B21 | deetsmeter: the judge's four scenes on both apps (play, scroll, search, warm and cold start) | [music-app-comp.md §17.15](../ideas/music-app-comp.md) | installed + Apple Music | owner | Built 2026-10-10, committed 7be3d55. Plays music aloud, borrows the pointer and the focus, closes and reopens both apps; the League client closed first. 2026-10-11: Claude ran steps 1–5 and 7 (passed, §17.16); step 6 (cold, a reboot) is left |
| B22 | Rooms on the web: sign in, sound, an app and a browser in one room | [WebRooms.md §10.5](../features/WebRooms.md) | `npm run listen` + `dev:app` | owner | Needs his Apple ID typed in Apple's window. Claude ran the rest 2026-10-13 against the live worker (§10.4). The Safari part waits for the site page (part H) |
| B23 | Velopack: his looks at Setup.exe, the uninstall and the media flyout; an update from a Start Menu start | [VELOPACK.md §12.5](VELOPACK.md) | the installed beta | owner | Set up 2026-10-15: the beta on beta.4, beta.6 on the feed, its Setup.exe built. Claude reads Velopack's log after step 2 |
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
| A8 | 2026-10-12 | pass | The owner ran it; his report |
| A9 | 2026-10-12 | pass (8 of 8) | Four findings fixed in the run (the Rulez sentence, the rule's Rulez name, the toast's log line, the Canvas hint). WebView2 came back on the card after the GPU kill. Detail: GRAPHICS-FALLBACK.md §8 *Results* |
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
| A7 | 2026-10-10 | pass (his run) | Hide cards, HIDE-CARDS.md §9, every step. The quick panel folds (QUICK-SETTINGS.md §12.4) passed in the same run |
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
| Repeats 2 (copy skip) | 2026-10-01 late | pass | The fix for the fail above (QUEUE.md § Repeats in one insert, desk test (copy skip)). Next onto each copy: `copySkip {dir: 1}`, a `load` pause, sound in 198–242 ms from 0:00; Previous from index 1: `copySkip {dir: -1}`, playing; Next onto a different song stays gapless. Aligned after each step; no `outside` pause |
| Settings 3b.1 | 2026-10-01 | pass | The window shows with 39 of 82 rows; all 82 318–462 ms after the lift (the idle fill) |
| Settings 3b.2 | 2026-10-01 | pass | Keep card places on restart on, Settings at 1,800 px, reload: 82 rows at the window-shown moment, no fill, back at 1,800. The setting put back off |
| Settings 3b.3 | 2026-10-01 | pass | During the lift: Rulez › the Diary grow rule › Open in Settings: 82 rows at once, `diarygrow` flashed |
| Settings 3b.4 | 2026-10-01 | noisy | See Launch 7 |

Summary: *8 pass · 2 partial · 1 fail (adjacent copies) · 2 noisy.* A slip during the run: a Compass Enter on *Agent changes settings* moved it Ask → Off (Enter cycles a choice row); put back to Ask at once.

**His report of 2026-10-13 (the owner's hand tests, run over the days before).** He marked each one done; no failure reported. Claude read the live log for the ones it can see.

| # | Date | Result | Seen |
|---|---|---|---|
| AirPlay §13.6 | 2026-10-13 | pass (his) | Play on the HomePod, pull the cable: the window keeps answering |
| Listeners §4.3 | 2026-10-13 | pass (his) | The badge and the Settings row |
| Unshuffle | 2026-10-13 | pass (his) | The row's words and the hint |
| Uninstall Run value | 2026-10-13 | pass (his) | RELEASE-NSIS.md §3 (the NSIS hook): the update keeps it, the uninstall removes it. Velopack's twin is RELEASE.md §3 |
| Copy edit §5 | 2026-10-13 | pass (his) | |
| Presentation mode §9.3 | 2026-10-13 | pass (his) | |
| Usage counts §10 | 2026-10-13 | pass (his eye: the notice, the panel; Claude: steps 2, 3, 5, 6, 7) | Step 8 half: the cron's in-window delete not seen in a run |
| Stall reload, break-out | 2026-10-13 | pass (his) | QUEUE.md §Mid-song stall; STATIONS.md §1 |
| B9, B10, Rulez | 2026-10-13 | pass (his) | The review fixes (§17), §18.3 step 6 with a real headset, the three-line row (§19.4), Paste a rule and Import, rows with no name, the HomePod chime, the yes / no words, the mouse hold-then-move |
| MCP-INSTALL §8d, §9 | 2026-10-13 | pass (his) | The live log has `mcp-install: connect claude-desktop` and `connect codex` (2026-10-12) |
| Repair toast, 18a unplug | 2026-10-13 | pass (his) | The settings.json repair toast; Battery saver on a real unplug |
| B7 | 2026-10-13 | pass (his) | EQ per output with real headphones; the Discord profile during a sharing pause |
| B17, B18, B19 | 2026-10-13 | pass (his) | The friends and rooms stress tests on live; Discord's two buttons |
| B11 2–3, Fade 6c, Diary 4c | 2026-10-13 | pass (his eye) | The theme crossfade, the Press record in a rule fade, the Diary's playing-album box |
| Grow 19.1 4 | 2026-10-13 | pass (his) | The rows at `--grow-rows-at` as it is; no change |
| Launch 1–6 | 2026-10-13 | pass (his eye) | DEBUGGING.md § Launch |
| B14 on live | 2026-10-13 | pass (log) | `[apple] calls 1h` every hour on the installed 0.27.0 |
| B23 | 2026-10-15 | pass (his) | Media flyout from a Start Menu start; update beta.4 → beta.6 in 2.0 s; uninstall and first install "seamless and quite fast". The Access is denied wait is inside Update.exe and harmless (VELOPACK.md §12.6) |
| B22, Identity §9.2, Spin FPS §12 4–6, AirPlay §13.2a–b, Rooms §21.8 | 2026-10-17 | pass (his word) | He marked the five open desk tests passed. WebRooms.md §10.5 on this PC; its Safari steps wait for the site page (part H) |
| B20 | 2026-10-17 | pass (live log) | `player:deadNext` at 18:57 on 0.29.0: the re-window, `topUp` 1 ms later, the song started once, Next went to position 1 (QUEUE.md § The healed song played twice) |

## 6. Verify while you build (2026-10-17, his ask)

His ask, after the song facts box: when Claude builds a feature, it tests and verifies the
feature itself with scripts: the desk test, the edge cases and the race conditions. Then it
hands the feature over. The first run is LISTENERS.md §8.10. Its review (below) says what that
run did not cover.

This is the builder's own check. It is not the runbook of §2: a fault the builder finds in its
own feature is part of the build. Fix it and record it in the as-built (§2 rule 4 still holds
for a desk test of someone else's work).

### 6.1 The method

1. **Write the desk test first** (CLAUDE.md › the build checklist item 8), then a shots list
   that runs it (SHOTS.md §3, §5d, §5h). Build it in `shots/scratch/`, then keep it in
   `docs/ops/checks/` with its `pass` field ([checks/README.md](checks/README.md), "How to add one").
2. **Two sources, two jobs.**
   - **The demo** (`"source": "demo"`) is hermetic. Run every skin and theme (`looks`), every
     surface (Mini, Midi, Max) and the grown card. Use it for layout, motion and reduced motion.
   - **The dev app** (`"source": "dev"`) is his real library, with real Apple and Last.fm
     answers. Use it for the data paths, the log lines and the cache.
3. **A probe is the assertion.** After each step, a `probe` returns the DOM facts that decide
   pass or fail: the sections, the text, `data-hint`, the counts. Write the expected answer
   into the list's `pass` field before the run.
4. **Look at the part under test.** A snap of the card is not a look at the box. Scroll the part
   into view (`eval` with `scrollIntoView`) and `snap` it. Run `--seen` on each picture you
   read.
5. **The edge cases.** List them in the doc's desk test, and give each one a step:
   - every answer the data can give (a full answer, a partial one, "none", no key, a failure);
   - the feature's off switch (count the log lines: an off switch makes no call);
   - long text and empty text;
   - a narrow and a wide card, each surface, each skin;
   - the keyboard (Esc, Tab, arrows) with the focus in each place it can be;
   - a setting changed while the view is open.
6. **The race conditions.** Script each one with `eval`, `wait` and `frames`:
   - leave the view before its answer lands;
   - open two items fast, so the second answer lands first;
   - an answer that lands after the card redrew;
   - a page reload in flight;
   - the network dropped (`checks/drop.mjs`) or slow;
   - two cards or two windows on the same item.
   Read the `diag` ring and the log after each run, not only the pictures.
7. **Pure rules get unit tests** (`tests/*.test.ts`). A Rust parse gets a `cargo test` on a
   recorded answer, so a new shape fails a test and not a user.
8. **Restore and record.** Set back every setting the run changed. Put the results table in
   the feature doc's desk test section and one line in WORKLOG.md.

### 6.2 Safety on the dev app

The dev source is not hermetic: every step changes his app.
- **Never `click` a text field.** Set it by script (`value` and an `input` event). On
  2026-10-17 a click on the Library's search field landed on a pinned tile under it and played
  a song.
- Play nothing that the test does not need. If a step plays, say so in the report.
- Read his layout first (which card is in which slot). It can change during the run: a reload
  from another session's edit moved a slot to Search.
- **One driver at a time.** Before a run, ask the other sessions that share the checkout. While
  a run is in progress, do not reload or drive the dev app from another session.
- Read `ui:act` before you call a result a mystery (§2 rule 2).

### 6.3 Review of the first run (the song facts box, 2026-10-17)

**What it covered well:** the data paths on real answers (a song wiki, the album fallback, no
box), presentation mode and the way out, the box menu, *Notes from › None*, the Search card, the
cache re-read once and only once. It found one real bug: Esc also went Back (list-keys.ts).

**What it did not cover (UI):**
- The box itself was never seen in a picture. In Max's narrow quarter card, the box sits under
  the cover, below the fold. The pictures show the *SONG INFO* line, and the probes read the
  box. Its layout, spacing and long-text clamp were not seen.
- One look only (his live theme and skin), one surface (Max). No grown card (the box beside
  the cover), no Midi, no Mini, no other skin, no reduced motion.
- The slide-in motion was captured in frames but not judged. The *SONG INFO* fold
  (open and close) was not pressed. The hover hints were read from `data-hint`, not shown.
- *Notes from* on an album page, and *Last.fm only*, were not run.

**What it did not cover (technical):**
- No race was scripted: leaving the song page before Last.fm answers (the answer then calls
  `heroAside` on a page that is gone), two song pages fast, a network drop.
- The off switch was not proven to make no call: the run tested Hide and Undo, but not a song
  opened with the row off.
- Presentation mode's 5-minute re-read was not waited for.
- No `cargo test` on `track.getInfo`'s `toptags` shapes (a list, one object, none).
- The run was on a moving tree: the other session's edits reloaded the page twice.

### 6.4 Gaps in the tools (closed 2026-10-17)

His call the same day: "why use the demo when we can use the dev app?" So the dev app got what
the demo had, and the gaps closed in the runner (SHOTS.md §5i):
- **Looks, surfaces and settings on the dev app**, put back after each shot. A recorded Last.fm
  fixture for the demo is not needed.
- **`"expect"` on a probe**: a mismatch fails the shot, so a kept list is a regression test.
- **`invoke`** (delay, fail, patch and count a Tauri command: Rust's own calls, which the
  webview's network does not reach), **`network`** and **`reducedMotion`** steps for races.

### 6.5 Ask how a user would break it (his permission, 2026-10-17)

Once a feature is built, Claude may ask Sonnet agents (`model: "sonnet"`) how a user might break
it from a UX or workflow view, as solution engineers test a developer's build (not an
adversarial review). Give each agent the feature doc and its files, and give each a different
view (workflows and keyboard; data and timing). Ask each for concrete steps, what should happen
against what the code suggests, likelihood × impact, and whether CDP can script it. Then check
each scenario against the code yourself: an agent reads, it does not run. A real fault becomes a
fix and a shot with an `expect`. A fork goes to him. A fault older than the feature is noted.
The first run: two agents, 39 scenarios, 7 fixes (LISTENERS.md §8.11).

### 6.6 Motion and transitions: catch the smallest piece (his ask, 2026-10-20)

**What happened.** The Metal draft's cover change (docs/features/metal.md §6.1) passed seven
independent design reviews and Claude's own frame checks. Then he found four faults in a few
minutes of use: a 133 ms stall in the middle of a turn, a blank cover that flashed in a side
slot, doubled edges where two layers of one cover overlapped, and jumps, pops and wrong covers
on rapid Back / Next. Every one was real, and every one could have been found before hand-over.
Claude skipped §6.5 (the break-it pass) and the motion monitor (QUALITY-SWEEP.md §3a), chased a
design score instead, tested only one gentle press on covers already cached, judged motion from
small contact sheets, and never read the timing data the runner already recorded. The reviewer
afterwards: it had one press, eleven small frames, no timings, and was asked to score, not to
find faults.

**The rule.** A feature that moves something (a transition, a swap, a panel, a scrubber, a
reveal) is not handed over, and is not sent for a review, until steps 1–5 below are done, in
order. A design review (step 6) comes last and never replaces them.

1. **The break-it pass (§6.5), always, three agents.** One Sonnet agent per lens of
   QUALITY-SWEEP.md §4 (workflow and keyboard; data and timing; neighbors and load), with the
   brief of its §5. For motion, add to each brief: "what if it is done twice, fast, backwards,
   mid-motion, or on content that is not loaded yet". Triage every scenario against the code.
2. **The motion cases, scripted on the dev app, every time:**
   - **cold**: the first time, with nothing cached (`{ "clearCache": true }`);
   - **reverse**: the other direction (Back as well as Next; close as well as open);
   - **rapid**: three to five presses ~250 ms apart, which interrupt motion mid-way;
   - **same content**: a change where nothing visible differs (two songs, one cover);
   - **neighbors**: a theme change, a surface or window-size change, reduced motion, during it;
   - **his real gesture**: when he reports one, script exactly his order and pace.
   Each run ends where it started (his song, paused) and says so.
3. **The timing gate.** Read `changes[].pops` in the clip's `.frames.json` (SHOTS.md §5f): the
   largest gap between two changes in the middle of a motion. Over ~50 ms is a stall to explain
   before anything else. Read the `[perf] frames` lines for the worst frame and long tasks.
4. **The motion monitor** (QUALITY-SWEEP.md §3a, `checks/smooth-monitor.js`) armed over the
   moving parts, with `expect` on its report: no flash, no snap, no jitter that is not designed.
5. **Frames, read properly.** Sample by time, not by index (the frame on screen at evenly spaced
   moments: a 4 ms frame must not weigh like a 70 ms one). Read every real frame of a fault at
   full size, cropped to the part that moves (each side slot, each layer), with its ms. Compare
   frame to frame for a layer that should not be there (a doubled edge is 1–2 px).
6. **A review, if one is wanted, asks two questions with two kinds of material.** A design score
   from the frames, and, separately, a fault hunt: "find stalls, flashes, doubled edges, jumps
   and wrong content". The fault hunt gets every frame with its ms, 2× crops of each moving
   region, frame-to-frame difference images, and the sequences of step 2 (cold and warm side by
   side, reverse, rapid). A score never closes a fault hunt.

Keep the step-2 lists in `docs/ops/checks/` with their `expect`s, so the next change to the same
motion runs them as a regression test. The Metal lists are `docs/ops/checks/metal-*.json` (moved
there 2026-10-20).

### 6.7 What the Metal stress test taught (2026-10-20)

His ask: stress test Metal and loop an independent Fable reviewer to 9/10 (metal.md §6.7). It
took five rounds (6 → 9) and found faults that seven earlier reviews had missed. What to repeat,
and what to avoid, next time.

**Before measuring anything**
- **Check the renderer first.** His dev app had fallen back to WARP (software drawing) before
  the run; every trace and long task was meaningless until it ran on the card again. Read
  `UNMASKED_RENDERER_WEBGL` (or the `gpu:renderer` log line) before any timing.
- **`app_restart` from a Claude shell ends a dev runner he started in his own terminal** (Vite
  goes with it; CSS stops hot-reloading and the next page reload is a dead page). Restart with
  `npm run dev:app` from the session instead, and say so.
- **Read his look at the start and check it at the end.** A shot run that is interrupted (a page
  reload from an edit mid-shot) can leave a look it set; the `state … was {…}` line in each shot's
  console is the record of what it started from. He also uses the app during a run: a change you
  did not make is his, so leave it.

**Finding faults**
- **The break-it pass first, three Sonnet agents, one lens each** (§6.5): 44 scenarios, and the
  worst fault of the day (the cover and its side covers deciding the direction apart) came from
  it. Triage each against the code: about a third were real.
- **Read the frames by time, cropped and enlarged, with difference images:**
  `docs/ops/checks/frames-bytime.py` (a sheet: the frame on screen every N ms, each with its
  change image under it). **Score a motion** with `docs/ops/checks/frames-popscore.py`: the
  share of the whole change its largest frame carries. A pop is one frame with a large share
  (45 % before the fix, 6–13 % after). Enlarge one slot alone (a 2× crop) to see a doubled edge.
- **A rAF sampler in the page is the assertion for layers** (doubled slots, the turn's
  direction): count frames where a condition holds, return the count, `expect` 0. Compare full
  URLs: every cover address ends `/480x480bb.jpg`, so a suffix match reported doubles that were
  not there.
- **Cold and warm are two different motions.** `clearCache` makes the arriving picture download
  again; keep both lists (`metal-next-back.json`, `-warm.json`) and give a reviewer both.
- **Repeated frames in a sheet are the screen recording, not the paint**: check the app's own
  `[perf] frames` line for the clip (the turn painted ~200 fps while the sheet repeated frames).
- **Every list ends where it started**: press Back until the starting title shows, pause through
  the app's Play button (a direct `pause()` is resumed). One old list skipped his queue 10 songs.

**Fixing motion**
- **Two modules that animate one thing must not guess the same fact apart.** Let the owner of
  the animation publish what it did (`data-turn`, `vinyl:turn`, `vinyl:covered`) and the other
  follow it; a timer of its own drifts under load (the giving slot emptied before its cover was
  there, only under the shot runner).
- **Ask the data that knows**: the queue knows Next from Back; a list of songs shown does not.
- **A z-index keyframe keeps the whole animation off the compositor**, transform included.
- **`preserve-3d` is flattened by `overflow` or `clip-path` on the same box**, and planes that
  really intersect look worse than a cut. Where two covers must cross, choose the moment: when
  the old one is home, over the smallest overlap, with a short lead.
- **Fixing one artifact makes another**: a fade-in that outranks a CSS hide (an animation beats
  the cascade) put a ghost in a slot. Re-run every check after every motion change.

**Performance**
- **A/B by injecting a style override** in the live page during a scripted gesture (one layer
  off at a time, then all at once), with `__frames.sample()` or `webview-profile --trace`. No
  single layer explained Metal's slow scroll; all of them together did.
- **An inherited `@property` color with a transition repaints the whole card every frame** of it
  (a skip cost ~70 % of the page and the GPU process); step it instead.
- **SVG filter textures re-raster as content moves**: bake them once into bitmaps at the screen's
  density (pixel-identical; compare a still at 0 difference).
- **Dev telemetry runs a rAF loop during animations**, so a dev trace shows a main frame every
  vsync that a release build does not have.

**Color**
- **Design colors against the rendered pixels.** Metal's noise averages ~0.73 on screen (the
  filter works in linear light), so an overlay grain lifts a plate ~1.5× and its controls more;
  a paint chosen by arithmetic rendered at 3:1. Run the readability check on the skin's looks
  before a commit (`docs/ops/checks/readability.mjs --look … --no-glass --tag …`, ~80 s a look);
  a toast measured at 12–21 % opacity is a fade caught mid-way, not a color.

**The review loop**
- **Pictures only, and tell the reviewer his recorded calls** (the zoetrope, no reflection, the
  themes' roles), so it scores within them and names a conflict instead of scoring it.
- **Verify every claim at pixel level before acting**: two (a landing flash, "round" corners)
  were wrong and were withdrawn when shown the measurement or a 6× crop.
- **One reviewer for continuity across rounds; a fresh one for a separate question** (the fonts),
  so the first one's anchoring does not carry over.
- **Give it the numbers it cannot see**: the frame counter, cold against warm, what is core app.

**Tools in this shell**
- Write multi-line file content with Edit / Write, or `python - <<'X'` for scripted
  replacements; `node -e` with template literals breaks on backticks.
- Never run the shots runner from inside its own output folder (EPERM on the next run).
- Vite serves any project file (`/shots/scratch/…`), but a `.css` comes back as a JS module:
  inline its text in the eval instead of fetching it.

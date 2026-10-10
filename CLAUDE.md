# DeetsMusic — project guide for Claude

A lightweight Apple Music player for Windows 11 (Tauri v2 + WebView2, vanilla TS
front-end, Rust back-end).

## Start here
- **`docs/HANDOFF.md`** — cold start: run, ship, **Open now** (everything not finished),
  state of play, gotchas, file map. Corrected in place.
- **`docs/WORKLOG.md`** — the record of each sitting, newest first, with the desk-test
  scripts. Add one dated `##` per sitting; never correct an old entry.
- **`docs/LESSONS.md`** — what the owner tends to want: the mission, the three stop rules, the
  lessons with their evidence, and the tie-breakers. It shapes the option you RECOMMEND. It
  never closes a fork — he does (see Working style).
- **`docs/DOCS-ORG.md`** — how the docs are organized, and why.

## The docs
**State lives in each doc, never in this file.** Every doc starts with front matter:
`status` (shipped · built · designed · project · parked · idea · foundation · sop · guide),
`shipped_in`, `desk_test`, `sources`, `updated`. A part of a doc with its own state carries a
part marker under its heading: `> **Part:** designed · 2026-09-17`. Where a doc has an
"as built" section, read it first: where it disagrees with the design above it, it is the code.
- `npm run docs:check` after any doc edit: links, mentions, § pointers, front matter, versions,
  generated copies. The release check fails on it from 2026-09-28. **Since 2026-09-27 it also
  reads the code against its ledgers** (checks 20–26, DOCS-ORG.md §8): a settings key with no
  agent spec, a toast site or a hover hint off its ledger, a scroller without `app-scroll`, a
  right-click listener no doc names, a box placed by hand, a card with no list keys. Run it
  after code too.
- Move a doc with `node scripts/docs-move.mjs NAME=area` (it re-points every link and
  `docs/` path in the repo). Never move one by hand.
- Generated docs — edit the source, never the output: `architecture/TOKENS.md` by
  `npm run tokens` (in the same commit as any change to palette.css / themes.css / skin.css);
  `cards/SURFACES-AND-CARDS.md` by `npm run docs:copies` from the `architecture/` one.
- A new doc gets front matter (DOCS-ORG.md §5) and one line below.

**`docs/`** — `DESIGN.md` product intent · `NEXT-VERSION.md` the feature backlog ·
`FUTURE-SETTINGS.md` behaviors hard-coded now, to expose later · `AGENT-SETUP.md` a stub that
old installs' Guide button opens.

**`docs/architecture/`** — the engine
- `UI-ARCHITECTURE.md` — the token / theme / skin tiers and the collection-card engine.
- `DATA-ARCHITECTURE.md` — auth, the normalized model, the provider, the SQLite cache.
- `SURFACES-AND-CARDS.md` — the surfaces (mini / midi / max) and the card slot system.
  **§5 is the recipe for a new card**: the eight systems a card adopts (menus, keys, picks,
  drags, hint shapes, memory, popovers) and which cards adopt which today.
- `TOKENS.md` — every token (generated).
- `SETTINGS.md` — the settings store, row kinds, keys and owners; how to add a setting.
- `SETTINGS-INVENTORY.md` — every control and what each choice does.
- `TOASTS.md` — the notice primitive, its tiers, the sticky queue, every call site
  (`__toast.demo()` shows one of each kind).
- `DRAG-DROP.md` — drag and drop between cards.
- `CONTEXT-MENUS.md` — one right-click menu per media type (`media-menu.ts`); the row order.
- `UX-COVERUPS.md` — the ledger of latency and jank we cover instead of remove.
- `LIBRARY-VIRTUALIZATION.md` — windowing for long lists.
- `RULES.md` — the rules engine: moment and state rules, the `if` tree, the overlay on
  settings (`effective` / `ownSetting`), the rows that make rules. Built 2026-09-26 on
  `rules-rulez`; §18 is the as-built record. Rules sit under features, never replace one.
  §19 is how a feature uses it. The Rulez card is `features/RULEZ.md`.

**`docs/cards/`** — card behavior
- `CARD-GROW.md` — grow a card over its neighbor, Fill in Max, the drill swap.
- `CARD-SWAP.md` — swap, summon and replace motion in each skin's `--swap-*` shape.
- `CARD-MEMORY.md` — a card comes back where you left it.
- `STAGE-COLUMN.md` — the Max stage column: the square cover, the Queue's floor.
- `SURFACES-AND-CARDS.md` — the generated copy of the `architecture/` one.

**`docs/features/`** — one surface or one feature
- `PLAYLISTS.md` — the local-first store, the Apple mirror, the gated export.
- `PLAYLIST-WEB.md` — a playlist from an artist and their collaborators; song and album seeds; temporary webs.
- `PLAYLIST-REFRESH.md` — how often a mirrored Apple playlist re-reads its songs.
- `HOME.md` — the Home card: the shelves, the bucket score, Hide, the New shelf.
- `QUEUE.md` — the queue model and MusicKit windowing. Read it before queue.ts / player.ts.
- `SEARCH.md` — the catalog Search card.
- `SECOND-SEARCH.md` — a second Search card to compare two albums.
- `SEARCH-FIELDS.md` — DESIGNED, not built (2026-09-24): one `searchField()` for all six
  search boxes: ×, Escape, Ctrl+F, delay, keys. Today each box is its own code; do not look
  for the primitive.
- `STATIONS.md` — Apple stations and radio mode.
- `FAVORITES.md` — Add to Library and ♥; the store of every track we touch.
- `PINS.md` — pinned tiles, the shelves, the On Click verbs.
- `ARTIST-VIEW.md` — the artist hero, its shelves, the chip flight.
- `FULL-LIB.md` — the Library's "Full | Lib" chips: Apple's whole album or artist in place of your songs.
- `CREDITS.md` — writer credits from Apple's `composerName`; the song pane.
- `SOUND.md` — the Equalizer on one Web Audio graph; DeetsAdaptiveSound hidden behind a DevTools
  flag since 2026-09-25 (§11a).
- `AUDIO-QUALITY.md` — the sound chain from Apple's stream to the speaker.
- `VINYL.md` — the Press record player.
- `DEETS-REWIND.md` — listening stats and the Rewind card.
- `DIARY.md` — the Diary card: an album journal, a note and a score per song, the scale rule.
- `LOOK-SCHEDULE.md` — the day / night look and its pre-paint in `index.html`.
- `COMPASS.md` — Ctrl+Space: places, settings, verbs, library items, the calculator.
- `COMPASS-TERMS.md` — every word the bar answers to; update it with `SYNONYMS` in compass.ts.
- `TRAY.md` — the tray icon, the tray panel, minimize to tray.
- `SUGGEST-LESS.md` — Apple's −1 plus our own marks; proactive skips.
- `ALBUM-COLOR.md` — the album-colored aurora and text.
- `COVER-WALLPAPER.md` — Glass › Canvas: the album and queue covers, or your own picture, behind the cards.
- `OCEAN.md` — the Ocean sea: the heavy swell in perspective, the glow from the deep, heave, ripples.
- `MOVABLE-ROWS.md` — hold a header to move a section; the Settings search bar; Ctrl+F.
- `ONBOARDING.md` — the hover-hint ledger (every `title`), right-click coverage, Settings ›
  Tips, the first-run walk (`npm run dev:fresh` to be a first-time user).
- `QUICK-SETTINGS.md` — the cog's quick panel and the New badges (`NEW_MARKS`).
- `WEB-DEMO.md` — the real UI in a browser on deets.solutions/demo, with mock tracks.
- `RULEZ.md` — the Rulez card (Max only): make your own rules from words; the cascade guards,
  cancel events, the ten routes (§3; all built, §7, §8, §10.2), the album color facts and Live
  Theming (§11), one row per recipe (§14). Next: a design pass on custom rules (§15). The
  engine is `architecture/RULES.md`.
- `LAYOUT.md` — two Settings › Window rows: the artist view's order and hidden shelves, and
  the On / Faded / Hidden buttons; each part is its own rule target. Designed 2026-09-27, every
  fork his; on the docket, not built.
- `HOP-IN.md` — DESIGNED, not built (2026-09-28): the welcome screen before sign-in, the
  Cruisin / Pro pick, the two presets (Cruisin = defaults, Pro = his own settings), the Rulez
  gate. Recipes in Settings are RULEZ.md §16.
- `GRAPHICS-FALLBACK.md` — DESIGNED, not built (2026-09-29): when the GPU process falls back to
  WARP (software drawing), a built-in rule turns the heavy effects off and a toast offers a
  restart; the *If graphics fail* row; the `graphics` fact. Row words and toast text are open.
- `HIDE-CARDS.md` — DESIGNED, not built (2026-10-10): the Cards section hides any card but
  Settings, Now Playing and Queue from the card picker (one `hiddenCards` key replaces
  `rewindCard`); the picker only, the feature keeps working. §7 is the build scope. It is
  also Hop in's Rulez gate (§6.2, one mechanism, his call).
- `USAGE-COUNTS.md` — DESIGNED, not built (2026-09-29): anonymous active-install counts, a
  weekly settings row and weekly health counts (log errors, Apple calls) to DeetsSupport. No ID,
  no IP, an allow-list, groups under 5 hidden. §2 is the privacy rules; §9 the open forks.
- `SKINZ.md` — the Skinz card (Max only): edit the 12 roles of each of the 6 theme slots; edits
  sit on the built-in, rules pick the slot. The skin controls are parked (theme first, §11).
  The Album theme (colors from the cover, §12) is built with it; its forks are open.

**`docs/integrations/`** — anything that talks outside the app
- `AGENT.md` — the agent / CLI routes on the bridge.
- `AGENT-SETUP.md` — the user's guide to control the app from an AI app or a terminal.
- `MCP-INSTALL.md` — `deetsmusic mcp install` and its Settings panel.
- `EXTENSION.md` — the MV3 extension (`extension/`) and the loopback bridge.
- `LASTFM.md` — Last.fm scrobbling.
- `AIRPLAY.md` — play on a HomePod; the shared sender crate.
- `ROOMS.md` — listening rooms; the worker is `../DeetsMusicRooms`.
- `FRIENDS.md` — Friends and Discord Rich Presence; the worker is `../DeetsMusicFriends`.
  §20 is ON THE DOCKET (an idea, 2026-10-01, every fork his): friends see your Songs of the Day
  and your Diary, a local web of picks with no algorithm. Today a friend sees only presence;
  the Diary is private. Do not tell a user it exists.
- `DeetsOTD.md` — Song of the Day and its outlets.
- `THREADS.md` — DESIGNED, not built (2026-10-08): a Threads outlet for Song of the Day picks
  and Diary reviews (a thread chain), the owner only as a tester; §8 the open forks.
- `PROVIDERS.md` — Apple Music and Spotify in one library.
- `LOCAL-DATA.md` — the library read tool and read-only SQL for agents and users.

**`docs/ops/`** — build, ship, diagnose
- `RELEASE.md` — build, Authenticode signing, publish, the updater, install, uninstall
  (§0 = the commands, secrets and keys on one page).
- `RELEASE-NOTES.md` — the text of each release; `release:publish` copies it into the update offer.
- `BETA.md` — DeetsMusic Beta: a second installed app beside the full one (`release -- --beta`),
  the data copy and `deetsmusic-beta pull`. Beta-first is PAUSED since 2026-09-24: releases go
  straight to live.
- `DEBUGGING.md` — the diagnostic tools, the telemetry, the recipes.
- `DESK-TESTS.md` — the open desk tests as one runbook for an agent in its own session: the
  setup, the rules, the list with who can run each (agent / owner), the results table.
- `checks/README.md` — the archive of re-runnable test scripts (his ask, 2026-10-01): a shots
  list or a drive script written for a desk test is kept there with a description, for a
  regression run later. `checks/drop.mjs` holds a network drop or an unplug on the dev app.
- `LOGGING.md` — the rolling log file, `diag.ts`, the watchdog.
- `DB-HEALTH.md` — is the database still writable: `Db::lock`, the canary, the counters.
- `APPLE-CALLS.md` — the Apple call counter and the 429 back-off (`apple_calls.rs`); which
  commands are background jobs.

**`docs/ideas/`** — not built; never tell a user the app does these. `SECRETS-AND-CSP.md` —
designed 2026-09-29: a CSP for the webview; DPAPI for the Apple token and Last.fm session.
`fullscreen-player.md` — every fork decided 2026-10-02, not built: grow Now Playing so the
cover is as large as the window allows (Midi, Max, Mini's player view); §6–§7 the decisions,
§9 the motion (decided), §10 the edge zones, §11 the rest of the design pass.
`music-app-comp.md` — an idea (2026-10-06): metrics and methods to measure DeetsMusic against
the Apple Music app for Windows with symmetric OS-level tools, and (2026-10-10) each release
against the last from 0.25.4 with Apple's app as the control; §17 scopes `deetsmeter`, our own
input + screen + sound tool (F13–F16 decided, not built); §9 the rest of the forks.
**`docs/guide/`** — the
user guide for deets.solutions (DOCS-ORG.md §13): a wiki, one page per card or workflow, each
with a walkthrough video, the steps and FAQs linked to open issues (§13.10, 2026-10-01). `SHOTS.md` — the pictures and clips of each
feature, made by a script from the demo; for the guide, a marketing overview, and visual
debugging (§5a–§5c), measuring a gap and A/B runs (§5f). `motion.json` beside it is the motion set: every animation in 5 skins. `marketing.md` — the
shipped features as a tech spec, with the shot of each, for the intro video; he directs it (§1).

## How to verify your work
- **The user runs the app and tests your changes** (`npm run tauri dev`) and gives
  feedback. **Do NOT build throwaway test harnesses, mock pages, or one-off tooling to
  verify UI behavior** — it wastes time/tokens. Make the change, sanity-check it
  compiles, then hand it to the user to try.
- Cheap checks that ARE worth running (not harnesses): `npx tsc --noEmit` and
  `npx vite build` to catch type/compile/bundle errors before handing off.
- **Unit tests on pure logic (2026-09-25):** `npm test` runs `tests/*.test.ts` on Node's
  built-in runner, no test dependency. `npm run check` = tsc + tests + docs:check + cargo
  check + cargo test (~15 s), and the pre-push hook (`.githooks/pre-push`) runs it. A test
  covers a pure rule only; when the rule sits in a DOM or MusicKit module, move it to a
  small pure file first (`queue-sync.ts`, `layout-rules.ts`, `frame-period.ts`). A bug in
  a pure rule gets a test with its date in the name. `tests/setup.mjs` says what is stubbed.
  A module whose RULE is pure but whose imports are not (media-menu.ts: the row order, over
  the player and MusicKit) gets its own resolve hook and a stub map: `tests/stubs/` and
  `tests/media-menu.test.ts` are the reference (2026-09-27).
- If something genuinely can't be reasoned through and the user is away, ask them to
  test rather than scaffolding a harness.
- **Playback can be driven and measured from the session (2026-09-12).** Start the dev
  app (`npm run dev:app`, in the background), then use the `deetsmusic` MCP tools
  (`search` / `list` → `play`, `queue`, `control`, `now_playing`). A `play` call returns
  after the song has started, and every play writes one `[perf] click→sound …` line to
  `%APPDATA%\com.deetsmusic.dev\deetsmusic.log` with the stage split, MusicKit's own
  requests, and out-of-click events (`grow`, `deadNext`, `desync`, `misalign`) — read it
  with a `grep "\[perf\]" … | tail -1`. Song-end behaviour: `control seek 97` and wait.
  Cold start: stop the dev exe (the runner exits with it), relaunch, wait for the
  `start:` log line. Limits: the MCP plays a list from its first song (the 3,895-row
  library click is a hand test) and its round trip is ~1 s (Previous within 3 s of a
  click can't be reached). Full reference: `docs/ops/DEBUGGING.md`. This is dev-only
  telemetry (`src/perf.ts`, Vite `DEV` flag) — the release bundle carries none of it.
  **Knowing the dev app is up:** wait for `start: DeetsMusic` in the runner's output with
  `grep -a` (the file has non-ASCII). Never match `Running .*deetsmusic`: cargo's color codes
  sit right after "Running", so that pattern never matches (missed several times, 2026-09-17).
  On a timeout, read the output file before you report.
- **A complaint about the app HE is running is read, never guessed (2026-09-18).** Three
  reads, in order, none needing a restart: the `query` MCP tool over `plays` (its `context`
  column names the surface every start came from), then `deetsmusic diag` / the `diag` MCP
  tool (the window's LIVE ring — `ui:act` gestures, `player:*`, drills), then the log file
  for anything older. The ring auto-flushes every 5 minutes. Two code paths that read the
  same in the file can behave differently on the queue's state at the click, so reading the
  source is not a trace. DEBUGGING.md §Recipe — the user reports a playback complaint.
- **Frame smoothness is measured the same way (2026-09-13).** `src/frames.ts` logs one
  `[perf] frames …` line per scroll / scrub / pane slide / folder open / queue drag / menu /
  appearance switch, judged against the sampled display refresh rate, plus `[perf] input …`
  for any slow press→paint. `__frames.sample(ms)` from `scripts/webview-eval.mjs` measures a
  scripted scroll. DEBUGGING.md §Frame telemetry.
- **The Press record's spin is measured too (2026-09-15).** `src/vinyl.ts` logs `[perf] vinyl show …`
  per cover change, `[perf] vinyl snap …` per jump and `[perf] vinyl song …` per song;
  `__vinyl.sample(ms)` returns the disc's error against the song. For what is on screen, trace the
  computed `transform` angle every 50 ms while clicking the card's own buttons. VINYL.md §8.
- **Graphics work has its own rules (2026-09-16).** Measure on `npm run dev:built`, never the
  plain dev server: DevTools auto-opens in dev and renders in the SAME GPU process, and vite
  serves unbundled JS + many `<style>` tags. Judge a change by **frames ÷ ms**, never by the
  main-thread trace alone — `will-change` on the rising panels cut style recalc 766→260 ms while
  delivered frames fell 229→50 fps, because the cost moved to raster. `webview-profile --trace`
  now prints **busy time per thread** (the GPU process included) as merged intervals; read that
  before the per-event table. Check the `@N Hz` and `[perf] gpu` lines before trusting any
  number. `--gpu=off|slow` pretends to be a weaker machine. DEBUGGING.md.
- **Seeing the UI: the shots runner (2026-09-28).** `node scripts/shots.mjs` drives the web
  demo (the real UI, mock tracks) in headless Edge. No dev app is needed, and nothing on the
  desktop moves. A clip gives an MP4, a **frame strip** (one PNG of the motion, each frame
  labeled in ms; this is how you watch motion, since you read pictures and not video), the
  shot's console with the app's own `[perf] frames` / `[perf] input` lines, and `.frames.json`.
  For one bug, use the scratchpad: `--scratch <name>` writes a starter list to
  `shots/scratch/<name>.json`, and the same command runs it. Add `"frames": N` to a step to
  keep the next N real paints after it (files + one labeled PNG), `probe` for a JS answer into
  the console file, `snap` for a 2× picture (`--slow 4` shows fast CSS motion in detail).
  **To explain a gap or compare options (2026-09-28, SHOTS.md §5f):** the frames at a step carry
  the app's marks (`src/marks.ts`: panels, frames windows, the theme fade), real page stalls in
  red against late screencast frames in yellow, and a change curve (onset / 50 % / 90 % from the
  input; `"region"` for one box). `--vs "--token=value"` runs a variant beside the first and
  writes a side-by-side PNG; `--repeat n` gives medians; `--tag` keeps a run; a busy CPU marks
  the row NOISY. Add a `mark()` before you write a one-off probe.
  Press→paint time comes from `[perf] input` in the console file, never from a frame gap
  (the screencast delivers late). The motion set
  (`--list docs/guide/motion.json`) is the before / after view of any motion change. It is NOT
  a harness to build: it exists, so use it. The limits (not WebView2, a fake MusicKit, no OS
  window): DEBUGGING.md §Seeing it. **Check the strip, not only "ok":** a clip passed while
  its click did nothing, because the Glass background kept painting (SHOTS.md §5b).
- **Heaviness + profiling:** `scripts/heaviness-sample.ps1 -Loop 3600` logs both apps' memory
  and CPU hourly; `scripts/webview-profile.mjs [--trace] "<expr>"` profiles the dev page. How
  to read all of it: DEBUGGING.md §Reviewing the telemetry.
- **Registry writes from this session are not real.** The Claude desktop app is an MSIX
  package: your shells, and a `dev:app` you launch, write `HKCU\Software\Classes` into a
  private hive that Edge and other programs cannot see (the deep-link scheme hid this way,
  2026-09-13). Check or write the real registry through a WMI-started process. DEBUGGING.md
  §Sign-in.

## Working style (the user directs the architecture)
- For non-trivial features, **design on paper / talk it through first**, surface the
  real forks (he responds well to multiple-choice), confirm, then build.
- **He decides every fork (2026-09-18).** Deciding for him is off, and there is no prediction
  log any more. When a choice comes up that he has not already made — a default, a wording, a
  placement, a motion value, a new row, a badge, a schema shape, an architecture — bring him
  the fork before you build it. Short options, the real ones only, your recommendation first.
  Reason: on 2026-09-18 he found the room member count badge in the title bar
  (`src/room-panel.ts`) only after it had shipped to live in 0.10.0. A decision he never saw
  reached users.
  - `docs/LESSONS.md` and `docs/TASTE.md` are how you pick what to RECOMMEND. They are not
    permission to skip the question.
  - Inside a fork he HAS chosen, build the full, polished thing without asking again — the
    lessons' §4.7 and §4.7a hold. "He decides" never means "build less".
  - At hand-off, list what you decided inside his choice, so nothing ships unseen.
- **One load-bearing feature in flight (2026-09-17).** Hand it over, he desk-tests it, then the
  next one starts. Two small features at once is fine. Two that both touch the schema or a
  shared primitive is not. Clear the open desk tests before new work: on 2026-09-17 five
  untested features shared one tree (1,603 uncommitted lines), so a wrong call in one hid under
  the others. That stack, not a single wrong fork, is what makes a redo painful.
- **Before you build a new panel, row, button or card, walk this list** (added 2026-09-16
  after the sleep panel shipped without its row motion). Read the primitive's own file, not
  only a call site: one call site never uses every part of a primitive.
  0. **A new card:** SURFACES-AND-CARDS.md §5 first. A card adopts eight systems (the
     registry, the collection engine, right-click, the keyboard, picks and drags, hint
     shapes, memory, popovers); a card that skips one still works, so nothing catches the
     miss (Rewind, Diary and Rulez had no arrow keys, found 2026-09-27).
  1. **Motion:** a dropdown panel gets `.pop` (arrival) AND `enterRows` from `src/pop.ts`
     on open (`onOpen`) — the "Play on" panel is the reference, not the volume panel. Any
     part that appears later (a row a pill reveals, a button, a status line) goes through
     `enterRows` too. Reduced motion is handled by the primitive; a custom animation adds
     its own `prefers-reduced-motion` rule in styles.css.
  2. **Tokens:** geometry, type, spacing and motion are `--*` tokens in `skin.css` base
     (a skin overrides only what it changes); color is a theme role in `themes.css`. Grep
     the token name before using it (`--fs-small` did not exist; `--fs-subtext` did).
  2a. **Design language:** correct tokens do not stop drift. Name the **control family**
     the new control joins — panel chip, menu row, icon square, toast button, field — and
     copy that family's whole rule set (fill, border, height, radius, type, alignment,
     hover, focus). The family is decided by WHERE the control sits, not by the nearest
     code you copied: a panel is not a toast. The table and the action mark are
     UI-ARCHITECTURE.md §2a. A family gets alias tokens (`--ap-ask-radius:
     var(--sound-chip-radius)`), never a new raw value. Added 2026-09-17, after the AirPlay
     permission buttons shipped on the toast idiom inside a panel of filled chips.
  3. **Hints:** every `title` is a hover hint (src/hint.ts) and goes in the ONBOARDING.md
     §1 ledger. A new row shape goes in `SHAPES` (hint.ts) and the §1a list.
  4. **Toasts:** every new `toast()` call is a row in TOASTS.md §5.
  5. **Settings keys:** a new key in `settings-store.ts` gets a default with the "why", a
     spec in `agent-settings.ts` (so the agent reaches it) and a line in AGENT.md.
  5a. **New badge:** a new Settings row or section gets one line in `NEW_MARKS`
     (settings-card.ts), so it wears the N until the pointer first rests on it, and its quick
     panel square shows the N again (QUICK-SETTINGS.md §10, his wish 2026-09-20). Never
     take a line out: a mark stays until that user clears it. A brand-new install starts
     with every listed mark seen, so only settings added AFTER it installed read as new.
  6. **Log lines:** `diag.log` the arm / fire / off of anything that acts on its own.
  6a. **Scrollbars:** anything that can scroll (`overflow: auto/scroll`, a `max-height` panel)
     gets the `app-scroll` class, or it shows the grey OS bar. The bar is opt-in per element, so
     nothing catches a miss (the Sound panel shipped with the OS bar, 2026-09-16).
     `scrollbar-gutter: stable` is NOT automatic (his call, 2026-09-25): it leaves an empty
     8 px strip on a short list. Use it on a panel that is sized to hold the bar anyway; a
     list that nearly always scrolls goes without; where a jump is really seen, use the Room
     panel's grow-into-the-padding method (`.room__members[data-scrolls]` in styles.css).
  7. **Telemetry:** a panel that animates sets `dataset.frames` so frames.ts times it.
  8. **Check:** `npx tsc --noEmit` and `npx vite build`, then hand it over with the desk
     test written into the doc section.
  9. **Compass:** a new card, Settings row or verb is reachable from Ctrl+Space by the rules
     in COMPASS.md §9 (a card and a store-backed row are automatic; a panel exports an
     opener; a verb, a data kind or a command is one row in `src/compass.ts`).
  10. **Rules (2026-09-26):** does the feature decide *when* or *while* something happens (a
     time, a surface, an output, a genre, after an action)? Then that decision is a rule: the
     feature keeps its own module and behavior, registers its event / fact / action with the
     engine, and its row makes the rule. A value a rule may set is a rule key, read with
     `effective` or `ownSetting`. The recipe is RULES.md §19. Bring him the fork when the
     rule's order or its hand-change behavior (`onHand`) is a choice.
  11. **Right-click (2026-09-27):** a song, album, artist, playlist or station row gets its
     menu from the builder in `src/media-menu.ts` (CONTEXT-MENUS.md §7): pass the card's
     `own` and `away` rows, never list media rows by hand. A menu that is not media
     (a rule, a folder, a report) is a line in ONBOARDING.md §2.
  12. **Keyboard, picks, drags (2026-09-27):** a list of rows gets `wireListKeys`
     (`src/list-keys.ts`); a search field registers with `src/find-key.ts` for Ctrl+F;
     Ctrl / Shift picks are `src/row-pick.ts`; a row that drags or a card that takes a drop
     is `src/row-drag.ts` + `src/drop-actions.ts` (DRAG-DROP.md).
  13. **Popovers (2026-09-27):** three primitives, the place picks one. `makeDropdown`
     (`src/dropdown.ts`) for a panel on a trigger — the only one that follows *Open menus on
     hover*; `openContextMenuUnder` for choices under a button; `openContextMenu` for the
     right-click. Never a fourth. A panel that must overflow its card is portaled to `<body>`
     and still rides `makeDropdown` (the Settings menus, and the Library's Sort / View pop
     since 2026-09-27: `wirePops` in collection-card.ts is the reference for a panel whose
     trigger is re-rendered).
  14. **Card memory:** a card returns `snapshot()` and takes `opts.memory` back
     (CARD-MEMORY.md), so it comes back where the user left it.
- **Publishing (2026-09-21):** after `npm run release`, publish on your own ONLY when every
  change since the last release is low risk to the app's integrity (no hang, music plays).
  Otherwise stop and ask him for a hand test. The lists are RELEASE.md §0b.
- **Everything is token-based**: never hardcode a color, px, font, or motion value in a
  component — add/route through the palette → theme → skin tiers. Color → theme role;
  geometry/type/spacing/motion → skin token.
- He values polish and good stewardship (e.g. minimize Apple API calls; ask cost before
  committing to a fetch-heavy approach). He prefers the most user-friendly and user-empowering option.
- **Do NOT delegate to subagents (the `Agent` tool) for this codebase.** It's small
  enough to hold in context directly — explore, read, and edit files yourself so you
  keep the full picture while building. Only exception: if he explicitly asks for one.

## How to explain things to me
- Write in ASD-STE100 (Simplified Technical English): short sentences, active
  voice, one idea per sentence, plain approved words, no metaphor.
- Name the exact control or gesture ("the tray icon", "the pinned taskbar
  button"). Define the terms once, at the start.
- Test each option against the code BEFORE you show it to me. Discard the
  options that the code already rules out. Show the real forks only.
- A question about the UI needs the front-end state, not only the Rust. Check
  localStorage keys and the `surface`/`theme`/`skin` modules first.

## Run
```
npm install
npm run tauri dev     # compiles Rust (first run slow), opens the 480×864 window
npm run dev:app       # same, isolated from the INSTALLED app (own identifier/data dir)
npm run dev:perf      # dev:app with DevTools held shut (it renders in the app's own GPU process)
npm run dev:built     # release-shaped bundle + DevTools shut — the honest graphics measurement
npm run dev:app -- --second   # a second dev app (own identity + friend code) for rooms/friends tests
npm run dev:app -- --hidden   # no window (the app's --tray launch): drive it over CDP, nothing on screen
npm run bench appearance -- --passes 3   # repeatable switch benchmark; refuses to run on a noisy machine
npm run release       # build + sign the installer (→ installers/; see docs/ops/RELEASE.md §0)
npm run release:publish   # after testing the install: put it on the update channel
npx tsc --noEmit      # front-end typecheck
npm test              # the unit tests (tests/*.test.ts, Node's own runner)
npm run check         # tsc + tests + docs:check + cargo check + cargo test (the pre-push hook)
```
Devtools auto-open in dev (`src-tauri/src/lib.rs`).

## Conventions
- Front-end only ever sees the normalized model (`Track`/`Album`/…), never raw Apple
  shapes — normalization lives in Rust.
- **A synchronous `#[tauri::command]` runs on the UI thread.** Never let one reach blocking
  I/O: make it `async fn` + `tauri::async_runtime::spawn_blocking`. The release check (check 9)
  fails a build that does it; 0.12.0 froze on live this way (FRIENDS.md §8.11).
- **The workers** (`../DeetsMusicRooms`, `../DeetsMusicFriends`, `../DeetsSupport`) are plain
  JS with no build step, deployed with `npx wrangler` **4** — wrangler 3 drops the rate limit
  without a word. A deploy is always the owner's call. A rooms or friends deploy drops every live
  socket; DeetsSupport holds none (docs/ideas/WorkerDeploy.md, 2026-09-23).
- **A withdrawn version's notes never reach an update offer**, so the release that replaces
  it carries the whole line's notes in its own entry (RELEASE-NOTES.md).
- Commit only when the user asks. Co-author trailer — name the model that did the work
  (today `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); update this line when
  the model changes.

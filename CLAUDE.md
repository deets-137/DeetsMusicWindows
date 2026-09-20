# DeetsMusic — project guide for Claude

A lightweight Apple Music player for Windows 11 (Tauri v2 + WebView2, vanilla TS
front-end, Rust back-end).

## Start here
- **`docs/HANDOFF.md`** — cold-start: state of play, how to run, roadmap, gotchas.
- **`docs/LESSONS.md`** — what the owner tends to want: the mission, the three stop rules, the
  lessons with their evidence, and the tie-breakers. It shapes the option you RECOMMEND. It
  never closes a fork — he does (see Working style).
- `docs/UI-ARCHITECTURE.md` — front-end (token/theme/skin system, collection-card engine).
  `docs/TOKENS.md` — every token, generated (`npm run tokens`; the release check fails when
  stale). Regenerate it in the same commit as any change to palette.css / themes.css / skin.css.
- `docs/DATA-ARCHITECTURE.md` — auth, model, provider, SQLite cache.
- `docs/DESIGN.md` — product intent.
- `docs/TRAY.md` — tray icon/panel + minimize-to-tray; `docs/EXTENSION.md` — browser
  extension + the loopback bridge (`extension/` is the MV3 source); `docs/AGENT.md` —
  the agent/CLI routes on that bridge; `docs/RELEASE.md` — build, Authenticode signing,
  publish, the self-updater, install, uninstall (§0 = commands, secrets and keys on one page).
- `docs/TOASTS.md` — the transient-notice primitive (`src/toast.ts`), its tiers, and every
  call site; `__toast.demo()` in the console shows one of each kind. **§4a = the sticky queue**
  (designed 2026-09-19, not built, three forks open): past the cap of 3 a sticky toast is
  DESTROYED with its actions unrun, so §4's "a question always shows" and "an Undo always shows"
  can both break today — a queue is what makes them true.
- `docs/LOGGING.md` — the rolling log file + `diag.ts` (built 2026-09-11); the support
  back end that consumes it is `DeetsSolutions/docs/support.md`.
- `docs/LOOK-SCHEDULE.md` — the day/night look schedule (sun times from the time zone,
  set times, Windows mode) and its pre-paint in `index.html`.
- `docs/PROVIDERS.md` — Apple Music + Spotify at once, one merged library. **Parked
  2026-09-15**: Spotify's dev-mode terms block it (§9 has the checked facts). Kept as a record.
- `docs/VINYL.md` — Press "Record player": the cover as a turning record (`src/vinyl.ts`), the
  upright-start-and-end angle math, the slide on song change, the Apple artwork-rule reading.
- `docs/CARD-SWAP.md` — card swap motion: swap, summon and replace animate in each skin's own
  `--swap-*` shape (built 2026-09-15; Animate card swaps on by default since 2026-09-16).
- `docs/ARTIST-VIEW.md` — artist views: round hero, Featured / Your Playlists shelves, the
  Apple call table, the chip flight to another card, the `requestCard` no-swap fix (2026-09-15).
- `docs/HOME.md` — the Home card: the shelves, the context-run rule, the weekday/weekend
  bucket score, and Hide (built 2026-09-15). §9 = Apple's own recents, §10 = the **New**
  shelf: releases by your top ten artists, the bulk `artist_catalog` fill that rides the
  library sync, and the `homeApple` switch (built 2026-09-18, desk test PASSED 2026-09-19).
- `docs/AUDIO-QUALITY.md` — the sound chain from Apple's stream to the speaker, what we control,
  and `probe fidelity` (DeetsAirplay) that measures the capture's conversion (opened 2026-09-16).
- `docs/LASTFM.md` — Last.fm scrobbling: the key built in from Deets' Secrets, the browser
  connect under Account, `play_events.lastfm` as the queue, the error table, the desk test
  (built and desk-tested 2026-09-16).
- `docs/LOCAL-DATA.md` — the library read tool and read-only SQL for agents and users over an
  in-memory copy of five export tables; the WAL fix; the security layers and their tests
  (`cargo test --lib query`); the SQL card idea (built 2026-09-16, shipped in 0.8.0; desk test PASSED 2026-09-19, step 9 over MCP included).
- `docs/SOUND.md` — Advanced EQ + DeetsAdaptiveSound (match loudness, fuller at low volume,
  crossfeed) on one Web Audio graph; Apple DPLA §3.3.6.D "modify" clause is fork 0 (built 2026-09-16, shipped in 0.8.0;
  the user's report from daily listening, §11, comes before any new Sound work).
- `docs/PLAYLIST-WEB.md` — a playlist built from an artist and their collaborators (the
  Playlists web button): reach in degrees, genre chips, nearest-first cap, the Apple-call
  measurements (built and desk-tested 2026-09-16). §9: a song or album as the seed (built 2026-09-17, shipped in 0.9.0). §10: temporary web playlists, Keep · Temp | N days under Make playlist (built 2026-09-17, shipped in 0.9.0). The unused Apple data list for a later session: `docs/ideas/AppleData.md`.
- `docs/CREDITS.md` — writer credits: Apple's `composerName` (what it really returns, measured),
  the collection that rides every song read at zero extra calls (`song_credits`, `credits_stats`),
  and the **song pane** — right-click Song Credits, the hint's third line, clickable writers
  (§7, built 2026-09-17). §5 (the producer web) is designed, not built.
- `docs/DB-HEALTH.md` — is the database still writable: the poison-proof `Db::lock`, the
  10-minute canary, the failure counters and `db_health`, and why there is no write queue
  (built 2026-09-17).
- `docs/DeetsOTD.md` — Song of the Day: one song you mark for one day (`picks`, `pick_posts`),
  sent out through an **outlet** — build 1 has one, the Discord webhook, with its URL encrypted
  by DPAPI in `sotd-outlets.json`. Home's last shelf, Rewind › Picks, the suggestion from
  today's plays, the `/picks` agent route, and `scripts/import-sotd-journal.mjs` for the
  owner's own journal. The DeetsOTD repo stays untouched. **§10 = as built (BUILT 2026-09-18
  on `pins-for-days`; desk test §8.11 PASSED 2026-09-19).** Bluesky and Mastodon are build 2 (§8.4b, §8.14). **§9 = more than one Discord
  webhook** (paper design 2026-09-18, five forks open, not built).
- `docs/PINS.md` — Pins: a playlist, station, album, artist or song kept in view; a `pins` table,
  a Pinned tile shelf on the Library / Playlists / Radio roots (pin order) and Home's fifth shelf
  (by plays, all time), a corner tile badge (BUILT 2026-09-18 on branch `pins-for-days`, §7 = as
  built, desk test §6 PASSED 2026-09-19). **§8 = On Click**, what a click on a pinned tile does:
  a per-pin verb (Play · Shuffle · Open) on a right-click row, kept in a new `pins.act` column,
  over one shared resolver that replaces the four hand-written `onShelf` bodies; a Settings ›
  Playback row sets what a NEW pin starts with. Forks 1-7 decided 2026-09-19, §8.2a open,
  NOT BUILT.
- `docs/SUGGEST-LESS.md` — Suggest Less (Apple's −1 read from calls we already make + our own
  marks, sent back behind the ♥ consent), artist/album marks, proactive skips in queues and
  stations with a gain safety net; the web drops marked songs (designed 2026-09-17, not built).
- `docs/ONBOARDING.md` — how the app explains itself: the hover-hint ledger (every `title`),
  the right-click coverage table, Settings › Tips (built 2026-09-15), and the **first-run walk**
  led by the Deets and Happy sprites (§4.0 = as built, 2026-09-18: five steps, the gesture
  advances, the sprites travel, `onboardingStep` in settings; §5 = `npm run dev:fresh` /
  `dev:fresh:in`, how to be a first-time user without losing your data).
- `docs/FRIENDS.md` — **Friends**: a friend code that stands for one person forever, presence
  ("what they play now"), and the tie back into Rooms; plus **broadcasting what you play to
  Discord** (Rich Presence, and one channel message edited in place on the Song of the Day
  webhook code). §1 = why this is a layer UNDER Rooms, not an extension of it (there is no
  client identity in the app today); §5 = the free-tier budget and the seven app-side rules
  that keep it there; §5.2 = the "busy, and your music is not affected" toast (it fixes Rooms'
  raw 429 too); §13 = what the app asks of our workers today (~5 requests/install/day, nearly
  all of it the 6-hour update check); §14 = what one room costs (~20 requests, ~450 row writes);
  §15 = reuse the rooms worker or make a new one — **cost is identical, the free tier meters per
  ACCOUNT**, so fork 10 closed on deploy blast radius: **a new `deetsmusic-friends` worker** (paper
  design 2026-09-19; D1 no heartbeat, D2 a friend row opens a room, D3 the toast, D4 a new worker
  are decided; nine forks open; not built). **§8.6 = Discord OAuth, asked and closed (D5, 2026-09-19)**:
  no scope sets presence, Spotify's card is a first-party Connection with no public route, and the
  Social SDK writes the same activity a named pipe writes; §8.6.1 reads the webhook path out of
  `sotd/` — it posts straight from Rust, no worker. **§8.7 = the Rich Presence card (D6/D7/D8)**:
  two buttons plus clickable `details_url`, *Listen Along* → `rooms.deets.solutions/j/<CODE>`, which
  always serves one landing page (Open · Get) and rides the §18.7 deploy. §8.5 = Sharing › Discord and
  its four keys. Buttons are invisible to the account that sets them, so 7A needs a two-account desk
  test (§8.4 item 3). §8.5 = Settings: a top-level **Sharing** (two adjacent *Share activity on …*
  rows + a pause that covers both) and a top-level **Discord**, into which the Song of the Day webhook
  Connect row **moves** (SotD keeps its pick rows and gains a linked status line). **D14 (2026-09-19) = Rich Presence ONLY; a
  now-playing channel post is REJECTED as spam (forks 8 and 9 fall with it, and the doc's earlier
  "7C" was an inference, now corrected). D15 = the profile clears a minute after pause, at once on
  quit; §8.9 is the full lifecycle table. **§8.8 = the build gate: every fork is closed; the only
  step left before code is the three §8.4 measurements, which need Windows + the Discord desktop
  client and cannot be run from a Mac session.** Build order after D14 is 6 → 7 → 1 → 2 → 4 → 5:
  Rich Presence needs no friend code, no worker and no network. §2b = where a later
  DeetsAccounts link would land (identity is **1C** + **1a-A**, decided 2026-09-19: the minted key is
  permanent, the account link is additive, `../DeetsAccounts`'s schema already expects an
  `identities` table).
- `docs/ROOMS.md` — **DeetsMusicRooms** (listening rooms): a title bar item, an 8-character code,
  guest controls, follower mode. The worker is **its own private repo**, `../DeetsMusicRooms`
  (plain JS, no build step, `npx wrangler` — the house shape DeetsAccounts and DeetsSupport use;
  **wrangler 4**, or the rate limit is silently dropped), and its Durable Object keeps the room
  clock (designed 2026-09-16, BUILT 2026-09-17 — §16 is as built). **§17 = the first two-app
  desk test (2026-09-18)**: the host seeded an empty room and a room `play` never reached a
  held follower, both app-side and both fixed; the title bar count badge removed; the stage
  figures matched to the glyph; the panel's scrollbar gutter now opens only when it really
  scrolls. Desk test §17.4 PASSED 2026-09-19. **§17.9 = the host's own room played nothing (2026-09-18)**: the seed auto-started the room so Play was really Pause, `roomResumeAt` returned in silence on a null `nowPlayingItem`, and `roomShow` rebuilt a song MusicKit already held. All three fixed, worker deployed, shipped in 0.11.1; **desk test §17.10 PASSED**. §17.10 also records that a worker deploy drops every live room socket. **§18 = four race conditions, read 2026-09-19, NONE FIXED** (the worker side is clean): a re-feed that can start your own queue after you leave, a Pause during the lead that plays a blip first, a stale socket that can still apply state, and `epoch` — incremented by the worker, never compared. §18.6 has the recommendation and the one open fork. **§18.1-18.4 BUILT 2026-09-19** (§18.7 = as
  built: the room guard on the re-feed, the lead re-read, the superseded-socket guard, `epoch`
  deleted app-side; a fifth bug fell out of 18.3 — a superseded close nulled the LIVE socket.
  **Desk test §18.7 PASSED 2026-09-19 — Rooms now has NO open desk test.** The worker's two `epoch` lines wait for the next real deploy).
  **§20 = a room that writes no SQLite rows** (designed 2026-09-19, NOT BUILT): live state moves from
  `storage.put` into the host's socket attachment (16 KB, free, verified) and the per-song alarm
  becomes arithmetic both sides compute; ~450 rows per room → ~0. The host is the RECOVERY copy, never
  the live authority (that is the two-hop shape §4 rejected). Build it in Friends first; leave the
  shipped Rooms alone until §17.4 and §18.7 close.
  **§19 = telling people a worker redeploy happened** (designed 2026-09-19, A+B+C all wanted,
  NOT BUILT): a deploy cannot apologise on its way out, so A is an app-side toast pair, B names
  the cause from a build stamp, C warns first and needs a live-room directory + two deploys. The deets.solutions site is **out
  of scope** (§13); DeetsRadio in that doc means only the older website feature it borrows from.
  Apple terms read in §12: no clause names group listening, and §12.3 is decided (a guest's Pause
  never greys out).
- `docs/MCP-INSTALL.md` — connect AI apps: a shared `mcp_install` crate behind `deetsmusic mcp
  install` and a Settings panel; client detection, config table, the Claude Desktop MSIX path trap
  (designed 2026-09-16, forks open, not built).
- `docs/PLAYLIST-REFRESH.md` — **how often a mirrored Apple playlist re-reads its songs**:
  today the answer is ONCE, EVER (the sync evicts only on an attribute change, and Apple rewrites
  New Music Mix without changing one — §0 is the bug, ⟳ is the only fix today). A *Refresh ▸
  Daily · Weekly ▸ (day) · Off* submenu per playlist, defaults by `kind`, two triggers (on open +
  a day change while the app runs), one toast, one global switch. §1 = telling Apple's playlists
  from the user's, with the signals we already have (paper design 2026-09-19, **every fork closed** —
  ten decisions in §3, the last three settled in §9 — NOT BUILT; §5.1 is the one piece of Rust it needs).
- `docs/MOVABLE-ROWS.md` — **movable rows**: drag a section (Home shelves, Playlists folders,
  Radio sections, Settings sections) into the order you want, plus the **Settings search bar**
  (it reads the Compass's own `settingsRows()` index). §2 = the one hard problem (an order over a
  computed list); §0a = **the SCOPE, decided 2026-09-19** (sections everywhere; items only for
  pinned tiles and playlist rows — radio and Home's other tiles are out); §11 = the fork sheet,
  three closed and ten open, recommendations named. Pinned tiles need a sideways drag axis and a
  `rank` column on `pins`, so they are their OWN hand-over, never beside `playlist_refresh`
  (paper design 2026-09-19/20, NOT BUILT).
- `docs/COMPASS-TERMS.md` — the user-guide list of every place, verb, command and synonym the bar
  answers to; update it with `SYNONYMS` in compass.ts.
- `docs/COMPASS.md` — Ctrl+Space: a bar under the title bar that reaches every card, setting (store rows
  inline), transport verb and library item; Space for play / pause; the keyboard pass's first slice
  (built 2026-09-17, desk test PASSED 2026-09-19). §2d = the
  calculator: type a sum, the first row answers it and Enter copies (built 2026-09-18, desk
  test §7.10a PASSED 2026-09-19).
- `docs/SECOND-SEARCH.md` — a second Search card to compare two albums side by side: the first
  card is the drill target, the second is one you place yourself; what enforces one instance
  today and the work per file (designed 2026-09-17, not built).
- `docs/STAGE-COLUMN.md` — the Max stage column: the cover locked to a square (no measured
  constant — `100cqw` + a size-container split), the Queue's floor of "the song that plays now
  + 2.5 rows" as token arithmetic (`--max-queue-min`), the new 1100×950 default, and the Queue's
  one upward grow over Now Playing (built 2026-09-17, desk test §8 PASSED 2026-09-19).
- `docs/CARD-MEMORY.md` — a card comes back where you left it after a remount (summon, pick,
  Midi↔Max, the grow drill swap): keys + resolvers per card, the snapshot, a row to keep it on
  restart, and memory-only caches of Search's catalog panes and terms (built 2026-09-17, desk test PASSED 2026-09-19).
- `docs/CARD-GROW.md` — grow a card over its neighbor (Grow) or over all four in Max (Fill) from
  the gaps; clip-opening motion, Collapse/Pin/outside click, covered-card rules (§14: a drill from a grown card swaps the target in, Back returns; built 2026-09-17, desk test PASSED 2026-09-19), and wide-card
  layout ideas per card. Reviewed the same day: Grow button in the header, MVP = Library letter rail + song columns (§9a), no memory, resting 4-card layout stays pixel-identical (§0); the other big panels are hand-designed after the MVP (forks 1–10 decided; BUILT 2026-09-16, §13 = as built, shipped in 0.9.0).

## How to verify your work
- **The user runs the app and tests your changes** (`npm run tauri dev`) and gives
  feedback. **Do NOT build throwaway test harnesses, mock pages, or one-off tooling to
  verify UI behavior** — it wastes time/tokens. Make the change, sanity-check it
  compiles, then hand it to the user to try.
- Cheap checks that ARE worth running (not harnesses): `npx tsc --noEmit` and
  `npx vite build` to catch type/compile/bundle errors before handing off.
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
  click can't be reached). Full reference: `docs/DEBUGGING.md`. This is dev-only
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
     ledger. New row shapes go in its SHAPES table.
  4. **Toasts:** every new `toast()` call is a row in TOASTS.md §5.
  5. **Settings keys:** a new key in `settings-store.ts` gets a default with the "why", a
     spec in `agent-settings.ts` (so the agent reaches it) and a line in AGENT.md.
  6. **Log lines:** `diag.log` the arm / fire / off of anything that acts on its own.
  6a. **Scrollbars:** anything that can scroll (`overflow: auto/scroll`, a `max-height` panel)
     gets the `app-scroll` class, or it shows the grey OS bar, and `scrollbar-gutter: stable` so its
     content does not shift when the bar appears. The bar is opt-in per element, so
     nothing catches a miss (the Sound panel shipped with the OS bar, 2026-09-16).
  7. **Telemetry:** a panel that animates sets `dataset.frames` so frames.ts times it.
  8. **Check:** `npx tsc --noEmit` and `npx vite build`, then hand it over with the desk
     test written into the doc section.
  9. **Compass:** a new card, Settings row or verb is reachable from Ctrl+Space by the rules
     in COMPASS.md §9 (a card and a store-backed row are automatic; a panel exports an
     opener; a verb, a data kind or a command is one row in `src/compass.ts`).
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
npm run bench appearance -- --passes 3   # repeatable switch benchmark; refuses to run on a noisy machine
npm run release       # build + sign the installer (→ installers/; see docs/RELEASE.md §0)
npm run release:publish   # after testing the install: put it on the update channel
npx tsc --noEmit      # front-end typecheck
```
Devtools auto-open in dev (`src-tauri/src/lib.rs`).

## Conventions
- Front-end only ever sees the normalized model (`Track`/`Album`/…), never raw Apple
  shapes — normalization lives in Rust.
- Commit only when the user asks. Co-author trailer — name the model that did the work
  (today `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`); update this line when
  the model changes.

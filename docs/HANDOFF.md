---
status: sop
desk_test: none
sources: [src/toast.ts, src/player.ts, scripts/sign.mjs, src/perf.ts, src/room.ts, src/dropdown.ts]
updated: 2026-09-25
---
# DeetsMusic — Handoff

> Cold-start guide — read first. A lightweight Apple Music player for Windows 11:
> **Tauri v2 + WebView2**, vanilla **TypeScript** front-end, **Rust** back-end.
>
> **This file holds what is still true:** how to run and ship the app, what is open now, the
> state of play, the gotchas, the key decisions and the file map. It is corrected in place.
> **The record of each sitting** — what was built, the desk-test scripts, what was decided —
> is [WORKLOG.md](WORKLOG.md), newest first. Split on 2026-09-21 (DOCS-ORG.md §7).

**The docs, by folder** (`CLAUDE.md` › Docs lists every one in a line): `architecture/` the
engine · `cards/` card behavior · `features/` one surface or feature · `integrations/`
anything that talks outside the app · `ops/` build, ship, diagnose · `ideas/` not built ·
`guide/` the user guide (DOCS-ORG.md §13). Each doc's state is its front matter;
`npm run docs:check` proves the links, the section pointers and the versions.

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
[DEBUGGING.md](ops/DEBUGGING.md).

**Dev telemetry + driving the app from a session (2026-09-12).** In dev every song click
(and Next) prints `[perf] click→sound N ms · model+render · setQueue · stream` to the
console and writes the same line, plus MusicKit's own request list, to the dev log
(`%APPDATA%\com.deetsmusic.dev\deetsmusic.log`). The `deetsmusic` MCP drives playback
(`play` returns after the song starts), so a session can run a play, tail the log, and
read the stage split without the devtools — that is how the click-to-sound pass was
measured and verified (cold vs warm, natural advance via `control seek 97`, dead ids,
the queue restore via a restart). Recipe and limits: [DEBUGGING.md](ops/DEBUGGING.md)
"Driving it from outside" and `CLAUDE.md` "How to verify your work". None of it ships:
`src/perf.ts` is gated on Vite's `DEV` flag.

## Ship it (installable Windows app)

Full procedure — version sync, the build stages, Authenticode signing (§6.9), the NSIS hooks,
install, uninstall, publishing and the updater (§6, shipped in 0.4.3) — is in
**[RELEASE.md](ops/RELEASE.md)**; §0 is the one-page overview of commands, secrets and keys. The
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
- **The version lives in SEVEN files** — the list is [RELEASE.md §1](ops/RELEASE.md).
  `release-check` compares four of them (`package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `cli/Cargo.toml`) and fails *after* the bundle is built and signed.
  Nothing checks the other three (`extension/manifest.json` and both `Cargo.lock` files), so
  bump them by hand in the same commit.
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

## Open now

The short list of what is not finished, as of 2026-09-24. Each item names where the detail is.
When an item closes, delete it here and write the day in WORKLOG.md.

**Next (his word, 2026-09-24):** the telemetry pass (below), after the two desk tests below.
The 429 toast for a user call is decided (APPLE-CALLS.md §3); bring him the words and tier.

**Desk tests open (branch `darn-critics`)**
- **Cover Wallpaper** (built and committed 2026-09-24, `5650dd3`) — COVER-WALLPAPER.md §6. He
  looked at it and kept both layouts (the mosaic is the default; One cover stays in Tiles). Still
  open: the locked dim value (step 8) and his review of the "As built" decisions.
- **Diary: Done copies the Export** (built and committed 2026-09-24) — DIARY.md §8 step 11f.
- The Diary card, schema v14 — DIARY.md §8 passed 2026-09-24 except 11e (CLI / MCP), which
  runs on the installed beta after the next beta release.

**The consistency pass (2026-09-25)** — committed on branch `clode-eval`, desk test passed
2026-09-25, not yet merged to `main` and not in a release. It holds: the destructive-action
rule (TOASTS.md §6), `lock_or_recover` (src-tauri/src/lock.rs), empty states with a period,
**the database thread** (DB-HEALTH.md §2a; 73 commands, check 9 now hard), the scrollbar
gutter left as is (CLAUDE.md checklist 6a), and **unit tests on Node's own runner**
(`npm test`, `npm run check`, the pre-push hook).
- Kept by his call (2026-09-25): every `console.error` writes an ERROR line to the log file,
  a failure the app already handles included (an Apple 401 on one playlist refresh).
- Later, not decided: tests for `media-menu.ts` need a stub map in `tests/setup.mjs` (it
  loads the player and MusicKit); a release-check row for `extension/manifest.json`'s
  version (0.11.0 shipped with it stale).

**Designed, not built (2026-09-24)**
- The telemetry pass: Apple call counter + 429 back-off (APPLE-CALLS.md), the `songEnd` /
  `player:stall` pause fixes (DEBUGGING.md §Why did it pause), AirPlay stall and switch timing
  (AIRPLAY.md §13.2).
- Web demo: the album light more prominent — his ask, 2026-09-24; forks first (WEB-DEMO.md §10).

**Waiting on him**
- **Sound: keep it at all?** The desk test passed 2026-09-24; he is weighing keep, keep some, or
  remove (SOUND.md §11). No Sound work before his call.
- AirPlay after the PC sleeps: shows connected when it is not? Desk test first — AIRPLAY.md §13.3.
  A lead (WORKLOG.md 2026-09-25, later): after the 2026-09-24 17:00 wake, every send failed
  with os error 10054 for two minutes until a new connect at 17:06:40. Ask him whether that
  connect was his. The watchdog's `ui: the PC was asleep` line now marks the wake.

**Releases and branches**
- 0.12.0 and 0.12.1 are withdrawn. The first public release
  was 0.4.3; nothing before it shipped. Every release is in the log at RELEASE.md §0a.
- **Published: 0.14.1** (2026-09-24, `e2d8e3d`; beta `0.14.1-beta.1` first): the installer
  fix. The 0.14.0 update aborted when an AI app's DeetsMusic CLI held `cli\deetsmusic.exe`:
  the 32-bit installer's PowerShell read every process path as empty (RELEASE.md §4a).
  **Seen end to end 2026-09-24:** his PC updated 0.14.0 → 0.14.1 over five running MCP CLIs
  with no abort ("Update installed fine").
- **Published: 0.14.0** (2026-09-23, `62d516a`, then `oceanic-schmoves` fast-forwarded into
  `main`): one right-click menu per media type, Start a Web, the Ocean heavy swell and album
  light, tray Pin / Start Station. The first release that went beta first:
  **0.14.0-beta.2** on `deetsmusic-test` the same day. His word: "Desk tests all look good";
  the §0b hand test of the installed build was skipped by his call.
- **Published: 0.13.1** (2026-09-22, from `main`, `d86bf00`): Web in the title bar,
  `player:pause` names who paused, the web demo. The §0b hand test was skipped by his call.
- **Published: 0.13.0** (2026-09-21, from `main` = `dockin`): the quick panel, the New badges
  (the title bar cog too, QUICK-SETTINGS.md §11), the search-term right-click, the docs re-org.
  He tested in dev; desk tests §10.1 and §11.1 were not run as scripts.

- **DeetsMusic Beta** (2026-09-23, in `main` since 0.14.0) — a second installed app on
  `deetsmusic-test`; every release goes beta first. **0.14.1-beta.1 is published there.** The
  two spike rows were withdrawn 2026-09-24 (BETA.md §4.3). The DeetsSupport change (sign-in scheme + version order, BETA.md §5) is written, uncommitted in
  `../DeetsSupport`, and HELD by his call.
- **Add a room member as a friend** — his ask, 2026-09-23. Designed, forks decided (F1A–F5A:
  offer on press, ask toast, mint on Add, silent Not now, no setting), not built: FRIENDS.md §18.
  Needs a rooms-worker deploy (the item below).
- **Deploy a worker without dropping connections** — his ask, 2026-09-23. Open, not researched:
  ideas/WorkerDeploy.md. First step is to measure what a rooms deploy really does.

**Desk tests not run**
- **Ocean perf check** — the right-click menus, the heavy swell, the album light and the beta
  passed his desk test on 2026-09-23 ("Desk tests all look good") and shipped in 0.14.0. Still
  open: **the perf check** in OCEAN.md §6 (the album light at 0 and at 100, with music, on
  `dev:built`, with and without the GPU). The first read on `dev:app` showed about the same
  weight as before.
- **Discord's two buttons** (*Play on Apple Music*, *Listen Along*) are proven sent, not proven
  readable: they are invisible to the account that sets them, so reading them needs a second
  Discord account (FRIENDS.md §8.4, item 3).

**Designed, not built** (front matter `designed` or `project`, or a part marker)
- SUGGEST-LESS.md · SECOND-SEARCH.md · MCP-INSTALL.md (forks open) · ROOMS.md §19 (redeploy
  notices) and §20 (a room with no SQLite rows) · DeetsOTD.md §9 (more webhooks) ·
  CREDITS.md §5 (the producer web).
- DOCS-ORG.md steps 6–8 (the sweep skill, release-note grouping, the user guide) and its open
  forks: F6, R1–R4, U10, T1–T4, X1–X4.

**Before a public announcement** (RELEASE.md §7): screenshots (none exist), a GitHub Release
with the installer, and the user guide (DOCS-ORG.md §13).

**Keyboard** (COMPASS.md): hover-only controls (the Search Add-to-Library square) show only on
`:focus-visible`; the Sort / View popovers take no arrow keys.

**The 2026-09-17 health check** ran; what it found and its open leads are DEBUGGING.md
"What the 2026-09-17 health check found".

---


## State of play

**Live: 0.14.1** (2026-09-24, `deetsmusic` channel; beta `0.14.1-beta.1` on `deetsmusic-test`). Every release is in the log at
[RELEASE.md §0a](ops/RELEASE.md); what each version added is in
[RELEASE-NOTES.md](ops/RELEASE-NOTES.md); the newest work is at the top of
[WORKLOG.md](WORKLOG.md). The list below is the long-lived foundation plus dated entries. The
releases from 0.6.2 to 0.9.0, in short:
- **0.9.0** — card grow (Grow / Fill, [CARD-GROW.md](cards/CARD-GROW.md)), song and album web seeds and
  temporary web playlists ([PLAYLIST-WEB.md](features/PLAYLIST-WEB.md) §9–§10), the Add to Library square
  on song rows, Retro-Future renamed Cyber, Last.fm `LINK_BACK = false`.
- **0.8.0** — Sound (EQ + DeetsAdaptiveSound, [SOUND.md](features/SOUND.md)), Last.fm scrobbling
  ([LASTFM.md](integrations/LASTFM.md)), the playlist web, Stream quality, Fancy Glass and composited card
  lists, library reads and read-only SQL for AI apps ([LOCAL-DATA.md](integrations/LOCAL-DATA.md)), the
  AirPlay capture's sinc resampler (crate `rev` 4989dfb).
- **0.7.0** — the sleep timer, the volume pill that grows in place, fancy scrubbers, the
  hover-hint pass, the graphics ruler (NEXT-VERSION §17, §20, §21).
- **0.6.3** — multi-select rows everywhere (NEXT-VERSION §19). A picked set of playlists also
  **deletes** (the local ones, PLAYLISTS.md §10.3; 2026-09-17).
- **0.6.2** — per-view open sizes (FUTURE-SETTINGS §8a), the AirPlay speaker claim on crate 0.3.0
  (AIRPLAY.md §11 — one-directional: we write claims, we do not read them).

### Built ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights wired to min/max/close.
- **Themes** (palette → theme → skin, all CSS-variable driven): `lilac`, `green`, `sepia`,
  `moonlight`, `black-yellow`, `black-red`. Title menu (click the title) with Theme / Skin /
  Surface flyouts, a **Settings…** row (summons the Settings card, [SETTINGS.md](architecture/SETTINGS.md)),
  and the Account row. A first launch with
  no saved choice follows the OS light/dark preference, landing on Press × Lilac or
  Cyber × Black & Red; retired ids (`fairy`/`glade`/`hornet`/`viper`/`desk`/`cyberstorm`/`retro-future`)
  migrate via the `RETIRED` maps in `theme.ts` / `skin.ts` and the pre-paint script in
  `index.html` — keep all three in sync.
- **Skins**: `vanilla` (borderless + editorial underline; hidden from the picker since
  2026-09-10, block kept as the base), `press` (riso print shop —
  square trim, halftone stock, offset `--ink-2` plate), `ocean` (recessed cards + SVG wave
  trains), `glass` (frosted, drifting aurora), `cyber` (lightning storm layer).
  Shared `[data-skin]` base + per-skin deltas; nav/motion/geometry fully tokenized (new
  capabilities like `--hover-lift` / `--panel-backdrop` default to no-ops).
- **Card + slot system** (`cards.ts`, `layout.ts`; [SURFACES-AND-CARDS.md](architecture/SURFACES-AND-CARDS.md)):
  every card is a mountable registry module. Midi bento = anchored **Now Playing** + **two
  swappable content slots**, each slot's **title is a card picker** (persisted, root-only).
  **Surface seam** (`data-surface` mini/midi/max) exists with size-band resize + per-surface
  remembered sizes; mini/max inherit the midi layout until composed.
- **Apple auth**: loopback browser sign-in (themed page), MUT persisted across restarts.
- **Playback** (the load-bearing DRM risk is dead — full-song plays in WebView2): `player.ts`
  configures MusicKit JS in the webview, injects the captured MUT directly (no `authorize()`
  popup), plays. Live drag-to-seek scrubber + volume (shared `slider.ts`, persisted). Catalog→
  library id fallback; **dead-id self-healing** (stale catalog ids don't sink a feed batch).
- **Queue model** (`queue.ts`, [QUEUE.md](features/QUEUE.md)): history / current / upcoming of lightweight
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
  - **Search** ([SEARCH.md](features/SEARCH.md)) — standalone sectioned discovery (songs/albums/artists/
    playlists), enrichment piggyback, transient + materialized catalog tracks.
  - **Playlists** ([PLAYLISTS.md](features/PLAYLISTS.md)) — Apple mirror + local store; overview → detail;
    New Playlist, Add to Playlist ▸ submenu, remove-track, empty-only delete. **Folders**
    (2026-07-03, §3a): manual folders + kind auto-clusters (Your Playlists / Apple Mixes /
    Saved from Apple Music) as collapsible sections under the Folders sort; Move to Folder ▸ files
    locals AND mirrors (local metadata, zero Apple calls). Rename, drag-reorder,
    delete with songs, mosaic covers and export / import all built 2026-09-14 (PLAYLISTS.md §10).
  - **Queue** (`qcard.ts`) + **History** (`history-card.ts`) — Now Playing + Up Next / session
    play log; shared row markup (`queue-rows.ts`).
  - **Rewind** ([DEETS-REWIND.md](features/DEETS-REWIND.md)) — listening leaderboard (stat × time-window)
    over the play-event log.
  - **Radio** ([STATIONS.md](features/STATIONS.md)) — Apple's live / My Station / Discovery / genre
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
- **Album Color** ([ALBUM-COLOR.md](features/ALBUM-COLOR.md)): real Apple palettes → `--album-*` runtime
  roles → the rotating Now-Playing aurora (Glass-only display).
- **Add to Library** ([FAVORITES.md](features/FAVORITES.md)): ➕ add a catalog song/album to iCloud Music
  Library, gated behind the **Library Add** settings toggle (default on since 2026-09-10), on Search / Playlists /
  **Queue / History** right-click menus (incl. the now-playing hero). Apple's API is add-only.
- **Go to Artist / Go to Album** (2026-07-06, [SEARCH.md](features/SEARCH.md)): drill-in right-click verbs on
  **every** song/album surface (Search, Library, Playlists, Rewind, Queue, History, Now Playing —
  NP gained its first menu). Shared builders in `src/go-to.ts`; the id hop is `catalog_related` in
  `apple.rs` (session-cached via `catalogRelated`). Most surfaces route to the **catalog** detail in
  the Search card; the **Library drills IN-PLACE** over the user's library (`LibNav` in
  `library-card.ts`). In-place vs Search is a toggle: FUTURE-SETTINGS §20.

- **2026-09-15 — one hover-hint box** ([ONBOARDING.md](features/ONBOARDING.md) §1a): `src/hint.ts`
  replaced the native `title` tooltip everywhere — a themed box in the menu material, with a
  second line, so a cut-off song row shows the full song AND artist. **Central by adoption:**
  no call site changed. The engine sweeps every `title` into `data-hint`, removes the
  attribute, and a MutationObserver keeps doing it for new nodes and later `title` writes, so
  all 81 hint sites (68 in markup, 13 set from code) moved in one step. Row hints come from a
  shape table (`SHAPES`), one delegated handler covering Library, Search, Queue, Rewind,
  History, Home, the Artist shelves and Now Playing. Three Settings rows: Show hover hints,
  Hints appear after, Name songs on hover. Shipped in 0.7.0 (2026-09-16).
- **2026-09-15 — Press record player** ([VINYL.md](features/VINYL.md)): Record player Spin / Still / Off
  (default Off), Show record on, Spin speed (33⅓ / 45 / 78, default 33⅓), Show record plate. The
  cover (Now Playing + tray panel) turns at the chosen rate, locked to the song so each disc starts
  and ends upright at any speed; song changes slide the discs.
  Four desk-test rounds, each fault found with the new dev telemetry (`[perf] vinyl show / snap /
  song`, `__vinyl.sample`) and a computed-transform angle trace (VINYL.md §8–§9). Open: the frame
  cost of a full-rate spin (its own optimization session); Apple artwork-rule reading in §10.
  Committed db65b5c, shipped.
- **2026-09-15 — skin-only settings** ([UI-ARCHITECTURE.md](architecture/UI-ARCHITECTURE.md) §3 *Skin-only
  settings*, [SETTINGS.md](architecture/SETTINGS.md) §3): Look and feel rows that show only under their
  skin (`when` + `onSkinChange`), a new **range** (slider) row kind, and `src/skin-settings.ts`.
  **Glass** (user: "perfect"): Canvas glow · Dim canvas · Backlight · Tint cards. **Ocean**: Draw
  card edges Soft / Sand (grainy card edges, off by default) + Sand width. Committed
  c978fc6, shipped in 0.5.0.
- **2026-09-14/15 — self-update + signed releases** ([RELEASE.md](ops/RELEASE.md) §0, §6, §6.9):
  `tauri-plugin-updater` behind the DeetsSupport Worker + R2 (`deetsmusic` and `deetsmusic-test`
  channels; Settings › Updates Automatic / Ask / Off, Skip, Roll back within a channel group,
  `minVersion` for a required update); shipped in 0.4.3. Every build is signed twice: the
  updater `.sig` (minisign key) and Authenticode via Azure Artifact Signing (`scripts/sign.mjs`).
  Tested end to end with a signed t1 → t2 update on the test channel.
- **2026-09-13 — toasts** ([TOASTS.md](architecture/TOASTS.md)): the primitive, the `toasts` tier
  setting, and the ten call sites above. Desk-tested and shipped; every later call site is a row in TOASTS.md §5.
- **2026-09-12 — the NEXT-VERSION batch, all desk-verified** ([NEXT-VERSION.md](NEXT-VERSION.md)):
  search pins · playlist covers (user / Apple / mosaic; schema v3 `cover`) · ♥ favorites
  (`favorites.rs` + `favorites.ts`, seeded from Apple's Favorite Songs; the Library ♥
  filter) · weekly Replay (`replay.ts`, three Playback rows) · Search square + Ctrl
  shortcuts · theme/skin View Transitions (`appearance.ts`) · album-colored NP text with
  the contrast guard (Glass) · Glass menus at 90% · explicit badge. Surface-change motion
  (fork B) was tried and walked back the same day (NEXT-VERSION §10). **Next talk: the
  playlist creation flow** (NEXT-VERSION §11).

- **2026-09-17 — the Max stage column** ([STAGE-COLUMN.md](cards/STAGE-COLUMN.md)). The album cover is
  locked to a square and is never cropped (`100cqw` on the cover inside an inline-size `.np`, so
  there is no measured constant); **Now Playing is locked** to its full-width square plus its
  rows and the **Queue absorbs every other pixel** — the owner's rule after stress-testing:
  the art and the now-playing information are what the surface is for, and the queue is
  something a user opens when they want it. A new `.stage` wrapper gives column 1 its own two
  rows (`display: contents` outside Max, so midi / mini / NP render exactly as before), and the
  **Queue grows up over Now Playing** from a zone on its top edge (CARD-GROW.md §16). The
  auto-flip now reads the window's **height** as well as its width: under 745 px a Max window
  becomes Midi, or stops at its 750 px floor — `Settings › Window › "Max window when short"`.
  Default Max size 1100 × 950, sized from Press (the tallest skin) against a 1920 × 1080 work
  area. Desk-tested live on all five skins. **Open:** Press at the floor keeps 101 px of Queue,
  not the 106 the other skins get — move the band to 755 if that reads short.

### Not built yet ⬜
- **Two services, one library (2026-09-15) — PARKED.** Designed in the morning
  (**[PROVIDERS.md](integrations/PROVIDERS.md)**), stopped the same day after the Spotify facts were checked
  (its §9): the owner needs Premium, the ISRC is gone so there is no merge key, search is capped
  at 10, and Developer Policy III.5 forbids mixing another service's content. Reopen only if
  Spotify's dev-mode terms change.
- **Real album/artist data + artist photos in the Library card** — Library's Albums/Artists are
  derived from song artwork + initials (Search's artist drill already shows real photos). Scoped
  2026-07-03: **bigger than it looks** — the Artists overview shows hundreds at once, so lazy
  per-touch enrichment can't fill it (needs an eager one-time backfill, a deliberate exception
  to the enrichment doctrine with a §14-style opt-out) *and* it needs new schema (artist cache
  table), so it should bundle with the deferred schema-versioning work as one post-v1 pass.
  (Start Station on artist tiles does NOT wait for this — shipped via the lazy two-hop resolve.)
- **Play on launch** ([FUTURE-SETTINGS.md §22](FUTURE-SETTINGS.md)) — documented, not built.
- **Off the roadmap:** ratings / 👎 (the ♥ favorites shipped instead, 2026-09-12).
- **The agent's "Later" list** ([AGENT.md §7](integrations/AGENT.md)): the installer PATH entry,
  connect AI apps ([MCP-INSTALL.md](integrations/MCP-INSTALL.md), forks open), `artist:` ids for
  `play`, durable history as a second history source, a small-model test of `mcp --small`.
- **Designed, not built:** Suggest Less ([SUGGEST-LESS.md](features/SUGGEST-LESS.md)), a second
  Search card ([SECOND-SEARCH.md](features/SECOND-SEARCH.md)). Ideas with no schedule:
  [ideas/](ideas/README.md).
- Built since this list was written, so no longer here (2026-09-22 sweep): playlist refresh and
  movable rows (0.12.2), the sticky toast queue (TOASTS.md §4a), the keyboard pass with Space
  (COMPASS.md §5), listening rooms (0.10.0), Friends (0.12.2), the AirPlay speaker-only send and
  claim guard (AIRPLAY.md §11–§12, desk test passed 2026-09-19), the first-run walk
  (`src/walk.ts`), the web demo; earlier: the hosted sign-in page + deep link, the CLI / agent
  control, the mini and max compositions, library windowing, playlist rename / drag-reorder /
  export, and the rest of the listening loop.

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

**Graphics pass 2026-09-16 — PAUSED** (the user moved other work ahead of it). Committed
b59e575, shipped in 0.8.0; the checks below are still open:
- ✅ **Fancy Glass** (Settings › Look and feel, Glass only, default off): the painted frost with a
  still aurora and locked sliders 65 / 85 / 40 / 10, or the live blur and the sliders. Shipped
  in 0.8.0; no desk-test result is on record. SETTINGS.md row; numbers in DEBUGGING.md §Fancy
  Glass and the Ocean swell.
- 🟨 **Composited card lists** (`--scroller-layer`, Ocean / Glass / Cyber only): shipped in
  0.8.0, half checked. What is done and what is left: DEBUGGING.md §The composited-scroller pass.
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
  callback is `tray::show_main`. See [TRAY.md](features/TRAY.md) §5 — including why two DeetsMusic
  taskbar icons in dev are expected, and why a debug build flashes a console.
- **A running `deetsmusic mcp` blocks install and uninstall** — Windows won't replace or
  delete an open file, and the CLI is long-lived (an MCP session lasts as long as the agent).
  Uninstalling 0.1.2 removed the registry entry and then left every file on disk. The NSIS
  `PREINSTALL`/`PREUNINSTALL` hooks stop it by path; see [RELEASE.md](ops/RELEASE.md) §3.
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
  `player:deadIds` diag). See [QUEUE.md §Dead ids](features/QUEUE.md).
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
  Needs a UX cover-up (loading state / optimistic icon), not a silent freeze. See [UX-COVERUPS.md](architecture/UX-COVERUPS.md).
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
src/library-card.ts         Library contexts/groupings + drill-in; shared musicCell + libAlbum
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

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
[FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) (behaviors hardcoded now, to expose as toggles) ·
[UX-COVERUPS.md](UX-COVERUPS.md) (latency/jank ledger). Feature specs: [SEARCH.md](SEARCH.md) ·
[PLAYLISTS.md](PLAYLISTS.md) · [STATIONS.md](STATIONS.md) · [FAVORITES.md](FAVORITES.md) ·
[ALBUM-COLOR.md](ALBUM-COLOR.md) · [DEETS-REWIND.md](DEETS-REWIND.md) · [DeetsOTD.md](DeetsOTD.md) ·
[DeetsWeather.md](DeetsWeather.md) · [TRAY.md](TRAY.md) · [EXTENSION.md](EXTENSION.md) · [AGENT.md](AGENT.md) ·
[RELEASE.md](RELEASE.md) (build / install / uninstall).

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

## Ship it (installable Windows app)

Full procedure — version sync, the three build stages, the NSIS hooks, install, uninstall,
and why there's no updater — is in **[RELEASE.md](RELEASE.md)**. The short version:

```bash
npm run release     # cli:build → tauri build → archive-installer; ~3 min cold
```

Produces `src-tauri/target/release/bundle/nsis/DeetsMusic_<version>_x64-setup.exe` (~5.6 MB)
and copies it into `installers/` (gitignored, the DeetsAirplay pattern). Installs per-user to
`%LOCALAPPDATA%\DeetsMusic` with **no admin prompt**.

Three things that bite:

- **Use `npm run release`, not `tauri build`.** Only `release` runs `cli:build` first, which
  stages `cli/dist/deetsmusic.exe`. `tauri build` alone ships the **previous** CLI, silently.
- **The version lives in three files** — `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` — and they must agree or the archive step fails.
- **A running `deetsmusic mcp` blocks install AND uninstall.** Windows won't touch an open
  file; uninstalling 0.1.2 removed the registry entry and then left every file on disk. The
  0.1.3 `PREINSTALL`/`PREUNINSTALL` hooks stop the CLI first (RELEASE.md §3).

Icon: `app-icon.png` (the DM mark, DeetsAirplay/DeetsRGB lineage — transparent background,
scarlet `#E8341C` D + burgundy `#7A1A2E` M, 2026-09-09). Regenerate every size + the `.ico`
with `npx tauri icon app-icon.png` (delete the `android/` / `ios/` dirs it also emits); the
extension's icons are LANCZOS resizes of the same file.

---

## Next up

**Public release (decided 2026-09-09, next session)** — the repo is already public and the
secret audit is clean (the `.p8`/MUT/`dev-dumps` were never committed in any branch). The
blocker is that a MusicKit key needs a **paid Apple membership**, so no ordinary subscriber can
run the app. Fix: a **Cloudflare Worker on deets.solutions mints the developer token** — long
lifetime, open endpoint rate-limited by IP, local signing kept as the dev seam. Full build
order, across all three repos, is **[RELEASE.md](RELEASE.md) §7**. Also still needed before
posting: **screenshots** (there are none anywhere), a **GitHub Release** with the installer
attached (none exist), and a plain note about SmartScreen on the unsigned installer.

**The v1 push** — sequence discussed 2026-07-03 (each item still wants its own design/confirm
pass before building; the user directs):
1. **Settings card** — a lean vessel that rehomes the existing title-menu toggles
   (Always-on-Top / Hover-Menu / Library-Add) and seeds a curated handful of
   [FUTURE-SETTINGS](FUTURE-SETTINGS.md) entries (§1 / §4 / §5a / §7 are the
   highest-taste-variance). Explicitly NOT a full ledger burn-down.
2. **Release packaging** — secrets/cache out of `CARGO_MANIFEST_DIR` into proper app dirs,
   MUT into Windows Credential Manager, an installable build (the one true v1 blocker).
3. **SMTC / global hotkeys** — media keys + the Windows media flyout. (media-session.ts
   is the zero-dependency probe of the Chromium route; unverified.)

**Built 2026-09-08, awaiting the first user test** (each has its own doc — read it before
touching the area): the **tray icon + panel** and **Minimize to Tray** ([TRAY.md](TRAY.md));
the **browser extension + loopback bridge** ([EXTENSION.md](EXTENSION.md), source in
`extension/`, shipped inside the NSIS installer with a post-install prompt). The app icon is
now the DM mark (`app-icon.png` → `npx tauri icon`). The Web Store listing is the user's step.
**2026-09-09 polish (untested):** tray left-click now pops the *app* as mini at the cursor
(TRAY.md §1; the panel moved to the right-click menu); the extension's status line
slides/crossfades instead of jumping; "Not it?" opens a mini Search card (songs +
albums, `/search`); the popup re-reads the tab every 2 s. **Pairing code dropped**: the
bridge trusts the extension's `Origin` (EXTENSION.md §3). Tray right-click *Open* now
restores the real app (full surface + pre-pop position). Mini = one wide column, one
card under Now Playing (user-led from here). **Surfaces:** all three width cutoffs are back
(mini: in < 340 / out > 350 · midi ↔ max at 820 ± 40; `minWidth` lowered to 320 so the
flip into mini is actually reachable) — the user is evaluating resize-into-mini alongside
the tray flyout and the menu pick. **Next:** the mini composition, piece by piece.
**2026-09-09, branch `maxmaxxing` (untested):** the **max composition** (stage + anchored
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

**Deferred, when prioritized:** the **search-card stations section** (the one optional radio
leftover — add `stations` to the search types; `Station` model/tile/playback all exist, activation
is just `playStation`) · the **radio-mode now-playing/queue UX** (a holistic pass — what the
Qcard/NP surface does while a station plays; also owns **Stop Station**'s button, since
`stopStation()` exists but is currently unwired) · **DeetsWeather** ([DeetsWeather.md](DeetsWeather.md);
its own-station premise needs a rethink — that engine was dropped) · **CLI / local-agent
control** · **mini/max surface compositions** · **virtualized scrolling** (only once libraries
get large).

---

## State of play

### Built ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights wired to min/max/close.
- **Themes** (palette → theme → skin, all CSS-variable driven): `lilac`, `green`, `sepia`,
  `moonlight`, `black-yellow`, `black-red`. Settings menu (click the title) with Theme + Skin
  flyouts, Account row, Always-on-Top / Hover-Menu / Library-Add toggles. A first launch with
  no saved choice follows the OS light/dark preference, landing on Press × Lilac or
  Retro-Future × Black & Red; retired ids (`fairy`/`glade`/`hornet`/`viper`/`desk`/`cyberstorm`)
  migrate via the `RETIRED` maps in `theme.ts` / `skin.ts` and the pre-paint script in
  `index.html` — keep all three in sync.
- **Skins**: `vanilla` (borderless + editorial underline), `press` (riso print shop —
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
    locals AND mirrors (local metadata, zero Apple calls). Remaining: rename +
    drag-reorder (Rust commands exist), non-empty delete, mosaic covers, gated export.
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
  Library, gated behind the **Library Add** settings toggle (default off), on Search / Playlists /
  **Queue / History** right-click menus (incl. the now-playing hero). Apple's API is add-only.
- **Go to Artist / Go to Album** (2026-07-06, [SEARCH.md](SEARCH.md)): drill-in right-click verbs on
  **every** song/album surface (Search, Library, Playlists, Rewind, Queue, History, Now Playing —
  NP gained its first menu). Shared builders in `src/go-to.ts`; the id hop is `catalog_related` in
  `apple.rs` (session-cached via `catalogRelated`). Most surfaces route to the **catalog** detail in
  the Search card; the **Library drills IN-PLACE** over the user's library (`LibNav` in
  `library-card.ts`). In-place vs Search is a toggle: FUTURE-SETTINGS §20.

### Not built yet ⬜
- **♥ Favorites** — the love-only ♥ (Apple `PUT +1`) + local mirror + ♥ on Now Playing / menus.
  Parked, explicitly not the next step (user's call). **Ratings / 👎 are off the roadmap.**
- **Real album/artist data + artist photos in the Library card** — Library's Albums/Artists are
  derived from song artwork + initials (Search's artist drill already shows real photos). Scoped
  2026-07-03: **bigger than it looks** — the Artists overview shows hundreds at once, so lazy
  per-touch enrichment can't fill it (needs an eager one-time backfill, a deliberate exception
  to the enrichment doctrine with a §14-style opt-out) *and* it needs new schema (artist cache
  table), so it should bundle with the deferred schema-versioning work as one post-v1 pass.
  (Start Station on artist tiles does NOT wait for this — shipped via the lazy two-hop resolve.)
- **CLI / local-agent control** · **mini/max surface compositions** · **SMTC / global hotkeys** ·
  **virtualized scrolling** · **playlist rename / drag-reorder / export UX**.

---

## Known gotchas
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
src/history-card.ts         History card: session play log (hero + "Previously")
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
src/stats.ts                play-stats recorder: partial/full counters + play-event log
src/album-color.ts          NP aurora data path: current album palette → --album-* inline
src/context-menu.ts         shared popover: cursor/element-anchored; action/input/submenu items
src/dropdown.ts             shared dropdown primitive + menu-mode fan-out
src/theme.ts / skin.ts / surface.ts / storm.ts    token-tier switches + surface bands + storm layer
src/slider.ts               shared slider primitive (scrubber, volume)
src/diag.ts                 diagnostics ring buffer + window.__diag
src/artwork-heal.ts         cover-<img> self-healing (data-art marker; capture-phase retry)
src/styles.css              app rules (imports token sheets first)
src/styles/qcard.css        Queue/History/Rewind card styling
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
scripts/archive-installer.mjs   copies each shipped setup exe into installers/
installers/                 local archive of shipped NSIS installers (gitignored)
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

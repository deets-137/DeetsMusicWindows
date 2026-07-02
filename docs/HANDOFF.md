# DeetsMusic — Handoff / Status

> Cold-start guide. Read this first. Snapshot as of **2026-07-02**. 2026-07-01 was a heavy
> build day (the ⚡ entries in State of play); **2026-07-02** verified the fresh cards —
> **Search** (+ a UI-polish pass aligning it to the Library toolbar and two right-click bug
> fixes) and **History** are both user-verified now. Also landed + user-verified 2026-07-02:
> **NP transport-row buttons** (queue summon + one-shot shuffle) and **dead-id playback
> self-healing** (see State of play). **Next up: build-queue #5 — Favorites,
> ratings & library writes** ([FAVORITES.md](FAVORITES.md)).
> Deeper docs: [DESIGN.md](DESIGN.md) (product), [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md)
> (front-end), [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (back-end/data),
> [UX-COVERUPS.md](UX-COVERUPS.md) (latency/jank ledger for the holistic UX pass),
> [QUEUE.md](QUEUE.md) (queue model + playback windowing — read before touching
> queue.ts/player.ts), [DEBUGGING.md](DEBUGGING.md) (the `__diag` log + introspection),
> [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) (behaviors hardcoded now, to expose as toggles),
> [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) (swappable card system + mini/midi/max seam),
> [PLAYLISTS.md](PLAYLISTS.md) (playlists card spec — local-first store + Apple mirror + gated export),
> [SEARCH.md](SEARCH.md) (catalog Search card — songs/albums/artists/playlists/stations over the collection-card engine),
> [FAVORITES.md](FAVORITES.md) (♥/👎 ratings + Add-to-Library; the unified track store so non-library songs resolve),
> [ALBUM-COLOR.md](ALBUM-COLOR.md) (the radiant Now-Playing aurora — album palette → runtime roles → per-skin aurora),
> [STATIONS.md](STATIONS.md) (radio: Apple stations + our own generated stations + Deezer BPM enrichment),
> [DeetsWeather.md](DeetsWeather.md) (weather-driven stations/queues via WeatherKit — a weather recipe over the station engine),
> [DeetsOTD.md](DeetsOTD.md) (Song of the Day — mark one song per day; the history becomes a local music diary),
> [DEETS-REWIND.md](DEETS-REWIND.md) (listening-stats data + the future data-viz card).

## What this is
A lightweight Apple Music player for Windows 11 — **Tauri v2 + WebView2**, vanilla
**TypeScript** front-end, **Rust** back-end. Current surface is the **midi-player**
(480×864 frameless window) showing a home **bento** of cards.

---

## Run it

Prereqs (one-time, already set up on this machine):
- **Rust** (`x86_64-pc-windows-msvc`) + **VS 2022 Build Tools** with the C++ workload
  (provides `link.exe`; without it nothing Rust compiles).
- **Node** + npm.
- **Apple Developer** credentials in `src-tauri/secrets/` — see
  `src-tauri/secrets/README.md`. Already present here: `apple.json`, the `.p8`, and a
  captured `user-token.txt` (so it launches already signed in).

```bash
npm install
npm run tauri dev        # compiles Rust (first run is slow), opens the window
npx tsc --noEmit         # typecheck front-end only
```
Devtools **auto-open in dev** (set in `lib.rs` setup). `swatch.html` is a standalone
color reference (open in any browser).

**Debugging the player**: in the console, `__diag.dump()` / `__diag.copy()` (a ring
buffer of transport + MusicKit events + desyncs; auto-captures uncaught errors), plus
`__music` (live instance) and `__player.snap()`. Full reference: **[DEBUGGING.md](DEBUGGING.md)**.

---

## State of play

### Done ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights (`+ − ×` as
  stroked SVGs) wired to min/maximize/close.
- **Theme system**: 4 themes (`fairy` = Twilight Lilac, `sepia`, `moonlight`,
  `hornet` = Noir Gold), all CSS-variable driven (palette → theme → skin); each sets
  `color-scheme` + a `--traffic-glyph` role (the sigil stroke is theme-owned, no longer a
  skin literal). Settings menu (click the title) with a **Theme** flyout (live color-chip
  previews) and an **Account** row.
- **Skin system** (Tier 3, now switchable): **4 skins** — `vanilla` (the baseline slide),
  `desk` (raised paper cards on a dot grid, paper-label controls, airier page, photo-corner
  covers, hover-lift, Caveat/Karla), `ocean` (recessed soft cards, rolling waves, sink/rise
  nav, Cinzel/Spectral), `glass` (frosted translucent panels via `--panel-backdrop` over a
  per-theme accent aurora, glass chips, fade/scale nav). Structured as a shared `[data-skin]`
  base + per-skin deltas; nav + micro-motion + focus/icon/row geometry are all tokenized so a
  skin reshapes them with values only (new capabilities like `--hover-lift` / `--panel-backdrop`
  default to no-ops, so adding one never forces a sweep of the other skins). `--panel` is a skin
  role indirection. The Queue card's rows share the Library's row tokens (one shape/density).
  **Skin** selector row in settings mirrors Theme (`src/skin.ts`).
- **Typography**: Liberation Serif (title) bundled as local TTFs via `@font-face`.
- **Card system + swappable slots** (`src/cards.ts`, `src/layout.ts`; see
  [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md)): every card is a *mountable module* in a
  registry (`now-playing` / `library` / `queue` / `playlists`-stub). The midi bento has an
  **anchored Now Playing** slot + **two swappable content slots**; each content slot's
  **title is a menu** (no caret, hover/click per Hover-Menu) to choose its card —
  swap/replace, one-instance, persisted (`deets.layout.midi`), **root-level only** (drilling
  into an album disables it). Cards own their markup (the `index.html` panels are empty
  hosts). **Menu mode now lives in the dropdown primitive** (`setDropdownMode` + a live
  registry; `makeDropdown` gained `destroy()`). Phases 1–2 done; the `data-surface`
  (mini/midi/max) **surface seam is the next step** (Phase 3).
- **Home bento**: Now Playing strip (top, wide) · Library (left) · Queue (right, in the
  Playlists slot for now), span-based grid, columns scroll individually.
- **Apple auth**: loopback browser sign-in (themed page), MUT persisted, survives
  restarts. Account row shows ✓/✗ + spinner.
- **Library data (songs)**: end-to-end — `library_sync` pulls all songs (parallel) →
  SQLite cache → Library card lists title/artist, auto-syncs on open, refresh re-syncs.
- **Collection-card engine** (`src/collection-card.ts`): a reusable, navigable
  browser. Per-context **Sort / View / Search** pills (40/40/20); Search slides an
  inline bar down. Library (`src/library-card.ts`) drives it with **Songs / Albums /
  Artists** groupings, **drill-in** to album & artist detail; **click a song to play**
  it + queue the rest in the current sort (albums/artists still drill), a fixed
  back-chevron header, and **push/pop
  pane-slide** navigation (skin-tokened `--nav-dur`/`--nav-ease`, honours reduced
  motion). Scroll restores on back. Albums/Artists are **derived from cached songs**;
  square tiles + line mini-covers render Apple artwork. State persists. Added-Date
  uses `Track.addedRank` (no per-song `dateAdded`; fetched via `sort=dateAdded`),
  negated so **most-recently-added surfaces first** — **needs a re-sync to backfill**
  old rows. Custom themed scrollbar on the list.
- **Always on Top**: settings-menu toggle row with an active dot; persists.
- **Playback** ✅ — **full-song DRM works in WebView2** (the load-bearing risk is dead).
  `src/player.ts` configures MusicKit JS in the app webview, injects the captured MUT
  directly (no `authorize()` popup — `apple_user_token` command), and plays. Now Playing
  shows real cover/title/artist + a **live, drag-to-seek scrubber** and **volume** (both
  on a shared slider primitive, `src/slider.ts`; volume persists), all off MusicKit
  events. **Click a song → it plays** and queues the rest from that point in the current
  sort. Catalog→library id fallback for songs not in the catalog.
- **Queue model** (`src/queue.ts`): history / current / upcoming zones of lightweight
  handles; `origin`-based stacking (manual play-next survives a new context); a
  backgrounded pre-click backlog (`played` flag) reachable via Previous, hidden from
  recently-played until heard. The player keeps it **live-synced to MusicKit's position**
  (model-follow), so it mirrors what's actually playing.
- **Surface seam** (`src/surface.ts`; [SURFACES-AND-CARDS §Build order #3](SURFACES-AND-CARDS.md)):
  `data-surface="mini|midi|max"` on `<html>` — deliberate choice (a **Surface** settings row with
  size-preview labels) + resize allowance (band table, 40px hysteresis), per-surface remembered
  window sizes (`deets.surface*` keys). Max/mini inherit the midi layout until their compositions
  are designed. Needed `core:window:allow-set-size` in `capabilities/default.json`.
- **Album Color — full path** ([ALBUM-COLOR.md](ALBUM-COLOR.md)): runtime `--album-*` roles
  (theme fallbacks at `:root` in `themes.css`), skin knobs (`--album-aurora-*`), and the
  cover-anchored rotating halo on the NP card (`.np__aurora`). **Glass-only** via
  `--album-aurora-display`. **Real palettes are wired** (`src/album-color.ts` → the
  `album_palette` command, cache-first, crossfades in). ⚡ Latest tune (untested): the visible
  rim uses the vivid `textColor` accents — Apple's `bgColor` (usually near-black) stays hidden
  under the cover.
- ⚡ **Catalog enrichment + unified store + play-events log** — build-queue item 3, all three
  slices built 2026-07-01; details in that queue entry below. The DB was **reset + fresh-synced**
  onto the new catalog-first schema the same day.
- ✅ **Search card** ([SEARCH.md](SEARCH.md) §As built) — standalone sectioned card (Artists /
  Songs / Albums / Playlists h-scrollers, filter popover, recents, drill panes, queue menus),
  three catalog commands, enrichment piggyback, transient + materialized catalog tracks.
  Built 2026-07-01; **user-verified + a UI-polish pass 2026-07-02** that aligned the bar/filter to
  the Library toolbar (canvas well + magnifier, themed clear button, filter on the shared dropdown
  primitive, matched scrollbars) and fixed two right-click bugs (Search artist-pane album tiles now
  get our menu, not the native one; sparse tile grids no longer stretch — see gotchas).
- **Transport + Queue card (Qcard)**: prev/next wired (native skip within the window —
  Previous walks backlog→history, Next walks upcoming). The **Qcard** (`src/qcard.ts`)
  occupies the Playlists slot (title → "Queue") and renders Now Playing + Up Next from the
  model — **display + jump-to-item** (click/Enter an Up Next row to play it). A shared
  **track store** (`src/track-store.ts`) feeds metadata to both cards from one load.
- ✅ **NP transport-row buttons + dead-id self-healing** (built + user-verified 2026-07-02):
  the NP card's transport row is a `1fr auto 1fr` grid — **shuffle** (left) and **queue
  summon** (right), both in the Library-Sync `.panel__action` style.
  - **Queue summon** (`src/layout-bus.ts` `requestCard`/`onCardRequest` → `layout.ts`):
    brings the Queue card into the **least-recently-touched** content slot (pointerdown-
    capture recency, session-only, launch tie → right); if Queue is already in the other
    slot the two **flip** ([FUTURE-SETTINGS §10](FUTURE-SETTINGS.md)).
  - **One-shot shuffle** (`shuffleQueue` in player.ts → `shuffleUpcoming` in queue.ts,
    synced via `reconcileUpcoming`, gapless): manual picks rise to the top (order kept),
    the auto tail Fisher–Yates-shuffles; **idle press plays the whole library shuffled**.
    Both knobs are future settings ([FUTURE-SETTINGS §5](FUTURE-SETTINGS.md)); the P6
    persistent shuffle *mode* is still future.
  - **Dead-id self-healing** ([QUEUE.md §Dead ids](QUEUE.md)): stale catalog ids no longer
    sink `setQueue`/`playNext`/`playLater` — NOT_FOUND offenders are banked in a session
    denylist, `playId` falls back catalog → library → skip, and the op rebuilds + retries.
    Surfaced (and fixed) by the idle-shuffle/bootstrap paths; protects every feed op now.
- ✅ **History card** (`src/history-card.ts`, built 2026-07-02, **user-verified 2026-07-02**;
  [QUEUE.md §play log](QUEUE.md)) — renders the new session **play log** (`queue.getPlayLog()`,
  append-only, repeats real): hero = most recent play (Qcard-style `qnow` block, blank when idle),
  "Previously" list below (appears from the 2nd play). Read-only rows; right-click → Play Now /
  Play Next / Add to Queue (handle-level, gapless, `context: "history"`). Row markup/resolution
  shared with the Qcard via `src/queue-rows.ts`. In the slot picker via the registry.

### Stubbed / not built yet ⬜
- **Manual queueing** — **built and gapless** (model in lockstep; see [QUEUE.md](QUEUE.md)),
  via right-click menus on two surfaces:
  - **Library** songs + albums → Play Now · Play Next · Add to Queue (`playNext`/`playLater`).
  - **Qcard Up Next** rows → Play Now · Move to Top · Move to Bottom · Remove (`music.queue.splice`
    + `playNext`/`playLater`; gapless — only `queueItemsDidChange` fires).
  Shared popover primitive `src/context-menu.ts`. **Drag-to-reorder** Up Next is also in
  (whole-row press-and-drag, insertion-line, gapless via `reconcileUpcoming` — the general
  model→MusicKit suffix-rebuild primitive that re-windowing will reuse). Still to do: a hover
  **"⋯" overflow button** (right-click is the only menu trigger — no keyboard/touch path), a
  **Now Playing** menu (Go to Album/Artist, Add to Library), and touch/grip-handle dragging.
  Menu action sets + drag mode are slated to be user-customizable ([FUTURE-SETTINGS.md](FUTURE-SETTINGS.md)).
- **Real Playlists card** — the Playlists slot currently hosts the Qcard. Real Playlists
  return later (collection-card Playlists context: overview list → playlist detail).
- **Real album/artist data + artist photos** — Albums/Artists are *derived* from songs
  (no catalog). Artist tiles show a round album-cover thumb / initials until a photo is
  fetched on demand (when you open the artist).
- **Catalog access — BUILT** (demand-driven, as designed): the enrichment layer
  (`enrich.rs`) + Search's catalog commands pull **only what you touch** and cache it;
  palette/ISRC/previews ride every fetch. Remaining under this heading: **Library-card**
  artist photos / real album art (the Library's derived Albums/Artists views still render
  from song artwork + initials — wiring them to the same lazy enrichment is a small later
  pass; Search's artist drill already shows real photos).
- **CLI / local-agent control** — see roadmap; not started.
- **Virtualized scrolling** — list/grid renders all rows; fine at a few thousand,
  virtualize once libraries get large or artwork I/O bites.
- **Mini player, full window, SMTC, global hotkeys** — not started.

---

## 🔨 Build queue for Fable (specs to build — 2026-07-02)

> A session-specific build order over the feature specs, for a fresh Fable run pointed at `docs/`.
> Work **top-down** — each item unblocks the next.
>
> **How to operate each item:** (1) read the linked spec end-to-end; (2) resolve its **open 🔵
> forks** using the doc's recommended default unless the user says otherwise; (3) if it carries a
> **⚠️ verify-first risk, prove it on a throwaway before building the dependent surface** — the
> same discipline that de-risked WebView2 DRM; (4) keep everything **token-based** (palette → theme
> → skin; runtime roles for album/weather) — never a hardcoded color / px / font; (5) compile-check
> (`npx tsc --noEmit`, `npx vite build`) and hand to the user to test in `npm run tauri dev` —
> **no throwaway UI harnesses**; (6) as each lands, flip its status in the spec doc + State of play.

0. **Run both verify-first probes up front (cheap throwaways — do them alongside #1):**
   (a) the **MusicKit-JS station-playback call** in WebView2 ([STATIONS §2](STATIONS.md)) — its
   outcome gates #6 *and* decides whether #4 ships its Stations category live, display-only, or
   hidden; (b) the **WeatherKit JWT / Service-ID** 200 check ([DeetsWeather §1](DeetsWeather.md)) —
   gates #7 entirely. Both are throwaway probes with no build dependencies, and their results
   shape items 4–7 — front-load them instead of probing at each item.
1. ✅ **Surface seam + sizing/switching — built (2026-07-01).** See
   [SURFACES-AND-CARDS §Build order #3](SURFACES-AND-CARDS.md) (now feature documentation) +
   the State-of-play entry above. Station probe (`__probeStation`) shipped alongside it as a
   dev-only console function in `player.ts` — **verdict: FAILED (HTTP 400) on
   `setQueue({ station })`, 2026-07-01.** Consequences: Search's Stations category ships
   non-interactive (or hidden) for now; STATIONS §2's Apple-station half needs a descriptor-variant
   probe pass (`url` / `playParams` forms) before building. **Own stations are unaffected** —
   they're normal generated track queues, no station descriptor involved.
2. ✅ **Album Color (radiant Now-Playing aurora) — built on the fallback path (2026-07-01).**
   [ALBUM-COLOR.md](ALBUM-COLOR.md) (see its status block). **Glass-only** + **cover-anchored
   halo** (user calls, recorded in the spec's closed decisions). Remaining for #3: apply real
   Apple palettes (`--album-*` inline on the NP card) + the `.np--album` presence class. Glass
   `backdrop-filter` perf in WebView2: user-verified OK so far.
3. ✅ **Catalog enrichment layer + data-model migration + Rewind event log — built (2026-07-01).**
   - **Enrichment** (`src-tauri/src/enrich.rs`): cached storefront (`meta` kv), chunked
     `?ids=` catalog-songs fetch → `track_catalog` (catalog_id → ISRC / preview / cover URL) +
     `album_palette` (cover URL → bg/c1/c2, double-keyed under requester + catalog cover URLs).
     Commands: `catalog_enrich` (batch, cache-first — Stations' ISRC backfill rides this) and
     `album_palette` (the NP lookup; caches empty palettes so misses don't re-fetch). First
     consumer wired: `src/album-color.ts` applies real palettes as inline `--album-*` on the NP
     card + `.np--album`, cache-first, stale-response-guarded.
   - **Unified store** ([FAVORITES.md](FAVORITES.md) data-model half): `tracks(track_id, source,
     …)` on the **catalog-first key**; sync upserts graduate `seen`→`library` and prune only
     `library` rows; `library_tracks` filters to `source='library'`; `record_play` canonicalizes
     catalog-first; `materialize_track` command ready (callers arrive with Search/Favorites).
     A v1→v2 migration exists for old DBs (timestamped backup + one transaction), but this
     machine's DB was **reset + fresh-synced** instead (pre-production call, 2026-07-01).
   - **Event log** ([DEETS-REWIND §5a](DEETS-REWIND.md), now feature-documented): `play_events`
     + `record_event_start`/`record_event_end`; real `ms_listened` from tick deltas; `context`
     threaded. **The un-backfillable clock is running.**
4. ✅ **Search card — BUILT 2026-07-01, user-verified + polished 2026-07-02.** [SEARCH.md](SEARCH.md) — the
   **§As built** section is the authoritative description (standalone card per the screen
   taxonomy; sectioned layout; three catalog commands; enrichment piggyback; transient +
   materialized catalog tracks). **Stations category hidden** (the probe failed — see item 0).
   The 2026-07-02 pass aligned the bar/filter to the Library toolbar and fixed the right-click
   bugs (see State of play + SEARCH.md §As built → UI polish). **Remaining minor check:** under
   glass the drill panes' translucent `--panel` background may show the pane beneath during
   slides — opaque-fix if it reads wrong.
5. **Favorites, ratings & library writes.** [FAVORITES.md](FAVORITES.md). **♥ Favorite (love +1) ·
   👎 Dislike (−1) · Add to Library**, as dedicated buttons + menus across Now Playing / Library /
   Search / Queue (ratings + library POST via the MUT we already hold; **gated** writes). The
   shared data-model change (unified `tracks` store + catalog-first key) **lands in #3** — by this
   point it's in place, leaving #5 as the write plumbing + UI: ratings/add-to-library provider
   methods, the local ratings mirror, and the buttons. No verify-first risk (but confirm the exact
   favorites-vs-ratings route against live docs).
6. **Stations.** [STATIONS.md](STATIONS.md). **⚠️ Verify-first:** the **MusicKit-JS
   station-playback probe** (item 0 — should already be done by now; if not, prove it on a
   throwaway *before* building the card). Ship order within the item: **Apple stations** (browser +
   radio-mode display) → **re-windowing (roadmap #3)** — the window top-up via `reconcileUpcoming`
   ([QUEUE.md](QUEUE.md)); **not yet built and a hard prerequisite for own stations**, whose
   generator refills `upcoming` through exactly this hook (without it an own-station dead-ends at
   the window edge) → Deezer enrichment provider (BPM cache; #3 supplies the ISRC) → **own-station
   generator** with the `scope: library|catalog` toggle; **♥/👎 ratings (#5) are its strongest
   taste signal** (genome substitute). Open 🔵: manual-queue in radio mode, ship order.
7. **DeetsWeather.** [DeetsWeather.md](DeetsWeather.md). Rides #6's own-station engine (weather = a
   rule source). **⚠️ Verify-first:** the **WeatherKit Service-ID / JWT probe** (item 0 — should
   already be done; `sub` = a WeatherKit-enabled service id, *different from the MusicKit dev
   token*, must return 200 on a throwaway). **Attribution is mandatory** (Apple Weather logo +
   legal link). Open 🔵: snapshot vs forecast-arc, location source.

**Also specced, ready when prioritized (off the critical path above):**
[PLAYLISTS.md](PLAYLISTS.md) (roadmap #5 — real Playlists card, restores the slot the Qcard borrows)
· [DEETS-REWIND.md](DEETS-REWIND.md) (listening-stats data-viz card)
· [DeetsOTD.md](DeetsOTD.md) (Song of the Day — small, fully local, no dependencies; a good
low-risk standalone if a quick win is wanted).

---

## Roadmap (agreed order)
*Playback, the queue, manual queueing, and the **card system** (swappable midi slots —
[SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md), Phases 1–2 done) are built. The **surface
seam** (`data-surface` mini/midi/max) is the immediate next step (that doc's Phase 3). The
numbered list below is the older feature roadmap, still valid for what rides the foundation.*
1. ✅ **Transport + model-follow + Qcard** — prev/next wired, the queue model follows
   MusicKit's live position, and the Qcard renders it (display + jump-to-item) in the
   Playlists slot.
2. **Manual queueing** — ✅ Library Play Now / Play Next / Add to Queue, Qcard Up-Next
   Play Now / Move to Top / Move to Bottom / Remove, **and drag-to-reorder** — all gapless +
   model-synced. **Remaining:** a hover "⋯" overflow trigger (a11y/discoverability), a
   Now-Playing menu, touch/grip dragging, and user-customizable menu actions.
3. **Re-windowing** — `playContext` feeds MusicKit a bounded window (50 back / 200 fwd);
   top it up as playback nears an edge so long contexts don't dead-end. The one place
   model-driven nav crosses the window edge and incurs load latency (see gotchas).
4. ✅ **Search card** — a general catalog **Search** surface: `term` → `/v1/catalog/{sf}/search`
   (songs/albums/artists), normalized to our model. Catalog results carry **`previews`** (30s),
   **palette**, and real **artist/album art** for free — so previews live *here*, tied to
   search, not a batch pre-fetch. **Decided:** a result tap **plays it in full** (you're
   authorized → full DRM playback) with **Add to Library / Queue** actions; a 30s-preview
   audition is an optional later add, not the default. Needs a cached storefront + a `search`
   provider method. *(There is deliberately no "catalog hydrate" item — catalog data is
   demand-driven: Search for discovery, lazy enrichment (#7) for what you view.)*
5. **Real Playlists card** — **now specced: [PLAYLISTS.md](PLAYLISTS.md)** (local-first
   store + read-only Apple mirror with a source badge + gated one-way create/append export;
   `amp-api` rejected). Wire `playlists_page` + `playlist_tracks` (+ local CRUD tables), drive
   the collection-card with a Playlists context (overview → playlist detail). Restores the slot
   the Qcard is borrowing. UI/UX design is a dedicated next session.
6. **CLI / local-agent control** (pre-launch goal) — a command surface so local models /
   agents can play music (search, queue, play/pause/skip, now-playing): a thin Rust
   layer over the same `player` interface, so agents and the UI share one control path.
7. **Per-album accent theming + lazy catalog enrichment** — fetch a track's catalog
   **palette** (`bgColor`/`textColors`) on demand, keyed by **cover-art URL** (one fetch per
   album cover), cache it, and route it through `--album-*` **runtime roles** to tint Now
   Playing (and album detail). The Now-Playing tint is fully specced in
   **[ALBUM-COLOR.md](ALBUM-COLOR.md)** (radiant, rotating, per-skin aurora); this palette
   cache is its data path (its first consumer). The same demand-driven path fetches **artist
   photos** on artist-detail — and the same catalog object carries **ISRC** (→ Deezer BPM) and
   **30s previews**, so this one enrichment layer is also the substrate for **[STATIONS.md](STATIONS.md)**
   (a live-cache probe on 2026-07-01 found **0/3717** library songs carry an ISRC, but **99.8%**
   have a catalog id — so ISRC is recoverable here, ~13 batch calls for the whole library).
   *(This is the home for the visual layer batch hydrate used to cover.)* · **mini-player /
   SMTC / hotkeys** · **virtualized list** (only once libraries get large or artwork I/O bites).

---

## Known gotchas
- **No in-app OAuth popups** (Tauri/WebView2). Auth is browser-loopback by design —
  don't try to "fix" `authorize()` in the webview. See DATA-ARCHITECTURE §2.
- **Liberation fonts aren't on Windows** — bundled locally; the loopback page serves
  them too (embedded in the binary) so it matches the app.
- **Secrets & cache paths are dev-oriented**: resolved from `CARGO_MANIFEST_DIR`.
  Packaging for release needs them moved to proper app dirs, and the MUT moved to the
  **Windows Credential Manager**.
- **`dev-dumps/` holds real account data** — gitignored; don't commit. Regenerate via
  the (dev) `apple_dump_library` command if needed.
- **Intermediate compile errors during multi-file Rust edits** are normal (the dev
  server recompiles per save); only the final build matters.
- **Collection card — `data-density` collision:** the list/grid view's CSS hook is
  `data-grid` (NOT `data-density`). The density *buttons* use `data-density`; if the
  view reuses it, the delegated click handler's `closest("[data-density]")` matches the
  list and swallows every tile click (silent — looks like clicks "do nothing"). This
  bit us twice.
- **Collection card — scroll after mount:** restore `scrollTop` / `scrollIntoView`
  *after* a pane is appended and laid out (in `slide()`), never in `renderViewInto`
  while the pane is still detached — it silently no-ops.
- **Collection card — sparse grid stretches tiles:** `.lib-grid` fills the tall `.lib-view`,
  and grid's default `align-content` acts as *stretch*, so a view with only a few tiles (e.g. an
  artist with one album) stretches that single row — and the tile with it — to full height. Only
  visible when the right-click `is-context` outline wraps the giant tile. Fixed with
  `align-content: start` on `.lib-grid` (pack rows at natural height; still scrolls when full).
- **Added-Date needs a re-sync:** older cache rows lack `addedRank` until a refresh
  re-fetches with `sort=dateAdded`.
- **Transport latency (the friction to cover up):** within MusicKit's fed window,
  prev/next is native and **gapless**. But any nav that lands **outside** the window —
  rewinding past the backlog into older history, or seeking — forces a fresh `setQueue`
  and **buffers** (a perceptible gap). Same for **scrubbing** a DRM stream. These need a
  UX cover-up (loading state / optimistic icon / debounced input), not a silent freeze.
- **Catalog tracks resolve through two layers:** the track-store's `transient` map
  (session display — Qcard rows, album color) and Rust `materialize_track` (`source='seen'`
  rows — durable stats joins). Search feeds **both** on play *and* enqueue. If a catalog song
  ever shows "Unknown" in the Qcard, the transient ingest is what broke, not the queue.
- **Click a song = play (not drill):** the old song→album drill is **retired**. Songs
  `activate` (play); albums/artists `open` (drill). The engine prefers `activate` over
  `open` on a leaf.
- **Model-follow keys off `music.queue.position`:** the queue model mirrors MusicKit by
  replaying `advance()`/`previous()` on position changes (`syncModelToMusicKit`),
  suppressed during (re)loads via `loadingContext`. If a MusicKit build reports position
  differently, the Up Next list would stop tracking — fall back to matching
  `nowPlayingItem` by id.
- **`changeToMediaAtIndex` already starts playback** — do NOT call `play()` after it or
  MusicKit throws *"play() without a previous stop()/pause()"*. `play()` belongs only on
  the pos-0 (setQueue-only) path, guarded by `!isPlaying`. And the inverse: **never call
  `changeToMediaAtIndex(0)` on a fresh queue** — setQueue already sits at 0 and the call
  makes MusicKit double-play against itself (same error, uncaught). (Bit us twice — see
  [QUEUE.md §Windowing](QUEUE.md).)
- **Stale catalog ids reject whole feed batches** — `setQueue`/`playNext`/`playLater` are
  all-or-nothing: one dead id → `NOT_FOUND` for the entire call, nothing plays. The player
  self-heals (session denylist + library-id fallback + rebuild/retry — the
  `player:deadIds` diag event and a console warn are the breadcrumbs). See
  [QUEUE.md §Dead ids](QUEUE.md); persisting the denylist is noted future work.

---

## Key decisions made (the "why")
- **Data ≠ playback.** Library fetching is plain REST (no DRM); we built all the data
  layer without touching the DRM question.
- **Full-song DRM plays in WebView2** (confirmed) — MusicKit JS in the renderer, MUT
  injected directly (no `authorize()` popup). The MUT necessarily reaches the renderer
  for this one path.
- **Queue model is the source of truth**, decoupled from MusicKit; the player feeds
  MusicKit a bounded window for cheap setQueue + gapless play, and mirrors its position
  back (model-follow). Lightweight handles (ids), not full Tracks — cheap on huge
  libraries; metadata resolves through the shared track store.
- **Normalization in a Rust `MusicProvider` trait** — UI is provider-agnostic.
- **Unified `Track`** with both IDs optional (not split library/catalog types).
- **Persisted SQLite cache + sync-on-open** (stale-while-revalidate) — instant
  launches, offline browse, full-library search later; ~76 polite calls per refresh.
- **Loopback browser auth** as the permanent flow (not a workaround).

---

## File map (orientation)
```
index.html                  home markup (titlebar, settings menu, bento)
swatch.html                 standalone color reference
src/main.ts                 window controls, settings menu, account, menu-mode, initLayout
src/cards.ts                card registry + CardDef/CardInstance (mountable-card contract)
src/layout.ts               midi layout: anchored NP + 2 swappable slots + title-menu picker
                            + slot recency (LRU) + summon handling
src/layout-bus.ts           card-summon bus (requestCard/onCardRequest — NP queue button)
src/now-playing-card.ts     Now Playing card (transport strip; extracted from main.ts)
src/playlists-card.ts       Playlists card — stub for now (selectable; real context later)
src/dropdown.ts             shared dropdown primitive + menu-mode fan-out (setDropdownMode)
src/theme.ts                theme switch + persistence
src/skin.ts                 skin switch + persistence (mirrors theme.ts)
src/surface.ts              surface system: data-surface bands + deliberate choice + resize
                            allowance + per-surface remembered window sizes
src/album-color.ts          NP aurora data path: current album's palette → --album-* inline
src/search.ts               catalog search data access (types + invoke wrappers)
src/search-card.ts          Search card — standalone sectioned discovery surface (SEARCH.md)
src/apple.ts                auth bridge (connect/disconnect/isConnected)
src/library.ts              cache reads, sync trigger, sync-event subscription, types
src/collection-card.ts      reusable navigable browser engine (contexts/groupings,
                            Sort/View/Search, push/pop pane-slide nav, scroll restore)
src/library-card.ts         Library's contexts/groupings + drill-in; song click → play
src/track-store.ts          shared in-memory library: one load, id→Track index + notify
src/queue.ts                queue model (history/current/upcoming, backlog, stacking)
src/player.ts               MusicKit engine: init/MUT-inject, playContext (windowed),
                            loadFromModel, transport, model-follow, scrubber/state events
src/qcard.ts                Queue card (queueCard): Now Playing + Up Next + jump-to-item
src/diag.ts                 diagnostics ring buffer + window.__diag (bug-report payload)
src/slider.ts               shared slider primitive (scrubber, volume)
src/styles.css              app rules (imports the token sheets first)
src/styles/qcard.css        Queue card styling (imported by qcard.ts)
src/styles/{palette,themes,skin,fonts}.css + fonts/  the token system; skin.css is a
                            [data-skin] base + vanilla/desk/ocean deltas. Fonts: Liberation
                            Serif + Caveat/Karla (desk) + Cinzel/Spectral (ocean)
src-tauri/src/lib.rs        Tauri builder: state, DB open, command registry, devtools
src-tauri/src/apple.rs      dev-token signing, loopback auth, dump, AppleProvider
src-tauri/src/model.rs      normalized model
src-tauri/src/provider.rs   MusicProvider trait
src-tauri/src/library.rs    SQLite cache + sync + play_stats/play_events + the unified
                            track store (catalog-first keys) + v1→v2 migration
src-tauri/src/enrich.rs     lazy catalog enrichment: storefront cache, batch catalog fetch,
                            track_catalog + album_palette caches (roadmap #7)
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

# DeetsMusic — Handoff / Status

> Cold-start guide. Read this first. Snapshot as of **2026-06-29**.
> Deeper docs: [DESIGN.md](DESIGN.md) (product), [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md)
> (front-end), [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (back-end/data),
> [UX-COVERUPS.md](UX-COVERUPS.md) (latency/jank ledger for the holistic UX pass).

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

---

## State of play

### Done ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights (`+ − ×` as
  stroked SVGs) wired to min/maximize/close.
- **Theme system**: 4 themes (`fairy` = Twilight Lilac, `sepia`, `moonlight`,
  `hornet` = Noir Gold), all CSS-variable driven (palette → theme → skin). Settings
  menu (click the title) with a **Theme** flyout (live color-chip previews) and an
  **Account** row.
- **Skin system** (Tier 3, now switchable): 3 skins — `vanilla` (the baseline slide),
  `desk` (raised paper cards, dot grid, drop-onto nav, Caveat/Karla), `ocean` (recessed
  soft cards, rolling waves, sink/rise nav, Cinzel/Spectral). Structured as a shared
  `[data-skin]` base + per-skin deltas; nav motion is fully tokenized so a skin reshapes
  the drill-in with values only. `--panel` is a skin role indirection; canvas-pattern /
  `--shadow-card` tokens are no-ops under vanilla so existing surfaces are untouched.
  **Skin** selector row in settings mirrors Theme (`src/skin.ts`).
- **Typography**: Liberation Serif (title) bundled as local TTFs via `@font-face`.
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
  shows real cover/title/artist + a **live, drag-to-seek scrubber**, all off MusicKit
  events. **Click a song → it plays** and queues the rest from that point in the current
  sort. Catalog→library id fallback for songs not in the catalog.
- **Queue model** (`src/queue.ts`): history / current / upcoming zones of lightweight
  handles; `origin`-based stacking (manual play-next survives a new context); a
  backgrounded pre-click backlog (`played` flag) reachable via Previous, hidden from
  recently-played until heard. The player keeps it **live-synced to MusicKit's position**
  (model-follow), so it mirrors what's actually playing.
- **Transport + Queue card (Qcard)**: prev/next wired (native skip within the window —
  Previous walks backlog→history, Next walks upcoming). The **Qcard** (`src/qcard.ts`)
  occupies the Playlists slot (title → "Queue") and renders Now Playing + Up Next from the
  model — **display + jump-to-item** (click/Enter an Up Next row to play it). A shared
  **track store** (`src/track-store.ts`) feeds metadata to both cards from one load.

### Stubbed / not built yet ⬜
- **Manual queueing** — the queue *model* supports play-next / add-to-queue / reorder /
  remove, but there's **no UI** for them yet and no MusicKit-side sync. Next up.
- **Real Playlists card** — the Playlists slot currently hosts the Qcard. Real Playlists
  return later (collection-card Playlists context: overview list → playlist detail).
- **Real album/artist data + artist photos** — Albums/Artists are *derived* from songs
  (no catalog). Artist tiles show a round album-cover thumb / initials until hydrate.
- **Catalog hydration** — `playParams.catalogId` → palette (`Artwork.bgColor`/
  `textColors`), real artist/album art, `previews` (30s audio!), `isrc`. Not fetched.
- **CLI / local-agent control** — see roadmap; not started.
- **Virtualized scrolling** — list/grid renders all rows; fine at a few thousand,
  virtualize once libraries get large or artwork I/O bites.
- **Mini player, full window, SMTC, global hotkeys** — not started.

---

## Roadmap (agreed order)
*Playback + the queue are built and the Qcard is live; manual queueing is next.*
1. ✅ **Transport + model-follow + Qcard** — prev/next wired, the queue model follows
   MusicKit's live position, and the Qcard renders it (display + jump-to-item) in the
   Playlists slot.
2. **Manual queueing** (next) — UI for play-next / add-to-queue / reorder / remove,
   driving the model (which already supports them) and syncing into MusicKit.
3. **Re-windowing** — `playContext` feeds MusicKit a bounded window (50 back / 200 fwd);
   top it up as playback nears an edge so long contexts don't dead-end. The one place
   model-driven nav crosses the window edge and incurs load latency (see gotchas).
4. **Catalog hydrate** — storefront lookup + batched `/catalog` songs→artists→albums via
   `playParams.catalogId`. Fills palette (`Artwork.bgColor`/`textColors`), real **artist
   photos** + album art, `previews`/`isrc`. ~15 polite calls; small `artists`/`albums`
   tables. Scope: **songs + artists + albums** in one pass.
5. **Real Playlists card** — wire `playlists_page` + `playlist_tracks` (+ tables), drive
   the collection-card with a Playlists context (overview → playlist detail). Restores
   the slot the Qcard is borrowing.
6. **CLI / local-agent control** (pre-launch goal) — a command surface so local models /
   agents can play music (search, queue, play/pause/skip, now-playing): a thin Rust
   layer over the same `player` interface, so agents and the UI share one control path.
7. **Per-album accent theming** · **mini-player / SMTC / hotkeys** · **virtualized list**
   (only once libraries get large or artwork I/O bites).

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
- **Added-Date needs a re-sync:** older cache rows lack `addedRank` until a refresh
  re-fetches with `sort=dateAdded`.
- **Transport latency (the friction to cover up):** within MusicKit's fed window,
  prev/next is native and **gapless**. But any nav that lands **outside** the window —
  rewinding past the backlog into older history, or seeking — forces a fresh `setQueue`
  and **buffers** (a perceptible gap). Same for **scrubbing** a DRM stream. These need a
  UX cover-up (loading state / optimistic icon / debounced input), not a silent freeze.
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
  the pos-0 (setQueue-only) path, guarded by `!isPlaying`. (Bit us once.)

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
src/main.ts                 window controls, settings menu, account, library wiring
src/theme.ts                theme switch + persistence
src/skin.ts                 skin switch + persistence (mirrors theme.ts)
src/apple.ts                auth bridge (connect/disconnect/isConnected)
src/library.ts              cache reads, sync trigger, sync-event subscription, types
src/collection-card.ts      reusable navigable browser engine (contexts/groupings,
                            Sort/View/Search, push/pop pane-slide nav, scroll restore)
src/library-card.ts         Library's contexts/groupings + drill-in; song click → play
src/track-store.ts          shared in-memory library: one load, id→Track index + notify
src/queue.ts                queue model (history/current/upcoming, backlog, stacking)
src/player.ts               MusicKit engine: init/MUT-inject, playContext (windowed),
                            loadFromModel, transport, model-follow, scrubber/state events
src/qcard.ts                Queue card (Playlists slot): Now Playing + Up Next + jump
src/styles.css              app rules (imports the token sheets first)
src/styles/qcard.css        Queue card styling (imported by qcard.ts)
src/styles/{palette,themes,skin,fonts}.css + fonts/  the token system; skin.css is a
                            [data-skin] base + vanilla/desk/ocean deltas. Fonts: Liberation
                            Serif + Caveat/Karla (desk) + Cinzel/Spectral (ocean)
src-tauri/src/lib.rs        Tauri builder: state, DB open, command registry, devtools
src-tauri/src/apple.rs      dev-token signing, loopback auth, dump, AppleProvider
src-tauri/src/model.rs      normalized model
src-tauri/src/provider.rs   MusicProvider trait
src-tauri/src/library.rs    SQLite cache + sync
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

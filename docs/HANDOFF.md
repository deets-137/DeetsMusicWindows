# DeetsMusic — Handoff / Status

> Cold-start guide. Read this first. Snapshot as of **2026-06-28**.
> Deeper docs: [DESIGN.md](DESIGN.md) (product), [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md)
> (front-end), [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (back-end/data).

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
- **Theme system**: 3 themes (`fairy`, `sepia`, `moonlight`) + `default` skin, all
  CSS-variable driven (palette → theme → skin). Settings menu (click the title) with
  a **Theme** flyout (live color-chip previews) and an **Account** row.
- **Typography**: Liberation Serif (title) bundled as local TTFs via `@font-face`.
- **Home bento**: Now Playing strip (top, wide) · Library (left) · Playlists (right),
  span-based grid, columns scroll individually.
- **Apple auth**: loopback browser sign-in (themed page), MUT persisted, survives
  restarts. Account row shows ✓/✗ + spinner.
- **Library data (songs)**: end-to-end — `library_sync` pulls all songs (parallel) →
  SQLite cache → Library card lists title/artist, auto-syncs on open, refresh re-syncs.
- **Collection-card engine** (`src/collection-card.ts`): a reusable, navigable
  browser. Per-context **Sort / View / Search** pills (40/40/20); Search slides an
  inline bar down. Library (`src/library-card.ts`) drives it with **Songs / Albums /
  Artists** groupings, **drill-in** to album & artist detail (album → tracks, song →
  its album with the track highlighted), a fixed back-chevron header, and **push/pop
  pane-slide** navigation (skin-tokened `--nav-dur`/`--nav-ease`, honours reduced
  motion). Scroll restores on back. Albums/Artists are **derived from cached songs**;
  square tiles + line mini-covers render Apple artwork. State persists. Added-Date
  uses `Track.addedRank` (no per-song `dateAdded`; fetched via `sort=dateAdded`),
  negated so **most-recently-added surfaces first** — **needs a re-sync to backfill**
  old rows. Custom themed scrollbar on the list.
- **Always on Top**: settings-menu toggle row with an active dot; persists.

### Stubbed / not built yet ⬜
- **Playback** — Now Playing controls are **cosmetic** (play/pause just toggles its
  icon). No MusicKit playback. This is the big DRM unknown (see DESIGN.md §1).
- **Playlists card** — still a stub title. Next up: reuse the collection-card engine
  (a Playlists context: list overview with no View pill → playlist detail with tracks).
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
1. **Catalog hydrate** (Stage 2) — storefront lookup + batched `/catalog`
   songs→artists→albums via `playParams.catalogId`. Fills palette
   (`Artwork.bgColor`/`textColors`), real **artist photos** (square art, cropped round;
   initials fallback) + album art, plus `previews`/`isrc`. ~15 polite calls. Store
   palette on tracks; small `artists`/`albums` tables. Decided scope: **songs + artists
   + albums** in one pass.
2. **Playlists card** (Stage 3) — wire `playlists_page` + `playlist_tracks` (+ tables),
   then drive the **collection-card engine** with a Playlists context: overview list
   (Sort: A–Z / Added / Modified / Track Count; **no View pill**) → playlist detail
   (its tracks, density-only). Playlists carry real `dateAdded`/`lastModifiedDate`.
3. **CLI / local-agent control** (pre-launch goal) — a command surface so the user's
   **local models and agents can call DeetsMusic to play music** (search, queue,
   play/pause/skip, now-playing). Likely a thin Rust command layer over the same
   `player` interface (below) exposed via CLI/IPC. Design the verb set alongside
   playback so agents and the UI share one control path.
4. **Playback** — the load-bearing risk. Prove full-song DRM via MusicKit JS in
   WebView2 with a throwaway test before building real transport. May force a design
   pivot (hidden browser context, or **preview-only** via catalog `previews`). The CLI
   and UI both drive the same thin `player` interface.
5. **Per-album accent theming** — feed stored palette into the mini-player and a future
   skin (nice tie-in with the token system).
6. **Virtualized list** — only once libraries get large or artwork I/O bites.

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

---

## Key decisions made (the "why")
- **Data ≠ playback.** Library fetching is plain REST (no DRM); we built all the data
  layer without touching the DRM question.
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
src/apple.ts                auth bridge (connect/disconnect/isConnected)
src/library.ts              cache reads, sync trigger, sync-event subscription, types
src/collection-card.ts      reusable navigable browser engine (contexts/groupings,
                            Sort/View/Search, push/pop pane-slide nav, scroll restore)
src/library-card.ts         Library's contexts/groupings + drill-in; data load + sync
src/styles.css              app rules (imports the token sheets first)
src/styles/{palette,themes,skin,fonts}.css + fonts/  the token system + Liberation Serif
src-tauri/src/lib.rs        Tauri builder: state, DB open, command registry, devtools
src-tauri/src/apple.rs      dev-token signing, loopback auth, dump, AppleProvider
src-tauri/src/model.rs      normalized model
src-tauri/src/provider.rs   MusicProvider trait
src-tauri/src/library.rs    SQLite cache + sync
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

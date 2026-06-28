# DeetsMusic — Handoff / Status

> Cold-start guide. Read this first. Snapshot as of **2026-06-27**.
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
- **Library card UX**: **Sort** (A–Z / Release Date / Added Date + asc/desc), **View**
  (Albums or Songs × lines / small / large squares), and a **substring search** over
  artist/album/song. All client-side (`src/library-card.ts`); albums are derived by
  grouping cached tracks; square tiles render Apple artwork. State persists. Added
  `Track.dateAdded` to the model for the date sort (needs a re-sync to backfill).

### Stubbed / not built yet ⬜
- **Playback** — Now Playing controls are **cosmetic** (play/pause just toggles its
  icon). No MusicKit playback. This is the big DRM unknown (see DESIGN.md §1).
- **Albums / Artists / Playlists data** — model exists, only **songs** flow so far.
  Playlists card shows a title only.
- **Virtualized scrolling** — search/sort/view exist (client-side); the list/grid
  still renders all rows. Virtualize once libraries get large or artwork I/O bites.
- **Real album/artist data** — the Albums view is *derived* from songs, not synced.
- **Catalog hydration** — artwork color palettes, ISRC-rich data not fetched yet.
- **Mini player, full window, SMTC, global hotkeys** — not started.

---

## Immediate next steps (suggested order)
1. **Extend the sync pipeline to albums/artists/playlists** — same shape as songs:
   add `albums_page` etc. to the provider, tables/commands in `library.rs`, render in
   the cards. (Playlists is tiny — 47 items.)
2. **Search + virtualized list** — once multiple lists exist and we add artwork.
3. **Artwork** — render `Artwork.urlTemplate` (fill `{w}x{h}`); wire album/track art.
4. **Catalog hydration** — use `playParams.catalogId` to enrich; the artwork color
   palette can drive per-album accent theming (nice tie-in with the token system).
5. **Playback** — the load-bearing risk. Prove full-song DRM via MusicKit JS in
   WebView2 with a throwaway test before building real transport. May force a design
   pivot (e.g. play in a hidden browser context, or preview-only fallback).

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
src/library-card.ts         Library card: sort / view / search, album grouping, render
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

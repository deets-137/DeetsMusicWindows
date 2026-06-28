# DeetsMusic — UI Architecture

> How the front-end is structured. Read this before adding a theme, a skin, or a
> new view. The guiding rule: **the UI references semantic tokens only — never a
> raw hex, never a hardcoded px or font name.**

---

## 1. The three token tiers

Styling is split into three orthogonal layers. Each lives in its own file under
`src/styles/` and is `@import`ed (in this order) by `src/styles.css`.

| Tier | File | Holds | Selector | Lever |
|---|---|---|---|---|
| **Palette** | `palette.css` | raw named hexes (`--paint-fairy-wing`) | `:root` | the box of crayons |
| **Theme** | `themes.css` | color *roles* → palette | `[data-theme="…"]` | recolor the app |
| **Skin** | `skin.css` | everything non-color: type, size, radius, spacing, geometry | `[data-skin="…"]` | reshape/retype the app |

Both are set on `<html>`: `<html data-theme="fairy" data-skin="default">`.
Theme and skin are **independent** — any theme works with any skin.

### Why palette is separate from theme
Palette names a color once (`--paint-lemon-chrome: #F6C700`). Themes map *roles*
to those names. A color used by two roles is defined once; a theme is just a
short mapping block, easy to read and diff.

---

## 2. Color roles (theme)

The complete set the UI is allowed to reference:

| Role | Meaning |
|---|---|
| `--canvas` | app background / wallpaper |
| `--go` | traffic light: **maximize** (`+`) — green family |
| `--stop` | traffic light: **close** (`×`) — red family |
| `--pause` | traffic light: **minimize** (`−`) — yellow family |
| `--title` | app title + headings |
| `--text` | primary text |
| `--subtext` | secondary / dim text |
| `--surface` | floating panel background (menus, popovers) — distinct from canvas |
| `--surface-hover` | highlighted / hovered row inside a panel |
| `--border` | hairline panel edge (kept as low-alpha so it reads on any canvas) |

Traffic-light role names are deliberately function-named (`go/stop/pause`) not
color-named, so a theme can shade them to fit its canvas without the names lying.

### Themes that ship today
- **`fairy`** — powdered blue-green canvas, the original spec palette.
- **`sepia`** — warm parchment + amber, vibe pulled from the harness "Sepia Dreams".
- **`moonlight`** — dark mode: deep slate-blue canvas, slate blue-gray type (bright→dim),
  monochrome traffic lights (moonlight white→gray).

### Add a theme
1. Add any new paints to `palette.css`.
2. Add a `[data-theme="yourname"] { … }` block in `themes.css` mapping **all seven roles**.
3. Add the theme name to the `THEMES` array in `swatch.html` to preview it.

---

## 3. Skin tokens

The `default` skin defines, among others:

- **Type:** `--font-title` (Liberation Serif), `--font-body` (Liberation Sans),
  `--fs-title / --fs-text / --fs-subtext`, `--fw-*`, `--lh-text`
- **Geometry:** `--midi-w` (480), `--midi-h` (864), `--titlebar-h`,
  `--traffic-size`, `--traffic-gap`, `--traffic-glyph-fs`, `--traffic-glyph-color`
- **Shape:** `--radius-panel`, `--radius-control`
- **Spacing:** `--space-1 … --space-5`

### Add a skin
Add a `[data-skin="yourname"] { … }` block in `skin.css` defining the **same token
names** with different values (rounder corners, denser spacing, a different type
pairing). Switch with `data-skin` on `<html>`. No color belongs here.

---

## 4. The frameless window & titlebar

The OS frame is disabled (`decorations: false` in `tauri.conf.json`) and we draw
our own chrome.

- **Surfaces:** mini-player · **midi-player** (480×864, current scaffold) · full window.
- **Titlebar** (`.titlebar` in `index.html`): app title (left) + traffic lights (right).
- **Drag:** the bar carries `data-tauri-drag-region`, which makes it the OS drag
  handle. Interactive children (the buttons) opt out automatically by *not*
  carrying the attribute. `--webkit-app-region` is **not** used — Tauri's attribute
  is the supported path.
- **Traffic lights:** `+` maximize / `−` minimize / `×` close, colored
  `--go` / `--pause` / `--stop`. Glyphs always visible for now.

### Settings menu (the title is the trigger)
The `DeetsMusic` title is a `<button>` that **opts out of the drag region** and
opens a settings menu on **click** (`src/main.ts`). The menu is a list of rows;
each row can own a hover-reveal **flyout**. Today there's one row, **Theme**, whose
flyout lists the available themes and applies one on click via `src/theme.ts`
(persisted to `localStorage`, re-applied on launch). A second **Account** row holds
Apple Music sign-in (✓/✗ + spinner) — wired in `src/apple.ts` (see
[DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) §2). New settings (e.g. **Skin**) slot in
as additional rows — same pattern, no new plumbing. Because the title is now
interactive, the **draggable zone is the middle `.drag-region`** between the title and
the lights, not the whole bar.

### Panels & the bento (home screen)
The content area is a **bento grid** of **panels**. Three altitudes:
- **Panel** — the primitive (`.panel`): a rounded-rect surface with optional
  `.panel__head` (title + action slot) and a scrolling `.panel__body`.
- **Card** — a panel filled with specific content (`data-card="now-playing"`,
  `library`, `playlists`). **Library** renders real synced songs from the Rust cache
  (`src/library.ts`) with a header **refresh** action (`.panel__action`) that triggers
  a re-sync; Now Playing + Playlists are still stub/title-only.
  See **§4a** for the Library card's sort/view/search controls.
- **Screen** — a composition of cards in the grid (`data-screen="home"`). Future
  screens (Library, Search…) are just different panel sets in the same grid.

**Layout is span-based:** each panel declares its footprint (`data-span="wide"`
spans both columns); the grid flows them. The home is `auto / 1fr` rows — Now
Playing is a short wide strip up top, Library + Playlists are tall columns that
**scroll individually** (the body scrolls, the bento frame stays put).

**Panels in the default skin** are light groupers: `--panel` = `--canvas` (fill
matches the background) with a thin `1px` `--panel-border` edge to mark each
panel's bounds. All the panel tokens (`--panel` / `--panel-border` theme;
`--panel-border-width` / `--panel-radius` / `--panel-pad` skin) are swappable, so a
future skin restyles them into richer cards (heavier borders, shadows, even
wavy/rainbow edges) with **no markup change**. Note: rounded + exotic borders (gradient/wavy) can't use CSS
`border` (border-image ignores `border-radius`) — that skin will draw the edge on
a `::before` masked/SVG layer instead.

**Scrubber handle is skin-swappable:** the Now Playing handle renders from the
`--scrubber-handle` glyph token (default `●`); a skin swaps it to `▲`, an emoji, etc.

### 4a. The Library card (sort · view · search)
The Library card (`src/library-card.ts`, markup in `index.html`, styles under the
"Library card" block in `styles.css`) sits above its list a **toolbar**: two
fully-rounded **pills** — **Sort** and **View** — each opening a card-local
**popover** (`.lib-pop`, anchored to its pill), then a **search field**.

- **Sort popover** — two columns: *sort key* (`A–Z` / `Release Date` / `Added Date`)
  and a *direction* pair (asc/desc arrows). A–Z falls back to artist as a tiebreak;
  date sorts sink missing dates to the bottom either direction.
- **View popover** — two columns: *grouping* (`Albums` / `Songs`) and *density*
  (`lines` / `small squares` / `large squares`). Small squares show cover + name +
  artist; large squares show cover + artist only (tweakable). `lines` is the classic
  title/artist list.
- **Search** — case-insensitive **substring** match on title, artist, or album
  (matches mid-word). In Albums mode an album survives if any of its tracks match.

**Everything is client-side.** The card already pulls the whole library into memory
(`libraryTracks(0, 100000)`), so search, multi-key sort, and **album grouping**
(`groupAlbums` — group cached tracks by album+artist; cover from the first arted
track; release = earliest, added = latest) all run in TS — no SQL/FTS. Albums are
**derived from songs**, not a separate sync; swapping in a real `albums_page` later
is invisible to the UI. Revisit only if we virtualize or the library gets huge.

**State persists** (`localStorage` key `deets.library.view`) like the theme — sort
key/dir, grouping, density survive restarts; the search query is session-only.
Square tiles render Apple artwork by filling the `{w}x{h}` URL template
(`Track.artwork`); tiles with no art fall back to a `♪` glyph. Tile sizing is
token-driven (`--lib-tile-small/large`, `--lib-grid-gap`, `--lib-pill-radius` in the
skin), so a skin can reshape the grid with no markup change.

### Window-control wiring
`src/main.ts` calls `@tauri-apps/api/window`:
`minimize()`, `toggleMaximize()`, `close()`. These are state-changing calls, so
they require explicit permissions in `src-tauri/capabilities/default.json`
(`core:window:allow-minimize`, `…allow-toggle-maximize`, `…allow-close`,
`…allow-start-dragging`, etc.). `core:default` alone is not enough.

---

## 5. Front-end ↔ back-end seam (for later)

The UI is built against **mock data / a stub player interface** so it has no Apple
dependency yet. Playback wires in later behind a thin `player` interface
(play/pause/seek/nowPlaying/queue…) — swapping the stub for MusicKit JS should not
touch any view. Keep that boundary clean: views call the interface, never MusicKit
directly.

---

## File map

```
index.html              home markup (titlebar, settings menu, bento cards)
swatch.html             color reference — every role, every theme, read live
src/styles.css          imports tokens, then app rules (chrome, menu, panels, lists)
src/styles/fonts.css    @font-face for bundled Liberation Serif
src/styles/palette.css  Tier 1 — raw paints
src/styles/themes.css   Tier 2 — color roles per theme
src/styles/skin.css     Tier 3 — type / geometry / spacing per skin
src/styles/fonts/       bundled Liberation Serif TTFs (+ NOTICE)
src/main.ts             window controls, settings menu, account; calls initLibraryCard()
src/theme.ts            theme switch + localStorage persistence
src/apple.ts            Apple Music auth bridge (connect/disconnect/status)
src/library.ts          cache reads + sync trigger + sync-event subscription + types
src/library-card.ts     Library card controller: sort / view / search, grid render
src-tauri/tauri.conf.json          frameless window @ 480×864
src-tauri/capabilities/default.json  window-control permissions
```

> Back-end (auth, model, provider, SQLite cache) is documented separately in
> [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md).

# Library virtualization — option A (windowing) brief

Status 2026-09-13: **decided to explore, nothing built.** The user starts it on a fresh branch
and a fresh session. This file is the cold start: what was measured, how the engine works
today, what windowing must not break, and the forks to settle before code.

## Why
The collection engine renders every item. The 3,897-row Library is ~23,000 DOM nodes and
3,966 `<img>` elements in every density. Measured on the dev app, 2026-09-13
(DEBUGGING.md §"What the 2026-09-13 pass found"):

| Cost | Now | Cause |
|---|---|---|
| Skin/theme switch | 353–488 ms to the 2nd frame (worst frame 462–679 ms at 238 Hz) | style ~90 ms + layout ~180 ms over every node; the View Transition adds ~150–200 ms |
| Cold Small/Large grid scroll | 83–91% dropped, long tasks ~345 ms | the CSS Grid algorithm re-runs over all 3,893 tiles on each forced layout |
| Cold list scroll | no long tasks, worst 42–54 ms | paint/decode of covers — rows are already relayout boundaries |
| Renderer memory | ~300 MB dev, 500+ MB installed after an hour | DOM + decoded covers (not yet split — measure it first, see Tests) |
| Pane open / re-render | one `innerHTML` of all items | `renderViewInto` |

**Option B is the proven fallback** (tested with injected styles, not built):
`content-visibility: auto` on list rows → skin switch 112–145 ms; tiles wrapped in 60-tile
blocks with `content-visibility: auto` → grid scroll 23% dropped, no long tasks. B keeps the
DOM (no memory or pane-open gain). If A stalls, ship B.

## The engine today (`src/collection-card.ts`)
- `renderViewInto(pane, f)` (~line 323): list → filter → sort into `f.items`, then
  `view.innerHTML = hero + items.map((x, i) => g.render(x, f.density, i)).join("")`.
  `view.className` is `lib-view lib-list` (lines) or `lib-view lib-grid` (small/large);
  `view.dataset.grid` = density.
- **Every renderer's root element carries `data-idx`** (`Grouping.render` contract, ~line 45).
  All interaction is delegated on the viewport and maps back through `cur().items[idx]`:
  click → `activate` or `open`/drill (~line 578), right-click → `menu` + `is-context` class
  (~line 608). **This already suits windowing** — handlers never hold element references.
- Scroll state: `f.scroll` is saved on drill (~line 403) and restored by `applyScroll`
  (~line 359), which first looks for `.is-selected` and calls `scrollIntoView`. **With
  windowing the selected element may not exist** — scroll to its index instead.
- `reload()` (~line 657) re-renders and keeps `scrollTop` (background sync).
- Search input re-renders and sets `f.scroll = 0` (~line 600).
- Keyboard: only Escape (closes pops / search). No arrow-key navigation to preserve.
- Drag: none from collections (only the queue, `qcard.ts`).
- Nothing outside `collection-card.ts` queries rows or tiles (checked 2026-09-13).

**Consumers:** `library-card.ts` (songs / albums / artists, all densities), `playlists-card.ts`
(overview with collapsible **section headers** `.lib-shelf--toggle`, playlist detail rows),
`radio-card.ts` (**shelves** in grids). The Search card has its own panes (not this engine).

**Item heights:**
- Line rows: fixed, `--lib-row-h` per skin (rows are `contain: size layout`, UI-ARCHITECTURE
  "cold-scroll layout fix"). Changes on a skin switch.
- Tiles: width-dependent — `grid-template-columns: repeat(auto-fill, minmax(--lib-tile-*, 1fr))`,
  cover `aspect-ratio: 1`, plus the meta text. Measured 163 px (Small) at one width.
- Shelves / section headers: their own height; span the full grid row (`grid-column: 1 / -1`);
  collapsible (Playlists, Radio).
- The hero (album / playlist detail): variable height, first in the scroll.

## What windowing must keep
1. Click, right-click menu (and its `is-context` highlight while open), drill, back with
   scroll restored, the hero's tappable subtitle.
2. `.is-selected` reveal on mount (scroll to the index, then the element exists).
3. Background `reload()` without moving the user.
4. Sort / filter / search / density changes (re-window from the new `f.items`).
5. Skin switches (row height and tile size change → recompute geometry).
6. Window resize and surface changes (column count changes → recompute).
7. Lazy covers and `artwork-heal.ts` retries (recycled `<img>` elements must not show the
   previous item's cover — reset `src` or render fresh).
8. The frame telemetry (`frames.ts`) and the cold-scroll relayout fix.
9. Scrollbar size and position must match the full list (a spacer or padding).
10. Accessibility is currently plain divs — no regression to track, but don't make it worse.

## Forks to settle first (design on paper)
1. **Scope:** the Library only (3,897 items), or the engine for every consumer (Playlists and
   Radio have shelves and are small)? A threshold (window only above N items) is a middle path.
2. **Geometry:** fixed row height from `--lib-row-h` + computed tile rows (columns from the
   view width), or measured heights with an estimate cache (handles shelves/hero, more code)?
3. **Grid shape:** keep CSS Grid for the visible slice (rows of tiles positioned by a top
   spacer), or lay tiles out absolutely from computed geometry?
4. **DOM reuse:** re-render the visible slice as HTML on each window shift (simple, matches
   `g.render` strings), or recycle nodes (faster, but covers and classes must be reset)?
5. **Buffer:** how many rows above/below the viewport (scroll speed vs DOM size); the
   238 Hz display makes the per-shift cost visible.
6. **Keep option B's CSS too** (`content-visibility` on the slice)? Probably unnecessary.

## Tests (same tools as the 2026-09-13 pass — DEBUGGING.md §Reviewing the telemetry)
- **Before building:** renderer memory with the Library card open vs closed
  (`scripts/heaviness-sample.ps1`, `dev-page` heap/dom/imgs) — how much A can save.
- Skin switch: direct `data-skin` flip timed to the 2nd frame, and the real menu switch
  (`[perf] frames appearance`). Target: well under 100 ms.
- Cold scroll per density: the scrollbar-drag expression in DEBUGGING.md, after a
  `location.reload()`, checking decoded-image counts. Target: no long tasks in any density.
- `webview-profile.mjs --trace` on each for Layout / UpdateLayoutTree / Paint totals.
- By hand (the user): drill + back restores place, selected item reveal, right-click on a row
  near the window edge, search while scrolled, resize across a column-count change, Playlists
  folder collapse, sync while scrolled.

# Library virtualization — option A (windowing) brief

Status 2026-09-13 (late): **BUILT on branch `optimus-deets`, measured, scripted checks pass;
desk-tested, committed 7dbf56f and shipped in 0.4.0.** `src/collection-window.ts` + the engine hook-up; the living
description is UI-ARCHITECTURE.md §"Long lists: windowing". Results at the end of this file.
The sections between are the design record (the brief, the scope, the forks as settled).

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

---

## Scope and build evaluation (2026-09-13, second pass — nothing built)

Read against the code on branch `optimus-deets` (`collection-card.ts` 678 lines,
`library-card.ts`, `playlists-card.ts`, `radio-card.ts`, `styles.css`, `skin.css`).

### Facts that settle the forks
- **Rows are already fixed-height** where it matters: every row with art is
  `contain: size layout; height: var(--lib-row-h)` (46 px base, 49 px on two skins). Rows
  **without** art keep their natural height — album detail (numbered, `hideCover`) — and those
  lists are small.
- **Tiles are fixed-height per width**: cover is `aspect-ratio: 1` at column width; name and
  sub are single `nowrap` lines. One wrinkle: a tile with a badge uses `.lib-tile__subrow`
  (`line-height: 1`), so its height can differ from a badge-less tile by a pixel or two. A
  windowed grid needs one height per row → pin `.lib-tile__meta` to a two-line token height.
- **Columns are `repeat(auto-fill, minmax(--lib-tile-*, 1fr))`** — the resolved count is
  readable from `getComputedStyle(view).gridTemplateColumns.split(" ").length` once the grid
  is laid out. No need to re-derive the CSS Grid math in TS.
- **Shelves and heterogeneous lists exist only in small lists** (Playlists overview, Radio
  root). Every list that can exceed a few hundred items is homogeneous: Library songs /
  albums / artists, and a long playlist's detail rows.
- **Nothing holds element references.** Click, right-click and drill go through `data-idx`
  → `cur().items[idx]`. `artwork-heal.ts` sweeps `img[data-art]` document-wide; `frames.ts`
  listens for scroll on `document`. Neither needs a change.
- **No appearance event exists** to hook a re-measure on a skin switch
  (`withAppearanceTransition` takes an `after` callback but it is per call). A
  `ResizeObserver` on the view catches width changes; a skin switch changes row height
  without changing the view's width, so the window pass must re-read item height itself.

### Decisions (recommended answers to the six forks)
1. **Scope: the engine, gated.** Window a pane when `items.length > WINDOW_MIN` (start at
   200) **and** the grouping does not opt out. Add `Grouping.mixed?: true` for the shelf
   groupings (Playlists overview, Radio root) — they never cross the gate today, the flag is
   insurance. Under the gate the pane renders exactly as now (one `innerHTML`), so small
   panes carry zero new risk.
2. **Geometry: measured, not tokened.** After the slice is mounted, read the first item's
   `offsetHeight` (row or tile), the grid's column count, and the hero's `offsetHeight`. One
   layout read per window pass, after a scroll (layout is clean, so it is cheap). No skin
   hook needed: the next pass after a switch sees the new height. Item `i` sits at
   `heroH + floor(i / cols) * (itemH + gap)`; lists have `cols = 1`, `gap = 0`.
3. **Grid shape: keep CSS Grid for the slice.** The view stays `.lib-grid`; two spacer
   elements (`.lib-spacer`, `grid-column: 1 / -1`, height set inline) sit above and below
   the slice. The slice always starts and ends on a **row boundary** (`start = rowStart *
   cols`), so the grid's auto-placement lines up. The Grid algorithm then runs over
   ~100–150 tiles instead of 3,893 — the exact cost the trace blamed.
4. **DOM: edge patch, not re-render, not recycle.** On a shift from `[a, b)` to `[a2, b2)`:
   remove children whose `data-idx` fell out of range, `insertAdjacentHTML` the missing
   range at the top or bottom, update the spacers. Visible nodes are never re-created — no
   cover flash, hover and `is-context` survive, `<img>` elements are never reused so item 7
   can never show item 3's cover. Cost per shift: ~20–60 new items as one HTML string.
5. **Buffer: one viewport above and below**, in whole rows. Re-window when `scrollTop` has
   moved more than half a viewport from the last anchor. The scroll listener is
   rAF-coalesced (one check per frame at 238 Hz, a compare of two numbers when idle).
6. **Option B CSS: no.** The existing `contain: size layout` rows stay. Nothing else.

Add to `Grouping`: `isSelected?: (x) => boolean` (Library's songs grouping already knows
`selectedId`; expose it) so `applyScroll` can compute the index, position the window on it,
then `scrollIntoView` the element that now exists.

### Changes, by file
| File | Change | Size |
|---|---|---|
| `src/collection-window.ts` (new) | the windower: `mount(view, f, render)`, `onScroll`, `measure`, `patch(a2, b2)`, `scrollToIndex(i)`, `destroy` | ~200 lines |
| `src/collection-card.ts` | `renderViewInto`: above the gate hand the view to the windower instead of the full `innerHTML`; `applyScroll`: selected → index → `scrollToIndex`; `reload()` and search input: re-window keeping `scrollTop`; density / sort / grouping changes: rebuild the window from the new `f.items`; `destroy`: drop the windower; add `mixed` + `isSelected` to the `Grouping` type | ~60 lines changed |
| `src/styles.css` | `.lib-spacer` (block in lists, `grid-column: 1 / -1` in grids), `.lib-tile__meta` fixed height via a new skin token | ~10 lines |
| `src/styles/skin.css` | `--lib-tile-meta-h` per skin (measure: two `--fs-subtext` lines + gap) | 3 lines |
| `src/library-card.ts` | pass `isSelected` on the songs grouping; nothing else | ~3 lines |
| `src/playlists-card.ts`, `src/radio-card.ts` | `mixed: true` on the shelf groupings | 2 lines |
| `docs/UI-ARCHITECTURE.md`, this file, `DEBUGGING.md` | the windower section, the numbers | docs |

Not touched: `artwork-heal.ts`, `frames.ts`, `context-menu.ts`, `track-store.ts`, the
Rust side, every renderer's HTML.

### What it buys (expected; measure before and after)
| Cost | Now | Expected with A | Why |
|---|---|---|---|
| Skin / theme switch | 353–488 ms | under 100 ms for the Library's part | style + layout over ~1,000 nodes, not 23,000 (the View Transition's 150–200 ms is separate — *Animate look changes* Off already removes it) |
| Cold grid scroll | 83–91% dropped, ~345 ms long tasks | no long tasks | the Grid algorithm sees ~150 tiles |
| Cold list scroll | worst 42–54 ms | about the same | it was paint/decode, and the window still decodes what is visible |
| Pane open, drill, back, sort, density | one `innerHTML` of 3,897 items | ~150 items | the slice |
| Renderer memory | ~300 MB dev, 500+ MB installed after an hour | smaller — **not yet measured** | DOM + decoded covers of the window only; the first test below puts a number on it |
| Background `reload()` (library sync) | full re-render, place kept | slice re-render, place kept | same path |

### Risks, honest
- **Tile height drift** (the badge subrow) breaks row alignment until the meta height is
  pinned. Do the CSS first and check every skin at both densities.
- **Scrollbar thumb jumps** if the measured item height is wrong for one render (a skin
  switch mid-scroll). Self-heals on the next pass; visible as a one-frame jump. Acceptable.
- **`scrollIntoView` for the selected item** now depends on the window being placed first.
  A wrong index math shows as "back does not restore the place" — the user's hand test.
- **`reload()` while the user scrolls**: the edge patch runs against a new `f.items` array;
  if the sort changed under the sync (it does not today — same sort, new data) indices
  shift. Rebuild the window fully on `reload()` (cheap) instead of patching.
- **Playlist detail with a hero above the gate** (a 1,000-song playlist): the hero's height
  is measured, so it works, but it is the one path with a variable top offset — test it.
- **A real limit:** WebView2's native `Ctrl+F` bar only finds rendered rows of a windowed
  list (~150 of 3,897). The Search pill is the app's find; see "Find-in-page" below.

### Verdict
**Build it.** The engine already routes everything through `data-idx`, item heights are
fixed or measurable, and the risky part (a homogeneous slice inside a spacer sandwich) is
~200 lines behind a gate that leaves every small pane untouched. One session to build,
one desk test for the hand list above. Option B stays the fallback only if the tile-height
pin fails on a skin.

**Order of work:** (1) the memory measurement below, Library open vs closed, on the dev app;
(2) the `--lib-tile-meta-h` pin and a skin check; (3) the windower for lists, gate on;
(4) grids; (5) `isSelected` + scroll restore; (6) `reload()` and search; (7) the numbers
into DEBUGGING.md.

### Find-in-page: the foundation (2026-09-13)
Nothing in the app searches the DOM today: there is no `Ctrl+F` handler of our own, agents
read the model over the bridge (AGENT.md routes), and the pane's own Search pill filters
`f.items`, not elements. **WebView2's native `Ctrl+F` bar does work in the app** (the user
confirmed 2026-09-13, same as Edge); after windowing it finds only the rendered rows of a
long list — the Search pill is the app's find, and the jump mode below is its Ctrl+F. The one DOM scan is the engine's
`.is-selected` → `scrollIntoView`, which this scope replaces.

**Rule: every finder searches the model and reveals by index.** The windower exposes one
primitive, `reveal(index, block)`: place the window so the item exists, then scroll it into
view. Everything sits on it, now and later:
- scroll restore and the selected row (this build);
- a **jump mode** on the Search pill — Enter cycles matches with the list intact instead of
  filtering (later, one setting or a modifier);
- an agent route (`POST /reveal {id}` → the card finds the index in the current view and
  reveals it) so a CLI can "show me this song" (later, AGENT.md);
- type-to-jump / an A–Z rail for the sorted list (later).
No feature may query rows by text or class to find an item. Under the gate the same
`reveal` works on the full render, so callers never know whether a pane is windowed.

### Keyboard and edge cases (2026-09-13)
**Keyboard today:** the engine handles only Escape. Rows are plain divs (not focusable, no
Tab order). Native scrolling of a focused view — arrows, PageUp/PageDown, Home/End, Space —
works on `scrollHeight`, which the spacers keep truthful, so it keeps working. A future
arrow-key row navigation goes through `reveal(index)`.

Cases the build must handle (add to the hand test):
1. **Home / End / scrollbar drag to the far end** — a jump larger than the buffer. Run the
   window pass **synchronously inside the scroll handler** when the jump exceeds the buffer;
   otherwise one blank frame shows the spacer.
2. **Chromium scroll anchoring** — inserting rows above the viewport and resizing the top
   spacer in the same frame lets the browser "help" by adjusting `scrollTop`, which doubles
   the correction and jitters. Set `overflow-anchor: none` on the windowed view. (No rule
   exists today.)
3. **Anchor by index, not pixels.** A skin switch (46 → 49 px rows), a resize across a
   column-count change, or a surface flip (mini ↔ max) changes the geometry under a fixed
   `scrollTop`, moving the user's place by up to ~6% of the list. Remember the first visible
   item's index before each re-measure and restore to it after. Same for `f.scroll` on
   drill-back: store the index (plus the pixel offset within the row) instead of raw px.
4. **Fast flick on the 238 Hz screen** — each pass inserts ~20–60 items; at one pass per
   frame the cost is 1–3 ms, but covers stream in lazily so the incoming edge may show
   placeholder squares for a few frames. Acceptable; a larger buffer hides it at a memory
   cost. Tune with `[perf] frames scroll`.
5. **Right-click near the window edge, then wheel** — the context menu already closes on
   scroll; the `is-context` row may then be removed. Harmless (the close callback touches a
   detached element).
6. **Background `reload()` while scrolled** — rebuild the window from the new list at the
   same index. Hover is lost until the mouse moves, exactly as today's full re-render.
7. **Sync inserts rows above the place** (a song added on the phone lands at the top in
   Added-Date order) — index-anchoring keeps the same row on screen only if the anchor is
   the item, not the index. Anchor on the item's id when the grouping exposes one; else the
   index (today's behaviour is a pixel keep, which has the same drift).
8. **Select-all / text drag across the window edge** — selects only rendered rows. Rows are
   not meant to be selectable text; no change in practice.
9. **Zoom** — Tauri's `zoomHotkeysEnabled` is off, so Ctrl+wheel cannot change row height.
   If it is ever turned on, case 3 covers it.
10. **Screen readers** — off-screen rows vanish from the accessibility tree. Rows are
    unlabeled divs today, so nothing is lost; noted for the day rows get roles.

---

## Results (2026-09-13, built the same evening)

Dev app, Cyber, midi surface (the Library slot ~220 px wide → 2 small columns, 1
large column), 3,898-song Library, 238 Hz display. Same tools as the before-numbers
(DEBUGGING.md §Reviewing the telemetry): the scrollbar-drag expression after a
`location.reload()`, a direct `data-skin` flip timed to the 2nd frame, the heaviness sampler.

| Cost | Before | After | Note |
|---|---|---|---|
| Skin flip, Library open (4 skins) | 395–558 ms | **16–40 ms** | the View Transition (*Animate look changes*) adds its own ~150–200 ms on top of either |
| Cold drag, Small grid | 75% dropped · worst 342 ms · 7 long tasks | **3.7% dropped · worst 8 ms · none** | the drag jumps ~33 rows a frame — harsher than a hand |
| Cold drag, Large grid | 82% · worst 304 ms · 7 long tasks | **1.2% · worst 21 ms · none** | |
| Cold drag, lines | 98.7% (at 238 Hz) · worst 46 ms | **12.8% · worst 29 ms** | it was paint/decode before; now it is ~10 new rows a frame |
| DOM nodes, Library open | 23,093 (3,943 `<img>`) | **~850–1,000** (80–110 `<img>`) | |
| Renderer working set, Library open | 467 MB (closed: 150 MB) | **214–277 MB** at 1–80 min | the 15 s sampler loop the user runs gives the settled number |
| Pane open / rebuild | one `innerHTML` of 3,898 items | seed 16 + the buffered window (~40–60 items) | a rebuild's longest task ~50–70 ms incl. the sort of 3,898 |

**Scripted checks that pass** (`webview-eval`, all while scrolled to 40 k–120 k px): End and
a 40 k jump render the right rows in the same frame; every density × grouping × sort switch
keeps scrollTop and the open Sort/View pop (30 switches, twice); drill into an album and
back restores the exact place from 120,000 px; search narrows and clears in place; skin
flips through all four skins keep the same first visible row (46 ↔ 49 px rows re-anchor);
all 30 sampled tiles are one height.

**Bugs found and fixed on the way** (each is a comment in the code): the engine's
`className` reset dropped `overflow-anchor: none` → Chromium moved scrollTop 2.7 k px during a
rebuild and closed the pop; a rebuild that cleared the view fired a scroll event (pop closed);
spacers sized with an unknown pitch collapsed the scroll height (and faked a perfect drag
result); the hero offset read from a `display: none` spacer; a rebuild at the list's end
clamped because the height was read after the rows were removed; a saved scroll applied to a
fresh pane before its spacers existed clamped to the seed's height.

**Desk test, first round (the user, 2026-09-13 late):** a 216-song playlist detail (the
windowed pane with a hero) showed the hero's cover as the empty ♪ in midi and as a single
cover in max. **Not the windower** — the detail hero and the overview row read
`Playlist.coverUrls`, which Rust derives from its content cache, so it is empty on a
playlist's first open and partial while a paged fetch lands, and the drilled context held
that snapshot. Fixed in `playlists-card.ts`: `coverOf(p)` derives the four-cover mosaic from
the cached tracks in hand (same rule as Rust's `mosaic_urls`), falling back to the row's
`coverUrls`; the hero re-renders when the tracks land. Verified: row and hero both show four
covers, and the hero survives a scroll down and back up.

**Still to hand-test (the user):** a real scrollbar drag and a wheel flick at 238 Hz; a
right-click near the window edge then wheel; the max surface (more columns); the installed
build's memory after an hour.

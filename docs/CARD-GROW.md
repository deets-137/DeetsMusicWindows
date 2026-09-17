# DeetsMusic — growing a card

**Designed 2026-09-16. BUILT 2026-09-16 on branch `grower-not-shower`, awaiting the desk test
(§11).** What the build changed against the design is §13. The forks and the decisions are §12. Reviewed the same day
for large libraries and discoverability: forks 7–10 added (a header button, the Library MVP
layouts, no memory, and the resting layout stays almost pixel-identical, §0). The wide-card layouts (§9) are a list the user hand-designs after the MVP.

**MVP = §3–§7 + §9a.** The MVP is judged on the Library card: a Fill of the tile view shows about
four times the tiles; the song list gets columns and a letter rail, or a grow shows the same rows
wider. The other cards grow with no new layout in the MVP.

A content card can take more space for a short time. You click the gap beside the card. The
card opens over its neighbor, or over all four content cards in Max. The layout with four
cards does not change. Nothing is saved when the app restarts.

Files: `src/card-grow.ts` (zones, state, motion, the Grow button, the title menu) · `src/layout.ts`
(the covered-card rules, the pick rule) · `src/collection-card.ts` (the columns, the rail) ·
`src/library-card.ts` (the song columns and their sorts) · `src/styles.css` §Card grow ·
`src/styles/skin.css` (the `--grow-*` tokens) · `src/styles/themes.css` (`--grow-zone-bar`,
`--rail-ink`, `--rail-ink-lit`).

---

## 0. The constraint: the resting layout does not change

**The classic four-card Max layout, and Midi, must stay almost pixel-identical when no card is
grown.** This is a hard rule for the build (2026-09-16). Every part of the feature is either
absent at rest, or out of flow and unpainted at rest:

| Part | At rest |
|---|---|
| The bento grid, `.panel`, `.panel__head`, the gaps and the padding | Untouched. No new CSS on them. |
| `data-grow` | Absent. Every new selector is scoped under `[data-grow]`, `.is-grown` or `.is-covered`, so no rule applies at rest. |
| The edge-zone overlay | One absolutely positioned layer in `.app-body`. It has no background and no border. It paints nothing until a zone is hovered, and then only the accent bar inside the gap, never over a card. Pointer events on the zones only, so clicks elsewhere pass through as today. |
| The Grow button | **Not in the DOM at rest.** It enters on header hover (pointer inside `.panel__head`), absolutely positioned at the right end of the title's box, before the first action square. It takes no flow space, so the title and the squares do not move. It leaves when the pointer leaves the header. While the card is grown it stays, in flow if that is simpler, because a grown card is not the resting layout. |
| The letter rail and the song columns | Only under `[data-grow]`. The plain row and the scroller are untouched. |
| `inert` / `visibility: hidden` on covered cards | Only during a grow. Collapse removes both. |
| Settings › Window | Three new rows. A settings row is not the resting layout. |

The check is a screenshot of each surface and skin at rest before and after the build, compared
by eye and by a pixel diff (`scripts/webview-eval.mjs` can take the screenshot). A diff at rest
is a bug in the build, not a design change.

## 1. Terms

- **Grow:** a card takes the space of two cards. It covers the card next to it.
- **Fill:** a card takes the space of all four content cards in Max. The Now Playing stage
  and the Queue card stay.
- **Edge zone:** a part of a gap that you click.
- **Grow zone** (yellow in the design picture): an edge zone between two content cards.
- **Fill zone** (green in the design picture): an edge zone on an outer edge of the 2×2 block
  of content cards.
- **Covered card:** a card under a grown card.
- **Pin:** a button in the grown card's header. A pinned card does not collapse when you
  click outside it.
- **Grow button:** a glyph in every content card's header actions (fork 7). It is the visible
  path to Grow, Fill and Collapse. The edge zones are the fast path.
- **Letter rail:** a column of letters A–Z down the right side of the Library song list in a
  grown card (fork 8). A click on a letter jumps the list to that letter.

## 2. The surfaces

| Surface | Grow zones | Fill zones | Results |
|---|---|---|---|
| Max | the gaps inside the 2×2 block | the top edge and the stage-side edge of the 2×2 block (not the window edges, fork 7) | Grow right / left / up / down, Fill |
| Midi | the gap between `left` and `right` | none | Grow left / right (the card covers the full content row) |
| Mini | none | none | — |

The stage column (Now Playing + Queue) never grows and is never covered.

## 3. Edge zones (fork 1A, 2B)

The grid gap is `--panel-gap` (12 px). The two cards on its sides share it.

- **A shared gap splits at its middle line.** Each half belongs to the card beside it. A click
  on the left half of the gap between `left` and `right` grows `left` to the right.
- **On hover, an accent bar shows on the edge of the card that will grow** (a Grow zone), or
  along the card's full outer corner (a Fill zone). You see the result before you click.
- **Fill zones are one click.** The design choice is one strong click, separate from Grow.
  - The top Fill zone is the padding between the title bar and the cards. It is the full 12 px.
  - The Fill zone on the stage side is the gap between the stage column and the card. The
    stage never grows, so the full 12 px belongs to the card.
  - **There are no Fill zones on the window edges (fork 7).** The window has no OS frame
    (`decorations: false`), and Tauri takes the outer **5 px** (`BORDERLESS_RESIZE_INSET` in
    `tauri-runtime-wry/src/undecorated_resizing.rs`) as the resize band. A 7 px zone beside
    that band turns a missed resize drag into a Fill. So `right` fills from its top edge,
    and `d` fills from the Grow button (below) or from a grown state (a Grow zone on a grown
    card gives Fill).
- **The zones are part of the bento, not the cards.** One overlay layer in `.app-body` places
  them from the grid's measured rects. A card's own inner edge is ruled out as a zone: the
  scrollbar sits there.
- **A grown card has its own zones.** A Grow zone on its remaining inner edge gives Fill.
  A Fill zone on a filled card does nothing (fork 4C: see §5 for Collapse).
- **The Grow button (fork 7, kept out of the resting layout by §0).** One glyph per content
  card. It is not in the DOM at rest. It enters on header hover, absolutely positioned at the
  right end of the title's box, so nothing in the header moves. It is the visible path once the
  pointer is in the header, which is where every card interaction starts. Its action depends on
  the state:
  - At rest: **Grow** toward the neighbor with the most room (Max: the other card in the same
    row; Midi: the other card). Its hover hint names the direction ("Widen over Search").
  - Grown (wide or tall): **Fill** (Max only; in Midi the second click collapses).
  - Filled: **Collapse**. So in Max, three clicks go around: rest → wide → full → rest.
  - The glyph changes with the state (an outward arrow at rest and wide, an inward arrow when
    filled). The hint changes with it.
  - Right-click on the button opens the same **Grow ▸** / **Fill** menu as the title menu, for a
    direction the button does not pick.
- **Keyboard and right-click:** the card title's right-click menu gets **Grow ▸** (the
  directions that exist in this slot) and **Fill**. This is the path without a pointer, and a
  row in the ONBOARDING.md right-click table.

Tokens: `--grow-zone-bar-w`, `--grow-zone-bar-color` (theme role). The Grow button uses the
header action tokens that exist.

## 4. The grow (layout)

- **The grown card overlaps. It does not replace.** In CSS grid, items with a set
  `grid-area` can overlap. The grown panel gets a span (for example `grid-column: left / right`)
  and a higher `z-index`. The covered cards stay in their areas, mounted.
- **Covered cards keep their state.** Their scroll position and their open drill stay.
  Nothing remounts. Collapse shows exactly what was there.
- **After the motion, covered cards get `inert` and `visibility: hidden`.** They take no
  input and add no paint cost (Ocean sand, Glass frost). Collapse removes both before the
  reverse motion starts.
- **The panel gets `data-grow="wide" | "tall" | "full"`.** CSS for a wide card (§9) keys off
  this attribute.
- **Lists follow the new size without new code.** `collection-window.ts` watches each list
  with a `ResizeObserver` and fills its rows again. The Library tile views use `auto-fill`.

## 5. How it ends (fork 4C)

- **The Grow button** (§3). In the filled state it is the Collapse button. In a wide or tall
  state it gives Fill in Max; in Midi it collapses. The title menu always has **Collapse**
  while the card is grown, so a wide card in Max has a one-click collapse without a pointer
  in a zone.
- **An edge zone of the grown card.** A click on any of its zones collapses it.
- **Esc** collapses it, unless a menu, a dropdown or a text field has focus (that Esc closes
  the menu first, as today).
- **A click outside the card** collapses it when the setting row "Collapse on outside click"
  is on (§8). The stage column counts as outside.
- **The Pin button** shows next to Collapse while that setting is on. A pinned card ignores
  outside clicks. Collapse, its edge zones and Esc still work. The pin ends when the card
  collapses.
- **A surface change** collapses it with no motion.
- **Midi ↔ Max:** the grow does not carry over. The two surfaces use different maps.

## 6. The motion (fork 3A)

The aim is an opening, not a stretch. The card takes its new size one time, and its content
builds again at that size.

1. **Measure.** Read the panel's rect at rest (`from`).
2. **Set the final layout.** Set the span and `data-grow`. The card lays out one time at its
   final size (`to`). The list pass runs one time.
3. **Open the clip.** In the same frame, the panel gets `clip-path: inset(...)` set to the
   `from` rect in the `to` box, rounded by `--radius-card`. The clip animates to `inset(0)`.
   The edge that moves is the edge you clicked. A Fill opens from the card's corner.
4. **Build the content again.** The header stays still. The body content fades out quickly
   at the start of the opening. At the end, the rows come in through `enterRows`
   (`src/pop.ts`), with a stagger, at the new width. So the card "unfurls" and then its content
   sets itself up again.
5. **Covered cards** fade under the opening edge (opacity only). They then get `inert` +
   `visibility: hidden` (§4).
6. **Collapse is the reverse.** The rows go, the clip closes to the old rect, the span goes,
   and the rows come in at the old width.

- **Why not width and height on each frame:** each frame would run layout and the list pass.
  On the 3,895-row Library this is the costly path (DEBUGGING.md §Graphics).
- **Why not a scale transform:** the text stretches during the motion.
- **Cost:** during the motion, the clip cuts the panel's shadow and Ocean's rims. They come
  back when the clip is removed. A skin can set `--grow-clip-pad` to open the clip past the box
  by the shadow's reach.
- **Tokens (skin.css base, a skin overrides):** `--grow-dur`, `--grow-ease`,
  `--grow-body-fade`, `--grow-rows-delay`. Retro-Future can use a stepped ease, as it does for swaps.
- **Reduced motion** snaps: no clip and no row entry.
- **Telemetry:** the panel sets `dataset.frames = "grow"`; frames.ts logs one `[perf] frames
  grow …` line per open and per collapse. Measure on `npm run dev:built`.
- **Open question for the build:** during the opening, does the old content (at the old width)
  stay visible and clipped? Or does the body stay empty until the rows come in? Try both on
  the desk.

## 7. Covered cards and card picks (fork 5A, 6A)

- **A request for a covered card collapses the grow first.** Then the request runs as it does
  today (`onCardRequest` in layout.ts: a summon, the chip flight, "Go to"). This needs a
  `covered` check next to `onScreen()`. `onScreen()` checks `getClientRects()`, and a covered
  card still has a box, so today it counts as visible.
- **A request for the grown card itself** does nothing new.
- **During a row drag, covered cards are not drop targets.** `setCardHostLookup` returns
  `null` for a covered slot.
- **A pick in the grown card's title picker** follows the setting row "Grown card on card pick":
  **Keep grown** (default) swaps the card and keeps the span; **Collapse** collapses first,
  then swaps. If the picked card is a covered card, the two exchange, and the grow stays on the
  slot you picked in.

## 8. Settings rows (Settings › Window)

| Key | Label | Pills | Default | Why |
|---|---|---|---|---|
| `cardGrow` | Grow cards from edges | On / Off | On | The feature is new and must be easy to turn off. |
| `cardGrowOutside` | Collapse on outside click | On / Off | On | A grow is temporary. Pin covers the case where you want it to stay. |
| `cardGrowPick` | Grown card on card pick | Keep / Collapse | Keep | Decided 6A. |

Each key gets a spec in `agent-settings.ts` and a line in AGENT.md. Each row gets a hint in
the ONBOARDING.md ledger.

**No memory (fork 9, C1).** A grow ends with the app. Pin holds a card for the session only.
A user who wants Library big at every launch uses Max and grows it. If that turns out to be a
daily habit, the follow-up is one row here, **Remember pinned card** On / Off (default Off),
that stores `{surface, slot, mode}` when a pinned card is grown and restores it at launch.
Not in the MVP.

## 9a. The MVP layouts — Library (fork 8, B2)

Why these two, and why in the MVP: at the default Max size (1100 × 820) a content card is about
356 × 372 px. Fill gives about 712 × 756 px. Rough counts for the Library card:

| View | At rest | Fill |
|---|---|---|
| Song rows visible | ~6 | ~14 |
| Small tiles visible | ~12 | ~48 |

The tile views get a real overview with no new code (`auto-fill`). The song list does not: a
wider row shows the same title and badge with more space between them, and fourteen of 3,895
rows is not a big picture. A large library is crossed by a jump, not by more rows. So the MVP
adds two things to the Library song list, both keyed off `data-grow`:

1. **The letter rail.** A column of letters down the right side of the list, in a grown card
   (wide, tall or full). A click on a letter calls `reveal(index)` on the windower with the
   first row whose sort key starts with that letter. Letters with no rows are dimmed. The
   rail shows only while the sort is A–Z (title, or artist / album in those groupings);
   under another sort it hides. It sits outside the scroller so the scrollbar stays where it
   is (checklist 6a). Hover hint: "Jump to this letter". Tokens: `--grow-rail-w`,
   `--grow-rail-fs`, the letter color is a theme role.
2. **Song columns.** In a wide or full card the song row becomes Title · Artist · Album · Time
   · ♥. Full adds Date Added and Plays. A click on a column header sorts by that column
   (the Sort dropdown stays and shows the same choice). The tall state keeps the plain row.
   Column widths are tokens (`--grow-col-*`). The windower renders the same rows; only the
   row's CSS changes, so the list pass costs the same.

Both are Library-only in the MVP. The Playlist drill and the History card use the same row
shape and can take the columns later with a selector change.

## 9. Wide cards (hand-designed after the MVP)

A grown card can be very wide (Fill on a large Max window is more than 1,000 px). A list row made
for 300 px looks empty at that width: the title sits far left and the badge far right. These
are ideas for each card. **The user hand-designs the big panels after the MVP ships**; this table
is the starting list, not a plan. Each one is a separate step.

**How to switch the layout.** Two ways, to decide at build time:
- **`data-grow` selectors.** Simple. They cover a grown card only.
- **Container queries** (`container-type: inline-size` on the panel body, `@container
  (min-width: …)` from skin tokens). They also cover a wide Midi window. **Risk:** a container
  gets layout containment, and it becomes the containing block for `position: fixed` children.
  Check every menu and popover in a card first (the slot picker, dropdowns, the context menu).

**Apple calls.** A bigger image uses the same artwork URL template at a bigger `{w}x{h}`. This
is not an Apple API call, but it is a new image download. Check the cover and artist-photo
cache keys for size before a card asks for bigger art.

| Card | Wide (Grow right/left) | Full (Fill) |
|---|---|---|
| **Library — list view** | Song rows become columns: Title · Artist · Album · Time · ♥. A click on a column header sorts (the Sort dropdown stays). | Same columns, plus Date Added and Plays. |
| **Library — small / large tiles** | More tile columns (`auto-fill` does this today). A tile size step up is a token per `data-grow`. | Album drill as two panes: the tiles on the left, the open album on the right. The drill does not replace the grid. |
| **Album drill** | A large cover on the left, the track list on the right. | The same, with the album's other versions and "More by artist" under the cover. |
| **Artist view** | A bigger round hero, with the name and the Play / Shuffle buttons beside it, not under it. The Songs list gets columns. | The hero and "Popular" top songs side by side. The Featured and Your Playlists shelves change from sideways scrollers to wrapped rows of larger tiles. |
| **Playlists** | Two panes: the playlist list as a sidebar on the left, the open playlist on the right. | The same, with the playlist cover and its details as a header over the song columns. |
| **Home** | Each shelf shows more tiles before it scrolls. | The shelves become wrapped grids. There is no sideways scroll. |
| **Search** | The result groups sit side by side: Songs · Albums · Artists. | The same, with Playlists and Stations as more columns. |
| **History** | Rows get a "played at" column. | Day groups become columns, or a table with Date · Time · Song · Artist. |
| **Rewind** | The winner on the left, the runners-up on the right. | The same, with a bar per runner-up for minutes played. |
| **Settings** | Two panes: the section list on the left, the open section on the right. | Same as wide. |
| **Radio** | Larger station tiles. | Recents and genres side by side. |

**Tall** (Grow up/down) mostly needs no new layout: more rows show. The artist hero and the
Rewind winner can stay as they are.

## 10. Build checklist (CLAUDE.md › Working style)

1. **Motion:** the clip opening (§6), `enterRows` for the rows, the Pin button and the letter
   rail come in through `enterRows`, and a `prefers-reduced-motion` rule for the clip. Read
   pop.ts first: a Fill of the tile view enters ~48 tiles plus the buffer, so check that
   `enterRows` caps its stagger, or cap it here.
2. **Tokens:** `--grow-*`, `--grow-rail-*`, `--grow-col-*` in skin.css base; the zone bar color
   and the rail letter color are theme roles in themes.css; regenerate TOKENS.md in the same
   commit.
3. **Hints:** the Grow button (one hint per state: "Widen over Search", "Fill the window with
   this card", "Collapse this card"), Pin, the edge zones, the letter rail and the column
   headers go in the ONBOARDING.md ledger. The Grow button and the rail are new row shapes
   for its SHAPES table.
4. **Toasts:** none planned.
5. **Settings keys:** the three rows in §8.
6. **Log lines:** `diag.log` for grow (slot, direction), collapse (the cause: button, zone, Esc,
   outside, request, pick, surface), pin and unpin.
6a. **Scrollbars:** no new scrolling element.
7. **Telemetry:** `dataset.frames = "grow"`.
8. **Check:** `npx tsc --noEmit` and `npx vite build`, then the desk test (§11).

## 11. Desk test (first slice, §3–§7 + §9a)

0. **Rest check (§0).** Before the build: a screenshot of Max and Midi at rest, each skin. After
   the build, the same screenshots. Compare by eye and by pixel diff. Hover a card header: the
   Grow button appears and nothing else moves. Leave the header: it goes.
1. Max, each skin. Hover each Grow zone. The bar shows on the card that will grow.
2. Click the gap half beside `left` toward `right`. `left` opens over `right`. Its rows come in
   at the new width. `right` is hidden and takes no clicks.
3. Scroll `right` and open a drill before step 2. After Collapse, the scroll and the drill are
   still there.
4. Click the top Fill zone of `right`. `right` fills the four content cards in one click. The
   stage and the Queue do not move. `d` has no top or stage-side zone: its Grow button is the
   path (step 5).
5. The Grow button on `d`, three clicks: rest → wide (over `c`) → full → rest. The glyph and
   the hint change with each state. Right-click the button: the Grow ▸ / Fill menu opens.
   Move the pointer to the window's right edge: only the resize cursor shows, no zone bar.
   Resize the window while a card is filled.
6. Collapse by each path: the Grow button, the title menu, an edge zone, Esc, an outside
   click. Pin, then click outside: the card stays. Esc still collapses it.
6a. Library song list, A–Z sort, grown wide: the letter rail shows. Click "M": the list jumps
   to the first M title. Click a dimmed letter: nothing. Switch the sort to Date Added: the rail
   hides. Grow tall: the rail shows, the row stays plain.
6b. Library song list grown wide: the row shows Title · Artist · Album · Time · ♥. Click the
   Album header: the list sorts by album and the Sort dropdown shows Album. Fill: Date Added
   and Plays columns appear. Collapse: the plain row returns and the scroll place is kept.
6c. Library small tiles, Fill: about four times the tiles. Scroll to the end: no stagger
   backlog, no blank rows.
7. With `library` grown over `search`, press the Now Playing queue button (Midi) or use "Go to"
   for Search. The grow collapses, then the request runs.
8. Drag a row while a card is grown. A covered card never highlights as a drop target.
9. Pick a card in the grown card's title picker with "Grown card on card pick" = Keep, then =
   Collapse.
10. Midi: grow `left` over `right` and back.
11. Switch Midi ↔ Max while grown. It collapses with no motion.
12. Reduced motion on: every grow and collapse snaps.
13. `[perf] frames grow …` lines on `npm run dev:built`, judged against the `@N Hz` line.

## 12. Decisions (2026-09-16)

| Fork | Choice |
|---|---|
| 1. Click target | **A** — the shared gap splits at its middle line; a hover bar shows which card grows. |
| 2. Fill | **B** — separate Fill zones on the outer edges, one click ("one strong click"). Window-edge zones sit inside the 5 px resize band. |
| 3. Motion | **A** — final layout one time, a clip opens, the content builds again at the new size. |
| 4. End | **C** — the Collapse button and a click on an edge zone, plus Esc. Also a setting row for outside click, and a Pin that holds the card against it. |
| 5. Request for a covered card | **A** — collapse first, then the request runs. Covered cards are not drop targets. |
| 6. Pick in a grown card | **A** — keep the grow, with a setting row to collapse instead. |

Added after the large-library review, the same day:

| Fork | Choice |
|---|---|
| 7. A visible control | **2** — a Grow button in every content card's header (rest → wide → full → rest). The gap zones stay as the fast path. The window-edge Fill zones are dropped: a 7 px zone beside the 5 px resize band turns a missed resize into a Fill. |
| 8. MVP scope | **2** — §3–§7 plus the Library letter rail and the song-list columns (§9a). Without them a grow of the song list shows the same rows wider. The other cards' wide layouts (§9) are hand-designed by the user after the MVP. |
| 9. Memory | **1** — temporary, as designed. Pin holds a card for the session. A "Remember pinned card" row is the follow-up if it becomes a daily habit (§8). |
| 10. The resting layout | **Unchanged, almost pixel-identical** (§0). Every part is absent or out of flow and unpainted at rest. The Grow button is hover-only and out of flow for this reason. Checked by a before/after screenshot diff (desk test step 0). |

## 13. As built (2026-09-16) — where the build differs from the design

- **The columns' data.** `Track` carries no added-at date and the play tallies live in SQLite,
  so Full is Title · Artist · Album · Length · ♥ · **Genre · Year · Plays**, not "Date Added and
  Plays". Plays comes from `play_counts` (one local read on Library mount, zero Apple calls);
  the column shows only where the tallies are known (the Library root). An album's list keeps
  its track number as the lead cell (`#`, sorts by track order) and drops the Album column.
- **The Sort popover grew.** Artist, Album, Length and Genre are sort keys of every song list
  now (they are the column headers), and Plays at the Library root. The popover shows the sort
  a column header set, as the design asked.
- **The rail lights the letter on screen.** As the list scrolls, the letter of the first row in
  view is lit (`is-lit`); empty letters are dimmed and disabled. The rail is rebuilt only when
  its letters or their first rows change, so a scroll never re-animates it. It shows in every
  grown state under an A–Z sort, on any card on the engine (Playlists too), never on a mixed
  list (folders among playlists).
- **A grown card's zones.** Its remaining inner gap gives Fill (as designed). Its outer zones
  (the top padding, the stage-side gap) **collapse** it, with a quieter bar (`--subtext`). The
  other visible cards keep their own Grow zones; a grow there ends the grow on screen first, at
  once, then opens.
- **The Grow button's box** is the `.panel__action` box (same size, border and fill) but
  its own class, absolutely placed at the title's right end, and it takes the `.pop-enter`
  row motion on arrival. Pin sits to its left while the card is grown and "Collapse on outside
  click" is on.
- **Outside click** counts only clicks inside the app body (another card, the stage, a gap).
  The title bar and the fixed overlays (menus, popovers, toasts) do not collapse a card.
- **Esc** yields to an open context menu, a Sort/View popover, the slot picker, a title-bar panel
  or a focused text field, as designed.
- **`--grow-clip-pad`** is set per skin from the card shadow's reach: Press 6 px (the plate),
  Ocean 44 px (the lift), Glass 40 px (the halo), the others 0.
- **Row hints.** The column cells keep the `.lib-row__title` / `.lib-row__artist` classes, so the
  row hint (ONBOARDING.md §1a) works unchanged; the Grow button, the rail and the column headers
  carry written hints (the ledger in §1). No new SHAPES row was needed.
- **Dev handle.** `__grow.grow(slot, dir, cause)` / `__grow.collapse(cause)` / `__grow.state()`
  / `__grow.zones()` / `__grow.dirs(slot)` in the dev app (`scripts/webview-eval.mjs`).
- **Log lines.** `grow {slot, dir, mode, cause, covered}`, `grow:collapse {slot, cause, motion}`,
  `grow:pin` / `grow:unpin {slot}`. Causes: zone · button · menu · esc · outside · request ·
  pick · surface · setting · recompose · agent · other.

### 13a. The first polish pass (2026-09-16, after the desk test)

- **Every row on screen enters.** The first build entered 14 rows and the rest sat there
  "already present". Now every row in view enters (`enterAll`), at the grow's own stagger
  `--grow-rows-stagger` (12 ms; ~30 rows in about half a second), scoped by `is-grow-rows` on the
  panel, which also fades the rebuilt body in over `--grow-body-fade`.
- **The opening flash.** The rows are rebuilt at the new size before the clip starts, so a fade
  OUT of the body showed the new columns inside the old box for a moment. The body now goes
  at once when the clip starts and fades in when it is open.
- **Density per size.** A grown card opens with the size's own density the first time: small
  tiles wide or tall, large tiles when it fills the window (`GROW_DENSITY`). The top-level view
  prefs (grouping, density, sort) are stored per size, `deets.library.view:wide` /
  `:tall` / `:full`, beside the resting key, so the size remembers what you set in it.
- **The bar hugs the card.** Per-skin tokens: `--grow-zone-bar-gap` (off the edge; negative =
  over it), `--grow-zone-bar-trim` (from each end — the base is the card's corner radius, so the
  bar runs between the corners), `--grow-zone-bar-radius`, `--grow-zone-bar-glow`. Press: a 4 px
  square rule. Ocean: 1 px off, a soft glow. Glass: a 2 px lit edge 2 px off the glass with a
  glow. Retro-Future: the hard rule it had.
- **Window-edge Fill zones are back**, to explore: the right and bottom padding inside Tauri's
  5 px resize band (`--grow-zone-resize-inset`), so the zone is the inner 7 px and the resize
  cursor keeps the outer 5. `right` fills from its right edge, `c` from the bottom, `d` from
  both. Fork 7's worry stands (a missed resize drag fills a card); the token can go to 12 px to
  turn them off.
- **The zones moved onto the cards (2026-09-17).** The first build placed them from on-screen
  boxes measured at init — during the launch lift, when every panel still carries the skin's
  `--boot-rise` transform (Ocean: 22 px down). Nothing re-measured after the lift, so the
  zones sat low and the bars came out the wrong size; Ocean's bottom bars fell off the body.
  Now each content card's host holds four strips (`makeZones`, made with the Grow button after
  the card's markup), absolutely placed by CSS from the card's own box: `data-side` says which
  edge, `data-reach` how far (half the gap toward a neighbor, the full gap toward the stage or
  the top padding, the padding minus the resize inset on a window edge). Nothing is measured
  and nothing watches sizes; a transform, a swap, a resize or a grow moves them with the card.
  `paintZones` decides per strip what it does now and hides idle ones (`beyond()` reads the
  max map: a card's columns and rows, wider for a grown card). §0 still holds: the strips are
  out of flow and paint nothing until hovered.
- **The rows file back in on collapse too**, on the card that shrinks and on the cards that
  come back from under it (`enterAll` on each uncovered host).
- **A CLI / bridge route.** `deetsmusic grow Library right|left|up|down|full` (no direction =
  the header button's next step), `grow collapse`, `grow pin`, `grow unpin`, `grow state`;
  `GET/POST /grow` on the bridge (AGENT.md §3, `agentGrow` in card-grow.ts). Not an MCP tool.
  A debug CLI build reads the dev app's token only.

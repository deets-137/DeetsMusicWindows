# DeetsMusic — growing a card

**Designed 2026-09-16. Not built.** The forks and the decisions are §12. The wide-card layouts
(§9) are ideas to discuss when we build them.

A content card can take more space for a short time. You click the gap beside the card. The
card opens over its neighbor, or over all four content cards in Max. The layout with four
cards does not change. Nothing is saved when the app restarts.

Files (planned): `src/card-grow.ts` (zones, state, motion) · `src/layout.ts` (the covered-card
rules) · `src/styles.css` §Bento + §Card grow · `src/styles/skin.css` (the `--grow-*` tokens).

---

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

## 2. The surfaces

| Surface | Grow zones | Fill zones | Results |
|---|---|---|---|
| Max | the gaps inside the 2×2 block | the outer edges of the 2×2 block | Grow right / left / up / down, Fill |
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
  - The right and bottom Fill zones are on window edges. The window has no OS frame
    (`decorations: false`), and Tauri takes the outer **5 px** (`BORDERLESS_RESIZE_INSET` in
    `tauri-runtime-wry/src/undecorated_resizing.rs`) as the resize band. So these zones are
    the inner **7 px** of the 12 px padding. The zone must start inside the band, and the
    zone's own cursor must not cover the resize cursor.
- **The zones are part of the bento, not the cards.** One overlay layer in `.app-body` places
  them from the grid's measured rects. A card's own inner edge is ruled out as a zone: the
  scrollbar sits there.
- **A grown card has its own zones.** A Grow zone on its remaining inner edge gives Fill.
  A Fill zone on a filled card does nothing (fork 4C: see §5 for Collapse).
- **Keyboard and right-click:** the card title's right-click menu gets **Grow ▸** (the
  directions that exist in this slot) and **Fill**. This is the path without a pointer, and a
  row in the ONBOARDING.md right-click table.

Tokens: `--grow-zone-bar-w`, `--grow-zone-bar-color` (theme role), `--grow-zone-resize-inset`
(5 px, commented with its source in tauri-runtime-wry).

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

- **The Collapse button.** It shows in the grown card's header actions while the card is grown.
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

## 9. Wide cards (theory, to discuss at build time)

A grown card can be very wide (Fill on a large Max window is more than 1,000 px). A list row made
for 300 px looks empty at that width: the title sits far left and the badge far right. These
are ideas for each card. Each one is a separate step after the first slice.

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

1. **Motion:** the clip opening (§6), `enterRows` for the rows, the Collapse and Pin buttons
   come in through `enterRows`, and a `prefers-reduced-motion` rule for the clip.
2. **Tokens:** `--grow-*` in skin.css base; the zone bar color is a theme role in themes.css;
   regenerate TOKENS.md in the same commit.
3. **Hints:** Collapse, Pin, and the edge zones ("Widen this card", "Fill the window with this
   card") go in the ONBOARDING.md ledger.
4. **Toasts:** none planned.
5. **Settings keys:** the three rows in §8.
6. **Log lines:** `diag.log` for grow (slot, direction), collapse (the cause: button, zone, Esc,
   outside, request, pick, surface), pin and unpin.
6a. **Scrollbars:** no new scrolling element.
7. **Telemetry:** `dataset.frames = "grow"`.
8. **Check:** `npx tsc --noEmit` and `npx vite build`, then the desk test (§11).

## 11. Desk test (first slice, §3–§7)

1. Max, each skin. Hover each Grow zone. The bar shows on the card that will grow.
2. Click the gap half beside `left` toward `right`. `left` opens over `right`. Its rows come in
   at the new width. `right` is hidden and takes no clicks.
3. Scroll `right` and open a drill before step 2. After Collapse, the scroll and the drill are
   still there.
4. Click the top Fill zone of `d`. `d` fills the four content cards in one click. The stage and
   the Queue do not move.
5. Move the pointer to the window's right edge. The resize cursor shows in the outer 5 px; the
   Fill zone shows inside it. Resize the window while a card is filled.
6. Collapse by each path: the button, an edge zone, Esc, an outside click. Pin, then click
   outside: the card stays. Esc still collapses it.
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

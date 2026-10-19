---
status: shipped
shipped_in: 0.26.1
desk_test: passed 2026-10-11
sources: [src/full-player.ts, src/full-player-layout.ts, src/now-playing-card.ts, src/styles.css, src/styles/skin.css, src/queue-rows.ts, src/card-grow.ts, src/player.ts, src/album-color.ts, src/layout.ts, src/rulez-words.ts, src/compass.ts, src-tauri/tauri.conf.json]
updated: 2026-10-18
---
# Full player — grow the Now Playing card

> **An idea, opened 2026-10-01; every fork decided 2026-10-02 (§6, §7) and 2026-10-10 (§10.3,
> §11). Built 2026-10-11 (§13); on for everyone since 2026-10-11, the DevTools flag
> removed; shipped in 0.26.1.** The owner asked for a discussion doc: the visual idea first, the
> technology after. Every fork in §5 is his. The numbers in §3 come from the tokens in the
> code today.
>
> **2026-10-10: build a first test version (§12).** His words: "not sold on it yet but can
> mess around with it after it's built". §12 is the code shape, for a build on 2026-10-11.
> Three questions in §12.9 come first.
>
> **2026-10-11: the test version is BUILT, behind a DevTools flag (§13, the as-built
> record). His desk test is §12.10.** The doc stays in ideas/ until he decides to keep it.

## 0. Terms

- **Full player:** the Now Playing card, grown to cover the cards beside it, so that the
  cover becomes as large as possible.
- **Rest:** the layout today, with no card grown.
- **The rows:** everything in the Now Playing card that is not the cover: the title, the
  artist, the album line, the scrubber, the times, the transport (Previous, Play, Next),
  the four squares on the left (Shuffle, Repeat, Show queue, Show search), the squares on
  the right (Favorite, Add to Library, AirPlay) and the volume row.
- **The limit:** the side of the card that stops the cover from growing (its width or its
  height).

## 1. The goal

Show the cover as large as the window allows. Two rules hold in every layout:

1. **No clipping.** The cover is always a full square. It is never cropped, as in the Max
   stage today (STAGE-COLUMN.md §2).
2. **No lost buttons.** Every row in the card stays on screen and works.

## 2. What exists today

| Surface | Now Playing at rest | Cover |
|---|---|---|
| Midi | A strip across the top. The cover is on the left, the rows are in a column on its right. The Library and Queue cards fill the rest of the window. | `--np-cover` = 120 px (as tall as the text column) |
| Max | The top of the stage column (340 px wide). The cover is a square on top, the rows are under it. The Queue is under the card. Four content cards fill columns 2–3. | 316 px, locked (STAGE-COLUMN.md §2 rule 2) |
| Mini, player view | The Now Playing card alone, in the Max stage layout (`data-mini="player"`). | as wide as the window |

Parts we can use again:

- **The stage layout.** `:is([data-surface="max"], [data-mini="player"]) .np` already turns
  the card into a column with a square cover (`height: 100cqw; aspect-ratio: 1`). A full
  player in Midi with the rows under the cover is this layout in a larger box.
- **Card grow** (CARD-GROW.md). A card that covers others, `inert` on the covered cards, the
  motion in each skin's `--grow-*` and `--swap-*` tokens, Collapse on Escape and on a click
  outside. Today the stage column never grows and is never covered (CARD-GROW.md §2); the
  Queue can grow up over Now Playing (§16).
- **`expandCard`** (CARD-GROW.md §17): a button that opens a card at full size.

## 3. The layouts, with numbers

The widget in the session that opened this doc draws each layout at any window size. The
sums use the tokens: title bar 40 px, gap 12, card padding 12, and about 200 px for the
rows when they sit under the cover (an estimate; the build measures it).

### 3.1 Midi (default window 495 × 670)

| Layout | Cover | Limit |
|---|---|---|
| Rest | 120 px | the text column |
| **Rows under the cover** | 382 px (× 3.2) | height |
| **Rows over the cover** (a dark band over the bottom of the cover holds the rows) | 447 px (× 3.7) | width |

- *Rows under the cover* is the Mini player view in a larger window. Nothing covers the art.
  In a tall window (about 780 px and more) the width becomes the limit, and the extra height
  is empty space above and below.
- *Rows over the cover* is the Apple Music full-screen idiom. The cover is the full card
  width. The rows sit on a band over the bottom of the cover, about 65 px deep at the
  default size. This does not clip the cover, but the band hides a part of it. The text
  needs the album-color contrast guard (ALBUM-COLOR.md) on the band.

### 3.2 Max (window 1100 × 820)

| Layout | Cover | Limit |
|---|---|---|
| Rest | 316 px | the stage column |
| **Whole window, cover left** (the rows in a column on the right) | 696 px (× 2.2) | width (it needs ~330 px for the rows) |
| **Whole window, cover on top** | 532 px (× 1.7) | height |
| **Over the four cards, the Queue stays** (in column 1, now full height) | 532 px (× 1.7), cover on top | height |

- At 1920 × 1080, *cover left* gives 992 px (the height is the limit) and *over the four
  cards* gives 992 px with the cover on the left.
- *Cover left* is the largest in every Max size we tried, because a Max window is wider
  than it is tall.
- *Over the four cards* keeps the Queue in view: you see what plays next. It is the Max
  *Fill* gesture (CARD-GROW.md §1) given to Now Playing. The Queue leaves its row under
  Now Playing and takes the full column.

## 4. The image

`stageArtPx()` (`src/queue-rows.ts`) asks Apple's artwork template for 480 px, or 640 px
when `devicePixelRatio > 1.5`. A 700 px cover on a 125 % screen needs about 875 device
pixels, so a 640 px file is stretched and looks soft. The full player must ask for a larger
file (the template takes any `{w}` × `{h}`). This is a CDN image, not an Apple API call, so
it does not count against the call budget (APPLE-CALLS.md). It is one more download per song
while the player is full.

Other parts that change with a large cover:

- **Press (VINYL.md):** the turning record at 700–1000 px. The spin cost grows with the area.
  Measure on `npm run dev:built` (frames ÷ ms).
- **The aurora (ALBUM-COLOR.md):** the halo is sized from `100cqw`. A larger card gives a
  larger halo. Check the Glass frost and the Ocean sea behind it.
- **Cover wallpaper (COVER-WALLPAPER.md):** the same cover behind the cards and large in the
  card may be too much of one picture. A possible rule: the wallpaper dims while the player
  is full.

## 5. The forks (his)

1. **Midi layout:** rows under the cover (382 px, nothing on the art) · rows over the cover
   (447 px, a band on the art).
2. **Max layout:** whole window, cover left (largest) · whole window, cover on top ·
   over the four cards with the Queue in view.
3. **How you open it:** a click on the cover · a button in the card (where; the card has no
   header) · a double-click on the card · a key (F11, or a Compass verb) · an edge zone like
   the Grow zones. More than one may be right.
4. **How you close it:** Escape · the same gesture again · a click outside (there is no
   outside in *whole window*) · it closes when you summon a card (Show queue, Show search).
5. **The window:** the player fills the app window only · it also makes the OS window full
   screen (no title bar, no taskbar). A true full screen is a second step on top.
6. **Memory:** it is gone after a restart (like a grow, CARD-GROW.md) · it comes back
   (CARD-MEMORY.md).
7. **Rules (RULES.md §19):** is "the player is full" a fact a rule can read, and an action a
   rule can do (for example: go full after 5 minutes with no input, like a screen saver)?
8. **Mini:** the player view is already Now Playing alone. Does Mini get a full player
   (the title bar hides), or is it out of scope?

## 6. Decisions (the owner, 2026-10-02)

1. **Midi: rows over the cover.** The app keeps its width, and the spacing does not feel
   awkward (the rows-under layout leaves empty bands beside a height-limited cover).
2. **Max: over the four cards, the Queue stays.** The Queue takes the full stage column, on
   the left. Inside the card: the cover on the left, the rows beside it when there is room,
   over it when there is not (§7.3).
3. **Open: the edges, like the other cards.** A click on an edge zone of the Now Playing card
   grows it (the Grow zone idiom, CARD-GROW.md §3).
   - Max: the **left and right** edges of the card.
   - Midi: the **top and bottom** edges of the strip.
4. **Close: the same as a grown card today.** A click on an edge of the card, or a button.
   In Midi the button sits **over the cover**, because the rows leave no other room.
5. **The app window only.** No OS full screen for now.
6. **No memory.** The player is not full after a restart.
7. **Rules and Compass both read it and turn it on.** "The player is full" is a fact a rule
   can read and an action a rule can do; Compass gets a verb.
8. **Mini gets one.** Possibly by rebuilding the Mini player view (`data-mini="player"`) as
   the full player.

## 7. Open inside his choices

Each of these was open after §6. All are now decided.

1. ~~Max: the left edge.~~ **Decided 2026-10-02:** a zone on a window edge is allowed, made
   smaller if it must be, like the bars beside the window edges on the cards today.
2. ~~Midi: the top edge.~~ Decided by the same answer as 1.
3. ~~Max: the layout inside the card.~~ **Decided 2026-10-02:** the cover on the left; the
   rows beside the cover when there is room (the card is at least ~356 px wider than it is
   tall), over the cover when there is not. **The Queue stays on the left**, in its column,
   full height. The record of the choice follows. His proposal (2026-10-02): the cover always on the
   left, the Queue always on the right. Moving the Queue to the right does not change the
   cover size: the card is as wide either way. What changes the size is where the rows go:

   | Window | Rows beside the cover | Rows over the cover | Rows under (earlier best) |
   |---|---|---|---|
   | 820 × 750 (Max minimum) | 64 px | 420 px | 420 px |
   | 1100 × 820 | 344 px | 700 px | 532 px |
   | 1920 × 1080 | 992 px | 992 px | 992 px (beside) |

   Rows beside the cover are larger only when the card is about 356 px wider than it is tall
   (a window about 470 px wider than it is tall). Rows over the cover give the largest
   possible square at every size, at the cost of a band over the bottom of the cover
   (~210 px). Options:
   - Rows over the cover at every size (one rule, the same as Midi).
   - Rows beside the cover when there is room, rows over the cover when there is not. The
     cover is the largest square at every size, and the band appears only in narrower
     windows. (Recommended.)
   - The Queue on the right or on the left: a separate choice. On the right, the Queue
     moves across the window when the player opens.
4. ~~Max: the close button.~~ **Decided 2026-10-02:** over the cover, in its top-right
   corner, in every layout (Midi, Max and Mini). One place for the button, whether the rows
   are beside the cover or over it.
5. ~~Mini.~~ **Decided 2026-10-02:** the Mini player view (`data-mini="player"`) becomes the
   full player, with the rows over the cover. Mini, Midi and Max share one full-player
   layout, and Mini has no second "full" state.
6. ~~The band.~~ **Decided 2026-10-02:** a fixed dark band, from a theme role (a new role in
   `themes.css`, not a raw color). The text on it uses the guarded text roles that exist
   for album-colored text (`--np-title`, `--np-subtext`, `--np-accent`; ALBUM-COLOR.md).

All the forks in §7 are closed.

## 8. Later additions (not in the first build)

- **The band in the album's color.** The band takes `--album-bg` (ALBUM-COLOR.md) in place
  of the fixed dark role, with the same text guard. Owner's note, 2026-10-02: "doc album
  color as a future addition".
- **OS full screen.** The player also hides the title bar and the taskbar (§5 fork 5; the
  app window only for now).
- **Press: a turning flight.** BUILT 2026-10-11 (his ask): the copy that flies turns. It takes
  the real disc's Web Animation (`makeFlight`, full-player.ts): the same turn, the same angle,
  the same rate. So it lands at the angle the real disc shows then, with no stop and no jump. A
  paused disc flies still. The test version flew a still copy (§12.9 Q3).

## 9. The motion (design pass, 2026-10-02)

> **Part:** idea · 2026-10-02 · forks decided (§9.4)

### 9.1 What exists

The grow (CARD-GROW.md §6, §19) opens a clip, not a stretch. The card lays out once at its
final size, and `clip-path: inset(…)` opens from the rest rect to the full box over
`--grow-dur` (0.34 s) on `--grow-ease` (the pop ease). The covered cards fade under the edge.
The rows come in through `enterRows` at `--grow-rows-at` (0.4) of the open. The collapse is the
same curve over `--grow-collapse-dur` (0.24 s). No skin overrides the grow tokens today, so
the grow has one shape in every skin. Reduced motion snaps.

### 9.2 What is new for Now Playing

1. **The cover changes size and place.** A list card only gets wider; its rows build again.
   The cover is one picture that must go from 120 px (Midi) or 316 px (Max) to 447–992 px.
2. **In Max the card changes column.** At rest Now Playing is in column 1. Full, it is over
   columns 2–3. The clip cannot open from the rest rect, because the rest rect is outside
   the full box. The card opens from its left edge (the gap next to the stage), and the
   Queue opens up over the place Now Playing left (the Queue grow up, CARD-GROW.md §16).
3. **The rows change layout** (the strip, or the stage column, to the band over the cover).
   They go at the start and come in at the new place, as a grow's rows do.
4. **The band** is new. It arrives with the rows.

### 9.3 The forks (his)

1. **The cover:** it flies from its rest place to its full place (a copy of the picture over
   everything, then the real cover takes over; a scale is fine on a picture, there is no text
   to stretch) · the opening edge reveals the large cover in place (the cover is cut by the
   clip during the open) · the small cover fades out and the large one fades in.
2. **The band:** it fades in with the rows · it slides up from the bottom edge of the cover,
   then the rows come in on it.
3. **Max order:** the Queue and the player open together · the Queue rises first, then the
   player opens.
4. **The skins:** one shape for every skin, on the grow tokens (as the grow is today) · a
   shape per skin, like the swaps (CARD-SWAP.md: Press stamps, Ocean dips, Glass slides,
   Cyber skews).

Not forks (they follow from the rules above): the music does not stop; reduced motion snaps;
the panel sets `dataset.frames = "grow"`; Press keeps the record turning through the flight;
the larger artwork file loads before the open so the flight does not show a soft picture.

### 9.4 Decisions (the owner, 2026-10-02)

1. **The cover flies.** A copy of the picture flies over everything from its rest rect to
   its full rect; the real cover takes over at the end. The close flies it back.
2. **The band fades in with the rows**, at `--grow-rows-at` of the open, through `enterRows`.
   On the close the rows and the band go first.
3. **Max: together.** The Queue opens up over the old place and the player opens from its
   left edge in the same 0.34 s; the cover flies over both.
4. **A motion per skin, the same values in the first version.** Each skin (Press, Ocean,
   Glass, Cyber) declares its own set of full-player motion tokens in its `[data-skin]` block
   in `skin.css`. In the first version every set has the values of the grow (0.34 s open,
   0.24 s close, the pop ease, rows at 0.4). Each skin can then get its own shape later as a
   change of values, with no code change. Vanilla takes the base values.

The motion mockup in the session of 2026-10-02 played these choices.

## 10. The edge zones (design pass, 2026-10-02)

> **Part:** idea · 2026-10-02 · fork 10.3 decided 2026-10-10 (split the gap)

### 10.1 What exists (`src/card-grow.ts`, §the edge zones)

Each content card has four strips, one per side. A strip's reach is one of three:
**half** (the half of a gap it shares with a neighbor card), **full** (the whole 12 px gap
toward the stage or the top padding), **edge** (the padding inside Tauri's 5 px resize band
on a window edge: 7 px, `--grow-zone-resize-inset`). On hover, the bar (`--grow-zone-bar-*`,
each skin its own shape) shows on the edge of the card that will grow. Now Playing has no
strips today. In the stage column only the Queue's top strip acts (it grows the Queue up).
While one card is grown, only that card's strips act.

### 10.2 The strips on Now Playing

| Surface | Side | What is past it | Reach | Owner today |
|---|---|---|---|---|
| Midi | top | the padding under the title bar | full (12 px) | nobody |
| Midi | bottom | the gap above the two content cards | full (12 px) | nobody (Midi's content cards have no top strip) |
| Max | left | the window edge | edge (7 px) | nobody |
| Max | right | the gap between the stage and the four cards | see 10.3 | **the Fill strips of `left` and `c`** (the whole gap) |

When full, the same rules give the close strips: Midi top (12 px) and bottom (the window
edge, 7 px); Max all four sides (his ask, 2026-10-18; before it, left and right only): left
(the gap beside the left column, 12 px, the column's side of it is dead), right (the window
edge, 7 px; the gap beside the side column, 12 px, while it shows), top (the padding under
the title bar, 12 px) and bottom (the window edge, 7 px). Stacked in Max (a tall window):
top and bottom (the gap over the cards) at 12 px, left and right at the window edge, 7 px;
stacked in Midi keeps top and bottom only. Each grows or closes Now Playing; the side you
click does not change the result (Midi grows down, Max opens over the four cards).

Rules that follow from the existing ones (not forks): the bar shape is the skin's own
`--grow-zone-bar-*`; while another card is grown, Now Playing's strips are hidden (changed
2026-10-14, his call: they act and the open collapses the grow first, §13 › *While another
card is grown*), and while
Now Playing is full, every other strip is hidden; the Queue's top strip in Max is hidden while
Now Playing is full (the Queue is already full height); Mini has no strips (its player view
is the full player).

### 10.3 The fork (his)

**The Max right edge is already taken.** The gap between the stage and the four cards is the
Fill strip of the Library (`left`) and the bottom-left card (`c`), at its full 12 px.

- **Split the gap at its middle line**, as a gap between two cards is split (CARD-GROW.md §3):
  the left 6 px grows Now Playing, the right 6 px fills the content card. (Recommended: one
  rule for every shared gap.)
- Now Playing takes the gap only beside its own height (the top of the column); the Fill
  strip keeps the rest. The gap then acts two ways along its length.
- Now Playing has only its left (window-edge) strip in Max; the gap stays the Fill strip.

**Decided 2026-10-10: split the gap at its middle line.** The 6 px beside Now Playing opens
the full player; the 6 px beside the cards keeps Fill for `left` and `c`. Their Fill strip on
that side goes from `full` reach to `half` while Now Playing's strip is live (at rest, and no
other card grown). One rule for every shared gap.

## 11. Next step

> **Part:** idea · decided 2026-10-10. The name: **Full player**, the one word for the
> Compass verb, the rule fact and the rule action. The artwork: **fit the box** (§12.5).
> The next-song prefetch (built 2026-10-10, ALBUM-COLOR.md data path item 4): it loads the
> full player's size while the player is full. The build checklist is §12.8.


A design pass on what is still undrawn, before any code:

- ~~The motion~~ — decided 2026-10-02 (§9.4).
- ~~The edge zones~~ — decided 2026-10-10 (§10.3).
- ~~The rule fact and action, and the Compass verb~~ — "Full player", 2026-10-10 (§12.6).
- ~~The larger artwork file (§4)~~ — fit the box, 2026-10-10 (§12.5).
- ~~The build checklist~~ — §12.8.

## 12. The code shape — first test version (scoped 2026-10-10, for 2026-10-11)

> **Part:** designed · 2026-10-10 · not built. Read against the code on 2026-10-10:
> `card-grow.ts`, `now-playing-card.ts`, `styles.css` (§max, §mini, §Card grow),
> `album-color.ts`, `player.ts`, `queue-rows.ts`, `rulez-words.ts`, `compass.ts`.

### 12.1 Three facts in the code that shape the build

1. **In Max, Now Playing is not a cell of the bento.** It is a child of `.stage`, a grid item
   with its own two rows (`styles.css`, "The stage column"). It cannot span columns 2–3 from
   there. **The fix:** while the player is full, `.stage` takes `display: contents` (its
   default outside Max), so Now Playing and the Queue become bento items placed by hand: Now
   Playing at `1 / 2 / 3 / 4`, the Queue at `1 / 1 / 3 / 2`. The stage's `container-type:
   size` goes away for that time; nothing reads it while the player is full.
2. **Now Playing has no zones and no grow.** `card-grow.ts` makes the edge strips in
   `attachGrowButton`, which needs a `.panel__head`; Now Playing has none, and `MAX_NEIGHBOR.np`
   is empty on purpose. The full player is not a grow (it changes the column and the card's
   inner layout), so it gets **its own module** and borrows the grow's parts.
3. **The card prefers MusicKit's artwork URL** (`s.artworkUrl ?? artURL(…)` in
   `now-playing-card.ts`), and `player.ts` builds that URL at `stageArtPx()`. The size must
   change at the source, `player.ts`, or the full player shows a stretched 480 / 640 file.

### 12.2 New files

- **`src/full-player.ts`** (≈350 lines) — the feature:
  - The state: `isFullPlayer()`, `onFullPlayerChange(cb)`, `openFullPlayer(cause)`,
    `closeFullPlayer(cause)`, `toggleFullPlayer(cause)`. Sets `data-player="full"` on `<html>`
    (one attribute, every CSS rule hangs on it) and `data-np-rows="beside|over"` on the card.
  - The open: close any grow first (`collapseGrow("player", false)`); load the large cover
    and wait for its decode (§12.5); set the layout once; then the motion (§12.4).
  - The close: the reverse; the rows and the band go first (§9.4.2).
  - Ways out: the close button, the zones, Escape (the grow's rule: not while a menu, a
    popover or a field takes it), a card request (Show queue, Show search, a Compass place),
    a surface change (no motion, as a grow).
  - The rules: `registerFact("player", …)` (`full` / `rest`, seam = `onFullPlayerChange`) and
    `registerAction("player", { cost: "free", run })` (`open` / `close`), RULES.md §19.
  - `diag.log("player", {on, cause, surface})` for each open and close; `frames.begin("player", …)`
    around each motion; on the TELEMETRY gate, `window.__full` = open / close / state (as
    `__grow`). It was `__player` until 2026-10-11, which player.ts's handle overwrote.
- **`src/full-player-layout.ts`** (pure, with `tests/full-player-layout.test.ts`):
  - `rowsPlace(cardW, cardH, rowsW): "beside" | "over"`: beside when the card is at least
    `rowsW` wider than tall (§7.3; `rowsW` is read from a token, ~356 px).
  - `fullArtPx(boxCssPx, dpr): number`: the box × the scale, rounded up to 200, at least
    `stageArtPx()`, at most 2000 (§12.5).
  - `fullClipFrom(rest, full)`: the rect the open starts from. Midi: the strip (it is inside
    the full box). Max: a zero-width rect on the full box's left edge (the rest box is outside
    it, §9.2.2).

### 12.3 Changes to existing files

| File | Change |
|---|---|
| `card-grow.ts` | Export the parts the player reuses: `motion()`, `clipBetween`, `clipOpen`, `clipPad`, `cover` / `uncover`, `enterAll`, `settled`. **The zones:** `makeZones` for `np` with no button (called from the card's mount); `zoneAction` gets the Now Playing branch: Max `left` (edge reach) and `right` (half reach), Midi `up` and `down`, act `player` at rest, `close` while full. The Fill strips on the left side of `left` and `c` drop from `full` to `half` reach while that strip is live (§10.3). While the player is full, every other strip hides; while a card is grown, Now Playing's strips hide. `growCard` does nothing while the player is full. |
| `now-playing-card.ts` | The close button (top right over the cover; an icon square, the `ICON_SHRINK` glyph, its hint in ONBOARDING.md §1). A `ResizeObserver` on the card while full: `rowsPlace` → `data-np-rows`; `fullArtPx` → a new cover URL only when the 200 px bucket changes. `dataset.frames = "grow"` on the panel during the motion. |
| `queue-rows.ts` | `coverArtPx()`: `stageArtPx()` at rest, the full player's `fullArtPx` while full. The one source of the cover size. |
| `player.ts` | `artworkUrlOf(item, coverArtPx())` in place of `stageArtPx()`. |
| `album-color.ts` | The prefetch loads `coverArtPx()` (his call: the full size while full). `applyText`: while `data-np-rows="over"`, the backdrop the guard checks is the band role, not the aurora mix. |
| `layout.ts` | A card request while full closes the player first (no motion), then runs. Mini's player view (`data-mini="player"`) wears the full player's rows-over layout (§7.5), behind the gate (§12.9 Q1). |
| `styles.css` | `[data-player="full"]` blocks: Midi (Now Playing at `1 / 1 / 3 / 3`, the content cards `is-covered`), Max (§12.1.1), the band (`.np__center` over the cover's bottom), the rows-beside layout, the close button, the Now Playing zones. Reduced motion: snap. |
| `skin.css` | `--player-dur / -ease / -rows-at / -collapse-dur` in the base AND in each of the four skin blocks, with the grow's values (§9.4.4); the band's geometry (`--np-band-pad`, its min height); `--full-rows-w` (~356 px). Then `npm run tokens`. |
| `themes.css` | `--np-band`: one new role in each theme (§7.6). Then `npm run tokens`. |
| `compass.ts` | One verb row: "Full player", sub "Grows Now Playing so the cover is as large as the window allows" (or "Back to the cards" while full). `SYNONYMS`: full screen, fullscreen, big cover. COMPASS-TERMS.md. |
| `rulez-words.ts` | Section Window: a fact "Full player" (choice On / Off) and an action "Full player" (choice Open / Close). RULEZ.md §14 if a recipe uses it. |

### 12.4 The motion (§9.4, in code)

1. Read the rest rects: the card and the cover (`.np__art`).
2. Set the layout once (`data-player="full"`), read the full rects.
3. **The cover flight:** a fixed-position copy of the cover picture at the rest rect, at the
   new (large) URL, already decoded; `transform` translate + scale to the full rect over
   `--player-dur`; the real cover is `visibility: hidden` until the flight lands.
4. **The card:** `clip-path` from `fullClipFrom(rest, full)` to open, as `growCard` does.
5. **Max:** the Queue grows up over the old Now Playing place in the same duration (the
   clip of the Queue's own tall grow, `card-grow.ts`).
6. The rows and the band enter through `enterAll` at `--player-rows-at`.
7. The close: the rows and the band leave, the clip closes, the cover flies back.

### 12.5 The artwork size

`fullArtPx(box, dpr) = min(2000, max(stageArtPx(), ceil(box × dpr / 200) × 200))`. Examples:
a 700 px box at 125 % → 1000 px; 992 px at 150 % → 1600 px; 992 px at 200 % → 2000 px. A
resize asks again only when the bucket changes. Apple's image server takes any `{w}×{h}`; it
is not an API call (APPLE-CALLS.md). The open waits for the decode of the large file, at most
`--player-art-wait` (a token, ~250 ms), then flies with what it has.

### 12.6 The words

- Compass: **Full player** (the verb). Rulez: the fact **Full player** (On / Off) and the
  action **Full player** (Open / Close). Hints: "Opens the full player" on the zones, "Back
  to the cards" on the close zones and the close button.

### 12.7 Not in the test version

No memory (§6.6). No OS full screen and no album-colored band (§8). No agent route (an
`/player` route on the bridge can come with `/grow`'s pattern later). No setting row (§12.9).

### 12.8 The build checklist (CLAUDE.md › Working style)

0 not a card. 1 motion: the rows `enterRows`, reduced motion snaps. 2 tokens: §12.3
`skin.css` / `themes.css`, then `npm run tokens`. 2a family: the close button is an icon
square. 3 hints: the close button and the zones go in ONBOARDING.md §1. 4 no toast. 5 no
settings key (unless §12.9 Q1 picks a row). 5a no New badge. 6 `diag.log("player")`. 6a no
new scroller. 7 `dataset.frames`. 8 `tsc`, `vite build`, `npm test`. 9 Compass verb. 10 the
rule fact and action. 11 no new right-click. 12 Escape. 13 no popover. 14 no memory.

### 12.9 Ask him before the build (2026-10-11)

1. **The gate for a test version.** A DevTools flag, like Adaptive sound (SOUND.md §11a):
   off for everyone, he turns it on (recommended: nobody else meets it, and Mini's player
   view stays as it is until he says) · a Settings › Window row, default Off · no gate.
2. **A click on the Queue while the player is full (Max).** The Queue is part of the full
   layout, so a press there keeps the player open (recommended) · it closes the player, as a
   press outside a grown card does.
3. **Press (the turning record) in the flight.** The record keeps turning through the
   flight (§9.3, a "not fork") but the flight flies a COPY of the picture. Read VINYL.md
   first; if a copy cannot turn in step, the copy is a still of the disc for 0.34 s
   (recommended for the test version) · the real disc flies and no copy is made.

**Decided 2026-10-11 (the owner):** 1. a DevTools flag; Mini's player view stays as it is
until he says. 2. A click on the Queue keeps the player open. 3. A still copy in the test
version. Later: a turning copy that flies (or the real disc); that choice is open (§8).

### 12.10 Desk test (written now; run after the build)

1. Midi: click the top or bottom edge of the Now Playing strip. The cover flies to full
   size; the band and the rows come in over its bottom; the Library and Queue cards fade
   under. Escape, the close button and an edge each close it.
2. Max at 1100 × 820: click the left 6 px of the gap right of Now Playing → the full player
   opens over the four cards and the Queue takes the whole left column. The right 6 px of the
   same gap still fills the Library. Narrow the window: the rows move from beside the cover
   to over it.
3. The cover is sharp at full size (DevTools › Network: the file is 1000 px or more).
4. Compass: "full player" opens and closes it. A rule "When a song starts · Full player Open"
   opens it.
5. Each skin: the same motion; reduced motion snaps.
6. `deetsmusic diag` shows one `player` line per open and close.

7. Max: press a row in the Queue while the player is full. The player stays open.
8. Press: the record turns through the flight, at its own rate, and lands at the angle the disc shows. No stop, no jump (2026-10-11).
9. Midi: press Show queue on the band. The player closes and the Queue comes in.

## 13. As built (2026-10-11)

> **Part:** built · 2026-10-11 · desk test passed 2026-10-11 (§12.10). Where this section and
> §12 disagree, this section is the code.

**The gate: gone (2026-10-11, his call).** The test version sat behind a DevTools flag
(`src/full-player-flag.ts`, `localStorage["deets.dev.fullPlayer"]`). He tested it and turned it
on for everyone the same day. The flag file is deleted: the strips, the keys, the Compass row
and the Rulez words are there for every user. Mini is still not in it: the player opens in
Midi and Max only, and Mini's player view stays as it is until he says.

**The files.**

- `src/full-player.ts` — the state (`isFullPlayer`, `onFullPlayerChange`, `openFullPlayer`,
  `closeFullPlayer`, `toggleFullPlayer`, `fullPlayerAvailable`), the motion, the strips, the
  rule fact and action, Escape, `window.__full` on the TELEMETRY gate.
- `src/full-player-layout.ts` — pure: `rowsPlace`, `fullArtPx`, `fullClipFrom`, `flightFrom`.
  `tests/full-player-layout.test.ts` covers them (7 tests).

**Changes from §12.**

1. **The strips live in `full-player.ts`, not in `card-grow.ts`.** They are `.grow-zone`
   elements on the Now Playing host, with the grow's look, but with no `data-slot`.
   `card-grow.ts` paints only `.grow-zone[data-slot]`. `card-grow.ts` gets two hooks from the
   player (`setPlayerHooks`): `full` (no grow and no strip while the player is full) and
   `npRightLive` (the Fill strips on the left side of `left` and `c` take `half` reach while
   Now Playing's right strip is live, §10.3). Reason: the player imports the grow's motion
   parts, so the grow must not import the player.
2. **The ResizeObserver is in `full-player.ts`, not in the card.** It watches `.np` while the
   player is full: the rows' place and the cover file follow the size.
3. **The cover URL.** `queue-rows.ts` has `coverArtPx()` and `setFullArtPx()`. The card,
   `player.ts` and the next-song prefetch read `coverArtPx()`. A size change calls
   `refreshPlayerState()`; `vinyl.ts` swaps the picture of the same song once it is decoded,
   so the cover never blanks. The flight copy and the preload use the playing cover's URL with
   its `{w}x{h}` part replaced (`sizedUrl`); a URL with no such part is used as it is.
4. **The rule fact is `on` / `off`**, not `full` / `rest`. The Rulez fact reads "Full player:
   On / Off"; the action reads "Full player: Open / Close"; the sentence says "turns the full
   player open".
5. **The Compass row is not in `SYNONYMS`.** Its words (full screen, fullscreen, big cover,
   large cover) are the row's aliases, so COMPASS-TERMS.md does not list a hidden feature.
   They move to `SYNONYMS` when the flag goes.
6. **Midi row 1.** While full, the Now Playing card spans both rows, which leaves row 1 with
   no item to size it. `full-player.ts` holds row 1 at the strip's height (`--player-row1` on
   the bento), so the covered cards do not jump while they fade.
7. **The band's ink.** One role set in `themes.css`, derived once in `:root`: `--np-band` (a
   light theme's `--title` or a dark theme's `--canvas`, at `--np-band-strength`),
   `--np-band-ink` (the other one of the pair) and `--np-band-sub`. On the band, `.np__center`
   maps `--title`, `--text` and `--subtext` to the band ink, and the icon squares lose their
   light fill. In Glass (album text on), `album-color.ts` guards the album text against the
   band over black and over white.

**Decided inside his choices (for his review).**

- The band's strength: 78 % (`--np-band-strength`), with a 48 px soft top edge
  (`--np-band-fade`) and 16 px padding (`--np-band-pad`).
- The band's subtext: the band ink at 72 % (`--np-band-sub-strength`).
- The close square sits 8 px in from the cover's corner (`--np-close-inset`).
- The open waits at most 250 ms for the large file (`--player-art-wait`).
- The rows beside the cover need 356 px (`--full-rows-w`); in Max at 1100 × 820 the rows are
  over the cover (the card is 724 × 756).
- In full, the card shows the stage's parts in every surface: the album line, the times, the
  volume row and the larger title. Midi keeps its title bar volume pill too.
- The strips obey Settings › Window › *Grow cards from edges*; Compass and rules do not.
- The flight copy is at z-index 40: over the cards, under the menus.
- On the close, the rows come in again at the rest place.

**The controls under the cover (his call, 2026-10-11, after his desk test).** A third place
for the rows, *below*, beside *beside* and *over*:

- **When:** only when the space under the square cover holds the controls (the scrubber, the
  times, the transport row, the volume row) plus the grid's gap. The cover keeps its full size.
  Otherwise the rows stay *over*, on the band (his screenshot 1, "perfect"). Midi too.
- **What moves:** the controls go under the cover; the title, artist and album stay on the
  cover, on a band that now only holds those three lines.
- **Where:** the cover and the controls are one block, centered in the card ("centered for
  now, I'll debate as I test").
- **As built:** `rowsPlace(cardW, cardH, rowsW, controlsH, gap)` in `full-player-layout.ts`
  (tested). `placeNow` in `full-player.ts` measures the controls as they sit on the band, in
  the same no-paint pass, at the open and on each resize, and keeps the height as
  `--fp-controls-h` (the halo centers on the cover above them). In styles.css `.np__center` is
  `display: contents` in *below*, its parts are the grid's rows, and `.np__meta` carries the
  band. The open's hide and fade go on the parts. `album-color.ts` guards the album-colored
  text twice in *below*: the controls against the card, the title block against the band
  (`--np-band-title` / `-subtext` / `-accent`).
- **Shots:** `shots/scratch/below.json` (Max 1100 × 950 and × 1200, Midi 495 × 1000). The
  first run found the title block hidden under the cover (the cover is its own layer); fixed.

**The slide, and no column beside the cover (his calls, 2026-10-11, the same test).** This
replaces *beside* (§7.3; the 356 px line above in this section is history).

- **The slide:** a resize that moves the controls between the band and the space under the
  cover slides each part (the cover, the title block, the scrubber, the times, the transport
  row, the volume row) from its old place to its new one: FLIP in `slideRows`
  (`full-player.ts`), `--player-dur` and `--player-ease`, one `[perf] frames player-rows` line
  and a `player:rows` log line per change. In a wide card the cover also scales to its new
  size. A change during the open or the close snaps; reduced motion snaps.
- **No column beside:** a card at least `--full-wide-w` (356 px, was `--full-rows-w`) wider
  than tall keeps the controls under the cover, and the cover gives up their height (in *below*
  the cover is `min(100cqw, 100cqh − controls − gap)`). That width is where *beside* used to
  start. The *beside* CSS is gone.
- **Shots:** `shots/scratch/slide.json`: a height drag 950 → 790 → 950 (under → band →
  under) and a width drag 1300 → 1800 → 1300 (band → wide → band). Each change slid; the one
  slow frame is the resize's own layout.
- **The tear he saw (fixed the same day):** the band appeared at once at its new place while
  the cover still moved under it, and the controls under the cover had no layer, so the cover
  painted over them as they crossed it. The band is now a `::before` layer under the rows
  that hides while the parts move (`is-rows-sliding`, ended by the animations' own finish)
  and fades in after; the controls under the cover take the cover's layer.

**The History column (his calls, 2026-10-11): History, a 300 px column, Max only, slides in
from the right.**

- **Width (changed the same day):** the Queue column's (`--full-history-w: var(--max-stage-w)`,
  340 px). At 300 px the two columns differed and the centered cover felt off center (his
  screenshot); the column now needs 340 px beside the cover.
- **When:** the card is wide enough that a `--full-history-w` column and the panel
  gap fit beside the cover without making it smaller. The test reads the card's width
  WITHOUT the column, so showing it never turns it off (`layoutNow` in `full-player.ts`).
- **Where:** `.panel.fp-history` in `index.html`, a host that is not a slot. It sits on the
  right edge of the full player's area (`grid-area: 1 / 2 / -1 / -1`, `justify-self: end`)
  and Now Playing gives it room with a right margin, so the grid is the same in every Layout
  for Max. `layout.ts` passes `mountHistory` (it holds the registry).
- **Motion:** it slides in from the right edge (`--player-dur`) while the cover block slides
  over (the same FLIP pass as the rows), and out the same way. It waits for the open to land.
  The close takes it away at once.
- **Cost:** the History card mounts hidden once the open lands (a ~95 ms task, kept off the
  slide's first frame) and stays mounted, laid out but unseen, until the player closes.
  `player:history` log lines.
- **Shots:** `shots/scratch/history.json` (1800 × 900 → 1300 → 1800, then Escape).
- **Centered (measured, `shots/scratch/center.json`, Ocean, 963 px tall):** at rest the cover is
  the same distance from the Queue and from History (124 / 124 px at 1650 wide, 249 / 249 at
  1900). During the 340 ms slide the two move by different amounts, so it is off center then.

**The side column's picker and the flip (his calls, 2026-10-11).** The column (History by
default) has the slots' own title picker (`makePicker` in `layout.ts`, now generic over its
key): every card but Now Playing and Rulez. Two copies of a card are allowed (the slot's copy
is covered). Picking a card mounts it in the column. Picking **Queue** flips the columns: the
side card, with its picker, takes the stage column on the left and the Queue the right
column; nothing remounts (`data-fp-flip` on `<html>`, CSS moves the two panels), and the two
slide past each other over the cover (`flipSides`). The card and the flip are remembered
(`deets.fullplayer.side`). Flipped, the column slides in and out at the LEFT edge, and a
window too narrow for it puts the Queue back left (it slides there); the flip returns when the
window is wide again. Shots: `shots/scratch/sidepick.json`. A toast in the top-right corner
can sit over the column's title in Max (toasts were there before; seen in the shots).

**Stacked, for a tall window (his calls, 2026-10-11).** When the window is taller than wide
(once on, it must be `--full-stack-band`, 24 px, wider than tall to go back) AND the band left
under a full-width cover and its controls holds `--full-stack-room` (220 px), the player takes
the whole width at the top, as tall as the cover and its controls need (`--fp-stack-h`, set by
`stackNow` in `full-player.ts`), and the cards share the band under it: in Max the Queue and
the side column (the flip swaps them; the content cards wait covered under the player), in
Midi its two content cards, uncovered. The second test is his Midi condition ("if there is space
after a full-width cover") and stops a window that is only a little taller than wide from
leaving the cards no room. A resize across the line slides the rows and the two columns
(their size changes at once). Stacked, the strip over the cards closes the player.
`data-fp-stack` on `<html>`; the grid is in styles.css after the side column's rules. Shots:
`shots/scratch/stack.json` (Max 1090 × 1880 ↔ 1800 × 1000, Midi 495 × 1300).

**The top and bottom strips at rest (his ask, the same day).** In Max the resting Now Playing
card also has strips on its top (the whole gap to the title bar) and bottom edges that open
the full player. The bottom gap is the Queue's too (its grow up over Now Playing): each takes
half of it (`reachOf` here; `zoneAction` in card-grow.ts).

**The Compass and the toasts while full (his report, 2026-10-11).** Both dodge Now Playing
(Compass: `keepClearOfNp` in `compass.ts`; toasts: `toast.ts`). While full, Now Playing is the
view, so in Max the Compass was pushed into the strip right of it (over History, or into a
gutter) and in Midi below it; the toasts hung under it at the window's bottom in Midi. Now the
Compass hangs from the title bar with Now Playing's own left and right edges, centered over the
cover (`--np-left` / `--np-right-in`, `styles/compass.css`), and the toasts sit under the title
bar (`styles/toast.css`).

**With Layout for Max (2026-10-11, [MAX-CARDS.md](MAX-CARDS.md) §11).**

- A change of *Layout for Max* closes the full player with no motion (a snap), before the
  layout remounts the slots: `initFullPlayer` registers its `maxCards` listener first.
- In Max, Now Playing spans `1 / 2 / -1 / -1` and the Queue `1 / 1 / -1 / 2`, so the spans fit
  4, 2 or 1 content cards.
- Now Playing's right strip takes half the gap beside the stage when a card's strip shares it
  (four-card Max), and the whole gap when not (2 or 1 cards). Since 2026-10-14 the test is
  `stageGapShared()` in `card-grow.ts`: is any content card's strip live in that gap.

**While another card is grown (his call, 2026-10-14).** He grew the Library to Fill in Max on
live (0.27.0), and the Now Playing card's edges did nothing: §10.2 hid its strips while
another card was grown. His words: "let them act so it feels more intuitive". Now:

- Now Playing's strips act while a content card is grown, in Midi and Max. A click collapses
  the grow with no motion, then the full player opens with its own motion. This is the path
  the rule action and the Compass row already took (`openFullPlayer`: one motion at a time).
- A pinned grow collapses too: the strip is a deliberate press on Now Playing, and Pin only
  guards against a click outside.
- The strips stay off while the **Queue** is grown: it lies over Now Playing.
- **The gap beside the stage (Max).** A grown card whose left edge meets the stage keeps its
  collapse strip there, but at `half` reach: the 6 px beside the cards collapses the grow, the
  6 px beside Now Playing opens the player (the §10.3 split, one rule for every shared gap).
  When the grown card is not beside the stage, Now Playing's right strip takes the whole gap.
- **The bottom gap (Max).** The Queue's top strip acts while another card is grown too (his
  ask, the same day): a click ends that grow with no motion and grows the Queue up
  (`growCard` already ends another slot's grow first). So the gap stays split: the half
  beside Now Playing opens the player, the half beside the Queue grows the Queue.
- Code: `zonesOn` and `reachOf` in `full-player.ts`; `zoneAction` (the `shared` test) and
  `stageGapShared` in `card-grow.ts`.

Desk test (his, on the dev app):

1. Max, four cards. Fill the Library from its edge. Hover the gap between Now Playing and the
   Library: the half beside Now Playing shows the bar on Now Playing, the half beside the
   Library shows the bar on the Library. Click the Now Playing half: the Library snaps back,
   the full player opens. Escape closes it.
2. Fill the Library again. Click the Library half of the gap: the Library collapses.
3. Fill the bottom-right card (not beside the stage). Click anywhere in the gap right of Now
   Playing: the full player opens.
4. Grow a card sideways or up (not Fill). Click Now Playing's top or bottom edge: the grow
   ends, the player opens.
5. Pin a grown card (*Collapse on outside click* on, then Pin). Click Now Playing's edge: the
   player opens.
6. Grow the Queue up over Now Playing: no Now Playing strip shows.
7. Fill the Library. Click the Queue's half of the gap between Now Playing and the Queue: the
   Library snaps back, the Queue grows up. Fill the Library again and click the Now Playing
   half: the player opens.
8. Midi: grow a content card. Click Now Playing's bottom edge: the player opens.

**The flash after the open (his report, 2026-10-14, Glass and Press).** About 60 ms after the
open landed, the title block and the controls went out and faded in again. Cause: the first
`refit` after the open calls `layoutNow`, which sets `data-np-rows` to "over" for one measure
and back. The rows' fade was a CSS animation on a rule that names `[data-np-rows="below"]`, so
the flip stopped it and the flip back started it again from 0 (the class stayed on ~370 ms,
far past the 90 ms fade). Only *below* showed it; *over* faded the rows' box on a rule with no
attribute. Fix: `enterBand` fades with a Web Animation (`--grow-body-fade`, `--ease-ui`), which
no style change can restart; the `is-player-rows` class and its CSS are gone. Side effect: in
*below* the parts now also take the `enterRows` rise, as in *over* (the CSS fade used to replace
it). Checked with `shots/scratch/endflash.json`: every skin, Max and Midi, the open and the
close, with a per-frame opacity probe that lists a part that was fully shown and then fell
under 0.9. With the fix it lists only the resting rows that hide as the open starts. On the old
code it also lists all five parts falling to 0 at ~480–540 ms (Cyber, Press), so the probe
catches the bug.

**The fix's own bug (found the same day, corrected).** The first version passed one keyframe,
`[{ opacity: 0 }]`. A lone keyframe with no offset is the END frame, so the rows faded OUT over
90 ms and snapped back to full: still a flash. The probe above missed it, because the fade-out
ran on from the open's hide and read as one dip. The keyframe is now `{ opacity: 0, offset: 0 }`
(the from frame; the end is the part's own opacity). A per-frame trace shows 0 → 1 over the
fade, and the motion set's monitor (a flash, a jitter and a one-frame snap check, every skin)
shows one dip per open and per close.

**The jump at the end of the Max close (his report, 2026-10-14, Glass).** Two causes, both in
the Max motion of §9.4.3:
1. *The empty resting place.* Now Playing changes column in Max. While the Queue shrank down
   off column 1 (the close) or grew up over it (the open), the card's resting place above the
   Queue held nothing, and the card popped into it at the end of the close. Glass showed the
   empty place as the bright, unfrosted cover wallpaper. Fix: `restCopy` in `full-player.ts`
   clones the card in its resting layout (off its slot, `.np-still`, inert, its cover hidden
   because the flight carries the picture) into its resting box, under the Queue (the Queue
   rides `z-index: 1` for the motion). The Queue now grows over a card and shrinks off one. At
   the end of the close the real card takes the place in the same frame with no fade (the copy
   already showed its rows), and the copy goes. A close during the open drops the open's copy.
2. *The last sliver.* The Max clip opens from "a zero-width line", but `clipBetween` opens every
   edge past the box by `--grow-clip-pad`, so the line was a 2 × pad strip of the full card. The
   close ended on it and it vanished in one frame (the open started on it). `fullClipFrom` now
   takes the pad and pulls the line's edges in by it (tested, `full-player-layout.test.ts`).

Midi has neither: its resting strip is inside the full box. Checked in the frames (Glass,
Press) and with the monitor in every skin; the new baseline is §2a of the checks archive
([../ops/checks/README.md](../ops/checks/README.md)).

**Not built.** Everything in §12.7, the Mini player view, an agent route.

## 14. The stacked open and close, made smooth (design pass, 2026-10-18)

> **Part:** built · 2026-10-18 · desk test open (§14.5). F1 decided by him: per skin (§14.7).
> §14.6–§14.8 are the as-built record; where they disagree with §14.3–§14.4, they are the code.

His report (2026-10-18, Max on his portrait screen, 1080 × 1872, Cyber, 244 Hz): the open to
the stacked player and the close back "feel like some frames dropped". Read on his dev app with
a dev shot (`shots/scratch/fp-stack-live.json`), two `--trace` runs and the JS sampler.

### 14.1 What was measured

| | His own run (17:19) | The dev shot | The trace |
|---|---|---|---|
| Open | 364 ms · dropped 7 of 67 · worst 33 ms | 405 ms · dropped 19 · worst 71 ms | the click's own task 48 ms |
| Close | 281 ms · dropped 3 of 58 · worst 17 ms | 313 ms · dropped 5 · worst 88 ms, a 77 ms long task | the click 51 ms; one 50 ms frame at the end |

The shot's screencast adds load; his own lines are the honest numbers. At 244 Hz a frame is
4.1 ms, so one 9 ms layout pass drops two frames.

### 14.2 What the user sees, and why

1. **The cards jump at the first frame of the open.** The stacked grid puts the four content
   cards in the player's area (`grid-area: 1 / 1 / 2 / 3`, styles.css). They get a new size at
   once: the Library's rows show at full opacity across the left of the window, under the
   growing clip, then fade. The Queue jumps from its column (top 630 px) to the band
   (top 1260 px) in the same frame: its clip animation cannot move a box, only crop it.
2. **A second motion after the open lands.** The side column (Playlists for him) mounts after
   the open, two frames later `refit` runs `slideRows` (`player-rows below→below`, 342 ms),
   and the side card's tiles pop in during its reveal (682 ms). The open reads as two steps.
3. **The close ends in a jump.** Through the whole close the Queue stays in the band and the
   content cards fade in at their stacked places (the Library over the left half). At the end
   (`end()`) the grid goes back in one frame: the Queue jumps up, every card jumps home. That
   frame also lays out all four cards again and swaps the cover file back to 480 px: the
   50–88 ms frame.
4. **The click waits.** The open's first task forces style and layout about five times
   (`apply(true)`, `layoutNow` flips `data-np-rows` and back, `apply(false)`, `apply(true)`
   again, then the rects): 77 ms of `getBoundingClientRect` / `getComputedStyle` in the
   sampler. Each pass lays out the four content cards at their new size, and the collection
   cards redraw (`rerenderInPlace`). His click took 176 ms to its handler's end; the first
   changed picture came at +274 ms.

A probe (2026-10-18): one switch of the stacked layout costs 9–17 ms. With the four content
cards pinned at their rest boxes it costs 6–10 ms, and they do not move (0 px).

### 14.3 What follows (no fork: each one only removes a fault)

- **N1. Pin the covered cards.** While the stacked player is open or moving, each content card
  is held at its rest box (absolute, its own size, `grid-area: auto` so the grid area is not its
  containing block). No relayout, no list redraw, no jump: the cards fade out and in where they
  will be.
- **N2. Measure once.** The open measures the stacked layout in one pass and starts the large
  cover's load from the size the stacked width gives (the bento's width is known with no
  layout), so the wait and the measure overlap. Target: two forced passes on the click, not five.
- **N3. One motion.** Stacked, the side column is part of the open: its card mounts during the
  cover wait (`warmHistory` moves earlier), and it arrives with the Queue (F1). `refit` after
  the open finds nothing to change, so no second slide.
- **N4. A light last frame.** With N1 the close's last frame lays out only the player and the
  Queue. The cover file goes back to 480 px one frame later, after the layout frame.
- Out of scope here: Midi's stacked band (its two cards are uncovered and change size). Measure
  it after the build, with the same shot.

### 14.4 The fork (his)

**F1. How the Queue gets between its column and the band under the player.**

- **A. Fade (recommended).** The Queue stays in its column, and the player grows over it. Once
  the cover lands, the band (the Queue and the side card) rises in with the rows (`enterRows`).
  The close is the reverse: the band goes first with the rows, the player shrinks, and the Queue
  fades in at its column with the content cards. Only opacity and transform move. Cost: the
  Queue is out of view for about 300 ms.
- **B. Slide.** The Queue slides down into the band and widens while the player grows (a
  translate and a clip from its rest box), and the side card slides in from the right at the same
  time. A still copy of the Queue (as `restCopy` does for Now Playing) fills its old place, so
  nothing goes blank. The close runs it back. Cost: the most moving parts at 244 Hz; the Queue's
  rows are at the band's width from the first frame (the clip hides the extra width).

### 14.5 Desk test (written now; run after the build)

1. Max, portrait (his screen). Open from the right strip, close from the strip over the cards.
   His `[perf] frames player max open / close` lines: dropped under 3 %, worst under 17 ms.
2. In the frames (`shots/scratch/fp-stack-live.json`): no frame shows a content card at a
   new size or place; the Queue never jumps; nothing moves after the open lands.
3. Open, then close during the open; close, then open during the close: no stuck card.
4. Escape while open; a surface change while open (no motion).
5. Drag the window across square while open (the restack slide still works).
6. Every skin (the motion set), and Max landscape (not stacked: unchanged).

The kept check is [../ops/checks/fp-stack.json](../ops/checks/fp-stack.json): each skin's open
and close with probes (nothing left held, copied or faded after each), and a close during the
open. Each shot sets the skin with its own step and puts Cyber back: a shot `looks` would set the
theme, and his Live Theming rule (album color → theme) then holds it as a change by hand.

### 14.6 The regular Max Queue (found while measuring, 2026-10-18)

His second note, the same day: "when it gets close to the finish state on shrink, it jumps into
place". The frames of a landscape Max close (1080 × 760, `shots/scratch/fp-close-end.json`)
showed it outside the stacked layout too: during the close the Queue stays laid out at the whole
column's height and the clip only crops it, so the resting box showed the middle of the list
("two summers", "Forcefed Serenity"); one frame after the end it showed its header and first
rows. The open had the same jump at its first frame. Fix: `queueRise` in `full-player.ts`. The
Queue keeps its full-column layout and moves with its top edge (a `translateY` from the resting
top), and a clip holds its bottom edge at the column's end. The edges are the same as the clip it
replaces, so the shape is his §9.4.3 ("the Queue grows up over the place Now Playing left"); the
rows now travel with the edge. Checked in the frames: the header lands in place, no jump. Midi
has no such jump (its rows fade in at the strip).

### 14.7 As built (2026-10-18)

**His calls.** F1 per skin: **Fade** in Glass and Ocean, **Slide** in Press and Cyber ("Fade
works for Glass and ocean, Slide works for Press and Cyber"). Vanilla fades (his pick). The token
is `--player-stack-move` in skin.css: `fade` in the base block (so a new skin fades too), `slide`
in the Press and Cyber blocks.

**The code** (`src/full-player.ts`, `src/styles.css`, `src/styles/skin.css`):
- **N1, held cards.** `pin` / `unpin` and `.fp-pin` (absolute in the bento, `grid-area: auto
  !important`). Max's content cards are held at their resting boxes from the open's first measure
  to the close's end; the close measures their resting boxes again first (the window may have
  changed size), then holds them there for the motion. A layout pass measured 9–17 ms before and
  6–10 ms after (the worst `Layout` in a trace: 11 → 5 ms).
- **N2, measure once.** `preload` returns `ready` when the large cover is already in memory; then
  the layout stays on and the motion starts in the click's own task (no `apply(false)` and
  `apply(true)` again). The click's task is still ~43 ms, ~34 ms of it forced layout (two ~10 ms
  passes restyle the whole page after `<html>` attributes change). Left as is: it delays the
  start and drops no frame inside the motion.
- **N3, one motion.** Stacked, the side card mounts during the open's measure (`warmHistory`
  moved up) and comes with the Queue. **The side card now stays mounted, hidden, after a close**
  (`dropHistory(keep)`): it is unmounted only by a surface or *Layout for Max* change (open or
  closed) or a pick of another card. Reason: mounted on every open, its tile reveal (684 ms) ran
  during each open. Now it plays once, after the first open lands, with 0 dropped frames.
- **N4.** The cover goes back to the 480 px file one frame after the close's last layout.
- **Fade** (`move === "fade"`): a still copy of the Queue (`stillOf`, `.fp-still`) stays in the
  column and fades under the growing player; the real Queue waits in the band at opacity 0; when
  the open lands, `fpHistory` turns on and `enterRows([queue, side])` raises the band. The close:
  a copy of the band's Queue and the side card fade over 40 % of the collapse; the real Queue,
  held at its resting box, fades in from 30 % with the content cards.
- **Slide**: the real Queue in the band translates from its column's top-left; the side card
  slides in from its edge (`awayX`) at the same time; the still copy fades in the column. The
  close runs it back (the Queue held at its resting box, translated from the band).
- `dropStackBits` ends a stacked motion's parts (the stills, the Queue's own motion, its hold and
  opacity); the close and its `end` call it, so a close during the open leaves nothing.

### 14.8 Measured after the build (2026-10-18, his dev app, the app's own frame lines)

Measured with `__full.open` / `close` cycles, after a page reload. Numbers taken right after the
shots runner had been attached to the page ran at about half rate in every skin and are not used
(a reload cleared it).

| Where | Before (old code, same method) | After |
|---|---|---|
| Portrait stacked, Cyber, 244 Hz | open ~10 % dropped (5–14 %), close ~11 % (3–22 %) and the jump at the end | open ~6 % (4–21 %), close ~8 % (5–13 %), no jump |
| Portrait stacked, Cyber and Glass, 60 Hz | — | open 0–5 %, close 0–6 % |
| Max landscape 1080 × 760, Cyber | open 4–20 %, close 3 % | open 2–18 %, close 3–9 % |
| Max landscape, Glass | — | open 6–28 %, close 5–25 % (the frost's raster) |
| Midi 495 × 670, five skins | — | open 1–24 % (Glass and Ocean the high end), close 0–3 % |

The screen ran at 244 Hz for most of the session and at 60 Hz for the last portrait run (the PC
had been idle; Windows' dynamic refresh rate, or a display change). At 244 Hz a frame is 4.1 ms,
so a 9 ms pass drops two.

**Open after this build.** The click's forced layouts (N2, ~34 ms); Glass's per-frame cost in
every surface. (A line here said the clip animations run on the main thread. They do not: §14.9.)

### 14.9 The frame hunt (2026-10-18, his calls: the recorder first, the monitor before releases)

The recorder is `scripts/frame-why.mjs` (DEBUGGING.md § Why a frame is late). Measured first: in
this WebView2 (Edge 155) a clip-path animation is composited, like transform and opacity, so the
clip is not the cost. The costs it named in the open and the close, and what was done (none
changes what is seen):

| Frame | Before | Cause | Fix |
|---|---|---|---|
| The open's landing | 28 ms | `cover()` (`inert` + `visibility: hidden`) restyled ~1,100 elements inside the cards that were already at opacity 0 | the cards take no click from the start (`.is-covering` has `pointer-events: none`, card-grow too); `cover` runs `--player-dur` after the landing, when nothing moves (7–12 ms there) |
| Two frames after the landing | 12.5 ms + 20 ms script | the post-open `refit` measured the layout again (`layoutNow` flips `data-np-rows`) | it runs only when a resize during the open changed the layout (`resizedInMotion`) or the side column is still to come (`wantHistory`) |
| The motion's first frame | ~9 ms of it | the size watch's first report (an observer reports its start size at once) ran a full measure | that first report is skipped |
| The click | ~3 ms | `pin` read `clientLeft` after each card's write: a forced layout per card | `bentoOrigin()` reads the bento once, before any write |

After (portrait stacked, Cyber): no main-thread frame in the open's motion over 18 ms (the first,
the one-time paint of the new layout), the landing 13 ms; the delayed `cover` frame 7–12 ms at
+700 ms. **Left, for a later step:** the close's last frame, 50 ms (19 ms style on 1,873
elements, 10 ms layout, 14 ms script): `data-player` and `data-fp-stack` live on `<html>`, so
taking them off restyles the whole page; the same attributes cost the click's two whole-page
passes (~10–15 ms each). Moving them to the bento touches every full-player rule in styles.css.

**The monitor before every release** (his call): RELEASE.md §0 step 1a. It cannot see the two
jumps found today (a box that moves to a new place in one frame and stays; rows that change
inside a box), and it runs on the demo only; extending it is the next motion-check step.


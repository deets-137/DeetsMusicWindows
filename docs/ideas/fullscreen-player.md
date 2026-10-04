---
status: idea
desk_test: none
sources: [src/now-playing-card.ts, src/styles.css, src/styles/skin.css, src/queue-rows.ts, src/card-grow.ts, src-tauri/tauri.conf.json]
updated: 2026-10-02
---
# Full player — grow the Now Playing card

> **An idea, opened 2026-10-01; every fork decided 2026-10-02 (§6, §7). Not built.** The owner asked for a discussion
> doc: the visual idea first, the technology after. Every fork in §5 is his. The numbers in
> §3 come from the tokens in the code today.

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

> **Part:** idea · 2026-10-02 · fork 10.3 open

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
edge, 7 px); Max left (the gap beside the Queue column, 12 px, the Queue's side of it is
dead) and right (the window edge, 7 px). Each grows or closes Now Playing; the side you click
does not change the result (Midi grows down, Max opens over the four cards).

Rules that follow from the existing ones (not forks): the bar shape is the skin's own
`--grow-zone-bar-*`; while another card is grown, Now Playing's strips are hidden, and while
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

## 11. Next step

A design pass on what is still undrawn, before any code:

- ~~The motion~~ — decided 2026-10-02 (§9.4).
- The edge zones — designed 2026-10-02 (§10), one fork open.
- The rule fact and action, and the Compass verb: their words (RULES.md §19, COMPASS.md §9).
- The larger artwork file (§4): the pixel size to ask Apple's template for.
- The build checklist in CLAUDE.md › Working style, item by item.

---
status: idea
desk_test: open
sources: [src/full-player.ts, src/full-player-layout.ts, src/full-player-flag.ts, src/now-playing-card.ts, src/styles.css, src/styles/skin.css, src/queue-rows.ts, src/card-grow.ts, src/player.ts, src/album-color.ts, src/layout.ts, src/rulez-words.ts, src/compass.ts, src-tauri/tauri.conf.json]
updated: 2026-10-11
---
# Full player — grow the Now Playing card

> **An idea, opened 2026-10-01; every fork decided 2026-10-02 (§6, §7) and 2026-10-10 (§10.3,
> §11). Not built.** The owner asked for a discussion doc: the visual idea first, the
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
- **Press: a turning flight.** The test version flies a still copy of the disc (§12.9 Q3).
  Later, a turning copy that starts at the disc's angle flies, or the real disc flies. His
  call (2026-10-11): plan for it; which one is open.

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

0. **Before step 1:** in DevTools, `localStorage["deets.dev.fullPlayer"] = "on"`, then a reload.
7. Max: press a row in the Queue while the player is full. The player stays open.
8. Press: the record flies as a still disc and turns again where it lands.
9. Midi: press Show queue on the band. The player closes and the Queue comes in.

## 13. As built (2026-10-11)

> **Part:** built · 2026-10-11 · desk test open (§12.10). Where this section and §12
> disagree, this section is the code.

**The gate.** `src/full-player-flag.ts` reads `localStorage["deets.dev.fullPlayer"] === "on"`
once, at load. With the flag off there are no strips on Now Playing, no Compass row and no
Rulez words, and no key does anything. Mini is not in the test version: the player opens in
Midi and Max only.

**The files.**

- `src/full-player.ts` — the state (`isFullPlayer`, `onFullPlayerChange`, `openFullPlayer`,
  `closeFullPlayer`, `toggleFullPlayer`, `fullPlayerAvailable`), the motion, the strips, the
  rule fact and action, Escape, `window.__full` on the TELEMETRY gate.
- `src/full-player-layout.ts` — pure: `rowsPlace`, `fullArtPx`, `fullClipFrom`, `flightFrom`.
  `tests/full-player-layout.test.ts` covers them (7 tests).
- `src/full-player-flag.ts` — the gate. Its own file with no imports, so the pure Rulez words
  can read it.

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

**The Compass and the toasts while full (his report, 2026-10-11).** Both dodge Now Playing
(Compass: `keepClearOfNp` in `compass.ts`; toasts: `toast.ts`). While full, Now Playing is the
view, so in Max the Compass was pushed into the strip right of it (over History, or into a
gutter) and in Midi below it; the toasts hung under it at the window's bottom in Midi. Now the
Compass hangs from the title bar with Now Playing's own left and right edges, centered over the
cover (`--np-left` / `--np-right-in`, `styles/compass.css`), and the toasts sit under the title
bar (`styles/toast.css`).

**With Layout for Max (2026-10-11, [MAX-CARDS.md](../features/MAX-CARDS.md) §11).**

- A change of *Layout for Max* closes the full player with no motion (a snap), before the
  layout remounts the slots: `initFullPlayer` registers its `maxCards` listener first.
- In Max, Now Playing spans `1 / 2 / -1 / -1` and the Queue `1 / 1 / -1 / 2`, so the spans fit
  4, 2 or 1 content cards.
- Now Playing's right strip takes half the gap beside the stage when a Fill strip shares it
  (four-card Max), and the whole gap when not (`canFill()` false: 2 or 1 cards).

**Not built.** Everything in §12.7, the Mini player view, an agent route.


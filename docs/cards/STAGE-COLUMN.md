---
status: shipped
shipped_in: 0.9.5
desk_test: passed 2026-09-19
sources: []
updated: 2026-09-19
---
# The stage column (Max)

Built 2026-09-17. The left column of the Max surface: the Now Playing card over the anchored
Queue card. This doc covers three things that arrived together:

1. The cover is **always a square** and is never cropped.
2. The Now Playing card takes **the height its square needs**, instead of half the window.
3. The Queue can **grow up over Now Playing** from a zone on its top edge (docs/cards/CARD-GROW.md).

Terms. **The stage column** is grid column 1 of the Max bento. **The stage** is the new wrapper
element around the two panels in that column. **The bento** is columns 2–3, the four content
slots (`left`, `right`, `c`, `d`). **The cover** is the album artwork in the Now Playing card.

---

## 1. What was wrong

The Max bento was one flat grid: three columns, two equal rows for all of them
(`styles.css`, §Surface gate). The Now Playing card therefore got exactly half the window
height, and the cover got whatever the fixed rows left.

The cover was `flex: 1 1 auto; aspect-ratio: 1; max-width: 100%`. Two results, both bad:

- **Short window.** The cover was small — 122 px in a 820 px window — with about 90 px of dead
  space on each side of it.
- **Tall window.** Above about 1200 px of window height the leftover height passed the card's
  content width. `max-width` then clamped the width, the box became a tall rectangle, and
  `object-fit: cover` **cropped the artwork** top and bottom. `VINYL.md` already recorded this:
  "the stage box is not always square (the card's width caps it)."

The file we receive is not the problem. Every call site fills Apple's URL template with the same
value for `{w}` and `{h}`, so the bytes are always a square (see §6).

## 2. The rules

1. The cover is the largest **square** that fits the Now Playing card's content box. It is never
   cropped and never a rectangle, at any window size.
2. **Now Playing is locked** (the owner's call, 2026-09-17, after stress-testing the first
   build): its card is always exactly its full-width square cover plus its rows. Nothing inside
   the column can take that away, so the cover never shrinks in Max.
3. **The Queue absorbs everything else**, up and down. It is the only part that changes height.
4. What keeps the Queue usable is the **window**, not a fight inside the column: under 745 px
   tall a Max window either becomes Midi or stops at its 750 px floor — Settings › Window ›
   "Max window when short". At that band the Queue is still about 106 px.
5. Everything is a token. No measured pixel constant is written down anywhere (§4).

The first build had this the other way round: the Queue held "the song that plays now + 2.5 Up
Next rows" and the cover paid for it. Stress-testing killed that rule twice over — the Queue
stayed big while the cover vanished, and at 539 px the player's own rows **spilled out of its
card** over the Queue. The Queue's rows are now a promise the window floor keeps, not a claim
the Queue makes on the player.

## 3. The measurements

Geometry tokens are defined once in `skin.css` base and no skin overrides them. Only
`--panel-border-width` differs (0 or 1px).

| | |
|---|---|
| `--max-stage-w` | 340 px — the stage column, in every window size |
| `--panel-pad`, `--panel-gap`, `--space-3` | 12 px |
| NP content width | **316 px** (314 with a 1px border) |
| Bento card content width, at a 1100 px window | 332 px |

The stage column never moves: `minmax(0, var(--max-stage-w))` takes its 340 first and the two
`1fr` bento columns absorb every change of window width.

**The Queue's parts** (`qcard.css`), and why the floor is what it is:

| Part | Formula | Base | Press |
|---|---|---|---|
| Panel padding | `2 × --panel-pad` | 24 | 24 |
| Header | `--fs-title × --lh-text + --space-2` | 37 | 45 |
| Now-playing block | `--qcard-now-art + 2 × --space-2` | 64 | 64 |
| Two gaps | `2 × --space-3` | 24 | 24 |
| "UP NEXT" | `--fs-subtext × --lh-text` | 17 | 19 |
| **Fixed part** | | **166** | **176** |
| One Up Next row | `--lib-row-h` | 46 | 49 |
| **Floor, with 2.5 rows** | | **281** | **299** |

`--lib-row-h` is already each skin's measured row height, and the type maths agrees with it:
36 px cover against a 14/12 stack at 1.45 line height is 37.7 + 8 padding = 46.

## 4. How it is built

### 4.1 The stage wrapper

`index.html` wraps the two panels:

```html
<div class="stage">
  <section class="panel" data-slot="np" data-span="wide"></section>
  <section class="panel" data-slot="queue"></section>
</div>
```

Outside Max the wrapper is `display: contents`, so **midi, mini and the NP player view render
exactly as before** — the panels stay direct grid items of `.bento` in document order.

In Max the wrapper is the column-1 grid item (`grid-area: stage`, both rows) and carries its own
two rows. The bento cards keep their grid coordinates, so **every card-grow span rule and
`beyond()`'s column maths is untouched**.

### 4.2 The square, with no constant

Two rules do the whole job:

```css
.np { container-type: inline-size; }                 /* the stage compositions only */
.np__art { height: 100cqw; width: auto; aspect-ratio: 1; flex: 0 1 auto; margin-block: auto; }
```

`100cqw` is the card's own content width, so the cover's preferred height **is** its width: a
square, by definition. `width: auto` with `aspect-ratio` means a short card shrinks the box in
both directions at once, so it stays square while it shrinks. `margin-block: auto` centres it in
any spare height. `object-fit: cover` now never has anything to crop.

This also makes the card's natural (max-content) height exactly "square + rows", which is what
the grid row needs — so no per-skin measured token is written down. Inline-size containment is
safe here: it contains the width only, so the card's height still follows its content.

### 4.3 The split

```css
[data-surface="max"] .stage {
  container-type: size;
  grid-template-rows: auto minmax(0, 1fr);   /* Now Playing: natural. Queue: the rest. */
  grid-template-columns: minmax(0, 1fr);
}
[data-surface="max"] .stage > .panel[data-slot="np"]    { grid-row: 1; }
[data-surface="max"] .stage > .panel[data-slot="queue"] { grid-row: 2; }
```

Row 1 is `auto`, and the card's own max-content height is "square + rows" because of the
`100cqw` rule in §4.2 — so the lock needs no number and no cap. The Queue takes the `1fr` row
with a `0` minimum, so it shrinks and grows freely and its list scrolls.

There is **no floor token any more**. An earlier build had `--max-queue-min`, arithmetic over the
Queue card's parts, capping Now Playing so the Queue kept 2.5 rows; rule 2 replaced it. That
token is gone from `skin.css`, and `--qcard-now-art` stayed behind in the base block (it is a
Queue geometry token and belongs there either way).

### 4.4 What the user sees, by window height

The cover is at full width at every size Max can be, because Max cannot be shorter than the
band. Only the Queue moves:

| Window height | Cover | Queue |
|---|---|---|
| 750 (the floor, "Stops at floor") | full | 101 (Press) – 116 (Ocean) |
| **950 (the default)** | **full** | 310 (Press) – 325 (Ocean) |
| 1080, maximized on a 1080p screen | full | ~440 |
| under 745 | — | the window becomes Midi (or stops) |

Measured in the dev app on 2026-09-17, all five skins. At 950: cover 316 (314 in the skins with
a 1px panel border), Now Playing 558–573, Queue 310–325, nothing spilling. At the 750 floor: the
cover is still full size and the Queue is 101–116. Press is the tightest of the five, because its
type and its 49 px rows make the tallest player card.

Measured in the dev app on 2026-09-17 (Cyber, whose 1px border makes the card 314 wide): at
1100 × 950 the cover is **314 × 314** and the Queue 311; at 1291 tall the cover **stays 314** and
every extra pixel goes to the Queue (652) — the old code would have made it a 539-tall cropped
rectangle; at the 670 minimum the cover falls to 59 and the Queue holds its 286 floor with the
transport and volume rows intact.

### 4.5 The height band, and the settings row

`surface.ts` holds `MAX_FLOOR_H = 745`. The existing auto-flip read the window's **width** only
(≤460 mini, ≤820 midi, above that max, with a 40 px dead-band); it now reads the height as well,
for Max alone:

- A Max window dragged under 745 becomes **Midi**, which is built for short windows.
- A Midi window becomes Max only when it is wide enough **and** taller than 785 (the same 40 px
  dead-band, so the edge cannot flap).
- `Settings › Window › "Max window when short"` chooses: **Becomes Midi** (the default, which
  matches what the width already does) or **Stops at floor** — then Max's OS minimum height is
  its own 750 and the drag simply stops. "Becomes Midi" needs "Resize changes surface" on; with
  that toggle off, the floor is the only answer left and the row says so.
- `flipFloor` used to lend Max **all** of mini's floor (385 × 550) while auto-flip was on, which
  is how a Max window could be dragged to 539 px in the first place. It now lends the **width**
  only — the flip reads width for the mini edge — and each surface keeps its own height floor.
- `roomForMax()` guards the obvious trap: on a screen whose work area is shorter than the band
  (a 1366 × 768 laptop), the open size is clamped by the work area, and a height flip would make
  Max **unpickable** — it would turn back into Midi the instant it opened. There, Max stays and
  its Queue simply ends up short.

## 5. The default window size

`sizeMax` was 1100 × 820, which lands the cover at 209. It is now **1100 × 950**.

950 is chosen from the tallest skin, not the base one: Press needs 948 px of window for the full
square and the 2.5 rows together (its type is larger and its rows are 49 px). On a 1920 × 1080
screen the work area is about 1920 × 1032 after the taskbar, so a 950 px window fits with 82 px
to spare and centres with about 41 px above and below. Width 1100 leaves the two bento cards at
332 px of content each.

The "Max opens at" menu (Settings › Window) keeps its own three presets, so they moved with the
default: **960 × 700** (compact — the cover shrinks there, still square), **1100 × 950** (the
default) and **1400 × 1000** (wide, and still inside a 1080p work area). 1920 × 1080 is the
usability standard this is sized against, not the owner's own 3440 × 1392 screen.

Max's **minimum** height stays 670. A user who drags the window smaller keeps the 2.5 rows and
gets a smaller (still square) cover. Only new installs see the new default; a saved size wins.

## 6. The artwork we ask for

Every call site fills Apple's `{w}` and `{h}` with the same number, so the file is square whatever
the source is. The Now Playing card asked for 480. A 316 CSS px box is 474 device px at Windows'
usual 150% scale — right at the limit — and 632 at 200%. The card now asks for **640 when
`devicePixelRatio > 1.5`**, else 480. This is a different size of the same CDN image: no extra
Apple API call.

## 7. The Queue's upward grow

The Queue card gets the Grow button in its header and a zone on its top edge. It grows **up over
Now Playing** and nowhere else.

- `Slot` (card-grow.ts) gains `"np"` and `"queue"`. `MAX_NEIGHBOR` gains `queue: { up: "np" }`.
  `np` is a cover target only: it has no `.panel__head`, so it gets no button and no zones.
- The four content slots stay `opts.slots()`. A new `growSlots()` adds the Queue in Max, so Fill
  still covers the bento only.
- The Queue never offers Fill: its outer zones do nothing and the Grow button steps
  Grow → Collapse, with no Fill in between.
- Covering Now Playing hides the whole player: transport, scrubber and the stage volume row.
  That is deliberate (the owner's call: "person wouldn't open it if they didn't want to edit
  queue"). The ways back are the same four as any grow — the zone again, the Grow button, Esc,
  or a click outside — and Space still plays and pauses through Compass.
- The Press record keeps turning behind the hidden card. Pausing it would need a re-sync on
  resume, which is exactly where VINYL.md's clock drift comes from, and a hidden composited
  animation costs no paint.
- `Ctrl+Space` → `grow queue` → "Vertical" works, and so do `deetsmusic grow --card Queue` and
  the agent's `/grow` route: the card-host lookup now answers for the anchored Queue in Max.

## 8. Desk test — PASSED 2026-09-19

1. **Max, default size.** Open Max at 1100 × 950 (Settings › Window › Set current, or delete the
   stored size). The cover is a full-width square. The Queue shows the song that plays plus two
   whole rows and half of a third.
2. **Drag the window taller.** The cover stays 316 and stops growing; every extra pixel goes to
   the Queue.
3. **Drag the window shorter, down to the minimum.** The cover shrinks and **stays square** — no
   cropped top and bottom. The Queue never drops below 2.5 rows.
4. **Every skin.** Press, Cyber, Ocean, Glass, Vanilla. The Queue keeps 2.5 rows in each, because
   the floor is computed from that skin's own type and row height.
5. **Press with the record player on.** The disc is centred in the square and does not jump when
   the window is resized.
6. **The Queue's top edge.** Hover the gap between the two cards: a bar appears. Click it. The
   Queue opens up over Now Playing with the clip motion, and its rows enter.
7. **Ways out.** Esc, a click on another card, the zone again, and the Grow button each collapse
   it. Pin holds it against the outside click.
8. **The Queue's header.** Hover it: the Grow button appears after the title. Right-click the
   title: Grow ▸ Up, over Now Playing. **No Fill row.**
9. **The bento is unchanged.** Grow and Fill on Library / Search / Playlists / Settings behave
   exactly as before, and the resting 4-card layout is pixel-identical (CARD-GROW.md §0).
10. **Midi, mini and the NP player view.** Unchanged. In the player view the cover is a square
    centred in the window, not a cropped rectangle.
11. **Compass.** `Ctrl+Space` → "grow queue" → Vertical → Enter grows the Queue.

## 9. Two traps this build hit (both found by measuring, not by reading)

1. **A third row.** The first version placed only the grown Queue (`grid-row: 1 / 3`) and left
   Now Playing to auto-placement. Grid then pushed Now Playing into an implicit **third** row and
   the grown Queue kept its old height. Both panels are now placed by hand (`grid-row: 1` and
   `2`). The bento's covered-card rules already carried this warning; the stage needed it too.
2. **An implicit second column.** The stage had rows but no `grid-template-columns`, so Now
   Playing's midi rule `[data-span="wide"] { grid-column: 1 / -1 }` resolved against an explicit
   grid with no columns and the Queue landed in a narrow second column (202 px of a 340 px
   stage). The stage now declares one explicit column and both panels take it.

Neither showed up in a type check or a bundle: both need a real box on screen.

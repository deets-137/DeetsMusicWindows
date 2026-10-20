---
status: shipped
shipped_in: 0.26.0
desk_test: passed 2026-10-12
sources: [src/layout.ts, src/layout-rules.ts, src/card-grow.ts, src/full-player.ts, src/styles.css, index.html, src/settings-store.ts, src/agent-settings.ts, src/settings-card.ts, src/rulez-words.ts, src/rulez-logs.ts, src/compass.ts, src/appearance.ts, src/boot-cover.ts, src/rulez-card.ts, src/surface.ts]
updated: 2026-10-20
---
# DeetsMusic — Max cards: one, two or four content cards in Max

> **Status (2026-10-11):** the idea came from the owner. He closed the forks the same day (§1).
> Built the same day on `ten-out-of-ten`, on top of the full player (468b657); shipped in 0.26.0.
> §11 is the as-built record. The desk test (§7) passed: the owner ran it (his report,
> 2026-10-12). The shots pass is §7a. Every fork is closed (§9).

**Max can show fewer content cards.** Today Max always shows four content cards in a 2×2 grid
beside the stage column. With this feature the user picks one card, two cards, or four. The
stage column (Now Playing above the Queue) does not change.

## 0. Terms

- **Stage column:** the left column of Max. It holds Now Playing above the Queue. Both are
  anchored: no picker removes them (STAGE-COLUMN.md).
- **Bento:** the grid of content cards to the right of the stage column. Today it is 2×2.
- **Content slot:** one place in the bento that holds one card. The slots are named `left`,
  `right`, `c` and `d` in the code.
- **Composition:** the object in `src/layout.ts` that lists a surface's content slots, its
  anchored cards, its default cards and its storage key.
- **Card count:** the number of content slots Max shows: 1, 2 or 4.
- **Shape:** for two cards, *2 columns* (side by side: two tall cards) or *2 rows* (stacked:
  two wide cards).
- **Fill:** a grown card that covers every other content card (CARD-GROW.md).

## 1. The decisions (the owner, 2026-10-11)

| Fork | His pick |
|---|---|
| A layout that stays, or Max opened at Fill | A layout that stays: a real card count (Fill is temporary and keeps the other cards mounted under it) |
| The shape of two cards | Side by side, **and** stacked is also available |
| One card | Included |
| The default cards for two | Home and Library (the same as Midi's first row) |
| The default card for one | Home |
| The row's words | *Layout for Max*: *4 cards* · *2 columns* · *2 rows* · *1 card* (§3) |
| Grow with two cards | The Grow words and a direction (*Grow right*, *Grow down*). Fill is implied, so there is no separate *Fill* item (§4.4) |
| A rule key | Yes, in this build (§4.9) |

Two small forks are still open (§9).

## 2. What the user sees

Each picture is the Max window. `S` is the stage column.

```
4 cards (today)        2 columns              2 rows                 1 card
┌───┬──────┬──────┐    ┌───┬──────┬──────┐    ┌───┬─────────────┐    ┌───┬─────────────┐
│   │ left │right │    │   │      │      │    │   │    left     │    │   │             │
│ S ├──────┼──────┤    │ S │ left │right │    │ S ├─────────────┤    │ S │    left     │
│   │  c   │  d   │    │   │      │      │    │   │    right    │    │   │             │
└───┴──────┴──────┘    └───┴──────┴──────┘    └───┴─────────────┘    └───┴─────────────┘
```

- Each content card keeps its picker, its Grow button (where a grow is possible, §4.4) and its
  right-click menu.
- The Queue still grows up over Now Playing in every layout (STAGE-COLUMN.md §7).
- Midi and Mini do not change. The card count is a Max setting only.
- The window bands do not change: Max starts at the same width and the same height floor
  (`surface.ts`, `MAX_FLOOR_H = 745`). A smaller floor for one card is out of scope (§10).

## 3. The setting

**One choice row in Settings › Window**, in the *Window sizes* group, under *Max window when
short*. One row holds both the count and the shape, so the user makes one pick.

| | |
|---|---|
| Key | `maxCards` |
| Values | `"4" \| "2cols" \| "2rows" \| "1"` |
| Default | `"4"` (today's layout; an update changes nothing on screen) |
| Label | *Layout for Max* (his words, 2026-10-11) |
| Pills | *4 cards* · *2 columns* · *2 rows* · *1 card* (his words, 2026-10-11) |
| Hint | *How many cards Max shows beside Now Playing and the Queue* |

*2 columns* is the side-by-side shape. *2 rows* is the stacked shape.

A string, not a number: the two-card shapes are two values of one key, and a choice row in
`settings-card.ts` takes string values.

## 4. The code paths

### 4.1 `src/layout.ts` — the compositions

Today (`layout.ts:47`–`69`):

```ts
const MIDI: Composition = { key: "deets.layout.midi", slots: ["left", "right"], … };
const MAX:  Composition = { key: "deets.layout.max",  slots: ["left", "right", "c", "d"], … };
const compositionFor = (s: SurfaceName): Composition => (s === "max" ? MAX : MIDI);
```

**The change:**

1. Add a `max: boolean` field to `Composition`. One place tests `comp === MAX` today
   (`allowedFor` at `layout.ts:74`). It must read `comp.max`, or a Max-only card (Rulez) cannot enter a two-card or one-card Max.
2. Add two compositions beside `MAX`:

   ```ts
   const MAX_2: Composition = {
     key: "deets.layout.max2",
     slots: ["left", "right"],
     anchored: ["now-playing", "queue"],
     defaults: { left: "home", right: "library" }, // his call 2026-10-11
     queueSlot: true,
     max: true,
   };
   const MAX_1: Composition = {
     key: "deets.layout.max1",
     slots: ["left"],
     anchored: ["now-playing", "queue"],
     defaults: { left: "home" }, // OPEN (§9)
     queueSlot: true,
     max: true,
   };
   ```

3. `compositionFor` reads the setting:

   ```ts
   const maxFor = (): Composition => {
     const n = effective("maxCards");
     return n === "1" ? MAX_1 : n === "4" ? MAX : MAX_2; // "2cols" and "2rows" share one map
   };
   const compositionFor = (s: SurfaceName): Composition => (s === "max" ? maxFor() : MIDI);
   ```

   *2 columns* and *2 rows* share `MAX_2` and its storage key. The shape is CSS only
   (§4.3), so a shape change moves the same two cards and remounts nothing.

4. **A count change while in Max.** The surface listener at `layout.ts:674` already does the
   full swap of maps: `flushSwapOut()`, `decompose()`, `loadLayout()`, `compose()`, then the
   Max-only cards at Fill. Move that body into one `recompose(next)` function. Call it from the
   surface listener and from a new `onSettingsChange` listener for `maxCards`. The listener
   compares compositions (`next === comp`), so a change between *2 columns* and *2 rows*
   does not remount. It only sets the attribute (§4.2).

5. **Each count keeps its own cards.** Each composition has its own key, so the 4-card map is
   still there after a week on two cards. `loadLayout` and `repairAssignment`
   (`layout-rules.ts:41`) already work on any `slots` list. No change there.

6. **Things that already work on any slot list and need no change:** the slot pickers, the
   LRU landing place for a summon (`layout.ts:323`–`340`), the swap and replace motion, the
   drill swap and its chains, *Hide from picker*, and the `card.open` rule event.

7. **The attribute.** `compose()` sets `document.documentElement.dataset.maxCards` to the
   setting's value, on every surface (the CSS reads it only under `[data-surface="max"]`).

### 4.2 `index.html` — the pre-paint

The pre-paint script (`index.html:20`–`44`) already reads `deets.settings` for the theme and
the skin. Add one line there: read `S.maxCards` and set `data-max-cards` on `<html>`, `"4"` if
it is missing. Without it, the first paint of a two-card Max shows the 2×2 grid for one frame,
then the cards jump.

The two unused slots (`c`, `d`, and `right` for one card) stay in the HTML
(`index.html:438`–`442`). CSS hides them. They hold no card, so they cost nothing.

### 4.3 `src/styles.css` — the grids

Today `[data-surface="max"] .bento` (`styles.css:1907`) is one 2×2 grid, and `c` and `d` show
in Max (`styles.css:1945`–`1946`). Add one rule set per count, under the existing ones:

```css
/* Max cards (MAX-CARDS.md §4.3): 2 columns, 2 rows, 1 card. The stage keeps its column. */
[data-surface="max"]:is([data-max-cards="2cols"], [data-max-cards="2rows"], [data-max-cards="1"]) .panel:is([data-slot="c"], [data-slot="d"]) { display: none; }
[data-surface="max"][data-max-cards="1"] .panel[data-slot="right"] { display: none; }

[data-surface="max"][data-max-cards="2cols"] .bento {
  grid-template-columns: minmax(0, var(--max-stage-w)) repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "stage left right";
}
[data-surface="max"][data-max-cards="2rows"] .bento {
  grid-template-columns: minmax(0, var(--max-stage-w)) minmax(0, 1fr);
  grid-template-rows: repeat(2, minmax(0, 1fr));
  grid-template-areas: "stage left" "stage right";
}
[data-surface="max"][data-max-cards="1"] .bento {
  grid-template-columns: minmax(0, var(--max-stage-w)) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "stage left";
}
```

- The `:is(…)` with `[data-surface]` and `[data-max-cards]` on the same element must win over
  `styles.css:1945`. It has more specificity, so it does.
- **The stage column's height** comes from the bento's rows (`styles.css:1917`). With one row
  the stage spans that row. With two rows it spans both. Both cases give the full height, so
  the Queue's floor (745 px) holds.
- **The grow spans** (`styles.css:4015`–`4024`) are 2×2 numbers. Two of them already fit:
  in *2 columns*, `left`/`right` wide is `1 / 2 / 2 / 4`, the whole content area; in *2 rows*,
  `left` tall is `1 / 2 / 3 / 3`, also the whole content area. Add one rule: in *2 rows*,
  `right` tall is `1 / 2 / 3 / 3` too (today's `right` tall is column 3, which does not exist
  there). The covered card is placed by hand, like Midi's rule at `styles.css:4032`, or
  auto-placement opens a new row for it.
- **The full player** (`docs/features/fullscreen-player.md`, built in the same tree, 2026-10-11)
  sets `data-player="full"` (on the bento since 2026-10-19): in Max, Now Playing spans `1 / 2 / 3 / 4` and the Queue
  `1 / 1 / 3 / 2`. Those numbers assume content columns 2–3 and rows 1–2. With one column or
  one row, Now Playing must still cover the whole content area: `1 / 2 / -1 / -1` covers every
  count. Read that session's CSS when this build starts.
- **The boot lift** delays (`styles.css:4000`–`4004`) need no change. A hidden slot has no
  animation that the user sees.
- No new tokens. The grids use `--max-stage-w` and `--panel-gap`, which exist.

### 4.4 `src/card-grow.ts` — grow with fewer cards

Card grow has the 2×2 shape in three places:

| Place | Today | The change |
|---|---|---|
| `MAX_NEIGHBOR` (`card-grow.ts:64`) | `left` has `right` and `c` as neighbors | One neighbor table per count. *2 columns*: `left ↔ right` (left / right). *2 rows*: `left ↕ right` (down / up). One card: no neighbors |
| `canFill()` (`card-grow.ts:127`) | `currentSurface() === "max"` | Max with four content slots only |
| `beyond()` (`card-grow.ts:695`) | Hard-coded columns 2–3, rows 1–2 | Reads a geometry table: each slot's columns and rows per count |

**With two cards, there is no separate Fill (his call, 2026-10-11).** A grow toward the other
card covers it, so Fill is implied. The words stay the Grow words with a direction:

- `canFill()` is false, so *Fill* leaves the title's menu (`growMenu`, `card-grow.ts:521`), and
  the Grow button cycles rest → grow → rest (`buttonAction`, `card-grow.ts:508`).
- The menu shows *Grow right* / *Grow left* in *2 columns*, *Grow down* / *Grow up* in
  *2 rows*. The edge zone toward the neighbor grows. **Since 2026-10-20 (his ask) the right
  strip and the far outer strip grow too** (the top card's top, the bottom card's bottom; in
  *2 columns* each card's top and bottom, and the right card's right): the result is the same
  grow over the other card. The left strip beside the stage stays Now Playing's.
- A rule's grow (`growByRule`, `card-grow.ts:345`) with the axis of the neighbor grows. A rule
  that asks for `full` takes the grow toward the neighbor (the result is the same).
- **The full player's rule** (from that session, 2026-10-11): the left edge of the content
  area is Now Playing's half gap. The Fill strip on the LEFT side of `left` and `c` drops to
  half reach while Now Playing's right strip is live (fullscreen-player.md §10.3). The geometry
  table keeps that rule: the slot in content column 1 has the stage on its left, in every
  count.

**With one card, the content card does not grow.** `growDirs` is empty and `canFill()` is
false, so the button and the zones do not appear (`attachGrowButton` already hides a button
with nothing to do). The Queue still grows up over Now Playing.

### 4.5 Max-only cards (Rulez)

Rulez opens at Fill (`layout.ts:486`; RULEZ.md §1.1), and its X brings back the card it
replaced (`closeCard`, `layout.ts:404`).

- **Two cards:** Rulez opens in a slot and grows toward the other card, so it covers the whole
  content area, as at Fill today. `fillCard` (`card-grow.ts:394`) takes the grow toward the
  neighbor when `canFill()` is false and the slot has one.
- **One card:** Rulez takes the one slot. `fillCard` does nothing, because there is no other
  card to cover. The X brings the replaced card back.

### 4.6 Card memory

A card's place (scroll, drill, view) is kept per card id, not per slot (CARD-MEMORY.md). So a
card that moves from slot `c` in four-card Max to slot `left` in two-card Max comes back where
the user left it. No change.

### 4.7 Telemetry counts

`appearance.ts:206` and `boot-cover.ts:88` count `.bento .panel` to time the boot lift and the
appearance lift. Both count the hidden slots too. Change both to count the panels that show:
`[...document.querySelectorAll(".bento .panel")].filter((p) => p.offsetParent !== null)`. This
is a small bug today too: Midi counts the hidden `c`, `d` and `queue`.

### 4.8 The setting's other parts (CLAUDE.md › Working style)

| Part | Where |
|---|---|
| Key, default and the "why" | `settings-store.ts`: `maxCards: "4" \| "2cols" \| "2rows" \| "1"`, default `"4"` |
| The row | `settings-card.ts`, Window section, after `maxshort` (`settings-card.ts:1101`); add `"maxCards"` to the section's `keys` (`settings-card.ts:412`) |
| New badge | One line in `NEW_MARKS`: `{ section: "Window", row: "maxcards" }` |
| Agent | `agent-settings.ts`: `storeChoice("Window", "maxCards", "Layout for Max", [...])`, beside `maxShortWindow` (`agent-settings.ts:134`); one line in AGENT.md beside `maxShortWindow` |
| Inventory | One row in SETTINGS-INVENTORY.md, under *Max window when short* |
| Compass | A store-backed row is automatic (COMPASS.md §9). Add the words *bento*, *layout*, *fewer cards* to `SYNONYMS` in `compass.ts` and to COMPASS-TERMS.md |
| Hint | The row's hint goes in the ONBOARDING.md §1 ledger |
| Surface menu | The Max item's hint says *the stage, the queue, and four cards* (`index.html:139`). It reads the count, or it says *and your cards* (open, §9) |
| Log line | `diag.log("layout:max-cards", { from, to })` in the new listener |

### 4.9 A rule key

`maxCards` is a value a rule may set, so it goes in `RULE_KEYS` (`settings-store.ts:720`), and
`compositionFor` reads it with `effective` (§4.1). Examples: *While Battery saver is on, Max
shows 2 cards*; *While Hop in is Cruisin, Max shows 2 cards*. No new rule route is needed.
He said yes to it in this build (2026-10-11).

### 4.10 Tests

`layout-rules.ts` already holds the pure rule, under test. Add, in `tests/layout-rules.test.ts`:

- A stored 4-card map, loaded under the two-slot list, keeps `left` and `right` and drops `c`
  and `d`. (Each count has its own key, so this happens only for a hand-edited key. It is a
  guard.)
- A two-slot map with a hidden card in `right` takes Library, or the next free card.
- A one-slot map with no stored value gives the one-card default.

The grid and the grow geometry are DOM and CSS, not pure. The geometry table in `card-grow.ts`
(§4.4) can be a pure export, with one test per count: which directions each slot has.

## 5. What does not change

- Midi, Mini and the player view.
- The stage column, its locked Now Playing and the Queue's grow up.
- The window bands, the open sizes and *Max window when short*.
- The card registry, the cards themselves, and Settings › Cards (HIDE-CARDS.md).
- The schema. There is no Rust change.

## 6. Cost

- About 150–250 lines of code: `layout.ts` ~40, `styles.css` ~35, `card-grow.ts` ~60 (the
  geometry table is most of it), the setting's parts ~30, tests ~40.
- One doc (this one), plus one line each in AGENT.md, SETTINGS-INVENTORY.md, ONBOARDING.md
  and COMPASS-TERMS.md.
- No Apple calls. Fewer cards mount, so Max with two cards boots with less work and less memory
  than Max with four.
- It touches the layout manager and card grow, which are shared primitives. Under the one
  load-bearing feature rule, it is the feature in flight while it is built.

## 7. The desk test

> **Part:** passed · the owner ran it (his report, 2026-10-12)

Run on `npm run dev:app`, in Max. The owner or Claude can run it (the shots runner covers the
pictures).

### 7a. The shots pass (Claude, 2026-10-11, the web demo)

Three scratch lists, kept in `shots/scratch/` (gitignored): `maxcards` (17 shots, Glass),
`maxswitch` (the real Settings row, a rapid-switch stress, a switch while grown) and
`maxskins` (6 shots × the 5 skins = 30). All ran; none failed.

- **Pictures:** each layout is right in every skin: the grid lines up with the stage column,
  nothing is clipped, the Queue keeps the full height.
- **Frames:** the app's own `[perf] frames` lines showed no dropped frame in grow, collapse,
  the Queue's grow, swap, boot, the full player or Rulez, in any skin. Four single 36 ms frames
  in all the runs: a card swap, and the back-to-4-cards switch (two more cards mount). A
  layout change paints in one frame; no half-built frame between two layouts.
- **Press → paint** of a layout pick: 48–88 ms (`[perf] input`).
- **Stress:** five picks 120 ms apart ended on the last pick, with no swap left running,
  nothing in the unused slots, and the Queue mounted once. A pick while a card was grown ended
  the grow with no motion, and the new grid was clean. The full player closed at once on a
  layout change, with no card left covered.
- **Steps checked:** 2–6, 8, 11, and the probes of 1 and 3. Not checked by the shots: the
  WebView2 frame numbers, step 7's first frame on a real launch, step 9 (the agent), his eye.
- **Found:** from four cards, Settings opened in slot `d`; the pick of *2 columns* took
  Settings off the screen, because two-card Max shows its own cards (Home | Library). Fixed the
  same day by his call (§9.3): the re-run shows Home | Settings.

1. Settings › Window › *Layout for Max* › *2 columns*. Home and Library show side by side. Now
   Playing and the Queue do not move.
2. Pick Search in the right card's picker. Go to *4 cards*. The 4-card map is as you left it.
   Go back to *2 columns*. Home and Search show.
3. *2 rows*. The same two cards show, one above the other. Nothing remounts (scroll a list
   first; the scroll place stays).
4. Right-click the left card's title. The menu shows *Grow right*, and no *Fill*. Grow covers
   the other card. Esc collapses it. In *2 rows*, the menu shows *Grow down*.
5. *1 card*. One card shows. Its title has no Grow button. The Queue still grows up over Now
   Playing.
6. Open Rulez from the picker in *1 card*. It takes the slot. Its X brings back the card it
   replaced.
7. Restart the app on *2 columns*. The first frame shows two cards, not four (the
   pre-paint, §4.2).
8. Drag the window to Midi and back to Max. The two-card layout comes back.
9. Ask the agent: `settings set maxCards 1`. Max changes to one card.
10. Ctrl+Space, type *bento* (or *layout*). The row comes up.
11. With the full player open in *2 columns*, *2 rows* and *1 card*: Now Playing covers the
    whole content area, and the Queue keeps the stage column.

## 8. Build order

**Start after the full player session hands its build to him.** That build touches
`card-grow.ts`, `layout.ts` and the Max grid CSS in the same tree (branch `ten-out-of-ten`,
uncommitted).

1. `layout.ts`: the `max` flag, the two compositions, `recompose`, the attribute.
2. `index.html` pre-paint and the `styles.css` grids. At this point, the three layouts show.
3. `card-grow.ts`: the geometry table, Grow without Fill for two, no grow for one, `fillCard`.
4. The setting's parts (§4.8) and the rule key (§4.9).
5. The telemetry count fix (§4.7), the tests, `npm run check`.

## 9. Open forks

> **Part:** project · 2026-10-11 · forks §9

He closed every fork on 2026-10-11 (§1 and below).

1. **Hop in** — closed 2026-10-11: no. The Cruisin preset does not set the layout. A separate
   onboarding route will offer it (not designed).
2. **The surface menu hint** — closed 2026-10-11: it names the count ("Dynamic naming works").
   *The wide window: the stage, the queue, and four cards* / *two cards* / *one card*.
3. **The card you pick the layout from** — closed 2026-10-11: Settings stays on screen (found
   by the shots pass, §7a). When Settings is on screen at a layout change and the new layout
   does not hold it, it takes the new layout's LAST slot (Library's in two cards, Home's in
   one). The new count's saved cards are not changed: a restart shows them. `keepCard` in
   `layout-rules.ts` (tested); `recompose(next, cause, keep)` in `layout.ts`; the log line
   `layout:max-cards` carries `keepSettings`. Shots: `maxswitch` › `row` shows Home | Settings,
   still at the row.

## 10. Out of scope

- A smaller minimum width or height for Max with one card. The bands in `surface.ts` stay.
- Three cards (an L shape). He did not ask for it, and card grow has no shape for it.
- A per-card size (one wide card and one narrow card). The two cards are equal.

## 11. As built (2026-10-11, branch `ten-out-of-ten`, uncommitted)

Where this section and §4 disagree, this section is the code.

- **The geometry is pure** (`layout-rules.ts`, under test in `tests/layout-rules.test.ts`):
  `MAX_CELLS` (each slot's column and row per layout), `maxSlots`, `maxNeighbors`,
  `maxBeyond`, `maxCanFill`, `maxCardsOf` (an unknown stored value reads as `"4"`). The
  compositions take their slot lists from `maxSlots`, and card grow reads the rest.
- **`layout.ts`:** `MAX_2` (`deets.layout.max2`, Home | Library) and `MAX_1`
  (`deets.layout.max1`, Home); `Composition.max` replaced `comp === MAX`. `recompose()` serves
  the surface flip and the new `maxCards` listener. Between two Max maps the Queue is NOT
  remounted (`decompose(keepQueue)`): the stage column does not move. `markMax()` sets
  `data-max-cards` from `effective("maxCards")`. The log line is `layout:max-cards`.
  `dropFromSaved` (Hide cards) now walks all four maps.
- **`card-grow.ts`:** `MAX_NEIGHBOR` is one table per layout, built from `maxNeighbors`.
  `canFill()` is four-card Max only, and is exported. `beyond()` calls `maxBeyond`. A grown
  card in two-card Max keeps its outer strips, and they collapse it. `fillCard` and a rule's
  `full` grow take the grow toward the neighbor when there is no Fill. On a `maxCards` change
  a grow collapses with no motion (`collapseNow("layout")`) before the layout remounts.
- **`full-player.ts`** (the other session's file, two small edits): Now Playing's right strip
  takes the whole gap when `canFill()` is false (no Fill strip shares it); a `maxCards` change
  closes the full player with no motion and repaints its strips.
- **`styles.css`:** the three grids after the Max block; one grow span (`2rows` right tall);
  the full player's Max spans are now `1 / 2 / -1 / -1` (Now Playing) and `1 / 1 / -1 / 2`
  (the Queue), so they fit every layout.
- **`index.html`:** the pre-paint sets `data-max-cards` from your value. A rule's value comes
  when the rules load (`markMax`), so a rule that sets the layout can show a jump at launch.
- **The boot and appearance lifts** (`boot-cover.ts` `liftSteps()`): the lift's length is the
  last stagger step among the panels on screen, not the panel count. The count was too long in
  Midi (it counted the hidden `c`, `d`, `queue`) and would have been one step short in
  one-card Max.
- **The rule key:** `maxCards` in `RULE_KEYS`; the While word *Layout for Max* in
  `rulez-words.ts` (says *keeps Max at …*), its target words in `rulez-logs.ts`, a test in
  `tests/rule-keys.test.ts`.
- **The row:** Settings › Window, after *Max window when short*, with a `NEW_MARKS` line;
  the agent spec beside `maxShortWindow`; Compass also answers *bento* and *grid*.
- **The surface menu's Max hint** names the count (§9.2): `markMax()` sets the item's `title`
  from `MAX_HINT` in `layout.ts`; hint.ts adopts each new value. `index.html` keeps the
  four-card text for the first paint.

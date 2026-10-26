---
status: idea
desk_test: none
sources: [src/styles.css, src/styles/skin.css, src/home-card.ts, src/onboarding-looks.ts, src/settings-card.ts]
updated: 2026-10-26
---
# Density: Compact or Spacious shelves

**An idea (2026-10-26), from user feedback.** A user said parts of the app are cluttered and
hard to read at a glance. Their example is the Home card in Max: five shelves of covers, one
under the other. This doc holds what the code does today, his calls, and the open forks.
Nothing is built.

**The terms.**
- *A shelf:* a label and one row of cover tiles that scrolls sideways (`.search__label` +
  `.search__scroller` of `.search__tile`).
- *The label:* the caps word above a shelf ("RECENTLY ADDED").
- *The gutter:* the strip under a shelf's tiles where its sideways scrollbar is drawn.
- *Density:* the new setting, Compact or Spacious.

## 1. What the code does today (read 2026-10-26)

- **No space between shelves.** `.lib-shelves` and `.home-shelf` (styles.css) have no gap. The
  next label sits directly under the last shelf's scrollbar.
- **The scrollbars act as dividers.** Each shelf shows its bar at rest. On the Home card in
  the feedback picture, these bars are the heaviest lines on the card, and they carry no
  meaning until the user wants to scroll.
- **The gutter is not reserved, so the spacing is uneven.** `.search__scroller` sets
  `scrollbar-gutter: stable`, but that property reserves the gutter of a *vertical* bar only.
  A horizontal bar takes height only when the tiles overflow. In the picture, the New shelf
  (two tiles) has no bar, so it sits closer to the next shelf than the others do.
- **The label is quieter than the tiles under it.** `.search__label` is 12 px (11 px in Cyber),
  caps, in `--subtext`. A tile name is also 12 px, but in `--title`, which is brighter. So the
  shelf's name reads as less important than one album's name.
- **The covers are 96 px** (`--tile-art`, skin.css), with 8 px (`--space-2`) between tiles.
- **One set of rules draws every shelf.** `.search__tile` is used by Home, Search, the artist
  view, the Library's album and artist levels (`media-levels.ts`), Pins and the Album Reviews
  card. A change to the shared tokens reaches all of them.
- **The app already has a section divider.** The artist page draws a rule above each section
  label (`--section-rule-w` in `--border`, then `padding-top: var(--space-2)`). If a divider
  is tested, it is this one, not a new style.

## 2. His calls (2026-10-26)

1. **A setting, Compact or Spacious**, not one fixed change for everyone. One `density` key
   scales the shelf tokens. It is a pick on Grand Opening page 2 (his sketch puts it under the
   Size column, GRAND-OPENING.md §7) and a row in Settings › Window.
2. **Every shelf**, not Home only. The shelves share tokens and stay the same everywhere.
3. **The scrollbar is hidden at rest and appears gently on hover.** Its gutter is reserved
   always, on every shelf, whether it scrolls or not. The spacing stays even, and nothing
   moves when the bar appears.

## 3. The design as it stands

**Follows from any choice (Claude's reading, his to confirm):**
- A gap between shelves. There is none today.
- The label in `--title`, not `--subtext`. The order reads label, then tile name, then the
  sub line.
- The reserved gutter (§3.2). It also fixes the uneven gap under the New shelf.

### 3.1 Spacious, the first numbers (to measure on the dev app)

| part | today | Spacious |
|---|---|---|
| gap between shelves | 0 | 24 px (`--space-5`), plus the gutter: about 32 px seen |
| label size | 12 px (11 Cyber) | 14 px |
| space under the label | 4 px | 8 px |
| cover | 96 px | about 120 px, but less in a narrow card (§3.3) |
| gap between tiles | 8 px | 12 px |

Compact keeps today's sizes, with the fixes above. The numbers are tokens in skin.css base; a
skin overrides only what it changes. `:root[data-density="spacious"]` sets the Spacious values.

### 3.2 The gutter and the hover

- Reserve the gutter: `overflow-x: scroll` on `.search__scroller` (not `auto`) draws the track
  on every shelf, so each shelf has the same height. The track stays transparent.
- Hide the thumb at rest and fade it in while the pointer is over the shelf or the shelf has
  keyboard focus.
- **A probe before the build:** Chromium does not run a CSS transition on a
  `::-webkit-scrollbar-thumb`. Two ways to test: a registered `@property` color on the
  scroller that the thumb reads, or the standard `scrollbar-color` property (Chromium 121+;
  when it is set, the `::-webkit-scrollbar` rules no longer apply, so it changes the bar's
  shape too). If neither fades, the thumb appears with no fade.
- Reduced motion (`motionReduced()`, `[data-motion="reduced"]`): the thumb appears with no fade.

### 3.3 A cover that fits the card

At 120 px, a Midi-width card shows 2.5 tiles instead of 3. The Album Reviews card already
solves this kind of problem with a `clamp()` on the card's width (`--diary-top-fit`,
`100cqw`). Spacious's cover follows that pattern: 120 px when there is room, never under 96 px.

### 3.4 The divider

The divider is a test, not a call yet. With the bar hidden and the gap in place, the space
alone may be enough. If it is not, the artist page's rule goes above each label. The two are
compared on the dev app by setting the token values live, with no commit.

## 4. Open forks

- **D1. The default.** Spacious for new installs only, Spacious for everyone, or Compact for
  everyone.
- **D2. Mini.** Does Spacious apply in Mini, where the card is narrowest, or does Mini keep
  Compact?
- **D3. Beyond shelves.** His call is every shelf. Do list rows (Library, Queue, History) join
  later under the same key, or does Density stay with shelves?
- **D4. A rule key.** Is `density` a rule key (`effective`), so a rule can set it (for example,
  Spacious in Max only)?
- **D5. The words.** "Compact" and "Spacious" from his sketch, and the row's label and hint.

## 5. The build checklist this touches (CLAUDE.md)

A settings key (default with its why, `agent-settings.ts`, AGENT.md), a `NEW_MARKS` line, the
hover hint in ONBOARDING.md §1, the Compass row (automatic for a store-backed row),
`npm run tokens` in the same commit as skin.css, and the Grand Opening page 2 pick.

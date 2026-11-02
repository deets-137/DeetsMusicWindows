---
status: idea
desk_test: none
sources: [src/styles/skin.css, src/styles.css, src/ocean.ts, src/vinyl.ts, src/skin-settings.ts, src/album-color.ts, src/skin.ts]
updated: 2026-11-01
---
# Cross-skin: one skin borrows a piece of another

**An idea (2026-11-01), to talk through with him piece by piece.** Each skin has pieces that
only it shows today: Ocean's sea and its album light, Press's record and its offset plate. This
doc is about letting another skin borrow one of those pieces. Nothing is built.

**The terms.**
- *A piece:* one part of a skin's look that can stand alone, for example the sea's glow from
  the deep, or the record on the cover.
- *The home skin:* the skin a piece comes from.
- *To borrow:* to turn a piece on in a skin that is not its home skin.
- *A hook:* a `--hook-*` token in skin.css that a skin sets to say "this module runs here"
  (`--hook-sea`, `--hook-record`). skin.ts copies each hook onto `<html>` as `data-hook-*`.
- *The plate:* Press's card shadow, `--shadow-card: 4px 4px 0 var(--ink-2)`: a hard offset in the
  theme's second ink, which makes the card look raised off the page.

## 1. His calls (2026-11-01)

1. **A row in each skin's Skin settings.** A skin that can borrow a piece gets a row for it in
   its own Skin settings, the way Metal's *Cover change* row works. Not one shared row for every
   skin. (The other option was one "Borrow effects" row in Settings › Skin.)
2. **A borrowed piece is fitted to the skin that borrows it, not copied as it is.** His example:
   in Press, the plate (the bevel, the slight raise) glows with the album cover's color. Press
   does not get the sea. What travels is the *idea* (Ocean's album light: the album's color
   lights the skin's own shape), drawn in Press's own language.

The rest of this doc is for the chat. Nothing in §4 or §5 is decided.

## 2. What the code has today (read 2026-11-01)

- **The modules already run on hooks, not on the skin's name.** `--hook-sea: on` and
  `--hook-record: on` are set only in the Ocean and Press blocks (skin.css). ocean.ts draws the
  main sea while the hook is on (`active()`); a preview's sea checks `[data-hook-sea="on"]`
  (ocean.ts `shows`). vinyl.ts asks the box's `--vinyl` value (`isRecordHere`).
- **The sea also needs `--ocean-display`** (skin.css base `none`; styles.css `.ocean` reads it).
- **Press's record rows are scoped to Press.** skin.css:
  `[data-skin="press"]:is([data-press-vinyl="spin"], [data-press-vinyl="still"]) { --vinyl-stage: 1; }`.
  The setting keys are `pressVinyl*`. A borrow needs the same rules for the borrowing skin,
  under its own key, or a renamed shared key.
- **Album light is Ocean's slider** (Settings › Album light, `--ocean-light` 0–100). It raises
  the glow from the deep and paints neon crest lines in the album's color (ocean.ts, OCEAN.md §7).
- **The album's colors are already on the page** for every skin: `--album-c1`, `--album-c2`,
  `--album-bg` (album-color.ts), with a contrast guard for text. Glass's aurora reads them
  (`--album-aurora-display`, "glass opts in; other skins later").
- **Press is "printed, not lit"** (skin.css, the Sound panel's comment). Its shadows are hard
  offsets with no blur: `--shadow-card`, `--shadow-panel` (menus, 5 px), `--vinyl-plate-shadow`
  (the record's plate).

## 3. The pieces that could travel

| Piece | Home skin | What it is | Notes |
|---|---|---|---|
| The sea | Ocean | three swell bands under the cards (ocean.ts) | heavy on the GPU; hidden under opaque cards |
| The heave | Ocean | the bands rise with the music | needs the sea, and the Sound graph routed |
| Ripples | Ocean | rings on a play or a drop | needs the sea |
| Glow from the deep | Ocean | the album's color rising from the bottom of the canvas | light; could stand alone on a canvas |
| Album light | Ocean | the album's color lights the skin's own lines | his Press example is this piece, redrawn |
| The record | Press | the cover as a turning disc (vinyl.ts) | owns the cover change; clashes with a skin's own (§5) |
| The plate | Press | the hard offset shadow | already a token; another skin could take it |
| The halftone | Press | the dotted canvas (`--canvas-bg`) | a token; theme hairline color |
| The aurora | Glass | the album halo behind Now Playing | already marked "other skins later" |

## 4. His example: the Press plate in the album's color

What it would be: `--shadow-card` (and maybe `--shadow-panel` and `--vinyl-plate-shadow`) take
the album's color in place of `--ink-2`, and change with each album at `--album-fade-dur`.

Questions for the chat:
1. **Flat ink or a glow?** A flat plate in the album's color keeps Press's printed look (a
   second ink run in the cover's color). A soft glow (a blur) is what "glow" says, but it is the
   first lit thing in Press. Both can be the row's choices.
2. **Which plates?** The cards only, or the menus and the record's plate too.
3. **Which color?** `--album-c1` (the cover's main color) or the brighter of c1 and c2. A dark
   cover on a dark theme gives a plate you cannot see, so the color needs a floor, as the text
   guard has.
4. **With no album** (nothing played yet, or the ♪ placeholder): back to `--ink-2`.
5. **The row:** its name and choices in Press's Skin settings, and whether it is a rule key
   (the Live Theming rules in RULEZ.md §11 could set it).

## 5. The general questions (for later in the chat)

1. **Which pairs make sense.** Not every piece fits every skin: the sea under Metal's opaque
   plates is never seen; the record on Metal fights the zoetrope. A table of the pairs he wants.
2. **One cover change at a time.** The record, the zoetrope (Metal) and the pet (Happy) all run
   through vinyl.ts's turn (`--cover-swap`). A skin that borrows the record must give up its own,
   or the row offers one or the other.
3. **The keys.** Per skin (`glassSea`, `metalRecord`), or one key per piece with a skin scope.
   Per skin matches his call 1 and the `metal*` keys; each is then on the usage allow-list as a
   choice (USAGE-COUNTS.md §4).
4. **Cost.** A borrowed sea costs what Ocean's costs. The *Reduce motion* row and the graphics
   fallback already turn it off (`motionReduced()`, GRAPHICS-FALLBACK.md §10), because it is the
   same code.
5. **Mods.** A borrow row writes tokens and hooks on the public layer (mods.md §10), so a
   downloaded skin could turn the same pieces on.
6. **The grand opening's Fashion page** shows each skin in its own look: does a borrowed piece
   show there too.

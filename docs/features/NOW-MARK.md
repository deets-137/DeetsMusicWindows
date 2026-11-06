---
status: built
desk_test: passed 2026-11-04
sources: [src/now-mark.ts, src/now-mark-rules.ts, src/collection-card.ts, src/collection-window.ts, src/keyed.ts, src/queue.ts, src/styles/themes.css]
updated: 2026-11-05
---
# Now mark — the playing song on its row

> Designed 2026-11-04 from a user's post ("Show current song on album") and his idea: a chevron
> in the list's margin that slides to the next song. Every fork is closed (§2). Built the same
> day; his hand test passed (§7).

## 1. Terms

- **The now mark:** the one mark in a song list that shows the playing song. It has two shapes.
- **The chevron:** the shape in the list the song plays from. It says "this list is playing, and
  I move to the next song".
- **The line:** a vertical line, the shape in any other list that holds the song. It says only
  "this song is playing".
- **The source list:** the list whose context tag matches the current queue entry's `context`,
  when the entry is part of the list's own run (`origin: "auto"`). A song added by hand (Play Next)
  carries the list it came from, but it does not play from that list, so it wears the line.

## 2. His calls (2026-11-04)

| # | Call |
|---|---|
| N1 | A mark in the left margin beside the row, not bold text and not a change to the row. |
| N2 | The chevron shows only in the source list. Any other list that holds the song shows the line, in the same color. |
| N3 | A short move slides. A long move fades out and in. |
| N4 | The color is one alias, `--now-mark`, over existing roles (§4). No new color. |

## 3. Behavior

- **The chevron slides** to the next song when the next song is near its row. The limit starts at
  8 rows, and he tunes it in the hand test. Beyond the limit, it fades out and fades in on the new row.
- **The line never slides.** It fades out on the old row and in on the new one.
- **A song listed twice:** in the source list, one chevron shows, on the copy you pressed, else
  the copy nearest its last place. In another list, each copy gets a line. Known limit: a press on
  the other copy of the song already playing does not move the chevron, and a pane rebuilt by Back
  starts again from the first copy.
- **The list becomes the source** (the user starts the song from it): the line changes to the
  chevron with a fade.
- **The next song is not in the list:** the mark fades out.
- **The mark follows the queue's current song,** the song Now Playing shows. Paused, it stays. A
  queue restored at launch shows it too. It goes when the queue has no current song.
- **The list never scrolls** to follow the mark.
- **Tile views show no mark.** The mark needs rows.
- **Reduced motion:** the mark moves with no slide, through `motionReduced()` and
  `[data-motion="reduced"]`.

## 4. The color

`--now-mark` is a new name, not a new color. Two lines in `themes.css`:

- In `:root`: `light-dark(var(--ink-2), var(--new-badge))`.
- In Black & Yellow: `var(--rule-chip-hand)`.

Contrast against the card, measured 2026-11-04 on the base themes:

| Theme | Color | Contrast |
|---|---|---|
| Lilac | magenta | 5.3 |
| Green | rose | 4.8 |
| Sepia | terracotta | 5.6 |
| Moonlight | yellow | 9.5 |
| Black & Yellow | red | 5.3 |
| Black & Red | yellow | 12.2 |

No single role works in all six: Black & Yellow and Black & Red are nearly one color each.
Metal changes some themes' roles, so check Metal at build time.

## 5. How it fits the code

- **The pattern:** `.drop-line`, the insertion line, is one element in a list, placed by script.
  No marker slides from row to row today.
- **The place:** `.coll-viewport` clips the card's margin, so the mark sits in the row's own left
  padding (`--space-2`, 8 px), just left of the cover. It is a child of the scroller, so it scrolls
  with the rows, with no script on a scroll frame. No layout changed.
- **Long lists:** above 200 rows only nearby rows exist (`collection-window.ts`). So the mark is one
  element placed by index, not a part of a row. `centerOf` counts from a drawn row, not `heroH`.
- **Two layers:** the outer element holds the place (a transform), the glyph holds the fades and the
  reveal wave (`.now-mark__glyph` is a reveal tile). Motion is the Web Animations API, so a press
  during a slide turns from where the mark is.
- **Redraws:** `data-patch-keep` makes `patchHTML` leave the mark and its motion alone.
- **A pane is drawn before it is in the page,** so its rows have no place yet. The list's
  ResizeObserver and the windower's `data-win` make the list paint again, with no motion. Every
  draw of a list ends in `paintMark`.

## 6. As built

- `src/now-mark-rules.ts` is the pure rule (`tests/now-mark-rules.test.ts`), `src/now-mark.ts` the
  marks. A song list opts in with `Grouping.nowMark`: `songsGrouping` and the playlist page do, so
  Library, albums, artists, genres, the Full views and playlists show it. Search rows and the Diary
  are outside the engine (the Diary has its own `.is-playing`).
- The motion tokens are in `skin.css` (`--now-mark-*`). The ease is `--nav-ease`, so each skin's
  slide feels like its own. `--now-mark-reach` is the 8-row limit.
- The row carries no `aria-current`, so a screen reader hears nothing of the mark (his call,
  2026-11-05: leave it out).

**The break-it pass (three Sonnet agents, 2026-11-04).** Six faults found and fixed: a pane drawn
before it was in the page (the mark at the top of the list after Back, or missing on a long list);
`centerOf` stale after a head grew; a slide jumping to its target before a fade; Play Next making
a list the source; the Full | Lib switch animating the mark as a row; a press on a song's second
copy landing on the first.

## 7. Desk test

`docs/ops/checks/now-mark.mjs` on the dev app, muted: 18 cases, all ok, 2026-11-04. Cold, Next,
Previous, rapid Next, a long move, a redraw during a slide, a sort both ways, Back on a short list
and on a 417-song list, a slide cut by a long move, Play Next, reduced motion.

- **Timing gate:** worst frame gaps of 60 to 132 ms during a Next. One long task of 59 ms, at the
  song's load. The mark's own scan costs 0.54 ms on 4,147 songs. It moves only transform and
  opacity, so the load should not hold it, but this ran on the dev server, not `dev:built`.
- **Not run:** the motion monitor, frames read at full size, and the theme, surface and skin
  changes during a slide. His hand test came first, by his choice. Closed by his word, 2026-11-05
  ("now mark is done").
- **His hand test:** passed, 2026-11-04 ("hand tested and good to go"). The slide, the 0.42 s and the
  8-row reach stay as built.

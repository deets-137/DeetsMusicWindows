---
status: designed
desk_test: none
sources: [src/collection-card.ts, src/collection-window.ts, src/queue.ts, src/styles/themes.css]
updated: 2026-11-04
---
# Now mark — the playing song on its row

> Designed 2026-11-04 from a user's post ("Show current song on album") and his idea: a chevron
> in the list's margin that slides to the next song. Every fork is closed (§2). Not built.

## 1. Terms

- **The now mark:** the one mark in a song list that shows the playing song. It has two shapes.
- **The chevron:** the shape in the list the song plays from. It says "this list is playing, and
  I move to the next song".
- **The line:** a vertical line, the shape in any other list that holds the song. It says only
  "this song is playing".
- **The source list:** the list whose key matches the current queue entry's `context`.

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
- **A song listed twice:** in the source list, one chevron shows, on the copy nearest its last
  place. In another list, each copy gets a line.
- **The list becomes the source** (the user starts the song from it): the line changes to the
  chevron with a fade.
- **The next song is not in the list:** the mark fades out.
- **Paused:** the mark stays. **Stopped:** the mark goes.
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
- **The margin:** `--panel-pad` is 12 px and the row adds 8 px. The mark stays small and solid, so
  it does not read as the Back chevron.
- **Clipping:** `.lib-view` clips what is outside it. The scroller extends left over the margin,
  with equal padding, so the rows stay in place. The mark then scrolls with the rows, with no script
  on a scroll frame.
- **Long lists:** above 200 rows only nearby rows exist (`collection-window.ts`). So the mark is one
  element placed by index, not a part of a row.

## 6. Check at build time

- A playlist's `context` equals its page key (`playlist:<id>`). Check the album and Library keys.
- Which cards draw the mark. The collection engine covers Library, Playlists, albums and artists;
  Search rows and the Diary are outside it (the Diary has its own `.is-playing`).
- DESK-TESTS.md §6.6 applies: the mark moves.

## 7. Desk test (to write at build time)

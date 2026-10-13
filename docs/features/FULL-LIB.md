---
status: built
desk_test: open
sources: [src/media-levels.ts, src/library-model.ts, src/library-card.ts, src/collection-card.ts, src/add-square.ts, src/styles.css, src/styles/skin.css]
updated: 2026-10-13
---
# DeetsMusic — Full | Lib: Apple's whole page from a Library drill

**Designed and BUILT 2026-09-24.** The owner's forks: 1A, 2A, 3A, 4A (with the Add square's
+ and ✓), and the labels "Full | Lib". The desk test is §7.

## 1. Terms

- **Lib view:** an album or an artist as the Library card shows it before this feature. It
  lists only the songs in your library.
- **Full view:** Apple's catalog page for the same album or artist. Before this feature, only
  the Search card showed it.
- **The pill:** "Full | Lib", one split pill in the Library card head, left of the ⟳
  square. It shows on an album level and an artist level only. It is the shared split pill
  (`split-pill.ts`), the same control the Search card's scope uses (SEARCH-FIELDS.md §6): in
  both, Full means Apple Music and Lib means your library.

## 2. What it does

- A drill from the Library opens the Lib view, as before (fork 3A). The **Lib** half is
  pressed. Nothing asks Apple until you press **Full**.
- **Full** replaces the level with the Full view, in the same card (fork 1A). It does not add a
  level: Back goes to where the drill came from (fork 2A). The drill swap's way back
  (CARD-GROW.md §14–§15) is kept on the new level.
- **Lib** on a Full level goes back to the Lib view. The half is dimmed, with a hint, when the
  library holds none of it (§4).
- The Full view is a collection-card level, not a Search pane. So Sort, View, Search, the
  grown card's columns, multi-select, drag and card memory work on it.

### 2.1 The Full album

- The hero: Apple's cover, the album name, the artist (tappable: the artist's Full view), and
  year · songs · length. A right-click on the hero is the album menu (catalog album).
- The rows: every song of the album in track order. A song you have shows the **✓** at rest
  (fork 4A). A song you do not have shows the **+** on hover, as on every other song row. An
  unreleased song is dimmed and has no square (SEARCH.md §Unreleased songs).
- Opened from a song (Go to Album in the Full view, or Full on a Lib album opened from a
  song), that song's row is lit, as in the Lib view (his call, 2026-10-13). It is found among
  Apple's rows by catalog id, then by ISRC.
- The ♥ state is asked once per install when the album opens, as the Lib view and the Search
  pane ask it (2026-10-13; the Full view did not before).

### 2.2 The Full artist

- The hero: the photo (round), the name, the first genre. A right-click is the artist menu,
  and a left-click on the photo opens the same menu, as in the Lib view (his call, 2026-10-13).
- The shelves: **Albums** (Apple's albums, newest first; a tile drills to that album's Full
  view), **Featured Playlists**, **Your Playlists** (the same as the Lib view and Search).
- The rows: Apple's **Top Songs**, under a sticky "Top Songs" bar. The Sort adds **Popular**
  (Apple's order, the default) and **Most Played** (this app's own play counts, zero calls; his
  call, 2026-10-13) to the usual song sorts. A top song's plays are the sum over every copy
  of it in your library (catalog id, ISRC or title), since Apple's copy is often another
  release with its own id (ARTIST-VIEW.md §10.2).

### 2.3 Menus in the Full view

"Go to Album" and "Go to Artist" on a Full row stay in the Full view: a song there may not be
yours, so the Lib album would be empty. "Song Credits" and a genre open the Library's own
levels, as in the Lib view.

## 3. Apple calls

All of it is in the memory-only session caches in `search.ts` (CARD-MEMORY.md §6). Nothing
is saved to disk (Apple's terms on stored catalog content).

| Press | Calls |
|---|---|
| Full on a Lib album | 1 hop (song → album, memoized) + 1 (the album's songs, cached). 0 the second time in a session. |
| An album tile on a Full artist | 1 (its id is known). |
| Full on a Lib artist | 1 (`catalog_artist`, cached). The artist id is the one the Lib view saved in `artist_catalog`: 0. If that is not saved yet: 1 more. |
| The artist link on a Full album | 1 hop (album → artist, memoized) + 1. |
| Lib | 0. |

An album with an unreleased song is not cached, so each open asks Apple again (as in Search).

## 4. Back to Lib

- **A Full album** goes to the Lib album it came from. From a Full album that you reached
  another way (an artist's shelf), Lib finds a library song of that album by catalog id, then
  by ISRC. If there is none, Lib is dimmed: *None of these songs are in your library*.
- **A Full artist** goes to the Lib artist when a song by that name is in your library. If not:
  *No songs by this artist are in your library*.

## 5. As built

- `src/media-levels.ts` (since 2026-10-13; it replaced `fullViews` in a module of its own) —
  `mediaLevels(deps)` builds all four levels and their resolver: one album builder and one
  artist builder (`albumLevel`, `artistLevel`), each fed by a Lib source and a Full source
  (ARTIST-VIEW.md §10.1). The builder owns the parts; a source owns only the data. A card
  hands it the pieces it owns (its engine handle, the song grouping, the hero cover, its
  drills). The album model it shares with the Library card is `src/library-model.ts`, so
  there is no import cycle.
- `collection-card.ts` — `Context.views` (a `ViewSwitch`: the options, the active key, `to`)
  and `replace(ctx)`. The engine draws the pill into the head's `[data-coll-views]` slot on
  every header change. `replace` keeps the head still, swaps the body with no slide, and runs
  `enterRows` on the new body. A `reload()` paints the pill again, so Lib wakes up when the
  album's songs land.
- `library-card.ts` — the slot in `HEAD`; `SongOpts.mark` (the marked square and the
  unreleased dim); its drills and its resolver hand the album and artist levels, Lib and Full,
  to `mediaLevels`.
- `add-square.ts` — `addSquareHTML(t, cls, mark)`. `mark` shows the ✓ on a song you have,
  whatever Settings › Apple Music › "Show ✓ on songs you have" says.
- The queue tags are Search's: `search-albums:<id>` and `search-artist:<id>`. Home reads
  `search-albums:` as the album it played (home.ts `containerOf`).
- Log: `library:full` (kind, id, row count, failed) per load; `ui:act` `do: "view"` per press.
- `split-pill.ts` — `splitPillHTML(halves, active, label)` and `splitPick(e)`. The engine
  draws it; the Search card's scope pill (SEARCH-FIELDS.md §6) uses the same two calls.
- Tokens: `--split-pill-radius`, `--split-pill-pad`, `--split-pill-fs`, `--split-pill-weight`,
  `--split-pill-dim` — aliases of the header-action family (UI-ARCHITECTURE.md §2a).
  Changed the same day from two panel chips (the owner's fork A, 2026-09-24): both "Full |
  Lib" controls sit in a card head, so both are the header-action family and one primitive.

### 5.1 The switch, smoothed (2026-10-13)

> **Part:** built · 2026-10-13 · desk test passed 2026-10-13 (below, run by Claude on the dev app)

**His note:** the switch between Full and Lib jittered and jumped. **Measured first** (a probe
over the open pane, every 16 ms): `replace` rebuilt the whole pane, so the same hero rose in
again (`enterRows` ran on it); a Full level drew an empty state first — the hero 23 px shorter
(no meta line), no rows — and redrew when Apple answered (0.4 s for an album, over 3 s for a
cold artist), the rows popping in with no motion; a cached switch was a hard cut; and on the
artist, the play counts and Your Playlists landed just after the switch and redrew the rows,
cutting their rise short at 190 ms.

**His calls (2026-10-13), all three as recommended:**
1. **Stay, then switch once.** The pressed half breathes (`aria-busy`, the Search busy dot's
   pulse) until the new level's data is in (`Context.ready`: an album's songs; an artist's page
   plus the local play counts and Your Playlists). Then the page switches once, full. Cached:
   at once. The Last.fm box is not waited for (it slides in beside the cover when it lands).
2. **Fade out, rise in.** The hero stays — the drawn one is kept (`keepHero`, its cover never
   loads again); a line that changed (the meta, a name) is swapped and rises in, and the facts
   box changes in place (`setHeroAside`). The list under it (Play, shelves, the bar, the rows)
   fades out (`--view-leave-dur` = `--dur-fast`), then the new one rises in (`enterRows`).
3. **Keep your place.** Above the rows: the same scroll. Down in the rows: the first new row,
   under the sticky bar.

**As built:** `collection-card.ts` `replace` → `swapView`, `keepHero`, `listParts`,
`readingRows`, `pendingView` / `markPending`; `Context.ready`; `CollectionCardHandle.reload(ctx)`
(a level not on screen is not redrawn — a Full level waiting to open redrew the Lib one for
nothing). `media-levels.ts` sets `ready`, passes its level to `reload`, and a Full level shows
the cover it opened with first (the Lib one), so the hero matches. A hero compares by its
picture and its button; its lines by markup with `title` read as `data-hint` (hint.ts renames
it once drawn — the artist's cover button never matched before this). Tokens:
`--split-pill-busy-dur`, `--view-leave-dur`. Logs: `view:wait` (to, ms, dropped), and `ui:act`
`do: "view"` now says `hero: kept|new` and `place: kept|rows`; `[perf] frames view`.
Reduced motion: no fade, no breath, no rise.

**Desk test 2026-10-13 (Claude, dev app):** The Fool, Lib → Full: the chip breathed 285 ms,
the list faded about 95 ms, 8 rows rose in; the hero was the same element throughout, its
height steady. Full → Lib the same, starting at once. Lucy Park both ways: hero kept (it was
rebuilt before the `data-hint` fix), the rise ran to its end (cut at 190 ms before the wait for
the local reads). Scroll 120 px stays 120 px; from the rows' end it lands on the first new
row. Search's album: hero kept both ways. `[perf] frames view`: 244 Hz, worst frame 8 ms (the
swap's own frame, dev build).

### 5.2 Rapid presses, Play / Shuffle, the scrollbar (2026-10-13)

> **Part:** built · 2026-10-13 · desk test passed 2026-10-13 (below, run by Claude on the dev app)

**His note** (on Ambiguous Desire (Deluxe), 2 songs in Lib, 20 in Full): clicking Full and Lib
rapidly jittered; Play and Shuffle re-rendered in the same place; the scrollbar jumped in.
**Read in the code and the log:** a press during the 100 ms fade was dropped (`animating`), and
the pill still showed the old half until the switch landed, so a fast second press went
nowhere or late; Play / Shuffle was in the list that fades and rises; Lib (2 songs) did not
scroll and Full (20) did, so the 8 px bar came and went and moved the rows and the centered
hero sideways.

- **The pill shows the pressed half at once** (`viewTarget`, painted by `paintViews`); the
  level follows. A press during the fade calls it back (`callBackFade`: the old list fades back
  in) or retargets it. A press on the half that shows drops a wait on its way.
- **Each view is built once and kept with the level** (`viewsOf`, carried from frame to frame):
  toggling reuses it — no new load, no wait (every `view:wait` 0 ms in the test).
- **What is the same stays**: the hero, and the leading parts under it whose markup is the same
  — Play / Shuffle, a grown card's column header (`kept` in the `ui:act` line). A kept part
  takes the new hover hints (an artist's Play hint names its list). Parts compare with the
  hints and the motion's marks (`--pop-i`, `pop-enter`) taken out.
- **The bar's place is kept on a Full | Lib level** (his call: reserve it there only):
  `.lib-view[data-switch] { scrollbar-gutter: stable }`. A short list there shows the 8 px strip;
  every other list is as before (CLAUDE.md checklist 6a).

**Desk test 2026-10-13 (Claude, dev app):** Ambiguous Desire, grown: six presses 60 ms apart —
the pill followed every press, the page ended on the last one; five presses 170 ms apart — five
switches landed, `hero:kept kept:2`; the view width (690 px) and the hero's x (377 px) never
changed, sampled every 16 ms. The Library root list keeps `scrollbar-gutter: auto`. Lucy Park:
presses 60 and 200 ms apart, the last press wins, `hero:kept kept:1`, waits 0 ms, the width and
the hero still.

## 6. Decisions made inside the owner's forks (for review)

1. The control is the shared **split pill** (header-action family, the room pill's cut): the
   pressed half is `--picked`. (First built as two panel chips; the owner chose one shared
   pill the same day.)
2. The ✓ shows **at rest** in the Full view, and the + only on hover, as elsewhere.
3. The ✓ ignores the "Show ✓ on songs you have" setting in the Full view only.
4. The artist link on a Full album opens the artist's **Full** view, not the Lib view.
5. Go to Album / Go to Artist on a Full row stay in the Full view (§2.3).
6. The Full artist's rows are Apple's Top Songs, with a Popular sort as the default.
7. The swap has no slide. The head stays still and the new rows come in (`enterRows`).
8. The Library ⟳ square stays to the right of the pill.
9. Queue tags reuse Search's (§5), so Home's album tiles work for plays from here.

## 7. Desk test (open)

1. Library › Albums › an album you own part of. Press **Full**: every song shows, yours with a
   ✓, the others with a + on hover. The header still says "Album". Back goes to Albums.
2. Press **Lib**: your songs only. Press Full again: it opens at once (session cache).
3. On a Full row, press **+**: it turns, then shows ✓. The Lib view now has the song.
4. Library › Artists › an artist. Press **Full**: Albums, Featured Playlists, Your Playlists,
   Top Songs. Press an album tile: its Full view opens as a new level; its Lib half works if you
   own some of it, and is dimmed with the hint if not. Back returns to the Full artist.
5. On a Full album, press the artist name: the artist's Full view.
6. Grow the Library wide, then Fill: the Full rows take the columns; the ✓ sits after the title.
7. Right-click a Full row: Go to Album stays in the Full view. Multi-select and drag to the
   Queue work.
8. Drill from another card into the Library (drill in place, CARD-GROW.md §15), press Full,
   then Back: the first card comes back.
9. Leave the card on a Full level, change the surface and back (card memory): it reopens there.
10. An album with a song that is not out yet: that row is dimmed and plays nothing.
11. Offline: Full shows "Couldn't read the album from Apple Music." Lib still works.

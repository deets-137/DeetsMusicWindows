---
status: built
desk_test: open
sources: [src/library-full.ts, src/library-card.ts, src/collection-card.ts, src/add-square.ts, src/styles.css, src/styles/skin.css]
updated: 2026-09-24
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

### 2.2 The Full artist

- The hero: the photo (round), the name, the first genre. A right-click is the artist menu.
- The shelves: **Albums** (Apple's albums, newest first; a tile drills to that album's Full
  view), **Featured Playlists**, **Your Playlists** (the same as the Lib view and Search).
- The rows: Apple's **Top Songs**, under a sticky "Top Songs" bar. The Sort adds **Popular**
  (Apple's order, the default) to the usual song sorts.

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

- `src/library-full.ts` — `fullViews(deps)` builds the two Full levels and their resolver.
  The Library card hands it the pieces it owns (the song grouping, the hero cover, the Lib
  builders, its drills), so there is no import cycle.
- `collection-card.ts` — `Context.views` (a `ViewSwitch`: the options, the active key, `to`)
  and `replace(ctx)`. The engine draws the pill into the head's `[data-coll-views]` slot on
  every header change. `replace` keeps the head still, swaps the body with no slide, and runs
  `enterRows` on the new body. A `reload()` paints the pill again, so Lib wakes up when the
  album's songs land.
- `library-card.ts` — the slot in `HEAD`; `views` on `albumDetail` and `artistDetail`;
  `SongOpts.mark` (the marked square and the unreleased dim); the resolver takes
  `full-album:` and `full-artist:` keys.
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

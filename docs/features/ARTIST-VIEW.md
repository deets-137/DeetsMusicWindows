---
status: shipped
shipped_in: 0.6.0
desk_test: passed 2026-09-15
sources: [src/artist-view.ts, src/collection-card.ts, src/library-card.ts, src/search-card.ts]
updated: 2026-10-13
---
# Artist view — hero, Featured Playlists, Your Playlists

Designed with the user 2026-09-15, built the same day. Status: **BUILT, desk-tested, shipped (80ac7bb).**

## Terms
- **Library artist view** — the view after a click on an artist in the Library card
  (`library-card.ts` `artistDetail`, a collection-engine context).
- **Search artist view** — the pane after a click on an artist in the Search card
  (`search-card.ts` `fillArtist`, plain HTML).
- **Hero** — the big cover, title and meta line at the top of a detail view
  (UI-ARCHITECTURE.md §Detail hero).
- **Shelf** — a labelled horizontal scroller of tiles under the hero.
- **Chip** — the drag copy of a row or tile (`row-drag.ts` `makeGhost`).

## 1. What each view shows

Top to bottom. An empty shelf is hidden.

| | Library artist view | Search artist view |
|---|---|---|
| Hero cover | Artist photo, round (`--hero-artist-radius`). Until the photo is known: a song's album cover, round. | Artist photo, round |
| Hero title | Artist name | Artist name |
| Hero meta | "12 albums · 84 songs" | The first genre |
| Card / pane header | "Artist" | "Artist" |
| Shelves | Albums (newest first; a tile drills in place), Featured Playlists, Your Playlists | Albums, Featured Playlists, Your Playlists |
| Below | "Songs": the artist's library songs as rows, newest first (Sort/View still apply) | Top Songs (Apple's `top-songs` view: Apple's popularity order) |

**Library Songs sorts** (user, 2026-09-15: "sort option for each"). Apple's library data has no
popularity, so two sorts join A–Z / Release Date / Added Date:
- **Popular** — Apple's `top-songs` order for the artist. It rides call 2 with the featured
  playlists (0 extra calls) and is saved in `artist_catalog.top_songs`. A library song matches
  a top song by catalog id, then ISRC, then title (library and catalog ids can differ). The
  songs that match no top song follow, newest first. Apple returns its default number of
  top songs (no `limit` is sent).
- **Most Played** — this app's own play counts (`play_counts`, from `play_stats`): full
  listens first, starts break a tie, never-played songs last. Zero Apple calls.

The Search Albums shelf keeps Apple's `full-albums` order. Apple does not document that order.

The Library order matches the Search order (user, 2026-09-15). The Albums shelf replaced
the old Albums grouping, so the artist context has one grouping (Songs). Sort / View / Search
now act only on those rows, so they sit under the "Songs" label, not at the top of the pane
(user, 2026-09-15; `Context.toolbarBelow`). The head block (hero, shelves, label, toolbar) is
rebuilt only when the hero or shelves change, so a sort or a keystroke keeps the pills and
the search field's focus. The label + toolbar bar is **sticky**: once the hero and shelves
scroll away it stays at the top of the card over the songs (user, 2026-09-15). It is its own
child of the scroll view (`.lib-view-bar`), painted with `--sticky-bar-surface` /
`--sticky-bar-backdrop` = the card's own `--panel` and `--panel-backdrop`, so it reads as no box
(user, 2026-09-15: the menu surface looked jarring). Cyber's card is see-through with no
frost, so its bar adds a blur. Glass: the card's top glow (`--panel-paint` gradient) is not
repeated on the bar, so a small tint step may show there.

## 2. Decisions (the forks)

1. **Library photo = 1A.** Show the round album cover at once, then fetch the real photo and
   save its **link** in SQLite. Compliance: the app already saves Apple artwork links for
   every song (`cache_tracks`); the image still loads from Apple each time. This is not the
   mosaic case (a new image made from Apple art, kept in memory only — PLAYLISTS.md §11).
2. **Library layout = 2B.** Shelves sit between the hero and the rows. Engine change:
   `Context.shelves?: () => string` is drawn right after the hero, inside the same block
   the windower measures (`collection-window.ts` takes it as part of `hero`). Clicks on
   `[data-shelf-item]` go to `Context.onShelf`, right-clicks to `Context.shelfMenu`.
3. **Your Playlists coverage = 3B.** Match against every playlist whose songs are stored:
   all local playlists, and each Apple playlist that was opened once. If some Apple
   playlists were never opened, the shelf ends with a "Check N more playlists" tile. It
   fetches each one once, four at a time, and the tile counts up ("Checking 3 of 12"). A
   fetch is 1 call per 100 songs, so a one-at-a-time check was slow (seen 2026-09-15). The
   songs are saved, so later checks are free.
   A mirror sync that finds a changed playlist, or the Playlists ⟳, drops saved songs,
   and those playlists count as unchecked again.
4. **Featured Playlists in the Library = 4A**, refreshed after **7 days** or on the Library ⟳.
5. **A Your Playlists tile opens in the Playlists card = 5A**, with a chip flight:
   **5a A** — the "Animate card swaps" setting controls it; **5b A** — each skin shapes it.

## 3. Matching ("Your Playlists")

The same credit parser as the Artists grouping (`artist-credit.ts`): a playlist song counts
when the artist is one of its parsed credits, with the **library vocabulary** (so a song
that features the artist counts). Tiles sort by that song count, most first; the subtitle
reads "5 songs". A local playlist's linked Apple copy is hidden (PLAYLISTS.md §6 "one row").

Data: `playlists_song_index` (Rust) returns every stored playlist's songs plus the Apple
playlists with no stored songs. Zero Apple calls. The front end keeps it until the
playlist change bus fires.

## 4. Apple calls

The Library artist view makes calls only when an artist opens — never at sync or launch.
Everything below is saved in `artist_catalog` (enrich.rs), keyed by the library artist name.

| When | Calls |
|---|---|
| First open of an artist | **2** — `songs/{id}?include=artists` (id + photo), then `artists/{id}?views=featured-playlists,top-songs` |
| Again within 7 days | **0** |
| After 7 days, or after the Library ⟳ | **1** — the featured playlists; the id is never fetched again |
| "Check N more playlists" | **1 per 100 songs of each unopened Apple playlist**, once |
| Chip flight to a Featured playlist | **1+** (its songs, fetched before the flight and handed to the Search pane, which then fetches nothing) |
| Search artist view | **1 on every open** (`catalog_artist`) — `featured-playlists` joins that `views=` fetch, so the shelf adds 0. Not saved in `artist_catalog`; a memory-only cache is designed in CARD-MEMORY.md §6 |
| Start Station on a Library artist | 0 once the id is saved (it shared a session-only cache before) |

**`artist_catalog` belongs to the Library artist view only** (keyed by the library artist
name). The Search artist view (keyed by catalog id) reads nothing from it and writes nothing to
it. On 2026-09-17 a plan assumed the Search pane was partly cached here; it was not. Read the
command in `apple.rs` before you quote a call count.

The Search fetch asks for `top-songs,full-albums,featured-playlists`. If Apple refuses the
request (a non-200 that is not 404), it asks once more with the old two views, so a wrong
view name cannot break the Search artist view.

## 5. Opening a playlist from a shelf

| Tile | Library artist view | Search artist view |
|---|---|---|
| Featured playlist | Search card, catalog playlist pane (`go-to.ts`, chip flight) | A pane in place |
| Your playlist | Playlists card, the playlist's detail (chip flight) | Playlists card (chip flight) |

**The chip flight** (`handoff.ts`), synced to the view it opens (user, 2026-09-15: the chip
first landed while the playlist view was still loading):
1. A chip is made from the tile, fixed on `<body>` (it survives the source card leaving).
2. The target card is summoned. If it is already on screen, the layout does not change
   (the `requestCard` fix below). If not, it comes in with the card-swap motion.
3. At the same time `prepare` fetches the playlist's songs. The chip waits on the tile
   until the card-swap motion has ended and the songs are in.
4. The chip flies to the centre of the target card and fades (`--fly-dur`).
5. The view opens `--nav-dur` before the landing, with the songs handed over
   (`requestOpenPlaylist(id, tracks)` / `PlaylistPaneIntent.tracks`), so its drill slide
   ends as the chip lands and the view arrives full. A failed fetch still opens the view,
   which then loads as usual.

Motion off (Animate card swaps off, or the OS reduced-motion preference; a caller whose flight
swaps no card passes `ownMotion` and follows reduced motion only — the playlist web): no chip; the
card is summoned and the playlist opens at once. Skin tokens (skin.css §chip flight):
`--fly-dur`, `--fly-ease`, `--fly-mid` (shape at the midpoint), `--fly-land`,
`--fly-land-fade`. Press stamps, Ocean dips, Glass uses the base (a straight glide),
Cyber skews.

## 6. The `requestCard` fix

`requestCard(id)` used to call `setSlot(lruSlot(), id)` even when `id` was on screen in
another slot, so the two cards swapped (seen as "Go to Album" moving the Search card). Now
a card already on screen in the current composition stays where it is. A card in mini's
hidden right slot is not on screen, so it still comes into the left slot.

## 7. Files

- Rust: `enrich.rs` (`artist_catalog` table), `apple.rs` (`library_artist_info`,
  `library_artists_expire`, featured view on `catalog_artist`, `Artist.genres`),
  `playlists.rs` (`playlists_song_index`), `model.rs`, `lib.rs`.
- Front end: `artist-view.ts` (data + shelf markup), `handoff.ts` (chip flight),
  `collection-card.ts` (shelves), `library-card.ts`, `search-card.ts`, `playlists-card.ts`
  (open request), `playlists.ts` (open bus), `go-to.ts` (catalog playlist intent),
  `start-station.ts` (shared id), `layout.ts` + `layout-bus.ts` (fix + host lookup),
  `card-swap.ts` (`whenSwapSettled`), `row-drag.ts` (export the chip maker), CSS + skin tokens.

## 8. Your own order (designed 2026-09-27)

> **Part:** designed · 2026-09-27

Settings › Window will set the order of the four parts under the hero, and hide any of them.
One order for Library and Search. A rule can change it by condition. [LAYOUT.md](LAYOUT.md) §3.1.

## 9. The Last.fm facts box beside the hero (built 2026-10-12)

> **Part:** built · 2026-10-12 · desk test passed 2026-10-13 · for release, behind its own Settings row
> (*Show artist info on the artist's page*); on a narrow card it folds under *Artist Info*.
> LISTENERS.md §6

His design: in both artist views the round photo moves to the left and a box sits on its
right, Last.fm's tags and an *On tour* marker in one column, the artist's plays and listeners
in the other. The hero takes an `aside` (`Hero.aside`, `heroHTML`) and becomes a wrapping row.
The data, the cache, the markup and the desk test are [LISTENERS.md §6](LISTENERS.md). Top
tracks and similar artists, the next two reads, are an idea he designs: ideas/LastfmArtist.md.

## 10. One code path for the Apple pages (decided 2026-10-12, not built)

> **Part:** designed · 2026-10-12

There are three artist views. Library › Lib (`library-card.ts`) and Library › Full
(`library-full.ts`) are collection-card engine levels. The Search artist pane (`search-card.ts`
`fillArtist`) is its own HTML, and it reads the **same** `artistDetail(id)` as Full. The Search
album and playlist panes (`fillCollection`) duplicate the Full album the same way. A feature
added to one copy is missed in another: the facts box was missing from Full (his find,
2026-10-12).

**His calls (2026-10-12):** the Search card's Apple panes run the engine's Full levels, one
code path for every Apple page; Search keeps its **compact rows** (the engine draws a compact
list in Search, not the Library table). Not a go to build: it starts after the facts box desk
test (LISTENERS.md §6.3), one step at a time with a desk test each: the artist pane, then the
album pane, then the playlist pane. What must hand over to the engine: the pane stack and Back,
the picks and their count row, the chip flights, *Check N more*, the hero menus, card memory.
The forks inside each step (what the compact row shows, which toolbar Search keeps) are his, to
bring him before that step.

### 10.1 His calls (2026-10-13)

> **Part:** designed · 2026-10-13

The facts box desk test passed on 2026-10-13, so the gate is open. It is still not a go: the
facts box and `hero-slide.ts` work is committed first, and the build waits for his word.

1. **The engine starts at the first drill.** The Search results page (the box, the filter, the
   tiles, the station tiles) stays the Search card's own code. The first album, artist,
   playlist, song or writer that opens starts one engine (`collection-card.ts`) in the card, and
   every level after it is an engine level. Back on the first level closes the engine and shows
   the results.
2. **Full | Lib stays a swap, and works in Search too.** Lib is not a filter on Full: an album
   could nearly be one (an edition or an uploaded copy is the edge), an artist cannot (Full
   lists Apple's Top Songs, Lib lists every song of the artist you hold). In Search, Lib opens
   the Lib level in place, in the Search card. So the Lib album and Lib artist levels leave the
   Library card's `mount` for a shared module.
3. **Lib and Full are structured the same.** One builder per page (an album, an artist) with two
   data sources (your library, Apple), not two builders. The same parts in the same places; only
   the data differs. The differences today are the table below; each "his" row is a fork to
   bring him before that step.
4. **The song pane and the writer pane are step 4**, after the artist, album and playlist
   panes. They run the Library's `songDetail` / `writerDetail` levels.
5. **The Apple levels in Search show the full toolbar** (Sort, View, the Search pill), as Full
   does in the Library. Search's compact row is the default density there.

**Lib and Full today** (read from the code, 2026-10-13):

| Part | Lib | Full | Decided |
|---|---|---|---|
| Album ♥ state asked on open (`reconcileAlbum`) | yes | **no** (the Search pane does) | parity, no fork: Full asks too |
| Artist hero line | "N albums · N songs" | the genre | his (2026-10-13): **kept as today** |
| Artist cover button (`coverMenu`, left-click) | yes | no | his (2026-10-13): **Full gains it** |
| Artist sorts | Popular, Most Played | Popular | his (2026-10-13): **Full gains Most Played** (own play counts, zero calls) |
| Artist default sort | release, newest first | Popular | kept: the data differs (all your songs vs a top list) |
| Artist rows label (`toolbarBelow`) | Songs | Top Songs | data, no fork: it names the list |
| Rows end in the Add square with ✓ (`mark`) | no | yes | his (2026-10-13): **kept**: every Lib row is yours |
| Album opened from a song: the song lit (`selectedId`) | yes | no | his (2026-10-13): **Full gains it** |
| Albums shelf | your albums | Apple's albums | data, no fork |

The artist's default sort was not put to him: it follows from the data, and he kept the
other data-led rows. Bring it to him if a step changes it.

**The steps:** 1, the shared builders (the Library only) · 2, the Search artist pane · 3, the
album pane · 4, the playlist pane · 5, the song and writer panes. One desk test each.

**His calls for steps 2–5 (2026-10-13):** build them in one sitting, each step desk-tested by
Claude on the dev app and committed on its own before the next; a new fork found in a test
stops the run.
- An album page in Search shows **track numbers**, not a cover per row (as the Library does).
- A song page lists the writers as **rows** (the Library's song level), not chips.
- *Go to Genre* from a Lib row inside Search opens the genre **in the Library** (a Library view).
- Apple's playlist page gets **its own builder** in the shared module; a merge with the
  Playlists card's playlist level is a later project.
- Already his: compact rows in Search (never the column table, even grown), the full toolbar,
  Full | Lib in Search with Lib in place.
- Decided inside "structured the same" (told to him, 2026-10-13): the shared album keeps the
  Search pane's pre-release line ("Coming 09/25", "3 of 10 songs out"), so the Library's Full
  album shows it too. The search field stays above the levels; a new search returns to the
  results, as today.

### 10.2 Step 1 as built: one builder per page (2026-10-13)

> **Part:** built · 2026-10-13 · desk test passed 2026-10-13 (§10.3, run by Claude on the dev app)

- `src/media-levels.ts` replaces `library-full.ts`. `mediaLevels(deps)` returns the four
  levels (`libAlbum`, `libArtist`, `fullAlbum`, `fullArtist`) and their `resolve`. Inside, one
  `albumLevel(data)` and one `artistLevel(data)` own every part; the four sources give data
  only (an `AlbumData` / `ArtistData` record).
- `src/library-model.ts` holds the album model and its pure helpers (`albumKey`,
  `groupAlbums`, `albumOrder`, `artistOrder`, `libAlbum`, `artURL`, `trackId`, `playsKey`),
  moved from `library-card.ts`, which re-exports the four that other modules import.
- `library-card.ts` keeps the root, the genre, song and writer levels; its drills and its
  resolver hand albums and artists to `mediaLevels`.
- Each builder calls `card.heroAside(ctx)` once for the facts box (LISTENERS.md §6b); no
  `card.reload()` on that path.
- Full gains, per the table: the ♥ question, the cover button, Most Played, the lit song.
- Decided inside his calls (for him to see): a Full artist asks Last.fm and Your Playlists
  **once**, by the first name it knows. Opened from the Library, that is the name at once (as
  before). Restored by its id alone, it waits for Apple's name; before, it asked Last.fm for
  "Artist". The Lib artist's Most Played and Popular sorts are the same code as Full's now.
- **Most Played on a Full row counts your copies (found in the desk test).** Apple's top song is
  often another release of a song you hold (a single, an EP) with its own catalog id, so the
  first build found one played song of Lucy Park's top ten. A Full row now sums the plays of
  every library copy of the song by the artist (any match key: catalog id, ISRC, title — the
  keys Popular uses). OUTLINE is held twice, the single with no plays and the EP with them;
  both count. A Lib row keeps its own count, as before.

### 10.3 Desk test, step 1 (the Library only; Search is unchanged)

1. Library › Albums › an album: the hero, the facts box sliding in, the rows in track order,
   the ♥ state. Right-click the hero: the album menu, no Go to Album.
2. Full on that album: Apple's rows with + / ✓. Lib goes back. Back from either goes to the
   Albums list.
3. A song row › Go to Album: the album opens with that song lit. Press Full: the same song
   is lit among Apple's rows.
4. Library › Artists › an artist: the photo, the count line, the shelves, the Songs bar.
   Left-click the photo: the artist menu. Sort: Popular, Most Played.
5. Full on that artist: the genre line, Top Songs. Left-click the photo: the artist menu
   (new). Sort › Most Played (new): songs you played lead.
6. On the Full artist, an album tile: the Full album. Its artist link: the Full artist.
7. Card memory on a Full artist level: it comes back, with the facts box for the real artist
   name. (A restart restores nothing here by design: *Keep card places on restart*,
   `cardMemoryDisk`, is off, his call 2026-09-17. So the test is a remount in the session:
   pick Library from another card's picker, which moves it to that slot.)
8. Nothing changed in Search: an artist and an album pane look and act as before.

**Run 2026-10-13 (Claude, dev app, Max, Cyber · black-red): all 8 pass**, after one fix.
1. The Fool (Embla and the Karidotters): hero, facts box, ♥ square, track order; the hero menu
   has no Go to Album. The card grew on open (the built-in album rule).
2. Full: Apple's 8 songs, ✓ on Your Own Moon, + on the rest. Lib → 1 song. Back → Albums.
3. Go to Album from Your Own Moon: lit in Lib, and lit again among Apple's rows after Full.
4. Lib artist: photo, "1 album · 1 song", Albums + Your Playlists shelves, Songs bar; the photo
   opens the artist menu (no Go to Artist); Sort has Popular and Most Played.
5. Full artist: "Country", Top Songs, the photo button. **Most Played found one played song
   of ten** (Lucy Park) → fixed (§10.2): now BLUE SASHIKO (2 full · 19 starts), OUTLINE (2 · 6),
   TOUCH CONTROL lead.
6. Full Embla › Off Leash tile → the Full album (10 songs) → its artist link → the Full artist;
   Back walks back one level each.
7. The Library moved to slot d from the Search picker: back on the Full artist, rebuilt from
   its catalog id (`memory restore, levels 2`), Apple's name, the facts box, the shelves.
8. Search › "thread 27" › THREAD 27 - EP pane (6 songs, facts box) › Lucy Park pane
   (Featured, Your Playlists, Top Songs): unchanged.
No errors in the diag ring; every `library:full` load `failed: false`. The cards were put back
(Library root: Songs, Added Date).

**Seen in the run, not caused by this step (his forks, not built):**
- A sort picked from the Sort pop keeps the direction in force. The Lib artist opens newest
  first (↓), so its Most Played lists the least played first. Full opens on Popular (↑), so its
  Most Played lists the most played first. The same sort reads two ways on the two levels.
- Lucy Park has no Albums shelf in Full or in Search: Apple's artist page sends none for her
  (her releases are EPs and singles). The Lib view shows her 4.

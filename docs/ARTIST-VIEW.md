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
(user, 2026-09-15: the menu surface looked jarring). Retro-Future's card is see-through with no
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
| Search artist view | **0 extra** — `featured-playlists` joins the existing `views=` fetch |
| Start Station on a Library artist | 0 once the id is saved (it shared a session-only cache before) |

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
Retro-Future skews.

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

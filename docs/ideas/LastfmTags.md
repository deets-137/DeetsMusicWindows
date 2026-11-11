---
status: idea
desk_test: none
sources: [src-tauri/src/lastfm.rs, src-tauri/src/bridge.rs, src-tauri/src/apple.rs, src/info-box.ts, src/media-levels.ts, docs/features/LISTENERS.md]
updated: 2026-11-09
---
# Search by Last.fm tag

> **An idea, opened 2026-11-09** from the owner's ask: "Can we query last.fm by tags in
> deetsmusic? I noticed a fun album I like has a couple tags I'd love to search by."
> §2 is what he decided and is fixed. §3 is the data. §4 is Claude's proposal for the mechanics.
> **The drill-down UI is open, and he will design it with us later (§5).** Nothing here is built.
> Do not tell a user the app does this.

**Terms**
- **Tag:** a word that Last.fm listeners attach to an album, an artist or a song.
- **Tag chip:** one tag in the Tags section of a facts box (LISTENERS.md §6, §7, §8). Today it is
  plain text, and a click does nothing (`src/info-box.ts`).
- **Tag list:** what `tag.getTopAlbums` or `tag.getTopTracks` returns for one tag.
- **Tag page:** the new drill-down that shows a tag list.
- **Add mode:** the second tag adds its rows to the list. Rows with both tags come first.
- **Narrow mode:** the second tag removes the rows that do not have both tags.
- **Lookup:** finding a Last.fm row on Apple, so the row has an Apple ID and can play.

## 1. Why it needs a lookup

Last.fm returns names only: artist, title, a Last.fm link and an image. It returns no Apple ID.
The app can play a row only after a lookup.

`resolve` in `bridge.rs` is the existing lookup, and it is for songs only: one catalog search, then
simpler forms of the name while the search is empty, then a score. `catalog_search` in `apple.rs`
takes a list of types, so an album lookup can use the same path.

## 2. His calls (2026-11-09)

1. **Look up only the rows on screen.** Each row has Apple's real cover and plays at once. A row
   that Apple does not have is marked. Not taken: a lookup only on a click, with Last.fm's covers.
2. **Add mode works, and narrow mode must be possible too.** His words: "B works but I want A to
   be possible as well with the new type of drilldown/UI when we get to designing it." Both modes
   are in scope. How the user moves between them is part of the design (§5).

**Shown to him, and he did not object (2026-11-09):**
- The tag chips become buttons. A click opens the tag page as a drill-down, from the album, artist
  and song boxes.
- The search covers all of Last.fm, not only his library. A library-only search needs tags for
  every album first (LISTENERS.md §5 fork 3).
- The tag page shows albums first, then a Songs shelf.
- Each tag list is cached for a month, as the other Last.fm facts are.
- The album lookup uses the same steps as the song lookup.
- Junk tags stay. That matches his rule to show tags as Last.fm gives them (LISTENERS.md §7.1
  item 2).

## 3. What the probe found (2026-11-09, live)

The album was *A Real Romantic* by ELIZA. Its tags on Last.fm: *2018 single*, *alternative rnb*,
*bossa nova*, *funky*, *eliza*. All the calls need the API key only, with no user session.
`limit=1000` works on the three tag calls.

| Tag | Albums | Calls to read all | Albums with no cover on Last.fm | First rows |
|---|---|---|---|---|
| alternative rnb | 737 | 1 | 7 | Tinashe, FKA twigs, Kelela |
| bossa nova | 1,140 | 2 | 68 | Jobim, João Gilberto, Bebel Gilberto |
| funky | 911 | 1 | 74 | Paolo Nutini, Ben Harper, Incubus |
| 2018 single | 3 | 1 | 0 | unrelated |
| eliza | 1 | 1 | 0 | ELIZKA, a different artist |

**Two tags rarely overlap.** Rows that are in both lists:

| Two tags | Albums | Artists | Songs (first 3,000 of each list) |
|---|---|---|---|
| alternative rnb + bossa nova | 1 | 0 | 5 |
| alternative rnb + funky | 0 | 1 | 0 |
| bossa nova + funky | 5 | 9 | 4 |
| all three | not counted | 0 | 0 |

The rows in both, for albums: Kali Uchis *Sincerely,* (alternative rnb + bossa nova); Lenine *O Dia
Em Que Faremos Contato*, The Voodoo Trombone Quartet, Coolanova, The Music of A. Craze *The Carnival*,
Cyro Baptista *Beat the Donkey* (bossa nova + funky).

**A tag list is not every album with that tag.** *A Real Romantic* is absent from all five of its
own tag lists. A list holds only the albums where that tag is strong.

**Song lists are much longer.** Three pages of 1,000 did not reach the end of any of the three
tags. In `tag.getTopTracks`, the `total` field did not match the rows read, so do not use it as a
row count.

**Lookup sample.** 15 albums from *alternative rnb*, every 49th row, in Apple's public US search:
8 matched. The match was crude: the artist and title as one search term, then the same folded
title. The search for *BB/ANG3L* (Tinashe) returned nothing, probably because of the slash. *I
Like It I Like It* was listed under two artists, and *All My Heroes are Cornballs (Directors Cut)*
has an extra form in its title. So 8 of 15 is a floor. Some misses are probably real.

**Not probed:** a very large tag (*rock*), Apple's real catalog search through the app, and a
store other than the US.

## 4. The mechanics (Claude's proposal)

| Piece | Proposal |
|---|---|
| The read | `lastfm.rs`, `tag.getTopAlbums` and `tag.getTopTracks` on the existing `call` path. Albums `limit=1000`, page by page to a cap. A very large tag needs the cap (§3, not probed) |
| The cache | a table keyed by the tag (lower case) and the kind (albums, songs), the rows as JSON, `fetched_at`, 30 days. A network failure caches nothing, as in LISTENERS.md §3 |
| The lookup | one row at a time as it comes on screen, with the same steps as `resolve`, and the `albumForms` idea (`lastfm-names.ts`) for the names. No call for a row that is off screen |
| The lookup's cache | keyed by the artist and the title (lower case), the Apple ID or `none`. Add mode and narrow mode share it, so a row is looked up once |
| Both modes | one pure rule, with tests, in a small file: two lists in, the rows out, in mode order. No new Last.fm call to change the mode |
| Add mode's order | rows in both first, then the rest. Each list keeps Last.fm's order |
| A long list | the two tags can give about 1,900 rows (alternative rnb + bossa nova: 1,876). It needs the windowing of LIBRARY-VIRTUALIZATION.md, and the lookup follows the window |
| Apple calls | about 10 to 15 per screen, in the foreground. Count them with `apple_calls.rs` (APPLE-CALLS.md), and stop on a 429 back-off |

**The build checklist, for the build (CLAUDE.md).** The tag page is a drill-down level built on
`media-levels.ts`, so it adopts its keys, picks, drags, and memory from there. A row gets its menu
from `media-menu.ts`. The chips' hover hints change (ONBOARDING.md §1, `ARTIST_INFO_HINTS` and the
album and song ones). A new command needs a demo handler, a line in `web/handlers.ts` if the file
is shared, and a clip in `loading.json`. With Apple's covers, the CSP needs no new image host, and
Last.fm is called from Rust.

## 5. What is his (open, for the design sitting)

1. **The drill-down UI.** His words: "the new type of drilldown/UI". What the tag page looks like,
   and how it differs from the existing drill levels.
2. **How the user adds a second tag,** and where the other tags come from: only the first album's
   tags, or the tags of a row on the tag page, or typed.
3. **How the user moves between add mode and narrow mode,** and what the page shows when narrow
   mode is empty or nearly empty (§3).
4. **The mark on a row that has both tags,** and the mark on a row that Apple does not have.
5. **Whether a row Apple does not have stays in the list.** He chose a mark. With many misses
   (§3), he may want to see that first.
6. **Typed tags:** whether the Search card also finds a tag by name. Not decided.
7. **More than two tags,** and the Artists kind (`tag.getTopArtists`, not shown on the tag page in
   §2).
8. **A new Settings row,** or the chips under the rows that already gate each facts box.

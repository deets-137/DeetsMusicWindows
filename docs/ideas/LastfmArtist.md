---
status: idea
desk_test: none
sources: [src-tauri/src/lastfm.rs, src/listeners.ts, src/artist-view.ts, docs/features/LISTENERS.md]
updated: 2026-10-12
---
# Last.fm on the artist view — top tracks and similar artists

> **An idea, opened 2026-10-12** from the owner's ask, after the artist facts box shipped
> (LISTENERS.md §6). Two more things Last.fm knows about an artist, and what each would cost.
> **He designs the UI himself, tomorrow.** This doc holds the data, the calls and the mechanics
> only. Nothing here is built. Do not tell a user the app does this.

**Terms**
- **Top tracks:** Last.fm's ranking of an artist's songs by distinct listeners, with each song's
  listeners and plays.
- **Similar artists:** the five artists Last.fm's own listening data puts closest to this one.
- **The facts box:** the box beside the artist hero that shows Last.fm's tags, the on-tour
  marker, and the artist's plays and listeners (built 2026-10-12, LISTENERS.md §6).

## 1. What Last.fm gives

Probed live 2026-10-12 with Pat Kalla & Le Super Mojo (LISTENERS.md §6.0).

| Call | Gives | Shape |
|---|---|---|
| `artist.getTopTracks` | the artist's songs ranked by listeners | `limit` up to 1000 per page; each row: name, listeners, plays, rank, Last.fm url, mbid. Pat Kalla: 114 rows (one page). Radiohead: 462,434 rows (every scrobbled variant, 463 pages) |
| `artist.getInfo` → `similar` | five similar artists | name, url, image (Last.fm's placeholder image, not a real photo). Already fetched for the facts box; **not stored** today |
| `artist.getSimilar` | up to 100 similar artists with a `match` score 0–1 | one more call per artist; the five from `getInfo` are its top five |

Both work with the API key alone (no user session). Both ride the same signed POST and the
same month-long cache idea as the facts box.

## 2. What each could do in the app (the mechanics, not the UI)

### 2.1 Top tracks

- **Rank a song among the artist's songs.** "#10 of 114" next to a song: the deep-cut read
  that the plain listener count cannot give (LISTENERS.md §5 fork 2). A song outside the first
  page is "below #1000".
- **Seed the song cache.** One page holds the listeners and plays of up to 1000 songs. Stored
  under each title, it answers most of an artist's songs with no `track.getInfo` call. The risk
  is the match: Last.fm's rows are scrobble variants (*Lady Angola*, *Lady Angola (Edit)*,
  *Lady Angola - Edit* are three rows), so a seed is a hint for the cache, never a replacement
  for the song call with `autocorrect=1`.
- **Sort the artist's Library songs by Last.fm popularity.** The Library artist view already
  has *Popular* (Apple's top-songs order, ARTIST-VIEW.md §1). A *Last.fm* sort would be a
  second popularity, from scrobbles, matched by title.
- **A "Top on Last.fm" shelf** on the artist view: the songs the app can play (matched to the
  artist's catalog by title) in Last.fm's order.

**Cost.** One call per artist for the first page, cached a month. A second page only for an
artist whose song is not in the first 1000. Zero Apple calls for the rank; a shelf that plays
needs the songs resolved to Apple ids (the artist's catalog is already read for the Albums
shelf, ARTIST-VIEW.md §4).

### 2.2 Similar artists

- **A shelf of five.** Each name goes to the Search artist view (a catalog search by name, one
  Apple call per open, as the *Go to Artist* verb does today) or to the Library artist view when
  the name is in the library.
- **A web seed.** PLAYLIST-WEB.md builds a playlist from an artist and their collaborators,
  from Apple's data. Last.fm's similar list is a second kind of neighbor: listeners' taste, not
  credits. A web could take them as an option.
- **Rulez.** A fact `artist.similar` could let a rule act when the playing artist is similar
  to one the user named (RULES.md §19). Only after a surface shows the list.

**Cost.** Zero extra calls for the five: `artist.getInfo` already carries them, the facts box
only has to store them (`artist_info` gets a `similar` column, JSON). `artist.getSimilar` for
more than five is one more call per artist, cached a month.

## 3. The data the app holds today

`artist_info` (lastfm.rs): the artist's listeners, plays, tags, on-tour flag, url, fetched
time, keyed by the lower-cased name. The `similar` five are in the same answer and are
dropped. Adding them is a column and one line in `fetch_artist`.

`listen_counts`: one song's listeners and plays by the app's track key. A top-tracks seed
would write here with a `source` mark, so a later `track.getInfo` answer can replace it.

## 4. What is his (the forks, all open)

1. The UI of both: where the top tracks show (a rank on the song row, a shelf, a sort) and
   where the similar artists show (a shelf, a row in the facts box, a menu). He designs it.
2. Whether the top tracks seed the song cache, or only rank.
3. Similar artists: the five for free, or `artist.getSimilar` with the match score.
4. What a similar artist opens: Search's artist view always, or the Library's when it is there.
5. Whether any of it goes under the same *Show play counts from Last.FM* row, or its own.

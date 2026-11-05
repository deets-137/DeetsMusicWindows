---
status: shipped
shipped_in: 0.6.3
desk_test: passed 2026-09-19
sources: [src/home.ts, src-tauri/src/library.rs, src-tauri/src/apple.rs, src/home-card.ts]
updated: 2026-11-04
---
# DeetsMusic — the Home card

**Built 2026-09-15.** Designed in one session (the forks and the decisions are §7).

Home is the landing card: three shelves of what you played, what you added, and what this
kind of hour usually holds. Nearly every fact it shows is already on this machine — the
play log in SQLite, the track metadata in the shared store, the cached playlist list, and
the Radio card's local station recents.

**Since 2026-09-18 it also asks Apple two questions, one per shelf (§9).** They exist for
continuity: a play or an add made on your phone never reaches this machine otherwise. Both
are capped by a fifteen-minute floor, both fail softly, and neither one writes a play.
The third Apple call is an artist photo: one per artist, once ever, and only for an artist
who reaches a shelf and has no photo cached yet (§2).

Files: [`src/home.ts`](../../src/home.ts) (the data layer) ·
[`src/home-card.ts`](../../src/home-card.ts) (the card) · `added_at` table + `added_at_map`
in [`src-tauri/src/library.rs`](../../src-tauri/src/library.rs).

---

## 1. The three shelves

| Shelf | What it holds | Where it comes from |
|---|---|---|
| **Recently Played** | Mixed: songs, albums, playlists, stations, artists | `play_events`, last 60 days |
| **Recently Added** | Mixed: songs, albums, playlists | `addedRank` (songs/albums), `dateAdded` (playlists), `added_at` (this app's own adds) |
| **Weekday evening** (the bucket's own name) | Mixed: the songs and lists this kind of hour usually holds | `play_events`, last 180 days |
| **Friends on DM** (2026-10-29, last) | Albums: friends' playing now, a line, their recent | Friends presences, kept on this PC — [friends-shelf.md](friends-shelf.md) |

**The shelves can be reordered (2026-09-20).** Each shelf now carries a stable `id`
(`played` · `added` · `new` · `bucket` · `pinned` · `sotd` · `friends`) and is drawn as one
`<section class="home-shelf">`; hold a shelf's label for a moment and drag it where you want
it. The push order in `homeShelves()` is the built-in order underneath, and a shelf a later
version adds appears at the end ([MOVABLE-ROWS.md](MOVABLE-ROWS.md) §13). The id matters:
the bucket shelf's LABEL changes with the hour, so an order kept by label would lose it every
few hours. **Home's Pinned shelf now follows the hand pin order when there is one**, and
falls back to most-played (fork 12A).

**Each shelf is one row of tiles that scrolls sideways**, and the shelves stack down the
card — the artist view's shelves ([ARTIST-VIEW.md](ARTIST-VIEW.md) §2.2), the same
`.search__label` + `.search__scroller` + `.search__tile` markup. So all three are on screen
together at any window size, and Home wears no layout CSS of its own. Twelve tiles a shelf
(`SHELF`), with candidates built deeper beneath them, so hiding a tile refills the gap at
once. An empty shelf is left out.

**The card does not ride the collection-card engine.** It did until the shelves became
scrollers (2026-09-15, same day): with no vertical row list beneath them, the engine's
Sort / View / Search toolbar would act on nothing, and the grid's column count kept
squeezing each shelf as the card narrowed. What is left is small — build the markup,
delegate a click, a right-click and a drag. The one new rule in `styles.css` is
`.search__tile-art--round`, for an artist tile, mirroring `.lib-tile__cover--round`.

## 2. Recently Played — runs, not rows

The log walks newest-first. **Consecutive events that share a `context` collapse into one
tile**: three songs from one playlist is one playlist tile, not three song tiles. A run of
**one** still earns its container tile (fork C2). An event with a bare context
(`library`, `search`, `history`, `rewind`) stays one tile per song.

`play_events.context` already carries the shape, so nothing new is written:

| Tag | Tile | Notes |
|---|---|---|
| `playlist:<pid>` | playlist | Resolved from the cached unified list |
| `album:<albumKey>` | album | Its songs come from the library, in disc/track order |
| `search-albums:<id>` | album | A catalog album: identified by its songs' `albumKey` |
| `artist:<name>` | artist | Round thumb; plays that artist's library songs, albums oldest first |
| `station:<id>` / `station` | station | Resolved from `radioRecents()` |
| anything else | one tile per song | |

**An artist tile wears the artist's real photo.** The cached ones come free through
`artist_photos`, a read-only, network-free read of `artist_catalog.artwork` (the table the
Library artist view fills). An artist with no row there costs **one Apple call, once ever**
(`library_artist_info` with `featured: false` — it resolves the artist from one of their
songs and saves the id and the photo link). At most four such calls per rebuild, each name
asked about once a session even when Apple has no photo. Until the answer lands the tile
borrows one of that artist's album covers, and the shelf redraws when it arrives.

A container that cannot be resolved — a deleted playlist, a station no longer in recents —
falls back to the run's songs. Nothing vanishes.

## 3. Recently Added — order without dates

**Apple sends no per-song `dateAdded`.** The library sync pages `me/library/songs` sorted
by `-dateAdded` and keeps each row's page position as `added_rank`
([`apple.rs`](../../src-tauri/src/apple.rs)). So we know the ORDER, never the day. Playlists
*do* carry a real `dateAdded` (Apple's, and a local playlist's `created_at` serialized into
the same field). A rank cannot be compared to a date.

So the shelf **interleaves by kind, round-robin, songs leading, and prints no dates**
(fork A1). Every tile is recent within its own kind, and the shelf never claims an order
across kinds that it does not know.

**The song lane and the album lane never overlap** (fixed 2026-09-15, after the first desk
test showed a song beside its own album). An album tile covers every song in it, so a song
that belongs to one is dropped. And a group of one track is not an album: a single song
added on its own stays in the song lane instead of standing as an album tile of one.

**The add clock started 2026-09-15** (fork B1). `added_at (track_id, ts)` holds the epoch-ms
of everything added to the library **through DeetsMusic**, written once by
`graduate_tracks`. It lives outside the `tracks` table on purpose: a `library_sync` rewrites
every `tracks` row and would erase a stamp held in the json. It fixes nothing
retroactively — the library you already have stays rank-only — but from now on our own adds
carry a true time, and they sort newest even before the next sync gives them a rank.

## 4. The bucket shelf

**The rule:** weekday/weekend × four parts of the day — morning 05–11, afternoon 11–17,
evening 17–22, night 22–05. Eight buckets (fork A1). Twenty-eight (one per weekday) would
take months to fill; four (part of day alone) would lose the difference that matters most,
which is the weekend. The shelf's label is the bucket's own name — "Weekday evening" — so
it names what it measured rather than claiming a prediction.

**The score:** weighted minutes listened inside the current bucket, with a play's weight
halving every 42 days. Songs score on their own listening; playlists, albums, stations and
artists score on the minutes listened under their `context` tag. Plays break a tie, so rows
whose `ms_listened` was never finalized still rank among themselves. No minutes are invented.

**Two guards keep the shelf mixed (fork D1):**

1. **The kind cap.** Containers take at most half the shelf, so three heavy playlists
   cannot fill it.
2. **Container suppression.** A song is dropped when more than 60 % of its plays in this
   bucket came from a container that is already on the shelf. Otherwise a three-hour
   playlist habit shows as the playlist tile *and* five of its own songs — the same music,
   twice. A song you also play on its own keeps its tile.

**The cold start:** the shelf stays away until it has at least 5 scored items. A fresh
install shows two shelves and grows a third (fork 3, option 1).

## 5. Hiding a tile

Right-click any tile → **Hide**. The tile goes, the shelf refills from the next candidate
at once, and a toast holds **Undo**. Hiding is global across the three shelves: one list,
one sentence.

- The hide key is the item's identity: `song:<id>`, `album:<albumKey>`, `playlist:<pid>`,
  `station:<id>`, `artist:<name>`.
- **Playing an item again clears its own hide** (fork E3). The log is the record — an item
  with a play newer than its hide time unhides itself on the next build, so a tile can
  never be missing from Recently Played while it is literally playing. No player hook.
- **A hide is a hide, never a dislike.** It is not fed back into the bucket score.
- **Settings › Home › Hiding lasts** — *Until cleared* (default) or *This session*.
  "This session" keeps the map in memory only and leaves the stored one alone, so switching
  back restores it. A hide that died at relaunch would read as a bug, hence the default.
- **Settings › Home › Hidden tiles › Clear** puts them all back. The section's status line
  says how many are hidden.

## 6. What a tile does

| | Click | Right-click |
|---|---|---|
| Song / album / artist | Plays the list from the top | The media menu from `media-menu.ts` (Play Now / Next / Queue, Add to playlist, Go to…, copy link, ♥; was the Library's `trackMenu` until 2026-09-23, CONTEXT-MENUS.md) + **Hide** |
| Playlist | Plays its songs | Play Now / Next / Queue, Add to playlist, **Open in Playlists**, **Hide** |
| Station | Starts the station | Play Now, Add to Queue, Copy link, **Hide** |

Every tile drags (source `"home"`), with the same payload shapes the other cards use —
copy-only, since a shelf has no order of its own to reorder. Enter and Space act on a
focused tile. A rebuild keeps each shelf's sideways scroll where it was.

**The card keeps itself current.** It rebuilds when the played song changes (debounced
1.5 s — the play row is written at the start), when the library changes, when the playlists
change, and on the header's refresh square. A rebuild is one log read, one add-stamp read,
one artist-photo read and the cached playlists — all local, save for a first-time artist
photo.

## 7. The design session (2026-09-15) — forks and decisions

| Fork | Decision |
|---|---|
| A — bucket rule | **A1**: weekday/weekend × four parts of day |
| B — start stamping add times? | **B1**: yes, `added_at`, keep A1 ordering |
| C — when a run earns a container tile | **C2**: any run of one or more |
| D — bucket-shelf mix control | **D1** + container suppression (the "twice" case) |
| E1 — hide scope | Global on Home |
| E2 — how long a hide lasts | Row, default *Until cleared* |
| E3 — does playing it again unhide it? | Yes |
| E4 — undo | Both: a toast button and a Settings Clear |
| Fourth shelf (stations, Your Playlists) | No, not for now |
| Home as the fresh-install default slot | Open — a fresh install has nothing to show. To settle with the default-cards talk |

Not asked for, not built: dates on the Recently Added tiles (we cannot know them), a
"less like this" signal, per-shelf hide lists, an Apple-recommendations fallback for the
cold start.

## 8. Open question for a probe

`me/library/albums` may carry a per-album `dateAdded`; we never ask, because albums are
grouped client-side from tracks. One `limit=1` call would settle it. If it does, albums
could join playlists on the date scale and Recently Added could become one truthful line.
Not done.

---

## 9. Apple's own recents (built 2026-09-18)

Two calls, one per shelf. Both live in [`apple.rs`](../../src-tauri/src/apple.rs) rather than
the webview, and that is deliberate: `credits.rs` harvests `composerName` from **every song
read in Rust**, so these rows feed the writer collection at no extra call (CREDITS.md §3).

**Neither call writes a play.** We did not observe those plays. A row in `play_events` would
carry an invented time and an invented `ms_listened`, and both would corrupt Rewind's minutes
and Home's own bucket score. What they DO write is catalog: a song we have never held is
materialized as a `seen` track (`materialize_many`, `ON CONFLICT DO NOTHING`), which is the
shape that already exists for "met through an interaction" and which a later sync graduates
to a library row. That was the owner's reason for storing them — fill out the catalog for
writer webs and whatever else reads it later.

**The floor.** The card rebuilds whenever the played song changes, so an uncapped fetch would
call Apple all afternoon. Both lists are cached for `APPLE_FLOOR_MS` (15 minutes); a failure
retries after `APPLE_RETRY_MS` (2 minutes) and keeps the lists already in hand.

**Two things clear the clock**: the header's refresh square, and `deets:signed-in` — the event
main.ts fires once Apple accepts a token. That second one is not a nicety. On a true first run
the walk's step 1 IS the sign-in, so Home mounts signed out and stays that way for as long as
the user takes in the browser. Step 1 promises the library fills after signing in; a floor that
outlived the sign-in would be the app breaking that promise out loud.

**Signed out, we do not ask at all.** `fetchApple` returns before the request when there is no
token, and starts no clock. A request there would fail for a reason the card is already showing,
and a 403 from an expired token would raise a second sticky over a card that says the same
thing — one cause, one notice (TOASTS.md).

**The token is the tell, not `trouble()`.** This was got wrong once, on 2026-09-18, and the bug
is worth keeping written down. `trouble()` starts at `"none"`, and every path that moves it off
`"none"` is a REACTION to a call that already failed: the sign-in flow, a play attempt, a sync
error, or Rust's 403. On a stranger's first launch none of those have happened — and the startup
sync is itself gated on `isConnected()`, so it never runs and never errors. `trouble()` therefore
reads `"none"` on the exact run the guard exists for. The guard now asks `isConnected()`, which
asks Rust whether a token exists; `trouble() === "signin"` stays as the second reason to skip,
for a token Apple has since refused. **Offline, every shelf still builds** —
Recently Played falls back to the local log alone, Recently Added to the rank round-robin of §3.

### 9.1 Recently Played — the bracket rule

`me/recent/played/tracks?limit=30` returns catalog **song** rows, newest first, with the full
attribute set (artwork, ISRC, `composerName`) and a catalog id — which is already our canonical
track key, so the join to the library is exact, never a title-and-artist guess.

**Apple sends order, never time.** But Apple's list is a total order of recent plays, and our
log dates a subset of it: every play made here. So a borrowed row sits between the two rows
around it that we do have:

```
Apple order        our log
1  101 FM          14:22   <- anchor
2  High            —       <- between 14:22 and 11:05
3  SCARED OF YOU?! —       <- same bracket
4  OVER AGAIN      11:05   <- anchor
```

Rows above the newest anchor open at now; rows below the oldest step down by a nominal song.
**The guessed time never reaches the database.** It orders this shelf and nothing else.

Borrowed rows fold into Recently Played **unmarked** (his call, 2026-09-18): no fourth shelf,
no badge, nothing that says which device played it. A run of **two or more** consecutive
borrowed rows from one album becomes an album tile; one alone stays a song tile. A local run
earns its container tile at length one (fork C2), but there the context is stated by us — here
the album is only inferred, and one song is not evidence.

**Apple counts our own plays.** Measured 2026-09-18: a song played in DeetsMusic appeared at
position 1 of `me/recent/played/tracks` seconds later. So the list is *not* other devices only,
and the shelf subtracts by anchor before it borrows anything.

### 9.2 Recently Added — Apple's order, our tiles

`me/library/recently-added?limit=25` answers what §3 and §8 both called unanswerable:

- Apple **groups the songs into albums** server-side, one row per album.
- Every row carries a **real `dateAdded`** — albums *and* playlists, on one scale.
- 25 rows reach back about a week of ordinary adding. The mix measured on 2026-09-18 was
  24 `library-albums` to 1 `library-playlists`.

So the shelf orders by a true date and **drops the round-robin of §3**. It still prints no
dates (his call, 2026-09-18) — the dates order the shelf and stay out of sight.

Apple is used for the **order only**. Our own rules still decide the tile: a group of one
track is not an album, so a one-track row draws as a song tile. Apple's `trackCount` is
ignored — it reported 1 for an EP we hold four songs from (measured 2026-09-18), and the real
count is local anyway. A library album row carries no catalog id, so the join is name + artist.

**Your newest add never waits on the floor.** `added_at` stamps newer than Apple's newest row
lead the shelf. Both are real times, so the two merge honestly.

### 9.3 Desk test

1. Open Home. Recently Played and Recently Added look as they did.
2. Play a song on your phone, or in the Music app. Press Home's refresh square.
   The song appears in Recently Played, in the right place in time, with no mark on it.
3. Play two or more songs from one album elsewhere, refresh: one album tile, not two songs.
4. Play one song from an album elsewhere, refresh: a song tile.
5. Add an album on your phone, refresh: it leads Recently Added.
6. Add a song in DeetsMusic: it leads Recently Added **at once**, without a refresh.
7. Turn the network off, press refresh: both shelves still draw. Nothing errors.
7a. `npm run dev:fresh` (a full wipe, signed out — **not** `dev:fresh:in`, which keeps the
   token). Home mounts: no Apple call is made, and no second sticky appears over the sign-in
   card. Sign in. Recently Played fills **at once**, not after a floor.
8. Open Rewind and Settings > Home. The minutes and the bucket shelf are unchanged — no
   borrowed play was ever counted.
9. Right-click a borrowed tile: the normal menu, Hide included.

### 9.4 Open

- **No settings row.** Home now makes Apple calls with no way to turn them off. It was not
  asked for and a settings key is a stored shape, so it waits for his word.
- The hover-hint ledger in ONBOARDING.md needs the refresh square's new wording. That file
  was held by another session at build time.
- **A brand-new install still sees an empty Recently Added until the first library sync
  finishes.** An Apple album row draws only when we hold its songs, because a tile has to be
  playable. Recently Played has no such limit — it carries its own catalog rows, so on a fresh
  install it fills from Apple immediately. This matters more since 2026-09-18, when Home became
  a default card and so the first thing a stranger sees.

---

## 10. New — releases from your artists (built 2026-09-18)

A fourth shelf, labelled **New**. It holds one tile per recent release by an artist you
listen to: an album or a single put out in the **last 30 days**, or one **coming in the next
5 days**. The shelf is left out when it is empty, like the other three.

### 10.1 The ten artists

The shelf asks Apple about **ten artists**, no more. Ten is the whole cost control: one
batched call answers all of them.

**Six seats go to plays**, from `play_stats` (full + partial counts, summed per
`artistName`). **Four seats go to recency**, filled from Apple's recent list in its own
order, skipping any artist already seated. The floor of four is the point of the rule: a
play count is a record of the past, and an artist you started last week has none.

- **A play seat does not check the library.** An artist you play often enough to reach the
  top six has earned the tile whether or not you own them (his call, 2026-09-18). No
  threshold number exists: the seat itself is the test.
- **A recency seat is library only.** Apple's 90 songs held 68 artists, 31 of them not in
  the library (measured 2026-09-18). Those 31 are Apple's discovery job. Ours is your
  artists.
- **Ties break on recency**, then on name, so the list is stable between builds.

### 10.2 Where recency comes from

`me/recent/played/tracks`, read **90 songs deep** (his call). The endpoint caps `limit` at
30 — `limit=100` is a `400` — but `offset` pages, so 90 is three calls, and **Home already
makes the first one** for Recently Played (§9.1). Two extra calls.

That list is the only sight we have of a phone, a Mac or the Music app. Measured
2026-09-18: 90 songs, 68 distinct artists, 37 in the library. **Little Simz sat first in it
with zero plays in DeetsMusic** — the exact case the shelf exists for.

**Apple publishes no play counts** (ideas/AppleData.md §6). So plays are ours and recency is
Apple's, and neither one pretends to be the other.

### 10.3 The artist ids

`latest-release` needs a catalog artist id. `artist_catalog` holds a name, and it fills one
artist at a time, one call each — 3 rows against 1,731 library artist names.

`me/library/artists?limit=100&include=catalog` answers it in bulk. Probed 2026-09-18:

- `meta.total` = **1,376** library artists — 14 pages, about 1 s and 280 KB each.
- **100 of 100 rows carried a catalog id.**
- The catalog row also carries the **artist photo** and `genreNames`, so the same pass fills
  `artist_catalog.artwork` — the column §2 pays one Apple call for, per artist, today.

**The pass runs on every sync, incrementally (fork B):** the endpoint **rejects `sort`**
(`400 Invalid Parameter` on `sort=-dateAdded`), so there is no newest-first page to stop
early on. Instead one `limit=1` call reads `meta.total`. Unchanged against the stored count,
the pass ends there — **one call**. Changed, it re-pages all 14 and upserts `artist_catalog`
— **15 calls**, only after you added or removed an artist. The weekly full sync re-pages
regardless, so a same-count swap heals within a week (2026-09-29; it was every full sync,
and a full sync ran on most launches — DATA-ARCHITECTURE.md §5a).

The stored count is a new `meta` key. Since 2026-09-29 `library_sync` is a full pass when
Apple's song count changed or the last one is 7 days old or more (library.rs,
`FULL_SYNC_EVERY_SECS`, DATA-ARCHITECTURE.md §5a).

**The name join.** `artist_catalog` stays keyed by the LIBRARY artist name, because that is
the name our tracks carry. A library artist can map to a catalog artist with a shorter name
— "adam&steve & Maty Noyes" resolved to "adam&steve" (measured 2026-09-18). The row is still
correct for the join; the photo is the primary artist's.

### 10.4 The release read

`catalog/{sf}/artists?ids=<10>&views=latest-release`, the batch-of-25 shape `web.rs` already
uses. **One call a day.** Measured 2026-09-18: 238 ms, and `latest-release` equalled the
newest row of `singles` and `full-albums` in every artist tested. Asking for those two views
as well multiplied the payload 5× (30 KB → 163 KB) and found nothing new, so the shelf asks
for one view.

Two measured facts to build against:

- **Apple can answer fewer artists than you ask for** — 22 of 25 ids came back once. A
  missing artist is a gap, never an error.
- **An artist can have no `latest-release` view at all.** They contribute nothing. Correct
  for this shelf.
- **One release per artist.** When an artist has both a release last week and one coming next
  week, `latest-release` returns the coming one and the older one is not shown. Accepted: the
  upcoming release is the better tile.

### 10.5 The window, and "Coming"

| Release date | Tile |
|---|---|
| Within the last 30 days | Normal tile |
| Today up to +5 days | Tile marked **Coming MM/DD** |
| Anything else | Not shown |

**No year in the mark** (his call, 2026-09-18) — the window is five days wide, so the year
can only be this one or the next. The mark is the only text the shelf adds to a tile.

### 10.6 Cold start

A fresh install has no plays, so the six play seats are empty. **All ten seats fill from
Apple recency** instead (his call), and the recency list is available on the first launch
after sign-in. This shelf does NOT follow §4's "stay away until there is data" rule, because
its data does not have to be earned here.

A release we do not hold is a catalog album. It draws and plays through the same path a
Search catalog album uses (`search-albums:<id>`), so a tile is always playable.

### 10.7 The cost, on an ordinary day

| Call | Count |
|---|---|
| `me/library/artists?limit=1` (the count check), per sync | 1 |
| `me/library/artists?limit=100&include=catalog` ×14, when the count moved | 0 usually |
| `me/recent/played/tracks` offsets 30 and 60 | 2 |
| `artists?ids=<10>&views=latest-release` | 1 |
| **Total** | **4** |

Fewer than one artist-view open. The release read refreshes **once a day** (his call) — a
release date does not change in an afternoon — on the §9 floor machinery, cleared by the
header's refresh square and by `deets:signed-in`.

### 10.8 Settings and the stored key

- **The off switch lives with the other Home rows** (his call, 2026-09-18) — Settings › Home,
  the section that already holds Hiding lasts and Hidden tiles. It pays §9.4's debt: one row
  turns off every Apple call Home makes, this shelf included.
- **The stored count is `meta.library_artists_total`** — Apple's own `meta.total` from
  `me/library/artists`, under a name that says what it holds. It joins `storefront`,
  `schema_version`, `full_sync_at` and `queue_state`, which carry no prefix either.

### 10.9 As built

| Piece | Where |
|---|---|
| The artist pass | `sync_artist_catalog` in [`apple.rs`](../../src-tauri/src/apple.rs), called by `artist_catalog_pass` in [`library.rs`](../../src-tauri/src/library.rs) at the end of BOTH sync paths — `force: true` on a full pass, the count check on an incremental one |
| The release read | `artist_new_releases(names)` in `apple.rs`, a `#[tauri::command]` |
| Depth on the recents list | `recent_played_tracks(pages)`, `RECENT_PAGE` 30 × `RECENT_PAGES_MAX` 3 |
| The ten artists | `newArtists()` in [`home.ts`](../../src/home.ts) |
| The shelf | `newShelf()` in `home.ts`, placed third, above the bucket shelf |
| The switch | `homeApple` in `settings-store.ts`, one row in Settings › Home, one spec in `agent-settings.ts` |

Decided while building, inside his choices:

- **The mark rides the tile's second line**, as `Coming 09/23 · Dua Lipa`. A badge would be
  a new control family on a tile that has none (UI-ARCHITECTURE.md §2a), and the mark is
  one short string. No new CSS, no new token, no drift.
- **Recently Played still brackets against the first 30 rows only.** The list is read 90
  deep for artist recency, but feeding all 90 to the bracket rule would quietly re-shape a
  shelf nobody asked to change (§9.1).
- **A release date is read as LOCAL midnight.** Apple sends `YYYY-MM-DD` with no zone, so
  parsing it as UTC would put "today" a day out on one side of the world.
- **A release already in your library still draws.** It is new music by that artist, and
  Apple's row does not say whether you hold it.
- **`homeApple` defaults on.** The shelves exist for continuity, and the cost is four calls
  a day. The row is how you say no.
- **The hide rows stay out of the agent's reach.** Hiding a tile is a gesture on the tile.
- Sorting is by release date, newest first, and `SHELF` caps it at twelve like the others.

### 10.10 Desk test — PASSED 2026-09-19

1. Open Home. The three old shelves look as they did — **Recently Played especially**, which
   must not have grown new borrowed tiles.
2. **New** sits third, above the bucket shelf. Every tile is an album by an artist you play.
3. Click a tile whose album you do not own. It plays from the top.
4. Right-click a tile: the normal album menu, Hide included. Hide it; the shelf refills.
5. A tile dated in the future reads **Coming MM/DD · Artist** on its second line, with no year.
6. Settings › Home › **Follow your other devices** › Off. Press Home's refresh square. The New
   shelf goes, and Recently Played falls back to this machine's own log. On again: both return.
7. Turn the network off, press refresh. Every shelf still draws. Nothing errors.
8. Watch `%APPDATA%\com.deetsmusic.dev\deetsmusic.log` across a restart: `library: artist
   catalog filled, N of M artist(s)` appears on the first full sync and NOT on the next
   launch inside six hours.
9. On a second launch the same day, no `artists?ids=…latest-release` call is made — the floor
   is a day. The refresh square clears it.
10. `npm run dev:fresh` (signed out): Home mounts, no Apple call, no second sticky. Sign in.
    The library syncs, and New fills once the artist pass has run.

### 10.11 The New tile's menu, and the play it never really did (fixed 2026-09-20)

Step 4 above says "the normal album menu". It was not. The shelf built its items with
`tracks: () => collectionTracks("albums", id)` — a **promise**, where every other tile on
this card returns an array. `HomeItem.tracks` is documented as sync except for a playlist,
and `menuFor` in home-card.ts reads it as `Array.isArray(list) ? list : []`. So a right-click
on a New tile built its menu on an **empty list**: Play Now, Play Next, Add to Queue and Add
to Playlist all ran on nothing, Go to Artist was suppressed for want of a catalog id, and
only Hide worked. The same promise fed the left click, which played the songs **without the
transient add + materialize** every other catalog list gets.

**As fixed.** A New item now keeps the contract: `tracks: () => []` (nothing is known without
a fetch) and `whole: wholeCatalogAlbum(id)` — the loader every catalog album on this card
already used, now with the materialize step. The item also carries its own `catalogId` and
`artistName`, so its menu reads:

- **Play Now · Play Next · Add to Queue · Add to Playlist ▸**, each over the loader.
- **Go to Album** — with the album's OWN id, so the pane opens with **no `?include=` hop**.
- **Go to Artist** — `albums → artists`, one hop from the same id.
- **Copy Album Link** — from the id, not from a song.
- **Hide**.

**No Pin row, deliberately.** A pin keeps its own snapshot of the songs (PINS.md), and a
release that is not out has none. A New tile never offered Pin, and still does not. Whether
an unreleased album can be pinned — and what its tile would play — is its own question.

### 10.12 Desk test — the New tile's menu

1. Right-click a **New** tile whose album is already out. Every row is there, in the order
   above. Play Next: the whole album lands in the queue, in track order.
2. **Go to Album** on the same tile: the Search card opens the album pane straight away.
   The window's log shows no `?include=` hop for it.
3. **Go to Artist**: the artist pane opens on that artist.
4. Right-click a tile that reads **Coming MM/DD**. The same menu; the play rows do nothing,
   because Apple returns no songs yet. Nothing errors.
5. A left click on an out-now tile plays the album from the top, and the Queue names it.
6. Right-click an album tile on **Recently Played** or the bucket shelf: **Go to Album** is
   there too, and opens the album by the song→album hop.

### 10.13 Add to Library, from Home (built 2026-09-20)

The owner went looking for it on Recently Played and found nothing. He was right: **Home had
no Add to Library at all**, for a song or an album, and an ALBUM could be added from the
**Search card alone** — the only caller of `addAlbumToLibraryItem` in the app.

Two causes, both now fixed (FAVORITES.md, "An album, from songs"):

- A **song's** add row is wired per card (Queue, History, Now Playing, Playlists all do it),
  and Home never did. It now sits after the link and the station, as it does elsewhere.
- An **album's** add row did not exist outside Search, because Apple adds an album by its own
  id and an album tile built from songs carries none. `addAlbumFromSongsItem` resolves that id
  lazily on pick — one memoized `songs → albums` hop — and rides the shared `trackMenu`, so
  Home, the Pinned shelves, Playlists, Queue, History and Rewind all gained it together. A
  **New** tile needs no hop: it adds by the album id it already holds.

**The row hides itself when the library already holds every song of the album.** That is not a
preference, it is what keeps the row off every album tile on the Library card.

### 10.14 Desk test — Add to Library

1. Settings › Apple Music › **Library Add** is on (the default).
2. Home › Recently Played › right-click an album you played from Search and do **not** own:
   **Add to Library** is there. Pick it. The album appears in the Library card.
3. Right-click that same tile again: the row is **gone** — you have it now.
4. Right-click a **song** tile you do not own: **Add to Library** is there, between Start
   Station and ♥. It goes after the add, the same way.
5. Right-click any album tile on the **Library** card: no Add to Library row, ever.
6. A **New** tile that is out: Add to Library adds the whole album. Watch the log — the add
   names the album id, with no `songs → albums` hop before it.
7. Turn **Library Add** off. Every row above disappears, on every card.

## 11. Click to open, double-click to play (idea for 1.4, 2026-11-03)

> **Part:** built · 2026-11-04; desk test tentatively good 2026-11-04 (his word). His calls are §11.3a; §11.3b is the code.

**The idea (user feedback, brought by the owner 2026-11-03):** *"Might be nice to have a
setting that controls when clicking a song/album from the home screen to go to the album —
double clicking would play it."*

### 11.1 What a click does today (read from the code, 2026-11-03)

| Tile | One click | Code |
|---|---|---|
| Song, album, artist (not pinned) | **Plays** the list from the top. An album off the library plays whole (`it.whole`). | `activate`, `src/home-card.ts` |
| Playlist (not pinned) | **Plays** its songs | same |
| Station | **Starts** the station | same |
| Any **pinned** tile | Runs the pin's own **On Click** verb (Play · Shuffle · Open). A pin never set opens an album, a playlist or an artist, and plays a song or a station. An album the library does not hold has no view, so it **plays**. | `pinActivate`, `src/pins.ts` (PINS.md §8) |

A double-click today is two clicks: it starts the same list twice. Enter and Space act as a
click. The right-click menu already has **Go to Album** on every song and album tile.

### 11.2 What the code gives the idea

- **Open = Go to Album.** The menu's Go to Album (`src/go-to.ts`) already opens an album the
  library holds in the Library card and an album it does not hold in the Search card, by
  *Settings › Go to opens* and the `goto.album` rule. The click reuses that path, so an
  unowned album opens too (the pin's Open plays it instead, see §11.1).
- **The precedent for a click verb** is the pin's On Click (PINS.md §8): Play · Shuffle · Open,
  and a Settings row for the start value. The precedents for a double-click are the Diary's
  song rows and the Sound panel's handle (`dblclick` in `diary-card.ts`, `sound-panel.ts`).
- **The default stays Play**, so nothing changes for a user who never opens the row (the rule
  PINS.md §8.2a used).
- **Pinned tiles keep their own On Click verb.** He chose a per-pin verb on 2026-09-19 (PINS.md
  §8.2 fork 1); a Home-wide row must not overwrite it.
- **The row sits in Settings › Home**, beside *Hiding lasts*. It needs a `NEW_MARKS` line
  (`since: "1.4.0"`), a settings key with an agent spec, a hint in the ONBOARDING.md ledger and a
  release note.

### 11.3 The forks as they were asked (closed by §11.3a)

1. **Which tiles follow it.** His words name song and album tiles. Do artist tiles (open the
   artist view) and playlist tiles (open the playlist) follow it too? A station always plays: it
   has no view.
2. **How the double-click is read.** The first click of a double-click opens the album, and the
   Home tile can be gone (the card swaps in Mini) before the second click lands. Either:
   - **Open at once**, and a second press within the Windows double-click time plays the item
     that was just opened (we time the presses, not the browser's `dblclick`). Open feels
     instant.
   - **Wait** the double-click time (about 0.5 s) before an open, so a double-click never
     opens. Every open lags by that time.
3. **The row's wording.** Draft: **Click a Home tile** — `Play` · `Open` (a double-click plays).
   With Play, does a double-click still restart the list, or is the second click ignored?

### 11.3a His calls (2026-11-04)

1. **Wait, 250 ms.** A click waits 250 ms for a second press before it acts. A setting makes that
   time longer or shorter, per user.
2. **On Double Click defaults to Play.** A Settings row sets the start value for new pins, and for
   new playlists and albums. The update card's right column lists the user's existing pins, with
   the option to change each one.
3. **One build, for any collection of songs:** albums, playlists and the like, pinned or not.
   Beside the pin's On Click, a per-pin **On Double Click** row with the same verbs.

**Rules Claude proposes inside his calls (for his review at build time).**
- **No wait when there is nothing to tell apart.** When the click and the double-click run the
  same verb, the click acts at once, and the second press does nothing. So a default tile that
  plays on both never lags.
- **A slow double-click.** The Windows default is 500 ms, so a gap of 300 ms at the 250 ms setting
  reads as two clicks. The press after a tile acted is stopped for that time, with the Grow edge
  bar's `guardPoint` pattern (card-grow.ts). It also stops a second press landing on a card that
  took Home's place.
- **Enter and Space** act as a click, with no wait.
- **Songs and stations** have no double-click row: they are not collections.

### 11.3b As built (2026-11-04)

- `src/press-read.ts` is the pure rule, with tests. `src/tile-press.ts` is the page's half: the
  wait, the guard and `ui:press` in the log. `pinPress` (pins.ts) and `activate` (home-card.ts)
  call it. A key press or a scripted click (`detail` 0) acts at once.
- **Settings › Home:** *Click a Home tile*, *Double-click a Home tile* (Play · Shuffle · Open, both
  default Play) and *Double-click wait* (150, 250, 350, 500 ms). **Settings › Playback:** *Pinned
  Item double-click behavior*. A right-click on a pin: *On Double Click ▸*, under *On Click ▸*.
- **The guard** stops a late second left press for what is left of 500 ms, at that place. A
  right-click passes it, so a tile's menu opens at once.
- **Open** on an unpinned tile runs the tile's own Go to row, so it lands where the right-click
  does. A tile with no such row plays.
- **A pinned song, a pinned station and an unpinned station** have no double-click row. They play
  at once, and the second press is dropped, so a double-click no longer restarts them.
- **The update card:** see UPDATE-CARD.md §3.21.

**What Claude decided at build time (his review).**
- The wait's choices: 150, 250, 350 and 500 ms. One setting for Home and every Pinned shelf.
- *Any collection* covers Home and the Pinned shelves. Tiles on an artist page and in Search are
  not included: he can ask for them.
- An artist tile counts. A song tile follows too, because the first request named songs: Open goes
  to its album.
- A pin's Open keeps its old rule: an album the library does not hold plays (§11.1).

**Known and left.** A pin on Open with Play on a double-click waits 250 ms on every click: that is
his default. A press within the guard cannot start a drag of that tile.

**Run on the dev app (2026-11-04), with scripted presses.** A pin on Open and Play: two presses 100
ms apart logged `held`, `double` and a play, and no card moved. One press opened Playlists 301 ms
later. An unpinned tile on Play and Play: played at once, and the second press was dropped. On
Open: it ran the open after the wait.

### 11.4 Desk test

Needs a dev runner restart (Rust changed; the `pins.dbl` column).
1. Pin a playlist. Its right-click has On Click and On Double Click. They read Open and Play.
2. Home: one click opens it at once (§11.5). A double-click opens it and plays it.
3. Set the pin's On Click to Play and On Double Click to Shuffle. A click waits a quarter second,
   then plays; a double-click shuffles. Settings › Home › Double-click wait to 500 ms: it waits
   longer.
4. Settings › Home: Click a Home tile to Open. A click on an album tile opens the album at once,
   and a double-click also plays it. Set it back to Play: a click plays at once.
5. Click a tile, then right-click it at once: the menu opens.
6. A double-click on a pinned song plays it once.
7. Mini: double-click an Open pin. It plays. Click it once: it opens, and a slow second click does
   nothing on the card that came in.
8. Open the update card's 1.4 page (`__updateCard.preview("1.4.0", "1.3.1")`): the right column
   ends with your pins. Pick a verb: the pin keeps it.

### 11.5 Beyond Home and pins (built 2026-11-04)
> **Part:** built · 2026-11-04; desk test open. The design below; "As built" at the end is the code.

**His ask:** the same click and double-click on albums, playlists and artists across the app,
set in Settings, with no right-click row. Pins keep their own rows.

**What a click does today.** The Library, the Playlists card, Search and the artist page open an
album, a playlist or an artist. A double-click there is two clicks.

**His calls (2026-11-04).**
1. **One pair of rows** for every collection: *Click a collection* and *Double-click a collection*.
   A user who wants a different verb per type makes a rule. The app points to that, with a tutorial.
2. **Open at once.** When a click's verb is Open, the page opens with no wait, and a second press
   inside the wait runs the double-click on that item. This replaces the wait in §11.3a for an
   Open, on pins and Home too, so a pin on Open no longer lags. A click that plays or shuffles keeps
   the wait: there a false start can be heard.

**The design.**
- **The press reader** gains the Open rule: run the click now, keep the tile's double-click for
  the wait. The page slides in under the pointer, so the second press lands on it. The guard
  (`guardPoint`) gains a callback: a guarded left press in the wait runs the kept verb.
- **The three click paths:** the collection engine's `g.open` ([collection-card.ts](../../src/collection-card.ts)),
  Search's album, playlist and artist clicks, and the artist page's `onShelf`. Each needs a way to
  play the item it would open.
- **Rows:** *Click a collection* defaults to Open, *Double-click a collection* to Play. A new
  section is not needed: they sit in Settings › Playback beside *Pinned Item click behavior*.
- **Home keeps its own two rows,** because its click plays by default and the rest open.
- **Songs and stations stay out.** A song row keeps playing on a click. Ctrl and Shift picks come
  first, and Enter acts as a click.

**The per-type rule (his call 1).** `goto.album` and `goto.artist` are the pattern: a moment event,
and `decided()` hands the rule's Do back to the site (RULEZ.md §10.1). New events `press.album`,
`press.playlist` and `press.artist` with In = the card, and Dos *Use Play*, *Use Shuffle*, *Use
Open*. Click or double-click is part of the event's choice. The Settings pair is the default when
no rule answers. A rule works in every surface, and the Rulez card that makes it is Max only.

**The tutorial.** RULEZ.md §6 records his call that the card feeds no rule to a user. His new ask
is a pointer from these rows, so it sits on the rows, not in the card: the hint on *Click a
collection* names Rulez, and a user-guide page in `docs/guide/` walks through one rule.

**As built.**
- `src/collection-press.ts` asks the rules, then the Settings pair, then calls `tilePress`.
  `press-read.ts` answers `eager` for an Open; `tile-press.ts` then sets `guardPoint` with a `hit`,
  so a second left press within 500 ms runs the double-click, even on the page that opened. The
  rest of that press is stopped too. The window is Windows' double-click time and not *Double-click
  wait*: the break-it pass found a press at 250–500 ms did nothing. So that setting now acts only on
  a click that plays or shuffles.
- **Sites:** Library album and artist rows (`Grouping.press`), Playlists rows, Search's album,
  playlist and artist tiles, and the artist page's Albums, Appears On, Featured Playlists and Your
  Playlists tiles. A Library genre row keeps its plain drill.
- **Rules:** six events, *You click an album* and *You double-click an album*, and the same for a
  playlist and an artist, each with In = the card. Their one Do is **Use** Open, Play or Shuffle.
- **The pointer:** the hint on *Click a collection* names Rulez. The guide page is
  `docs/guide/clicks-by-type.md`, in the outline state: he sets it to written.

**What Claude decided at build time (his review).** The row and event words. A double-click on the
default now also starts the music on every one of these places, so a habit double-click plays.
Friends, the Diary, Rewind and History are not included.

**Known and left (the break-it pass).** The guard is by place only: a second press within 24 px in
500 ms counts as the double-click, even on another row. A play whose fetch fails logs to the console
and shows no toast. With a rule on Play, a drag started in the wait still plays when the wait ends.
Keyboard users reach the click verb only. A Library artist plays every song; a Search artist plays
Top Songs.

**Run on the dev app (2026-11-04), with scripted presses on a Playlists row.** One press: `eager`,
and the page was up in 77 ms, the slide's own start. Two presses 120 ms apart at one place: `eager`,
`double`, then Play, with the page open. Search and the artist page were not pressed, and no rule
was fired on the app. The rule's words have a unit test.

**Desk test (front end only, no restart).**
1. Library › Albums: click an album: it opens at once. Back. Double-click it: it opens and plays.
2. The same on an artist, on a playlist in Playlists, and on an album, a playlist and an artist in
   Search.
3. An artist page: click and double-click an Albums tile, a Featured Playlists tile and a Your
   Playlists tile.
4. Settings › Playback › Click a collection to Play: a click waits a quarter second and plays.
   Back to Open.
5. Open an album, then at once click a song row on the page at another place: it plays that song.
6. Ctrl+click a row in the Library: a pick, no open.
7. Rulez: When *You click a playlist*, *Use Play*. Click a playlist: it plays. Click an album: it
   opens. Delete the rule.
8. Enter on a focused album row: it opens.

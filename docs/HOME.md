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

Files: [`src/home.ts`](../src/home.ts) (the data layer) ·
[`src/home-card.ts`](../src/home-card.ts) (the card) · `added_at` table + `added_at_map`
in [`src-tauri/src/library.rs`](../src-tauri/src/library.rs).

---

## 1. The three shelves

| Shelf | What it holds | Where it comes from |
|---|---|---|
| **Recently Played** | Mixed: songs, albums, playlists, stations, artists | `play_events`, last 60 days |
| **Recently Added** | Mixed: songs, albums, playlists | `addedRank` (songs/albums), `dateAdded` (playlists), `added_at` (this app's own adds) |
| **Weekday evening** (the bucket's own name) | Mixed: the songs and lists this kind of hour usually holds | `play_events`, last 180 days |

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
([`apple.rs`](../src-tauri/src/apple.rs)). So we know the ORDER, never the day. Playlists
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
| Song / album / artist | Plays the list from the top | The shared Library `trackMenu` (Play Now / Next / Queue, Add to playlist, Go to…, copy link, ♥) + **Hide** |
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

Two calls, one per shelf. Both live in [`apple.rs`](../src-tauri/src/apple.rs) rather than
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

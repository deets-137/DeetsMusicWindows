---
status: idea
desk_test: none
sources: [src-tauri/src/apple.rs, src-tauri/src/library.rs, src-tauri/src/playlists.rs, src-tauri/src/enrich.rs, src-tauri/src/favorites.rs, src-tauri/src/web.rs, src/track-store.ts, src/library-card.ts, src/artist-credit.ts, src/rewind.ts, src/media-menu.ts]
updated: 2026-10-15
---
# Apple calls — the ledger, and how to make fewer

> An idea (2026-10-15), not built. His ask: a ledger of the Apple calls the app makes, and ways
> to make them more efficient. §1 is a measured day; §2 the ledger of every call site; §3 the
> savings, each one probed or read; §4 the Library's ⟳ button; §5 the primary artist of a song
> (his second question, the same sitting). The counter and the 429 back-off are
> [APPLE-CALLS.md](../ops/APPLE-CALLS.md): that doc counts calls; this one names them.

## 0. Terms

- **Apple call**: one HTTP request from Rust to `api.music.apple.com` (APPLE-CALLS.md §0).
  MusicKit's own requests from the webview (playback, the queue) are not in this ledger.
- **Full sync**: the library sync that reads every library song, 100 a page (`songs_page`,
  `apple.rs:1801`). 4,042 songs = 41 pages.
- **Incremental sync**: newest-added first, it stops at the first page that holds a song it
  already has. Usually 1 page.
- **Count call**: `me/library/songs?limit=1`, which reads Apple's song total only.
- **Artist pass**: `sync_artist_catalog` (`apple.rs:2686`): a count call on library artists,
  then, when the count moved, every library artist with its catalog twin, 100 a page.
- **Mirror**: an Apple playlist in the Playlists card. **Re-read**: its songs read again
  (`playlist_tracks_page`), on the schedule of PLAYLIST-REFRESH.md.
- **Primary artist**: the artist a song belongs to, as Apple's catalog names it first.

## 1. A measured day (his installed app, 2026-10-15)

The hour after the launch at 11:12 (the `[apple] calls 1h` line): **library 96 · me 4 ·
catalog 7 · search 4 · write 2 · 429 0**. The 96 library calls:

| Part | Calls | Why |
|---|---|---|
| Count call | 1 | The launch rule (FUTURE-SETTINGS.md §21, DATA-ARCHITECTURE.md §5a) |
| Full sync | 41 | Apple counted 4,042 songs; the last full sync saw 4,037. He had added 5 |
| Artist pass | about 15 | The artist count moved (1,428 → 1,430), so every artist was read again |
| Mirror list | 1 | `playlists: mirror synced, 48 playlist(s)` |
| Re-reads | about 40 | 30 mirrors re-read (the daily ones), most with "0 new"; a 403-song one is 5 pages |

**The last five launches:** a full sync on 10-11, 10-12, 10-14 and 10-15 (each time the count had
grown by 2 to 7 songs), and an incremental one (1 page) on 10-13. He adds songs most days, so
most launches pay the full sync.

## 2. The ledger

Every Apple call site in the Rust code, read 2026-10-15. "Calls" is per run. A row marked
*background* is a job the app starts itself (APPLE-CALLS.md §3); the rest start from a click,
a key or an agent.

### 2.1 Library and playlists (group `library`)

| Function (file) | Endpoint | Starts on | Calls |
|---|---|---|---|
| `songs_page` (apple.rs) | `me/library/songs?limit=100&offset&sort` | background: launch (count call, then full or incremental), sign-in; the ⟳ (full) | 1 count + 1 (incremental) or 41 (full) |
| `sync_artist_catalog` (apple.rs) | `me/library/artists?limit=1`, then `…?limit=100&offset&include=catalog` | background: after each sync | 1, or about 15 when the count moved or on the weekly full sync |
| `playlists_page` (apple.rs) | `me/library/playlists?limit&offset` | background: once a session (the mirror sync); the Playlists ⟳ | 1 |
| `playlist_tracks_page` (apple.rs) | `me/library/playlists/{id}/tracks?limit&offset` | a mirror opened with no cache; background: the re-read schedule (Daily / weekly by kind); the size check (`limit=1`) | 1 per 100 songs per mirror |
| `recent_added_run` (apple.rs) | `me/library/recently-added?limit=25` | Home | 1 |
| `apple_add_to_library` (apple.rs) | `me/library?ids[kind]=` (POST) | Add to Library | 1 |
| `append_to_apple` (playlists.rs) | `me/library/playlists/{id}/tracks` (POST) | export, add to a mirror | 1 |
| `playlist_export_apple` (playlists.rs) | `me/library/playlists` (POST) | Export to Apple | 1 |

### 2.2 Your account (group `me`)

| Function (file) | Endpoint | Starts on | Calls |
|---|---|---|---|
| `apple_auth_status` (apple.rs) | `storefronts/us`, `me/storefront` | sign-in check | 1–2 |
| `enrich` storefront (enrich.rs) | `me/storefront` | first enrichment of a session | 1 |
| `recent_played_tracks_run` (apple.rs) | `me/recent/played/tracks?limit=30&offset` | background: Home's New shelf, once a day (HOME.md §10) | 3 |
| `radio_discovery` (apple.rs) | `me/recommendations` | the Radio card | 1 |
| `favorite_set`, `favorite_collection_set` (favorites.rs) | `me/ratings/{kind}/{id}` (PUT / DELETE) | ♥ | 1 |
| `favorites_reconcile_run` (favorites.rs) | `me/ratings/songs?ids=` | background: the ♥ mirror check | 1 per batch |
| `favorite_collection_reconcile_run` (favorites.rs) | `me/ratings/{kind}?ids=` | an album or playlist page | 1 |

### 2.3 The catalog (groups `catalog`, `search`)

| Function (file) | Endpoint | Starts on | Calls |
|---|---|---|---|
| `fetch_catalog_songs` (enrich.rs) | `catalog/{sf}/songs?ids=` (up to 300) | a surface touches songs with no catalog facts (cover colors, ISRC, preview); cached forever | 1 per batch |
| `search` (apple.rs) | `catalog/{sf}/search` | each typing pause in a search field (SEARCH-FIELDS.md) | 1 |
| `lookup` (web.rs) | `catalog/{sf}/search` | the playlist web's name lookups | 1 per name |
| `catalog_collection_tracks` (apple.rs) | `catalog/{sf}/{kind}/{id}?include=tracks` | an album or playlist opened from Search | 1 |
| `catalog_artist` (apple.rs) | `catalog/{sf}/artists/{id}?views=top-songs,full-albums` | an artist's Full level, the Search artist pane (session cache) | 1 |
| `library_artist_info` (apple.rs) | `catalog/{sf}/songs/{song}?include=artists`, then `artists/{id}?views=featured-playlists,top-songs` | a Library artist view (cached in `artist_catalog`) | 0–2 |
| `catalog_song_artist` (apple.rs) | `catalog/{sf}/songs/{id}?include=artists` | Go to Artist from a catalog song | 1 |
| `catalog_related` (apple.rs) | `catalog/{sf}/{kind}/{id}?include={rel}` | a Search drill (song → album, album → artist) | 1 |
| `artist_new_releases_run` (apple.rs) | `catalog/{sf}/artists?ids=<25>&views=latest-release` | background: Home's New shelf, once a day | 1 per 25 artists |
| `radio_live`, `radio_my_station`, `radio_genres`, `radio_genre_stations`, `radio_seed_station` (apple.rs) | `catalog/{sf}/stations…`, `station-genres…`, `{kind}/{id}/station` | the Radio card, a "Start station" | 1 each |
| `read_artists`, `read_album`, `seed_parts` (web.rs) | `catalog/{sf}/artists?ids&views`, `artists/{id}/view/{view}`, `albums?ids&include=tracks`, `albums/{id}`, `songs/{id}/albums`, `songs/{id}?include=artists` | building a playlist web (PLAYLIST-WEB.md), cached per seed | several per web |
| `apple_dump_library` (apple.rs) | `me/storefront`, `me/library/{kind}?limit`, a few tracks and songs | the dev-only library dump | about 10 |

**Not in the ledger:** the developer token (DeetsSupport, not Apple), Last.fm, the update feed.

## 3. Savings (each one probed or read, 2026-10-15)

| # | Saving | Today | After | Calls saved |
|---|---|---|---|---|
| S1 | Skip the full sync when the new songs explain the count | 41 + 15 | 1–2 | about 55 on most launches |
| S2 | Re-read only the mirrors Apple says changed | about 40 a day | 1 + the changed ones (about 6) | about 30 a day |
| S3 | Read only the new artists, from the new songs | about 15 | 1 | about 14 when artists change |
| S4 | The album artist and the primary artist ride the sync page | — | 0 | (data, not calls; §5, album-notes.md §6) |
| S5 | Trim the payloads with `fields[…]` | — | — | bytes, not calls |

For him, S1 to S3 take a typical day from about 110 library calls to about 15.

### S1. The explained count

**Today** (`library.rs`, DATA-ARCHITECTURE.md §5a): a launch makes the count call. If the total
differs from the last full sync's, the launch runs a **full** sync, because an incremental sync
cannot see a removal.

**After:** run the incremental sync first. If Apple's total went **up** by *n* and the
incremental sync found exactly *n* new songs, the change is explained: stop. Run the full sync
only when the change is not explained (it went down, or the new songs do not account for it), or
when the last full sync is 7 days old, as now.
- The blind spot is the same as today's: one song added and one removed between launches leaves
  the total equal. The weekly full sync heals it, as now.
- The log line names the reason: `library: incremental explains +5 (5 new)` or `…not explained
  (+5, 3 new): full sync`.
- The artist pass follows the same rule (S3).

### S2. Mirror dates in one call

**Probed:** `catalog/us/playlists?ids=<44 ids>&fields[playlists]=name,lastModifiedDate,playlistType`
returned **44 of his 48 mirrors in one call** (3.1 s), each with `lastModifiedDate` and
`playlistType`: `editorial`, `personal-mix`, `user-shared`, `replay`. The 4 others have no
catalog id (`globalId`); they keep their schedule.
- Apple's own mixes carry a date that moves: *New Music* 2026-10-09 (a Friday), *Heavy Rotation*
  2026-10-15, *Get Up!* 2026-10-12.
- This corrects PLAYLIST-REFRESH.md §0, which says Apple rewrites a mix "without changing any
  attribute we read". True of the **library** record; the **catalog** record shows the change.
- *Replay All Time* has no date: it keeps its daily re-read.

**After:** the daily refresh first makes the one dates call, then re-reads only the mirrors whose
`lastModifiedDate` moved since their last re-read (or that have no date). The schedule of
PLAYLIST-REFRESH.md stays the outer limit; the date check decides inside it.

**A probe before the build:** for a week, store the dates and the re-read results ("N new"), and
confirm that the songs change only when the date moves. Until that holds, S2 does not ship.

### S3. New artists from new songs

**Today:** the artist pass cannot read newest-first (Apple refuses `sort` on that endpoint, 400),
so a moved count re-reads all 1,430 artists.

**After:** when S1 explains the change, the new songs' primary artists come from the sync page
itself (§5: `include=artists` names each song's library artist). Only a library artist not yet in
`artist_catalog` needs its catalog twin, and `catalog/{sf}/songs?ids=<the new songs>&include=artists`
gives the catalog artists of up to 300 songs in one call. The weekly full sync still re-reads
every artist (`force`), as now.

### S4. Data that rides the sync page

`include=albums,artists&fields[library-albums]=name,artistName&fields[library-artists]=name` on
the sync's song pages: **probed, 106 KB a page against 63 KB today, the same calls**. It gives
each song its library album (Apple's album artist, album-notes.md §6) and its library artist (the
primary artist's key, §5). A nested `include[library-artists]=catalog` gave the same answer but
2.3 MB a page: never that; `artist_catalog` holds the catalog twin already.

### S5. `fields[…]` on the heavy reads

`fields[albums]`, `fields[artists]`, `fields[playlists]` trim a reply to the attributes we read.
Candidates: the artist pass (we read the catalog id, the photo, the genres, and §5's name), the
playlist dates call, enrichment. A trim never changes a call count; it changes the bytes and the
time. Each trim is checked against what the normalizer reads.

## 4. The Library's ⟳ button

**His report (2026-10-15):** the ⟳ spun, and further clicks did nothing.

**What happened (the log):** at 11:12:47 the launch started a full sync (the count had moved).
The ⟳ spins while any sync runs (`is-busy` on the `library-sync` start event,
`library-card.ts`). His clicks at 11:13:00 and 11:13:02 reached `library_sync`, and the Rust
guard (`SYNC_IN_FLIGHT`, `library.rs:765`) refused them: `[sync] library sync already in
progress`, a console error only. The sync ended at 11:13:06. His later click (13:42) ran a full
sync. The app did not freeze.

**Intended or not:** the guard is intended (one writer at a time). The silent refusal is not
designed anywhere. This time nothing was lost, because the running sync was a full one. If the
running sync is **incremental**, a ⟳ click that asks for a full sync is lost.

**His call (2026-10-15): make the refusal visible; do not queue a refresh.** A click while a sync
runs still starts nothing. What changes is that the user sees why. Not taken: a click that joins a
full sync or queues one after an incremental sync.

> **Part:** designed · 2026-10-15

**What follows:**
- The refusal is expected, so it is no longer a `console.error`. The front end knows a sync runs
  (the `library-sync` start event), so a click while `is-busy` does not call `library_sync` at all.
- `diag.log` the click (`library:refreshBusy`), with the sync's kind (full / incremental) and
  progress.

**Draft (his to edit): how it shows.**
- While it spins, the ⟳'s hover hint says what runs: "Reading your library… 1,200 of 4,042"
  (the sync events already carry the count and the total). The hint goes in ONBOARDING.md §1.
- A click while it spins shows that hint at once, without the hover delay, and the ⟳ gives one
  small nudge (the `pop` motion family; none under reduced motion). No toast: the answer sits on
  the control that was clicked.

## 5. A song's primary artist (his question, 2026-10-15)

**His report:** Go to Artist on *Mentirasmentiras* opened an artist view whose Last.fm box showed
the plays and listeners of "Girl Ultra, Buscabulla & Chromeo" (761 plays, 189 listeners), not
Girl Ultra's, on both the Lib and the Full level. He suspects the top artists are off too.

### 5.1 The causes (read 2026-10-15)

- **The name.** A library song carries one credit string. The Library splits it with a
  vocabulary of names that appear alone somewhere in the library (`src/artist-credit.ts`). His
  library has no song by Girl Ultra alone (only *Mentirasmentiras* and *Denisse*), so "Girl
  Ultra" is not in the vocabulary, and the credit stays one name: *Girl Ultra, Buscabulla &
  Chromeo*. Go to Artist (`songGoTo`, `media-menu.ts`) drills to that name.
- **The view.** `artist_catalog` maps that name to Girl Ultra's catalog id (`1207957662`), so the
  hero, the photo and the Full level are hers. The Last.fm box asks by the drill name, and Last.fm
  has a page under that exact string (`last.fm/music/Girl+Ultra,+Buscabulla+&+Chromeo`). The Full
  level keeps the Lib level's box by design (LISTENERS.md §7.4), so it shows the same numbers.
- **The top artists.** Rewind's *Artists* (`topBy`, `src/rewind.ts`) groups plays by the raw
  credit string (`key = t.artistName`). "Girl Ultra, Buscabulla & Chromeo" and "Girl Ultra &
  Chromeo" are two rows, and neither is "Girl Ultra". Every collaboration in the library splits
  its artist this way.

### 5.2 What Apple gives (probed live, 2026-10-15)

- **On the sync page, at no extra call:** with `include=artists`, each library song links to
  **one** library artist. Its catalog twin (from the artist pass) is the **primary artist**:
  - *Mentirasmentiras* and *Denisse* → library artist "Girl Ultra" → catalog `1207957662` Girl Ultra.
  - *Happy Place* (Toddla T & Jada Kingdom) → library artist "Toddla T & Jada Kingdom" → catalog
    Toddla T. *Drream* (JGRREY & Zombie Juice) → JGRREY. *Rocket Science* (Joyce Wrice, Kay
    Franklin) → Joyce Wrice.
  - 100 of 100 songs had a library artist with a catalog twin; none had more than one.
- **In the catalog, all credited artists in order:** `catalog/us/songs?ids=…&include=artists`
  gives *Mentirasmentiras* → Girl Ultra, Buscabulla, Chromeo, each with its catalog id. Up to 300
  songs a call.

So the primary artist is Apple's own answer, not a parse: a name with a comma or an `&` in it
(*Tyler, the Creator*, *Earth, Wind & Fire*) is one catalog artist with one id.

### 5.3 What follows (no fork)

- **The sync stores the song's library artist name** (S4) in the track JSON (`libraryArtist`).
- **The artist pass stores the catalog artist's name.** `me/library/artists?include=catalog`
  already returns it; `artist_catalog` gets a `catalog_name` column (a schema version bump,
  DATA-ARCHITECTURE.md). Then song → library artist → catalog id and name, at 0 calls.
- **Go to Artist goes to the primary artist** (Girl Ultra), from every menu: the Library way and
  the Search way.
- **Last.fm asks by the primary artist's catalog name**, on the artist view and the album box,
  so the counts are Girl Ultra's. The two old `artist_info` rows age out.
- **The Library's vocabulary learns every primary name** (`creditIndex` seeds it with the
  catalog names), so "Girl Ultra & Chromeo" splits under Girl Ultra even with no solo song. The
  parse remains only for the guests.
- A song with no library artist (a catalog song in a queue or a playlist) keeps today's way.
- **The backfill** rides the next full sync, as in album-notes.md §6.2.

### 5.4 His calls (2026-10-15)

> **Part:** designed · 2026-10-15

**P1 = A: Rewind counts a collaboration for the primary artist only.** `topBy("artists")` groups
by the primary artist's catalog id and titles the row with its catalog name; a guest takes no
share, so the totals match the real listening time. A song with no primary artist keeps today's
key (its credit string). The Library's artist tiles keep the multi-index (his call 2026-07-03):
that is where a guest's songs are collected. Not taken: every credited artist.

**P2 = A: the guests' names come from the enrichment call.** `fetch_catalog_songs` (enrich.rs)
already reads `catalog/{sf}/songs?ids=` when a surface touches a song; it adds
`include=artists&fields[artists]=name` and stores each song's catalog artists (ids and names, in
Apple's order) beside the ISRC and the preview in `track_catalog`. 0 extra calls. A song the app
has not enriched shows the primary artist only until it is. Not taken: one read of all library
songs (about 14 calls); the parse for the guests.

The menu with guests: *Go to Artist ▸* Girl Ultra · Buscabulla · Chromeo, the primary first
(the Library's submenu today, `songGoTo`). A guest opens by its catalog id (the Search way), or
in the Library when it is a Library artist.

## 6. Order of work

The order is HANDOFF.md › Open now › *Build order* (2026-10-15). This doc's parts in it: §4 the
⟳ (step 1); S4 + §5 + album-notes.md §6 (step 2, one change); S1 and S3 (step 3); S2 after its
week of dates; S5 alongside each step that touches those calls.

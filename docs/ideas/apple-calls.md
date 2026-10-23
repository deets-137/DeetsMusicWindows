---
status: idea
desk_test: passed 2026-10-17
sources: [src-tauri/src/apple.rs, src-tauri/src/library.rs, src-tauri/src/playlists.rs, src-tauri/src/enrich.rs, src-tauri/src/favorites.rs, src-tauri/src/web.rs, src/track-store.ts, src/library-card.ts, src/artist-credit.ts, src/rewind.ts, src/media-menu.ts]
updated: 2026-10-17
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
| `catalog_songs` (apple.rs, 2026-10-22) | `catalog/{sf}/songs?ids=` | the grand opening's preview player, its three songs (GRAND-OPENING.md §8b); once, then kept a month in the page's store | 1 |
| `catalog_artist` (apple.rs) | `catalog/{sf}/artists/{id}?views=top-songs,full-albums` | an artist's Full level, the Search artist pane (session cache) | 1 |
| `library_artist_info` (apple.rs) | `catalog/{sf}/songs/{song}?include=artists`, then `artists/{id}?views=featured-playlists,top-songs` | a Library artist view (cached in `artist_catalog`) | 0–2 |
| `catalog_song_artist` (apple.rs) | `catalog/{sf}/songs/{id}?include=artists` | Go to Artist from a catalog song | 1 |
| `catalog_related` (apple.rs) | `catalog/{sf}/{kind}/{id}?include={rel}` | a Search drill (song → album, album → artist) | 1 |
| `album_notes` (notes.rs, 2026-10-17) | `catalog/{sf}/songs/{id}?include=albums&fields[albums]=name,editorialNotes` (a library album), or `albums/{id}?fields[albums]=…` | an album page, a song page: Apple's editorial notes (features/album-notes.md), cached a month in `album_notes`. A background job. 0 on a Full album (its read and the hop keep the notes) | 0–1 per album a month |
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

### S1 and S3 as built (2026-10-15, `twenty-eighth`; desk test passed, his, 2026-10-15)

> **Part:** built · 2026-10-15 (S1, S3) · S2 designed · S5 rides each step

- **S1** (library.rs): `launch_pass(known, total)` picks the launch's pass: the same count →
  incremental; a rise → incremental with `explain`; a fall or no stored count → full (test
  `launch_pass_explains_a_rise_2026_10_15`). `sync_incremental` with `explain` stores Apple's new
  count and logs `library: incremental explains +N (N new)` when it found exactly N new songs.
  Otherwise it logs `…does not explain +N (M new): full sync`, emits no `done`, and the full pass
  runs (`full sync start (not explained: …)`); the rows it already changed count toward the full
  pass's `done`, so the Library still reloads.
- **S3** (apple.rs `fill_new_artists`): after an incremental pass, an artist count that moved
  first gives each library artist with no `artist_catalog` row its row from one of its songs:
  one song read (`enrich::read_song_artists`, which also stores the songs' guests, so the guests
  pass skips them) names the primary catalog artist, and one `artists?ids=` read (25 a call)
  brings the photo the re-page would have brought. Logs `library: artist count A → B, N new
  artist(s) from the new songs; no re-page`. When a name cannot be found that way (no song with a
  catalog id, more than 300 names, no stored storefront, a song Apple does not return), it logs
  why and re-pages, as before. A fall in the count (a removal) finds nothing missing: the count is
  stored, 1 call. The weekly pass still re-pages every artist (test
  `s3_finds_the_library_artists_with_no_row_2026_10_15`).
- **What a launch costs now** after a few songs were added: 1 count call + 1 incremental page +
  1 artist count call + (if new artists) 1 song read + 1 photo read + the guests pass for the new
  songs (0, their read was shared) = 3 to 5, against about 57 before.
- **Desk test (owner):** add two songs to the library on the phone, then relaunch the dev app.
  The log shows `incremental explains +2 (2 new)`, no `full sync start`, and, when one of them
  is by a new artist, `artist count … no re-page`. The new songs show in the Library with their
  artist's tile and photo. Then remove one song on the phone and relaunch: `full sync start`
  (the count fell).

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

> **Part:** built · 2026-10-15 (the spin; desk test passed, his, 2026-10-15) · the hint and the nudge built 2026-10-17 (his words, below)

**What follows:**
- The refusal is expected, so it is no longer a `console.error`. The front end knows a sync runs
  (the `library-sync` start event), so a click while `is-busy` does not call `library_sync` at all.
- `diag.log` the click (`library:refreshBusy`), with the sync's kind (full / incremental) and
  progress.

**As built (2026-10-15, `twenty-eighth`; his ask: the ⟳ spins while a sync runs).** The ⟳ spun
only from a `start` event the Library card heard, so it stood still when the card mounted after
the launch sync began (his report), and it stopped at `done` while the artist pass and the heal
still held the lock. Now the lock's release emits `{phase:"idle"}` (`SyncFlagGuard`, library.rs),
`library_sync_busy` answers a card that mounts mid-sync, and library.ts's `onSyncBusy` drives
`is-busy` from the lock to its release. A click while busy does not call `library_sync` and logs
`library:refreshBusy` with the last progress (the sync's kind is not in the events; not logged).
The draft below (the hint words, the nudge) is not built.

**The draft as it stood (his OK of the words, 2026-10-17, with no "Already").**
- While it spins, the ⟳'s hover hint says what runs: "Reading your library… 1,200 of 4,042"
  (the sync events already carry the count and the total). The hint goes in ONBOARDING.md §1.
- A click while it spins shows that hint at once, without the hover delay, and the ⟳ gives one
  small nudge (the `pop` motion family; none under reduced motion). No toast: the answer sits on
  the control that was clicked.

**As built (2026-10-17, `seventheenth`).** The draft's "1,200 of 4,042" fits a full pass only: an
incremental pass's `fetched` counts the new songs, not the songs read (`sync_incremental`), and
after the last page the lock holds through the artist pass and the heal. So the words have five
states (`src/sync-hint.ts`, pure, `tests/sync-hint.test.ts`):

| When | Words |
|---|---|
| No sync | Reads your library from Apple Music again |
| `start`, no page yet | Reading your library… |
| A full pass, reading | Reading your library… 1,200 of 4,042 songs |
| An incremental pass | Checking for new songs… (… 3 new, once it finds some) |
| The last full page, `done`, `error` | Finishing up your library… |

- **Rust:** each `progress` event carries `kind` (`full` / `incremental`), library.rs. An
  incremental pass that does not explain the count turns into a full one, and its words follow.
- **library.ts:** `onSyncStatus` / `syncStatus` (the status after each event, `nextSyncStatus`);
  `library:refreshBusy` now logs the status, so the kind is in the log.
- **hint.ts:** `showHintNow(el)` shows a written hint at once, right after a press too. A `title`
  write while a hint is up changes its words and centres the box again (the count moves under a
  resting pointer).
- **The nudge:** `.panel__action.is-nudged`, one dip to `--nudge-scale` in `--nudge-dur` /
  `--nudge-ease` (alias tokens of the pop family, skin.css); none under reduced motion.

**What Claude decided inside his OK (2026-10-17):** the incremental words and the finishing words
(the draft had none for those states); the hint on a click shows when Settings › *Hover hints* is
off too (that setting is about hover; a click must get an answer); `--nudge-scale: 0.86` (a
panel's 0.97 does not read on an icon square).

**Desk test:** in §4.1.

### 4.1 Desk test (2026-10-17)

1. Launch the dev app with the Library card on screen. While the launch sync runs, rest the
   pointer on the ⟳: the words name the pass, and a full pass's count moves while you rest.
2. Click the ⟳ while it spins: the hint shows at once, the ⟳ dips once, and no sync starts (the
   log has one `library:refreshBusy` with the status). Click twice fast: it dips again.
3. When the sync ends, the hint under a resting pointer reads *Reads your library from Apple Music
   again*. A click then starts a full sync, and the words go through *Reading your library…*.
4. Settings › *Hover hints* off: a click while it spins still shows the hint; hovering does not.
5. Windows reduced motion on: no dip; the hint still shows.

**Claude's run (2026-10-17, the dev app, `docs/ops/checks/refresh-hint.mjs`): rows 1–3 pass, 10
of 10 checks.** One full sync from the ⟳ (one `full sync start` in the log, no "already in
progress"), three refused clicks with three `library:refreshBusy` lines carrying the status, the
count moving from 100 to 3,960 of 4,060 under the open box, then *Finishing up…* for about
0.8 s, then idle. A launch-type pass read *Reading your library…* for about 2 s (Apple's count
call, before Rust picks the pass), then *Checking for new songs…* for one instant, then
*Finishing up…*. So on a quiet launch the incremental words are seldom seen; the words are right
in every state. **Not run:** rows 4 and 5 (the setting and reduced motion; by code: `showHintNow`
reads no setting, the CSS rule drops the dip), and his eye on the dip itself.

**Desk test passed (2026-10-17, his word: "mark library hint as desk tested").**

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
- **The backfill** rides the next full sync, as in album-notes.md §6.2. No forced pass: he runs
  it himself with the ⟳ after the update (his call, 2026-10-15).

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

**The method (2026-10-15, `twenty-eighth`, before the build).** P2 is built with step 2, not
later. The front end gets one small map, library artist name → catalog id and catalog name, and
the track store resolves each song's primary artist through it; the name is not written into
each track's JSON, so a later artist pass corrects every song at once. A library artist with no
catalog twin, and a song with no library artist, keep today's way (the credit parse).

The menu with guests: *Go to Artist ▸* Girl Ultra · Buscabulla · Chromeo, the primary first
(the Library's submenu today, `songGoTo`). A guest opens by its catalog id (the Search way), or
in the Library when it is a Library artist.

### 5.5 As built (2026-10-15, `twenty-eighth`; desk test passed, his, 2026-10-15)

> **Part:** built · 2026-10-15 · desk test passed 2026-10-15

**Probed live before the hand-off (3 calls).** The sync page with
`include=albums,artists&fields[library-albums]=name,artistName&fields[library-artists]=name`:
200, 107 KB a page, 100 of 100 songs named their library artist and their album's artist
(*bbno$, Diamond Pistols & BENEE* → library artist bbno$, album artist bbno$). The enrichment
read with `include=artists&fields[artists]=name` on *Mentirasmentiras*: Girl Ultra
`1207957662`, Buscabulla `916005416`, Chromeo `5523592`, in that order; the ISRC, the preview,
the palette and `composerName` still ride along.

**Rust.**
- `Track` gains `libraryArtist`, `albumArtist`, `libraryAlbumId` (model.rs), read by
  `track_from_library_song` from the page's relationships; `songs_page` asks for them (the full
  and the incremental pass). In the track's JSON; no table change.
- Schema v19 (`enrich::migrate_v19`): `artist_catalog.catalog_name`, `track_catalog.artists`.
- The artist pass stores `catalog_name`. **One forced re-page:** the pass is incremental by
  count, so a ⟳ alone would never fill the new column. A `meta` flag (`artist_catalog_names`)
  makes the first pass after the update re-page once (about 15 calls for 1,430 artists), then
  the count rule holds again.
- `artist_primaries` (new, network-free): `[library name, catalog id, catalog name]`.
- `library_artist_info`: a name with no row of its own but a `catalog_name` match ("Toddla T")
  gets its row copied at 0 calls; the one-call path stores the catalog name too.
- The enrichment read (`fetch_catalog_songs`) adds `include=artists&fields[artists]=name` and
  stores `[[id, name], …]` in `track_catalog.artists`; a read without them (a search result)
  keeps what is stored. `song_artists` (new, network-free) reads them.

**Front end.**
- `src/primary-artist.ts` holds the two maps: the primaries load with each library load and
  again on the sync's `idle` (the artist pass may land after `done`; a change re-renders); the
  guests load at launch and again after a palette read and a credits read.
- `artist-credit.ts`: the primary seeds the vocabulary and leads each song's names
  (`withPrimary`); the memo also keys on the map's version. `goToPeople` builds *Go to Artist ▸*:
  the library names (primary first), then Apple's guests the parse does not know.
- `songGoTo` (media-menu.ts): the submenu from every menu now, not only the Library's, whenever
  a song has more than one person. A guest opens in Search by its catalog id, or in the Library
  when the Library holds it.
- Rewind's *Artists* keys on the primary's catalog id (P1); its *Albums* subtitle is the album
  artist.
- Albums: `groupAlbums` and `libAlbum` take `albumArtist` when the songs carry it (album-notes.md
  §6.2). The Last.fm album box asks by it; the artist box asks by the drill name, which is now the
  primary's name.
- Tests: `tests/artist-credit-primary.test.ts` (5), apple.rs
  `library_song_reads_its_library_artist_and_album_2026_10_15`.

**Not applied.** The web demo's TypeScript twin (WebRooms.md §9.3) normalizes catalog shapes
only; library songs are not in it, so it gains no fields. The demo stubs answer the two new
commands with nothing.

**Found in the build: few songs get their guests (fork G1; his call A, built in §5.6).** P2 assumed the enrichment
read runs whenever a surface touches a song. It runs on a palette miss only (`album_palette`:
the first song of a new cover, one song) and in the song credits pane (`credits_fetch`).
`catalog_enrich` has no caller in the front end. So most library songs will show the primary
artist only, for a long time.
- **A (recommended): one read of the library's songs for their artists**, about 14 calls once
  (300 a call), then each new song in the sync's own pass. Every song gets its guests at once.
  It is the option P2 did not take, at the cost the doc gave.
- **B: read a song when its menu asks**: the right-click on a song with no guests stored reads
  it (1 call), so the submenu has its guests the next time. Calls only for songs he touches;
  the first right-click shows the primary only.
- **C: keep P2 as built.** 0 calls; guests come slowly.

**Desk test (owner).**
1. Restart the dev runner (Rust changed; schema v19 runs). Click the Library ⟳ once (his
   backfill). The log shows `migration: v19 added …`, a full sync, and `artist catalog filled`.
2. Right-click *Mentirasmentiras* › *Go to Artist ▸*: Girl Ultra first. Girl Ultra opens her
   artist view; its Last.fm box shows Girl Ultra's counts, not the three-name string's.
3. The Library's Artists view has a Girl Ultra tile with both songs.
4. Open *Rrromeo*: the artist line reads Girl Ultra; its Last.fm box is the album's.
5. Rewind › Artists: one Girl Ultra row, no "Girl Ultra, Buscabulla & Chromeo" row.
6. Play a song whose cover has not played before, then right-click it: *Go to Artist ▸* lists
   its guests after the primary. (Since §5.6 every library song has them after the ⟳; this
   step checks a catalog song from Search.)

### 5.6 G1 = A: every library song's guests (his call, 2026-10-15)

> **Part:** built · 2026-10-15 (`twenty-eighth`; desk test passed, his, 2026-10-15)

**His call:** read the library's songs for their artists once, then each new song in the sync.

**As built.** `enrich::guests_pass` runs after the heal pass at the end of every library sync
(the full and the incremental pass). It picks each library song with a catalog id and no
`track_catalog.artists` (`guests_pending`), reads them 300 a call with the enrichment read, and
writes each song through `write_song`. Every asked id that came back with no artists, or did
not come back, is marked `'[]'` (`mark_read`), so it is never asked again. The first pass after
v19 reads the whole library (about 14 calls for 4,042 songs); later passes read only the songs
the sync added (usually none, so 0 calls). A background job (`song_guests`, ops/APPLE-CALLS.md):
skipped while Apple's back-off holds, stops at the first failed call, never fatal. It ends with
`song guests: N song(s) to read, … in M call(s)` in the log and a `song-artists` event; the track
store reloads the guests map on it.

**At no extra call, the same read** stores each song's ISRC, preview, album palette and writer
credits. So after the first pass the album colors of the whole library are cached (no palette
miss on a first play), and the song credits pane has every library song's writers.

**Test:** enrich.rs `guests_pass_asks_each_library_song_once_2026_10_15`.

**Desk test (owner), with §5.5's.** After the ⟳: the log shows one `song guests:` line with about
14 calls; a second ⟳ shows no `song guests:` line, or one with 0 calls. Right-click any
collaboration in the Library: *Go to Artist ▸* lists every credited artist, the primary first.

## 6. Order of work

The order is HANDOFF.md › Open now › *Build order* (2026-10-15). This doc's parts in it: §4 the
⟳ (step 1); S4 + §5 + album-notes.md §6 (step 2, one change); S1 and S3 (step 3); S2 after its
week of dates; S5 alongside each step that touches those calls.

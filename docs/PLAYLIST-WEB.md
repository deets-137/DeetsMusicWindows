# DeetsMusic — the playlist web

A **web** is a playlist built from one artist and the artists they make songs with. You give
an artist, a reach and optionally a genre. DeetsMusic finds the songs and makes the playlist.

Status: **designed, built and desk-tested 2026-09-16 (§8).** Code: `src/web.ts`
(panel, picking), `src-tauri/src/web.rs` (`web_build`). **Song and album seeds (§9) and
temporary web playlists (§10): designed and built 2026-09-17, committed 94b82cd, shipped in 0.9.0.
The default name carries the picked genres (§2c).** Open: the name-search cap (§5b), to check
against the `search N` part of the `web: built` log lines.

Terms used in this doc:
- **Seed** — the artist you start from.
- **Edge** — two artists are credited on the same song (the artist line, "&", "feat.").
- **Degree** — the number of edges from the seed. The seed's collaborators are degree 1.
- **Reach** — the highest degree a build goes to (1, 2 or 3).
- **Seed song** — a song that credits the seed: its own songs and its features.

The first hand-built web was "Pumped Afternoon Web: Samara Cyn" (through the MCP,
2026-09-16). It found features by text search ("feat. Samara Cyn"), which misses a song when
the seed's name is not in its title or artist line. The built web reads Apple's artist views.

## 1. Where you start it

The **web button** in the Playlists card header, between **+** and **Sync** (user's call
2026-09-16: its own button, not a row in the + menu). The icon is a web of five rings and
four lines from the user's sketch, drawn by `iconSvg()` so the lines stop short of the rings.
Like +, it shows only at the card's root.

Not built: a right-click **Make a Web…** on an artist.

## 2. The panel

A `.pop` panel portaled to `<body>` (the "Play on" pattern: a Glass card is a stacking
context). Its parts slide in with `enterRows` on open, and each part that appears later
(the artist rows, the chips, the status line) slides in too. `dataset.frames = "web"`.

| Part | Control | Notes |
|---|---|---|
| Artist | a search field (combobox), never free text | typing lists matches at 0 calls; ↑ ↓ mark a row; Enter or a click picks the marked row (§2a) |
| Artist rows | up to 5 matches, then **Search Apple Music for "…"** | the picked artist stays as one marked row until you type again |
| Reach | **1 · 2 · 3** | the `webReach` setting; a change builds again |
| Size | **25 · 50 · 100** | the `webSize` setting; no Apple call |
| Prefer | **Familiar · Discover · Mix** | the `webPrefer` setting; no Apple call (§4) |
| Genre chips | the web's 10 biggest genres; the number is the web songs (not the artist's own) with that tag | shown after a build; several may be picked (a song needs one of them); no Apple call. The hover hint is written again on every change: what the number means and how many of that genre the playlist gets now, or would get with a press |
| Status | "Reading 15 artists, 2 steps out…" → "50 songs from 41 artists" | `web-progress` events during a build; ends with **Retry** or **Read again** (§5a) |
| Playlist name | text field, default "`<Artist>` Web" | Enter makes the playlist |
| Make playlist | button | creates it, adds the songs, closes the panel, opens the playlist; the cover follows "New cover" |

### 2a. The artist search

A web starts only from a picked row, so a typo can never start a build (user's call
2026-09-16: "protected", not free text).

| Row | Source | Apple calls |
|---|---|---|
| empty field | the artists you built webs from, newest first ("Web before") — `web_seeds` | 0 |
| a library artist | your library's artists as the Library card groups them (`creditIndex`), ranked: name starts with the text, then a word starts with it, then contains it; more songs first. Photo from `artist_photos`, else an album cover | 0 to list |
| an earlier web's artist | `web_seeds` matching the text, above library artists | 0 |
| **Search Apple Music for "…"** | always the last row while text is typed; the only way to a catalog search | 1 |
| an Apple result | the search's artists, with the Apple Music sigil; one result is picked at once | 0 more |

Picking a **library artist** needs their Apple id: `library_artist_info` with a song the artist
**leads** (the first credit, so a feature's host is never picked by mistake) — 1 call the first
time, 0 after (saved in `artist_catalog`, shared with the Library artist view and Home). A
library artist who only appears as a guest has no such song: Apple is searched by the name,
and the result with exactly that name is picked.

### 2b. Make playlist

1. The playlist is created and the songs are added (local, a few ms); the button reads
   "Making…". A failure: the toast, and the panel stays open. Only a made playlist moves on.
2. **The chip flight** (`handOff`, ARTIST-VIEW.md §5): a copy of the **picked artist row**,
   with a "N songs" badge, flies to the centre of the Playlists card and shrinks into it; the
   playlist opens under the landing, with its songs handed over, so it arrives full. The card
   is already on screen, so nothing moves in the layout.
3. **The panel** — Settings › Playlists › **Web panel closes** (`webMakeMotion`):
   - **Shrink to chip** (default, user's call to try it): the panel's edges draw in to the
     artist row (`clip-path` inset, rounded to the row's radius) while its other parts fade
     in the first 60 %. At the end the row's copy lifts from exactly there, and the panel
     goes away at once (`.web--gone`, no pop out). `--web-shrink-dur` 0.32 s,
     `--web-shrink-ease` = `--pop-ease`. Logged as `[perf] frames menu web-shrink`.
   - **Pop out**: the copy lifts and the panel's normal `.pop` close runs at the same time.
4. Motion off (the OS reduced-motion preference only): no shrink, no chip; the panel closes
   and the playlist opens. **Not tied to Animate card swaps** (user's call 2026-09-16): no card
   changes place here — `handOff(…, ownMotion = true)`.

### 2c. The playlist name (2026-09-17)

The default name is the seed, the picked genres, and "Web": "V (Deluxe) Reggae Web",
"Khalid Hip-Hop/Rap & R&B/Soul Web". Up to 2 genres go in (`NAME_GENRES`); with 3 or more, the
name has none ("V (Deluxe) Web"). The name follows each chip press and the genres a song or
album seed picks, until you type in the field. Typing it back to the default lets the chips
rename it again. A new seed starts over.

## 3. Decisions (2026-09-16)

| Fork | Decision | Why |
|---|---|---|
| Where it lives | **in the app**, its own header button | the panel needs pills and chips; the + menu holds fields and rows only |
| Reach | **a setting, 1–3 degrees** (Settings › Playlists › Web reach, default 2) | how far out is a taste call |
| Filter | **genre tags** (Apple `genreNames`), no model judgment | the app has no Claude; tags are what he wanted |
| What a chip filters | **everything, the artist's songs too** (Settings › Playlists › Web genre chips filter: **All songs** / Keep 5 / Web only) | first decided "web only"; changed the same day after the data: Samara Cyn's songs are 37 Hip-Hop/Rap, 6 R&B/Soul of 42, so an R&B/Soul pick kept ~25 rap songs next to 25 R&B songs — a clash. Apple tags a song with its album's genre, so filtering leaves few of the artist's songs; the status line says how many ("· 6 by Samara Cyn") |
| Other versions of one song ("(HELIUM VERSION)", "- A COLORS SHOW") | **kept as separate songs** | user's call 2026-09-16 |
| What an edge is | **features only**; `similar-artists` is not an edge | every link is a real song together |
| Size | **a cap, nearest first** (Web size, default 50) | reach 3 finds hundreds of songs |
| Apple calls | **as few as possible** (his standing rule, restated during the build) | §5 |
| A partly failed build | **the status line + Retry**; a toast only for Make playlist | a build runs only while the panel is open, so the panel is where you look |
| Your stored data | **names → ids from `artist_catalog`**, and **saved reads** that can be read again | fewer calls; a web survives a restart |
| Library links (edges from your own songs) | open — §7 | explained 2026-09-16, not decided |
| The artist field | **a search over your library and earlier webs, with a "Search Apple Music" row** | a typo cannot start a build, and most picks cost 0 calls |
| Make playlist motion | **the picked artist row flies to the card centre** (the Artist view's chip flight); the panel **shrinks into the row** or **pops out** — a Settings row, Shrink to chip first | one motion language with the Artist view; the shrink is on trial |
| Your library and the order | **a pill: Familiar / Discover / Mix** (default Mix) | a web is sometimes a comfort list, sometimes a find |
| A song or an album as the seed (2026-09-17) | **all leads are seeds, guests go first into degree 1; the genre picks the chips; the song or album leads the playlist; found in the panel's search** | §9 |

## 4. How songs are picked

**Rust (`web_build`)**, per degree d from 0 to the reach:
1. Read the degree's artists: `top-songs`, and (below the last degree) `singles` and
   `appears-on-albums`. The last degree reads top songs only.
2. Read those albums' tracklists. A song counts for an artist when its artist line or its
   "feat." part names that artist.
3. Every other artist on those songs is a link: from the song's `artists` relationship (the
   main credits) and from the names in "feat." — Apple's relationship leaves the "feat."
   artists out, so their names are matched to ids already seen.
4. Rank the next degree: linked from more artists of this degree first, then more songs
   shared. The seed's collaborators go on up to 40; after that 15 a degree.

Then every artist's top songs and credited songs, in degree order, with instrumentals and
sped-up / slowed edits dropped and a repeat (same ISRC, or same title and artist line) kept
once, at its nearest degree.

**The panel (`pickSongs`)**, under the cap:
1. Seed songs fill at most half. Picked genres filter them per `webSeedFilter`: Always
   (only matching songs), Keep 5 (matching songs, topped up to 5 with the artist's best
   others), Never (all stay).
2. The web fills the rest nearest degree first, one song per artist in turn, so one artist
   cannot fill the list. Picked genres filter it.
3. A thin web leaves room, and more seed songs fill it.
4. Order: seed songs and web songs alternate, spread evenly when one side is longer.

**Prefer.** Rust marks every song with what you already have (`mine`): 3 ♥ (`favorites`),
2 played (`play_stats`), 1 in your library (`tracks` source `library`), 0 new to you. Before
steps 1–2, the lists are sorted: **Familiar** puts higher marks first; **Discover** puts 0
first; **Mix** leaves Apple's order. The sort is stable, so an artist's top songs still lead
inside each mark. Genre chips and the cap work the same in all three.

## 5. Apple calls

Measured on Samara Cyn, 2026-09-16, with a probe of the same algorithm through MusicKit:

| Probe | Result |
|---|---|
| `artists?ids=a,b&views=…` (a batch) | returns views — one call reads 25 artists |
| a view's first page | 10 items; `artists/{id}/view/{view}?limit=100` returned all (18 singles, 11 appears-on) |
| `albums?ids=…(50)&include=tracks&include[songs]=artists` | one call; songs carry artist ids and names |
| a song's `artists` relationship | main credits only — "feat." artists are missing |
| reach 3, 15 artists a degree | **18 calls** (degree 0: 7, degree 1: 5, degree 2: 6) |
| a "feat." name looked up by search for every artist | 226 calls before it stopped — **the reason lookups are seed-only** |
| artist search "Sherwyn" | HTTP 401 every time (others work) — a failed lookup is skipped and remembered |

Rules in `web.rs` that keep the count low:
- Artists in batches of 25, albums in batches of 50.
- The last degree reads top songs only (no album calls).
- Only the seed's views are paged past the first 10 (1 call each, only when Apple says there is more).
- "feat." names are looked up by search on the seed's songs only, at most 10.
- A "feat." name resolves first from names already known: names Apple sent in this build's reads, the
  Library artist view's `artist_catalog` (your library artists' ids), and earlier lookups
  (`web_names`, a miss is asked again after 30 days).
- Every artist read is saved in SQLite (`web_artists`) for 7 days. Reach 2 → 3 reads only
  degree 3; a second build of the same seed, even after a restart, makes 0 calls. Genre
  chips, Size and Prefer never call Apple.

## 5b. A newer build stops an older one; the call split (2026-09-17)

The first song webs showed two waste points (8TEEN: reach 1 = 18 calls and reach 2 = 31 ran at
the same time, because Reach was pressed during the first build; name searches were 26 of 72 calls):
- **A newer build stops an older one.** `web_build` numbers each build (`BUILD_GEN`). An older
  build makes no more Apple calls once a newer one starts; the reads it finished are saved and
  the newer build uses them. Log: `web: stopped seed=… (a newer build started) calls=…`.
- **The log line splits the calls:** `calls=31 (artists 2, views 0, albums 18, song 1, search 10)`
  — artist batches, seed view pages, album tracklists, a song's credits, name searches. A failed
  build logs `web: failed … calls=… <error>`.
- **Names:** an artist line splits on " x " too ("Marshmello x Khalid x SUMR CAMP"), unless the
  whole line is one known artist ("Chloe x Halle"). "Music" and "Various Artists" are never searched.

Desk test: pick an artist, and press Reach 3 while the status still says "Reading…": the log shows
`web: stopped` for the first build, then `web: built` for the second, with a split.

## 5a. Failures, Retry, Read again

| What failed | Result |
|---|---|
| the artist search | status: "Couldn't search Apple Music" |
| the seed's own artist read | the build fails; status: "Couldn't read this artist's web. Try again" |
| another artist batch, an album batch, a seed view page | the build goes on; those artists are saved with `ok = 0` and counted in `failed`; status: "N songs from M artists · some artists didn't load **Retry**" |
| a "feat." name search | a miss, saved; no notice (one link less) |
| Make playlist | toast: "Couldn't make the web playlist." |

**Retry** builds again: the saved reads with `ok = 0` (and artists Apple left out) are read
again, and only those. **Read again** shows when the whole web came from saved reads
("· read 3 days ago"); it builds with `fresh`, which reads the web's artists from Apple again.

Expected per build: reach 1 ≈ 3–6 calls, reach 2 ≈ 6–12, reach 3 ≈ 12–20; plus one search per
Enter in the artist field.

## 6. Parts

- `src-tauri/src/web.rs` — `web_build(seedId, reach, fresh?)` → `{ seed, artists[{id,name,degree}],
  songs[{track, degree, artistId, seed, mine}], calls, failed, oldest }`; emits
  `web-progress {degree, artists}`; logs `web: built seed=… reach=… fresh=… artists=… songs=… calls=… failed=…`.
  Tables `web_artists`, `web_names` (`init_tables`, created at startup).
- `src/web.ts` — `mountWeb(btn)` (panel), `pickSongs(result, genres, size, prefer)`;
  `diag.log("web:build" | "web:make")`.
- `src/playlists-card.ts` — the header button, root-only, torn down with the card.
- Settings: `webReach`, `webSize`, `webPrefer`, `webSeedFilter`, `webMakeMotion` (settings-store, agent-settings, Settings ›
  Playlists, SETTINGS.md, AGENT.md §6).
- Tokens: `--web-*` in skin.css base. Hints: ONBOARDING.md ledger. Toast: TOASTS.md §5.
- §9 adds `web_build(seed: WebSeed, …)`, `web_seeds` → `WebSeed[]`, and the tables `web_albums`
  and `web_seed_list`.

## 7. Not built

- Right-click an artist → **Make a Web…** with the seed filled in.
- An agent verb (`web` in the MCP/CLI).
- **Library links** (open fork): read edges from your own library songs ("feat. X", "A & B")
  before Apple, at zero calls. It adds links Apple's first 10 items per view can miss, but it
  pulls the web toward what you already own, and it needs an id for each name (the names →
  ids step above covers only your library artists).

## 8. Desk test

Restart the dev runner (a new Rust command).
1. Playlists card, at its root: the web button sits between + and Sync. Drill into a playlist:
   it hides with +.
2. Open it: the panel pops, its rows slide in, the artist field has focus.
3. Open the panel with an empty field: earlier webs' artists show ("Web before"). Type "sam":
   library matches first, "Search Apple Music for “sam”" last; ↑ ↓ move the mark. Enter on an
   artist in your library: the status line counts degrees; then chips and "50 songs from N artists".
3a. Type a name not in your library, Enter on the Apple row: Apple's artists show with the sigil;
    a click picks one. Typing again brings back the library list. No call while typing.
4. Log: `grep "web: built" %APPDATA%\com.deetsmusic.dev\deetsmusic.log` — calls ≤ ~12 at reach 2.
5. Reach 3: only the new degree is read (calls in the next log line are small). Back to 2:
   `calls=0`.
6. Pick R&B/Soul: the count drops; Size 25 / 100 change the count; no new log line.
6-. Pick R&B/Soul with "Web genre chips filter" on All songs: the status line adds "· N by
    Samara Cyn" and N is small; Keep 5: N is at least 5; Web only: the line has no "by" part.
6a. Prefer Familiar: songs you ♥ or played lead the playlist; Discover: they sink. No log line.
6b. Close the panel, restart the dev runner, build the same artist: `calls=0`, the status says
    "read today" with **Read again**. Read again: a new log line with `fresh=true` and calls > 0.
6c. Offline (Wi-Fi off) after picking the artist from the list: the build fails with the status
    message; back online, a partial build shows **Retry**, and Retry's log line has few calls.
7. Make playlist (Close on Make = Shrink to chip): the button reads "Making…"; the panel
   draws in to the Samara Cyn row, the rest fades, the row flies to the card centre with
   "N songs" and the playlist slides open under it, full, mosaic cover; Samara Cyn songs
   alternate with web songs. Check `[perf] frames menu web-shrink` and `[perf] frames
   handoff` in the log. Pop out: the panel pops out as the row lifts. Animate card swaps off:
   the same motion (only reduced motion stops it).
8. An artist who is only a guest in your library: the pick searches Apple by name and picks
   the exact match (one call).
9. Reduced motion on: the panel and rows appear without moving.

## 9. A song or an album as the seed (designed and built 2026-09-17, shipped in 0.9.0)

A web can start from a song or an album, not only from an artist. The song or album gives
three things an artist does not: a genre (which side of the artist you mean), more than one
artist, and songs to open the playlist with. **Genre is not new data:** every web song already
carries `genreNames` (the chips count them), and Apple tags a song with its album's genre.

Terms used in this section:
- **Lead** — an artist on a song's artist line ("A & B" → A and B). For an album: the album's
  artist line.
- **Guest** — a name in a title's "feat." / "with" part.
- **Seed artists** — the artists a web reads at degree 0. An artist seed has one.

### 9.1 Decisions (2026-09-17)

| Fork | Decision | Why |
|---|---|---|
| Who is the seed | **1C: every lead is a seed artist** (degree 0, paged like today's seed); the guests, and for an album every other artist on its tracks, go first into degree 1 | the §2a "leads" rule; a duo song treats both artists the same. Every artist credited on the seed only (B) made "seed songs" a mix of several artists and cost ~2 calls each |
| What the genre does | **2A: it picks the chips** when the web is built (the song's or album's genres, without "Music"); you can clear them; Genres for Webbing applies as for a hand pick | no new picking logic; visible and reversible |
| The song or album in the playlist | **3A: it leads**. A song is track 1. An album's tracks lead the seed half, sorted by Prefer: Familiar = the ones you ♥, played or saved first; Discover = the ones you don't have first; Mix = album order | you picked it; Prefer means the same thing everywhere |
| Where you start it | **4B: the panel's search finds songs and albums** | parity with artists: no seed kind has a right-click "Make a Web…" (§7) |
| How you choose the kind | **a row of three buttons, Artist · Song · Album, above the search field** (user's call) | one kind at a time keeps the list short and the Apple search narrow |
| Reach for an album | **2 at most** (user's call at build time): with an album seed the Reach **3** button is dimmed and a build uses 2; the `webReach` setting is kept | an album starts with many artists; reach 3 from all of them is the biggest call count a web can make |
| An album you have only part of | **9.5 B: read the full tracklist once, save it 7 days** | Prefer sorts the whole album; every artist on it is linked |

### 9.2 The panel search

A **Start** row of three buttons sits above the search field: **Artist · Song · Album**. It is
the panel's existing segmented control (`.web__seg`, the Reach row's shape). The button picks
what the field finds; the rest of the panel does not change.

| Part | Artist | Song | Album |
|---|---|---|---|
| placeholder | "Find an artist" | "Find a song" | "Find an album" |
| library rows (0 calls) | as today (§2a) | your library's songs by title (`matchRank`); more plays first; row subtitle = artist line | your library's songs grouped by album and album artist; row subtitle = album artist |
| "Web before" (empty field, 0 calls) | earlier artist seeds | earlier song seeds | earlier album seeds |
| row subtitle | songs in your library / "Web before" / Apple's first genre | the artist line | the artist line |
| cover | round photo | the cover, `--web-cover-radius` (the Library row's corner) | the same |
| **Search Apple Music for "…"** (1 call; the same kind and text again: 0 until the app closes, `searchOnce`) | `types=artists` | `types=songs` | `types=albums` |
| rows shown | up to 5, then the Apple row | the same | the same |

- The panel opens on the kind of the last web you built (read from `web_seed_list`, 0 calls);
  the first time, Artist. It is not a setting.
- A press on another kind clears the typed text and shows that kind's "Web before". A web
  already built stays in the panel until you pick a new seed.
- A song or album without a catalog id (an uploaded file) is not listed.
- The default playlist name: "`<Artist>` Web", "`<Song title>` Web", "`<Album title>` Web".
- Hover hint on the row: "Start the web from an artist, a song or an album" (ONBOARDING.md ledger).
- Library songs: rows with a catalog id, one per id, ordered by match and then by plays
  (`play_counts`, read with the seeds on open). Library albums: your songs grouped by `albumKey`
  (the grouping Rewind and Home use); the artist line most of its songs carry.
- A genre the seed picks shows as a chip even when it is not among the web's ten biggest.

### 9.3 Apple calls

What the app already saves: a song has its title, artist names, genres, ISRC and catalog id —
**not** artist ids. Names become ids through `artist_catalog`, `web_names` and the names in
`web_artists` reads. Your library's songs are in `tracks`.

| Seed | Needs | From | Calls |
|---|---|---|---|
| a song | lead and guest ids, genres | the saved song; names → ids from the three tables | **0** |
| a song whose lead name is not saved | that lead's id | the §2a fallback: `library_artist_info` or a search by exact name | 1, the first time |
| an album | its full tracklist with artist ids | `songs/{any track}/albums?include=tracks&include[songs]=artists` (library album) or `albums/{id}?include=…` (Apple result) — **see 9.5** | 0 or 1 |
| each lead after the first | its views paged past 10 | as the seed today | up to 2 |

The seed artists' own reads cost what an artist seed costs today (§5); a lead already read by
an earlier web costs 0.

To check before building: that the `songs/{id}/albums` relationship route accepts
`include=tracks&include[songs]=artists` (one call). If it does not, a library album costs 2.

### 9.4 How the build changes

- `web_build` takes a seed of a kind: `{ kind: "artist" | "song" | "album", id }`.
- **Song:** leads = `split_names(artist line)`; guests = `feat_names(title)`. Leads resolve to
  ids and become degree 0; guests that resolve go into degree 1 ahead of the ranking (inside the
  40 cap). A guest that does not resolve counts toward the seed lookups (at most 10) as today.
- **Album:** leads = the album artist line. Every other lead or guest on its tracks goes into
  degree 1 ahead of the ranking, the most tracks first, inside the 40 cap. The album's tracks
  are marked `seed` (even a track a seed artist does not lead) and carry an `anchor` order.
- **"Various Artists"** (a compilation, no real lead): no seed artists. The album's track leads
  are degree 1, the album's tracks are the seed half, and the web grows from degree 1.
- **Seed songs** = songs that credit any seed artist, as today with one seed.
- `WebResult` adds `anchor: Track[]` (the song, or the album's tracks) and `genres: string[]`
  (the chips to pick). `pickSongs` puts the anchor first: the song at track 1; the album's tracks
  at the top of the seed half, sorted by Prefer, still inside the half cap.
- A song seed's anchor is not genre-filtered (you picked it). An album's tracks follow Genres
  for Webbing like the other seed songs.
- "Web before": `web_seeds` reads a new table `web_seed_list(kind, id, json, built_at)` instead
  of the `paged` flag, so a song or album seed is listed once, not as its leads.
- Log: `web: built seed=<kind>:<name> …`.

### 9.5 An album you have only part of (decided: B)

Your library holds 6 of an album's 8 songs. `tracks` has the 6, and the app cannot tell 6 of 8
from 8 of 8 without a call (library albums carry no track count in the flat list).

**B: every album seed reads its full tracklist once** (with each song's artists) and saves it
in a new `web_albums` table for 7 days, as `web_artists` does. 1 call the first time, 0 after.
The missing songs join the anchor with `mine = 0`: Discover puts them first, Familiar puts your
6 first. Every artist on the album is linked. Rejected: A (your songs only — loses the 2 songs
and their artists), C (a "Read full album" control — one more control).

### 9.5a Example: an album with 8 artists

The album: 1 album artist (the lead) and 7 other artists on its tracks. Nothing saved yet.
The artist count barely changes the cost: artists are read 25 per call, so 8 fit in one. The
calls come from **album tracklists** of artists read in full (every degree below the reach).

| Step | Reach 1 | Reach 2 |
|---|---|---|
| the album's tracklist (9.5 B) | 1 | 1 |
| degree 0: the lead's read (top songs, singles, appears-on) | 1 | 1 |
| the lead's views past Apple's first 10 | 0–2 | 0–2 |
| the lead's singles and appears-on tracklists, 50 per call | 1–2 | 1–2 |
| "feat." names not saved (shared cap of 10) | 0–10 | 0–10 |
| degree 1: the 7 album artists + the lead's collaborators, cap 40 — top songs only at reach 1 | 1–2 | — |
| degree 1 read in full at reach 2 (artists 1–2, their tracklists) | — | 3–10 |
| degree 2: 15 artists, top songs only | — | 1 |
| **Total, first build** | **4–9** (+ name searches) | **8–19** (+ name searches) |
| **The same album again, or a bigger Size / other chips** | 0 | 0 |

Reference: Samara Cyn as an artist seed measured 7 calls at degree 0 (searches included) and 5
at a full degree 1 (§5). An album seed costs the artist seed's calls **+ 1**. A second lead ("A &
B") adds up to 2 (its paging), and its tracklists join the same 50-per-call batches. The 7 album
artists take slots inside degree 1's cap of 40; they do not add artists past it.

### 9.6 Build checklist (CLAUDE.md › Working style)

- Motion: the Seed row enters with `enterRows` on open, as the other rows do; the new hit rows
  are the existing row shape and enter as today.
- Hints: the kind subtitle needs no hint; a new row shape (song, album) goes in ONBOARDING.md
  SHAPES.
- Settings keys: none. Toasts: none new. Tokens: none expected (the row subtitle uses the artist
  row's type tokens).
- Log: `web:build` adds `kind`.

### 9.6a As built (2026-09-17)

- `web.rs`: `WebSeed` (serde tag `kind`), `seed_parts` (leads, degree-1-first artists, anchor,
  genres), `read_album` + `web_albums`, `lookup` (one search; a shared cap of 10 per build),
  `save_seed` + `web_seed_list`. `load_names` also reads the names in `web_artists` (a song's
  leads are often there). `init_tables` copies the old artist seeds (paged reads) into
  `web_seed_list` once.
- `WebSong.anchor`, `WebResult.kind` and `.genres`. Log: `web: built seed=<kind>:<title> …`.
- A song's leads: the whole artist line as one name first, then each name in it. A name not
  known costs one call (`songs/{id}?include=artists`), never a search.
- A library album is read through `songs/{id}/albums?include=tracks&include[songs]=artists`. If
  Apple leaves the tracks out on that route, it reads `albums/{id}` too and logs
  `web: the album route left out its tracks; reading the album`. Look for it in the desk test.
- `web.ts`: the Start row, `libraryAlbums`, song and album rows; `pickSongs` pins a song seed
  first and puts an album's songs (sorted by Prefer) at the head of the seed half.
- Tokens: `--web-cover-radius`, `--web-hit-line-max-w`.

### 9.7 Desk test

Restart the dev runner (web.rs changed; new tables are created at startup).
1. Open the web panel: the Start row shows Artist · Song · Album above the field and slides in
   with the other rows. Your artist webs from before still show under Artist ("Web before").
2. **Song, from your library.** Press Song and type part of a title: your songs, most played
   first, each with its artist line and a square cover; "Search Apple Music for “…”" last. Pick a
   song with a "feat." guest. The genre chips come up with the song's genre already picked. After
   Make playlist, the first song is the picked song. The guest's songs are near the top of the web
   songs. Log: `web: built seed=song:<title> …`.
3. **Song, from Apple.** Type a title not in your library, Enter on the Apple row: Apple's songs
   show with the sigil. Pick one. It builds as in step 2.
4. **An album you have part of.** Press Album and pick a library album you have only some songs
   of. Log: the album read is in `calls`. No "route left out its tracks" line = the one-call path
   works. Prefer Discover: the album songs you don't have come first in its block; Familiar: yours
   first. Build the same album again: `calls=0`.
5. **Reach cap.** With the album web built, the Reach 3 button is dimmed and its hint says "An
   album starts with many artists…". If Reach was 3, the pressed button shows 2. Pressing 3 does
   nothing. Pick an artist: 3 works again.
6. **Various Artists album** (a compilation): it builds; the album's songs lead, and the web is
   the artists on its songs.
7. **Switching.** With a song web built, press Artist: the field clears and shows the artist
   "Web before" list, and the panel's height moves to the new size (`--pop-grow`, the AirPlay
   panel's pattern; `[perf] frames menu web-kind` in the log; reduced motion: it jumps); the built web stays (chips, status, Make playlist). Press Make playlist: the
   Start row goes back to Song, the picked song row shows, and it flies to the Playlists card.
8. Close and open the panel: it opens on the kind of the last web built.
9. For §9.5a: note `calls=` in the `web: built` lines at reach 1 and 2 for one album (Read again
   between them, or a new album each time).

## 10. Temporary web playlists (designed and built 2026-09-17, shipped in 0.9.0)

A web playlist can be temporary: DeetsMusic deletes it by itself after a number of days. You
choose Keep or Temp for each web in the web panel, under Make playlist. The default is **Temp,
7 days** (user's call 2026-09-17).

Terms used in this section:
- **Days** — how long a temporary playlist lives: 1, 3, 5, 7 or 30.
- **Clock** — the moment the days count from: the later of Make and the last play from the
  playlist.
- **Expiry date** — clock + days. The playlist is deleted at the first check after it.
- **Keep** — no expiry. The playlist is an ordinary playlist.

### 10.1 What the code gives us (checked 2026-09-17)

| Fact | Where | Result for this design |
|---|---|---|
| `local_playlists` has `created_at`, `updated_at`, `role` (`NULL` or `"replay"`) | `playlists.rs:28`, `library.rs:749` | a new column `expire_days` (`NULL` = kept), schema v8 (`library::migrate_v8`). **Not** a `role`: a non-null role makes a playlist "not hand-made" (`handMade`, playlists-card.ts:46), which would block Rename and Add to Playlist |
| Web playlists made before this change carry no mark | `web.ts` `make` → `playlistCreate(name)` | they are never deleted. A name that ends in "Web" is not proof |
| `play_events.context` is `playlist:<id>` for a song played from a playlist | `library.rs:60`, `home.ts:207` | the last play from a playlist is known at 0 Apple calls |
| `playlist_delete` removes the songs and the folder membership | `playlists.rs:1112` | expiry uses the same delete |
| Apple's API cannot delete a library playlist: an exported copy stays | TOASTS.md §5, the Delete question | 10.3 rule 1 |
| The playlist row's subtitle is "N songs" (`subOf`); the open playlist's meta line is "N songs · 1 h 20 min · Yours · Exported on …" | `playlists-card.ts:423`, `:453` | the expiry date joins both |
| A `contextmenu` handler that calls `preventDefault` stops the app's own field menu | `browser-defaults.ts:40` | right-click on the days button can cycle backwards without a menu |

### 10.2 Decisions (2026-09-17)

| Fork | Decision | Why |
|---|---|---|
| 1. The clock | **B: the later of Make and the last play from the playlist** | a web you still play stays; one you forgot goes |
| 2. What keeps one playlist | **A: only a right-click Keep Playlist** (the playlist row and its header menu) | an edit is not a promise to keep it |
| 3. What you see before | **the row where the song count is: "Expires 9/21/2026"** | the date, not a countdown; it moves forward after a play (fork 1) |
| 4. When it goes | **one toast for all that went at a check, with Undo** — the user may not see it, and that is fine | a notice, not a question |
| 5. A new days choice | **each playlist keeps the days it was made with** | answer 5 was "affects all" while there was a Settings row; with a choice per web (fork 6) nothing is left for "all" to follow, so no playlist is deleted earlier than its row said |
| 6. Where you choose | **in the web panel, not a Settings row**: two buttons under Make playlist, **Keep** and **Temp \| 7 days** | the choice is made per web, where the playlist is made |
| The days button | **a press cycles forward, a right-click cycles backward** | no menu inside the panel; the right-click is a small quality-of-life gesture (user's call) |

### 10.3 Rules that the code decides (not forks)

1. **Export keeps it.** Export to Apple Music clears `expire_days`. The app cannot delete the
   Apple copy, so an expired local playlist would leave behind a copy you did not ask to keep.
2. **Never while it plays.** If the queue plays from the playlist (the current context is
   `playlist:local:<id>`), the delete waits until playback leaves it.
3. **Log.** `diag.log("web:expiry")` on arm (at Make: id, days), on fire (id, name, days, clock),
   on undo, and on keep (id). CLAUDE.md checklist item 6.

### 10.4 The panel: Keep · Temp | N days

Under **Make playlist**, one row of two selectable buttons (the `.web__seg` pressed look):

```
[ Make playlist            ]
[ Keep ] [ Temp | 7 days   ]
```

- **Keep** (left): the web playlist has no expiry.
- **Temp | 7 days** (right): one selectable group of two buttons side by side — "Temp" and the
  days button. A button inside a button is not valid HTML, so the group is a `div` with two
  `button`s that share the pressed look.
  - A press on **Temp** selects it.
  - A press on **7 days** selects Temp too and moves to the next value:
    1 → 3 → 5 → 7 → 30 → 1.
  - A right-click on **7 days** selects Temp and moves to the previous value:
    30 → 7 → 5 → 3 → 1 → 30. Its handler calls `preventDefault` (no field menu).
  - Labels: "1 day", "3 days", "5 days", "7 days", "30 days". The button keeps one width
    (`--web-days-min-w`), so the row does not move as the text changes.
- **Every new web starts on Temp** (user's call 2026-09-17); a press on Keep is for this web only.
  The days are remembered: `webTempDays: 1 | 3 | 5 | 7 | 30` (default **7**) in
  `settings-store.ts`, a spec in `agent-settings.ts` and a line in AGENT.md §6. **No Settings row**.
- **The days half shows only while Temp is picked.** A press on Keep closes it: its width goes to
  nothing while it fades, and Temp becomes a whole button. A press on Temp opens it the same way
  (`--pop-grow`, `--pop-ease`; `[perf] frames menu web-days`; reduced motion: it appears at once).
- It shows and hides with Make playlist, and it slides in with `enterRows` as the other parts do.
- A change never builds again and never calls Apple.

Hover hints (ONBOARDING.md ledger; the days button also goes in the right-click coverage table):
- Keep: "Keeps the playlist until you delete it"
- Temp: "Deletes the playlist 7 days after you last play it. Right-click the playlist to keep it"
  (the number follows the days button)
- Days button: "Press for 30 days, right-click for 5 days" (the next and previous values)

### 10.5 The playlist

- **Subtitle:** a temporary web playlist's row reads "50 songs · Expires 9/21/2026". The open
  playlist's meta line adds "Expires 9/21/2026" at its end. The date is
  `toLocaleDateString()` (numeric, the system's order). Hint on the row is unchanged.
- **Keep Playlist** in the right-click menu of a temporary web playlist's row and in its header
  menu. It clears `expire_days`; the date goes away at once. A kept playlist cannot be made
  temporary again (no item for it).
- The date moves forward after a song plays from the playlist (fork 1). The row reads it again
  when the playlist list refreshes.

### 10.6 The check

At startup (after the playlist store loads) and once an hour while the app runs:

1. Read `local_playlists WHERE role = 'web' AND expire_days IS NOT NULL`, and for each one
   `MAX(play_events.started_ts) WHERE context = 'playlist:local:<id>'`. Local SQL, 0 Apple calls.
2. Clock = the later of `created_at` and that last play. Expiry date = clock + days.
3. For each playlist past its date, and not the context that plays now: keep its row and songs
   in memory, then delete it (`playlist_delete`).
4. One toast (TOASTS.md §5 row): "Deleted 2 expired web playlists" / "Deleted the expired web
   playlist “X Web”", with **Undo**. Undo creates them again with the same name, songs, cover,
   folder and `expire_days`, and a new clock (now), so the next check does not delete them at once.
5. Log each fire and the undo.

### 10.7 Parts (when built)

- Rust: the `expire_days` column; `playlist_create` gains `role` = "web" and `expire_days`;
  `playlist_keep(id)`; `web_expired(now, playing)` → the playlists to delete with their songs;
  export clears the column; the playlist list sends `expire_days` and the clock (for the date).
- `web.ts`: the Keep · Temp row, `make` passes the choice.
- `playlists-card.ts`: the date in `subOf` and the meta line; Keep Playlist in both menus.
- A small timer (in `playlists.ts`) for the hourly check, the toast and Undo.
- Tokens: `--web-days-min-w`.
- Docs: AGENT.md, ONBOARDING.md (hints + right-click table), TOASTS.md, PLAYLISTS.md link,
  SETTINGS.md (the two keys, marked "no row").

### 10.7a As built (2026-09-17)

- Rust: `library::migrate_v8`; `Playlist.expire_days` / `.expires_at` (computed in
  `playlists_cached` with a last-play subquery on `play_events.context = 'playlist:local:<id>'`);
  `playlist_create(…, expire_days)`; `playlist_keep`; `playlists_expire(playing)` deletes and
  returns `ExpiredPlaylist` (name, description, cover, folder, days, song json);
  `playlist_restore(playlist)`; export sets `expire_days = NULL`. Log lines:
  `playlists: expired temporary playlist id=… days=… songs=…`, `playlists: restored expired
  playlist id=… as id=…`, `playlists: kept temporary playlist id=…` (ids only, LOGGING.md).
- `src/playlist-expiry.ts`: the first check a minute after launch (the restored queue's context
  is known by then), then hourly; the toast with Undo. Started in `main.ts`.
- `playlists.ts`: `playlistCreate(name, role?, expireDays?)`, `playlistKeep`, `expiryText`.
- `playlists-card.ts`: "Expires <date>" in the row subtitle and the meta line; Keep Playlist in
  `coverItems` (so both the row menu and the hero cover menu).
- `web.ts`: the `.web__life` row (`showDays` animates the days half); `webTempDays` in
  settings-store + agent-settings.
- Undo makes a new playlist (a new id), so an open view of the old one does not come back by
  itself; the list shows the restored row.

### 10.8 Desk test

Restart the dev runner (a schema migration, v8).
1. Build a web: under Make playlist, **Keep** and **Temp | 7 days** show; Temp is pressed.
   Press "7 days": it reads 30 days, then 1 day. Right-click it: back to 30 days, then 7 days.
   No text menu opens. Hover the days button: "Press for 30 days, right-click for 5 days".
   Press Keep: the days half closes smoothly and Temp is a whole button. Press Temp: it opens
   again. Pick another seed: Temp is pressed again, with the days you last chose.
2. **The name.** Pick a genre chip: the name field reads "<seed> <Genre> Web". Pick a second:
   "A & B". A third: the genres leave the name. Type your own name, press a chip: your name stays.
3. Temp, 7 days, Make playlist. The Playlists list row reads "50 songs · Expires <today + 7>".
   Open it: the meta line ends with the same date. Log: `web:expiry` with `arm`.
4. Play a song from that playlist, then reload the list (open another playlist and come back):
   the date is 7 days from now again.
5. Right-click the row: **Keep Playlist**. The date goes away. Log: `playlists: kept …`.
6. **Expiry, forced.** Make a Temp 1-day web. In the dev database set its clock back:
   `UPDATE local_playlists SET created_at = created_at - 2*86400000 WHERE id = <id>` (and no
   plays from it). Restart; about a minute after launch the toast reads "Deleted the expired web
   playlist “…”" with **Undo**, and the row is gone. Log: `playlists: expired temporary playlist`.
   Press Undo: the row comes back with its songs, cover and folder, and a new date 1 day out.
7. Make a Temp web, play from it, force its date past as in step 6: the check leaves it while it
   plays. Play something else; the next check (restart) deletes it.
8. Export a Temp web to Apple Music: the date goes away (kept).
9. Old web playlists (made before today) show no date and are never deleted.

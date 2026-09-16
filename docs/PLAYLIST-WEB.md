# DeetsMusic — the playlist web

A **web** is a playlist built from one artist and the artists they make songs with. You give
an artist, a reach and optionally a genre. DeetsMusic finds the songs and makes the playlist.

Status: **designed, built and desk-tested 2026-09-16 (§8).** Code: `src/web.ts`
(panel, picking), `src-tauri/src/web.rs` (`web_build`).

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
3. **The panel** — Settings › Playlists › **Close on Make** (`webMakeMotion`):
   - **Shrink to chip** (default, user's call to try it): the panel's edges draw in to the
     artist row (`clip-path` inset, rounded to the row's radius) while its other parts fade
     in the first 60 %. At the end the row's copy lifts from exactly there, and the panel
     goes away at once (`.web--gone`, no pop out). `--web-shrink-dur` 0.32 s,
     `--web-shrink-ease` = `--pop-ease`. Logged as `[perf] frames menu web-shrink`.
   - **Pop out**: the copy lifts and the panel's normal `.pop` close runs at the same time.
4. Motion off (the OS reduced-motion preference only): no shrink, no chip; the panel closes
   and the playlist opens. **Not tied to Animate card swaps** (user's call 2026-09-16): no card
   changes place here — `handOff(…, ownMotion = true)`.

## 3. Decisions (2026-09-16)

| Fork | Decision | Why |
|---|---|---|
| Where it lives | **in the app**, its own header button | the panel needs pills and chips; the + menu holds fields and rows only |
| Reach | **a setting, 1–3 degrees** (Settings › Playlists › Web reach, default 2) | how far out is a taste call |
| Filter | **genre tags** (Apple `genreNames`), no model judgment | the app has no Claude; tags are what he wanted |
| What a chip filters | **everything, the artist's songs too** (Settings › Playlists › Genres for Webbing: **All songs** / Keep 5 / Web only) | first decided "web only"; changed the same day after the data: Samara Cyn's songs are 37 Hip-Hop/Rap, 6 R&B/Soul of 42, so an R&B/Soul pick kept ~25 rap songs next to 25 R&B songs — a clash. Apple tags a song with its album's genre, so filtering leaves few of the artist's songs; the status line says how many ("· 6 by Samara Cyn") |
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
6-. Pick R&B/Soul with "Genres for Webbing" on All songs: the status line adds "· N by
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

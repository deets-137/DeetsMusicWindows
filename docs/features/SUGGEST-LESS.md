---
status: designed
desk_test: none
sources: [src-tauri/src/favorites.rs, src-tauri/src/apple.rs, src-tauri/src/web.rs, src/player.ts, src/queue-sync.ts, src/favorites.ts, src/media-menu.ts, src/compass.ts, src/web.ts]
updated: 2026-10-12
---
# DeetsMusic — Suggest Less and proactive skips

Designed 2026-09-17. Checked against the code and changed 2026-10-12 (§0a). Every fork is
closed (§11, 2026-10-12). **Not built.** The station timing is measured when we build (§8).

## 0. Terms

- **Suggest Less** — Apple's name for a song rating of −1. The API calls it "dislike".
- **Our list** — the local table of Suggest Less marks (§3). It holds Apple's −1 songs and
  the marks you make in DeetsMusic.
- **Artist mark / album mark** — a Suggest Less on a whole artist or album. Local only:
  the Apple API has no artist ratings, and the web builds from songs.
- **Proactive skip** — the player steps over a marked song that comes up on its own.
- **Comes up on its own** — reached by the end of the song before it, by Next, or by a
  station. A song you click, Play Now, or a Queue card row you click is a **pick**, and a
  pick always plays.

## 0a. What changed since 2026-09-17

The code moved under this design for four weeks. The changes, checked 2026-10-12:

| Area | Then | Now | Effect on this design |
|---|---|---|---|
| Right-click menus | Items on five cards, by hand | One builder, `songMenu` / `albumMenu` / `artistMenu` in [media-menu.ts](../../src/media-menu.ts) ([CONTEXT-MENUS.md](../architecture/CONTEXT-MENUS.md) §7) | The items are added once, in the builder (§4) |
| The queue | MusicKit owned transport in a window | The Queue card is the master (2026-09-24). `expectedIds` in [queue-sync.ts](../../src/queue-sync.ts) builds MusicKit's window, and already leaves out a row with no playable id | A marked row is left out the same way (§5a). The build risk is smaller |
| Silence on a station skip | A new "skip gain" factor times the sleep `duck` | `resumeHush` in [player.ts](../../src/player.ts) (2026-09-27) sets MusicKit's gain to 0, with a cap timer | Use the hush (§5b). A factor next to `duck` fails with AirPlay: with a speaker, `music.volume` is held at 1 and the duck goes to the speaker over the network, so the skipped song plays on the HomePod |
| Rules | No engine | The rules engine (2026-09-26). RULEZ.md §3 route 6 lists *Mark Suggest Less* as an action that waits for this feature | The mark is an action the engine can call (§4) |
| Settings | Settings › Playback | Settings › Playback still holds the playback rows | No change |
| Compass | — | `dislike` is an alias of **favorite** ([compass.ts](../../src/compass.ts) `favoriteRow`, COMPASS-TERMS.md §5–6) | A conflict (§9a) |
| Apple's recent plays | — | Home reads `me/recent/played/tracks` (`recent_played_tracks` in [apple.rs](../../src-tauri/src/apple.rs)): your plays on every device, the phone too | A cheap way to see a fresh −1 (§3a) |
| Schema | v10 era | v18 or later | The table takes the next free version at build time |

## 1. What Apple gives us (checked against the code, 2026-10-12)

| Question | Answer |
|---|---|
| A call that lists all −1 songs? | **No.** For ♥ Apple has the generated Favorite Songs playlist ([NEXT-VERSION.md §3](../NEXT-VERSION.md)); for −1 there is nothing like it. |
| Read a rating | `GET /v1/me/ratings/songs?ids=…`, 100 ids per call. The reply carries `attributes.value` 1 or −1; an id with no rating is left out (404 when none has one). |
| We already make that call | `favorites_reconcile` ([favorites.rs](../../src-tauri/src/favorites.rs)) reads the value and keeps only `1`. **A −1 falls into `unloved` today.** Keeping it costs 0 calls. |
| Who calls it today | Search hits and playlist rows (`reconcile` in [favorites.ts](../../src/favorites.ts)). **Library songs are never asked.** |
| How often an id is asked | **Once per install.** Every asked id gets a `favorites` row, and an id with a row is not asked again. A −1 set on the phone after that is not seen (§3a's R1 fixes this for your recent plays). |
| Write a rating | `PUT /v1/me/ratings/songs/{id}` value `-1`; `DELETE` clears it. The ♥ uses the same route. |
| One rating per song | A −1 replaces a ♥, and a ♥ replaces a −1. |
| Artist ratings | Not in the API. |
| Live station skip | Not possible. Live stations have no skip ([player.ts](../../src/player.ts) `station.live`). |

This reverses one line of the 2026-07-02 decision in [FAVORITES.md](FAVORITES.md) §Dropped
(no 👎). The thumbs loop for Stations stays dropped. Suggest Less is a filter, not a
recommendation signal.

## 2. Decisions

| Fork | Decision |
|---|---|
| Where Apple's −1s come from | **1B** (2026-09-17) — the reads we already make, plus a check of each web's candidate songs (§4). **Plus R1** (2026-10-12): re-ask the songs Home's recent-plays read returns (§3a). Only R1. |
| Your Suggest Less | **2B** (2026-09-17) — stored in our list, and sent to Apple as −1 behind the **Add to Library and ♥** consent. With that toggle off, the mark stays local. |
| Artist and album marks | **In the first build** (2026-10-12). Menu items only (no automatic "3 songs by one artist" rule) (2026-09-17). The items are **always shown**; the old *Dislike Artists and Albums* row is dropped (2026-10-12). |
| Album marks | **Yes**, the same row as artists (2026-09-17) |
| Where the marks act | **Three plain toggles** (2026-10-12), each its own row: stations, webs, queues (§4). This replaces the single *Proactive skips* row and the 2026-09-17 rule that the web always drops marks. |
| Webs | A web drops marked songs **at the time it is made**. A web made before a mark is not changed (2026-10-12). |
| Home | **Hide only.** A hide is never a Suggest Less ([HOME.md](HOME.md) §Hide). The Suggest Less items are left out of Home's menus. (2026-09-17) |
| What you see on a skip | **A toast with Undo, and a greyed row in the Queue card** (§6) (2026-09-17) |
| Stations | **Skip as the song starts** (2026-09-17), silenced by the hush (§5b, changed 2026-10-12 from a gain factor). Off by default. **Every mark kind acts** (song, album, artist) (2026-10-12). |
| Compass | A **suggest less** command; `dislike` moves to it from favorite. The words **toggle**, like favorite: on a marked item the row offers Undo (§9a, 2026-10-12). |
| Build order | **Three parts** (§10, 2026-10-12) |

## 3. Data

A new table `suggest_less`:

| Column | Meaning |
|---|---|
| `kind` | `song` / `artist` / `album` |
| `key` | song: catalog id. artist: the artist's catalog id when known, else the folded name. album: the catalog album id when known, else `folded album name + "\|" + folded artist name` |
| `name`, `artist` | text for Settings and the match by name (§5c) |
| `source` | `apple` (read from Apple) / `local` (marked here) |
| `synced` | for a `local` song: 1 once Apple has the −1, 0 while the consent is off or the write failed |
| `at` | when the mark was made or read |

Rules:
- `favorites_reconcile` writes a `song` row with `source = apple` for every −1. For an
  asked id with no −1, it deletes an `apple` row (the mark was cleared on the phone). It
  never deletes a `local` row.
- The Favorite Songs seed deletes the `song` row of every loved song (a ♥ on the phone
  replaces the −1).
- A ♥ in DeetsMusic on a marked song deletes its row. A Suggest Less on a loved song sets
  `favorites.loved = 0`.
- Turning **Add to Library and ♥** on sends the −1 for every `local` song row with
  `synced = 0`, once, in the existing write-through path.
- Re-asking (§3a) needs the time each id was last asked. `favorites.synced_at` already holds
  the time of the last write to the row. The build checks that every write path sets it,
  and uses it as "asked at". No new column if it holds.

### 3a. Reading −1s more often (his pick: **R1 only**, 2026-10-12)

Apple has no list of −1 songs, so we only see a −1 on an id we ask about. Today each id is
asked once. These were the ways to ask again, cheapest first. Each one is one
`ratings/songs?ids=` call per 100 ids, a background job (APPLE-CALLS.md §3), and it stops
while Apple's back-off holds. **Only R1 goes in the build**; the table keeps R2–R6 as the
options weighed.

**R1 in the build:** after `recent_played_tracks` returns, its catalog ids go to
`favorites_reconcile` with a re-ask flag: every id is asked, also one with a `favorites`
row. One call per Home read (up to 90 ids). A −1 adds an `apple` row; no −1 deletes an
`apple` row (§3 rules). A ♥ seen this way updates `favorites` too, so the ♥ state of your
phone plays gets fresher as a side effect.

| # | When | Which ids | Calls | What it catches |
|---|---|---|---|---|
| R1 | Right after Home reads `recent/played/tracks` | The songs Apple says you played last, on **any device** (up to 90) | +1 per Home read | **The main case.** You hear a song on the phone and press Suggest Less there. The song is in this list on the next Home read. |
| R2 | When a queue starts, or Up Next grows by 20 or more | The next 100 upcoming songs not asked in the last 7 days | ≤ 1 per queue start | A −1 on a song that is about to play. Only useful with the queue toggle on. |
| R3 | Once a day | Songs heard in DeetsMusic in the last 14 days (`play_events`), not asked in 7 days | ~1 a day | A −1 set on the phone on a song you heard here |
| R4 | Once a day | The 100 ids asked longest ago | 1 a day | Everything, slowly: 3,900 songs is a lap of about 39 days |
| R5 | A web build | Candidates asked more than 30 days ago (like `web_names`) | ≤ 2 per build | The web, which was §9's open item |
| R6 | A **Check Apple now** button in the Settings section (and a Compass verb) | R1 + R2 + R3 at once | 2–4 per press | "I just did it on my phone." The user decides when. |

Not possible: a station's coming songs (MusicKit owns them, §5b), so a station song is asked
only after it played (R1 or R3). Asking each station song as it starts is 1 call a song,
about 15 an hour. Rejected on cost.

## 4. Controls

**Menu items.** In the builder in [media-menu.ts](../../src/media-menu.ts), so every card that
uses it gets them: `songMenu` next to Favorite, `albumMenu`, `artistMenu`. Home's menus
(`tileMenu`) leave them out (§2).
- **Suggest Less** / **Undo Suggest Less** (the label follows the state, like Favorite).
- **Suggest Less of This Artist** and **Suggest Less of This Album**, with their Undo labels.
  On a song row they sit in the song's menu. The artist view and the album view headers use
  `artistMenu` / `albumMenu`. Always shown (his call, 2026-10-12).

Write-through: optimistic mark, `PUT -1` (or `DELETE` on Undo) when the consent is on, roll
back and warn on failure. This is the same as `toggleLoved` in [favorites.ts](../../src/favorites.ts).

**A rule action.** *Mark Suggest Less* (RULEZ.md §3, route 6) calls the same mark function.
It is an Apple write with the consent on, so it takes `cost: "apple"` and the §1.5 gate.

**Settings › Playback — three toggles** (his call, 2026-10-12):

| Row | Key | Default | Hover hint |
|---|---|---|---|
| **Skip on stations** | `suggestSkipStations` | **off** | "Skips a station song you marked Suggest Less, or one by an artist or from an album you marked" |
| **Leave out of webs** | `suggestSkipWebs` | **on** | "Leaves songs, artists and albums you marked Suggest Less out of a new web" |
| **Skip in queues** | `suggestSkipQueue` | **off** | "Skips songs, artists and albums you marked Suggest Less when they come up in a playlist, an album or Up Next" |

Defaults (his calls, 2026-10-12): a mark you made reads as "keep it out of new webs", so
webs are on; a skip you did not expect reads as a bug, so queues and stations are off.

- Each row acts alone. With all three off, the marks are kept and only the menus and
  Apple's −1 change.
- The key names are working names; the row labels follow the settings label style
  (verb first, short).
- Each key gets a default with the "why" in `settings-store.ts`, an `agent-settings.ts` spec
  (not a consent gate, so the agent may turn them on), an AGENT.md line, and a `NEW_MARKS`
  line.
- They are plain toggles, not rule keys (his call, 2026-10-12). Rulez can still turn a
  setting on or off as it can any setting.
- The Settings section's status line says how many marks there are ("12 songs, 2 artists,
  1 album") with a **Clear** button (Undo toast, like Settings › Reset).

**The web — Apple check (1B).** Before `pickSongs` ([web.ts](../../src/web.ts)), the candidate
songs with no row in `favorites` go to `favorites_reconcile`, at most 2 × Web size of them,
nearest degree first. That is 1 call per 100 new songs, and 0 on a second build (every asked
id keeps its mirror row). Then, with **Leave out of webs** on, `web_build`
([web.rs](../../src-tauri/src/web.rs)) drops every song that matches a mark (§5c), before the
genre chips and the cap. The Apple check runs with the toggle off too: it is how Apple's −1s
reach our list.

## 5. Proactive skips

### 5a. A queue (a playlist, an album, Up Next) — **Skip in queues**

The Queue card is the master ([QUEUE.md](QUEUE.md) §The model is the master), and
`reconcileUpcoming` in [player.ts](../../src/player.ts) feeds MusicKit the window that
`expectedIds` ([queue-sync.ts](../../src/queue-sync.ts)) builds. A marked song is stepped over
**before MusicKit gets it**, so no sound plays.
- The row stays in `upcoming`, greyed (§6). `expectedIds` already leaves out an entry whose
  `idOf` is null. A marked entry is left out the same way, and `advance` steps past it.
- **Build risk:** `checkAlignment` and the desync canary compare the model index with
  MusicKit's index. They must count the left-out rows, or every skip reads as a
  misalignment. The rule goes in `queue-sync.ts` with a unit test.
- A pick plays: clicking the greyed row, or starting a list from a marked song, plays it.
- Repeat one on a picked marked song keeps playing it.

### 5b. An Apple station — **Skip on stations**

MusicKit owns the station's future ([STATIONS.md](STATIONS.md) §1). The app sees a song only
on `nowPlayingItemDidChange` (`stationFollow`). On a match:
1. Turn the hush on (`hushForResume`'s mechanism in player.ts; the build gives it a second
   reason, so a skip and a network resume do not clear each other). It sets MusicKit's gain
   to 0, with a speaker too, and a cap timer turns it off whatever fails.
2. Call `skipToNextItem`.
3. Turn the hush off on the next `nowPlayingItemDidChange` that does not match.

Why little or no sound should play: at `nowPlayingItemDidChange` MusicKit has not loaded the
new song's audio yet. It still needs the asset lookup (110–300 ms), the license (135–290 ms)
and 500–800 ms of buffering ([UX-COVERUPS.md](../architecture/UX-COVERUPS.md) §5). The hush
covers the case where the order is different on a station. What you hear is about 1–2 s of
silence while the next station song loads. **Not measured on a station yet** (§8).

- The skipped song does not go to History, `play_stats`, `play_events` or Last.fm, and the
  web's `mine` does not see it. `stationFollow` checks the match before it ingests.
- A live station is never skipped, and it shows no toast.
- **Skip limit:** Apple may limit skips on a station. Not known. Desk test step 6.
- Every mark kind acts on a station: song, album and artist (his call, 2026-10-12).

### 5c. The match

In this order, and it stops at the first hit:
1. **Song** — catalog id (queue rows also try `libraryId` → catalog id).
2. **Album** — catalog album id; for a station song (album name only), the folded album
   name plus the folded artist name.
3. **Artist** — the artist id when the track has one; else the folded artist name, and also
   each name in the "feat." part (the web's parser in `web.rs`). Two artists with the same
   name both match. This limit is accepted.

"Folded" = lower case, accents removed (NFD), spaces collapsed. No shared fold function exists
yet; the build adds one in Rust and uses it for both the web and the player's match.

## 6. What you see

**A toast** (info, timed): *Skipped “Song” — Suggest Less.* **[Undo]**
- Several skips in one chain make one toast: *Skipped 3 songs — Suggest Less.* **[Undo]**
- **Undo** plays the (first) skipped song now, as a pick. In a queue: `jumpTo` that row.
  On a station: a break-out with that song, and the station resumes after it
  (`queueStationAfter` path). Undo does not remove the mark.
- A toast with Undo shows under every tier ([TOASTS.md](../architecture/TOASTS.md) §4). New row in §5.
- A failed write: warn, *Couldn't update Suggest Less for “Song”.* New row in §5.

**The Queue card:**
- A marked row in Up Next is greyed. Its hover hint: "Suggest Less — skipped. Click to play it
  anyway".
- A station song skipped on arrival shows once in the heard trail, greyed, with the same hint
  minus the click part.
- Greyed = an existing dim text role in `themes.css`, found by grep at build time. No new color.
- Both hints go in the ONBOARDING.md ledger.

## 7. Build checklist (CLAUDE.md › Working style)

1. **Motion:** the greyed state fades in with the row's existing transition. The toast is the
   primitive's.
2. **Tokens:** the grey is a theme role; no hardcoded opacity.
3. **Hints:** the three Settings hints, the two Queue card hints, the menu items → ONBOARDING.md.
4. **Toasts:** two rows in TOASTS.md §5.
5. **Settings keys:** the three keys → default + why, agent spec, AGENT.md, `NEW_MARKS`.
6. **Log lines:** `suggest:arm` / `suggest:off` (row changes), `suggest:skip {where: queue|station,
   match: song|album|artist, id}`, `suggest:mark {kind, source, synced}`, `suggest:ask {why: R1…R6, ids}`.
7. **Telemetry (dev only):** `[perf] suggest station {npMs, audibleMs, skipMs, silentMs}` per
   station skip: `nowPlayingItemDidChange` → our skip call → the next song's `audible`.
8. **Right-click:** the items go in `media-menu.ts`, never on a card by hand (item 11).
9. **Rules:** the *Mark Suggest Less* action registers with the engine (RULES.md §19).
10. **Compass:** the mark verb and §9a's synonym change; COMPASS-TERMS.md with `SYNONYMS`.
11. **Check:** `npm run check` (tsc, tests, docs:check, cargo check, cargo test), `npx vite build`.

## 8. Desk test

1. Mark a song Suggest Less with **Add to Library and ♥** on. Check its rating in Apple Music
   on the phone.
2. Mark a song on the phone. Build a web that holds it, with **Leave out of webs** on. The
   song is not in the web, and the log shows the ratings call.
3. **Skip in queues** off: play a playlist with a marked song. It plays.
4. On: play it again. The row is greyed, the song is stepped over, the toast shows, Undo plays it.
5. **Station timing:** turn **Skip on stations** on. On a non-live station, mark the playing
   song's artist. Drive 5 advances with the MCP (`control seek 97`). Read the
   `[perf] suggest station` lines: `skipMs − npMs` is how early the check runs, and
   `audibleMs` tells whether any sound played.
6. **Skip limit:** mark an artist the station plays often and let it skip 10 times. Read the log
   for a refused skip.
7. A live station (Apple Music 1): nothing is skipped.
8. ♥ a marked song: the mark goes. Suggest Less a loved song: the ♥ goes.
9. Sleep timer wind-down during a station skip: the volume comes back to the wind-down level,
   not to full.
10. **AirPlay:** play a station on a HomePod and repeat step 5. No sound of the skipped song
    comes from the speaker.
11. **Fresh −1 (R1):** play a song on the phone, Suggest Less it there, refresh Home. The log
    shows `suggest:ask {why: R1}` and the song is in our list. Clear it on the phone, refresh
    Home: the mark goes.
12. **Compass toggles:** `suggest less` (no name) marks the playing song; again shows *Undo
    Suggest Less*. `dislike` does the same. `favorite` on a marked song offers Favorite, and
    Enter takes the mark off (§3 rules).

## 9. Not in this build

- An agent tool to mark songs (the settings rows are reachable).
- Albums and playlists as Apple ratings (the API has them; the web does not need them).

### 9a. The Compass word "dislike"

Today `dislike` is an alias of the **favorite** command. `dislike Song` on a song that is not
loved shows the row *Favorite “Song” · ♥ on Apple Music too*, and Enter loves it. The row's
title says Favorite, so nothing happens unseen, but the word means the opposite of what it
does. With Suggest Less built, "dislike" is the word a user types for it.

**The fix (his call, 2026-10-12):** a new **suggest less** command. Aliases: `dislike`,
`less`, `thumbs down`. `dislike` leaves the favorite command and the `SYNONYMS` table entry
`dislike → favorite`. `unfavorite` and `unlove` stay on favorite.

**The words toggle** (his call: "words should behave like toggles"), the way `favorite`
already does:

| Typed | The item is not marked | The item is marked |
|---|---|---|
| `suggest less [song]` / `dislike [song]` | *Suggest Less “Song”* | *Undo Suggest Less “Song”* |
| `suggest less artist <name>` | *Suggest Less of “Artist”* | *Undo Suggest Less of “Artist”* |
| `suggest less album <name>` | *Suggest Less of “Album”* | *Undo Suggest Less of “Album”* |

- With no name, the row acts on the playing song, like `favorite`. The name is looked for
  in the same places (`songFor` over `nearbySongs`).
- The song mark is an Apple write with the consent on. With **Add to Library and ♥** off,
  the row still works and the mark stays local (§2, 2B). It does not open the gate setting,
  as `favorite` does, because the mark does not need Apple.
- The row's second line says what happens: "Leaves it out of new webs" (with that row on),
  "· −1 on Apple Music too" (with the consent on).
- COMPASS.md §2 and COMPASS-TERMS.md §5–6 change with `SYNONYMS` in the same commit.

## 10. Build order (his call: three parts, 2026-10-12)

1. **Marks:** the table, the menu items (songs, artists, albums), Apple's −1 read and write,
   R1 (§3a), **Leave out of webs**, the Settings count and Clear, the rule action, the
   Compass command. No skips. Low risk; desk test steps 1, 2, 8, 11, 12.
2. **Skip in queues:** the toggle, the greyed row, the toast, the `queue-sync.ts` rule and its
   test. Desk test steps 3, 4.
3. **Skip on stations:** the hush, the telemetry, the measurement. Desk test steps 5–7, 9, 10.

## 11. Forks (all closed 2026-10-12)

| # | Fork | His call |
|---|---|---|
| F1 | Defaults of **Leave out of webs** and **Skip in queues** | Webs on, queues off |
| F2 | The artist and album menu items | Always shown; the *Dislike Artists and Albums* row is dropped |
| F3 | Which marks **Skip on stations** acts on | All marks (song, album, artist) |
| F4 | The Compass word | A new **suggest less** command takes `dislike`; the words toggle (§9a) |
| F5 | Build order | Three parts (§10) |
| F6 | Fresher −1s (§3a) | R1 only |

A closed fork is not a go: the build starts when he says so.

---
status: designed
desk_test: none
sources: [src-tauri/src/favorites.rs, src/player.ts, src/favorites.ts, src/queue.ts]
updated: 2026-09-17
---
# DeetsMusic — Suggest Less and proactive skips

Designed 2026-09-17. **Not built.** The station timing is measured when we build (§8).

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

## 1. What Apple gives us (checked against the code)

| Question | Answer |
|---|---|
| A call that lists all −1 songs? | **No.** For ♥ Apple has the generated Favorite Songs playlist ([NEXT-VERSION.md §3](../NEXT-VERSION.md)); for −1 there is nothing like it. |
| Read a rating | `GET /v1/me/ratings/songs?ids=…`, 100 ids per call. The reply carries `attributes.value` 1 or −1; an id with no rating is left out (404 when none has one). |
| We already make that call | `favorites_reconcile` ([favorites.rs](../../src-tauri/src/favorites.rs)) reads the value and keeps only `1`. **A −1 falls into `unloved` today.** Keeping it costs 0 calls. |
| Write a rating | `PUT /v1/me/ratings/songs/{id}` value `-1`; `DELETE` clears it. The ♥ uses the same route. |
| One rating per song | A −1 replaces a ♥, and a ♥ replaces a −1. |
| Artist ratings | Not in the API. |
| Live station skip | Not possible. Live stations have no skip ([player.ts](../../src/player.ts) `station.live`). |

This reverses one line of the 2026-07-02 decision in [FAVORITES.md](FAVORITES.md) §Dropped
(no 👎). The thumbs loop for Stations stays dropped. Suggest Less is a filter, not a
recommendation signal.

## 2. Decisions (2026-09-17)

| Fork | Decision |
|---|---|
| Where Apple's −1s come from | **1B** — the reads we already make, plus a check of each web's candidate songs (§4) |
| Your Suggest Less | **2B** — stored in our list, and sent to Apple as −1 behind the **Add to Library and ♥** consent. With that toggle off, the mark stays local. |
| The web and a marked song | **Drop it** |
| Artist and album marks | **Menu items only** (no automatic "3 songs by one artist" rule), shown only when **Dislike Artists and Albums** is on |
| Album marks | **Yes**, the same row as artists |
| Home | **Hide only.** A hide is never a Suggest Less ([HOME.md](HOME.md) §Hide). The Suggest Less items are left out of Home's menus. |
| What you see on a skip | **A toast with Undo, and a greyed row in the Queue card** (§6) |
| Stations | **Skip as the song starts**, with the gain safety net (§5b) |

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

## 4. Controls

**Menu items.** On song rows in Library, Search, Queue, Playlists and History, and on Now
Playing's menu, next to Favorite:
- **Suggest Less** / **Undo Suggest Less** (the label follows the state, like Favorite).
- With **Dislike Artists and Albums** on: **Suggest Less of This Artist** and **Suggest Less
  of This Album**, with their Undo labels. Also on the Library artist view and album view
  headers.

Write-through: optimistic mark, `PUT -1` (or `DELETE` on Undo) when the consent is on, roll
back and warn on failure. This is the same as `toggleLoved` in [favorites.ts](../../src/favorites.ts).

**Settings › Playback — two rows:**

| Row | Kind | Default | Hover hint |
|---|---|---|---|
| **Proactive skips** | toggle | **off** | "Skips songs you marked Suggest Less when they come up in the queue or on a station (and artists and albums, when that row is on)" |
| **Dislike Artists and Albums** | toggle | **off** | "Adds Suggest Less of This Artist and of This Album to the right-click menus" |

- **Proactive skips** is the key. With it off, nothing is skipped. The marks still feed
  the web.
- **Dislike Artists and Albums** shows the menu items, and lets artist and album marks take
  part in skips and in the web. With it off, existing artist and album marks are kept but
  ignored.
- Keys: `proactiveSkips`, `dislikeGroups` in `settings-store.ts`. Both default off: a skip the
  user did not ask for reads as a bug. Each gets an `agent-settings.ts` spec (not a consent gate,
  so the agent may turn them on) and an AGENT.md line.
- The Settings section's status line says how many marks there are ("12 songs, 2 artists,
  1 album") with a **Clear** button (Undo toast, like Settings › Reset).

**The web — Apple check (1B).** Before `pickSongs`, the candidate songs with no row in
`favorites` go to `favorites_reconcile`, at most 2 × Web size of them, nearest degree
first. That is 1 call per 100 new songs, and 0 on a second build (every asked id keeps its
mirror row). Then `web_build` drops every song that matches a mark (§5c), before the genre
chips and the cap.

## 5. Proactive skips

### 5a. A queue (a playlist, an album, Up Next)

The app owns `upcoming` ([queue.ts](../../src/queue.ts)) and feeds MusicKit a window of it. A
marked song is stepped over **before MusicKit gets it**, so no sound plays.
- The row stays in `upcoming`, greyed (§6). The window builder leaves it out of what goes to
  MusicKit, and `advance` steps past it.
- **Build risk:** the alignment canaries (`checkAlignment`, `checkDesync`) compare the model
  index with MusicKit's index. They must count the left-out rows, or every skip reads as a
  misalignment. Read QUEUE.md §window before the build.
- A pick plays: clicking the greyed row, or starting a list from a marked song, plays it.
- Repeat one on a picked marked song keeps playing it.

### 5b. An Apple station

MusicKit owns the station's future ([STATIONS.md](STATIONS.md) §1). The app sees a song only
on `nowPlayingItemDidChange` (`stationFollow`). On a match:
1. Set the **skip gain** to 0. This is its own factor, multiplied with the sleep timer's
   `duck` in the volume path, so neither feature undoes the other.
2. Call `skipToNextItem`.
3. Set the skip gain back to 1 on the next `nowPlayingItemDidChange` that does not match.
   A timeout of 10 s also sets it back, so a failed skip never leaves the app silent.

Why little or no sound should play: at `nowPlayingItemDidChange` MusicKit has not loaded the
new song's audio yet. It still needs the asset lookup (110–300 ms), the license (135–290 ms)
and 500–800 ms of buffering ([UX-COVERUPS.md](../architecture/UX-COVERUPS.md) §5). The skip gain covers the
case where the order is different on a station. What you hear is about 1–2 s of silence while
the next station song loads. **Not measured on a station yet** (§8).

- The skipped song does not go to History, `play_stats`, `play_events` or Last.fm, and the
  web's `mine` does not see it. `stationFollow` checks the match before it ingests.
- A live station is never skipped, and it shows no toast.
- **Skip limit:** Apple may limit skips on a station. Not known. Desk test step 6.

### 5c. The match

In this order, and it stops at the first hit:
1. **Song** — catalog id (queue rows also try `libraryId` → catalog id).
2. **Album** (with the row on) — catalog album id; for a station song (album name only),
   the folded album name plus the folded artist name.
3. **Artist** (with the row on) — the artist id when the track has one; else the folded
   artist name, and also each name in the "feat." part (the web's parser in `web.rs`).
   Two artists with the same name both match. This limit is accepted.

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
3. **Hints:** the two Settings hints, the two Queue card hints, the menu items → ONBOARDING.md.
4. **Toasts:** two rows in TOASTS.md §5.
5. **Settings keys:** `proactiveSkips`, `dislikeGroups` → default + why, agent spec, AGENT.md.
6. **Log lines:** `suggest:arm` / `suggest:off` (row changes), `suggest:skip {where: queue|station,
   match: song|album|artist, id}`, `suggest:mark {kind, source, synced}`.
7. **Telemetry (dev only):** `[perf] suggest station {npMs, audibleMs, skipMs, silentMs}` per
   station skip: `nowPlayingItemDidChange` → our skip call → the next song's `audible`.
8. **Check:** `npx tsc --noEmit`, `npx vite build`, `cargo check`.

## 8. Desk test

1. Mark a song Suggest Less with **Add to Library and ♥** on. Check its rating in Apple Music
   on the phone.
2. Mark a song on the phone. Build a web that holds it. The song is not in the web, and the
   log shows the ratings call.
3. **Proactive skips** off: play a playlist with a marked song. It plays.
4. On: play it again. The row is greyed, the song is stepped over, the toast shows, Undo plays it.
5. **Station timing:** on a non-live station, mark the playing song's artist (row on). Drive 5
   advances with the MCP (`control seek 97`). Read the `[perf] suggest station` lines:
   `skipMs − npMs` is how early the check runs, and `audibleMs` tells whether any sound played.
6. **Skip limit:** mark an artist the station plays often and let it skip 10 times. Read the log
   for a refused skip.
7. A live station (Apple Music 1): nothing is skipped.
8. ♥ a marked song: the mark goes. Suggest Less a loved song: the ♥ goes.
9. Sleep timer wind-down during a station skip: the volume comes back to the wind-down level,
   not to full.

## 9. Not in this build

- An agent tool to mark songs (the settings rows are reachable).
- Re-asking Apple about an id already in the mirror. A −1 set on the phone for a song we
  asked about before is not seen. Open: re-ask web candidates older than 30 days, like
  `web_names`.
- Albums and playlists as Apple ratings (the API has them; the web does not need them).

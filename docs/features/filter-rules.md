---
status: built
desk_test: passed 2026-10-17
sources: [src/filter-eval.ts, src/filters.ts, src/filter-panel.ts, src/cond-editor.ts, src/rules-eval.ts, src/rulez-words.ts, src/rulez-card.ts, src/library-card.ts, src/collection-card.ts, src/playlists-card.ts, src/compass.ts, src/suggest.ts, src/rewind.ts, src/playlist-refresh.ts, src-tauri/src/filter.rs, src-tauri/src/playlists.rs, src-tauri/src/query.rs, tests/filter-eval.test.ts]
updated: 2026-10-17
---
# Filter rules — a rule that picks songs

> **Part:** built · 2026-10-16 · committed (3a9d3bf), desk test passed 2026-10-17 (§14.4, his). §14 is the as-built
> record: where it differs from §1–§13, §14 is the code. The playlist page's own place for
> the rule (§13.3) is not built: his call, left for a design pass.
>
> An idea (2026-10-16), built the same day. His ask: use a rule over the whole library. A user filters
> the library in more complex ways, saves custom filters, and makes playlists from a rule and a
> set of sources (the library, other playlists, Rewind, Songs of the Day, and more). The
> playlist refreshes by itself at the interval the user picks. Every fork is his (§11). His
> calls of 2026-10-16 are §13: the name is **Rulez Playlist**; F4 is Keep and Never; F3: Live is added behind the guards and the gate of §13.1a–b.

## 0. Terms

- **Rule** (today): an app-level rule in the engine ([RULES.md](../architecture/RULES.md)). It
  asks one question about the app NOW ("is the surface Max?", "is the song playing now
  loved?") and acts or sets values.
- **Filter rule**: a condition that the app asks about EACH song in a pool. A song passes or it
  does not. It has no event and no action.
- **Song fact**: a value of one song that a filter rule reads (its genre, its play count, its
  Diary score). Today's facts are app facts: one value for the whole app.
- **Pool**: the songs a filter rule looks at. It is the union of one or more sources.
- **Source**: a set of songs the app already holds: the library, a playlist, a Rewind window,
  the Song of the Day picks, the Diary, the loved songs, and so on (§5).
- **Filter**: a saved filter rule over the library, shown in the Library card as a view.
- **Rule playlist**: a playlist whose songs come from a pool, a filter rule, an order and a
  limit. The app makes its song list again at the interval the user picks. (The name is a fork,
  §11 F1.)

## 1. The idea in one picture

```
 sources ──► pool ──► filter rule ──► order + limit ──► output
 Library     union    "genre is Jazz    "most played     a Library view (Filter)
 Playlist X  (no      AND plays ≥ 5     first, 50        or a playlist (Rule playlist)
 Rewind: week dupes)  AND NOT loved"    songs"
 SOTD picks
```

Examples a user can make:
- "Jazz I played 5 times or more and never loved" (the library, a filter).
- "My top 50 of the last month that are not in any playlist" (Rewind month, a rule playlist).
- "Every Song of the Day pick with a Diary score of 8 or more" (SOTD + the Diary).
- "Songs from Road Trip and Summer that are shorter than 4 minutes, at most 2 per artist".
- "Rare songs: under 10,000 Last.fm listeners" (the cached counts only, §4).

## 2. What exists today (checked against the code)

The engine already holds most of the parts. The new part is the loop over songs and the song
facts.

| Part | Where | What it gives |
|---|---|---|
| The condition shape | `rules-eval.ts:49` `Leaf`, `Cond` | all / any / not, and leaves with `is`, `isNot`, `lt`, `gt`, `gte`, `lte`. A list value (genres) matches when any member matches. |
| The evaluator | `rules-eval.ts:267` `evalCond(c, facts)` | **Pure.** It takes a plain facts record, so it can run once per song with that song's facts. Covered by `npm test`. |
| Depth | `rules-eval.ts:159` `COND_DEPTH = 16` | The code allows 16 levels. RULES.md §4 still says one level of groups: the doc is out of date on this point. |
| Song facts, for the song playing now | `rules-facts.ts:51–96` | `loved`, `diaryScore`, `plays`. Their words are in `rulez-words.ts:141` (section "The song"). |
| The condition editor | `rulez-blocks.ts`, the Rulez card | The blocks that make a condition from words (RULEZ.md §6.4). |
| A filter on the library | `library-card.ts:617` | The ♥ pill: "Favorites only" narrows the source list. It is one fixed filter. |
| An interval | `playlist-refresh.ts:123` `isDue`, table `playlist_refresh` | Daily · Weekly on a day · Off, the hourly day-change check, the check on window show (PLAYLIST-REFRESH.md §4). |
| Read-only SQL | `query.rs` | The export tables `songs`, `playlists`, `playlist_songs`, `plays`, `play_counts` ([LOCAL-DATA.md](../integrations/LOCAL-DATA.md) §4). The idea of a SQL card is LOCAL-DATA.md §12. |
| Apple's own smart playlists | `playlists.rs:862` | The mirror shows them (kind `smart`). Apple's API cannot make one. A rule playlist is ours and local. |

## 3. The shape

```ts
type FilterRule = {
  id: string;
  name: string;
  sources: Source[];            // §5; the pool is their union, one row per song
  if: Cond;                     // the SAME Cond as RULES.md §4, read with song facts
  order?: { by: SongFactId | "random" | "source"; dir: "asc" | "desc" };
  limit?: { songs?: number; minutes?: number; perArtist?: number; perAlbum?: number };
};

type RulePlaylist = FilterRule & {
  refresh: "live" | "daily" | { weekly: 0..6 } | "off";   // §7, F3
  keep: string[];               // songs the user keeps whatever the rule says   (F4)
  never: string[];              // songs the user took out                       (F4)
  fetchedAt?: number;           // the last time the list was made
};
```

- **One condition language.** A filter rule uses `Cond` and `evalCond` unchanged. A Rulez rule
  and a filter rule can never read the same words two ways.
- **Song facts are a separate registry from app facts.** "Loved" in a Rulez rule means the
  song playing now. "Loved" in a filter rule means each song in the pool. The ids can be the
  same; the reader is different.
- **Random order** uses a seed that changes once per refresh, not once per read. So a Live
  rule playlist does not reshuffle each time a fact changes.

## 4. The song facts

Every fact reads what the app already holds. **No fact calls Apple or Last.fm.** A value we do
not have is missing (see F5).

| Fact | Values | Read from | Notes |
|---|---|---|---|
| `title`, `artist`, `album`, `albumArtist` | text | `tracks.json` | Needs a new leaf op `contains` (F6). |
| `composer` | text | `tracks.json` (`composerName`, CREDITS.md) | "Written by" a name. `contains`. |
| `genre` | a list of words | `tracks.json` `genres` | `is` matches any genre in the list. |
| `year` | number | `releaseDate` | |
| `length` | seconds | `durationMs` | |
| `explicit` | true · false | `contentRating` | |
| `lyrics` | true · false | `hasLyrics` | |
| `inLibrary` | true · false | `tracks.source` | `seen` songs are not in the library. |
| `addedRank` | number (higher = later) | `addedRank` | Apple sends no date added. "The newest 100 added" works (order + limit). A date works only for songs added through DeetsMusic (`added_at`, HOME.md §3). |
| `addedDaysAgo` | number | `added_at` | DeetsMusic adds only; missing for the rest. |
| `loved` | true · false | `favorites` | |
| `plays`, `finishes`, `skips` | number | `play_stats`, `play_events` | All time. The *Agents read play history* switch does not apply: it gates agents (LOCAL-DATA.md §9), not the user's own app. |
| `playsIn.<window>`, `minutesIn.<window>` | number | `play_events` since `windowStart(w)` (`rewind.ts:75`) | One fact per Rewind window: day · week · month · year · ytd. The leaf shape takes no argument, so the window is in the fact id. |
| `lastPlayedDaysAgo` | number | `play_stats.last_played` | A date as "days ago", so `lt` / `gt` work. |
| `diaryScore` | number | `diary_songs.score` | Missing for a song with no score. |
| `inDiary` | true · false | `diary_entries` | The album has a Diary entry. |
| `sotd` | true · false | `picks` | The song was a Song of the Day pick. |
| `inPlaylist` | a list of playlist ids | `local_playlist_tracks`, the CACHED `apple_playlist_tracks` | "Is in Road Trip", "is in no playlist". |
| `pinned` | true · false | `pins` | |
| `listeners` | number | `listen_counts` (LISTENERS.md) | Cached counts only. Most songs have none until they play. |
| `albumColor`, `albumLight` | a word · true/false | `album_palette` (cached palettes) | The same words as RULEZ.md §11. Missing for a cover never shown. |
| `lessMarked` | none · song · artist · album | `matchOf` (`suggest.ts:117`) over the `suggest_less` marks the page holds | Built (2026-10-16, in testing). The page already holds the marks, so this fact needs no Rust read. The value says which mark matched: the song, its artist, or its album (SUGGEST-LESS.md §5c). "Is not marked" is the common use: a rule playlist with no Suggest Less songs. |

## 5. The sources

| Source | Songs | Cost |
|---|---|---|
| Library | `tracks` with `source = 'library'` | none |
| Seen songs | `tracks` with `source = 'seen'` (played or marked, not in the library) | none |
| A local playlist | `local_playlist_tracks` | none |
| An Apple playlist | `apple_playlist_tracks`, **the cache only** | none. The mirror's own refresh keeps it fresh (PLAYLIST-REFRESH.md). A mirror never opened has no rows yet; the editor says so and offers to open it once. |
| A rule playlist | its last made list | none. A loop (A reads B, B reads A) is refused when saved. |
| Rewind: a window | the songs in `play_events` since the window start | none |
| History | the same log, every song ever played | none |
| Song of the Day | `picks` (`meta` keeps the song even after it leaves the library) | none |
| The Diary | the songs of every Diary entry (`diary_entries.tracks_json`) | none |
| Loved songs | `favorites` | none |
| Pins | the pinned songs, and the songs of pinned albums and playlists that the app holds | none |

**Ruled out: the Apple catalog as a source.** A rule cannot look at songs the app does not
hold, and reading the catalog to find them is many Apple calls. A user who wants catalog songs
gets them into a source first (an album added, a playlist mirrored).

## 6. How it runs

1. **One Rust call** (`filter_pool`, `async` + `spawn_blocking`, CLAUDE.md › Conventions) takes
   the sources and the list of fact ids the rule reads (`factsOf`, `rules-eval.ts:276`). It
   returns one row per song: the key, the Track, and only those facts. One SQL pass with joins,
   and the play log summed once per window.
2. **The page** runs `evalCond(rule.if, row.facts)` on each row, then the order and the limit.
   This is the pure part; it goes in its own file (`filter-eval.ts`) with tests.
3. **Size.** The owner's library is about 4,042 songs. The evaluator on 4,000 rows is under a
   millisecond. The Rust call (JSON of 4,000 Tracks) is the cost; measure it in the build, the
   way `[perf]` measures a play.

The alternative is to turn the rule into SQL in Rust (F2).

## 7. The rule playlist

- **It is a local playlist** with a rule on it. It shows in the Playlists card with the other
  local playlists, plays, pins, drags and takes the right-click menu like one. Its cover is the
  mosaic (PLAYLISTS.md §11).
- **The refresh.** His words: the playlist refreshes at the interval the user picks. The
  interval reuses `isDue` and the day-change tick of PLAYLIST-REFRESH.md §4, and the same
  `playlist_refresh` table (`playlist_key = "local:<id>"`). Because every source is local, a
  refresh costs no Apple call, so "Live" (made again when a fact changes) is possible too (F3).
- **The queue is master.** A rule playlist that changes while it plays does not change the
  Queue card. The queue took its songs at the press (queue-sync.ts, QUEUE.md).
- **The log.** It acts on its own, so it logs its arm, each fire (how many in, how many out)
  and its off through `diag.log("rulePlaylist", …)` (CLAUDE.md checklist item 6).
- **A toast?** A refresh that changes the list says nothing by default, the way a mirror's
  daily refresh only shows one timed toast per check (PLAYLIST-REFRESH.md D7). The same toast
  can name rule playlists that changed. His call when built.
- **Export to Apple stays a press.** Export is the gated one-way bridge (PLAYLISTS.md §6). A
  refresh never writes to Apple by itself: PLAYLIST-REFRESH.md D9 says "an exported local
  playlist never writes by itself". After a refresh, an exported rule playlist offers the new
  songs the way D9's sticky toast does.

## 8. The filter in the Library card

- The Library card's toolbar gets a **Filter** pop (it rides `makeDropdown`, checklist item 13)
  next to the ♥ pill. It lists the saved filters and "New filter…". A picked filter narrows the
  source list, the way the ♥ pill does (`library-card.ts:620`), so Songs, Albums, Artists and
  Genres all follow it.
- **Save as playlist** on a filter makes a rule playlist from it, with the library as its source.
- A filter is a rule playlist with no playlist: one store for both, one editor.

## 9. Agents, Compass, the checklist

- **Agents:** the MCP `rules` verb (RULEZ.md §7) learns a `filter` kind; `list what=library`
  takes a saved filter's name; an agent can make a rule playlist. A new key gets its spec in
  `agent-settings.ts` and a line in AGENT.md.
- **Compass:** each saved filter and rule playlist is a row (COMPASS.md §9).
- **The build checklist** (CLAUDE.md › Working style) applies in full: the editor panel's
  `.pop` and `enterRows`, hints in the ONBOARDING.md §1 ledger, a NEW mark, the right-click from
  `media-menu.ts`, `wireListKeys`, card memory for the open filter.

## 10. Dropped, and why

- **The Apple catalog as a source** — the app does not hold it; reading it is many calls (§5).
- **A fact that calls Apple or Last.fm** — the owner's rule: minimize calls. The cached values
  only (§4).
- **A refresh that writes to Apple** — PLAYLIST-REFRESH.md D9 (§7).
- **The filter rule as a Rulez rule with a new action** — a Rulez rule asks one question about
  the app now; a filter rule asks the same question about each of 4,000 songs and keeps no
  holds. One `Cond`, two runners.

## 11. The forks (all his)

> **Part:** his calls 2026-10-16 are §13. F1, F2, F4, F5, F6 closed; F3 Live with guards (§13.1a), Live by default; F7 half closed
> (the Library button), the Playlists UX to design (§13.3).

**F1. The name of the playlist.**
- **A. Rule playlist** (recommended). It names the feature that makes it (Rulez) and does not
  collide with Apple's word.
- B. Smart playlist. The word users know from iTunes. Cost: the mirror already shows Apple's
  smart playlists (kind `smart`), so two different things carry one name.
- C. Live playlist. Cost: it is wrong when the interval is Daily.

**F2. Where the rule runs.**
- **A. `evalCond` in the page, over facts from one Rust call** (recommended, §6). One evaluator
  for Rulez and filters, already tested; the editor previews the count as the user types.
- B. The rule turned into SQL in Rust. Cost: a second reader of the same words that can drift
  from `evalCond`; smaller replies for a large library.

**F3. The intervals.** His words chose an interval. The open part is the list and the default.
- **A. Live · Daily · Weekly · Off; Live by default** (recommended). Every source is local, so
  Live costs nothing and the playlist is never stale.
- B. Daily · Weekly · Off, as the mirrors have; Daily by default. Cost: a song you love now
  joins "Loved jazz" only tomorrow.

**F4. Hand edits on a rule playlist.**
- **A. Keep and Never** (recommended). Remove a song: it goes on the Never list and stays out.
  Add a song by hand: it goes on the Keep list and stays in. Both show in the editor with Undo.
- B. Read-only. The list is only what the rule says; to edit, turn it into a normal playlist.
  Cost: one wrong song means editing the rule.

**F5. A fact with no value** (no Diary score, no Last.fm count, no date added).
- **A. Add a `known` leaf ("has a Diary score" / "has no Diary score"); a leaf on a missing
  value stays false, as today** (recommended). The editor shows "312 songs have no count yet".
- B. Leave the engine as it is. Cost: "score is not 8" quietly drops every song with no score.

**F6. Text matching.** `Leaf` has no "contains" today.
- **A. A `contains` op, case- and accent-folded, for text facts** (recommended). "Written by
  Max Martin", "title contains Remix".
- B. Exact words only. Cost: no "title contains Live" or "artist contains feat.".

**F7. Where the editor lives.**
- **A. A panel from the Library's Filter pop and the Playlists card's "New rule playlist", on
  every surface, with the Rulez blocks inside** (recommended). A filter is a library tool.
- B. The Rulez card only. Cost: Rulez is Max only, so Mini and Midi users get no filters.

## 12. A build sketch (when he says go)

1. `filter-eval.ts` (pure: the song facts' types, the pool union, `evalCond`, order, limit,
   Keep / Never) + tests.
2. Rust `filter_pool` (sources → rows with the asked facts) + `cargo test`; the store: a
   `rule_playlists` table (or columns on `local_playlists`) with the rule JSON.
3. The Library Filter pop, then the editor panel on the Rulez blocks.
4. The rule playlist: the refresh tick on `isDue`, the log lines, the toast line.
5. Agents, Compass, docs; the desk test written into this doc.

## 13. His calls (2026-10-16)

> **Part:** idea · 2026-10-16 · his answers to §11; F7 Playlists UX to design

| Fork | His call |
|---|---|
| F1 | **Rulez Playlist.** The name of the feature in the UI. (In this doc, "rule playlist" means the same thing.) |
| F2 | **`evalCond`** in the page (option A). |
| F3 | **Live · Daily · Weekly · Off**, Live only if it brings no race, no thread overload and no extra weight (§13.1a, the gate §13.1b). **A new Rulez Playlist starts on Live** (his call, 2026-10-16). |
| F4 | **Keep and Never** (option A): Remove blacklists the song from the playlist; a hand add keeps it. §13.2. |
| F5 | **Yes, the `known` leaf, if the defaults stay intuitive.** §13.4 is the proposal for that. |
| F6 | **`contains`, with a choice to match accents or not**, as a toggle near the text boxes. The case: a user wants *Vénus* by DjeuhDjoah and cannot type the accent. |
| F7 | **The Library:** a third button after Sort and View, where the user makes a rule. **Playlists:** the UX is to be designed (§13.3). |

### 13.1 F3: what Live costs (checked against the code)

**Live adds no time to the action that changes the library.** A song added to the library is
added first. The rule pass runs after it, off the UI thread for its Rust part, and the user
does not wait for it.

**A big import does not make many passes.** The track store reloads the library one time when
a sync is DONE (`track-store.ts:152`, the `library-sync` event with `phase: "done"`,
`library.rs:1460` and `library.rs:1586`). The progress events of each page of 100 do not
reload it. So 10,000 songs moved from Spotify into Apple arrive in one sync, and that makes
**one** rule pass at the end, not 100.

**The size of one pass on a large library** (estimated; to measure in the build):
- The page already holds every library Track (`track-store.ts`). So for the library source,
  Rust returns only the number facts that the rule reads (plays, score, loved …), keyed by song.
  For 14,000 songs that is a small reply, made on a blocking thread
  (`spawn_blocking`, CLAUDE.md › Conventions).
- `evalCond` on 14,000 rows takes a few milliseconds.
- The pass writes the playlist's new song list only when the list changed.

**What makes Live safe** (the design if he picks Live):
1. **A pass runs only on a change to a fact the rule reads.** `factsOf` (`rules-eval.ts:276`)
   names them. A rule on genre and loved does not re-run when a song ends.
2. **Changes are joined.** All changes within a short time (about 2 s) make one pass, for all
   Live Rulez Playlists together, with one Rust call.
3. **No pass while a sync runs** (`onSyncBusy`, `library.ts:132`). The pass runs once, at the end.
4. **The queue does not change** (§7). A Live playlist that plays now does not move songs under
   the user.
5. **The log** has one line for each pass: how many songs, how many in and out, ms.

**The one fact that changes often** is a play count: a rule on `plays` or `playsIn.*` re-runs
after each song. That is one small pass for each song, after the song changes. It is a cost we
can measure, not a risk to playback.

**Recommendation stays: Live · Daily · Weekly · Off, Live by default.** Daily · Weekly · Off
(his lean) is also sound: then a Rulez Playlist is made again on the day change, as the mirrors
are, and on open. The cost of that choice: a song that matches now joins only tomorrow, or when
the user opens the playlist.

**His call (2026-10-16): add Live, if it brings no race, no thread overload and no extra weight
on the app.** §13.1a is how the build meets each condition. §13.1b is the gate: if a measurement
fails, Live is not shipped, and he is told why. **Default: Live** (his call, 2026-10-16). If Live does not pass the gate, the default is his question again then.

### 13.1a Live: the three conditions, checked against the code

**1. No race.** Each race below has its guard.

| Race | Guard |
|---|---|
| A change comes while a pass runs. | **One pass at a time** (single flight). A change during a pass marks the set dirty; when the pass ends, one more pass runs. A pass carries a generation number, and a result from an older generation is thrown away. |
| A pass ends after the user removed or added a song (Never / Keep) or changed the rule. | Each Rulez Playlist has a **version**. A hand edit or a rule edit adds one to it. The pass writes its list in **one transaction** that reads Keep and Never again inside it and writes only if the version is the one the pass started with. Otherwise it writes nothing and a new pass is queued. A hand edit is never lost. |
| A pass ends after the playlist was deleted. | The write finds no row and does nothing. |
| A library sync is in progress. | **No pass while a sync runs** (`onSyncBusy`, `library.ts:132`). One pass at the `done` event. |
| The playlist plays while it changes. | The Queue card took its songs at the press (§7). A pass never touches the queue. |
| An exported Rulez Playlist changes. | A pass never writes to Apple. The new songs are offered the D9 way (§7). |
| A fact read in the page and a fact read in Rust are from two moments. | The later change fired its own seam, so the next generation reads both again. |

**2. No thread overload.**
- **No new thread.** The Rust part is one `spawn_blocking` task on Tokio's existing pool. With
  one pass at a time, there is at most one such task. (Checklist item 16: nothing new for the
  thread ledger.)
- **The shared database lock is not held.** Every write in the app goes through one lock
  (`Db(Mutex<Connection>)`, `library.rs:22`). A pass that held it would make a play's log write
  wait. So the pass reads through **its own read-only connection** to the file. The database
  is in WAL mode (`lib.rs:235`), so a reader and the writer do not block each other. `query.rs`
  already opens the file this way (`mode=ro`, `query.rs:124`). Only the final write of the new
  list takes the lock, and it is one short transaction.
- **The page part is small.** `evalCond` on 14,000 rows is a few milliseconds. If the
  measurement (§13.1b) shows a long task, the loop runs in slices between frames.

**3. No extra weight.**
- **No Live Rulez Playlist, no work.** The seams are watched only while one exists. Its arm and
  its off are log lines (checklist item 6).
- **Idle costs nothing.** No timer and no polling. A pass runs only on a seam of a fact the rule
  reads (`factsOf`).
- **Changes are joined** (about 2 s), and all Live playlists share one pass and one Rust call.
- **No memory kept.** The fact rows live only for one pass. What stays is the playlist's list,
  as for any playlist.
- **A list that did not change writes nothing** and redraws nothing.

### 13.1b Live: the gate before it ships

Measured on `npm run dev:built` (CLAUDE.md › How to verify), with a library of 20,000 songs made
in a test database (a `cargo test` and a `npm test` case, not a harness):

| Measure | Limit |
|---|---|
| The Rust read for one pass | under 100 ms, on its own connection |
| The page part (`evalCond`, order, limit) | under 8 ms as one task, or sliced |
| A play's log write while a pass runs | no slower than with no pass |
| `[perf] frames` while a pass runs | no drop against no pass |
| A 10,000-song sync | one pass, at `done` |

If one limit fails and a fix does not bring it under, Live is not shipped. Daily · Weekly · Off
ship alone, and he is told which measure failed.

### 13.2 F4: what Keep and Never mean

A Rulez Playlist's songs come from the rule. Keep and Never let the user correct the rule for
one song, without changing the rule.

- **Never.** The user removes a song from a Rulez Playlist (right-click › Remove, or Delete).
  The song goes on the playlist's Never list. The next refresh does not add it again, even when
  the rule picks it.
- **Keep.** The user adds a song by hand (drag, or Add to Playlist). The song goes on the Keep
  list. It stays in the playlist, even when the rule does not pick it.
- Both lists show in the rule's editor, one row for each song, with Undo.

Without them (option B), the playlist is read-only: Remove is not in its menu, and a drop on it
is refused. To take one song out, the user changes the rule.

**His call (2026-10-16): Never.** "We can allow removing a song that can blacklist it from the
playlist." Remove puts the song on the playlist's Never list; a refresh never adds it back.
The Never list shows in the rule's editor with Undo, so a song can come back.
**And Keep (his call, the same day): "we can keep the keep behavior as well."** A hand add (a
drag, or Add to Playlist) puts the song on the Keep list; it stays whatever the rule says. Both
lists show in the editor with Undo. F4 is closed: option A.

### 13.3 F7: where the rule is made

**The Library.** A third button after **Sort** and **View** in the Library card's toolbar. It
rides `makeDropdown` like the other two (`wirePops` in `collection-card.ts`). It lists the
saved filters and *New filter…*, and the active one shows on the button the way Sort shows the
sort in force. The ♥ pill stays as it is. The button's name is a fork to bring with the design
(Filter or Rulez).

**Playlists — to design.** His sketch (2026-10-16): on a Rulez Playlist's page, the empty area
under the drop slot (*Drag songs here …*) holds the rule. Two parts:
- **The rule:** pick one from the existing Rulez, or a button that opens the Rulez panel to make
  one.
- **The sources:** picked in the second part, the right half of the area. When the card is
  narrow, the sources go in the lower half. His note: the narrow layout may look awkward.

This means a filter rule is also a kind in the Rulez card (the user picks "from the existing
Rulez"). So the editor lives in Rulez too, not only in the Library's panel. The design pass
settles how a filter rule shows there beside the When / While rules.

### 13.4 F5: intuitive defaults for a missing value (the proposal)

- **The user never adds a `known` block to get the expected result.** A condition reads as it
  sounds: "Diary score is 8 or more" gives songs scored 8 or more, and a song with no score is
  not one of them.
- **A "not" on a missing value includes the song.** "Diary score is not 8" keeps a song with no
  score, because it is not 8. Today the engine drops it (`leafHolds` returns false on a missing
  value, `rules-eval.ts:255`). For filter rules, `isNot` holds on a missing value. Rulez rules
  keep today's behavior. (This changes the evaluator for one runner only, so it is a flag on
  `evalCond`, with a test.)
- **The editor says how many songs have no value**, under the block, only when the number is
  not zero: "312 songs have no Diary score". The line is a button that adds the *has a Diary
  score / has no Diary score* block for the user.
- **`known` is a block of its own** in the list ("has a Diary score", "has no Last.fm count"),
  for a user who wants it on purpose.

### 13.5 F6: the accent toggle (the proposal)

- **Default: accents do not matter.** "venus" finds *Vénus*. Case never matters. The fold is
  Unicode NFD with the marks removed, the same fold for the user's text and the song's text.
- **The toggle:** a small *Match accents* toggle beside each text box in a text block. Off by
  default. On: "Vénus" finds only *Vénus*.
- **The same rule for `is`** on text facts (artist is …), so "Beyonce" finds *Beyoncé*.
- Today `matches` folds case only (`rules-eval.ts:247`). The accent fold is new code in the
  filter runner; whether Rulez rules get it too is a question for the design pass.

### 13.6 His calls on the build (2026-10-16, later)

| Question | His call |
|---|---|
| Scope | **Build Rulez Playlists, leave out the playlist page** (§13.3). A Library filter makes one with *Save as Rulez Playlist*. |
| The Library button | **Filter.** It also filters directly by a fact (a genre, a year, loved …) without a saved rule: a quick filter. |
| The editor | **A panel from the Filter button, on every surface**, with the Rulez blocks inside. Saved filters also show in the Rulez card. |
| §13.4 and §13.5 | **Yes to both** proposals: missing values and the accent toggle. |

## 14. As built (2026-10-16)

> **Part:** built · 2026-10-16 · committed (3a9d3bf) · desk test passed 2026-10-17 (§14.4)

### 14.1 What is in the code

| Part | Where |
|---|---|
| The condition, extended for songs: `has` (contains), `known` (has a value), `accents`; `evalCond(c, facts, { songs: true })` folds accents (cached) and lets "is not" hold on a missing value. A Rulez rule reads as before. The song fact ids (`SongFactId`) are in `FactId` but never registered, so Rulez does not offer them. | `rules-eval.ts` |
| The pure core: the shape (§3), a Track's own facts, which facts go to Rust, `pickSongs` (Keep, Never, your order, the sorts, a seeded random, the limits), the missing counts, Daily / Weekly `isDue`, the loop check. 17 tests. | `filter-eval.ts`, `tests/filter-eval.test.ts` |
| The words: four filter sections (The song · Plays · Your marks · Library), 34 facts; "contains", "has a value" / "has no value"; a length reads and types as `4:05`. | `rulez-words.ts` `FILTER_FACTS` |
| The condition menus, moved out of the Rulez card so both use one copy: the section menus, the search field, the value rows, the names from your library. The Filter panel adds Contains and the "has a value" rows. | `cond-editor.ts` (Rulez card now imports it) |
| The store and the read: schema **v21**, table `filter_rules` (one row per saved filter; `playlist_id` set = a Rulez Playlist). Commands `filters_list`, `filter_save`, `filter_delete`, `filter_attach`, `filter_set_refresh`, `filter_set_lists`, `filter_write`, `filter_read`. 3 tests. | `filter.rs`, `lib.rs` |
| Keep and Never by hand (F4): an add, an insert, a remove, a move on a Rulez Playlist records itself in the SAME transaction as the edit, and adds one to the version. A move or a drop at a place puts the playlist in your order. A delete of the playlist deletes its rule; a rename renames it. | `playlists.rs` (`on_hand` and its callers) |
| The live half: the store mirror, the pool (the library from the page, the rest in one Rust read), the passes in slices, Live, Daily, Weekly. | `filters.ts`, `main.ts` (`initFilters`) |
| The Library's third pill, **Filter**, after Sort and View (a new `rulePop` on the collection engine), and its panel. | `collection-card.ts`, `library-card.ts`, `filter-panel.ts` |
| A Rulez Playlist's menu row: *Rulez Playlist ▸ Edit the rule · Make it again now · Refresh ▸*. | `playlists-card.ts` |
| The Rulez card's **Filters** section (his call: saved filters show there too); a press opens the filter in the Library. | `rulez-card.ts` |
| The Compass: a saved filter or a Rulez Playlist by its name opens it in the Library. | `compass.ts`, COMPASS-TERMS.md |
| A held request on the bus: the Library with a saved filter in force and its panel open. | `layout-bus.ts` `requestLibraryFilter` |

**A correction to §6 and §13.1a.** Every database command in this app runs on ONE database
thread (`db_thread.rs`), not on `spawn_blocking`. So: the read (`filter_read`) runs on
`spawn_blocking` with its own read-only connection, as planned, and never waits in the
database thread's queue; every write (the store, `filter_write`) goes through the database
thread like every other command.

### 14.2 The gate (§13.1b), as far as it is measured

| Measure | Limit | Measured | Note |
|---|---|---|---|
| The Rust read, 20,000 songs, 8 facts | under 100 ms | **66 ms** (release build, an in-memory copy) | The first version took 170 ms: it filled 0 / false for every song (140,000 map entries). Now Rust sends sparse columns (only songs with a value) and the page fills the rest; the reply is 897 KB. A debug build is slower; `cargo test --release --lib filter::tests::the_gate -- --nocapture` prints it. |
| The page part (`evalCond`, order, limit), 20,000 songs | under 8 ms as one task, or sliced | **17–28 ms** as one task (Node, warm) | Over 8 ms, so the pass checks songs in **slices of 2,000** with the page free between them (`filters.ts` `passing`). The owner's library is about 4,000 songs. `npm test` logs the time and never asserts it (a loaded CPU made one run 265 ms). |
| A play's log write while a pass runs | no slower | not measured | Desk test step 9. By design the read holds no lock, and the write waits only behind the database thread's queue. |
| `[perf] frames` while a pass runs | no drop | not measured | Desk test step 9. |
| A 10,000-song sync | one pass, at `done` | not measured | By the code: the track store reloads once per finished sync, and no pass runs while a sync is busy. |

### 14.3 Decided inside his choices (for his review)

- **The words.** The pill says *Filter*; the panel's title is *Filter*, or the saved filter's
  name, or *Rulez Playlist: its name*. The condition starts *Only songs where*. The count says
  *1,204 of 4,042 songs* / *Every song (4,042)* / *Counting…*.
- **Where things sit in the panel**, top to bottom: the head (title, count), the condition,
  the missing-value lines, the Rulez Playlist part (From, Order, Limit, Refresh, *N kept · N
  taken out*), the buttons, then *Saved*.
- **The buttons.** A quick filter: *Clear · Save filter… · Make a Rulez Playlist…*. A saved
  filter you changed: *Save changes*. A Rulez Playlist: *Save changes · Refresh now · Done*.
- **The accent toggle** is a panel chip with the letter *é* beside each text condition; pressed
  means accents count. The default is off (accents do not count), his §13.5.
- **The Rulez Playlist's own menu** is one row, *Rulez Playlist ▸*, with the refresh in force on
  it (as the mirrors' *Refresh* shows theirs).
- **"Delete" on a Rulez Playlist's rule** keeps the playlist: its songs stay, as an ordinary
  playlist. Deleting the playlist deletes its rule.
- **A move by hand puts the playlist in "your order"**, so the next pass keeps the move (a
  sorted playlist would otherwise undo it at once).
- **The orders offered:** Your order, Newest added first, Most played first, Played longest ago
  first, Highest Diary score first, Rarest first (Last.fm), Oldest first, Shortest first, Title
  A–Z, Artist A–Z, Random. Random is one order per day and version.
- **The Compass group** is *Filters*, with a funnel glyph.
- **A made toast:** *Made the Rulez Playlist “X”. It refreshes Live.* A pass says nothing.
- **A filter is session state in the Library**, like the ♥ pill: it is not in card memory.
- **After a Rulez Playlist, the panel starts fresh (his call, 2026-10-16, after his test).** A
  Rulez Playlist made or edited in the panel stays in force while the panel is open. The next
  open clears it (the Library shows every song again) so a new rule starts from nothing. A
  saved filter you put in force stays. *Edit the rule* opens on its playlist's rule; that one
  open keeps it. (`opening` on the collection engine's `rulePop`, library-card.ts.)
- **Facts left out of the filter for now:** the album color words (a palette is cached per cover
  only once that cover has been shown), the cover light / dark.

### 14.4 The desk test (passed)

**Passed 2026-10-17 (his call).** He marked the test passed. The run itself left no record that
this sitting could find: the dev and installed logs had rotated past any `rulezPlaylist pass`
line.

**Run by Claude (2026-10-16, dev app, through the page's modules, not the UI):** the library of
4,046 songs; *genre contains "rock"* → 88 songs; a pool of the library, Song of the Day and
Rewind month with *plays ≥ 3* read in 18 ms (31 ms with the page part). A Rulez Playlist
(*plays ≥ 3*, most played first, 10 songs) was made with 10 songs; its first song removed by
hand went on Never (version 2); *Make it again now* refilled to 10 without it; deleting the
playlist deleted its rule. The panel, the pill and steps 1–9 below are not run.

On `npm run dev:app`. Steps 1–8 are for anyone; step 9 is the gate.

1. **The pill.** Library: a third pill *Filter* after Sort and View. Press it: the panel opens
   under it as Sort's does, and its rows enter.
2. **A quick filter.** *what is true?* › The song › Genre › Is › type "ja" › Jazz. The list
   narrows at once and the count reads *N of M songs*; Albums, Artists and Genres follow it.
   The pill looks active. *Clear*: every song is back.
3. **Accents.** Title › Contains › "venus" finds *Vénus* (if your library has one). Press *é*:
   it does not. Press again: it does.
4. **Missing values.** Your marks › Diary score › Is above › 7. The line *N songs have no Diary
   score* shows. Then Diary score › Is not › 8: songs with no score stay in the list. Press the
   line: *has a value* is added and they leave.
5. **Save, use, rename, delete.** *Save filter…* › a name. It shows under *Saved*; press it to
   turn it off and on. ⋯ › Rename, Delete. Ctrl+Space › its name opens it.
6. **A Rulez Playlist.** *Make a Rulez Playlist…* › a name. The toast; the Playlists card shows
   it with the songs. Its menu shows *Rulez Playlist ▸ Live*. *Edit the rule* opens the Library
   on it, with From, Order, Limit and Refresh. Change Order to Most played first, Limit to 20,
   *Save changes*: the playlist is made again in that order, 20 songs.
7. **Live.** A rule *Loved › The song is loved*, Live. Love a song: within ~2 s it joins the
   playlist. Unlove: it leaves.
8. **Keep and Never.** Remove a song from the Rulez Playlist: it stays out after the next pass
   (love another song to cause one). Drag a song that does not match onto it: it stays.
   *Edit the rule* › *1 kept · 1 taken out* › Undo each; the next pass puts them back as the
   rule says.
9. **The gate** (`npm run dev:built`). With a Live playlist that reads Plays, play songs and
   skip: the log's `rulezPlaylist pass` line has `readMs` and `ms`; the `[perf] frames` lines do
   not drop against a run with no Live playlist; the `[perf] click→sound` lines are no slower.
   Press the Library ⟳: one pass after `sync done`, none during.

### 14.5 Not built, and open

- **The playlist page's own place for the rule** (§13.3, his sketch): to design.
- **Agents:** no `filter` in the MCP `rules` verb and no `filter=` on `list what=library` (§9
  named them; they are not his calls yet).
- **The Last.fm count has no seam:** a new count joins at the next pass for another reason.
- **Rulez rules do not fold accents** (§13.5's last line): unchanged.
- **Daily / Weekly do not run on open** of the playlist, only on the hourly day-change check and
  when the window shows.

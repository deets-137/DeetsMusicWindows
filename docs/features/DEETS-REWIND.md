---
status: shipped
shipped_in: 0.4.3
desk_test: passed 2026-10-30
sources: [src/stats.ts, src/player.ts, src-tauri/src/library.rs, src/rewind.ts, src/rewind-card.ts, src/library.ts, src/replay.ts, src/rewind-window.ts, src-tauri/src/playlists.rs, docs/ops/checks/rewind-sweep.mjs]
updated: 2026-10-30
---
# DeetsRewind — listening stats & the data-viz card

> The plan for **DeetsRewind**: a personal listening-stats surface (think Apple Music
> Replay / Spotify Wrapped, but **live, local, and private** — nothing leaves the
> machine). This doc is the contract between the data we **already collect** and the
> card someone will build later: what's persisted, where it comes from, how to read it,
> what it can and **can't** answer yet, and the one schema fork to settle before
> time-series.
>
> Code: [`src/stats.ts`](../../src/stats.ts) (recorder) · [`src/player.ts`](../../src/player.ts)
> (hooks) · [`src-tauri/src/library.rs`](../../src-tauri/src/library.rs) (`play_stats` +
> `record_play`). Store overview: [DATA-ARCHITECTURE §5](../architecture/DATA-ARCHITECTURE.md). Threshold
> setting: [FUTURE-SETTINGS §7](../FUTURE-SETTINGS.md).

---

## 1. The data we collect today

One SQLite table, in the same `deetsmusic.db` as the library cache:

```sql
play_stats(
  track_id      TEXT PRIMARY KEY,  -- library_id ?? catalog_id (mirrors the tracks PK)
  partial_count INTEGER NOT NULL DEFAULT 0,
  full_count    INTEGER NOT NULL DEFAULT 0,
  last_played   INTEGER            -- epoch-ms of the most recent start (NULL until first play)
)
```

| Column | Meaning |
|---|---|
| `track_id` | Canonical id — **the same rule as the `tracks` PK**, so stats join straight to track metadata. **Catalog-first** (`catalog_id ?? library_id`) since the 2026-07-01 unified-store migration ([FAVORITES.md](FAVORITES.md)). |
| `partial_count` | How many times the song **started** (became now-playing). |
| `full_count` | How many of those starts **crossed the listened-through threshold** (~90%). |
| `last_played` | Epoch-ms of the most recent **start** (set on `partial`; not touched by `full`). |

**The funnel invariant:** `full_count ⊆ partial_count` — every finish also started, so
`full_count ≤ partial_count` always. That's the whole shape of the data: a per-track
**started → finished** funnel, plus a recency stamp.

> **Cumulative, not historical.** These are running totals, never decremented or
> windowed. There is **no per-play event history** — see §5 for what that rules out.

> **The card is gated (2026-09-10, [SETTINGS.md](../architecture/SETTINGS.md) §4):** hidden from the slot
> pickers until **50 play starts** (`play_event_count` at boot + per-start counting in
> `stats.ts`), then revealed once, silently; the Settings card's "Rewind card" toggle turns it
> off or on after that.

---

## 2. The hooks — where the numbers come from

Two events, recorded from the player, deduped to one count each per logical play:

| Event | Fires when | Recorded by |
|---|---|---|
| **partial** (a start) | the song becomes now-playing | `stats.recordStart()` |
| **full** (listened through) | playback progress crosses `FULL_THRESHOLD` (0.9) | `stats.recordProgress()` |

**Path:** `player.ts` → [`stats.ts`](../../src/stats.ts) → `invoke("record_play", …)` →
`library.rs` upsert → SQLite. The recorder passes **both** ids
(`{ catalogId, libraryId, kind }`); Rust canonicalizes to `library_id ?? catalog_id`.

**Call sites in `player.ts`:**
- `onNowPlayingChange` (when `!loadingContext`) → `recordStart` — natural advances + native
  prev/next within the window.
- end of `loadFromModel` (after `loadingContext = false`) → `recordStart` — fresh context /
  jump / re-window (the intermediate rebuild changes are suppressed by `loadingContext`).
- `emitProgress` → `recordProgress` — the position tick (several×/sec).

**Dedup (why counts don't inflate):** [`stats.ts`](../../src/stats.ts) holds two latches —
`lastStartedId` (collapses the several `nowPlayingItemDidChange` events a single start fires
during a queue rebuild, plus idempotent re-clicks) and `fullCountedId` (one `full` per play,
robust to seeking past/back over the 90% mark). A new start resets `fullCountedId`, so a
genuine replay earns a fresh `full`.

**Threshold:** `FULL_THRESHOLD = 0.9`, hardcoded for now; slated to become a user
preference (fraction / strict-end / scrobble-rule) — [FUTURE-SETTINGS §7](../FUTURE-SETTINGS.md).

**Verify hook (no UI yet):** each record echoes to the diag ring buffer. Play something and
run `__diag.dump()` — you'll see `stats:partial` on each start and `stats:full` once a track
passes 90%, each carrying the updated `{ trackId, partialCount, fullCount, lastPlayed }`
straight from SQLite (`stats:err` if a write fails).

---

## 3. Reading it for the card (the join)

> **Status: BUILT (2026-07-02)** — the Rewind card shipped: `play_events_since` (Rust),
> [`rewind.ts`](../../src/rewind.ts) (read wrapper + stat×window aggregation),
> [`rewind-card.ts`](../../src/rewind-card.ts) (hero + top-20 leaderboard, stat/window
> pill pickers). Song/artist/album group off joined metadata; playlist groups off the
> event `context` tag ("minutes listened FROM this playlist"). Windows are rolling
> (24h/7d/30d/365d) except This Year (local Jan 1). Rows show real minutes · plays.

The original plan, for reference:

1. **Add a read command** (Rust, `library.rs`) — e.g.
   `play_stats_all() -> Vec<PlayStat>` (or a paged / `top_n` variant once libraries are
   large), and register it in `lib.rs`. `PlayStat` already serializes as
   `{ trackId, partialCount, fullCount, lastPlayed }`.
2. **Wrap it in TS** — mirror [`library.ts`](../../src/library.ts) with a thin
   `invoke<PlayStat[]>("play_stats_all")`.
3. **Join to metadata** — `trackById(stat.trackId)` from
   [`track-store.ts`](../../src/track-store.ts). The store **indexes both** `libraryId` and
   `catalogId` to the same Track, so a `play_stats.track_id` resolves whichever id was
   canonicalized — **the join just works**. A `null` result means *played but not in the
   cached library* (a catalog-only song, or one since removed) — render it as
   "uncached/unknown," don't crash.

**Fields available to group/weight by** (off the joined `Track` — see
[`library.ts`](../../src/library.ts)): `artistName`, `albumName`, `genres[]`, `durationMs`,
`artwork`, `releaseDate`, `addedRank`. These are what turn per-track counts into
artist/album/genre rollups for free.

---

## 4. What the card can show **with today's data**

All of these are computable from `play_stats` ⋈ `tracks` — no schema change needed:

| Metric | How | Notes |
|---|---|---|
| **Top songs** | sort by `full_count` (or `partial_count`) | the headline list |
| **Top artists / albums / genres** | group joined `artistName` / `albumName` / `genres[]`, sum counts | rollups for free |
| **Completion rate** | `full_count / partial_count` per song or per rollup | "what you actually finish" |
| **Most skipped / abandoned** | high `partial_count`, low `full_count` | the inverse of completion |
| **Recently played** | order by `last_played` desc | **durable, cross-session** (the queue's `getRecentlyPlayed()` is session-only) |
| **Library coverage** | `count(play_stats) / count(tracks)` | "% of your library you've ever pressed play on" |
| **Rough listening time** | `Σ full_count × durationMs` | **approximate** — counts finished plays only, ignores partial listens; not real elapsed seconds. The event log (§5a) replaces this with **exact** `Σ ms_listened`. |

Token discipline applies to the viz too: route chart colors through **theme roles**, never
hardcode hex — see [UI-ARCHITECTURE.md](../architecture/UI-ARCHITECTURE.md). Build it as a mountable card per
[SURFACES-AND-CARDS.md](../architecture/SURFACES-AND-CARDS.md).

---

## 5. What we **don't** capture yet (the honest limits)

The store is **cumulative counters + last start**. That deliberately cannot answer anything
**time-resolved**:

- **No time-series.** No "your 2026," no per-month/-day/-hour trend, no "you played this 40×
  *in March*." We keep totals, not a history of plays.
- **No "on this day…"** recall — same root cause.
- **No true minutes-listened.** We count *events*, not elapsed seconds. The §4 estimate
  (`full_count × durationMs`) is a floor-ish approximation; partial listens contribute
  nothing and a 95%-then-skip counts as a full track. **→ Decided fix in §5a:** the event
  log captures real `ms_listened`, making this exact.
- **No skip detail.** The `partial − full` gap is a *proxy* for skips, but there's no
  explicit skip event, no "skipped at 0:42," no skip source.
- **No context attribution.** Whether a play came from an album, a playlist, search, or the
  library isn't persisted (the queue handle carries `context`, but `record_play` drops it).
- **No time-of-day / streaks / sessions.**
- **Cross-id imprecision.** A song present under *both* a library id and a catalog id could
  tally under two `track_id`s. ISRC would unify it, but it's catalog-only and often absent —
  same limitation as the library cache.

### 5a. DECIDED — add an event log, and capture minutes from day one

> **Status: BUILT (2026-07-01)** — the log is live and accruing. `play_events` table
> in `library.rs` (catalog-first key); start-row append + end-of-play finalize in
> `stats.ts` (`ms_listened` accumulated from forward progress-tick deltas, so seeks
> don't count as listening; finalized when the next song starts or on app close;
> a crash leaves the row with `ms_listened = NULL`, by design). Verify via
> `__diag.dump()` → `stats:event-start` / `stats:event-end`. Still tracking-only —
> the read path + card are Phase B.

We will add an append-only **`play_events`** log alongside the counters. **Minutes-listened
is a headline Rewind stat**, so the log captures *real elapsed listen time* (`ms_listened`)
— the one field that **cannot be backfilled** (we never recorded per-play duration). It has
to be right from the very first logged play, which is why we're locking the shape now rather
than at build time.

**Two stores, side by side — keep both:**

| | `play_stats` (have it) | `play_events` (to build) |
|---|---|---|
| Shape | one row per track, `+1` per play | **append-only**, one row per *play* |
| Holds | all-time `partial`/`full` counts + `last_played` | every listen — timestamp + duration + origin |
| Powers | all-time top / most / least / completion / recency | time-series, **minutes listened**, context attribution |
| Lifetime | all-time (incl. the pre-log era) | from log-start onward |

We do **not** collapse the counters into a `VIEW` over the log: that would silently drop the
all-time totals we've already been accumulating. Counters stay the cheap all-time
leaderboard; the log is the timeline.

**Planned `play_events` schema:**
```sql
play_events(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id    TEXT NOT NULL,               -- same canonical id as play_stats — catalog-first (catalog_id ?? library_id) per FAVORITES.md; the log ships after that migration
  started_ts  INTEGER NOT NULL,            -- epoch-ms when the play started
  ms_listened INTEGER,                     -- actual elapsed listen time (NULL until finalized)
  completed   INTEGER NOT NULL DEFAULT 0,  -- 1 once it crossed the listened-through threshold
  context     TEXT                         -- "album:123" | "playlist:x" | "search" | "library"
)
```

**Granularity — one row per play, written in two steps (crash-safe *and* accurate):**
1. **On start** (today's `recordStart` point): append a row with `started_ts` + `context`,
   `ms_listened = NULL`, `completed = 0`. Writing immediately means a play **survives an app
   crash / force-quit** — the row is already on disk.
2. **On play-end** (a **new end-of-play hook**): finalize that row — set `ms_listened`
   (elapsed playback time, captured *before* we advance the model) and `completed`.

The end-of-play hook is the one piece of genuinely new plumbing: it fires when a song stops
being current (the next song starts, or playback stops) and reads the **outgoing** song's
elapsed time. `context` is already on the queue entry (`TrackHandle.context`) — the recorder
just needs to pass it; `started_ts` we already compute. (Counters keep incrementing exactly
as today, in parallel — no change to the `partial`/`full` semantics.)

**What the log unlocks (all `play_events` queries, joined to track metadata):**
- **Minutes listened** — `SUM(ms_listened)`, per period / artist / genre. The headline stat,
  now **exact** instead of the `full_count × duration` estimate.
- **Time-series** — `GROUP BY` time buckets off `started_ts`: per-day/-month trends,
  "your 2026," listening-by-hour, streaks.
- **Context attribution** — `GROUP BY context`: "you play this mostly from the X playlist."
- **Real skip analysis** — a row with low `ms_listened` and `completed = 0` is a skip, and
  you can see *how far in* it got.

**Scope caveat:** `ms_listened` only exists from log-start, so "minutes listened" is
inherently a *from-now-on* stat — pre-log plays have no recorded duration. That's fine;
Rewind stats are per-period anyway. The urgency cuts the other way: **the sooner the log
ships, the deeper the first Rewind.**

---

## 6. Build checklist

**Phase A — the event log. ✅ BUILT 2026-07-01.**
- [x] `play_events` table (§5a schema) in `init_db` (+ an index on `started_ts`). Since 2026-09-29 (schema v18) also indexed on `track_id` and on `(context, started_ts)`, for the per-pin counts and the playlists' last-played reads ([DATA-ARCHITECTURE.md §5](../architecture/DATA-ARCHITECTURE.md)).
- [x] **Start path:** `record_event_start` appends the row where `recordStart`/`recordRestart` fire; the row id returns to `stats.ts`.
- [x] **End-of-play:** the outgoing row finalizes when the next song starts (`startEvent` → `finalizeEvent`) or on `beforeunload`; `ms_listened` = accumulated forward tick deltas (seek jumps filtered), captured before the model advances.
- [x] `context` threaded from `TrackHandle.context` through `record_event_start`.
- [x] `play_stats` counters unchanged, incrementing in parallel.
- [x] `__diag` echoes `stats:event-start` / `stats:event-end` — tracking-only, no UI.

**Phase B — the Rewind card. ✅ BUILT 2026-07-02.**
- [x] Read command: `play_events_since(since_ts)` (windowed at the SQL layer via `idx_play_events_ts`) + registered in `lib.rs`. Grouping/ranking lives in TS — at this scale (tens of thousands of small rows worst-case) one O(n) Map pass beats maintaining per-stat SQL over the JSON-blob track metadata; if the log ever outgrows memory, swap `topBy()`'s internals for SQL rollups behind the same signature.
- [x] TS layer ([`rewind.ts`](../../src/rewind.ts)): join via `trackById`, `null` → "Unknown"; rank by `SUM(ms_listened)` then plays; unfinalized rows (in-flight / crashed) count the play, contribute 0 min. Representative artwork = the group's most-listened resolvable track (the Library card's borrowed-album-art trick — zero Apple calls; round for artists).
- [x] Card UI ([`rewind-card.ts`](../../src/rewind-card.ts)): qcard hero + top-20 list, two `lib-pill` pickers (stat: Songs/Artists/Albums/Playlists × window: Past Day/Week/Month/This Year/Past Year, default Songs × Past Week, persisted to localStorage). Right-click menus (Play Now / Play Next / Add to Queue / Add to Playlist): songs ride the shared `trackMenu` (`context: "rewind"`); albums play the full library album in disc/track order (played-subset fallback for catalog-only albums, `context: "album:<key>"`); playlists fetch their authored tracks lazily on action (`context: "playlist:<id>"`, so those plays keep attributing). Artists stay read-only (no obvious play order). Re-renders on queue/track-store/playlist changes. All tokens, no hardcoded values.
- [x] Local-only (reads our SQLite, no Apple calls). *Known accepted lag:* the currently playing song's minutes land when the next song starts.
- [x] **Cross-session resolution (2026-07-02):** historical catalog-only plays were "Unknown" — two gaps. Write: only Search materialized; now `handlesFrom` (player.ts, the funnel every Track[]-play crosses) materializes non-library tracks, so playlist/album plays persist their metadata. Read: `library_tracks` filters to synced rows, so 'seen' rows never reached the store; new `seen_tracks` command loads them into the transient map at startup. Plays logged BEFORE this fix that were never materialized stay "Unknown" forever (no metadata was captured) — pre-production, accepted.
- [ ] Surface the privacy angle in UI copy (a subtitle/tooltip — deferred, copy TBD).
- [ ] All-time window (needs `play_stats` or full-log scan — deferred; today's five windows are all event-log).

---

## 7. See also

- [DATA-ARCHITECTURE.md](../architecture/DATA-ARCHITECTURE.md) — the SQLite store, `record_play`, the model.
- [FUTURE-SETTINGS.md](../FUTURE-SETTINGS.md) §7 — making the 90% threshold user-configurable.
- [QUEUE.md](QUEUE.md) — `played` flag & `getRecentlyPlayed()` (session recency vs. our durable `last_played`).
- [SURFACES-AND-CARDS.md](../architecture/SURFACES-AND-CARDS.md) — the card system the viz mounts into.

---

## 8. Sweep (2026-10-18)

> **Part:** swept · 2026-10-18

The first quality sweep ([QUALITY-SWEEP.md](../ops/QUALITY-SWEEP.md)). Three Sonnet agents
(workflow and keyboard; data and timing; neighbors and load) gave 45 scenarios, 31 after
duplicates. Each one was checked against the code and his live database (read-only, 3,660
plays). Then came the visual pass (QUALITY-SWEEP.md §3a). The guards and the fault shots are
[ops/checks/rewind-sweep.mjs](../ops/checks/rewind-sweep.mjs) (→ `rewind-sweep.json`, 14 shots,
dev app).

Terms: **the list** is the ranked rows on the card (the top row large, up to 19 below it). **The
first dropdown** picks what is ranked (Songs, Artists, Albums, Playlists); **the second** picks the
time span (Past Day … Past Year).

### 8.1 His calls (2026-10-18)

| | Call |
|---|---|
| K1 | **Make playlist: picked rows win.** With rows picked (Ctrl / Shift), the playlist is their songs (a picked album gives all its songs). With none picked, it stays the top 25 songs of the time span, and the button's hover hint says so: "Your top 25 songs of this time span." |
| K2 | **The 50-play unlock respects a hand choice.** It does nothing when the user has already shown or hidden Rewind by hand in Settings › Cards. |
| K3 | **SOTD picks in a time span:** a pick is in the span when any part of its day is in it (fixes F5). |

### 8.2 Faults (ranked likelihood × impact; each fix is its own piece of work)

| # | Fault | Evidence | L×I | Shot |
|---|---|---|---|---|
| F1 | Playlists view: plays of a playlist that was deleted or remade read "Unknown Playlist". A play keeps the playlist's ID; the weekly Replay deletes and remakes its playlist with a new ID | live: 575 of 804 local-playlist plays (72 %) point to 35 playlists that no longer exist; dev: 4 Unknown rows | 3×2 | `fault-unknown-playlist` fails |
| V1 | At every change of the first or second dropdown the list goes blank for about 40 ms, then the rows that stay show at once, fade out and fade in again one by one (the reveal's wave and the keyed redraw disagree about which rows are new: the lead for the fix, not proven) | the motion monitor (a flash on `rewind__board`, `qnow`, every `qrow` and its art, each switch) and the frame strip of each step | 3×2 | `visual-choices` fails |
| F2 | The list misses the minutes of the song that just ended until the song after it ends: at a song change the queue changes first, so the list reads the log before the finished song's row is written. Rewind listens to the queue; History listens to the log write (`onPlayEvent`) | confirmed: 70 s listened, the row read "<1 min" 3 s after the skip | 3×1 | `fault-minutes-after-skip` fails |
| V2 | The hover hint of a row that is gone stays over the blank list during a redraw, then jumps to the row now under the pointer | the frames of `visual-choices` (the hint "Sunshine / Jungle" over the empty list); the monitor's flash on `hint--row` | 2×1 | `visual-choices` fails |
| F4 | The last song before a close or a crash keeps 0 minutes: the close path sends the final write without waiting | live: 92 plays with no minutes (2.5 %), 51 in the past 30 days | 2×2 | none (a close is not a shot); read the count again after the fix |
| F3 | A song played again from a new list right after it played counts once, and both listens' minutes go on one play (`recordStart` drops a start with the last start's ID) | confirmed: 1 play, expected 2; live: 4 plays over twice the song's length | 2×1 | `fault-same-song-again` fails |
| F5 | SOTD, Past Day drops yesterday's pick after midday (a pick's time is noon of its day) | the code (`picksIn`) | 2×1 | a unit test with the fix (K3) |
| F7 | Make playlist that fails halfway leaves an empty or unfiled playlist and says "Nothing to add" | confirmed: 1 playlist left behind (the shot deletes it) | 1×2 | `fault-make-half-fails` fails |
| F6 | A list left open does not move with time (paused overnight; This Year on 1 January) | the code | 1×1 | none |
| F8 | A slow right-click on a Playlists row opens its menu after the first dropdown has moved on | confirmed: the menu opened after the switch | 1×1 | `fault-slow-playlist-menu` fails |

### 8.3 Guards (pass today)

Escape with a menu open keeps the picked rows (the menu takes Escape first); fast changes of
the first dropdown settle on the last one, never left on hold; no "Unknown" rows flash at
launch; the dropdowns and Make playlist fit in Midi; a year of the log (3,660 rows on live)
reads in well under 150 ms. A song change redraws the list with no flash, snap or jitter on
Rewind's own parts (`visual-song-change`; its hits are the Queue card's rows and the Now
Playing cover, see 8.4). Read from the data, no shot: a song under two IDs (0 on live and dev:
every key is a catalog ID); minutes against song length (completed plays average 1.003× the
song on live).

### 8.4 Older (not Rewind's own) and drops

- **Readability:** 103 of 1,182 text boxes on the card miss WCAG AA in 14 of 30 looks. 96 are
  shared: `--subtext` (the artist line, the minutes line, "Runners-up") and the title row in
  Glass and Ocean, lowest 2.77, where the same role fails on other cards in the same look. That
  is HANDOFF's open readability item (Ocean's see-through card, Glass). The other 7 were first
  filed as a fault (V3), then read in the pictures: each one was a row under the hover hint the
  test's pointer left up, or the last row in the list's bottom fade. A test artifact, not a
  fault: the readability step now runs with the hints off (`read` in `sweep-helpers.mjs`), and
  the run after the fixes has no failure in any of the 30 looks.
- **The Queue card at a song change:** its top row and runners-up fade out and in (the monitor
  in `visual-song-change`). For the Queue's own sweep: designed or not.
- **Keyboard picks:** no keyboard-only way to pick rows or use Ctrl+A. The shared `row-pick.ts`.
- **Drops** (not reachable, or not worth a script): a second Rewind card (a card has one
  instance); a hidden card still mounted (Hide cards hides from the picker only); a clock set
  by hand; a new song's first ticks on the old row (the ID check and `loadingContext`); two Make
  playlist clicks across two cards; the withdraw button after a redraw (the keyed patch); the
  read cost per song change (small: the year-read guard watches it); a lost scrobble when the
  start write fails (DB-HEALTH covers the write); Home, SOTD and Rewind reads delaying the play
  writes; Make playlist after the card closes; no menu on an Unknown row (nothing to play); the
  unlock seed's count near 50.

### 8.5 The fixes (2026-10-18)

> **Part:** built · 2026-10-18 · desk test: his, passed 2026-10-30 (his word)

His ask: fix all of them, here, in one sitting (not one at a time, QUALITY-SWEEP.md C4 set
aside by him for this sweep). His calls for F1 and F4 (2026-10-18): a deleted playlist keeps its
name; the 575 old plays with no name share one "Deleted playlists" row; minutes saved every 30 s.

| # | The fix | Where | Proof |
|---|---|---|---|
| F1 | The weekly Replay keeps its one playlist and replaces its songs (no new ID each week). A play from a playlist keeps the playlist's name in `playlist_names` (schema **v22**), so a deleted one reads "Name (deleted)"; plays from before v22 with no name left share one "Deleted playlists" row. Those rows have no menu and no drag (nothing to play). The migration named the playlists that exist and have plays | `playlists.rs` (`migrate_v22`, `remember_name`, `playlist_names`), `library.rs` (`record_event_start`), `rewind.ts`, `replay.ts`, `rewind-card.ts` | `fault-unknown-playlist` passes; the dev log: `migration: v22 added playlist_names (6 named …)`; new plays named (`local:28`, `local:29`) |
| V1 | No transition while a row waits for or plays its entrance: `.qrow`'s `transition: opacity` made the wait's 0 a fade-out, so rows showed, faded and entered. One rule for every list on the reveal (the Queue's rows flashed the same way) | `styles.css` (`body .reveal-pre`, `body .reveal-in`) | `visual-choices` passes; the frames show the old list, the hold, the wave, and no row twice |
| F2 | The list re-reads when a play's row is written (`stats.onPlayEvent`, as History does), not when the queue moves. It also no longer re-reads a year of plays on every queue reorder | `rewind-card.ts` | `fault-minutes-after-skip` passes (1 min shown 3 s after the skip) |
| V2 | A list going on hold hides the hover hint of a row inside it | `hint.ts` (`hideHintIn`), `reveal.ts` | the frames: the hint leaves with the held list |
| F4 | The open play's minutes are saved every 30 s of playing, 2 s after the ticks stop (a pause) and when the window hides; the end of the play writes the last value | `stats.ts` (`checkpoint`) | no play without minutes in the dev log since; `rewind-data.mjs` reads the count on live after the release |
| F3 | A start of the song already playing waits for the next tick: back near the start (more than 1.5 s back, under 3 s in) is a new listen with its own play; a rebuild carries on and changes nothing | `stats.ts` (`sameStart`) | `fault-same-song-again` passes; dev plays 366 and 367 |
| F5 | A Song of the Day pick is in a time span when any part of its day is (K3). The time spans moved to a pure file with a test | `rewind-window.ts`, `tests/rewind-window.test.ts` | 5 tests pass |
| F7 | Make playlist is all or nothing: a failure deletes the half-made playlist and the button says "Couldn't make it"; "Nothing to add" is kept for an empty time span or pick | `replay.ts` (`createReplay`, `NothingToAdd`), `rewind-card.ts` | `fault-make-half-fails` passes |
| F6 | The list re-reads when the window comes back into view, and every 15 minutes while it is in view | `rewind-card.ts` | none (time); read by eye in the desk test |
| F8 | A playlist row's menu opens only if the view is the same and the row is still in the list; a failed read clears the row's highlight | `rewind-card.ts` | `fault-slow-playlist-menu` passes |
| K1 | Make playlist with rows picked makes "Replay — <time span>, picked, <date>" from their songs, in the order shown, each song once; the hover hint says what a press makes now | `replay.ts` (`makePickedPlaylist`), `rewind-card.ts`, ONBOARDING.md §1 | desk test |
| K2 | Rewind shown or hidden by hand before 50 plays (any path: Settings › Cards, the picker's Hide and its Undo, the agent) marks the unlock done | `stats.ts` (watches `hiddenCards`) | desk test |

**What Claude decided inside his calls** (for his look): the button's failure words, "Couldn't
make it"; the picked playlist's name, "Replay — Past Week, picked, 18 Oct 2026"; the hint texts
(ONBOARDING.md §1); 15 minutes for F6; F3's rule (1.5 s back, under 3 s); the hold-and-wave hits
counted as designed by the motion report (`sweep-helpers.mjs`, `motionReport`); Settings ›
Cards › reset to default shows Rewind once the unlock is marked done, also after a hand choice.

**The desk test (his):**
1. Rewind › Playlists, Past Year: no "Unknown Playlist"; a "Deleted playlists" row; delete a
   playlist you have played from and see "Name (deleted)".
2. Change both dropdowns a few times: the list goes blank for a moment, then the rows come in one
   after another, none twice. Hover a row first: its hint goes with the list.
3. Play a song for over a minute, skip: its row reads at least "1 min" within a few seconds.
4. Play a song, then the same song again from another list: two plays.
5. Ctrl-click three rows, press Make playlist: a "picked" playlist of their songs under Replay.
6. Play for a minute, close the app from the tray mid-song, reopen: that play has its minutes.

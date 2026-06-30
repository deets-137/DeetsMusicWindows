# DeetsRewind — listening stats & the data-viz card

> The plan for **DeetsRewind**: a personal listening-stats surface (think Apple Music
> Replay / Spotify Wrapped, but **live, local, and private** — nothing leaves the
> machine). This doc is the contract between the data we **already collect** and the
> card someone will build later: what's persisted, where it comes from, how to read it,
> what it can and **can't** answer yet, and the one schema fork to settle before
> time-series.
>
> Code: [`src/stats.ts`](../src/stats.ts) (recorder) · [`src/player.ts`](../src/player.ts)
> (hooks) · [`src-tauri/src/library.rs`](../src-tauri/src/library.rs) (`play_stats` +
> `record_play`). Store overview: [DATA-ARCHITECTURE §5](DATA-ARCHITECTURE.md). Threshold
> setting: [FUTURE-SETTINGS §7](FUTURE-SETTINGS.md).

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
| `track_id` | Canonical id, `library_id ?? catalog_id` — **the same rule as the `tracks` PK**, so stats join straight to track metadata. |
| `partial_count` | How many times the song **started** (became now-playing). |
| `full_count` | How many of those starts **crossed the listened-through threshold** (~90%). |
| `last_played` | Epoch-ms of the most recent **start** (set on `partial`; not touched by `full`). |

**The funnel invariant:** `full_count ⊆ partial_count` — every finish also started, so
`full_count ≤ partial_count` always. That's the whole shape of the data: a per-track
**started → finished** funnel, plus a recency stamp.

> **Cumulative, not historical.** These are running totals, never decremented or
> windowed. There is **no per-play event history** — see §5 for what that rules out.

---

## 2. The hooks — where the numbers come from

Two events, recorded from the player, deduped to one count each per logical play:

| Event | Fires when | Recorded by |
|---|---|---|
| **partial** (a start) | the song becomes now-playing | `stats.recordStart()` |
| **full** (listened through) | playback progress crosses `FULL_THRESHOLD` (0.9) | `stats.recordProgress()` |

**Path:** `player.ts` → [`stats.ts`](../src/stats.ts) → `invoke("record_play", …)` →
`library.rs` upsert → SQLite. The recorder passes **both** ids
(`{ catalogId, libraryId, kind }`); Rust canonicalizes to `library_id ?? catalog_id`.

**Call sites in `player.ts`:**
- `onNowPlayingChange` (when `!loadingContext`) → `recordStart` — natural advances + native
  prev/next within the window.
- end of `loadFromModel` (after `loadingContext = false`) → `recordStart` — fresh context /
  jump / re-window (the intermediate rebuild changes are suppressed by `loadingContext`).
- `emitProgress` → `recordProgress` — the position tick (several×/sec).

**Dedup (why counts don't inflate):** [`stats.ts`](../src/stats.ts) holds two latches —
`lastStartedId` (collapses the several `nowPlayingItemDidChange` events a single start fires
during a queue rebuild, plus idempotent re-clicks) and `fullCountedId` (one `full` per play,
robust to seeking past/back over the 90% mark). A new start resets `fullCountedId`, so a
genuine replay earns a fresh `full`.

**Threshold:** `FULL_THRESHOLD = 0.9`, hardcoded for now; slated to become a user
preference (fraction / strict-end / scrobble-rule) — [FUTURE-SETTINGS §7](FUTURE-SETTINGS.md).

**Verify hook (no UI yet):** each record echoes to the diag ring buffer. Play something and
run `__diag.dump()` — you'll see `stats:partial` on each start and `stats:full` once a track
passes 90%, each carrying the updated `{ trackId, partialCount, fullCount, lastPlayed }`
straight from SQLite (`stats:err` if a write fails).

---

## 3. Reading it for the card (the join)

The read path is **not built yet** (we shipped tracking-only). When the card lands:

1. **Add a read command** (Rust, `library.rs`) — e.g.
   `play_stats_all() -> Vec<PlayStat>` (or a paged / `top_n` variant once libraries are
   large), and register it in `lib.rs`. `PlayStat` already serializes as
   `{ trackId, partialCount, fullCount, lastPlayed }`.
2. **Wrap it in TS** — mirror [`library.ts`](../src/library.ts) with a thin
   `invoke<PlayStat[]>("play_stats_all")`.
3. **Join to metadata** — `trackById(stat.trackId)` from
   [`track-store.ts`](../src/track-store.ts). The store **indexes both** `libraryId` and
   `catalogId` to the same Track, so a `play_stats.track_id` resolves whichever id was
   canonicalized — **the join just works**. A `null` result means *played but not in the
   cached library* (a catalog-only song, or one since removed) — render it as
   "uncached/unknown," don't crash.

**Fields available to group/weight by** (off the joined `Track` — see
[`library.ts`](../src/library.ts)): `artistName`, `albumName`, `genres[]`, `durationMs`,
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
hardcode hex — see [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md). Build it as a mountable card per
[SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md).

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

> **Status:** decided (2026-06-30). To be built in a **dedicated future session**; this
> section is the spec to build against. Nothing here is wired yet — today is still
> counters-only (§1).

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
  track_id    TEXT NOT NULL,               -- same canonical id as play_stats (library_id ?? catalog_id)
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

**Phase A — the event log (a dedicated session of its own; ship this early so data accrues).**
- [ ] Add the `play_events` table (§5a schema) to `init_db`.
- [ ] **Start path:** append a row (`started_ts` + `context`, `ms_listened` NULL) where `recordStart` fires today; return the new row `id`.
- [ ] **End-of-play hook** in [`player.ts`](../src/player.ts): on the outgoing song (next-song-starts / playback-stops), capture its elapsed time **before** the model advances, and finalize the row (`ms_listened`, `completed`).
- [ ] Thread `context` from `TrackHandle.context` through the recorder (it's dropped today).
- [ ] Keep `play_stats` counters incrementing in parallel — unchanged.
- [ ] Verify via `__diag` (e.g. `stats:event-start` / `stats:event-end`) — still tracking-only, no UI.

**Phase B — the card (a later session).**
- [ ] Read command(s) (`play_stats_all` / `top_n` / time-bucketed event queries) + register in `lib.rs`.
- [ ] TS read wrapper; join via `trackById`; handle `null` (uncached) tracks.
- [ ] Card UI as a mountable card ([SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md)); viz colors via theme roles, geometry/type via skin tokens.
- [ ] Keep it local-only; surface that in the UI copy (it's a privacy feature, not just an implementation detail).

---

## 7. See also

- [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) — the SQLite store, `record_play`, the model.
- [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) §7 — making the 90% threshold user-configurable.
- [QUEUE.md](QUEUE.md) — `played` flag & `getRecentlyPlayed()` (session recency vs. our durable `last_played`).
- [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) — the card system the viz mounts into.

---
status: built
desk_test: passed 2026-10-17
sources: [src/ipc-timing.ts, src/ipc-core.ts, vite.config.ts, demo/latency.ts, demo/shim.ts, scripts/shots.mjs, scripts/latency-profile.mjs, docs/ops/checks/ipc-timing.mjs, docs/guide/latency.json, docs/guide/loading.json]
updated: 2026-10-17
---
# DeetsMusic — The loading set: every wait, replayed at the owner's real timings

The demo answers every app call at once. So the shots runner (SHOTS.md) cannot show what a
user sees while a card waits for its data. This design makes the demo wait as long as the
owner's own dev app waits, call by call, and makes the covers load at his real network speed.
Then one clip per wait (the **loading set**) shows how each card fills, and the strip counts
the pops.

**Terms:**
- **Command** — one Tauri `invoke` from the front end to Rust (`playlists_cached`,
  `apple_playlists_sync`, …). Its **round trip** is the time from the call to the answer. It
  holds the database lock wait, the SQL, and any Apple or Last.fm call made inside it.
- **Cold call** — the first call of a command after the page loads. **Warm call** — every
  later call. A first load is mostly cold calls.
- **Cover** — an `<img data-art>` from Apple's server (`mzstatic`). **Mosaic** — the cover the
  app draws from track covers (mosaic.ts).
- **Latency profile** — `docs/guide/latency.json`: per command, the cold and warm round trips
  measured on the owner's dev app; per cover, the load times.
- **Pop** — a frame in which a large part of a box changes at once (a cover that appears whole).
  A fade spreads the same change over many frames.
- **Loading set** — `docs/guide/loading.json`: one clip per wait, like `motion.json`.

## 1. Why (the owner's ask, 2026-10-16)

He asked whether the first load of a card (Playlists) has a cover-up, or whether things
appear in a jumble. The first recording (`shots/scratch/pl-firstload.json`, Glass, Midi):

- The Playlists card picked from the title menu: the rows rise with the swap at +169 ms, each
  with a ♪ square. The three mosaics then replace their ♪ in one frame each, at +547, +796 and
  +1002 ms. The order is steady (the worker draws one at a time), but each one is a pop.
- The card at launch: the launch cover (UX-COVERUPS.md §6) holds the stage dark to about
  +686 ms, and the card arrives full. Nothing to cover there.
- What the recording could not show: the demo answers `apple_playlists_sync` in about 0 ms and
  `apple_playlist_counts` with 0, so the second and third list redraws (the sync and the count
  backfill) fell before the first frame. In his app they come later, and each one rebuilds
  every row and every `<img>` (`view.innerHTML` in collection-card.ts).

His call (2026-10-16): replay **his real timings**, read per command from his dev log, plus
covers at a slow network. The design first.

## 2. What the log has today (read 2026-10-16)

The dev log (`%APPDATA%\com.deetsmusic.dev\deetsmusic.log`) has **no round trip per
command**. It has:
- `db: slow <module>::<fn> … worst waited N ms, ran N ms` — only over a threshold, grouped per
  60 s, and only the database lock (not the Apple call, not the IPC).
- `mosaic:drawn {"covers":N,"ms":N}` — the worker's draw time per mosaic.
- `[perf] click→sound` — playback only (perf.ts).

So step 1 adds a recorder. Every front-end command goes through one global,
`window.__TAURI_INTERNALS__.invoke` (58 files import `invoke` from `@tauri-apps/api/core`,
which calls that global). The recorder wraps the global once at boot. No call site changes.
(Built 2026-10-17: the global is read-only, so the recorder sits at the import instead, §7.)

## 3. The design

### 3.1 The recorder — `src/ipc-timing.ts` (dev only)

> **Part:** built · 2026-10-17 · desk test passed 2026-10-17 (§6, run by Claude). Where this
> part and §7 disagree, §7 is the code: the global cannot be wrapped.

- Gated on `TELEMETRY` (telemetry-on.ts), as frames.ts and marks.ts are. The release bundle
  holds none of it: release-check item 5 greps for its handle, as it does for `__marks`.
- At boot (first in main.ts), it wraps `window.__TAURI_INTERNALS__.invoke`. For each call it
  takes `performance.now()` before and when the promise settles (resolve or reject).
- Per command it keeps: the cold round trip (the first call of this page life) and the warm
  round trips (a ring of the newest 50).
- It writes one log line per command that was called, when diag flushes (every 5 min, and
  on close):
  `[perf] ipc playlists_cached cold 14 · warm 3,2,4,9,3`
  Only new values since the last flush. A command with no new calls writes nothing.
- It also marks each call on the page clock: `ipc:<cmd>` with `begin` / `end` (marks.ts). A
  strip of the dev app then names each wait.
- **Covers:** a `load` listener in the capture phase on `img[data-art]` (the same opt-in marker
  artwork-heal.ts uses) reads the image's Resource Timing entry. Apple's server sends no
  `Timing-Allow-Origin`, so only `duration` is there, and a cache hit cannot be told by
  `transferSize`. A load under 8 ms counts as a cache hit. Line:
  `[perf] art miss 212,340,95 · hits 41`
- The `window.__ipcTiming` handle is declared in `declare global` (CLAUDE.md checklist 15).

### 3.2 The profile — `scripts/latency-profile.mjs` → `docs/guide/latency.json`

> **Part:** built · 2026-10-17 (the script; the first `latency.json` waits for a day or more of
> his use, §4 step 2).

- Reads every `[perf] ipc` and `[perf] art` line in `deetsmusic.log` and `deetsmusic.1.log`,
  over the last N days (`--days 14` default).
- Per command: `cold` and `warm`, each with `n`, `p50`, `p90`, `max`. Per cover: the same for
  misses, and the hit share.
- Writes `docs/guide/latency.json` with the date range and the version it was read from. It
  holds command names and milliseconds only: no song, no id, no path.
- `npm run latency:profile`. Run it again after a change that moves a wait (a new cache, a
  new Apple call).

### 3.3 The replay in the demo

> **Part:** built · 2026-10-17. §7.2 is the code where they differ (the covers are answered by the
> runner, not let go).

- **Only when the runner asks.** The runner puts the profile in the page before the app loads
  (`addScriptToEvaluateOnNewDocument`, as the seed is) as `window.__deetsLatency`. The public
  demo on deets.solutions never has it, so it answers at once, as today.
- `demo/shim.ts` wraps the handler it gives `installTauri`: before it answers, it waits the
  command's time. The first call of a command in a page life waits the **cold** value; later
  calls wait the **warm** one. A command with no row in the profile answers at once, and the
  console file lists it once (`latency: no profile for x`), so a new command shows up.
- Each wait gets the same `ipc:<cmd>` marks as in the dev app, so the strip names it.
- **Covers:** the runner turns on the CDP `Fetch` domain for `*mzstatic*` image requests and
  holds each one for a time drawn from the cover **miss** profile, then lets it go. That
  replays his spread of times, not one flat speed (`Network.emulateNetworkConditions` gives only
  one latency for every request). With `--cold` the runner also calls
  `Network.setCacheDisabled`, so a reload loads every cover again.
- The draw is seeded (by the shot id and the run number), so the same shot gives the same
  waits each run, and `--repeat` changes the seed.
- Mosaics are drawn in the demo's own worker. Their time is the machine's, not a replay.
  mosaic.ts gets a `mosaic:drawn` mark (the log line is there already) so the strip names it.

### 3.4 Runner flags

> **Part:** built · 2026-10-17

- `--latency p50|p90|max` — which value of the profile to replay (fork L1, §5).
- `--latency off` — today's behavior, the default, so no current shot changes.
- `--cold` — the cache off, for a first load after install.
- `--vs` already compares runs, so `--latency p50 --vs …` against a cover-up token is one command.

### 3.5 What the strip adds

> **Part:** built · 2026-10-17

- **Pops.** For a step with `"region"`, the change curve (SHOTS.md §5f) already has the change
  per frame. A frame whose change in the region is over a set share (start at 8 % of the
  region's whole change) is a **pop**, and the strip labels it `pop`. The log line gives
  `pops 4 (+169, +547, +796, +1002)`. A fade gives few or none.
- **Settled.** The time of the last `ipc:*:end`, the last cover load and the last
  `mosaic:drawn` in the region's card, after the step. The log gives `settled +1002 ms`.
- **Redraws.** A `coll:render` mark in `renderViewInto` (collection-card.ts) with the level's
  name, so the strip shows each rebuild of a list (the second and third Playlists redraw of §1).

### 3.6 The loading set — `docs/guide/loading.json`

> **Part:** built · 2026-10-17 · first run §8. Where the table and the list differ, the list is
> the code (§7.2).

One clip per wait, in Glass and one solid skin (Press), Midi, `--latency p90 --cold`. Each clip
starts from a seeded state with the card not yet on screen, opens it with the real control,
and records `"frames": 60` with `"region"` on the card. The first list, to check against what
the recorder sees (a wait the recorder does not see is not a wait):

| wait | how the clip opens it | what loads |
|---|---|---|
| Playlists, first open | title menu › Playlists | the list, the sync, the counts, the mosaics |
| A playlist | click a playlist row | its tracks, the covers, the hero mosaic |
| An album | click an album tile (Library) | its tracks, the covers |
| The artist view | click an artist name | the hero photo, the shelves, the Last.fm box |
| Home | title menu › Home | the shelves, the covers |
| Search | type in the Search card | the results, the covers |
| Library, first open | title menu › Library | the songs, the covers |
| Now Playing, next song | Next | the cover, the Listeners badge |
| Rewind | title menu › Rewind | the stats |
| Radio | title menu › Radio | the stations |
| Credits | the song pane | the writers |

A new card that loads data gets a row here (a line in CLAUDE.md's build checklist, once built).

### 3.7 How it is used

1. He uses the dev app as normal. The recorder fills the log.
2. `npm run latency:profile` writes `latency.json`.
3. `node scripts/shots.mjs --list docs/guide/loading.json --latency p90 --cold` records the set.
4. Claude reads each strip: the pops, the settled time, the redraws. The findings go to
   UX-COVERUPS.md as rows, one per wait. Each cover-up is a fork for him, as always.

## 4. Build order

1. The recorder (§3.1) and the `coll:render` and `mosaic:drawn` marks. He uses the dev app
   for a day or more.
2. The profile script (§3.2) and the first `latency.json`.
3. The replay in the demo and the runner flags (§3.3, §3.4).
4. Pops and settled in the strip (§3.5).
5. `loading.json` (§3.6), the first run, and the findings in UX-COVERUPS.md.

Checks at each step: `npx tsc --noEmit`, `npx vite build`, `npm run docs:check`. The release
check must still pass with `TELEMETRY` off.

## 5. Forks

**His calls (2026-10-16):** L1 A, p90 by default. L2 A, `latency.json` in the repo; he also
asked to keep a watch on the repo's storage (where the space goes).

- **L1 — which value to replay by default.**
  - **A (recommended): p90.** The slow case he meets often; a cover-up that works at p90 works
    most days. `--latency p50` and `max` stay for a comparison.
  - B: p50. The typical day; slow days do not show.
  - C: a random draw from all his values per call (seeded). The most real mix, but two runs of
    one clip differ unless the seed is the same, and a cover-up is harder to judge.
- **L2 — where `latency.json` lives.**
  - **A (recommended): in the repo, `docs/guide/latency.json`.** Every session and a later
    regression run replay the same numbers, and a change in the numbers shows in a diff. It
    holds names and milliseconds only.
  - B: gitignored, in `shots/`. Each machine makes its own; a session with no dev-app history
    has no profile.

**Not now:** a gate that fails a release on a new pop or a slower settled time (with SHOTS.md
§12, the picture check); MusicKit's own waits (playback start is perf.ts's `click→sound`).

## 6. Desk test

> **Part:** the recorder (§3.1) and the profile script (§3.2) · passed 2026-10-17, run by Claude.

`node docs/ops/checks/ipc-timing.mjs` on a running dev app (`--second` for the second one). It
changes nothing the user keeps: it calls two commands that do not exist (`deets_check_…`, which
the profile script drops) and writes one block to the log early. The exit code is the number of
failures. 18 checks, all ok on 2026-10-17:

1. The `__ipcTiming` handle exists; the four launch reads of boot-prefetch.ts have a cold value
   (so the import is redirected from the first call); `diag_flush` and `log_event` are not
   timed; 69 commands were timed.
2. Every `ipc:<cmd>:end` mark has its `:begin` with the same id (139 of 139).
3. A command that fails still rejects to its caller, and is timed: cold, then warm, `failed 2`
   in its block line.
4. A race: two first calls at once give one cold value and one warm value.
5. After a flush, the next block does not repeat those lines; the log has the block with its
   head line; every body line is a command name and numbers only (no id, no path).
6. Cover loads are counted (132 hits, 19 misses at a reload); every miss is 8 ms or more.
7. `coll:render` names the level, the grouping and the row count (`Library songs 4053`).
8. `latency:profile` reads the blocks from the log.

**The replay, the strip and the set (steps 3–5), 2026-10-17, run by Claude:** the whole set
(`--latency p90 --cold`, 22 clips) passes; the console file of each clip names the replay and the
cover holds; the step strips label `POP` and the marks (`ipc:…:end`, `mosaic:drawn`); the same
clip with no `--latency` replays nothing (Playlists settles at +472 ms, against +4,637 with the
replay); a motion-set clip (`card-swap`) runs as before. TypeScript passes for the app and for
`demo/`.

Also checked by hand: a release build (`npx vite build`) carries none of it (`__ipcTiming`,
`ipc+art`, `coll:render` absent); a `VITE_PERF=1` build carries it.

## 7. As built (2026-10-17)

### 7.1 The recorder and the profile (steps 1–2)

- **The global cannot be wrapped (found at the first run).** Tauri defines
  `window.__TAURI_INTERNALS__` and each of its properties (`invoke`, `ipc`, `transformCallback`,
  the callback table) as read-only and not configurable. The assignment threw at module load
  and stopped the page from booting. So the recorder sits at the import instead: in a telemetry
  build, the `ipc-timing` plugin in `vite.config.ts` resolves every `@tauri-apps/api/core`
  import made from `src/` to `src/ipc-core.ts`. That file re-exports the real module with a
  timed `invoke`, which calls `timed()` in ipc-timing.ts. No call site changes. The plugin
  applies on the dev server and in a `VITE_PERF=1` bundle (as `TELEMETRY` does); a release has
  no plugin, so it bundles the real module only. Release-check 5 also fails a bundle that holds
  `__ipcTiming`.
- **Not timed:** the calls the `@tauri-apps/api` modules and the Tauri plugins make from
  `node_modules` (`listen`, `emit`, the window calls). They import core by their own path. They
  are not data waits.
- **The block.** Every 5 minutes and on `beforeunload`, one `diag_flush` with a head line and the
  new values below it:
  ```
  2026-10-17 17:32:59.720  INFO  diag: [perf] ipc+art 14 s
      [perf] ipc added_at_map cold 382 · warm 30,13,14
      [perf] ipc apple_playlist_counts cold 67 · warm 19
      [perf] art miss 120,122,357 · hits 133
  ```
  A command's cold value is written once per page life. At most 50 warm values per command per
  block (200 cover misses); more add `dropped N`. A failed call adds `failed N`.
- **The cold value** is the first call to settle. Two first calls at once: one value is cold,
  the other warm.
- **Covers.** A `PerformanceObserver` keeps the newest Resource Timing entries by URL (the
  browser's buffer fills at ~250 and perf.ts clears it per click). A loaded `img[data-art]` from
  `http(s)` waits up to 1 s for its entry. No entry (the memory cache makes none) or under 8 ms
  is a hit.
- **The marks.** `ipc:<cmd>:begin` / `:end` with a call id as the detail. `mosaic:drawn` with the
  mosaic's `seed@px`. `coll:render` with `<level key or title> <grouping> <rows>`, at the top of
  `renderViewInto`, so the first empty render shows as `… 0`.
- **The profile script** writes `latency.json` with `version`, `from`, `to`, `days`, `blocks`,
  per command `cold` / `warm` as `{ n, p50, p90, max }` (nearest rank) and `failed`, and `art`
  with `miss`, `deciles` (p10 … p100 of the misses, for the replay's draw), `hits` and `hitShare`. `--print` shows a table; `--out` and `--log` for a check.
  It drops the check's `deets_check_…` names.
- **What Claude decided inside the design:** `failed N` on a block line (a fast failure would
  pull a p50 down, so the profile can tell); `dropped N` past the ring; the 1 s wait for a
  cover's entry; `diag_flush` and `log_event` not timed (the block's own write is one); the
  block's head line carries the seconds since the last block; the per-run names in the check.
- **First numbers (one reload, his library, 2026-10-17):** `library_sync` cold 3,022 ms,
  `apple_playlists_sync` 1,774 ms, most launch reads 400–620 ms cold (they queue behind each
  other on the database thread), cover misses 120–400 ms.
- **The first `latency.json`** (in the repo, L2) was written 2026-10-17 from 12 blocks of the
  build's own reloads: about 5 cold samples per command. A thin start; run
  `npm run latency:profile` again after some days of normal use.

### 7.2 The replay, the strip and the set (steps 3–5)

- **The replay** is `demo/latency.ts`, wrapped around the demo's handler in `demo/shim.ts`. The
  runner puts `window.__deetsLatency` in the page before it loads, already cut to one cold and one
  warm value per command for the chosen `--latency`. A row with only one of the two uses it for
  both. A command with no row answers at once and is named once in the console
  (`latency: no profile for x`); the calls the recorder never times (`plugin:` calls with no row,
  `log_event`, `diag_flush`) are not named.
- **Covers are answered, not let go.** The design let each held cover go to Apple's server after
  the hold, so the real network time would add to the replayed time. The runner instead fetches
  each cover's bytes once per run (in memory) and answers the request itself after the drawn time
  (`Fetch.fulfillRequest`). The wait is then the replay's alone, and the same on every machine.
  The draw is a point between two deciles of his misses (below p10, p10). With `--cold` every
  cover waits; without it, a share equal to his hit share answers at once.
- **The launch waits.** With the replay on, the launch reads take seconds (p90), and a shot's
  first control was not there yet after the runner's 5 s (7 of 22 clips failed on a busy CPU). After
  the load, a shot now waits until no replayed command has been in flight for 500 ms (at most 20 s).
- **The first load of a run** can take over 30 s while the demo server compiles; it now has 90 s.
  This was there before the replay (a run without `--latency` failed the same way).
- **Pops and settled** are SHOTS.md §5j. `POP_SHARE` = 0.08, the start value of §3.5.
- **The set** (`loading.json`) differs from the §3.6 table in three places: Home and the Library
  are opened by a page reload (both are on screen at launch in Midi, so a title-menu pick would be
  warm); Search clicks its field first, then types (typing on the page fires the app's own keys:
  the first try made a playlist in the demo); Credits is Ctrl+Space › Song credits. 240 frames per
  step: Glass repaints every frame, so 90 frames covered only about 1 s.
- **What Claude decided inside the design:** answering the covers from the runner; the decile
  draw and its seed; the hit share without `--cold`; the 500 ms quiet wait; the 90 s first load;
  the three set changes above; 240 frames; Glass and Press as the two looks, both in Moonlight.

## 8. The first run (2026-10-17, Glass and Press, Midi, `--latency p90 --cold`)

From the thin first profile (§7.1: my own reloads, about 5 cold samples per command), so read the
times as the shape of each wait, not as his numbers. Several rows ran on a busy CPU (NOISY in
the log). `shots/loading/0.29.0/` holds the clips; `0.29.0-base/` the Playlists clip with no
replay.

| wait | settled (Glass · Press) | pops (Glass · Press) | 90 % of the change |
|---|---|---|---|
| Home at launch | +4,470 · +4,059 | 0 · 2 | (a reload: no end change) |
| Library at launch | +4,649 · +4,695 | 2 · 1 | (a reload) |
| Playlists, first open | +4,637 · +5,204 | 4 · 2 | past +2,500 |
| A playlist | +770 · +254 | 4 · 8 | +1,121 · +519 |
| An album | +4,609 · +4,758 | 3 · 1 | +3,543 · +3,650 |
| The artist view | +5,464 · +5,416 | 2 · 3 | +3,998 · +3,899 |
| Search (type) | +3,820 · +3,794 | 4 · 3 | +3,029 · +765 |
| Next | +1,852 · +1,843 | 3 · 9 | +513 · +296 |
| Rewind | +3,208 · +2,758 | 3 · 4 | +473 · +346 |
| Radio | +2,718 · +2,836 | 4 · 5 | +1,181 · +630 |
| Credits | +1,931 · +1,570 | 10 · 7 | +585 · +270 |

**What the strips show (facts, no cover-up chosen; each one is his fork):**
- **Playlists, first open:** the card opens empty at about +266 ms and stays empty to about
  +1,200 ms. Then one row appears (+1,266), then the rest (+1,333). The settled time (+4.6 s) is
  `apple_playlist_counts` and the sync behind it, after the list is on screen.
- **An album and the artist view:** most of the picture is there by +250 ms, but the last 10 % of
  the change comes at about +3.5 to +4 s: a late part of the view (the Last.fm box or a shelf)
  arrives after a long wait.
- **Credits and Next in Press:** many pops (7–10). Press paints only on change, so each part that
  arrives is its own pop. In Glass, the background repaints every frame and spreads them.
- **The settled time is often seconds after the picture looks done:** a command in the
  background (a sync, a count) ends later and may redraw.

Next, only if he picks it up: a profile from his own use (`npm run latency:profile`), the set
again, then a UX-COVERUPS.md row per wait he wants to cover. Each cover-up is his fork.


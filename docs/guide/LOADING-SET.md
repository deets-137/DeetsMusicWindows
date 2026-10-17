---
status: designed
desk_test: none
sources: [src/ipc-timing.ts, scripts/latency-profile.mjs, docs/guide/latency.json, docs/guide/loading.json]
updated: 2026-10-16
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

## 3. The design

### 3.1 The recorder — `src/ipc-timing.ts` (dev only)

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

- Reads every `[perf] ipc` and `[perf] art` line in `deetsmusic.log` and `deetsmusic.1.log`,
  over the last N days (`--days 14` default).
- Per command: `cold` and `warm`, each with `n`, `p50`, `p90`, `max`. Per cover: the same for
  misses, and the hit share.
- Writes `docs/guide/latency.json` with the date range and the version it was read from. It
  holds command names and milliseconds only: no song, no id, no path.
- `npm run latency:profile`. Run it again after a change that moves a wait (a new cache, a
  new Apple call).

### 3.3 The replay in the demo

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

- `--latency p50|p90|max` — which value of the profile to replay (fork L1, §5).
- `--latency off` — today's behavior, the default, so no current shot changes.
- `--cold` — the cache off, for a first load after install.
- `--vs` already compares runs, so `--latency p50 --vs …` against a cover-up token is one command.

### 3.5 What the strip adds

- **Pops.** For a step with `"region"`, the change curve (SHOTS.md §5f) already has the change
  per frame. A frame whose change in the region is over a set share (start at 8 % of the
  region's whole change) is a **pop**, and the strip labels it `pop`. The log line gives
  `pops 4 (+169, +547, +796, +1002)`. A fade gives few or none.
- **Settled.** The time of the last `ipc:*:end`, the last cover load and the last
  `mosaic:drawn` in the region's card, after the step. The log gives `settled +1002 ms`.
- **Redraws.** A `coll:render` mark in `renderViewInto` (collection-card.ts) with the level's
  name, so the strip shows each rebuild of a list (the second and third Playlists redraw of §1).

### 3.6 The loading set — `docs/guide/loading.json`

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

Written when built.

---
status: sop
desk_test: none
sources: [scripts/perf-report.mjs, scripts/webview-eval.mjs, scripts/boot-log.mjs, scripts/webview-profile.mjs, src/player.ts, src/diag.ts]
updated: 2026-09-21
---
# DeetsMusic — Debugging tools

> In-app diagnostics for the player and beyond. Lives in `src/diag.ts`; instrumented
> from `src/player.ts`. Designed so the same capture later becomes a user-facing
> **"Report a problem"** payload.

## The `__diag` console handle
A ring buffer of the last ~300 timestamped events (`{ t, tag, data }`) is **always
recording** (bounded, cheap). In devtools:

| Call | Does |
|---|---|
| `__diag.dump()` | `console.table` of the recent events |
| `__diag.report()` | returns a copy-pasteable text report (header + events) |
| `__diag.copy()` | writes that report to the clipboard |
| `__diag.echo(true)` | live-echo each event to the console as it happens |
| `__diag.clear()` | empty the buffer |
| `__diag.events()` | the raw event array (for poking in code) |

**Echo persists** via `localStorage["deets.debug"] = "1"` — set it once and reloads keep
echoing. Off by default (the buffer still records silently).

## Live introspection (set after first play)
- `__music` — the **live MusicKit instance**. Poke it to discover what this build
  actually populates (this is how we found `queue.position` was empty but
  `nowPlayingItemIndex` works): `__music.nowPlayingItemIndex`, `__music.queue`,
  `__music.isPlaying`, …
- `__player.snap()` — a snapshot of player + model state:
  `{ windowPos, curId, npIndex, qPos, playing, up }`.
- `__player.queue()` — the **model's upcoming vs MusicKit's live window, side by side**
  (titles resolved), with an `aligned` verdict + `firstMismatch`. The one-call answer to
  "did that enqueue / remove / move keep the two in sync?" — and a clean blob to paste back
  for diagnosis. The invariant it checks: MusicKit's upcoming ids are an order-preserving
  *subsequence* of the model's (the window dedups + is bounded, so the model can have more,
  never reordered, and MusicKit must hold nothing the model doesn't).

## What gets logged
Auto-captured (no flag needed):
- `window:error`, `window:unhandledrejection` — uncaught errors land in the buffer
  automatically (e.g. the *"play() without a previous stop()/pause()"* rejection).

**Dev-only click-to-sound telemetry** (`src/perf.ts`, gated on Vite's `DEV` flag — the
installed build ships none of it; `npx vite build` + grep for `perf:` confirms). Every
song click (and every Next) stamps `perf:*` marks, each `{ ms }` since the click: `click`
(before the transient ingest) → `model` (playContext entered) → `context` (MusicKit
configured; differs from `model` only if the idle warm-up hadn't run) → `quiet` (the
pre-swap pause resolved) → `window` (`setQueue` resolved) → `sound` (MusicKit's
playbackState said `playing`) → **`audible`** (the media element's own `playing` event —
the honest end; MusicKit says `playing` 0.5–0.9 s before audio flows) → `resolve`.
`perf:span` lines time synchronous steps (`ingest`, `materialize`, `describe`,
`setContext`, `emit.loading`, and every track-store subscriber by label —
`library.reload`, `qcard`, `history`, `rewind`, `np.add`, `np.fav`, `np-bus.publish`).

Each play also writes **one line to the dev log** (`diag_flush` with a single line) so a
driver outside the webview — the CLI/MCP, a tail on `deetsmusic.log` — can read results:
`[perf] click→sound N ms (MusicKit said playing at S) · model+render · [init ·] pause ·
setQueue · stream {meta} | spans: … | net: @start+duration host/path …`. `meta` carries
the click (`where`, `n`, `ids`, `pos`, `fed` = descriptor or id form) plus session notes
(`eme` = the key system MusicKit asked for, `drm` = warm-up outcome, `itemsOff`,
`mkErrorEvent`). `net` is every request MusicKit made during the click, read from the
resource-timing buffer (account check, `webPlayback`, `widevineCert`,
`acquireWebPlaybackLicense`, the audio byte ranges). Out-of-click facts land as
`[perf] <event> {…}`: `grow` (the window top-up after a click), `deadNext`, `windowDry`,
`misalign`, `desync`, `itemsPlayFailed`, `playbackError`, `stateNoItem`, `abandon`
(`superseded` = a second click landed on top, `loadError`, `reclick`, `stale`).

**Driving it from outside — the recipes (2026-09-12).** `deetsmusic` MCP `play` returns
after the play resolves, so `grep "\[perf\]" %APPDATA%\com.deetsmusic.dev\deetsmusic.log
| tail -1` right after it is that play's line (the `audible` mark can land ~1 s later —
poll for the newest line). Only the dev app should be running, so the MCP finds its
bridge (the CLI probes the port list; the installed app would win).
- **Warm series:** `play` a few playlists in a row (`list playlists` for ids). The first
  play after a page reload is a *cool* one (fresh connections, the account check).
- **Song-to-song advance:** `play`, wait for the `grow` line, `control seek 97`, wait
  ~10 s, then `now_playing` + the log. A healthy advance logs nothing; `deadNext`,
  `windowDry`, `desync` or `misalign` are findings.
- **Dead ids:** the "Sad Collection" playlist (`list playlists`) has one; expect
  `reconcile: N unresolvable id(s) dropped` from the grow, never a skip at play time.
- **Cold start:** stop the dev exe (`Get-Process deetsmusic | ? Path -like '*target\debug*'
  | Stop-Process`; the `dev:app` runner exits with it), relaunch `npm run dev:app` in the
  background, wait for the `start:` line in the log, give the idle warm-up ~5 s, then
  `play`. A click inside the first 1.5 s pays the old init cost by design.
- **Queue restore:** `play`, `control next`, wait >1 s for the debounce, stop + relaunch,
  `list queue` should show the same Now + Up Next; `control play` resumes it.
Limits: the MCP always plays a list from its first song (a 3,895-row library click stays
a hand test), and its round trip is ~1 s, so Previous within 3 s of a click (the
re-window path) can't be reached from here. Vite reloads the page on every `src/` save,
which resets MusicKit and reloads `deadIds` from the db — useful for a fresh state, fatal
for a test in progress. To forget the saved dead ids, delete the rows in `dead_ids`.

Player events (`src/player.ts`):
- `player:configured` — MusicKit configured (+ authorized?)
- `player:playContext` — `{ startIndex, len }` a context started
- `player:jump` — `{ index }` an Up Next row jumped to
- `player:reclick` — `{ id }` re-clicked the song already playing → restarted, no rebuild
- `player:enqueue` — `{ where, n, libOnly }` Play Next / Add to Queue (`libOnly` = how many
  had no catalog id; watch it if a queued library-only song doesn't play)
- `player:queueEdit` — `{ op, index, mk, id }` Up Next Remove / Move-to-Top / Move-to-Bottom
  (`mk` = the resolved MusicKit queue index; `-1` = not in the window, edit was model-only)
- `player:misalign` — **model's upcoming diverged from MusicKit's window** (`{ where, mkPos,
  mkId, … }`). The auto-canary fired after an edit or on track-change; `where` says which.
  Run `__player.queue()` to see the full side-by-side. Like `player:desync` but for the
  *upcoming list*, not just `current`.
- `player:reconcile` — `{ d, mk, expected }` a drag-reorder (or future re-window) rebuilt
  MusicKit's upcoming from the first divergence `d` to the window end. Gapless.
- `player:shuffle` — `{ idle, n | up }` the one-shot shuffle button (`idle: true` = nothing
  was playing → whole library shuffled as a fresh context; `false` = upcoming reshuffled +
  reconciled)
- `player:deadIds` — `{ where, n, attempt, bad }` MusicKit rejected a feed with
  `NOT_FOUND` and the named ids were banked in the session denylist, then the op rebuilt +
  retried (`where` = which path: the window load, `enqueue:*`, `move-*`, `reconcile`). See
  [QUEUE.md §Dead ids](../features/QUEUE.md). Rare after the first contact (the denylist is saved); a
  *flood* of these means the sync is producing stale catalog ids.
- `player:deadLoaded` — `{ n }` the saved dead ids (last 7 days) loaded at launch
- `player:deadFresh` — `{ reason, fresh }` ids found dead for the first time on this install
  (the future toast's trigger)
- `player:loadWindow` — `{ ids, pos }` a window (re)fed to MusicKit
- `player:loadError` / `player:loadSkip` — a window load failed (error rethrown to the
  caller) / was superseded by a newer click before it ran (loads are serialized + coalesced)
- `player:np` — `snap()` on every `nowPlayingItemDidChange`
- `player:next` / `player:prev` — transport buttons (+ `snap()`)
- `player:desync` — **model's `current` ≠ MusicKit's now-playing item** (the bug class
  that froze Up Next). If you see these, model-follow is drifting.
- `player:roomSameSong` — `{ id, play, playing, at }` a room load found MusicKit already
  holding that song, so it seeked instead of rebuilding. The rebuild pauses before
  `setQueue`, and a paused descriptor feed leaves `nowPlayingItem` null (ROOMS.md §17.9).
- `room:resume` — `{ had, at, correcting, playing }` every `roomResumeAt`. **`had: false`
  is the one to watch**: MusicKit held nothing, so the room's song was re-fed and started.
  A `had: false` with no `sound:match` after it is a room stuck silent — the 2026-09-18
  bug, which returned here with no log line at all (ROOMS.md §17.9).

## Frame telemetry — `src/frames.ts` (dev only, 2026-09-13)

The smoothness counterpart of the click-to-sound telemetry, gated on the same `DEV`
flag (the release bundle carries none of it). It measures whether the main thread
produces a frame every display period during the gestures that have to feel buttery.

**Windows.** One per interaction, each closing with a single line in the console and
the dev log:
`[perf] frames <name> [<detail>] <elapsed> ms · N frames @<hz> Hz · dropped D (P%) ·
worst W ms [· first F ms] [· longtasks K (max M ms)]`. A dropped frame is a gap over 1.5× the display
period; `longtasks` are the browser's >50 ms main-thread tasks that overlapped the window
(the usual cause); `first` appears when the gap from the gesture's own start to its first
frame — the synchronous build (a pane render, a folder re-render) — is itself over budget. Names: `scroll <container>` (opens itself on any scroll event, closes
150 ms after the last one — `lib-view`, `panel__body`, `spane__scroll`…), `scrub
seek|volume` (a slider drag), `slide push|pop|search-push|search-pop` (a pane slide),
`fold open|close` (a Playlists folder), `drag queue|collection` (a reorder: an Up Next row, a
local playlist row), `drag cross` (a copy to another card, DRAG-DROP.md), `drag settings-section|home-section|collection-section` (a SECTION moved by a press-and-hold, MOVABLE-ROWS.md), `menu` (a context
menu opening), `appearance theme|skin` (the view transition), `sample` (manual),
`window a-b` (a windowed pane's edge patch that cost ≥ 4 ms — collection-window.ts; the
detail is the rendered item range after the pass).

**The display.** At launch + 3 s the module samples 40 idle frames and logs
`[perf] display <hz> Hz (period <ms>)`; every window is judged against that period, so a
144 Hz panel is held to 6.9 ms, not 16.7.

**Inputs.** The Event Timing API reports any press / click / key / wheel (hover traffic is
skipped, and the press-up-click trio painted in one frame logs once) whose input→paint took
over two periods: `[perf] input <event> <element-class> <ms> ms (delay <ms>)` — `delay` is
the wait before the handler ran (a busy main thread), the rest is the handler + paint.

**Driving it from the session.** `__frames` on the console: `__frames.hz`,
`__frames.begin("x")` (returns the closer), and `__frames.sample(ms)` — a window of the
given length whose summary line resolves the promise, so
`node scripts/webview-eval.mjs "document.querySelector('.lib-view').scrollBy({top:3000,behavior:'smooth'}); __frames.sample(1500)"`
scrolls the Library and returns the frame line (the auto `scroll` window logs its own
line too). Gestures with a pointer (scrub, drag) are hand tests.

**What it cannot see.** A compositor-only stall (a heavy GPU backdrop blur under the
Glass skin) delays rAF only once the frame pipeline backs up; a mild one slips through.
Pair a suspicious skin with devtools → Rendering → *Frame Rendering Stats* and *Paint
flashing*.

## Record player telemetry — `src/vinyl.ts` (dev only, 2026-09-15)

The Press record ([VINYL.md](../features/VINYL.md)) logs, on the same `DEV` gate, to the console and the dev log:
- `[perf] vinyl show <old key> → <new key> · new song | cover swap · src <file>` — every change of
  what the cover box shows. Two lines for one Next = a double slide; `→ station:<id>|` with
  `src none` = a radio gap; `(start)` = a fresh card mount (reload, surface change), not a slide.
- `[perf] vinyl snap <seek|count|zero> · err <ms> · at <s>` — every visible jump.
- `[perf] vinyl song … · start <angle>° exact|count · snaps N · nudge worst <ms>, rate <min>–<max> ·
  held stale/seek/zero · scrubs · left at <angle>°` — one per song. A natural end leaves near 0°.
- `__vinyl.sample(ms)` — rows every 100 ms: `[position s, error ms, rate, play state]`; steady play
  reads ±2 ms.

**The angle trace** (what is on screen, not what the driver believes): sample
`new DOMMatrix(getComputedStyle(spin).transform)` → `atan2(b, a)` for the newest `.vinyl__spin`
every 50 ms, next to `#apple-music-player.currentTime` and the slot count, while clicking the card's
own Next / play buttons through `webview-eval.mjs`. Steady play moves ~10° per 50 ms; a flat angle
while the audio moves is a late start; slots 2 → 1 → 2 is a double slide. The full snippet and how
each desk-test fault showed up: VINYL.md §8–§9.

`grep "\[perf\] vinyl" "%APPDATA%\com.deetsmusic.dev\deetsmusic.log" | tail -20`

## Reviewing the telemetry — the recipe (2026-09-13)

Where each signal lives and what "bad" looks like. All paths are the DEV app unless said.

1. **Frames.** `grep "\[perf\] frames" %APPDATA%\com.deetsmusic.dev\deetsmusic.log`. Read
   `dropped N (P%)`, `worst`, `first`, `longtasks`. A `worst` of 2× the period with no
   `longtasks` is a paint-heavy frame (Glass blur, cover decode); `longtasks` of 100 ms+ is
   the main thread — style, layout, or our JS. A line with `first` names a synchronous build
   (pane render, folder re-render) that alone blew the budget.
2. **Inputs.** `grep "\[perf\] input"`: press→paint over two frames, with the input delay
   split out. `delay` > 0 means the main thread was busy when the press arrived.
3. **Heaviness.** `scripts/heaviness-samples.log`, one line per app per sample
   (`installed` = the live app, `dev`, `dev-page` = the dev page's JS heap / DOM / img
   count). Written by `scripts/heaviness-sample.ps1 -Loop 3600` (a detached terminal
   loop; run it again after a reboot). A leak = `renderer` / `heap` / `dom` that only ever
   climbs across hours of use; a step up that then holds is a cache filling.
4. **Profile a suspect.** `node scripts/webview-profile.mjs "<expr>"` samples the main
   thread's JS while `<expr>` runs (a promise is awaited); `--trace` swaps in Chromium's
   timeline events (Layout, Paint, FunctionCall…) summed by name — the view that says what
   the engine did. The cold-scroll expression used on 2026-09-13 (a scrollbar-thumb drag
   through the whole Library in 120 frames, with the frame line as the result):
   ```
   (async () => { const w = (ms) => new Promise(r => setTimeout(r, ms)); const lib = [...document.querySelectorAll('.panel')].find(p => p.querySelector('.panel__title')?.textContent?.trim() === 'Library'); const v = lib.querySelector('[data-view]'); v.scrollTo({ top: 0 }); await w(300); const max = v.scrollHeight - v.clientHeight; let y = 0; const step = max / 120; const p = __frames.sample(2200, 'drag'); const f = () => { y += step; v.scrollTop = Math.min(y, max); if (y < max) requestAnimationFrame(f); }; requestAnimationFrame(f); return (await p).replace('[perf] frames ', ''); })()
   ```
   **Cold vs warm:** once a cover is in the renderer's memory cache the same pass is
   perfectly smooth, so a scroll measurement is only meaningful cold. `location.reload()`
   usually drops the memory cache (the disk cache stays — no Apple traffic) but not always:
   count `img.complete && img.naturalWidth` before the pass and retry if it is high.
   **Target the right list:** `document.querySelector('.lib-view')` is whichever card comes
   first — an 8-row Playlists view once passed for the Library.

### What the 2026-09-13 pass found
- **Cold Library scroll dropped ~80% of frames, on every skin.** The trace: 16 forced
  layouts of 140–200 ms, one per frame. Each batch of lazy covers loading dirtied layout,
  and the list was a flex column, so one dirty row re-laid out all 3,895. Fixed in
  `styles.css`: the list is a block stack and every art row is a relayout boundary
  (`contain: size layout` + a pinned `--lib-row-h`). After: no long tasks, worst 34 ms,
  Press 5% dropped, Glass ~50% two-frame gaps (its blur) with thousands of covers streaming.
  Not fixed: `decoding="async"` (kept, harmless), `content-visibility: auto` alone,
  `overflow-anchor: none`, containment on the `<img>` only. Grid densities (tiles) still
  re-lay out on cover arrival — untested, the tile height is not fixed.
- **Ambient skin loops cost up to two cores at idle — fixed.** The installed app idled at
  0.6% on Press and 21–27% on Ocean, same uptime, only the skin changed. Dev A/B (total
  CPU, 100 = one core, gpu + renderer processes, 10 s each):

  | skin | old | compositor-only layers | + stepped at 30 fps |
  |---|---|---|---|
  | Press | 5 | 6 | 4 |
  | Ocean | 46 | 46 | 12 |
  | Glass | 205 | 95 | 20 |
  | Cyber | 200 | 46 | 17 |

  Causes: Ocean moved SVG `<rect>`/`<g>` children, Glass animated `background-position`,
  Cyber animated `stroke-dashoffset` under a `drop-shadow` — all main-thread
  repaints every frame. Now each layer is plain boxes animating transform/opacity only
  (Ocean = masked tile boxes, Glass = one box per blob, storm = a clip wipe), traced at
  ~0 main-thread paint. The rest was compositing at the display rate: Ocean's fill masks
  roughly double GPU work per frame, and any motion under translucent cards redraws the
  window. `--ambient-fps` (skin token, 30) steps every loop, which cut that by ~⅔.
  Probe that found it (injected `<style>`): masks off 36→21, motion stopped →0,
  `steps()` at 30 fps →15.
- **Skin switch and grid scroll are whole-Library costs (tested, NOT fixed).** Dev app,
  Cyber, 3,897-row Library, styles injected at runtime (no file changes):
  - *Skin switch* (direct attribute flip, to the 2nd frame): 353–488 ms. Trace: one Layout
    172–192 ms + style 81–90 ms over ~23k nodes; the View Transition adds ~150–200 ms on top.
    `album-color.ts`'s rAF `getPropertyValue` (93 ms) only pulls that same style pass forward.
    `content-visibility: auto; contain-intrinsic-size: auto var(--lib-row-h)` on list rows →
    **112–145 ms**.
  - *Cold Small/Large grid scroll*: 83–91% dropped, 7–8 long tasks of ~345 ms. Trace: 8
    forced Layouts = 1,698 ms — the CSS Grid algorithm re-running over all 3,893 tiles.
    No tile-level fix helps: `contain: size` on the cover (344 ms), `content-visibility` on
    tiles (436 ms), a fixed-height `contain: size layout` tile (443 ms). Wrapping the tiles in
    blocks of 60 (each its own grid, the view a block stack): `contain: layout` blocks still
    281 ms; **`content-visibility: auto` blocks → 23% dropped, worst 54 ms, no long tasks.**
  - *Cold list scroll*: no long tasks, worst 42–54 ms, the same on Press and Cyber —
    paint/decode of ~2,000 covers in a 2 s scripted pass, not layout. Low priority.
- **WebView2 keeps drawing when the window is minimized or hidden to the tray.**
  `document.visibilityState` stays `visible` and rAF runs at 60/s. `src/ambient.ts` asks
  the window instead (resize / focus events + a `main-visibility` event from tray.rs's hide
  and show paths) and sets `data-ambient="paused"`, which pauses the loops in place.
  Not covered: a window left open behind a full-screen game (not minimized) — untested.
- **The appearance publish bug** (bridge `/health` reported the OLD skin after a switch):
  `publishAppearance()` ran outside the view transition, before the attribute flipped.
  Moved into the transition's `after` callback; verified by clicking through Press/Glass.
- **Library windowing (option A) built and measured the same evening — see
  [LIBRARY-VIRTUALIZATION.md](../architecture/LIBRARY-VIRTUALIZATION.md) §Results for the before/after table.**
  The skin-switch and grid-scroll costs above are fixed: skin flip 395–558 → 16–40 ms; cold
  grid drag 75–82% dropped with ~345 ms long tasks → 1–4% dropped, worst 8–21 ms, no long
  tasks; DOM 23,093 → ~850 nodes with the Library open. **A caveat for the drag recipe:** a
  windowing bug that collapses the scroll height makes the drag scroll nothing and report a
  perfect 0% — print `v.scrollHeight` with the result and distrust a 0% whose `worst` is
  under one frame.
- **Memory: where the installed app's ~386 MB goes, and the one build path left (2026-09-13
  late, process list after 3.7 h):** our Rust exe ~54 MB · WebView2 browser process ~100 MB
  (Chromium's in-memory HTTP cache, blobs, cache index) · renderer ~69 MB (the page; windowing
  keeps it there) · GPU process ~55 MB (compositor, ambient layers; *Animate backgrounds* Off
  trims it) · utilities ~105 MB (network, audio, storage services). The caches we own
  (`track-store`, the playlists' per-playlist track cache) are a few MB of JSON — clearing
  them saves nothing measurable and costs Apple calls. **Possible build path, not built:**
  WebView2's `MemoryUsageTargetLevel` (ICoreWebView2_19, webview2-com 0.38 has it) set to
  **Low** on the hide / minimize paths (tray.rs) and back to **Normal** on show — Chromium sheds
  its in-memory caches across the browser and renderer processes, expected ~50–100 MB while the
  app sits in the tray, refilled lazily on show; ~30 lines of Rust via `with_webview`, a
  runner restart, before/after from the sampler with the app in the tray. **Not** `TrySuspend`:
  it stops JS timers and MusicKit plays from inside the page — only safe when nothing plays,
  and the gain over Low is small. Caveat for a flat process listing: it lumps in other
  WebView2 hosts on the PC (four unrelated ~100 MB rows showed as "installed"); trust the
  sampler's per-tree sum.
- **On disk:** installer 6.2 MB, exe 19 MB, web bundle 1.3 MB (745 KB of it two Liberation
  Serif TTFs — WOFF2 would halve the bundle). WebView2 profile ~400 MB per identifier,
  almost all Chromium's HTTP cache, self-capped.

### What the 2026-09-16 appearance-switch pass found

A stress test of skin switching (the driver: `scripts/webview-eval.mjs` clicking
`[data-skin-choice]`, which is the REAL user path — the MCP `settings` route is tagged
`by=agent` and runs `--agent-motion` slower, which hides hitches).

**1. The rise length is deterministic, and Ocean is the outlier.** `appearance.ts` computes
`total = --boot-dur + --boot-stagger × (slots − 1)`. With the usual 6 bento slots:

| skin | `--boot-dur` | `--boot-stagger` | rise | measured |
|---|---|---|---|---|
| press | 0.50s | 40ms | 700 ms | 702 / 709 / 728 |
| cyber | 0.60s | 50ms | 850 ms | 853 / 856 / 882 |
| vanilla | 0.80s | 70ms | 1150 ms | — |
| glass | 0.90s | 60ms | 1200 ms | 1204 / 1206 / 1215 |
| **ocean** | **1.05s** | **95ms** | **1525 ms** | 1527 / 1529 / 1540 |

Ocean's rise is **2.2× Press's**, so it is exposed to any hitch for twice as long — that
alone is why slow switches were always Ocean. Shortening it would be a VISIBLE change to
Ocean's character, so it is the user's call, not a silent optimisation.

**2. `will-change: opacity, transform` on the rising panels is a trap.** Tried and reverted.
Chromium's main-thread trace improves a lot (style recalc over the Ocean rise 766 ms → 260 ms,
worst pass 11.5 ms → 3.2 ms) because each panel gets its own layer — but six full-size layers
carrying Ocean's gradients and Glass's frost must then be re-rastered, and the cost simply
moves to raster where the main-thread trace cannot see it. **Judge the rise by frames ÷ ms,
never by the trace alone.** There is a standing warning comment at the rule in `styles.css`.

**3. The refresh sample could poison a whole session (FIXED).** `sampleHz` took the MEDIAN of
40 gaps, once, 3 s after boot. A frame gap can only run LONGER than the true period — nothing
beats vsync — so busy work inflates gaps and nothing deflates them, and the median of a busy
sample is simply wrong. One reload with a profiler attached pinned a 244 Hz display at **34 Hz**,
after which every `dropped` verdict was judged against a 29 ms budget instead of 4.1 ms —
silently wrong, and in the forgiving direction. Now: the **20th percentile**, sampled at 3 s /
12 s / 40 s, and the period is only ever revised DOWN. `__frames.resample()` forces a reading.
**Check the `@N Hz` in any line before trusting its percentage.**

**4. An interrupted rise mislabelled the next one (FIXED).** A change landing during the lift
starts a fresh cover while the old whole-cover window is still open. `frameDetail` was only set
when that window opened, so the new rise wore the old skin's name — an interrupted Ocean rise
was followed by a 704 ms line (Press's length) still reading `skin=ocean`. The detail is now
rebuilt for every new cover. Note the two `appearance-lift` windows still overlap by design;
read them as "the rise that was abandoned" then "the rise that replaced it".

**5. Measurement caveat — this machine could not give a clean frame number.** With node, vite
and a CDP session competing for the same CPU/GPU, the same switch measured anywhere from
**36 to 236 fps** run to run. That variance dwarfs any optimisation, so no frame-based
optimisation was accepted from this pass. For a trustworthy number: a freshly started app, its
window in the foreground, no profiler attached, and check the `@N Hz` first.

### What the 2026-09-16 graphics-cost baseline found

`dev:built`, surface Max (1100×820), 244 Hz, no song, a clean GPU, 3 passes each, spread ≤ 8%
unless marked. The rows are in `scripts/perf-history.csv` with the notes `baseline` and
`baseline gpu=off (WARP)`. fps = frames ÷ ms. cpu = GPU process / page (100 = one core).

| scene | skin | RX 6700 XT | `--gpu=off` (WARP) |
|---|---|---|---|
| appearance | press | 239 fps · 10 / 18% | 227 fps · 19 / 13% |
| appearance | ocean | 236 · 20 / 37% | 165 · 56 / 24% |
| appearance | **glass** | 238 · 43 / 41% | **34 · 97 / 12%** |
| appearance | cyber | 236 · 22 / 32% | 209 · 33 / 25% |
| idle | press | 240 · 4 / 8% | 240 · 2 / 5% |
| idle | ocean | 240 · 6 / 16% | 204 · 31 / 10% |
| idle | **glass** | 240 · 12 / 15% | **31 · 98 / 4%** (spread 16%) |
| idle | cyber | 240 · 7 / 11% | 237 · 24 / 10% |
| scroll | press | 240 · 63 / 66% | 240 · 16 / 74% |
| scroll | **ocean** | **160 · 130 / 70%** (spread 19%) | **88 · 94 / 135%** |
| scroll | **glass** | 240 · 87 / 63% | **26 · 99 / 15%** |
| scroll | cyber | 240 · 87 / 79% | 217 · 89 / 96% |

**The feature list (the gap between the two columns):**

1. **Glass is the one skin that fails on software raster, in every scene.** Idle, switch and
   scroll all give 26–34 fps, with the GPU process near one full core. A/B at idle under
   `--gpu=off`: `.panel{backdrop-filter:none}` gives **178 fps, GPU 41%** (from 31 fps, 98%).
   Pausing only the aurora gives 71 fps, GPU 86% (spread 57%: trust only the direction).
   So the panel frost is the cost. The aurora drift is what makes the frost render again
   while nothing else moves.
2. **Ocean scroll is slow on the real card too** (160 fps, 49% dropped, GPU process 130%). A
   trace shows `CrGpuMain` 99.5% busy in raster (`DoEndRasterCHROMIUM`, ~7 ms a task). Hiding
   the sand layers (`.panel::before/::after`) under `--gpu=off` moved only 88 → 100 fps, so the
   sand is **not** the main cause. The cause is open. Next suspect: the swell
   (`.ocean__roll` / `.ocean__bob`) under a moving list.
3. Press and Cyber hold ≥ 209 fps under `--gpu=off` in every scene. They need nothing.
4. Not measured yet: the Press record player (needs a song; see the `playing` column),
   `--gpu=slow`, and the Mini / NP surfaces.

### Fancy Glass and the Ocean swell (2026-09-16, second pass)

Same setup as the baseline (`dev:built`, Max 1100×820, 244 Hz, 3 passes). Rows in
`scripts/perf-history.csv`, notes starting `glass painted`, `glass live`, `ocean …`,
`all skins scroll …`, and the same with a `gpu=off` prefix. `bench.mjs --attr glass-fancy=on`
flips the attribute for one run, so both forms use the same slider values (GLASS_LOCKED).

**Glass: painted frost (Fancy Glass off) against live frost (on).** Screenshots of the two
differ by 0.4 / 255 on average; 0.12% of pixels differ by more than 8 (the NP aurora turning).

| scene | RX 6700 XT painted | RX 6700 XT live | WARP painted | WARP live |
|---|---|---|---|---|
| idle | 240 fps · 10 / 17% | 240 · 14 / 9% | **240 · 11 / 8%** | 30 · 97 / 4% |
| scroll | 240 · 36 / 41% | 240 · 65 / 47% | **172–215 · 89 / 120%** (spread 25%) | 26 · 98 / 13% |
| appearance | — | — | **193 · 39 / 24%** | 34 · 95 / 12% |

So the live frost costs about **85% of frames without a graphics card** (the Fancy Glass hint).
On this PC it costs no frames, only GPU-process time (scroll 36% → 65% of a core).

**Ocean: what makes the scroll drop frames.** The baseline blamed "not the sand"; that was the
WARP reading. The two renderers disagree, so both are listed.

| Ocean scroll variant | RX 6700 XT | WARP |
|---|---|---|
| as shipped (Sand edges on the dev profile) | 157 fps · 126 / 63% | 63–82 · 95 / 117% |
| swell paused (still visible) | 162 · 129 / 64% | 210 · 50% GPU |
| swell hidden | 201 · 94 / 45% | 240 · 22% GPU |
| sand hidden (swell on) | 240 · 80 / 89% | 100 (baseline pass) |
| Soft edges | 239 · 92 / 96% | 67 · 95 / 54% |
| swell + sand hidden | 240 · 46 / 56% | — |
| **list scroller `will-change: scroll-position`** | **240 · 24 / 36%** | 110 (spread 51–70%: noise) · 91 / 25% |

Ocean idle under WARP: 176 fps · 42% GPU; swell paused or hidden → 240 · 2%. On the RX the idle
is already 240.

Reading it:
1. **On a real GPU the drop is the list repainting, not a layer.** The library scroller is not
   composited, so every scroll step repaints the card, and Ocean's sand mask (an SVG noise
   mask) is expensive to repaint. A composited scroller (`will-change: scroll-position`) fixes
   it with no visible change (0.03 / 255 inside the Library card), and it helps EVERY skin:
   GPU process in scroll 52→20% Press, 128→24% Ocean, 49→23% Glass, 85→19% Cyber; page
   CPU about halves. User's call 2026-09-16: apply to all card lists, with no visible change
   allowed. Status below (§The composited-scroller pass).
2. **Under WARP the swell is Ocean's cost**, in idle and in scroll. Pausing it is nearly as good
   as hiding it, so its motion (not its presence) is what software drawing pays for. The
   composited scroller does not help WARP frames reliably (spread too wide); it halves page CPU.

### The composited-scroller pass (2026-09-16, PAUSED part-way)

**Built, committed b59e575, shipped in 0.8.0:** styles.css `:is(.panel__body, .lib-view, .qcard__list, .spane__scroll,
.search__scroller) { will-change: var(--scroller-layer); }`. Skin token `--scroller-layer`: base
`auto`; Ocean, Glass and Cyber set `scroll-position`. Menus (`.set__menu`,
`.ctx-menu__fly`, `.slot-picker__menu`) and `.set__preview` are left out on purpose.

**Checked so far** (dev:built, RX 6700 XT, Max, Black & Red theme). The checks forced the rule
on or off with injected CSS; the token form is not re-measured yet:
1. **Blank rows on a fast wheel (the real risk).** Windowed Library (3,914 rows), CDP
   `mouseWheel` events recorded frame by frame with `Page.startScreencast`, then a scan for
   bands with no text:
   - hard spin (120 px every 25 ms): 0 blank frames, with the rule and without.
   - very fast (240 px / 16 ms): 199 frames with a blank band with the rule, 234 without.
     The worst band is 152 px both ways.
   - extreme (600 px / 8 ms): 48 blank frames with the rule, 94 without.
   So the rule adds no blank rows. The blanks at very high speed are **older than this change**:
   collection-window.ts renders only the visible rows plus a small margin during a scroll and
   fills its 1200 px buffer after the scroll pauses. That is a separate, open item.
2. **Offsets / look, each list scrolled to its middle** (Library windowed, Playlists, History):
   Glass, Cyber, Ocean Sand and Ocean Soft differ by ≤ 0.08 / 255 mean. No position shift.
   **Press differed (max 70 / 255):** Press cards are opaque, so the list text there uses colour
   (subpixel) smoothing. On its own layer the text falls back to grey smoothing, which is a visible
   softening (fringe chroma 102 → 36). **That is why the rule is a skin token**, and Press stays
   `auto`. Press scroll was already 240 fps.

**Left to do before handing it over:**
- Restart `dev:built` (the token form needs a new bundle) and repeat checks 1–2 with the token.
- Offsets on the lists not yet seen: **Home** (sideways `.search__scroller` shelves), **Settings**
  (`.panel__body`), **Queue** with a long Up Next, **Search results** and its sideways rows,
  an **artist view** (the sticky Songs bar, `.lib-view-bar`, over a composited list), a **grid**
  view (tiles), and the **Mini / midi** surfaces. Swap cards in with
  `document.querySelector('.panel[data-slot=c] .slot-picker__menu [data-card-id=home]').click()`.
- Drag checks: a queue row drag (row-drag.ts insertion line) and a cross-card drag over a
  composited list.
- Re-bench scroll on all skins with the token form (`bench scroll --passes 3`).
- **Swell, user's 2A:** measure Settings › Animate backgrounds › **Reduced** on Ocean under
  `--gpu=off` (idle + scroll). If it helps, add the cost to that row's hover hint (settings-card.ts,
  ONBOARDING ledger, SETTINGS.md), the way Fancy Glass states its cost. No new row (Off already
  holds the swell still).
- Throwaway scripts used for 1–2 (screencast flick, band scan, per-list screenshot diff) lived in
  the session scratchpad, not the repo. Rebuild from this description if needed.

## Measuring like the live app (2026-09-16)

The dev server is a poor stand-in for the installed app when the question is GRAPHICS. Three
differences, worst first:

1. **DevTools auto-opens in dev** and renders its own UI in the **same GPU process** as the
   app. Every graphics number taken with it open includes DevTools painting itself. This was
   the largest single distortion found.
2. **Vite serves unbundled modules and injects CSS as many separate `<style>` tags.** Release
   ships one minified bundle and one stylesheet, so style-recalc and script cost differ.
3. **`frames.ts` runs a rAF loop** whenever a window is open, which holds the page in
   continuous-render mode. Release has no such loop and can idle between frames.

So there are three run modes:

| command | bundle | DevTools | telemetry | use it for |
|---|---|---|---|---|
| `npm run dev:app` | vite dev | open | yes | normal work — logic, UI, HMR |
| `npm run dev:perf` | vite dev | **shut** | yes | quick graphics checks |
| `npm run dev:built` | **release-shaped** (`vite build`, minified, one stylesheet, served by `vite preview`) | **shut** | yes | **the honest graphics measurement** |

`--built` builds with `VITE_PERF=1`, which is the only thing that keeps `frames.ts` / `perf.ts`
/ `vinyl.ts` in a production bundle (`src/telemetry-on.ts`). A real release never sets it, and
**`release:check` fails the release if `[perf] frames` appears in the shipped JS** — so the
ruler can never ship by accident.

## Pretending to be a weaker machine — `--gpu=off | slow` (2026-09-16)

This PC has an RX 6700 XT driving a 244 Hz panel, which is not who the app is for. An Ocean
skin switch puts `CrGpuMain` at **86.9%** here, so the skins that lean on the GPU — Glass's
`backdrop-filter`, Ocean's gradients/grain/specks, the aurora layer, the vinyl spin — need
checking against hardware most people actually have.

```
npm run dev:app -- --perf --gpu=off      # the hard floor
npm run dev:built -- --gpu=slow          # release-shaped AND weak
```

| mode | what it does | stands in for |
|---|---|---|
| `--gpu=off` | `--disable-gpu --disable-gpu-compositing`. Chromium falls back to software (SwiftShader). | **Worse than any real integrated chip.** Survive this and you survive anything. |
| `--gpu=slow` | `--disable-gpu-rasterization --disable-accelerated-2d-canvas --force-gpu-mem-available-mb=64`. The GPU stays, raster moves to the CPU, its memory is squeezed. | An integrated part sharing system RAM. |

**Always confirm the flag took.** A silently-ignored flag makes every later number a lie, so
`frames.ts` logs the real renderer once per launch:

```
[perf] gpu SOFTWARE · Microsoft Basic Render Driver   ← --gpu=off really took (WARP, not SwiftShader)
[perf] gpu accelerated · ANGLE (AMD, AMD Radeon RX 6700 XT …)   ← normal
```

Two things to hold in mind when reading the result:

- **The refresh rate cuts the other way.** At 244 Hz the GPU has 4.1 ms a frame; on the 60 Hz
  laptop these modes stand in for it has **16.7 ms**, four times as forgiving. Work that
  nearly saturates here can sit comfortably inside a 60 Hz frame. Judge against the budget
  the target machine actually has, not this one's.
- **Measure on the physical display.** A remote-desktop or capture layer puts encode on the
  same GPU and inflates every reading.

## Benchmarking a scene — `scripts/bench.mjs`

```
npm run bench appearance -- --passes 3
npm run bench appearance -- --passes 3 --skins ocean,press
npm run bench idle   -- --passes 3 --note "baseline"          # settle on each skin, touch nothing
npm run bench scroll -- --passes 3 --note "baseline"          # bounce the library list, 0–1500 px
npm run bench scroll -- --skins ocean --css ".panel::before,.panel::after{display:none!important}"
```

**Four scenes.** `appearance` is a transition cost (the rise). `idle` is a steady cost (the
aurora, the sea, the album aurora, the record player if a song plays). `scroll` bounces the
library list inside its first 1500 px, after a warm-up bounce: a run down all 3,895 rows
measured artwork arriving from the network (250 ms frames), not the skin. `airplay`
(2026-09-17, review item 3) is one window over a song already playing on a speaker.

**Four CPU columns.** Frames ÷ ms stops at the display rate for any cheap scene, so each window
also records the CPU time of the GPU process and the page renderer (CDP `SystemInfo`, 100 = one
core). Under `--gpu=off` the GPU process is the rasteriser, so `gpu-cpu` is the whole draw cost.
Since 2026-09-17 each row also carries `host-cpu` and `host-MB`: CDP sees the WebView2
processes only, so the Rust exe — the AirPlay session, the tap ring, the SQLite work — was
invisible. PowerShell reads it, OUTSIDE the CDP pair, so the older `gpu_cpu_pct` and
`page_cpu_pct` rows stay comparable. Both are columns in `perf-history.csv`.

**Five gesture scenes** (2026-09-17, review item 4) cover what shipped after the first three
were written: `grow` (a real edge strip grows a card, then collapses it), `compass` (Ctrl+Space,
four keystrokes, Escape), `sound` (the title-bar panel opens and closes), `swap` (a card swap
through the slot picker, and back), `libsort` (the library's Sort pop: pick another key, then
the old one back). Each one drives the app's OWN control and puts the state back, so a pass
leaves the app as it found it; each returns a sentence instead of a number when its control is
not on screen, and the run fails with that sentence rather than reporting a gesture that did
not happen. `grow` is the same path as `deetsmusic grow <card> <dir>` — both end in
`growCard()` — so the CLI and the bench measure the same motion.

**The `airplay` scene** (`npm run bench airplay -- --ms 60000`) measures what the others
cannot: the host exe's CPU and working set, the in-page tap's chunk rate and worst gap
between chunks, and any `tap starved` line the session wrote in the window. It does **not**
connect a speaker — a script must not take a speaker a room is listening to — so connect one
in the app first, with Capture set to "This app", and start a song. It refuses with an
explanation otherwise, and it cannot measure All PC sound (loopback), which has no tap. The
500 ms prefill (AIRPLAY.md §12) was sized from one run; this is how it gets re-measured.

**`--css "<rules>"`** injects a stylesheet for the run and removes it after. That is the A/B:
hide or cheapen one feature under the same gate. The rules go in the row's note.

**The gate also reads the Windows GPU counters** (2026-09-16). A game held 97% of the 3D engine
through a whole baseline, and the idle check let it by: a steady load makes both idle samples
equally slow. The bench now refuses when another process uses over 10% of the GPU 3D engine,
and names it. `--contended` runs anyway, on purpose, and writes what shared the GPU into the
note. The `gpu` column is `on` / `off` / `slow` from the flags the runner passed, not from the
renderer string.

A single frame reading from this machine means nothing: on 2026-09-16 the same skin switch
measured **36 to 236 fps** run to run, with node, vite, a CDP session and an open DevTools all
competing. So the runner **refuses to report** unless the machine is fit to measure on:

- it re-samples the display refresh first (`__frames.resample()`), because a `dropped` figure
  judged against a stale rate is silently wrong;
- it **bails if DevTools is open**;
- it samples idle throughput twice and **bails if they disagree by more than `--tolerance`**
  (default 8%);
- it runs every switch `--passes` times and reports the **median and the spread**, never one run.

**Read `spread` before the median.** Over ~25% and the run is noise whatever the median says.
It restores the skin you were on when it finishes.

Every run that gets **past the gate** appends to **`scripts/perf-history.csv`**:

```
when,commit,tree,scene,skin,gpu,renderer,hz,passes,rise_ms,fps_med,spread_pct,worst_med_ms,drop_pct_med,note
```

It is written automatically and never by hand — a perf number typed into a doc is stale the
next day. Only gated runs are recorded, because a row from a noisy machine is worse than no
row: it looks like evidence. `--note "after the frost change"` labels a run, and a run on a
dirty tree is marked `dirty` and says so, since it cannot be reproduced from the commit alone.

`renderer` and `hz` are in every row on purpose: **rows are only comparable within the same
renderer and refresh rate.** Comparing an `accelerated` row at 244 Hz with a `software` row at
60 Hz says nothing. The file is committed, so a regression can be found by diffing it against
last week rather than by remembering.

## Reading CPU and GPU load — `scripts/webview-profile.mjs --trace`

`--trace` now prints **busy time per thread** before anything else, as MERGED INTERVALS, then
one thread broken down by event name (`--thread=gpu | compositor | viz | renderer`).

Two things it is built to stop you doing:

- **Do not sum inclusive durations.** Trace events nest, so a parent contains its children and
  summing counts the same microsecond repeatedly — that is how "UpdateLayoutTree 765 ms"
  appeared inside a 2.4 s window whose thread was 88% idle. The per-thread table merges
  intervals, so its percentages are real occupancy.
- **Do not read the renderer alone.** The trace used to show only `CrRendererMain`. On an Ocean
  skin switch the real picture is:

  ```
  CrGpuMain          1918 ms   86.9%     ← the GPU process, invisible before
  CrRendererMain      652 ms   29.5%     ← the only thing --trace used to show
  Compositor          153 ms    6.9%
  VizCompositorThread  94 ms    4.2%
  ```

  At idle `CrGpuMain` barely registers, so that 86.9% is the switch's own cost. A change can
  cut the page's work and still cost the user frames by pushing it onto raster — which only
  the per-thread table shows. `GpuVSyncThread` blocks on vsync, so its % is waiting, not load.

## What the 2026-09-17 health check found

The first run of the new tools, on branch `optimus-deets`, against the installed 0.9.5 and a
dev build. Two of the three open leads now have a named cause.

**1. The `tao` panic is the Windows shutdown, not the update.** The review read
`panic: cannot move state from Destroyed` (tao `event_loop/runner.rs:371`) as a fault in the
update's exit-and-install. It is not. The Windows System log (`Get-WinEvent -FilterHashtable
@{LogName='System'; Id=1074}`) has an Event 1074 "has initiated the power off of computer" at
**01:57:07 on 2026-09-17** and at **02:15:25 on 2026-09-16** — one second before, and at the
same second as, the two panics. The 09-17 update had finished 60 s earlier and the new app had
started, synced the library and reconciled favorites before the panic. So the panic is on the
Windows session-end path (`WM_QUERYENDSESSION` / `WM_ENDSESSION`): the loop is destroyed under
us and something still drives it.

A plain quit does **not** reproduce it: the dev app was quit through `app_quit` on 2026-09-17
16:09 and exited clean, no panic line. The next test is a real Windows restart with the app up,
and the paths to suspect are the ones that touch a window after the loop is gone — the
`WindowEvent::Focused(false)` → `hide_main` rule in `tray.rs`, and any bridge request still
being served while the process winds down.

**2. The AirPlay session never recovers from PC sleep, and never gives up.** In
`%APPDATA%\com.deetsmusic.app\airplay.log` the first `[session] keep-alive failed` is at
12:37:43 on 2026-09-17; the System log has "The system is entering sleep" at 12:37:44. The PC
woke at 15:49:52 and the very next line is another failure — then **~500 consecutive failures**,
one every 2 s, still going twenty minutes later, with the speaker still claimed.

What recovers and what does not is the useful part. The capture did: its first line after the
wake reads `capture heard sound: 313110 frames … in the last 12747 s` (it was starved for the
3.5 h of sleep), and from 15:59 it is back to a full `441882 frames` every 10 s. The RTSP
control channel did not, and never will: the keep-alive thread (DeetsAirplay `session.rs:501`)
logs the failure and loops for ever. Nothing counts the failures, tears the session down, or
tells the user — so the app holds a speaker it can no longer command. This is a design gap,
not a leak: the loop allocates nothing.

**3. The night-of-09-16 climb is still unnamed, but is now nameable.** The rows are
unambiguous: flat until `airplay: connect port 7000` at 23:54, then +70 MB per 10 min for two
hours (687 → 1374 MB) with `renderer` and `gpu` flat, and CPU 2.5% → 288%. No PC sleep in that
window. The app was measured again on 2026-09-17 16:06-16:08 in the state it is in now (session
up, keep-alive failing, nothing playing) and it is **flat** — 875 / 876 / 876 MB — so the idle
failing session is not the climb. The split now on every heaviness row will name the process
group the next time it happens; until then nothing here is worth guessing at.

## The 2026-09-17 frame pass — the gestures built since the last one

Measured on `npm run dev:built` (release-shaped bundle, DevTools shut), display 244 Hz, 3
passes per skin. `worst` is the median across passes of the worst frame gap in the window.
The rows are in `perf-history.csv` under the note "0.9.5 baseline, new gesture scenes".

Every scene ran on every skin, with the scene assertions in (a scene that cannot prove its
gesture happened returns a sentence and fails the run). `worst` is press / ocean / glass / cyber.

| scene | fps (med) | worst gap | dropped | gpu-cpu |
| --- | --- | --- | --- | --- |
| `grow` | 225–235 | 29 / 33 / 29 / 25 ms | 0.7 / **4.3** / 1.1 / 0.9% | 16 / **43** / 39 / 20% |
| `compass` | 235–236 | 29 / 29 / 38 / 33 ms | 0.6–0.7% | 9 / 11 / 24 / 11% |
| `sound` | 240 | 5 / 4 / 4 / 4 ms | 0.0% | 8 / 10 / 23 / 11% |
| `swap` | 234–238 | 21 / 21 / 17 / 17 ms | 1.0 / 1.6 / 0.7 / 0.7% | 10 / 27 / 30 / 19% |
| `libsort` (long list) | 239–240 | 8 / 12 / 8 / 8 ms | 0.1% | 5 / 7 / 14 / 9% |

`libsort` before the fix, on cyber: 232 fps, **112 ms**, page CPU 17%. After: 240 fps, 8 ms,
page CPU 13%. Ocean is the one skin that stands out, and only in `grow` (4.3% dropped and
43% GPU CPU against Press's 0.7% and 16%) — the known appearance cost, not a gesture cost.

**Read the incidental numbers with care.** The same gestures in the rolling log look far
worse — `grow left down` 175 ms, `menu compass` 175 ms, `pointerup lib-pop__opt` 280 ms —
because those were recorded in `dev:app`: unbundled modules, dozens of style tags and
DevTools rendering in the same GPU process. Where the two disagree, the bench is the honest
number and the log says which gesture to point it at. That is the division of labour between
them.

**The one real fault it found: the library sort built a collator per comparison.**
`collection-card.ts` compared strings with `a.localeCompare(b, undefined, { sensitivity: "base" })`.
Passing an options object builds a fresh collator on **every call**, and one sort of the
3,895-row library makes about 100,000 of them. Measured in isolation: **204 ms per sort
against 3.5 ms** for a single cached `Intl.Collator`. In the app, picking a sort key went
from a **112 ms** worst frame gap to **4 ms**, page CPU 17% → 8%, and the incidental
`pointerup lib-pop__opt` press→paint of 280 ms has nothing left to explain it.

The fix is one object moved out of the comparator, so the ordering is unchanged by
construction — ECMA-402 defines `localeCompare` with options as `Intl.Collator` with those
options. Checked anyway inside WebView2 over 225 pairs of accented, cased, CJK and
numeric-prefixed titles: **zero orderings differ**. The same pattern was fixed in
`artist-view.ts` and `playlists-card.ts`. A bare `a.localeCompare(b)` with no options is
**not** affected — V8 caches that path (1.2 ms per sort), so those call sites were left alone.

**Two faults in the bench's own PowerShell reads, found by using it.** Both matter because a
tool that lies is worse than no tool.

- **The host columns read the wrong process.** `hostNow()` picked the dev exe with
  `-match '\target\'`. PowerShell reads that regex as TAB + "arget", so it never matched
  and the code fell back to the FIRST `deetsmusic.exe` — the installed app, whenever it was
  running. It is now `-like '*\target\*'`, a literal wildcard with nothing to escape. Rows
  written before 2026-09-17 evening have an untrustworthy `host_cpu_pct` / `host_ws_mb`;
  `fps_med`, `worst_med_ms` and `drop_pct_med` are unaffected.
- **A spawn could hang the run.** Three runs in a row stopped inside the noise check
with a PowerShell still alive minutes later: `Get-Counter '\GPU Engine(*engtype_3D)\…'`
expands to every engine of every process and on a busy machine may never return, and
`execFileSync`'s own `timeout` did not end it. The same happened to the host read, which a
scene spawns about 24 times. Both now spawn async and are killed by hand — the GPU read at
12 s (the run carries on without the names, and says so), the host read at 5 s (that window's
host columns read 0). A run that never ends is worse than a column that is missing.

**A correction, because the first reading of this pass was wrong.** The Sound panel looked
like it held one ~82 ms frame on open, and that was written here. It does not: on
`dev:built` it opens in **4–5 ms on every skin**. The 82 ms came from `menu sound` lines in
the rolling log, which were written while the app ran under `dev:app`. It is the same trap
as the 280 ms sort click and the 175 ms grow — a third instance of the same mistake in one
day. **Do not quote a frame number that came from a `dev:app` log.** Use the log to choose
what to point the bench at, and the bench for the number.

## The leak run — `npm run bench <scene> -- --repeat N` (2026-09-17, review item 5)

`perf-history.csv` had no memory column, so a gesture that RETAINS something was invisible to
the one file that is committed. Two columns now ride every row — `page_heap_mb` (the page's
own JS heap) and `tree_ws_mb` (the working set of the whole app tree: the host exe plus every
WebView2 child) — and `--repeat N` turns a scene into a leak test:

```
npm run bench compass -- --repeat 10 --skins press
```

It runs the gesture N times, forces a collection (`HeapProfiler.collectGarbage`) and takes a
reading between each, then prints the table and a least-squares slope in **MB per run**.

Both numbers are kept because they fail differently. The **heap** catches a listener, a
closure or a detached node the JS side is holding. The **tree** catches what the heap never
sees — renderer layers, GPU textures, the audio graph, the host exe. A run whose heap is flat
while the tree climbs is exactly the shape of the night-of-09-16 climb, where `renderer` and
`gpu` sat still and ~700 MB grew in processes nothing named.

The **first run is not a leak** — a gesture builds its one-time structures then — so the
headline is the WARM slope, from run 1 on, with the cold step reported beside it. The Compass
makes the case: heap 7.6 → 10.0 MB on run 1, then 10.1–10.2 for seven more.

Read the trend over all N, never two readings: Windows hands memory back lazily, and one
collection that did not finish looks exactly like a small leak. Re-run before believing a
small positive slope — the first two runs of this tool prove the point:

| scene | runs | heap warm slope | tree warm slope | verdict |
| --- | --- | --- | --- | --- |
| `compass` | 8 | +0.19 → cold step only | −1.87 MB/run | clean |
| `swap` | 8 | **+0.04 MB/run** | −0.02 MB/run | suspicious |
| `swap` | 20 | **+0.00 MB/run** | +0.02 MB/run | clean — the +0.04 was noise |

Twenty card swaps retain nothing. Had the 8-run number been trusted, it would have started a
hunt for a leak that is not there.

**The columns changed, so the writer migrates.** Every new column has been appended just
before `note`, so a file written by an older bench has shorter rows. On 2026-09-17 the header
was left behind while the rows grew — 19 names over 21 fields, which makes the history
unreadable in a spreadsheet. The writer now re-spells every old row against the current
columns and rewrites the file, so it is always square and nothing is lost.

## Trending start-up — `node scripts/boot-log.mjs` (2026-09-17, review item 7)

`[perf] frames boot` existed but nothing kept it, so start-up could not be trended — and the
rolling log holds only one rotated generation, so a boot older than about a megabyte of lines
is simply gone. This harvests every start-up still in the log into `scripts/boot-history.csv`,
which is committed. Rows are keyed by app + start time, so running it twice is safe; run it
after a session, before the log rotates past what you care about.

```
node scripts/boot-log.mjs              # harvest, then print the last 12 and the medians
node scripts/boot-log.mjs --show 30
node scripts/boot-log.mjs --json
```

A row carries the version, `to_first_paint_ms` (the app's own `start:` line to the first
painted frame — what the person actually sits through), the boot window frames.ts measured,
its dropped % and worst gap, the long tasks, and whether the GPU was accelerated.

**It sees the dev app.** The boot line rides the telemetry gate, so an ordinary installed
release writes none — by design. An installed build made with `VITE_PERF=1` does, and that is
the only way to trend the real thing.

**First harvest, 2026-09-17:** dev median `to_first_paint` **3683 ms (0.8.0) → 2465 ms (0.9.0)
→ 2352 ms (0.9.5)**, with the boot window itself steady around 905 ms. Start-up got faster
across the two versions that made the app feel bigger, which is the opposite of the worry that
prompted the pass.

## Reading the logs — `scripts/perf-report.mjs` (2026-09-17, review item 2)

Reviewing used to be `grep | tail` by hand, so "did it get worse" had no answer. One command
now reads the rolling log (the rotated generation included) and the heaviness log, and prints
**p50 / p95 / worst with the row count** per name.

```
node scripts/perf-report.mjs                 # the dev app's log + heaviness, whole file
node scripts/perf-report.mjs --installed     # the installed app's log instead
node scripts/perf-report.mjs --since 2h      # 30m | 2h | 3d | "2026-09-16 23:00"
node scripts/perf-report.mjs --file <path>   # any log file, or several
node scripts/perf-report.mjs --all           # every row, not the worst 15
node scripts/perf-report.mjs --json          # the same numbers as JSON
```

What it reads, and what each table answers:

| table | from | answers |
| --- | --- | --- |
| `click→sound` | `[perf] click→sound`, keyed by `where` | how long a play takes, and how much of it is MusicKit's own |
| `frames` | `[perf] frames <name>` | the worst gap and the dropped % per gesture |
| `input` | `[perf] input` | press → paint |
| `faults` | `sound:clockSlip`, `sound:startLost`, `sound:tapRate`, `airplay:tapDisarmed`, `[perf] abandon`, `panic` | a count that climbs between two runs |
| `airplay capture` | `capture heard …` | ok / partial / silent |
| `heaviness` | `scripts/heaviness-samples.log` | MB and CPU per app, and per process bucket once the row carries the split |

It starts nothing and reads only files already on this PC. The two runs are compared by
running it twice with different `--since` windows.

## Heaviness sampler — `scripts/heaviness-sample.ps1`

One line per running app (installed + dev) per sample: summed working set, the largest
renderer, the GPU process, and a 5 s CPU rate (100 = one core), then the dev page's heap /
DOM / img counts when the dev app answers on its CDP port. `-Loop N` repeats every N
seconds and appends to `scripts/heaviness-samples.log` (gitignored) until the terminal
closes. Bare `deetsmusic.exe` processes with no WebView2 children (the CLI / MCP bridges)
are skipped. The tree walk keys on the exe name, so both apps report even when the installed
one has no CDP port.

**The split and the context (2026-09-17, review item 1).** A row used to say how heavy and
never what the app was doing, so the night of 09-16 climbed 700 MB in processes nothing
named. Each row now carries:

```
2026-09-17 15:56 installed up=246min total=871MB renderer=220MB gpu=228MB cpu=18.4%
  | host=64MB/0.9% webview=136MB/0% renderer=220MB/8.4% gpu=228MB/9% audio=28MB/0%
    network=47MB/0% cdm=108MB/0% utility=23MB/0% other=16MB/0%
  | skin=cyber theme=lilac surface=max playing=yes airplay=tap sound=on vinyl=off tray=shown
```

- **The split** is `MB/CPU%` per process type, from each process's own `--type=` /
  `--utility-sub-type=`. The parts add up to `total`. `host` is the Rust exe, `webview`
  the WebView2 browser process, `cdm` the Widevine sandbox that decrypts the stream.
- **The context** is `GET /health` on the bridge (ports 47825-47828). That route is
  unauthenticated, so the sampler reads it with no token; it carries what the app is DOING
  and never what it is playing — a title on an unauthenticated route would leak the
  listening. An app built before this change answers `skin` and `theme` only and the rest
  of the line is left out.
- Only one app can hold a bridge port, so with both apps running the context belongs to
  whichever bound it first (normally the installed one, which starts at login).

## What the tools cannot yet see — the 2026-09-17 review

A session that runs the CLI (`bench`, `webview-eval`, `webview-profile`, the heaviness sampler)
and reads `perf-history.csv` has enough to measure a *scene* and to A/B a *graphics change*.
It does not have enough to attribute a *live* regression, which is what the heaviness log
showed the same day. The evidence, then the gaps, in the order they matter.

**The evidence.** `heaviness-samples.log`, the installed app, the night of 2026-09-16: at 23:44
the tree sat at 687 MB and 2.5 % CPU; at 23:54 the log has `airplay: connect port 7000`
(the loopback capture) and the next sample reads 162 %; over the next two hours the tree
climbed to **1374 MB and 288 %** while `renderer` (≈250 MB) and `gpu` (≈145 MB) stayed flat,
so ~700 MB grew in processes the sampler does not name. The app's own log for that window holds
nothing but the 10 s `capture heard` lines and Last.fm. At 12:04 the next day, the same app on
the same speaker (Cyber, Max, a song playing): the tree at 864 MB and 91 % — the host exe at
**5.6 % and 62 MB**, the renderer and the GPU process each ~40–50 % averaged over the run. So
the AirPlay session itself is cheap; what the night's climb was cannot be told from what was
recorded. Also in that log, at 01:57:08: `panic: cannot
move state from Destroyed` (tao `event_loop/runner.rs:371`) — an exit-path bug, unrelated to
load, not yet filed. (It read as a fault in the update's exit-and-install; the health check
below shows it is the Windows shutdown one second later.)

**The gaps, ranked by what they would have answered.**

1. **A heaviness row has no context and no per-process split.** It says *how heavy*, never
   *doing what*. Add to each installed/dev line: skin, surface, playing, AirPlay (off / loopback /
   tap), Sound on, record player on, hidden to tray — the installed app answers `/now-playing`
   and `/settings` on the bridge already, so the sampler can ask — and one figure per process
   type (`host`, `renderer`, `gpu`, `audio`, `cdm`, `network`, other), which the command line's
   `--type=` / `--utility-sub-type=` gives for free. The night's 700 MB would then have a name.
2. **No reader for the logs.** Reviewing means `grep | tail` by hand. A `scripts/perf-report.mjs`
   that parses the dev log's `[perf] click→sound`, `[perf] frames <name>`, `[perf] input`,
   `sound:clockSlip` / `startLost`, the `airplay: capture heard` verdicts and the heaviness log,
   and prints p50 / p95 / worst per name with the row count, turns a review into one command
   and makes "did it get worse" a diff of two runs.
3. **The bench does not see the host exe.** `gpu_cpu_pct` and `page_cpu_pct` are its only CPU
   columns. With AirPlay's session and the new tap ring in Rust, add `host_cpu_pct` and
   `host_ws_mb` (Win32 `GetProcessTimes` / working set through PowerShell, or the CDP
   `SystemInfo.getProcessInfo` list already read for the other two), and an `airplay` scene:
   connect, 60 s of a song, then `__sound.status().tap.worstGapMs`, the session's
   `starved_packets` and the host CPU. The prefill (AIRPLAY.md §12) was sized from one T3 run;
   a scene makes it a number that is re-measured.
4. **Three scenes only** (`appearance`, `idle`, `scroll`). Nothing repeatable for the
   gestures built since: card grow / fill, the Compass (open + type), a card swap, the Sound and
   AirPlay panels, a queue drag, the record player at Press. Each is an `evaluate` of the app's
   own buttons plus a `__frames.sample`, ~10 lines in `bench.mjs`; a scene that exists gets run.
5. **Memory is not in the CSV.** `perf-history.csv` has no working-set column, so a leak that a
   scene causes (a repeated card swap, a Compass open/close loop) is invisible to the one file
   that is committed. Add `page_heap_mb` (`performance.memory` / CDP `Runtime.getHeapUsage`)
   and `tree_ws_mb` per row, and a `--repeat N` that runs a scene N times and reports the slope.
6. **The installed app cannot be benchmarked** (no CDP port, by design), so a number from
   `dev:built` is the honest stand-in. Keep it that way; but the heaviness sampler is the one
   tool that does see the installed app, which is why item 1 comes first.
7. **Smaller:** the `[perf] frames boot` line exists (925 ms, 2 long tasks, 2026-09-17) but no
   row keeps it, so start-up cannot be trended; `heaviness-samples.log` is gitignored (right)
   but has no retention, so it grows forever (3,568 lines today); a rotated `deetsmusic.1.log`
   keeps one generation, so a window older than ~1 MB of lines is gone — the night above
   survived by luck of the rotation at 01:56.

None of these is a harness: each is a column, a scene or a reader on the tools that exist.
Suggested order: 1, 2, 3 (together they answer "what was the app doing when it got heavy"
from a session), then 4 and 5 as gestures come up for review.

**Built 2026-09-17 on branch `optimus-deets`: items 1, 2 and 3.** Item 1 is the per-process
split plus the `/health` context (§Heaviness sampler); the app side is `bridge.rs`
(`Appearance` + the `/health` fields), `np-bus.ts` (`publishAppearance` carries surface,
sound and vinyl), `surface.ts` and `sound.ts` (one publish each when the state flips). Item 2
is `scripts/perf-report.mjs` (§Reading the logs). Item 3 is `host_cpu_pct` / `host_ws_mb` and
the `airplay` scene in `bench.mjs` (§Benchmarking a scene). Items 4-7 stay open; item 7's
first half (a row for `[perf] frames boot`) is partly answered, because perf-report now trends
`boot` from the log without a CSV row.

## Profiling the webview — `scripts/webview-profile.mjs` (dev only)

Same CDP discovery as webview-eval. Without flags: V8's sampling profiler over the
expression, top functions and files by self time — `(program)` is the engine outside JS.
`--trace`: the `devtools.timeline` categories, complete events summed by name with count
and max on the renderer's main thread (picked as the thread with the most Layout / style /
paint / script time). Inclusive times: `RunTask` contains everything under it.

## Driving the webview — `scripts/webview-eval.mjs` (dev only)
The MCP and CLI reach the player through the bridge. They cannot run console calls such
as `__toast.demo()` or `__diag.dump()`. For those, `npm run dev:app` opens a WebView2
remote-debugging (CDP) port on the main window. The port is the first free one from 9222
up. The runner prints it (`webview CDP on 9222`) and appends it to the main window's
`additionalBrowserArgs` in the generated `src-tauri/.tauri.dev.gen.json`. It does not
use the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var, because that would replace the
window's own args, the autoplay flag included.

```
node scripts/webview-eval.mjs "__toast.demo()"
node scripts/webview-eval.mjs "__diag.dump(); __diag.flush()"   # or return a value:
node scripts/webview-eval.mjs "JSON.parse(localStorage.getItem('deets.settings')).toasts"
```

- The expression runs in the main window as a console line, with a user gesture (so a
  clipboard write works). Promises are awaited. The value prints as JSON.
- Exit 1: the expression threw (the message prints). Exit 2: no dev config, no port, or
  no main-window page.
- The port binds to loopback and exists only under `dev:app`. `npm run tauri dev` and the
  release build have no port. A change to the port setup needs a runner restart.
- A save to a front-end file (yours or another session's) reloads the page: an eval running
  then fails with `Execution context was destroyed`, and the reload stops the song. A Rust
  change takes the port down until the rebuild ends — wait for `netstat -ano | grep ":9222 "`.
- To drive playback from an eval, click the app's own buttons
  (`document.querySelector('.np__controls [aria-label="Next"]').click()`,
  `#np-playpause`), not MusicKit directly, so the queue model stays right. The `deetsmusic`
  MCP tools reach the INSTALLED app.

## Audio quality — `probe fidelity` (DeetsAirplay, 2026-09-16)

Sound quality is measured, not judged by ear. The probe lives in the DeetsAirplay repo, because it
measures that crate's capture code: `cd ../DeetsAirplay/src-tauri && cargo run --release --bin probe
-- fidelity`. It mutes the master volume, plays test tones and prints the numbers. With `--listen 35`
it records while this app plays the schedule instead: `node scripts/webview-eval.mjs "$(cargo run -q
--bin probe -- fidelity js)"`. Do not run it during a bench or while anything plays. AUDIO-QUALITY.md
has the chain and the results; DeetsAirplay `docs/architecture.md` § Measuring audio quality has the
reference.

## Toasts — the `__toast` console handle + the morning test script
The toast primitive ([TOASTS.md](../architecture/TOASTS.md)) exposes `window.__toast` in every build:

| Call | Does |
|---|---|
| `__toast.demo()` | one toast of each kind at once — info, success, warn, error (the error stays until Dismiss) |
| `__toast.push({ kind, text, sticky, timeout, actions, dismissKey, priority })` | the raw API, returns `{ dismiss, update, shown, queued }` |
| `__toast.queue(n = 4, priority?)` | push `n` sticky toasts: three show, the rest queue (TOASTS.md §4a.7). `"ask"` makes them questions, which jump the line and expire after 30 s |
| `__toast.waiting()` | what is in the queue right now, ask-first |

**Playlist refresh** (PLAYLIST-REFRESH.md) has its own handle, `window.__refresh`:
`all()` lists every covered playlist with its mode, whether that mode is a stored choice or
its kind's default, when it was last read and whether it is due; `due()` lists only the due
ones; `rows()` is the stored table raw; `check()` runs the day-change check on demand
(the same work as the Compass verb *Refresh playlists now*). Its diag key is
`playlist:refresh` — `arm`, each `fire` with how many were due, `open`, `offer`, `took`,
and a `warn` per failed read.
| `__toast.notice()` | a one-time notice under the throwaway key `deets.notice.demo` |
| `__toast.reset()` | forgets that demo key, so the notice shows again |

Every call lands in the diag buffer as `toast` `{ kind, text, sticky, notice }` or
`toast:muted` `{ why: "tier-off" \| "tier-failures" \| "notice-off" }`, so
`__diag.dump()` (or `__diag.echo(true)`) shows what fired and what the tier swallowed. The
queue (TOASTS.md §4a) adds `toast:queued`, `toast:dequeued`, `toast:dupe` and `toast:dropped`
`{ why: "stale" \| "dismissed" \| "notice-off" \| "queue-full" }` — a sticky toast that never
reached the screen is always traceable, which is the point of the feature.
`__diag.flush()` writes the buffer to `deetsmusic.log`, so a driver outside the webview
can read it: `grep "toast" %APPDATA%\com.deetsmusic.dev\deetsmusic.log | tail`.

**Test script (first desk test, 2026-09-13 build).** Devtools console unless noted; the
setting is Settings › Menus, hints and notices › **Show notices**, default *Everything* (was *Failures* before 2026-09-13).

1. **Look.** `__toast.demo()` in midi: a top-right stack under the Now Playing card,
   newest on top, at most 3 (the stack is capped, so `demo()`'s four toasts show the last
   three — the oldest timed one yields; the sticky error survives). The song title stays
   visible. Resize the window: the stack follows the card's bottom edge. Hover a timed
   one: its bar stops draining; leave: it resumes. Press Dismiss on the error. Repeat on
   **max** (Settings menu › Surface): the stack is under the titlebar. Repeat on **mini**:
   under the card, and the strip clamps to the window width. Then cycle a few themes (the stripe
   follows the traffic lights — Moonlight/Noir/Siren stay in-family) and skins (Glass
   frosts the strip; Press squares it). Set Windows' *Show animations* off and `demo()`
   again: no slide.
2. **Tier.** Set *Off*: `__toast.demo()` shows nothing; `__diag.dump()` has four
   `toast:muted`. Set *Failures*: `demo()` shows warn + error only. Set *Everything*: all.
3. **Notice.** `__toast.notice()` → press *Don't show again* → `__toast.notice()` again
   shows nothing (`toast:muted`, `notice-off`) → `__toast.reset()` → shows again. Then
   the real one: right-click a catalog song not in your library › **Add to Library** →
   the "Added. Apple has no undo…" notice. A second add in the same session: silent under
   *Failures*, "Added to your library." under *Everything*. Restart: the notice returns
   once per session until you press Don't show again (`localStorage["deets.notice.addOneWay"]`).
4. **Copy Link.** Under *Everything*: right-click a song › Copy Link → "Link copied."
   Under *Failures*: silent. (A failure needs a denied clipboard — skip.)
5. **Start Station.** Hard to force; a seed with no station is rare. If you know one,
   use it. Otherwise trust the unit: the branch that used to `console.warn` now toasts.
6. **Dead songs.** Play a song whose catalog id Apple dropped (the log's
   `player:deadFresh` from a past session names candidates, or `__music` search for a
   pulled release). Expect one warn "Skipped “Title” — Apple Music no longer offers it."
   Play it again: silent (the mark is on disk). The mark expires after 7 days,
   and then the id is tried again.
7. **Sign-in timeout.** Dev builds read `localStorage["deets.dev.signInTimeoutMs"]`
   (`apple.ts`) to shorten the 5-minute wait. First back up
   `%APPDATA%\com.deetsmusic.dev\user-token.txt`, because Disconnect deletes it. Set the key
   to `15000`, press Account › Disconnect, then Sign in, and ignore the browser tab. After
   15 s: the sticky "Sign-in did not complete." error. Then remove the key, stop the dev
   app, put the token file back, and relaunch: the dev app is signed in again, with no
   browser sign-in. The release build ignores the key.
8. **No token.** `DEETS_DEV_NO_TOKEN=1 npm run dev:app` (debug builds only; `apple.rs`
   `ensure_developer_token`) acts as if the local key, the token cache and the mint all
   failed. The log has `token: no developer token: forced by DEETS_DEV_NO_TOKEN`, and the
   window opens with the sticky "Can't reach the token service." error (`role="alert"`,
   Dismiss). Relaunch without the variable to recover. Desk-tested 2026-09-13.
9. **From the CLI/MCP** (`deetsmusic` tools, AGENT.md): a play that lands on a dead id
   still writes its `[perf]` line, and `__diag.flush()` from the console (or the next
   crash/close) puts the `toast` line beside it in the log. There is no bridge route to
   raise a toast; the console handle is the driver.

10. **Replay, Rewind unlock, no subscription — the dev hooks.** These fire on their own
    schedule or need an account you do not have, so dev builds (`import.meta.env.DEV`;
    the release bundle has none of it) add `__toast.sim`. Each hook runs the real code
    path, not only the toast. Replay and Rewind are `success` / `info`, so set
    **Everything** first; the no-subscription hint is a `warn` and shows under *Failures*.

    | Call | Does | Side effect |
    |---|---|---|
    | `__toast.sim.replay()` | `runWeeklyReplay(true)`: skips the `replayAuto` setting and the due-day check → "Replay updated: N songs from this week." | **Real run.** It rewrites the rolling "Replay" playlist (or adds a dated one with `replayKeep`) and stamps `deets.replay.lastRun`. Fewer than 5 songs played in the past 7 days: no toast, and `__diag.dump()` has `weekly skipped`. |
    | `__toast.sim.rewind()` | clears `rewindAutoShown`, lifts the in-memory start count to 50, runs the unlock → "Rewind unlocked…" | Sets `rewindCard` on and `rewindAutoShown` back to true, as the real unlock does. The play count on disk does not change. |
    | `__toast.sim.noSub()` | marks a fresh sign-in, then feeds `onPlaybackError` a synthetic non-"unavailable" error → "Playback failed after sign-in…" (8 s) | A `player:playbackError` line with `msg: "sim: …"` in diag. **Play a song from a list first**: the handler ignores errors outside queue mode, and the hook warns in the console in that case. |
    | `__toast.sim.armNoSub()` | marks a fresh sign-in only | The next real playback error that is not a dead song raises the hint. Use it to test the real MusicKit error text. |

    Checks: each call once → one toast. `noSub()` twice → two toasts, because each call
    arms again. After `armNoSub()`, a dead-song error does not use up the arm. Under
    *Off*, each call gives `toast:muted` in `__diag.dump()`.

Still not testable from your desk: the real MusicKit error text for an Apple ID with no
subscription. After a sign-in with such an account, read `msg` in `player:playbackError`.
If that text matches `/unavailable/i`, the hint never fires. Then `isUnavailable` in
`player.ts` needs a narrower test.

## Sign-in — the hosted page + deep link (dev only, 2026-09-13)

DATA-ARCHITECTURE.md §2a. A debug build answers `deetsmusic-dev://` (registered at every
launch, HKCU); the installed app owns `deetsmusic://`. Log lines to look for, all under
`sign-in:`: `hosted page opened in the browser: <url>` (the nonce is in that url),
`hosted page unreachable … using the local page`, `link arrived with no sign-in in
progress; ignored`, `link nonce does not match …; ignored`, `the hosted page reported a
failure: <reason>`, `user token captured`.

- **From a Claude desktop session, the scheme may not be really registered** (2026-09-13,
  DATA-ARCHITECTURE §2a "RESOLVED"). The Claude app is an MSIX package, and Windows puts
  `HKCU\Software\Classes` writes from its child processes (its shells, a `dev:app` started
  from them) into a private hive. Symptom: Edge's console says *"the scheme does not have a
  registered handler"* and shows no dialog, while `reg query` from the same session finds
  the key and `cmd /c start` of the link reaches the app. **Check the real registry** with a
  process started outside the package (WMI):
  ```powershell
  Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine =
    'cmd /c reg query HKCU\Software\Classes\deetsmusic-dev /ve > C:\Users\Public\scheme.txt' }
  Get-Content C:\Users\Public\scheme.txt
  ```
  "unable to find" there = not registered. **Fix:** start `npm run dev:app` from your own
  terminal once (it registers at launch), or write the same four values through WMI
  (`powershell -EncodedCommand …` as the command line). Keep a shell `start` test as a
  test of Windows → app only: it cannot prove what a browser sees.
- **Seeing what Edge looks up:** Process Monitor (`winget install
  Microsoft.Sysinternals.ProcessMonitor`), filter *Path contains* the scheme, click the link
  from a page console (`location.href = "<scheme>://x"`). `/Runtime` did not stop an
  unfiltered headless capture here (2.8 GB in 90 s); use the GUI with a filter.

- **Point the app at a Worker preview** instead of the live page: in `../DeetsSupport`,
  `npx wrangler dev --remote --port 8790` (remote, so the deployed secrets sign), then
  `DEETS_SIGNIN_BASE=http://localhost:8790 npm run dev:app`. The release build has no override.
- **Start a sign-in from outside the app:** `node scripts/webview-eval.mjs
  "window.dispatchEvent(new Event('deets:sign-in'))"` — the same event the "Sign in"
  toast button sends. Then read the url from the log line and open it yourself.
- **A stray link** (no sign-in pending) must be ignored: from a shell,
  `cmd /c start "" "deetsmusic-dev://auth?n=deadbeef"` → the ignored line above. Quote it:
  `cmd` splits an unquoted `&`.
- **Cancel:** click the Account button again while it waits → `sign-in: cancelled from
  the Account row`, the row paints back, no toast, the loopback port (47831) closes within
  a second. Closing the LOCAL page's tab instead → `the page reported a failure: page
  closed` and the "didn't finish" toast. Closing the hosted page's tab tells the app
  nothing (a browser cannot open a deep link on unload): cancel from the row.
- **A refused token** end to end: start a sign-in, read the nonce from the log, open
  `deetsmusic-dev://auth?n=<nonce>&mut=nothing` → `Apple refused the delivered token
  (403); not saved` and the app's "didn't accept the sign-in" toast. A `&error=x` link
  instead → `the hosted page reported a failure: x` and the "didn't finish" toast.

## Recipe — debugging a player issue
1. Reproduce the bad behaviour.
2. `__diag.dump()` (or `__diag.copy()` to paste it somewhere).
3. Read the tail: does `windowPos` track `npIndex`? Any `player:desync`? Did
   `player:loadWindow` fire with a sane `pos`? Is there a `window:unhandledrejection`?
4. For "what does MusicKit actually expose?" questions, poke `__music` directly.

## Recipe — the user reports a playback complaint, and you were not there (2026-09-18)

You cannot reproduce it by clicking: the app is on his screen, not yours. Three reads
answer it, in this order, and none of them needs a restart.

1. **What was played, and from where.** The SQL tool over `plays` dates every start and
   names the surface it came from:

   ```sql
   SELECT s.title, p.started_at, p.listened_s, p.skipped, p.context
   FROM plays p LEFT JOIN songs s ON s.id = p.song_id
   ORDER BY p.started_at DESC LIMIT 15
   ```

   `context` is the load-bearing column. `home` and `search-albums:123` are different
   gestures, and a row per second is a flurry of clicks, not one. This read alone usually
   shows the SHAPE of the bug: which click took, which did not.

2. **What the app did between those plays.** `deetsmusic diag` (or the `diag` MCP tool)
   reads the window's live ring — the `ui:act` gesture, the drill, the `player:*` lines,
   any toast. `--tag player` or `--tag ui:` narrows it. This is the step that names the
   bug; on 2026-09-18 it was one line, `player:reclick`.

3. **The log file** (`%APPDATA%\com.deetsmusic.app\deetsmusic.log`) only for what is
   older than the ring (300 events) or from an earlier session. It auto-flushes every
   5 minutes, so it is at most that far behind.

**What NOT to do:** do not guess between code paths from reading the source. Two paths
that look identical in the file can behave differently because of the queue's state at
the moment of the click. Read what happened.

## Why did it pause — `player:pause` (2026-09-21)

> **Part:** built · 2026-09-21

Before this, a pause left no trace of its source (the 2026-09-21 "new trick" pause, 14 s
into the song, could not be explained). Now every time MusicKit leaves `playing` for
`paused` or `stopped`, the ring gets one line:

`player:pause {why, state, id, at, mode}` — `at` is the song position in seconds.

| `why` | Source |
|---|---|
| `button` | the Now Playing / mini play button |
| `space` · `compass` | the Space key · the Ctrl+Space bar |
| `tray` | the tray panel |
| `windows` | the Windows media session: a media key, a headset or Bluetooth button, the volume flyout (smtc.rs) |
| `airplay` | the HomePod: its touch surface, Siri, the Home app (airplay.rs) |
| `agent` | the MCP / CLI / bridge |
| `sleep` | the sleep timer |
| `load` · `station` · `station-stop` | our own pause before a new list or a station |
| `room` · `room-hold` · `room:<source>` | a listening room: the host's command, a hold, or our own press sent to the room |
| `outside` | no note from our code in the last 5 s: MusicKit paused by itself, or WebView2's own media-key handling |

How it works: each pause we cause calls `notePause(why)` in player.ts first; the
`playbackStateDidChange` handler reads the note. Rust stamps `from` on every `np-command`
(bridge.rs `NpCommand`). `player:exit` is logged on `pagehide` if a song was playing
(best effort: the flush may not finish before the window dies).

**Desk test:** play a song, then pause it once from each of: the play button, Space, the
tray panel, a keyboard media key, and the HomePod (if routed). `deetsmusic diag --tag
player:pause` shows five lines with `button`, `space`, `tray`, `windows`, `airplay`.

## MusicKit quirks learned (so we don't relearn them)
- **`music.queue.position` is empty in this build** — use `music.nowPlayingItemIndex`
  for the live index. (Relying on `queue.position` froze the queue model.)
- **`changeToMediaAtIndex` starts playback itself** — the sequence is **pause → setQueue →
  changeToMediaAtIndex(pos) → play()** with `play()` guarded by `!isPlaying` (calling it
  while playing throws *"play() without a previous stop()/pause()"*).
- **Never call `changeToMediaAtIndex(0)` on a fresh queue** — `setQueue` already sits at
  index 0, and the call makes MusicKit race itself (its internal event handler fires a
  second `play()` on top of the in-flight one → the same *"without a previous
  stop()/pause()"* as an **uncaught rejection**). At `pos === 0`, plain `play()` is the
  whole job. (Bit us 2026-07-02, queueing an album from idle.)
- **Feed ops are all-or-nothing on unresolvable ids** — `setQueue`/`playNext`/`playLater`
  reject the *entire* batch with `NOT_FOUND: One or more items could not be resolved: <ids>`
  if even one catalog id has gone stale (region pulls/takedowns). The player self-heals
  (banks the named ids, retries with library-id fallbacks — `player:deadIds` above); see
  [QUEUE.md §Dead ids](../features/QUEUE.md).
- **`currentPlaybackTime` is whole seconds, rounded down** (measured 2026-09-15: 3 while the
  audio read 3.145), and `playbackTimeDidChange` fires about every 265 ms. For an exact clock
  read `document.getElementById('apple-music-player').currentTime` — but that `<audio>`
  exists only while a song plays (none when stopped).
- **After a seek, MusicKit reports the old position for a moment** before the new one lands;
  a UI that follows every report flickers back (the scrubber did — VINYL.md §6).
- **Radio gaps:** between two station songs the state carries the station with no title and
  no artwork for a moment (VINYL.md §5).
- See HANDOFF "Known gotchas" for the canonical list.

## Future: in-app "Report a problem"
`diag.report()` is intentionally the payload. The remaining piece is a Settings row that
bundles `report()` + environment (app version, theme/skin, connection status, last
error) and lets the user copy / save / send it — so a bug report arrives already
actionable. Not built yet; the capture (above) is.

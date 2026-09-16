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
  [QUEUE.md §Dead ids](QUEUE.md). Rare after the first contact (the denylist is saved); a
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
local playlist row), `drag cross` (a copy to another card, DRAG-DROP.md), `menu` (a context
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

The Press record ([VINYL.md](VINYL.md)) logs, on the same `DEV` gate, to the console and the dev log:
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
  | Retro-Future | 200 | 46 | 17 |

  Causes: Ocean moved SVG `<rect>`/`<g>` children, Glass animated `background-position`,
  Retro-Future animated `stroke-dashoffset` under a `drop-shadow` — all main-thread
  repaints every frame. Now each layer is plain boxes animating transform/opacity only
  (Ocean = masked tile boxes, Glass = one box per blob, storm = a clip wipe), traced at
  ~0 main-thread paint. The rest was compositing at the display rate: Ocean's fill masks
  roughly double GPU work per frame, and any motion under translucent cards redraws the
  window. `--ambient-fps` (skin token, 30) steps every loop, which cut that by ~⅔.
  Probe that found it (injected `<style>`): masks off 36→21, motion stopped →0,
  `steps()` at 30 fps →15.
- **Skin switch and grid scroll are whole-Library costs (tested, NOT fixed).** Dev app,
  Retro-Future, 3,897-row Library, styles injected at runtime (no file changes):
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
  - *Cold list scroll*: no long tasks, worst 42–54 ms, the same on Press and Retro-Future —
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
  [LIBRARY-VIRTUALIZATION.md](LIBRARY-VIRTUALIZATION.md) §Results for the before/after table.**
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
| retro-future | 0.60s | 50ms | 850 ms | 853 / 856 / 882 |
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
[perf] gpu SOFTWARE · Google SwiftShader           ← --gpu=off really took
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
```

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

## Heaviness sampler — `scripts/heaviness-sample.ps1`

One line per running app (installed + dev) per sample: summed working set, the largest
renderer, the GPU process, and a 5 s CPU rate (100 = one core), then the dev page's heap /
DOM / img counts when the dev app answers on its CDP port. `-Loop N` repeats every N
seconds and appends to `scripts/heaviness-samples.log` (gitignored) until the terminal
closes. Bare `deetsmusic.exe` processes with no WebView2 children (the CLI / MCP bridges)
are skipped. The tree walk keys on the exe name, so both apps report even when the installed
one has no CDP port.

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

## Toasts — the `__toast` console handle + the morning test script
The toast primitive ([TOASTS.md](TOASTS.md)) exposes `window.__toast` in every build:

| Call | Does |
|---|---|
| `__toast.demo()` | one toast of each kind at once — info, success, warn, error (the error stays until Dismiss) |
| `__toast.push({ kind, text, sticky, timeout, actions, dismissKey })` | the raw API, returns `{ dismiss, update, shown }` |
| `__toast.notice()` | a one-time notice under the throwaway key `deets.notice.demo` |
| `__toast.reset()` | forgets that demo key, so the notice shows again |

Every call lands in the diag buffer as `toast` `{ kind, text, sticky, notice }` or
`toast:muted` `{ why: "tier-off" \| "tier-failures" \| "notice-off" }`, so
`__diag.dump()` (or `__diag.echo(true)`) shows what fired and what the tier swallowed.
`__diag.flush()` writes the buffer to `deetsmusic.log`, so a driver outside the webview
can read it: `grep "toast" %APPDATA%\com.deetsmusic.dev\deetsmusic.log | tail`.

**Test script (first desk test, 2026-09-13 build).** Devtools console unless noted; the
setting is Settings › Look and feel › **Show notices**, default *Everything* (was *Failures* before 2026-09-13).

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
  [QUEUE.md §Dead ids](QUEUE.md).
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

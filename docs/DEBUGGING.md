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
- See HANDOFF "Known gotchas" for the canonical list.

## Future: in-app "Report a problem"
`diag.report()` is intentionally the payload. The remaining piece is a Settings row that
bundles `report()` + environment (app version, theme/skin, connection status, last
error) and lets the user copy / save / send it — so a bug report arrives already
actionable. Not built yet; the capture (above) is.

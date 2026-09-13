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
worst W ms [· longtasks K (max M ms)]`. A dropped frame is a gap over 1.5× the display
period; `longtasks` are the browser's >50 ms main-thread tasks that overlapped the window
(the usual cause). Names: `scroll <container>` (opens itself on any scroll event, closes
150 ms after the last one — `lib-view`, `panel__body`, `spane__scroll`…), `scrub
seek|volume` (a slider drag), `slide push|pop|search-push|search-pop` (a pane slide),
`fold open|close` (a Playlists folder), `drag queue` (a queue row), `menu` (a context
menu opening), `appearance theme|skin` (the view transition), `sample` (manual).

**The display.** At launch + 3 s the module samples 40 idle frames and logs
`[perf] display <hz> Hz (period <ms>)`; every window is judged against that period, so a
144 Hz panel is held to 6.9 ms, not 16.7.

**Inputs.** The Event Timing API reports any press/click/key whose input→paint took over
two periods: `[perf] input <event> <element-class> <ms> ms (delay <ms>)` — `delay` is
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
setting is Settings › Window › **Show notices**, default *Failures*.

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
   Play it again: silent (the mark is on disk). A cache reset (Settings › Library)
   makes it fresh again.
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

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
  [QUEUE.md §Dead ids](QUEUE.md). Routine after a fresh launch; a *flood* of these means the
  sync is producing stale catalog ids.
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

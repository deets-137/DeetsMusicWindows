# UX Cover-ups — latency & jank ledger

> A running list of places where the app has unavoidable latency or jank that we
> *paper over* rather than eliminate. The intent is to build the fundamentals first
> with **minimal interim cover-ups**, then do one **holistic UX pass** that handles
> them consistently (shared loading affordance, motion, optimistic patterns) instead of
> bolting on one-off spinners as we go.
>
> When you add something that "feels instant but isn't," log it here.

## The shared signal
`PlayerState.loading` (in `src/player.ts`) is `true` while a **(re)window is buffering**
— i.e. any transport action that leaves MusicKit's preloaded window and forces a fresh
`setQueue` + stream load. Natural play never sets it. Subscribe via `onPlayerState` and
key cover-ups off this one flag so they stay consistent.

---

## 1. Jump-to-item (Up Next click) — **buffering gap**
**Where:** `qcard.ts` row click → `player.jumpToUpcoming` → `loadFromModel` re-windows.
**Why:** MusicKit only preloads the *immediate* next track. Jumping several songs ahead
(or to anything outside the live window) re-feeds the queue and the new song must buffer
before audio starts — a perceptible silent gap after the click.
**Interim cover-up (in place):** the Qcard optimistically swaps Now Playing to the
clicked track immediately (model is authoritative the instant you click), and dims the
cover (`.qnow--loading`) while `loading` is true. So the *click* feels instant even
though *audio* lags.
**Holistic pass should add:** a consistent loading treatment on the **Now Playing
strip** too (it currently only updates when MusicKit catches up), e.g. a subtle
progress shimmer / disabled transport during `loading`.

## 2. Previous beyond the window — **buffering gap**
**Where:** `player.prevTrack` (native skip) works gaplessly *within* the window; rewinding
past the backlog edge isn't built yet, but when it is it will re-window → buffer.
**Status:** not yet implemented (re-windowing at edges is roadmap). Same `loading` hook
will apply.

## 3. Scrubbing / seek — **buffering gap**
**Where:** `player.seekToFraction` → MusicKit `seekToTime` on a DRM stream.
**Why:** seeking re-buffers from the new position; audio doesn't resume instantly.
**Interim cover-up:** none yet — the scrubber fill moves optimistically (the drag
already updates the bar before release), but there's no buffering indicator.
**Holistic pass should add:** a buffering state on the scrubber after release (e.g. a
pulsing fill / spinner at the handle) until playback resumes; debounce rapid seeks.

## 4. First play / context start — **configure + buffer**
**Where:** the first `playPause`/`playContext` of a session also lazily configures
MusicKit (token fetch + `configure`) before the first song buffers — the slowest start.
**Interim cover-up:** none specific (it's a one-time, first-interaction cost).
**Holistic pass could add:** warm MusicKit on idle after launch, or a first-play
loading state.

---

## Holistic pass — guiding ideas (when fundamentals are done)
- **One loading vocabulary:** drive every cover-up off `PlayerState.loading` (+ a future
  `buffering` for seeks) so spinners/shimmers/disabled-states look and time the same.
- **Optimistic-first:** update the UI from the *model* immediately on intent; let audio
  reconcile. The Qcard jump already does this — generalize it.
- **Tokenize the motion:** any pulse/shimmer/transition becomes a skin token (currently
  the Qcard's loading dim is a plain opacity + a component-scoped token placeholder), so
  skins can restyle it like everything else.
- **Honest, not fake:** cover-ups should reflect real state (loading is loading), never
  hide a failure. On a load error, surface it — don't spin forever.

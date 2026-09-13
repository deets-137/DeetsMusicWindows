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

## 4. First play / context start — **configure + buffer** (mostly fixed 2026-09-12)
**Where:** the first `playPause`/`playContext` of a session used to lazily configure
MusicKit (token fetch + `configure`, ~1 s) and spawn the browser's DRM module (~0.6–1.3 s
inside the first stream). **Fixed:** `main.ts` calls `warmPlayer()` 1.5 s after launch —
MusicKit configures and the Widevine module is created at idle. A click inside that
1.5 s still pays the old cost.
**What remains (Apple's):** the first play per page still makes an account check, three
cold TLS handshakes (api / play / audio hosts), the Widevine service-certificate fetch
and the license — measured 1.7–1.9 s click-to-audible cold vs 1.0–1.7 warm. The
candidate cover-up was a *preload of the restored song at launch*. **Probed and rejected
the same day:** `setQueue` (descriptor form) fetches **nothing** on its own — the request
list 4 s after it is empty — and this MusicKit build has **no `prepareToPlay`**. The only
way to make MusicKit load a song is to play it: a muted play-then-pause at idle, which
reports a play to Apple, fires our play-start stats unless guarded, and flickers the
transport/SMTC to "playing" for a beat. Not built without a decision. The queue itself
IS restored at launch ([QUEUE.md](QUEUE.md) "Restore across sessions"): the first Play
goes through the normal load and pays the cold cost above.

## 5. The click-to-audible ledger (2026-09-12, measured with `src/perf.ts`)
Where the time goes on a warm click now that our own part is ~10 ms:
- **pre-swap teardown, inside `setQueue`** — 150–700 ms, only when a song was playing:
  MusicKit reports the outgoing song's play activity (`universal-activity-service/play`)
  and tears the pipeline down before it accepts the new queue. Zero on the first play.
- **asset lookup** (`webPlayback`, two in parallel) — 110–300 ms.
- **license** (`acquireWebPlaybackLicense`) — 135–290 ms, after the first byte range.
- **buffering** — 8–10 sequential byte-range fetches at MusicKit's ~90 ms cadence before
  the element's `playing` fires — 500–800 ms. MusicKit's loader, not the network (each
  fetch is ~10 ms warm).
Native Next is the same shape minus the teardown (~1.0 s): MusicKit preloads only the next
item's asset lookup, not its license or bytes. **Holistic pass candidates:** a hover
pre-insert (`playNext` the hovered row's descriptor so MusicKit's next-item preload runs,
then `skipToNextItem` on click) is the only lever below the ~1 s floor; the paused restore
at launch covers cold.

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

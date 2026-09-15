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

## 6. Launch — **the window forms instead of assembling** (built 2026-09-15, desk test pending)
**What showed before:** the main window appeared at creation, before the page existed:
WebView2's white, then the theme's canvas, then a resize to the saved surface size
(`initSurface`), then the cards filling in one by one.
**Now:** the main window starts hidden (`tauri.conf.json` `visible: false`). The page paints
behind an opaque `--canvas` cover (`<html data-boot>`, index.html), then calls `main_ready`
(tray.rs), which gives the window the canvas color and shows it. The cover fades and the
cards rise into place, one slot after the next (`src/boot-cover.ts`).
- **Ready** = queue restored + library loaded + window at its size, capped at 2.5 s.
- **Clicks:** blocked until the queue is restored (a Play press before that played the
  library from the top), then they pass while the rest finishes and the fade runs.
- **Tokens** (skin tier): `--boot-dur`, `--boot-ease`, `--boot-rise`, `--boot-stagger`,
  `--boot-safety`. Snaps under reduced motion or with Animate look changes off.
- **Fail-safes:** Rust shows the window after 3 s whatever happens (`reveal_fallback`, logs
  a warn); a CSS animation lifts the cover at `--boot-safety`. A `--tray` launch never
  shows the window here. `[perf] frames boot` measures the fade; `boot:ready` in the diag
  log gives the wait and whether the cap fired.
- **Restored scrubber:** while MusicKit holds no song, Now Playing shows the restored song's
  length, and after an update restart its saved position (`emitRestoredProgress`).

## 6a. Look change — **the launch animation, not a snap** (built 2026-09-15, desk test pending)
**Before:** a View Transition. A theme crossfaded; a skin played its own entrance (Press stamp,
Ocean rise, Glass focus, Retro-Future snap). A skin switch dropped 37% of its frames at 238 Hz,
because the new skin painted during the animation.
**Now (user's call: 1A, 2A, 3B):** every theme and skin change, from the title menu or the look
schedule, runs the launch cover (`src/appearance.ts`) with one more stage:
- **veil** — the cover fades in over the old look (`--cover-in-dur` / `--cover-in-ease`, the
  OUTGOING skin's); the cards stay in place.
- **wait** — the cover is opaque. The look changes, the new skin's fonts load, and two frames
  paint under the cover. The cover's color glides from the old `--canvas` to the new one.
- **lift** — the launch rise, on the INCOMING skin's `--boot-*` tokens.
- **Per skin (3B):** each skin sets `--boot-dur`, `--boot-ease`, `--boot-rise`, `--boot-stagger`
  and `--cover-in-dur`, which also tunes its launch: Press short and firm, Ocean long and deep,
  Glass soft with a slight scale, Retro-Future a hard skew that straightens.
  `--boot-cover-out` (default `var(--boot-dur)`) times the cover's fade apart from the cards:
  Retro-Future clears the cover in 0.18 s, then the cards finish their 0.6 s skew (desk
  feedback 2026-09-15: the first cut was too short, with too much black screen).
- **Playback and clicks:** only the `<html>` attributes change; the player is not touched.
  Clicks pass in every stage.
- **Several changes:** one during veil or wait joins the same cover; one during lift fades the
  cover back in. Snaps when Animate look changes is off, under reduced motion, or while the
  launch cover is still up. `[perf] frames appearance` measures it.

## 6b. Agent changes — **a slower cover, and the surface change goes under it too** (planned 2026-09-15, NOT built)
**Why agents only:** a change the user clicks is expected, so it stays as fast as §6a. A change
an agent makes (AGENT.md §6: `settings set theme | skin | surface`) arrives with no click, often
while the user looks elsewhere. It must read as a calm, deliberate change, not a flash.
**Today:** an agent's theme or skin set runs the §6a cover at the user's speed. An agent's
surface set calls `applySurface` → `setSize` with no cover: the window jumps, and WebView2
relays out in view.

**The plan:**
- **One cover for all three.** `withAppearanceTransition` takes a third kind, `"surface"`. The
  resize runs in the **wait** stage, while the cover is opaque, so the relayout is never seen.
  This is the route NEXT-VERSION.md §10 left open ("no window motion and a content crossfade
  only"). It does not animate the window size: a stepped native resize can't reach frame rate.
- **Async jobs.** `applySurface` awaits `setSize`, so a job's `fn` may return a promise, and
  `swap()` awaits every job before the fonts and the two frames.
- **Slower for agents.** An `{ by: "agent" }` option marks the cover: `<html data-boot-by="agent">`.
  One skin token, `--agent-motion` (base `1.6`; a skin may change it), scales `--cover-in-dur`,
  `--boot-dur`, `--boot-cover-out` and `--boot-stagger`. Scale through a separate property to
  avoid a custom-property cycle: the cover rules in styles.css read
  `calc(var(--boot-dur) * var(--motion-scale, 1))`, and
  `html[data-boot-by="agent"] { --motion-scale: var(--agent-motion) }`. `tokenMs()` in
  boot-cover.ts multiplies by the same scale, so the JS timers match the CSS.
- **Batched.** An agent often sends theme, skin and surface one after another. They join the
  same cover through the existing veil/wait join (§6a "Several changes"): one slow cover, not
  three.
- **Callers.** `agent-settings.ts`: `pickLook` passes `{ by: "agent" }`; the `surface` spec
  wraps `applySurface` in `withAppearanceTransition("surface", …, { by: "agent" })`. Title menu
  and look schedule calls stay unchanged.
- **Snaps**, as §6a: Animate look changes off, reduced motion, or the launch cover still up.
- **Measure:** `[perf] frames appearance` gains the kind `surface` and a `by=agent` tag.

**Forks to settle before building (morning):**
1. **Surface under the cover for user picks too?** (A) Agents only, as planned. (B) Every
   deliberate surface pick (title menu, tray open): the cover also hides today's jump.
   Recommended: A first, desk-test it, then decide B.
2. **How much slower?** (A) One scale token, `--agent-motion` (1.6). (B) A full set of
   `--agent-*` duration tokens per skin. Recommended: A — one number to tune at the desk.
3. **Say who changed it?** (A) No text; the info toast "An agent set …" already says it.
   (B) A short label on the opaque cover ("Changed by an agent"). Recommended: A.

**Test in the morning:** dev app, debug CLI (`--port` of the dev bridge), Agent changes settings
= Allow. `settings set theme "Black & Red"`, then `settings set surface mini`, then theme, skin
and surface back to back. Check `[perf] frames appearance` in the dev log for each.

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

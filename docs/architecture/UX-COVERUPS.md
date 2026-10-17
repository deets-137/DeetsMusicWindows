---
status: sop
desk_test: none
sources: [src/player.ts, src/perf.ts, src/boot-cover.ts, src/appearance.ts, src/look.ts, src/rules-facts.ts, src/reveal.ts, src/reveal-wave.ts, src/keyed.ts, src/art-size.ts, src/mosaic.ts, src/artwork-heal.ts]
updated: 2026-10-17
---
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
**Now Playing (built 2026-09-18, fork 1A):** the card already painted the incoming title and
cover from the model at click time (`now-playing-card.ts`, the between-songs gap-fill), so
the text was instant. What lagged was the clock: the scrubber and the times kept the OLD
song's position under the NEW title for up to 1.6 s, because the outgoing song still ticks
through MusicKit's teardown. Now `player.ts` `emitLoadingProgress` sends one progress report
the moment `loading` goes true — the incoming song at 0:00 (or its saved resume position after
an update restart) with its own length; the launch path, `emitRestoredProgress`, is the same
function — and `emitProgress` holds the old song's ticks back while `loading` is true. Every
progress subscriber follows: the card, the tray panel, the Sound panel, the record. **No report
when the length is unknown** (a station, a catalog song the store has not seen): the sleep timer
reads "seconds left" from progress, and a zero-length report made it take the next song change
for the song's own end (found in review, 2026-09-18). Then the old clock simply stops until the
new song reports. MusicKit's own ticks take over when it does. No shimmer, no disabled
transport: the measured gap after a warm click is 0.7–1.6 s (§5) and the text is already
right, so a reset clock is the whole treatment. The Qcard's dims are skin tokens now
(`--qcard-idle-dim`, `--qcard-loading-dim`).

## 2. Previous beyond the window — **buffering gap**
**Where:** `player.prevTrack` (native skip) works gaplessly *within* the window; rewinding
past the backlog edge isn't built yet, but when it is it will re-window → buffer.
**Status: built.** `player.prevTrack` re-windows around the previous entry when MusicKit sits
at index 0 and the model has history (`player:prevRewindow` in the diag log). It goes through
`loadFromModel`, so `loading` and §1's treatment apply. A station has no backward walk (a
restart only, STATIONS.md).

## 3. Scrubbing / seek — **buffering gap**
**Where:** `player.seekToFraction` → MusicKit `seekToTime` on a DRM stream.
**Why:** seeking re-buffers from the new position; audio doesn't resume instantly.
**Cover-up in place (logged 2026-09-18, built earlier):** the drag moves the fill before
release, and after release the handle **holds where it was let go** until a progress report
lands within a second of it, for up to 1.5 s (`seekHold` in `now-playing-card.ts` and the
tray panel's twin). Without the hold, the old position arrived for a beat and the handle
flicked back before it jumped forward. **Closed:** no buffering indicator. The hold is honest
(the handle is where the song will be) and the gap is short; a pulse at the handle would be
more motion than the wait deserves.

## 4. First play / context start — **configure + buffer** (mostly fixed 2026-09-12)
**Where:** the first `playPause`/`playContext` of a session used to lazily configure
MusicKit (token fetch + `configure`, ~1 s) and spawn the browser's DRM module (~0.6–1.3 s
inside the first stream). **Fixed:** `main.ts` calls `warmPlayer()` at launch — MusicKit
configures and the Widevine module is created off the click path. Since 2026-09-29 it starts
when the window shows (`deets:window-shown`, under the cover's lift) instead of a fixed 1.5 s
after the handler: the player is warm ~0.9 s sooner, and the lift drops no more frames
(DEBUGGING.md §Launch). A click before the warm-up ends still pays the rest of the cost.
**What remains (Apple's):** the first play per page still makes an account check, three
cold TLS handshakes (api / play / audio hosts), the Widevine service-certificate fetch
and the license — measured 1.7–1.9 s click-to-audible cold vs 1.0–1.7 warm. The
candidate cover-up was a *preload of the restored song at launch*. **Probed and rejected
the same day:** `setQueue` (descriptor form) fetches **nothing** on its own — the request
list 4 s after it is empty — and this MusicKit build has **no `prepareToPlay`**. The only
way to make MusicKit load a song is to play it: a muted play-then-pause at idle, which
reports a play to Apple, fires our play-start stats unless guarded, and flickers the
transport/SMTC to "playing" for a beat. Not built without a decision. The queue itself
IS restored at launch ([QUEUE.md](../features/QUEUE.md) "Restore across sessions"): the first Play
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
item's asset lookup, not its license or bytes. **Closed (2026-09-18):** the hover pre-insert
(`playNext` the hovered row's descriptor so MusicKit's next-item preload runs, then
`skipToNextItem` on click) was the only lever below the ~1 s floor and was skipped on
2026-09-12 — it mutates MusicKit's queue on a hover. The paused restore at launch was
rejected in §4. The floor is Apple's; the cover-ups above are the whole answer.

## 6. Launch — **the window forms instead of assembling** (built 2026-09-15, committed c978fc6, shipped in 0.5.0)
**What showed before:** the main window appeared at creation, before the page existed:
WebView2's white, then the theme's canvas, then a resize to the saved surface size
(`initSurface`), then the cards filling in one by one.
**Now:** the main window starts hidden (`tauri.conf.json` `visible: false`). The page paints
behind an opaque `--canvas` cover (`<html data-boot>`, index.html), then calls `main_ready`
(tray.rs), which gives the window the canvas color and shows it. The cover fades and the
cards rise into place, one slot after the next (`src/boot-cover.ts`).
- **Ready** = queue restored + library loaded + window at its size + the parts that start
  under the cover (main.ts `later`, since 2026-09-29, DEBUGGING.md §Launch), capped at 2.5 s.
  `main_ready` carries the page's one computed-style read of the launch (the canvas color);
  `theme.ts` does not read it again while the cover holds the hidden window.
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

## 6a. Look change — **the launch animation, not a snap** (built 2026-09-15, committed c978fc6, shipped in 0.5.0)
**Before:** a View Transition. A theme crossfaded; a skin played its own entrance (Press stamp,
Ocean rise, Glass focus, Cyber snap). A skin switch dropped 37% of its frames at 238 Hz,
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
  Glass soft with a slight scale, Cyber a hard skew that straightens.
  `--boot-cover-out` (default `var(--boot-dur)`) times the cover's fade apart from the cards:
  Cyber clears the cover in 0.18 s, then the cards finish their 0.6 s skew (desk
  feedback 2026-09-15: the first cut was too short, with too much black screen).
- **Playback and clicks:** only the `<html>` attributes change; the player is not touched.
  Clicks pass in every stage.
- **Several changes:** one during veil or wait joins the same cover; one during lift fades the
  cover back in. Snaps when Animate look changes is off, under reduced motion, or while the
  launch cover is still up. `[perf] frames appearance` measures it.

## 6b. Agent changes — **a slower cover, and the surface change goes under it too** (planned and BUILT 2026-09-15)
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

**As built (2026-09-15):** as the plan above, with one change: the agent `set` does **not**
wait for the cover. `withAppearanceTransition` returns at once, so a theme, skin or surface set
sent next can still join the veil/wait of the first. A job that throws is logged and the cover
still lifts. `--boot-safety` scales too, so a slow agent cover is never cut off by the safety.
Files: `appearance.ts` (kind `surface`, async jobs, `by`), `boot-cover.ts` `tokenMs` (× the
scale), `styles.css` §Launch cover (`calc(… * var(--motion-scale, 1))`), `skin.css`
`--agent-motion`, `agent-settings.ts` (`pickLook`, the `surface` spec).

**Driven test (2026-09-15, dev app, CLI on the dev bridge, 238 Hz display):** every skin × Midi /
Max / Mini, single changes and theme + surface back to back. Every change gave one cover; every
batch gave one line (joined). No warnings or errors. New dev line `[perf] frames appearance-lift
<detail>` times only the rise (the whole-cover line also counts the opaque wait: the Max remount
long task, 57–80 ms, sits there, unseen). Lift drop into Max: Glass 52–60%, Ocean 43–55%,
Cyber 13–16% without a resize and 30% right after one, Press 1% / 7.6%. Worst frame
≤ 21 ms. ~~The Max rise on Glass and Ocean is the cost of Max itself~~ — wrong, see the fix below.
Midi and Mini lifts: 0–11% (Glass → Mini 24% once).

**Frame fix (2026-09-15, polish session).** Trace (`Animation` events, `compositeFailed` 64
"incompatible animations"): in the lift every panel still carried `boot-safety-panel`, and any
animation on an element keeps its transitions on the main thread. Glass re-rastered its frosted
layers each frame; Ocean repainted six panels into the document. A 1 ms safety does not help;
`animation: none` in the lift does (the lift's end state is the rest state, so the safety is not
needed there; hold/wait keep it). Ocean's opt-in Sand edges then still dropped ~30%: the
four-layer `mask-composite` redraws each frame (PNG tiles instead of the SVG noise: no gain), so
during the lift the grain tile goes solid and the specks go empty ("Sand B"); they return when
the lift ends. Ruled out by probes: ambient layers, stagger, frost alone, the rise's `scale()`.
Re-measured (agent lift dropped %): Glass Max 47 → 0.4–1.5, Ocean Sand Max 47 → 0.7–1.6, Ocean
Soft Max 0.2, Cyber Max 7 → 0, Press Max 6 → 1.2; Midi/Mini skin changes 20–39 → ≤ 1.4;
surface → Max after a resize 58–60 → 4–7.5; surface → Midi on Ocean 44 → 11–13.

**Forks — settled 2026-09-15 (user): 1A, 2A, 3A.**
1. **Surface under the cover for user picks too?** **(A) Agents only first**; desk-test it,
   then decide B. (B) Every deliberate surface pick (title menu, tray open).
2. **How much slower?** **(A) One scale token, `--agent-motion` (1.6)**, a skin may override.
   (B) A full set of `--agent-*` duration tokens per skin.
3. **Say who changed it?** **(A) No text**; the info toast "An agent set …" already says it.
   (B) A short label on the opaque cover.

**Link to card swap motion (2026-09-15):** a surface change under this cover also covers the
recompose that [CARD-SWAP.md](../cards/CARD-SWAP.md) left out: the cards rise in
their new slots. The swap classes cannot collide with it: `html[data-boot] .bento > .panel`
outranks `.bento > .panel.swap-in`, and a recompose never calls `playSwap`.

**Test in the morning:** dev app, debug CLI (`--port` of the dev bridge), Agent changes settings
= Allow. `settings set theme "Black & Red"`, then `settings set surface mini`, then theme, skin
and surface back to back. Check `[perf] frames appearance` in the dev log for each.

## 6c. A rule's theme change — **the colors change in place, no cover** (designed 2026-09-27)

> **Part:** built · 2026-09-27 · his desk test passed 2026-10-13 (DESK-TESTS.md §5: B11, Fade 6c)

**Why:** Live Theming (RULEZ.md §11.1), and later the Album theme (SKINZ.md §12), change the
theme on every song. Under §6a each song fades the cards out and raises them again. A theme
changes only colors; the layout is the same before and after, so it needs no cover.

**His calls (2026-09-27):**
- **Only a rule's theme change** gets it. A hand pick, an agent's change and every skin change
  keep the §6a cover: they are rare, and a skin changes more than colors.
- **Animate look changes** (`appearanceMotion`) controls it. Off, or reduced motion: it snaps.
- **500 ms**, a skin token (`--theme-morph-dur`), so a skin can tune it.

- **A crossfade**, not a sweep (the sweep costs more on a weak GPU, measured below). A View
  Transition (`document.startViewTransition`); clicks pass through it.
- **The moving parts never show twice.** The fade's old half is a still picture, so a part that
  moves would show twice for the fade's length (seen on Ocean). The Press record gets its own
  transition group that shows only the live record. The background loops (the Ocean sea, the
  Glass aurora and album aurora, the Cyber storm) **hold still** for the fade instead (his call
  after the fork below): a part with its own group is drawn above the cards, so they cannot
  skip the fade.
- **Keep the last cover's color** until the new one lands (the bug below).
- The Live Theming recipe's description says it works best with a GPU.

**Measured (2026-09-27; WORKLOG.md has the tables).** `dev:built`, Max, Lilac ↔ Moonlight,
compositor frames (`Display::DrawAndSwap`), not the page's rAF.
- A color morph (`@property` on the 15 roles) restyles and repaints every frame: ~20 fps
  however long it runs. Rejected.
- RX 6700 XT, 244 Hz: the crossfade draws as many frames as a plain opacity fade at every length
  from 1000 to 150 ms (Cyber, Press, Glass); Ocean ~55%. Freeze before it starts 41–70 ms.
  Processor time: crossfade and sweeps within noise of a snap.
- `--gpu=slow` (an integrated chip), 500 ms: crossfade 192–233 fps, worst gap 7–34 ms, as smooth
  as a snap. Hard sweep (`clip-path`) 65–171 fps. Soft sweep (a gradient mask) 57–157 fps and
  twice the page's processor time: neither edge animates as a plain GPU layer.
- `--gpu=off` (WARP, below any real chip): every mode 6–21 fps, freeze 50–210 ms. A snap is the
  kindest there.

**A bug under it (found 2026-09-27, play test on the dev app).** On a new song `readCover`
(rules-facts.ts) clears the cover color at once, but fires its seam only when the palette lands.
`checkOnce` reads every fact on any seam. In the gap, the `playing` seam fired (diag #247): the
rule "dark cool covers" ended, the theme went back to his pick, and 92 ms later (#253) "light
cool covers" set it again. It was not seen only because his pick was the next theme. With a
fade, it is two fades per song. Fixed with this build by his call: keep the last cover's color
(the other choice was an engine change: hold a rule whose fact is unknown).

**As built (2026-09-27).**
- `look.ts`: `pickLook` marks a hand change (`handPick`), and that includes Reset and agents.
  `paint()` sends a change with no mark and no skin change to `withThemeFade`; everything else
  goes to the §6a cover as before. The look schedule is a rule, so its theme-only change fades too.
- `appearance.ts` `withThemeFade`: sets `<html data-theme-fade>`, runs the View Transition, and
  clears the attribute when the fade ends. It snaps when Animate look changes is off or under
  reduced motion. It hands the change to the cover when the cover (or the launch cover) is up.
  A second change during a fade starts a new one. `[perf] frames theme-fade skin=…` times it.
- `styles.css` (after the ambient pause): the fade's length and ease, the paused loops, and the
  record's group (`view-transition-name: match-element`, class `theme-live`: the old half
  hidden, no animation). Tokens `--theme-morph-dur` 500ms, `--theme-morph-ease` in `skin.css` base.
- `rules-facts.ts` `readCover`: the last words stand until the palette lands; they are cleared
  when there is no cover, when no rule reads them, or when the palette lookup fails.
- `rules-recipes.ts`: the Live Theming description gets "It works best with a GPU: the colors
  fade on every song."

**Claude's run (2026-09-27, dev app, Cyber, Live Theming on, 2% volume).** Casio → Blue Train →
Everybody Loves the Sunshine → Sunshine, with the app's Next button: one `data-theme-fade` and one
theme change per song, no `data-boot`, each fade 580–650 ms. The rule log shows one `applied` per
song and no rule ending in between: the double change is gone. A theme picked in the title
menu still ran the cover (veil → wait → lift).

**His desk test.**
1. Turn Live Theming on. Play an album mix, or queue songs with different covers, and press Next.
   The colors fade in place in ~½ s. The cards do not fade out or rise.
2. On Ocean and Glass: the sea and the aurora stop for that ½ s, then go on from the same place.
   They never show twice.
3. On Press with a song playing: the record keeps turning through the fade and never shows twice.
4. ~~Pick a theme in the title menu: the cover runs, as before.~~ Changed 2026-09-28, below.
5. Settings › Animate look changes Off: a rule's theme change snaps.
6. Watch several songs: the theme changes once per song, never back to your pick and then again.

### 6c.1 Hand picks join the crossfade (2026-09-28)

> **Part:** built · 2026-09-28 · his desk test passed 2026-10-13 (DESK-TESTS.md §5: B11)

**His calls (2026-09-28, the motion review, SHOTS.md §5e):** a theme you pick by hand (the
title menu, Settings, the Compass, Reset) crossfades too. This reverses the first call above
for hand picks only. The same 500 ms (`--theme-morph-dur`). **An agent's theme change keeps the
§6b cover**, so a change you did not make stays easy to see. Any skin change keeps the cover.

**As built:** `look.ts` `paint()` sends every change with no skin change and no `by: "agent"` to
`withThemeFade`. ~~A menu or the Compass that made the pick closes inside the fade's update, so
it fades out with the old colors.~~ Changed the same day: §6c.2.

**Measured (demo, headless Edge, Midi, Moonlight → Sepia from the Compass):** one
`[perf] frames theme-fade` line per skin, 538–570 ms, no `data-boot`; before, the same pick ran
the cover for 1.0–2.0 s. A Press pick from the Compass still runs the cover (702 ms lift).
**The strips, read 2026-09-28** (`shots/scratch/theme-pick/*.s5-key.png`, 40 real frames
after Enter, 5 skins): one blend, the cards never move, the covers stay solid. Three things
show: (1) nothing seems to change for ~130 ms after Enter (the ease-in-out start plus the
snapshot); (2) the Compass is in the old picture, so its rows show as a ghost over the Home
covers until ~+350 ms; (3) dark → light passes a flat grey middle at ~+240–330 ms (known, the
500 ms call). Ocean dropped 14 of 105 frames, two long gaps (39, 27 ms) right after Enter; the
other skins dropped 3–7. (1) and (2) are fixed in §6c.2.

**Desk test:**
1. `npm run dev:built`. Pick a theme in the title menu (Settings › Theme), then in the Compass,
   then with Settings › Reset. The colors fade in place in ~½ s; the cards never fade out or rise.
2. Ocean, Glass: the sea and the aurora hold for the ½ s and never show twice. Press, playing:
   the record keeps turning.
3. Pick a skin: the cover runs, as before.
4. Ask an agent to change the theme (`deetsmusic settings set theme sepia`): the slower cover runs.
5. Animate look changes off, or reduced motion: every theme pick snaps.

### 6c.2 The panel leaves first; a hand pick moves at once (2026-09-28)

> **Part:** built · 2026-09-28 · his desk test passed 2026-10-13 (DESK-TESTS.md §5: B11)

**His calls (2026-09-28, after the strips of §6c.1):** the menu or the Compass that made the pick
closes with its own short exit BEFORE the snapshot, so only the colors fade. A pick you make by
hand uses an `ease-out` curve, so the change starts on the press; a rule's change keeps
`ease-in-out` (nobody pressed anything).

**As built:**
- `pickLook` takes `close` (the panel that made the pick) in place of `after: close`, and marks
  a pick with no `by` as `hand`. A moment rule's `set` action passes `by: "rule"`.
- `withThemeFade` calls `close`, then waits for the `.pop[hidden]` exits in flight
  (`panelExits`), for at most `--theme-morph-hand-wait` (0.4) of `--pop-out`. On the pop ease the
  panel is ~88 % gone there; `finish()` ends the rest in the frame the fade starts. The full
  wait was a mistake: on Glass (`--pop-out` 200 ms) it held the colors for ~140 ms after the
  Compass looked gone.
- A hand fade sets `<html data-theme-fade="hand">`; the old and new pictures take
  `--theme-morph-hand-ease` (`ease-out`). The frames line reads `theme-fade skin=… by=hand`.
- With a cover (a skin change, an agent, a cover in flight), `close` runs under the cover, as before.
  A cover that starts during the wait takes the change.

**Measured (demo, headless Edge, Midi, Moonlight → Sepia from the Compass, 5 skins):** the Compass
is gone by ~+50 ms; no ghost in any frame. The colors move from ~+190 ms and are nearly done by
+400 ms; the fade lines read 539–568 ms. The ~100 ms between is the snapshot: two stalls of
~53 ms in the Ocean strip. A rule's fade pays it too. The grey middle is still there, at
~+270–330 ms. Dropped frames are the same as before the change (Ocean 13 %, Glass 14 %, Cyber 2 %).
One noisy run gave 64–85 % on three skins; a rerun at once was back to these.

**Desk test** (with §6c.1):
1. `npm run dev:built`, Glass. Open the Compass, type "sepia", Enter. The Compass leaves at once;
   then the colors change. No Compass rows show over the cards at any point.
2. The same from the title menu (Settings › Theme › a theme): the menu leaves first, then the fade.
3. Watch the start: the colors begin to change with no pause that reads as lag. If the gap
   between the Compass leaving and the colors moving reads as a hitch on your PC, say so. That
   gap is the snapshot, and the fix is a separate fork.
4. A Live Theming song change (a rule): the fade keeps its slow start and slow end.
5. Pick a skin from the title menu: the menu closes under the cover, as before.

---

## 7. A card's first screen — **one reveal in reading order** (designed 2026-10-16)

> **Part:** built · 2026-10-17 (steps 2–7, §7.14) · measured (§7.13, the step 7 table) · desk test passed 2026-10-17 (§7.8: run by Claude, his "feels good")

> **Start here (the build session, from 2026-10-17; DONE, §7.14 is the record):** build §7.7 steps 2–8 on `shixtheenth`.
> The Filter rules desk test passed (3d0b647), so the engine is free. First ask him the two open
> forks (§7.7 end: S2, the ladder's sizes). Read, in order: 7.1–7.6 (the rules), 7.7 (the steps,
> with every 7.4 optimization), 7.9–7.12 (the surfaces and the setting), 7.13 (the baseline to
> beat and the command). Walk CLAUDE.md's build checklist for each new part (tokens, hints,
> settings key, NEW_MARKS, Compass, rule key, marks, threads). After the build: an as-built
> record under §7, the desk test (7.8) handed to him, and the list of what you decided inside
> his choices.

**Terms:**
- **First screen** — the rows or tiles whose box is inside the card's visible list area (the
  view, under its sticky bar) when the level's data is drawn, at the card's size of that moment
  (Grow and Fill included). A tile cut by the bottom edge counts: it is seen.
- **Ready** — a first-screen tile whose picture can show at once: a cover loaded and decoded
  (`img.decode()`), a mosaic drawn, a cover that failed (artwork-heal.ts retries it later), or a
  slot with no picture (the ♪ or the initials).
- **Reveal** — the moment the first screen shows, in reading order (left to right, then top to
  bottom, from each tile's box on screen).
- **Cap** — the longest time a card holds before it reveals.
- **Late cover** — a picture that is not ready at the reveal, or that loads after it (a row
  scrolled into view, a cover a background sync brought).

**Why (his question, 2026-10-16):** does a card's first load have a cover-up, or do things
pop in a jumble? The recording (`shots/scratch/pl-firstload.json`, Glass, Midi, the demo):
the Playlists rows rise with the swap at +169 ms, each with a ♪; the three mosaics then replace
their ♪ in one frame each at +547, +796 and +1002 ms. In his dev app a mosaic takes 0.2–2.8 s
(`mosaic:drawn`, often 1.5 s or more). Each Playlists load also draws the list again (the cached
list, the Apple sync, the count backfill), and each draw rebuilds every row and `<img>`
(`view.innerHTML`, collection-card.ts). Before the cached list lands, the root level shows
"Nothing here yet." (the pane is built empty, collection-card.ts `buildPane` at init). At launch
the launch cover (§6) hides all of it.

**His calls (2026-10-16):**
- **Present once, complete.** The card holds until its first screen is ready, as the launch
  cover does for the window. He accepts a delay of a second or two for it.
- **Reading order:** left to right, then top to bottom, for a grid as for a list.
- **Only what is on screen counts.** A row below the fold (the 47th) never holds the reveal.
- **Shape: the diagonal wave.** A tile's delay is its row plus its column, so the wave moves
  left to right and top to bottom at once. In a one-column list it is one by one.
- **All cached: the same reveal plays, with no hold.** Every open looks the same.
- **Cap: 1.5 s.** To be checked against the loading-set clips at his p90 timings
  (guide/LOADING-SET.md).
- **Load priority first** (below, part 3): it makes most opens ready long before the cap.
- These replace the two forks shown earlier the same day (each late cover fades in when it
  lands / a top-to-bottom wave; the ♪ or a 2×2 preview while a mosaic draws).

### 7.1 The hold

- A level holds when it is first shown: a card opened (the picker, a swap, a summon, a restore),
  a drill (the slide), a Back to a level that was rebuilt, a view or grouping switch that
  changes what is on screen. The card's frame and title bar show at once; the body (the view
  under its bar) waits.
- **No hold** for a scroll, a typed filter or search, a sort, or a background update (the Apple
  sync, a ♥, a count). Those keep their rows in place (part 1), and a late cover fades in alone.
- **Data first.** A level whose data is still loading says so: `Context.loading?: () => boolean`
  (collection-card.ts). The engine holds while it is true, so "Nothing here yet." never shows
  for a list that is still on its way. Playlists sets it until its first `load()` lands; an
  empty list that has loaded shows its empty state at once.
- **Then the pictures.** With the data drawn, the engine lists the first-screen tiles and waits
  for each one to be ready. A cover that is already complete is decoded and counts at once.
- **The cap (1.5 s)** starts when the hold starts. At the cap the reveal runs with what is ready.
- **A press or a wheel on the card ends the hold at once** (the reveal runs), as `card.hold()`
  does for card memory. The hold reuses that primitive and its listeners.
- A level that is held when the card is swapped away, or drilled past, drops its hold.

### 7.2 The reveal

- The first-screen tiles are sorted by their box on screen (top, then left; a tile whose top
  is within half a tile of another's is on the same line).
- **The diagonal wave:** tile delay = (line + column) ÷ (lines + columns − 2) × the reveal span.
  The span is a fixed total (`--reveal-span`, 0.5 s to start), so a 40-tile Fill and a 6-row
  list reveal in the same time.
- Each tile uses the row-entry motion (`--pop-in`, `--pop-shift`, `--pop-ease`; pop.ts
  `enterRows`), with its delay set from the wave instead of `--pop-stagger`.
- A tile that was not ready at the cap enters with the wave, with its placeholder (the ♪, or
  the slot's ground), and its picture fades in alone when it lands (7.3).
- Tiles below the first screen enter with no motion; they are not seen.
- **Reduced motion:** the same hold; the first screen shows at once, with no wave.

### 7.3 Late covers

- A late cover fades in (`--art-in`, an alias of `--pop-in`) from its slot's ground. One rule
  for the whole app, in the capture-phase `load` listener artwork-heal.ts already has: a cover
  that was not complete when it was drawn gets the fade; a complete one shows at once.
- `data-art` goes on the covers that lack it (they also get no retry today): the Home shelves
  (home-card.ts), pinned tiles (pins.ts), the playlist web (web.ts), and the mosaic `<img>`
  (mosaic.ts). The mosaic fades on its own image's `load`, not on `fill()`, so a frame still
  decoding never shows blank.

### 7.4 Load priority

1. **The probe first:** where do a mosaic's 0.2–2.8 s go — the worker's downloads or its
   drawing? A 3-cover mosaic fetches large tiles (`FETCH_PX` up to 480) that no row has cached.
   The answer sets parts 2 and 3.
   **Answered 2026-10-17** (`mosaic:drawn` now logs the split: `waited`, `tiles`, `fetch`,
   `slowest`, `decode`, `paint`, `encode`, `px`, `kb`; 8 draws on his dev app): **the downloads.**
   A cold 3-cover mosaic fetches three 480 px covers (235 KB); the tiles phase is a median
   468 ms (the slowest fetch 462 ms), the decode 9 ms, the drawing 0 ms, the encode 14 ms; the
   whole draw a median 566 ms (max 757). Warm, the same mosaic is 188 ms. The queue wait before
   a draw was 9–891 ms. So part 2 (draw at the size on screen) fixes the cause; the older
   1.5–2.8 s readings included the queue and the cold network.
2. **Mosaics drawn at the size on screen.** A row shows 36 px; today one 480 px picture serves
   the row, the tile and the hero. The row and the tile get a small picture from small fetches;
   the hero's large one is drawn when a playlist opens. Memory only, never saved, as before
   (PLAYLISTS.md §11.3).
3. **Mosaics ready before the card opens.** At idle after launch, the mosaics of the first
   screen of Playlists (its current sort, grouping and density, from the cached list) are
   drawn, two or three at a time, in reading order. The visible-slot queue stays for the rest.
4. **The first screen's covers asked for first:** `fetchpriority="high"` on first-screen covers,
   `loading="lazy"` on the rest. DOM order is reading order, so the requests start in it.
5. **More found in the baseline and the code (2026-10-17), for the build:**
   - **Decode before showing.** A disk-cached cover is still late by 100–250 ms (7.13), because
     the `<img>` goes in before it is decoded. The wait counts `img.decode()`, so a warm open
     reveals with every picture painted.
   - **One ladder of cover sizes.** Covers are asked at 64, 72, 96, 128, 160, 192, 300 and 360
     px across the cards, and the mosaic worker at 60, 120, 240 and 480. Each size is its own
     URL, so the same album downloads again per size, and a mosaic never reuses a cover a row
     already has. A few shared steps (the mosaic's included) turn most of those into cache hits;
     a picture shown smaller than its step costs some bytes. His call on the steps.
   - **Connect early to Apple's image server.** No `preconnect` today (index.html). A cold first
     cover pays the DNS and TLS set-up; a `<link rel="preconnect">` to the mzstatic hosts at boot
     takes it off the first screen.
   - **Draws in parallel.** The mosaic queue runs one draw at a time after an idle callback; its
     wait was up to 891 ms. Two or three at once, as part 3 says.

### 7.5 The launch

The launch cover already waits on a list of promises, capped at 2.5 s (`runBootCover`,
boot-cover.ts). Each visible card's first-screen readiness joins that list. At launch the cards
do not play their own reveal: the launch lift is the reveal, and the window shows complete.

### 7.6 Where it lives

- `src/reveal.ts` — the primitive: given a view and its first-screen tiles, wait for ready or
  the cap, then run the wave; marks `reveal:hold` and `reveal:go <ready|cap|press> <n>/<total>`
  (marks.ts) and one `diag.log("reveal", …)` per reveal, with the hold time and the count not
  ready at the cap.
- collection-card.ts calls it at each held moment (7.1), so Library, Playlists, Radio, the
  artist view and every drill level get it. Home's shelves and the Search results are not on the
  engine; they call reveal.ts in a later step.
- Tokens in skin.css base: `--reveal-cap: 1.5s`, `--reveal-span: 0.5s`, `--art-in:
  var(--pop-in)`. A skin overrides only what it changes.
- The reveal sets `dataset.frames` so frames.ts times it.

### 7.7 Build order

Steps 2–8 are one build in one session (his plan, 2026-10-17), with a measure after each step.
**Every optimization in 7.4 is in it** (his call, 2026-10-17: "do all those optimizations").

1. ~~The probe (7.4.1).~~ **DONE 2026-10-17:** the downloads, not the drawing (7.4.1).
2. **The keyed patch: a redraw keeps the rows that did not change.** One shared helper (keep a
   child whose key is still there, add, remove, move), used by the engine's short-list path of
   `renderViewInto` (the windowed path already keeps its rows), the engine's shelves
   (`Context.shelves`: Radio, the artist view, Pinned), Home's shelves (7.9 part 3), the Queue,
   History (7.11) and Search's sections. The root fix for "made again by a redraw" (83 at a
   launch, 12 per Home Refresh, 7.13), and the reveal needs it: a background sync must not
   rebuild the first screen.
3. **Late covers** (7.3), with the missing `data-art` markers (Home, pins, web.ts, the mosaic
   `<img>`, the Compass).
4. **Load priority, all of 7.4:**
   a. mosaics drawn at the size on screen; the large one only for the hero (part 2);
   b. mosaics of the first screen drawn at idle after launch, two or three at a time (part 3,
      part 5 "draws in parallel");
   c. `fetchpriority="high"` on first-screen covers (part 4);
   d. decode before showing: the wait counts `img.decode()` (part 5);
   e. one ladder of cover sizes for every card and the mosaic worker (part 5; **the steps are
      his: ask before the build**);
   f. `<link rel="preconnect">` to Apple's image hosts in index.html (part 5).
5. reveal.ts, `Context.loading`, the engine's held moments (7.1, 7.2).
6. The launch (7.5).
7. Home (7.9) and Search (7.10) adopt reveal.ts; then the Queue, History, Rewind, Diary, the
   playlist web and the Compass (7.11). The per-card setting (7.12) lands with the first card
   that waits, so no build ships a wait that cannot be turned off.
8. **Measure** on his live dev app after each step:
   `node scripts/shots.mjs --list docs/ops/checks/reveal-live.json --noise 60 --tag step<N>`
   (needs `npm run dev:app` with its window on screen), and compare each `loads` line with the
   baseline table (7.13). Write the new numbers under it. Tune the caps with him.

**His calls before the build (2026-10-17):** S2 **A**, Search's text at once and its pictures
as one wave per section (7.10). The ladder **96 · 192 · 480** (step 4e): a row takes 96, a tile
192, a hero and a large mosaic 480, and the mosaic worker picks from the same three. The full
player and the Canvas wallpaper keep their own large sizes. W2 is not an ask: the build keeps
both behind `deets.dev.instantFade`, and he picks after the feel test (7.8 step 8). The build
runs in the main checkout on `main` (his call, the same day), beside the song facts box session.

### 7.8 Desk test (his, on the dev app) — passed 2026-10-17

1. Clear the WebView2 cache (or use a fresh `dev:app` data folder). Launch. The window shows
   once, with Playlists complete: no ♪ turns into a picture after the lift.
2. Swap Playlists out and back in. The body waits, then the tiles arrive as one diagonal wave.
3. Fill Playlists in Max at a grid view. The wave runs left to right and top to bottom across
   the whole grid in about half a second. Scroll down: the rows below arrive with no wave.
4. Open a playlist you have not opened this session. The slide runs at once; the songs arrive
   as a wave when their covers are in.
5. Press the card while it holds: it reveals at once.
6. Turn on Windows' reduced motion. The card still waits, then shows at once.
7. Press ⟳ (Sync playlists) with the card open. No row blinks, and no wave plays.
7a. Search: type an artist. The names show at once; each section's covers fade in left to right
   together, not one by one. Type one more letter: the cells the two answers share do not blink.
7b. Play an album with the Queue open: the Queue waits, then waves. Press Next: no wave, no blink.
8. Settings › Cards › Cover load animations: turn Playlists off. Clear the cache and open it: it
   shows at once, and covers pop in as they land (W2 B, his pick).

**Run by Claude, 2026-10-17 (his ask: "evaluate how smooth, elegant and graceful", Max with one
card, under a magnifying glass).** The shots runner on his dev app (`shots/scratch/reveal-desk.json`,
`reveal-drill.json`, `reveal-search.json`; `maxCards` 1 for each shot, put back after it), 244 Hz,
read frame by frame. Four faults found and fixed in the same sitting:
1. **A hitch at the wave's first frame** (38–91 ms; 11–13% of the reveal's frames dropped on
   Playlists, 8% on Home). Every tile started its animation at once, with a delay; each became a
   layer and was drawn in that one frame. Now each tile waits at opacity 0 (no drawing) and
   starts at its turn. After: Playlists cold 0.6% dropped, worst 8 ms; warm 2.6%, worst 8 ms;
   Home 1.9%, worst 13 ms; the drill's wave 0.6%, worst 9 ms.
2. **A warm open was blank for ~200 ms and made 17 covers again:** card memory rebuilt the whole
   root pane with no deeper level to restore. Now a root-only restore keeps the pane and puts its
   place back. After: 0 made again.
3. **A playlist's songs came after the hero:** the drill revealed on the hero alone and the songs
   popped in ~200 ms later, one cover at a time. Now the playlist level, and the Library's album
   and artist levels, say `loading` until their songs are in. After: the slide, then the hero,
   Play / Shuffle and the songs as one cascade, each row with its cover.
4. **Search's held covers showed nothing**, then **square → blank → picture**: a held or late
   cover was at opacity 0, so there was no placeholder square; then a delayed fade held each at
   0 until its turn. Now a waiting cover shows its slot's ground (`--surface-hover`, its own
   pixels moved out of its box), keeps it until its turn, and fades from `--art-in-from` (0.3),
   not from nothing. After: the words, then squares that fill left to right.

Steps: 1 (launch) passed in the step 8 run (§7.13: ready under the cover, not capped). 2 and 3
(the wave, the grid in one card) passed. 4 passed after fix 3. 5 (a press ends the hold) not
driven. 6 (reduced motion) not driven: the runner cannot set the OS setting. 7 (Sync) passed: no
frame of the card changed in 1.2 s. 7a passed after fix 4. 7b not driven (it plays music). 8:
instant Playlists showed at once and its covers popped in as they loaded (W2 B); W2 A and the pick
are his. **His verdict (2026-10-17): "Feels good for now" — passed.** W2: B, his call the same day.
The last pass, with every fix in (the reveal's frames): Playlists cold 1.9% dropped,
worst 12 ms; warm 3.2%, 8 ms; the drill 0.6%, 8 ms; Sync 0.6%; Home 9.6%, 25 ms on its first frame
(1.9% the run before; its 33–38 ms stalls fall under the hold, where nothing shows). The dev app
renders with DevTools in its GPU process, so these are upper bounds (DEBUGGING.md). His layout and
settings were put back after the run.

### 7.9 Home (scoped 2026-10-17)

> **Part:** designed · 2026-10-17

**How Home loads today (read 2026-10-17):** home-card.ts is not on the collection engine. It
shows "Looking through what you play…" until `homeShelves()` (home.ts) answers, then sets
`shelfBox.innerHTML` and slides the shelves in (`enterRows`) on the first fill. The first build
of a session can wait on Apple: `fetchNew` calls `artist_new_releases` for the New shelf when
its floor has passed. After the first fill, `fillArtistPhotos` builds every shelf again when a
face lands. Every play, track change, playlist change, pin and Song of the Day change builds
every shelf again too (`onTracksChange`, `onPlaylistsChange`, …). Each build replaces the whole
`innerHTML`, so every `<img>` is made again. Home's covers carry no `data-art` (no retry, no late
fade).

**The scope:**
1. **The first screen** is each shelf in the body's view, and in each shelf the tiles inside the
   scroller's visible width. A tile scrolled out to the right never holds the reveal.
2. **The hold and the reveal** as 7.1 and 7.2 (cap 1.5 s, the diagonal wave). The wave reads the
   tile boxes, so it runs left to right along each shelf and down the shelves. "Looking through
   what you play…" shows only when the cap passes with no shelves yet.
3. **Shelves kept in place** (the keyed patch, shared with the engine; see below). A build
   patches each shelf by tile: a tile whose item (`it.key`)
   is still there keeps its node and its loaded cover; a new tile is added; a gone tile is
   removed. A play that moves a tile to the front moves its node, with its picture. No blink.
   This is the Home form of 7.7 step 2, and the reveal needs it.
4. **A face that replaces a borrowed cover** (`fillArtistPhotos`) fades over it (`--art-in`),
   not a cut.
5. **`data-art`** on Home's covers (7.3).
6. **Priority:** `fetchpriority="high"` on the first-screen tiles. The New shelf's Apple call
   moves out of the first build: the first build draws the shelves from local data and the
   New list held in memory (`newReleases`, empty after a launch), and the call's answer
   patches the New shelf in place when it lands (step 3). Home then never waits on Apple to
   show; after a launch the New shelf joins a moment later, as one shelf entering. Whether
   Rust keeps the answer on disk (so a launch could show the last list at once) is to be read
   before the build.

**Home on the collection engine? (his question, 2026-10-17; read against the code):**
- The engine already draws shelves: `Context.shelves` (collection-card.ts), used by Radio, the
  artist view and the Pinned shelf. But it draws them as one HTML string and makes the whole
  block again when it changes. So a move alone does not fix Home's rebuilds: the engine's shelf
  path has the same fault.
- **What the loading work needs is two shared primitives, not the move:** `reveal.ts` (7.6) and
  a keyed patch (keep a child whose key is still there, add, remove, move). The engine's rows
  (7.7 step 2), the engine's shelves (Radio, the artist view, Pinned) and Home's shelves all use
  the same patch. That also fixes Radio's and the artist view's shelf redraws, which Home's
  move would not.
- **What a move would add for the user:** an album, playlist or artist opened from Home would
  open inside Home (a drill with Back), as in Search and Radio. Today Home has no level of its
  own, and an Open hops to the card that holds the item (home-card.ts `activate`). That is a
  product choice, his, separate from the loading work (HANDOFF › His to decide).
- The rest Home already has on its own: list keys (`wireListKeys`), right-click menus, drags
  (`rowDrag`), card memory (`scrollSnapshot`).

### 7.10 Search (scoped 2026-10-17)

> **Part:** designed · 2026-10-17

**How Search loads today (read 2026-10-17):** the field waits `SEARCH_DELAY_MS` (300 ms) after
the last keystroke (search-field.ts), then `searchCatalog` asks Apple. A newer term cancels an
older answer (`queryToken`). Each answer replaces the whole results box (`root.innerHTML`):
the Artists, Songs, Albums, Playlists and Stations sections, each a sideways scroller. Covers
are 72 px (songs), 96 px (artists) and 128 px (tiles), with `loading="lazy"`. A drill from a
result (an album, an artist) is a collection-engine level, so 7.1's drill hold applies there.

**Why it differs from a card:** a search answer is the reply to typing. A 1.5 s hold would read
as a slow search. The person is also still looking at the last results while they type.

**His calls (2026-10-17):** at most **200 ms** after the answer, and **each section reveals on
its own**: Artists, Songs, Albums, Playlists and Stations each wait for their own covers, so a
heavy section never holds back a light one.

**The scope:**
1. **The new results build hidden, in place.** The answer draws into a second results box
   with `visibility: hidden` over the shown one. It has a real layout, so each section's first
   screen is known (the cells inside its scroller's visible width), and its covers load, with
   `fetchpriority="high"` on each section's first screen.
2. **Each section has its own ready.** A section is ready when the covers of its own first
   screen are ready (7's "ready"), or at the Search cap: 200 ms after the answer
   (`--search-reveal-cap`). The cap is one clock for every section, so the last section shows at
   most 200 ms after the answer.
3. **The swap is the first ready section.** At that moment the old results leave and the new
   box shows whole: every section's title and its scroller's box, in its place. The sections not
   ready yet hold their box empty (its height is set by its kind, so nothing below moves), and
   each one reveals when it is ready. Old and new results are never on screen together: two
   terms' results side by side would mislead.
4. **Each section's reveal** is a short wave left to right along its scroller (7.2's rule over
   that section's boxes, span `--search-reveal-span`, 150 ms to start). A cell not ready at the
   cap enters with its placeholder, and its cover fades in alone (7.3).
5. **A new keystroke during the wait** drops the hidden box (the existing `queryToken`). ↓ or
   Enter into the results swaps at once and reveals every section.
6. **The first term** (Recents shown, no results yet) uses the same swap, from Recents.
7. **"No results"** and the error line show at once. They have no pictures.
8. **The cost:** none on Apple. The calls and the 300 ms delay are unchanged; only the swap waits.
9. **The measurement (7.13)** reports per section: answer → reveal, and the cells not ready at
   the cap. It sets the final numbers of the two tokens.

**Fork S2 — the text first, the pictures as one wave (his idea, 2026-10-17; open, his):** the
baseline shows Search's covers landing 0.6–1.8 s after the last keystroke, so at a 200 ms cap
most of a section is not ready, and the swap above would show placeholders anyway.
- **A (recommended): text at once, pictures as one wave per section.** The answer swaps in at
  once (names, artists, the placeholder squares; ↓ and Enter work on it). Each section's covers
  wait, decoded, until its first screen is ready or a cap (to be set from the measurement,
  about 800 ms to start), then fade in left to right; a cover after the cap fades alone. No wait
  on the words, one picture event per section.
- B: the design above (each section held up to 200 ms, text and pictures together).
- The hidden build (1) stays: it is where the covers load and decode before they show.

### 7.11 The other surfaces with many covers (scoped 2026-10-17)

> **Part:** designed · 2026-10-17

**His calls (2026-10-17):**
- In scope: Library, the Queue, the artist view, Rewind and History, the playlist web, and the
  small ones (Diary, the Compass, Song of the Day, the Pinned shelves).
- **Out:** the Glass › Canvas covers (wallpaper.ts): a picture behind the cards cannot take the
  diagonal wave.
- **Mosaics:** if the measurement (7.13) shows them too slow, a playlist with no artwork shows
  a Note cover first (the Note drawing of PLAYLISTS.md §11.2, made at once in the theme), then
  the mosaic.
- **Every card gets a setting** to turn the wait off (7.12).

**1. Library** — on the engine, so 7.1 and 7.2 apply as written. Its held moments: the card
opening, a grouping or View switch, the Full | Lib chips (FULL-LIB.md: the level's data is a
wait of its own, `Context.loading`), and a Grow or Fill (the grow's row entry, CARD-GROW.md §19,
becomes the wave, with the ready wait inside the grow's own timing). A long list is windowed
(collection-window.ts, over 200 items): its first screen is the windowed rows in view. A scroll
never holds; a cover the windower adds late fades in alone (7.3).

**3. The Queue** — qcard.ts, not on the engine. **Today:** every queue change, track change,
Suggest Less mark and player state change sets the whole body (`body.innerHTML`), so every row
and its cover is made again, many times a minute while music plays. **Scope:** (a) the keyed
patch by queue entry: a row still there keeps its node and cover, an advance moves rows, a new
row is added; this is the main fix. (b) The wait and the wave only when the Queue fills from
nothing or is replaced whole: the card opening, a new album or playlist played, a room join, a
Clear. A song advance, an Add or a drag never waits. (c) The Now Playing row's large cover
(`qnow__art`) is part of the first screen.

**5. The artist view** — an engine level (media-levels.ts), so the drill hold applies. Its first
screen: the round photo, the shelves in view (Featured, Your Playlists, the albums shelf) and
the rows in view. The shelves wait on data of their own (`d.ready()`); the hold waits for it
inside the cap. Shelves that land after the cap enter as one block with the row-entry motion,
and the rows under them move down with it (no jump). The facts box (Last.fm, info-box.ts)
keeps its own place-holder (`data-info-pending`) and is not part of the wait.

**6. Rewind and History** — their own cards. **History:** it reads `play_events_since`, then
sets the whole body; each play reads the tail and sets it again (`onPlayEvent`). Scope: the
keyed patch by play; the wait and the wave at the card's open only. **Rewind:** it reads its
stats, then sets the board (`board.innerHTML`). Scope: the wait and the wave at the open and
at a window switch (week, month, year), which is a view switch; the large cover is in the first
screen.

**7. The playlist web** (web.ts) — a panel of hits under a field, like a search as you type.
**No wait:** the hits answer typing. Scope: `data-art` on its pictures (today none, so no
retry) and the late-cover fade (7.3). Its rows are few and small.

**8. The small ones:**
- **Diary:** the card's open uses the wait and the wave (its covers are album covers).
- **The Compass:** answers typing: no wait; `data-art` where a result has a picture
  (context-menu.ts makes its own `<img>`), and the late fade.
- **Song of the Day:** its shelf sits on Home (7.9).
- **The Pinned shelves:** engine shelves in Library, Playlists and Radio, and Home's own: each
  follows the card it is in, with the keyed patch.

### 7.12 The setting: wait or instant, per card (his ask, 2026-10-17)

> **Part:** built · 2026-10-17 · W1 his (A); W2 his (B, final, 2026-10-17); the name his: *Cover load animations*

**His calls (2026-10-17):** W1 **A**, Settings › Cards. W2 **B**: "instant" turns off all
loading motion; first "for now", then final the same day ("W2B is fine"). The dev switch
(`deets.dev.instantFade`) and the A branch were removed. The sub-heading is his: *Cover load
animations* (no colon, a direct name, as the other section names; it replaced the draft
*Wait for covers before showing:*).

**His ask:** each card has a setting, so a user who wants instant, snappy cards can take the
pops instead of the extra second or two.

**What follows (no choice):**
- One key, a list of the cards set to instant (`instantCards: string[]`), default empty: every
  card waits, his design (7). The default carries its why in settings-store.ts, a spec in
  agent-settings.ts and a line in AGENT.md; a `NEW_MARKS` line; a row in
  SETTINGS-INVENTORY.md. The Compass reaches the row by itself (COMPASS.md §9).
- The cards it lists: Library, Playlists, Home, Search, Queue, History, Rewind, Radio, Diary.
  The artist view and a drill follow the card they open in. The Compass and the playlist web
  never wait, so they have no toggle.
- **An instant card never holds and plays no wave.** The keyed patch stays (it removes blinks
  and adds no wait). The launch (7.5) does not wait for an instant card.
- **A rule may set it** (RULES.md §19), for example Battery saver, if the rules engine takes a
  list value for a rule key; to read in the code before the build.
- Reduced motion keeps the wait and drops the wave (7.2); an instant card has neither.

**Fork W1 — where the setting sits:**
- **A (recommended): Settings › Cards**, as a second list under the existing *Enable / Disable
  these Cards:* toggles (HIDE-CARDS.md §8), one toggle per card. The section already lists
  the cards one per row, so a user finds a card's own setting beside it.
- B: Settings › Motion, beside *Animate card swaps*: a choice about motion lives with motion.

**Fork W2 — what "instant" turns off:**
- **A (recommended): the wait and the wave only.** A late cover still fades in (7.3): it adds no
  wait, it only softens a picture that lands after the rows.
- B: all loading motion. A cover shows the frame it loads, as today. The most literal
  "instant", with every pop.

**Draft for him to edit (the words):** the sub-heading *Wait for covers before showing:*, one
toggle per card named as the card is (*Library*, *Playlists*, …), on by default; the hover hint
*On: the card shows once its covers are in, in one smooth wave. Off: it shows at once, and
covers pop in as they load.*

### 7.13 The measurement on his live dev app (planned 2026-10-17, his ask)

His ask: test on the live dev app, with his own playlists, his Home, and searches for his
recent additions. The demo's numbers (one second of mock data) do not count for this.

**The tools:**
- **App numbers, in the dev log and the live diag ring:** `reveal` (hold ms, the reason
  ready / cap / press, first-screen tiles, not ready at the reveal), `reveal:late` (a late
  cover's time after the reveal), `coll:render` and `home:build` (each redraw), and
  `[perf] frames reveal` (the wave's frames, frames.ts). Read with `deetsmusic diag` or the log.
- **Frames:** the shots runner gets its `dev` source (SHOTS.md §4, §10): it attaches to the
  running dev app's CDP port (dev-app.mjs records it), seeds nothing, and changes no look or
  setting. The steps drive the real UI. The strips, the marks and the change curve then come
  from WebView2 itself, on his data.
- **Cold runs:** `Network.clearBrowserCache` on the dev app's CDP target (the dev data folder
  only; the installed app is not touched), then a restart of the dev exe, so the mosaics and the
  covers are cold. **Warm runs:** the same steps again, with no clear.
- **The search terms:** his ten newest library additions (the `query` tool over the library's
  added dates), one artist and one album name each, typed one key at a time at 120 ms a key,
  and once pasted whole.

**The drive list** (`docs/ops/checks/reveal-live.json`, kept for regression runs,
checks/README.md):
1. The launch: restart the dev exe; read `boot:ready` and each visible card's `reveal`.
2. Playlists: open it from the card picker (Midi); Fill it in Max at a grid view; open a
   playlist not opened this session; scroll down two screens.
3. Home: open it from the card picker; press ⟳ (Home refresh).
4. Search: the terms above, typed and pasted; open the first album result (a drill).
5. Library: open it; switch to the album grid; Fill it in Max; switch grouping; Full | Lib on
   an album; open an artist (the artist view).
6. The Queue: open it with a long queue (a played playlist of 100+ songs); the Next button
   (an advance: no wave, no blink).
7. History and Rewind: open each; switch Rewind's window.
8. The playlist web and the Compass: type a term; count the late covers.
9. Each run again with every card in `instantCards`, as the comparison.

**Each step gives:** the time from the press to the reveal; the hold and its reason; the tiles
not ready at the reveal; the late covers after it and their times; the pops in the card's box
(the change curve); the redraws; the frames the wave dropped. Search adds: the keystroke to the
answer, and the answer to the swap.

**When:** once on today's code (the baseline), then after each step of 7.7. Three runs each,
the medians, with the noise gate. A run starts only when he says so: the drive presses his live
dev app, and he uses it (a press of his would end a hold).

**The baseline (2026-10-17, today's code, `shots/reveal-live/0.29.0/`, made @ 3d0b647 with
the probe's changes not committed; Max, 1080×950, his library):** "late" = put in before its
picture loaded; times from the press (a typed term's times include its typing, 120 ms a key).

| Step | New pictures in view | Late | Late from … to | Out of reading order | Made again by a redraw |
|---|---|---|---|---|---|
| Launch, cache emptied | 35 (1 mosaic) | 35 | +1472 … +2957 ms | 6 | 83 |
| Playlists, first open after launch (cold) | 7 (2 mosaics, +756) | 4 | +103 … +777 | 1 | 5 |
| Playlists, open again (warm) | 6 (1 mosaic, +39) | 2 | +103 … +104 | 1 | 5 |
| A playlist opened (drill) | 1 | 1 | +278 | 0 | 1 |
| Home, first open after launch (cold) | 12 (1 mosaic, +1112) | 10 | +1207 … +2282 | 4 | 0 |
| Home, open again (warm) | 12 | 10 | +207 … +253 | 0 | 0 |
| Home › Refresh | 0 | 0 | — | 0 | **12** |
| Search, 10 artists typed | 8–13 each | 8–12 each | +1482 … +3188 | 2–5 each | 0–1 |
| Search, 5 album names pasted | 0–4 each | 0–4 | +608 … +1759 | 0–2 | 4–6 each |
| History, open | 5 | 4 | +133 … +186 | 1 | 0 |
| Rewind, open | 5 | 5 | +92 … +170 | 1 | 0 |

What it shows:
- **A cover from the disk cache is still "late".** Warm opens put the covers in before they
  are decoded, and they land 100–250 ms after (Playlists, Home, History, Rewind). So the pops
  are not only a first-time network fault: the wait (7.1) must count a disk-cached cover too.
- **Home's first open after a launch shows an empty body for over a second** (its change curve
  passes 50 % only after +1034 ms; the strip shows the slot blank). Its first build waits on
  local reads and the New shelf's Apple call (7.9 part 6).
- **Redraws make covers again:** 83 during a launch, 12 on every Home Refresh, 4–6 on each Search
  answer that shares covers with the last one, 5 on each Playlists open. The keyed patch (7.7
  step 2, 7.9 part 3) removes them.
- **Search's covers land 0.6–1.8 s after the last keystroke or the paste**, out of reading order
  in most answers.
- Library's open put no new picture in view (its first screen was song rows with covers already
  in place): no line.

**After steps 2–7 (2026-10-17, `--tag step7`, `shots/reveal-live/0.29.0-step7/`, his go; the same
list, the same Max layout except Search in slot d).** The runner's "late" still counts a picture
put in the page before it loaded. Under the reveal that picture is held hidden, so the runner
can no longer see what was SEEN late. The app's own `reveal` line can (`late` = first-screen
tiles not ready at the reveal), and it is the second number here.

| Step | New in view | Late (runner) · not ready at the reveal (app) | Reveal after | Out of order (load) | Made again |
|---|---|---|---|---|---|
| Launch, cache emptied | 44 (2 mosaics) | 44 · **0** (Queue, History, Playlists ready under the cover; `boot:ready` 1119 ms, not capped) | — | 9 | **5** (was 83) |
| Playlists, first open (cold) | 6 (1 mosaic, +46) | **0** · 0 | 42 ms | 0 | **0** (was 5) |
| Playlists, open again (warm) | 6 | **0** · 0 | 12 ms | 0 | 4 (was 5) |
| A playlist opened (drill) | 1 | 1 · **0** | 18 ms | 0 | 1 |
| Home, first open (cold) | 16 (1 mosaic, +163) | 14 · **0** | 282 ms | 4 | 2 |
| Home, open again (warm) | 9 | 9 · **0** | 147 ms | 3 | 0 |
| Search, 10 artists typed | 8–13 each | 8–13 · **0** in 44 of 47 sections; 1 cover in 3 (capped at 0.8 s) | 17–804 ms after the answer | 1–5 | 0–1 |
| Search, 5 album names pasted | 0–4 each | 0–4 · 0 | — | 0–1 | 4–6 each (fixed after the run, below) |
| Library, open | 15 | 9 · **0** | — | 0 | 3 |
| History, open | 7 | 5 · **0** | 61–91 ms | 1 | 0 |
| Rewind, open | 5 | 5 · **0** | — | 2 | 0 |

What it shows:
- **No card open showed a cover late.** Every `reveal` line reads `go: ready, late: 0`, in 12–282
  ms; none reached the 1.5 s cap. The launch was not capped (1.1 s).
- **Redraws:** the launch made 5 covers again (83 before), a cold Playlists open 0 (5 before).
- **Search:** the words show at once; 44 of 47 sections waved in complete, 17–804 ms after the
  answer; 3 hit the 0.8 s cap with one cover each, which faded in alone.
- **Search, pasted:** 4–6 covers were still made again per answer: two results with the same
  cover under different keys (two songs of one album). Fixed after the run: a patch now moves a
  loaded picture whose row left into a new row with the same source (keyed.ts `gone` pool). Not
  measured yet.
- **After the reveal:** Home rebuilds when Apple's lists or an artist's face land (by design,
  7.9 part 6), and those covers fade in (`reveal:late`). Search logs `reveal:late` for covers
  in a section past its first screen; the line counts them too, so it is not a seen-late count.
- **Open:** "made again" 4 on a warm Playlists open and 3 on Library's open (a remount makes the
  card's DOM new; the HTTP cache serves them, decoded before the reveal, so nothing is seen).

**Safety:** the drive list opens cards, scrolls, types and drills. It plays nothing, loves
nothing, and changes no setting. A search adds its term to Search's Recents, as a typed search
does; the run removes the terms it added at its end.

### 7.14 As built (2026-10-17)

> **Part:** built · 2026-10-17 · not committed · desk test passed 2026-10-17 (7.8) · step 8 measured 2026-10-17 (7.13, after the baseline)

Steps 2–7 of 7.7, in the main checkout on `main`, beside the song facts box session (which owned
lastfm.rs, listeners.ts, info-box*.ts, present.ts, hero-slide.ts; the two shared the three
settings files by hunk). `npx tsc --noEmit`, `npm test` (307, six new), `npx vite build` and
`npm run docs:check` pass. A demo shot (`--scratch pl-firstload`, launch) settles with every cover
in place and no console error from this code; its numbers were taken on a busy CPU (NOISY) and
do not count.

**Step 2 — the keyed patch.** `src/keyed.ts`: `patchHTML(parent, html, after?)` puts a markup
string into a container as a patch. A child is matched by `data-key`, else `data-k`, else its tag
and FIRST class with its place among children of that shape. The same built markup (compared
with `data-idx` out, and against the markup that was built, never the live DOM that hint.ts
and the motion change) keeps the node. A changed child with the same tag and only element
children is patched inside; else it is made new and every loaded `<img>` with the same `src`
moves into it. An `<img>` with the same `src` is the same picture. Used by: the engine's
short-list path and its head (hero, Play / Shuffle, shelves: Radio, the artist view, the
Pinned shelves), Home's shelves (`data-key="shelf:<id>"`; a shelf keeps its sideways scroll
because it is the same node), the Queue (key = the entry object), History (key = the play),
Rewind (key = the row), Search's sections and cells and its Recents. The windowed path keeps
its own edge patch.

**Step 3 — late covers.** artwork-heal.ts: one MutationObserver marks an added `img[data-art]`
or `img[data-fade]` that is not complete with `data-art-wait` (opacity 0, before the next
paint); its `load` takes the mark off and fades it in over `--art-in`. A failed cover stays on
the ground while it is retried. `data-art` added on Home's tiles, the pins, web.ts's three
pictures and the Compass's menu art; the mosaic `<img>` carries `data-fade` (no retry on a
blob URL). `onLateArt` lets reveal.ts log `reveal:late`.

**Step 4 — load priority.**
- a. Mosaics at the size on screen: mosaic.ts takes the slot class's ladder step (a row 96, a
  tile 192, a hero 480; a large Library tile passes 480). The key includes the size.
- b. Draws in parallel: three at a time, one worker, an id → callback map (was one at a time).
  `warmMosaics()` at idle after the launch draws the mosaics each card showed on its last
  first screen (`deets.mosaic.warm`: card → seed, size and cover URLs; at most 12 a card; only
  Apple's addresses, never a picture).
- c. `fetchpriority`: not set on the markup. The held reveal asks for each first-screen cover
  at once instead: a lazy cover in view is set to eager, and a mosaic in view jumps the queue
  (`whenMosaic`). A markup attribute would make each redraw's markup differ from the last.
- d. Decode before showing: a tile is ready only after `img.decode()`.
- e. The ladder: `src/art-size.ts` (96 · 192 · 480, his call). Library rows and tiles, the hero,
  the artist view, the album shelf, Home, the pins, Search, the Queue, History, Rewind, the
  Diary, the playlist web and the mosaic worker. The Now Playing cover, the full player, the
  wallpaper and album-color's sample keep their own sizes.
- f. `<link rel="preconnect">` to is1–is5-ssl.mzstatic.com in index.html, and one with
  `crossorigin` for the worker's CORS fetches.

**Step 5 — reveal.ts and the engine.** `reveal({card, body, root, view, tiles, loading, why})`
hides `body` (`data-reveal-hold`, visibility: the boxes stay, so the covers load), waits for
`loading()` to be false (a render calls `check()`), then for every first-screen tile (inside
the view under a stuck bar, and inside its shelf's visible width) to be ready, at most
`--reveal-cap`; a press or a wheel on the card ends it. Then the wave (`reveal-wave.ts`, pure,
tested) over `--reveal-span`. Marks `reveal:hold` / `reveal:go <why> <ready>/<n>`, one
`diag.log("reveal", {card, why, ms, go, n, late, boot})`, `frames.during("reveal")`.
`Context.loading` in collection-card.ts: the empty state never shows while it is true.
Playlists (until its first load), Library (until the track store's first read), Radio (its
first answer, and a genre's stations) set it. The engine holds at the card's open, a drill, a
Back, a View density or grouping switch, and a card-memory restore; a level that leaves drops
its hold. Not held: a sort, a filter, a scroll, a reload, the Full | Lib switch (it keeps its
own designed motion, FULL-LIB.md), and a drill under a rule grow (the grow is the motion).

**Step 6 — the launch.** A reveal that starts under the launch cover holds nothing and plays
no wave; its readiness joins `runBootCover`'s list (`bootReadiness()`), inside the cover's own
2.5 s cap.

**Step 7 — the other cards and the setting.**
- Home: holds at its open (the shelves in view, the tiles in each shelf's width). "Looking
  through what you play…" shows only when the cap passes with no shelves; shelves that land
  after it enter as one block. Apple's two recents lists and the New shelf's releases left the
  build (`askApple` in home.ts): the shelves draw from local data and the lists in memory, and
  an answer that changed a list builds again, patched in place; the refresh square turns while
  a call is out. Read before the build: Rust keeps no copy of the releases, so after a launch
  the New shelf joins a moment later.
- Search (S2 A): the answer shows at once. Each section's new covers wait
  (`data-art-held`) until its first screen is loaded and decoded, at most `--search-reveal-cap`
  (0.8 s), then fade in left to right over `--search-reveal-span` (0.15 s); ↓ from the field
  shows every section at once. A drill from a result is an engine level and holds as one.
- The Queue: holds at its open and when the shown list is replaced whole (no entry kept);
  an advance, an Add or a drag never holds. History: at its open, until the first read.
  Rewind: at its open and at a stat or window switch. Diary: its home page at the open.
- The setting: `instantCards` (default empty), Settings › Cards › *Cover load animations*
  (his name), nine toggles; agent keys `instantCards.<card>`, labels "Library cover load
  animations" and so on; a `NEW_MARKS` line per row; the Cards reset group takes it. An instant
  card never holds and plays no wave; its panel wears `data-instant` and its covers show the
  frame they load, with no square and no fade (W2 B, his call).
- Not a rule key: every rule key is one value today; a list key needs a rule row that picks
  cards. For later, his call.

**Decided by Claude inside his choices (for him to see):**
1. The ladder's mapping: a large Library tile asks 480 (was 300), a small one 192 (was 160),
   an artist in Search 192 (was 96), the Queue and History heroes 96.
2. The warm list keeps each card's last first screen in localStorage (URLs only).
3. The Full | Lib switch and a rule-grow drill do not hold; Grow and Fill keep their own row
   entry (CARD-GROW.md §19). The "Grow becomes the wave" part of 7.11 part 1 is not built.
4. `fetchpriority` replaced by eager first-screen loads during the hold (4c above).
5. Home's two recents calls left the build too, not only the New shelf's ("Home never waits on
   Apple to show", 7.9 part 6).
6. A face that replaces a borrowed cover on Home fades in from the slot's ground, not across
   the old cover (7.9 part 4: no cut, but not a cross-fade).
7. The Cards reset hint now reads *Every card back in the picker, and every card waits for its
   covers. Rewind stays out until 50 plays*.
8. The Queue's "replaced whole" test: no entry on screen before is on screen after.
9. Diary holds at its open only; its home page is still drawn whole (`innerHTML`), because its
   picker field is wired on each draw.

**Step 8 (run 2026-10-17, his go):** the numbers are under 7.13's baseline. One fix followed it
(a loaded picture moves between keys in one patch); a re-run of the pasted searches would
measure it.

---

## Holistic pass — done small (2026-09-18)
The fundamentals were done: a warm click is 0.7–1.6 s and our part is under 20 ms (§5). The
pass reviewed every section against the code. `loading` is set on both re-window paths and
cleared in a `finally`, so no cover-up can outlive a failed load. One loading vocabulary is now:
model-first text and cover (Now Playing, Qcard), the clock reset to the incoming song (§1), the
Qcard cover dim (a skin token), the seek hold (§3). No spinners, shimmers or disabled transport
were added — the gaps are too short for them. **§6b fork 1B closed (2026-09-18, user: C):** a
user's own surface pick stays an instant jump; only an agent's change goes under the cover. An
agent does not care about the surface, so its change is the one that should read as a calm view
for the user; a person who picked a surface wants it now.

## Holistic pass — guiding ideas (as written before the pass)
- **One loading vocabulary:** drive every cover-up off `PlayerState.loading` (+ a future
  `buffering` for seeks) so spinners/shimmers/disabled-states look and time the same.
- **Optimistic-first:** update the UI from the *model* immediately on intent; let audio
  reconcile. The Qcard jump already does this — generalize it.
- **Tokenize the motion:** any pulse/shimmer/transition becomes a skin token (currently
  the Qcard's loading dim is a plain opacity + a component-scoped token placeholder), so
  skins can restyle it like everything else.
- **Honest, not fake:** cover-ups should reflect real state (loading is loading), never
  hide a failure. On a load error, surface it — don't spin forever.

---
status: shipped
shipped_in: 0.27.0
desk_test: passed 2026-10-12
sources: [src/gpu.ts, src/gpu-rules.ts, src/reduce-motion.ts, src/motion.ts, src/queue-persist.ts, src-tauri/src/tray.rs, src/gpu-probe.ts, src/frames.ts, src/rules-eval.ts, src/rules.ts, src/rulez-words.ts, src/rulez-card.ts, src/settings-store.ts, src/settings-card.ts, src/agent-settings.ts, src/main.ts, src-tauri/src/gpu.rs, src-tauri/src/lib.rs]
updated: 2026-10-20
---
# DeetsMusic — Graphics fallback: when the graphics card stops

> **Built 2026-10-11, desk test passed 2026-10-12 (§8).** §9 is the as-built record: where it disagrees with
> the design above it, §9 is the code. **§10 is designed 2026-10-20, not built:** the app gets
> the card back by itself with a restart the user does not see, and it reduces all motion while
> it draws in software. F1–F3 are his calls; F4–F6 are open (§10.7).

**When the graphics card stops, DeetsMusic turns off its heavy effects and tells you.** A rule
holds the effects off while the window draws in software. A sticky toast offers a restart, which
is the only thing that gets the card back.

**The terms.**
- *Software drawing:* WebView2 draws the window with WARP (Windows' own software rasteriser,
  `D3D10Warp.dll`) on the CPU, not with the graphics card. The renderer names itself
  "Microsoft Basic Render Driver".
- *The GPU process:* the WebView2 process that draws the window. It is a child of the app's
  WebView2 browser process.
- *The graphics fact:* a new rule fact, `graphics`, with the values `accelerated` and `software`.

## 1. Why (2026-09-29)

He updated his graphics drivers with the live app open. At 11:32:29 the GPU processes of two
WebView2 apps crashed at the same moment (`--gpu-recent-crash-count=1`) and came back on WARP
only: no `amdxx64.dll` loaded. The live app's GPU process then used 100 % of one core for over
3 hours, with the music paused; the page used 6 %. Clicks and hovers felt late. A Glass Covers
canvas draw took 3,010 ms at 3440×1352 (`wallpaper:draw` in the ring).

**The card does not come back in the same session.** GPU processes started later (11:48, 1:46 PM)
loaded the AMD driver; the crashed one never did. Only a new GPU process gets the card back, so
the fix for the user is a restart.

## 2. His calls (2026-09-29)

1. **A Settings row owns a built-in rule, on by default** (not a recipe). Every user gets it,
   Cruisin users too ([HOP-IN.md](HOP-IN.md)). It shows in Rulez like the look schedule's rules.
2. **What turns off:** Battery saver's set and more (RULES.md §18a) — Fancy Glass off
   (`glassFancy`), Animate backgrounds **Off** (`backgroundMotion`, not Reduced), Animate card
   swaps off (`cardSwapMotion`), Animate look changes off (`appearanceMotion`), and a Covers or
   Picture canvas goes to Aurora (`glassCanvas`). All five are rule keys today
   (`settings-store.ts` `RULE_KEYS`). His own values never change: the rule is an overlay.
3. **The toast follows the updater's pattern** (TOASTS.md §5, `updater.ts`): a sticky question
   whose **Later** is the close, so no separate Dismiss. Three buttons: Restart, Turn effects on,
   Later. *Turn effects on* ignores the failure: the effects come back now and stay until the
   next start.
4. **Detection: both** — the WebView2 event and a timer as a safety net (§4).

## 3. The row

> **Part:** built · 2026-10-11 · the words and the place as written (his call, 2026-10-11)

Settings › Motion, after Fancy scrubber: **If graphics fail** — **Save + tell** (default) ·
**Tell only** · **Off**. Hint: *When the graphics card stops, turn off heavy effects until
DeetsMusic restarts.*

- *Save + tell:* the rule holds while `graphics` is `software`, and the toast shows.
- *Tell only:* no rule; the toast shows with [Restart now] [Later].
- *Off:* nothing. The log line still writes (§6).

The build checklist (CLAUDE.md › Working style) applies: a new key `graphicsFallback` with its
default and the why, an agent spec, a line in AGENT.md, a `NEW_MARKS` line, the ONBOARDING.md §1
hint ledger, the Compass (automatic for a store-backed row).

## 4. Detection

1. **At start.** The page reads the renderer name once, after the first paints: the probe in
   `frames.ts` `logRenderer` today, which is dev only. It moves to a small module that ships in
   the release bundle and sets the `graphics` fact. `/swiftshader|software|llvmpipe|basic render
   driver|warp/i` means `software`.
2. **The WebView2 event.** Rust adds a `ProcessFailed` handler through `with_webview`
   (`lib.rs` already uses it for the accelerator keys). On
   `COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED` it emits `gpu-process-failed` to the
   page, and the page reads the renderer again after the new GPU process is up (a short wait,
   then a second read). Not yet proven to fire on his machine: the desk test checks it.
3. **The timer.** Every 5 minutes the page reads the renderer again (the interval Apple health
   uses). Each read makes one WebGL context and frees it at once (`WEBGL_lose_context`).
4. **The fact has a seam** (like `power.seam` for the battery), so the engine checks the rule the
   moment the value changes.

A change from `software` back to `accelerated` in the same session is not expected (§1). If a
read sees it, the rule stops by itself and the toast goes.

## 5. The toast

> **Part:** built · 2026-10-11 · the text as written (his call, 2026-10-11)

Warn, sticky, a question. Once per session.

*The graphics card stopped, so DeetsMusic draws in software. Some effects are off to keep it
smooth. Restart to get them back.* **[Restart now] [Turn effects on] [Later]**

| Button | Does |
|---|---|
| Restart now | Relaunches the app (the updater's restart path). Cards come back from card memory. At start the app reads `accelerated`, so the effects return by themselves. |
| Turn effects on | The rule stands aside until the next start (`onHand: "session"`, RULES.md §8). |
| Later | Closes the toast. The effects stay off until the next start. |

With *Tell only*: *The graphics card stopped, so DeetsMusic draws in software and may feel slow.
Restart to fix it.* **[Restart now] [Later]**. A start that is already on software shows the
toast too. It gets a row in TOASTS.md §5.

## 6. Log lines

`gpu:renderer {name, soft, why: "start" | "event" | "timer"}` on each read that changes the
value; `gpu:processFailed {kind, exitCode}` from Rust; the rule's own on / off lines; the toast's
button in `ui:act`.

## 7. Open (his)

1. ~~The row's place, its name and its three choices.~~ Decided 2026-10-11: as written in §3.
2. ~~The toast's text.~~ Decided 2026-10-11: as written in §5.
2a. ~~A renderer name of "unknown" (WebGL blocked).~~ Decided 2026-10-11: it counts as
   `accelerated`, so the effects never turn off on a guess.
3. Not recommended, not planned: a "restart the graphics only" button that ends the GPU process.
   Chromium turns hardware drawing off for good after three GPU crashes in a short time, and each
   forced end counts as one.

## 8. Desk test

1. `npm run dev:app -- --gpu=off`. At start: the toast shows, the Motion rows and Fancy Glass wear
   the rule's dot, a Covers canvas shows Aurora, `gpu:renderer` reads `software` in the ring.
2. Turn effects on: the effects return; the rule reads set aside until the next start.
3. Later: the toast goes; the effects stay off.
4. Restart now: the app relaunches. Plain `dev:app` reads `accelerated`, and every effect is back.
   Note (2026-10-11): a restart of the `--gpu=off` dev app relaunches the same exe, and it can
   keep the flag. Then it reads `software` again, which is correct for that run. Check the
   plain case on a plain `dev:app` restart, or on the installed build.
5. The event: on the plain dev app, end the GPU process (Task Manager). Check that
   `gpu:processFailed` logs and a second read follows. Whether WebView2 comes back on the card
   or on WARP decides whether the rule holds.
6. The row on *Tell only* and on *Off*.
7. (2026-10-11) Hover the bolt beside a held row: *The graphics card stopped, so this is off
   until DeetsMusic restarts. Your own setting comes back then.* After Turn effects on, the hand
   chip: *Effects are back until DeetsMusic restarts. Press to turn them off again.*
8. (2026-10-11) Settings › Motion shows the N on *If graphics fail* until the pointer rests on it.

**Results (2026-10-12, run by Claude on the dev app, driven over CDP).** All eight steps pass.

| Step | Result |
|---|---|
| 1 | `--gpu=off`: renderer *Microsoft Basic Render Driver*, `graphics` = `software`, the rule holds all five keys (`bgMotion` off, `glassFancy` off, Canvas on Aurora), the toast shows, `gpu:renderer … why: start` in the ring. Settings › Motion: green dots on the four held rows, Canvas and Fancy Glass. |
| 2 | Turn effects on: five `session` holds, the effects return at once, the toast goes, nothing saved to `deets.rules.holds`. The hand dot on a row gives all five back to the rule. |
| 3 | Later: the toast goes, the effects stay off; `gpu:toast {button: "Later"}`. |
| 4 | Restart now: the app relaunched in 1.3 s (`app: restart asked from the window (graphics fell back to software)`), the song, Max and the Settings card came back. The `--gpu=off` exe kept the flag, read `software` again and showed the toast again (correct). The runner then exits; that is dev only. A plain `dev:app` reads *AMD Radeon RX 6700 XT*, `accelerated`: every effect is back, no toast. |
| 5 | Ending the dev app's GPU process (msedgewebview2 `--type=gpu-process`, the dev data folder only): Rust logged `gpu: a WebView2 process failed (kind 6, exit Some(1))`, the page logged `gpu:processFailed {kind: 6, exitCode: 1}`. WebView2 came back on the card, so the reads found `accelerated` and the rule did not hold. A read that finds the same value writes no line (§6), so the follow-up reads are not in the ring. |
| 6 | Tell only: the rule goes at once, the effects return, a reload shows the two-button toast. Off: no toast, no rule; `gpu:renderer` still logs. Set back to Save + tell. |
| 7 | The bolt hints read as written; Canvas has its own (*…the canvas shows Aurora until DeetsMusic restarts…*). The hand hint reads as written. |
| 8 | The N shows on the row. |

**Found and fixed in the run.**
1. Rulez read the rule as *keeps the picture undefined*: Glass › Canvas was always one half of
   *Use picture*. Now only `glassCanvas = picture` joins the picture; Aurora and Covers have their
   own word (`glassCanvas` in rulez-words.ts, not offered in a row) and read *keeps the Glass canvas
   on Aurora*. Test: `If graphics fail reads as words`.
2. The rule's menu in Rulez said *This rule has no Settings row*, and the list had no name for it:
   `graphicsFallback` was missing from `ROWS` in rulez-card.ts. Now it reads *If graphics fail* and
   *Open in Settings* opens Settings › Motion.
3. The toast's buttons wrote no log line (toast.ts logs none). Each now writes `gpu:toast {button}`.
4. The bolt hint said *this is off* on Canvas, which is set to Aurora, not off. Canvas has its own
   sentence now.

## 9. As built (2026-10-11)

> **Part:** built · 2026-10-11 · desk test passed 2026-10-12 (§8)

**Where it lives.**

| Part | File |
|---|---|
| The probe (one WebGL context, freed at once) | `src/gpu-probe.ts` `rendererName`. No imports: the dev `[perf] gpu` line in `frames.ts` and the fact share it. |
| The software test (`/swiftshader\|software\|llvmpipe\|basic render driver\|warp/i`) | `src/rules-eval.ts` `isSoftwareRenderer`. Pure, under test. |
| The `graphics` fact, its seam, the three reads, the toast, the chip words | `src/gpu.ts` `initGpu`. It is in main.ts's late group, with the other Rulez facts. |
| The built-in rule `row:graphicsFallback` | `src/rules-eval.ts` `builtinRules`, with the set in `GRAPHICS_OFF`. The row key is in `ROW_KEYS` (rules.ts). |
| Turn effects on | `src/rules.ts` `holdForSession(ruleId)`: a session hold on every target of the rule. A session hold is never saved, so the next start clears it. |
| The GPU-process watch | `src-tauri/src/gpu.rs` `watch`. It adds `ProcessFailed` with `with_webview` in dev and release. On `GPU_PROCESS_EXITED` it emits `gpu-process-failed {kind, exitCode}`. Every kind writes one `gpu:` line to the Rust log. |
| Restart now | `app_restart` (lib.rs). It now takes an optional `why` for its log line. Before it, `flushForRestart` saves the queue and the position, as the updater does. |
| The row | Settings › Motion, **last** in the section (after *Animate backgrounds*). Agent spec in `agent-settings.ts`; `NEW_MARKS` line; the Motion square of the quick panel lists it. |
| The Rulez word | `graphics` in `rulez-words.ts`, Window section: *Graphics* is *Graphics card* / *Software*. A user's own rule can read it. `glassCanvas` is a word too (2026-10-12), with no `state`, so a row never offers it; it lets the sentence read *keeps the Glass canvas on Aurora*. |
| The rule's name in Rulez | `graphicsFallback` in `ROWS` (rulez-card.ts): *If graphics fail*, with *Open in Settings*. |

**The reads.** 2 s after `initGpu` (the first paints); 3 s and 10 s after each
`gpu-process-failed`; every 5 minutes. Before the first read the fact has no value, so the rule
does not hold. A read that finds the same value logs nothing. `gpu:renderer {name, soft, why}`
logs each change.

**Decisions made inside his choices (2026-10-11).**
1. **The row is last in Motion, not between Fancy scrubber and Animate backgrounds.** The design
   says "after Fancy scrubber". When it was written, that was the end of the section. Today
   *Animate backgrounds* comes after it, and a row between them would split the Animate rows.
2. **`onHand: "session"` for any hand change**, not only the toast's button. A change by hand
   to one of the five rows sets the whole rule aside until the next start, as Turn effects on
   does. The rule sets five targets, so the hold covers all five (the look schedule's way).
3. **The rule's place in the order.** Built-in rules come after your own rules and the recipes
   (rules.ts `rebuild`), and the first rule wins a target. So with **Battery saver** on and the
   PC on its battery, *Animate backgrounds* is **Reduced**, not Off. A user rule that sets one of
   the five keys also wins. This is the engine's order for every built-in rule today.
4. **The chip words** (§8 step 7) and the failed-restart toast (*Couldn't restart DeetsMusic.
   Close it and open it again.*) are new text.
5. **The `graphics` fact is visible in Rulez**, not hidden like `lookMode`.
6. **A restart toast with *Tell only*** has no Turn effects on, as §5 says. With *Off* the reads
   and the log lines still run; only the toast and the rule are off.

## 10. Get the card back by itself, and reduce motion while it is gone

> **Part:** built · 2026-10-20 · his calls F1–F6 (§10.7); the as-built record is §10.10, the desk test §10.11.

**His ask (2026-10-20):** "design the auto-retry for hardware drawing in case of failure. Trying
to keep it as seamless as possible for the user and automatically reducing motion for the user so
they don't see the app slug along when it can't show off."

**The terms.**
- *The card is ready:* Windows has a working hardware adapter that can make a Direct3D 11 device.
  Rust tests this; the page cannot.
- *A quiet restart:* a restart the user does not see or hear. The window is not on screen and no
  music plays, or the restart falls in the gap between two songs.
- *Reduced drawing:* the set of changes the app makes while `graphics` is `software` (§10.4).

### 10.1 What happened on 2026-10-20 (the evidence)

1. 12:15 to 12:16: the AMD Adrenalin 26.10.1 installer replaced the display driver (Windows
   Application log: `MsiInstaller`, *Radeon Installer*; System log: a new `amduw23g` service at
   12:16:07). Windows logged *Machine restart is required*.
2. 12:16:08: the GPU processes of DeetsMusic and DeetsRGB both ended in the same second
   (`gpu: a WebView2 process failed (kind 6, exit Some(34))`). The live app came back on
   *Microsoft Basic Render Driver* (`gpu:renderer … soft: true, why: event` at 12:16:11).
3. The rule held the five effects off from 12:16 to 16:18. **He still saw the app stutter**, and
   asked why. So the five effects are not enough (§10.4).
4. The toast waited 4 hours. At 16:19 he pressed **Restart now**. The new GPU process loaded the
   AMD driver (`amdxx64.dll`) at once.
5. So §1 holds a second time: the card comes back only with a new WebView2 browser process. A
   new GPU process inside the old one stays on WARP.

### 10.2 The parts

1. **Rust knows when the card is ready** (§10.3).
2. **The app restarts by itself at a quiet moment** (§10.5), and comes back as it was: the
   window's state, the song, the place in the song, playing or paused.
3. **While it draws in software, the app reduces all motion**, not only five effects (§10.4).
4. **The toast says only what is true** (§10.6). Today it says *Restart to get them back* also on
   a PC where no restart can help.

### 10.3 Knowing the card is ready

- **The event.** Rust registers `IDXGIFactory7::RegisterAdaptersChangedEvent` (Windows 10 1803
  and later). Windows signals it when an adapter is added or removed, which a driver install
  does. No timer, no polling.
- **The test.** After the event, and once at start when `graphics` is `software`, Rust lists the
  adapters (`EnumAdapters1`), skips the software ones (`DXGI_ADAPTER_FLAG_SOFTWARE`, *Microsoft
  Basic Render Driver*) and makes one `D3D11CreateDevice` on each hardware adapter, then frees it.
  The answer is `ready {adapter}` or `none`.
- **Settle time.** A driver install signals the event more than once. Rust waits until no event
  came for 20 s, then tests. One `gpu:adapters {ready, name, events}` log line per test.
- **The page gets a new fact value**: `graphics` is `accelerated`, `software` (the card is ready,
  a restart gets it back) or `noCard` (no hardware adapter works; a restart cannot help). Not a
  fork: a restart on `noCard` only blinks the window and gets nothing.
- **Not expected, still handled:** the 5-minute WebGL read (§4.3) stays. If it ever finds
  `accelerated` in the same session, the reduced drawing ends by itself (as §4 says today).

### 10.4 Reduced drawing

**What holds now** (§2): Fancy Glass off, Animate backgrounds Off, Animate card swaps off, Animate
look changes off, the Covers or Picture canvas on Aurora. On 2026-10-20 that still stuttered.

**What else draws on WARP.** WARP draws every changed pixel on the CPU. Two kinds of cost remain:
- *Motion:* about 25 modules check `prefers-reduced-motion` themselves (card grow, card swap,
  pop, the full player, Present, the context menu, the drill slide, Ocean, Metal and more), and
  styles.css has about 10 `@media (prefers-reduced-motion)` blocks. None of them listens to the
  app. So on software they all still animate.
- *Endless loops and blur:* the fancy scrubbers (`scrub-bob`, `scrub-sheen`, `scrub-breathe`),
  the album aurora's spin (`np-aurora-spin`), the Press record's turn, Metal's zoetrope and
  textures, and 34 `backdrop-filter` rules in styles.css (Glass's frost). A blur under a list
  draws again on each scroll frame.

**The build.**
1. **One app-wide switch: *Reduce motion* (his calls F3, 2026-10-20).** A new rule key
   (`reduceMotion`, **On** · **Off**, default Off) and a Settings › Motion row. It is the catch-all
   for every heavy graphics feature (his words: "this can be the catch all for turning all the
   hard graphics features off").
   - **Windows' reduced motion always turns it on.** There is no *Follow Windows* choice. While
     Windows asks for reduced motion, the row reads On and cannot be turned off; the hover hint
     says why.
   - **On turns off the whole reduced set** (F4): every transition becomes a fade or a cut, and
     each heavy feature reads as off. The heavy rows keep the user's own value and show a chip
     (*Off while Reduce motion is on*), as a rule-held row does today. Turning Reduce motion off
     gives every one of them back.
   - **The code.** One helper, `motionReduced()` in a small pure file, answers *Windows asks for
     it, or the key is On*, and sets `data-motion="reduced"` on `<html>`. Every
     `matchMedia("(prefers-reduced-motion…")` call site (about 25) moves to it, and every CSS
     block (about 10) gets the matching `[data-motion="reduced"]` selector. Each heavy key is
     read through it. docs:check gets a check that fails a new bare `matchMedia` for it.
2. **The graphics rule holds one key: Reduce motion On.** Today it holds five; after this, the
   five follow from Reduce motion. *Turn effects on* (today's session hold) sets Reduce motion
   aside for the session. It does not show when Windows asks for reduced motion, because then the
   effects cannot come on.
3. **The rule holds on the event, not on the read.** Today the effects turn off 3 s after the GPU
   process fails (the first read). The event itself is enough: the rule holds at once, and the
   read can give them back if the new GPU process is on the card.
4. **Measure before the list is final** (probe P2, §10.8): each item of the draft on
   `dev:built --gpu=off` at his Max size, frames ÷ ms per gesture. An item that does not change
   the number leaves the list.

### 10.5 The quiet restart

**When** (the moments, first one that comes wins; F1 and F2 choose which ones are allowed):
1. The card is ready, the window is hidden in the tray or minimized, and nothing plays: restart
   at once.
2. The card is ready, the window is hidden or minimized, and music plays: restart at the end of
   the song, then the next song starts (F2).
3. The window is on screen: no restart by itself. The toast asks (§10.6), now with a true reason.

**How it comes back.**
- The window's state: hidden → the `--tray` start that a login launch uses today; minimized →
  starts minimized; the same size and place (card memory and the window store do the rest).
- The music: `flushForRestart` writes the snapshot today with `updateRestart` and `at`. It gets
  one more field, `play: true` when music played. At start the app then plays from `at` (or the
  next song, for moment 2) without a press. Autoplay with no press is already allowed
  (`--autoplay-policy=no-user-gesture-required`, tauri.conf.json).
- A `--graphics-restart` start argument marks the start, so the log, the ring and the plays table
  (`context`) can tell it from a plain start.

**Guards.**
- **One automatic restart per failure.** If the app starts on software again after one, it does
  not restart by itself again until a new adapter event comes. A count in the restart snapshot
  carries this across the restart.
- **Never during a room, an AirPlay start, an export or a download** (the updater's busy test,
  `busy.ts`, if it covers these; else the same list).
- **Never while a text field has typed text** that is not saved.
- Each automatic restart writes `app: restart asked from the window (graphics card ready again,
  quiet)` and `gpu:quietRestart {moment, playing}`.

### 10.6 The toast

Two cases, two texts (draft; the words are his, §10.7 F5):
- `software`, the card is ready (after the event): *The graphics card is back. Restart to use it.*
  **[Restart now] [Later]**. If F1 allows it, the toast also says the app restarts by itself when
  its window is hidden.
- `software`, the card is not ready yet (the driver is still installing): no toast yet. The
  reduced drawing is on, which keeps the app smooth. The toast waits for the event.
- `noCard` (no working hardware adapter, at start or later): one toast per install, not per
  session: *DeetsMusic draws in software on this PC, so it keeps motion low.* **[OK]**. No
  Restart button, because a restart does not help.
- *Turn effects on* moves from the toast to the bolt chip beside a held row, which already does
  it (§8 step 7). Not a fork if he keeps it on the toast; it is listed in F5.

### 10.7 The forks (his)

**Decided 2026-10-20 (his words: "1A 2A 3A (no follow windows option, always turn on if windows
reduced motion. can mention in hover text), this can be the catch all for turning all the hard
graphics features off"):** F1 A, F2 A, F3 A with his change (§10.4 item 1). Open: F4 (the list),
F5 (the words), and the row's place and hint (F6). The options below are kept as the record.

**F1. When may the app restart by itself?** — **A, his call.**
- **A (recommended): only when it cannot be seen.** The window is hidden or minimized (moments 1
  and 2). On screen, the toast asks. Cost: a user who keeps the window on screen all day stays on
  software until they press Restart.
- **B: also on screen, when nothing plays and nobody touched the app for 2 minutes.** The window
  disappears for about 1.3 s (§8 step 4) and comes back. Cost: a user who looks at it then sees a
  blink with no reason given.
- **C: never by itself.** The toast only changes to *The graphics card is back*. Cost: the slug
  lasts until the user presses, as on 2026-10-20 (4 hours).

**F2. Music plays and the window is hidden: restart between two songs?** — **A, his call.**
- **A (recommended): yes, at the end of a song.** The gap to the next song is longer than usual
  (probe P3 measures it). Cost: one longer gap. Without it, a hidden app that plays all day uses
  a CPU core on WARP all day (2026-09-29: 100 % of one core for 3 hours).
- **B: no, wait until the music stops.** Cost: the CPU cost above, for as long as music plays.

**F3. Is reduced motion also a Settings row?** — **A, his call, changed:** On · Off only;
Windows' reduced motion always turns it on (§10.4 item 1).
- **A (recommended): yes.** Settings › Motion › *Reduce motion*: **Follow Windows** (default) ·
  **On** · **Off**. The graphics rule holds it On. A user who wants less motion gets it without
  changing Windows. Cost: one more row in Motion, with its N mark and agent spec.
- **B: no row.** Only the graphics rule sets it. Cost: the switch exists, but a user cannot
  reach it.

**F4. What Reduce motion turns off (a draft for him to edit).** Since F3 it is also what a user
with Windows' reduced motion gets, on any PC.
1. Every transition becomes a fade or a cut (card grow, swap, pop, rows, the full player,
   Present, menus, drill slides).
2. The five of §2: Fancy Glass, Animate backgrounds (Off), Animate card swaps, Animate look
   changes, and the Covers or Picture canvas on Aurora.
3. Fancy scrubber off (`fancyScrub`).
4. The album aurora holds still (no `np-aurora-spin`).
5. The Press record holds still while it plays (the cover stays; it does not turn).
6. Metal: the zoetrope cover change becomes a fade; the textures draw once and do not move.
7. Glass's frost becomes a solid tint (no `backdrop-filter`), only if P2 shows it costs.

Item 2's canvas is not motion: a Covers canvas is a still picture that is costly to draw only in
software. With F3 a Windows reduced-motion user with no graphics fault loses it too. Keep it in
the list, or hold it only in the graphics rule.

**F5. The words** of the three toasts in §10.6, and whether *Turn effects on* stays on the toast.

**F6. The row's place and hint (a draft).** First in Settings › Motion, above the rows it
controls. Label *Reduce motion*, pills **On** · **Off**. Hint: *Turn off animations and heavy
effects. Always on when Windows reduces motion.* A `NEW_MARKS` line, an agent spec, a line in
AGENT.md, the ONBOARDING.md §1 ledger.

### 10.8 Probes before the build

| Probe | What it answers | Who |
|---|---|---|
| P1 | Does a new GPU process inside the old browser process ever get the card back? | **Done:** no, twice (2026-09-29, 2026-10-20, §10.1). |
| P2 | What each item of F4 saves on WARP: `npm run dev:built -- --gpu=off`, Max at 1400×1000 and full width, the bench scenes (scroll, grow, menu, swap), frames ÷ ms with and without each item. | Claude |
| P3 | The gap from a song's end to the next song's sound across a restart with `play: true`. | Claude, on the dev app |
| P4 | `RegisterAdaptersChangedEvent` fires on a driver change, and the D3D11 test then says ready. A safe trigger: turn the Parsec virtual display adapter off and on in Device Manager. A real AMD driver install is the full test. | Owner (it needs Device Manager) |
| P5 | `--tray` and a minimized start come back with no flash on the taskbar. | Claude, on the dev app |

### 10.9 A PC with no working graphics driver

A laptop almost always has a graphics chip in its processor (Intel or AMD), and WebView2 draws
on it. That is hardware drawing and is fast. Software drawing on every start comes only when
Windows has no working driver: a fresh install on *Microsoft Basic Display Adapter*, some
virtual machines and remote sessions, or a driver that Edge blocks. On such a PC today the five
effects turn off at start, and the toast wrongly says a restart fixes it. After §10 the app
reads `noCard`, holds the reduced set from the first read (2 s after start), and says once that it keeps motion
low.

### 10.10 As built (2026-10-20)

> **Part:** built · 2026-10-20 · desk test run by Claude (§10.11); his hand test passed
> 2026-10-20 (his word). The real driver test (P4) waits on a real driver failure

**Where it lives.**

| Part | File |
|---|---|
| Is the card ready: one D3D11 device on each hardware adapter, made and freed | `src-tauri/src/gpu.rs` `card_test`, the command `gpu_card_ready` (asked once at a software start) |
| The adapter watch: `IDXGIFactory7::RegisterAdaptersChangedEvent`, 20 s settle, then `gpu-adapters {ready, name, events}` | `gpu.rs` `gpu_watch_adapters`, a named thread `gpu-adapters`, started only after the first software read |
| The quiet restart's window state: a `restart-intent.json` the next start reads and deletes | `gpu.rs` `app_restart_quiet`, `take_intent`; `tray.rs` `set_launch`, `show_minimized` (`SW_SHOWMINNOACTIVE`) |
| The rule: now / at the next song / toast / wait | `src/gpu-rules.ts` `quietAction`, `tellNoCard` (pure, `tests/gpu-rules.test.ts`) |
| The reads, the window and playback watches, the toasts, the restarts | `src/gpu.ts` |
| Play on after the restart | `queue-persist.ts` `flushForRestart(play)`, the snapshot's `play`; the start plays at `deets:boot-done` |
| The switch | `src/reduce-motion.ts` (Windows' query, the key, `data-motion`, the `motionReduced` fact, the chip words); `src/motion.ts` `motionReduced()`, the one reader; index.html's pre-paint |
| The heavy set | `rules-eval.ts` `REDUCED_OFF` and the built-in rule `row:reduceMotion`; `GRAPHICS_OFF` is now Reduce motion on and the canvas on Aurora |
| The CSS | every `@media (prefers-reduced-motion)` block (25 in styles.css, 9 in styles/*.css) became `:root[data-motion="reduced"]` rules. docs:check 32 fails a new bare query or block |
| The row | Settings › Motion, first: `reducemotion`, a toggle locked On while Windows reduces motion; `NEW_MARKS`; agent spec; Rulez word `reduceMotion` and fact `motionReduced` |

**Decisions made inside his choices (2026-10-20).**
1. **`graphics` keeps two values.** The design named a third value, `noCard`; it is the card
   state in gpu.ts instead (`unknown` · `ready` · `none`), so a user's own rule on *Graphics*
   reads as before.
2. **A hand change on a held heavy row sets Reduce motion's rule aside until the next start**
   (`onHand: "session"`), as the graphics rule did. Under Windows' reduced motion this is the
   one way to have one effect back for a session; the row itself stays locked.
3. **Turning the Reduce motion row Off while the graphics rule holds it** is a hand change on the
   graphics rule: every effect comes back until the next start (today's *Turn effects on*, which
   left the toast, F5).
4. **Tell only still restarts quietly and shows the toasts**; it only makes no rule. Off does
   nothing at all.
5. **The no-card toast's Tell only words** are new: *DeetsMusic draws in software on this PC, so
   it may feel slow. Settings › Motion › Reduce motion helps.*
6. **The chip words** are new: *Reduce motion is on, so this is off. Your own setting comes back
   when Reduce motion is off.* / *Your pick holds until DeetsMusic restarts. Press to give it back
   to Reduce motion.* The graphics rule's bolt now says *until the card is back*.
7. **The busy guards:** a listening room, AirPlay output while music plays, a focused text field
   that holds text. An export is not a guard (it is not long-running in the window).
8. **Restart now from the toast also plays on** if music played (the same `play` mark).
9. **`reduceMotion` is not on the usage allow-list** (`NOT_REPORTED`): a new key there is his call.
10. **The effects go off on the GPU-process event itself**, before the reads (§10.4 item 3).
11. **Glass's blur is not in the set yet** (F4 item 7): it waits for P2's numbers.

### 10.11 Desk test (2026-10-20, run by Claude on the dev app)

`npm run dev:app -- --gpu=off`, driven over CDP.

| Step | Result |
|---|---|
| Start in software | `gpu:renderer … soft: true`; Rust `gpu: adapters tested: ready true, AMD Radeon RX 6700 XT`; the graphics rule held `reduceMotion` and `glassCanvas`, then (the cascade) `row:reduceMotion` held all six keys; `data-motion="reduced"`, `data-bg-motion="off"`; your own values unchanged (`reduceMotion` false, `glassCanvas` covers) |
| Window on screen | the toast: *The graphics card is back. Restart to use it. DeetsMusic also restarts by itself when its window is hidden.* **[Restart now] [Later]** |
| The watch | `gpu: adapter watch on`, then after 20 s `gpu:adapters {ready: true, events: 0, why: "watch"}` |
| Minimize (nothing playing) | `gpu:quietRestart {moment: "now", window: "min"}` 2 s later; the new start logged `start: a quiet graphics restart, window min` and came up minimized (on the taskbar, not focused) |
| The guard | the new start was software again (the `--gpu=off` flag carries over, as in §8 step 4): `deets.gpu.quietTried` = 1, no second restart; restoring the window showed the toast instead |
| Reduce motion Off by hand | `rule:hand {id: row:graphicsFallback, target: key:reduceMotion}`; `data-motion` gone, backgrounds On |
| The row by itself | On: `data-motion="reduced"`, backgrounds Off; Off: both back |
| The row | first in Settings › Motion, with the N and the hand dot after the hand change |

**Not run here:** the song-start restart while music plays (F2) and its gap (P3); a real driver
change (P4, his); Glass's blur cost (P2).

**The break-it pass (2026-10-20, DESK-TESTS.md §6.5).** Three Sonnet agents, one per lens,
listed 45 cases. Triaged against the code, these were real and are fixed:
1. A card swap stuck when the switch flips mid-swap (no `animationend` from a cancelled
   animation): `playSwap` now has a safety timer with a run number (card-swap.ts).
2. The window shown again, or a room, AirPlay or typed text appearing, during the restart's
   waits: the rule is asked again after the waits and at the song start; a changed answer
   cancels (`undo`).
3. A failed restart left the music paused and the play-on mark saved: `undo` plays on and
   writes the plain blob (`saveNow`).
4. A silent restart on a moment of buffering (reads as not playing): silence must hold 10 s.
5. Repeat one or a one-song queue never gave a song start: a jump back to the top counts.
6. The play-on start missed `deets:boot-done` when the launch cover finished first, and
   `playPause` would have paused a song already playing: both checked.
7. A stale `restart-intent.json` (the process died before the restart) hid the next start: the
   file carries its time; older than 60 s is ignored.
8. *Restart now* and a quiet restart at once: one `restarting` flag for both.
9. AirPlay counted only while playing; an update downloading or waiting was not a guard: both
   are guards now.
10. A renderer read that finds no name (a GPU process still starting) flipped the state to the
    card: a later read with no name keeps the value.
11. The guard: a driver installed while the app was closed blocked every later quiet restart; a
    PC that stays in software restarted on each dock or remote-session change. Now the guard is
    the start that follows a quiet restart (2 min), with at most 2 quiet restarts a day.
12. A failed adapter watch never started again: the flag resets; the 5-minute read asks again.
13. The Compass toggled the locked row and wrote your stored value: a locked row ignores a set.
14. The tray panel (its own page) never got the switch: its pre-paint reads Windows and the
    row, and the main window sends each change (`motion-reduced`).
15. reduce-motion.ts read `matchMedia` at load: guarded for the unit tests.

**Run again after the fixes (17:14, the rebuilt dev app, `--gpu=off`):** software, reduced, the
toast; minimized at 17:14:17.3, the quiet restart at 17:14:27.4 (the 10 s of silence), the new
start minimized; one entry in `deets.gpu.quietRestarts`, no second restart. `npm run check`
passes (368 unit tests, docs:check, cargo check and test).

**Kept as they are (noted):** a class that waits for `animationend` (pop, reveal, the art fade)
stays on an element when the switch flips mid-animation and replays once when it flips back
(cosmetic); a song-start restart records the new song's start twice in `plays` (the first one
lasts under a second); a software start runs the boot lift at full cost before the first read
(2 s).

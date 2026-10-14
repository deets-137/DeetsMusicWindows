---
status: shipped
shipped_in: 0.27.0
desk_test: passed 2026-10-12
sources: [src/gpu.ts, src/gpu-probe.ts, src/frames.ts, src/rules-eval.ts, src/rules.ts, src/rulez-words.ts, src/rulez-card.ts, src/settings-store.ts, src/settings-card.ts, src/agent-settings.ts, src/main.ts, src-tauri/src/gpu.rs, src-tauri/src/lib.rs]
updated: 2026-10-11
---
# DeetsMusic — Graphics fallback: when the graphics card stops

> **Built 2026-10-11, desk test passed 2026-10-12 (§8).** §9 is the as-built record: where it disagrees with
> the design above it, §9 is the code.

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

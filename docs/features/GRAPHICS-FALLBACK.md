---
status: designed
desk_test: none
sources: [src/frames.ts, src/rules-facts.ts, src/rules-recipes.ts, src/settings-store.ts, src/settings-card.ts, src/toast.ts, src-tauri/src/lib.rs]
updated: 2026-09-29
---
# DeetsMusic — Graphics fallback: when the graphics card stops

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

> **Part:** designed · 2026-09-29 · the words and the place are open (§7)

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

> **Part:** designed · 2026-09-29 · the text is open (§7)

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

1. The row's place (Settings › Motion, since there is no Appearance section), its name and its
   three choices.
2. The toast's text.
3. Not recommended, not planned: a "restart the graphics only" button that ends the GPU process.
   Chromium turns hardware drawing off for good after three GPU crashes in a short time, and each
   forced end counts as one.

## 8. Desk test

1. `npm run dev:app -- --gpu=off`. At start: the toast shows, the Motion rows and Fancy Glass wear
   the rule's dot, a Covers canvas shows Aurora, `gpu:renderer` reads `software` in the ring.
2. Turn effects on: the effects return; the rule reads set aside until the next start.
3. Later: the toast goes; the effects stay off.
4. Restart now: the app relaunches. Plain `dev:app` reads `accelerated`, and every effect is back.
5. The event: on the plain dev app, end the GPU process (Task Manager). Check that
   `gpu:processFailed` logs and a second read follows. Whether WebView2 comes back on the card
   or on WARP decides whether the rule holds.
6. The row on *Tell only* and on *Off*.

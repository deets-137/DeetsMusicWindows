---
status: idea
desk_test: none
sources: [src/sound.ts, src/airplay.ts, src-tauri/src/audio_out.rs, src-tauri/src/airplay.rs]
updated: 2026-11-10
---
# Pick the output, and play on more than one

> **An idea, opened 2026-11-10** from the owner's ask: "Can we talk allowing DeetsMusic to control
> its output device? More specific than airplay if a user has multiple speaker connections (and
> allowing music to play at multiple speakers)."
> **§1 is what he said and is fixed.** §2 is what the code does today. §3 to §6 are Claude's
> proposal for the mechanics. §7 is what is still open. The picture in the panel is his to design.
> Nothing here is built. Do not tell a user the app does this.

**Terms**
- **Output:** a Windows sound device: the monitor's speakers, a USB device such as his Yeti,
  headphones, HDMI, Bluetooth.
- **Windows default:** the output that Windows gives to every app that does not ask for one.
- **Pick:** the output the user chose in DeetsMusic. Other apps do not move.
- **Group:** two or more outputs that play the same song together. An AirPlay speaker can be one
  of them.
- **Tap:** the node in our sound graph that copies the song to Rust (AIRPLAY.md §12).
- **Hold back:** to delay a fast output so that it plays in time with a slower one.

## 1. His calls (2026-11-10)

1. **Why.** His words: "I had this idea so I don't have to go to system's volume mixer everytime."
   Today he opens the Windows *App volume and device preferences* page to send DeetsMusic to
   another device.
2. **The case he means.** His words: "sending audio to my yeti speakers rather than monitor
   speaker output." Two wired outputs on one PC. Bluetooth is not the main case.
3. **A default stays.** His words: "Still want a default option so a user doesn't have to worry
   and can flip between devices as their device does." A user who never opens the list gets what
   they get today: the app follows the Windows default.
4. **Music can play on more than one output.**
5. **Rust plays a group.** He took this over Chromium playing each output (§4). Reason: Rust can
   hold each output back and correct drift. Chromium cannot correct drift.
6. **An AirPlay speaker can be in a group, in one list with the PC's outputs.** He took this over
   a group of Windows outputs only.
7. **Hold back the fast outputs.** His words: "We can hold back the faster outputs to sync up with
   the delayed outputs right?" Yes. That is the method (§5).

## 2. What the code does today

- The sound graph has one exit: `bus → tap → sink gain → ctx.destination` (`ensureContext` in
  `src/sound.ts`, [SOUND.md](../features/SOUND.md) §1). The destination is the Windows default.
- A song with no effect on does not go through the graph. Its `<audio>` element plays straight to
  the Windows default.
- `src-tauri/src/audio_out.rs` watches the Windows default only: its name, kind and volume
  (SOUND.md §10.1). The per-output EQ presets and *Fuller at low volume* read that. It already
  holds the Windows device list object, so a list of every output with its name is a small step.
- SOUND.md §10.1 records the limit: an output set for the app in the Windows page is not followed.
- For AirPlay, the tap posts 16-bit chunks to Rust, Rust puts them in a ring, and a pacer sends
  them to the speaker ([AIRPLAY.md](../integrations/AIRPLAY.md) §12.1). While a speaker plays
  alone, the sink gain is 0, so the PC is silent.
- A speaker takes about 2 s to play what it receives. With *All PC sound*, the PC and the speaker
  both play, and the PC is about 2 s ahead.
- The "Play on" panel behind the AirPlay square (`src/airplay.ts`) has one row for the PC, *This
  computer*, and one row per speaker. One row is picked at a time.

## 3. One output

**The rows.** The "Play on" panel is the place: it is the app's one list of where the music plays.
The PC part of the list becomes one default row and one row per output. The default row follows
Windows, as today (his call 3). A pick is kept across launches, because his reason is to stop
going back to a settings page (his call 1).

**The mechanics, two ways. A test picks one; it is not a choice for him.**

- **Chromium moves the graph.** `AudioContext.setSinkId(id)` sends the whole graph to one output,
  with no added delay. A pick then routes the song through the graph, as a connect does for the
  tap (AIRPLAY.md §12.1 item 7). The default row sets the id back to the default.
  - **The test.** Chromium hides output names and gives its own ids, which are not the Windows
    ids. A page gets names only after it has microphone permission. Check whether WebView2 lets
    the app grant that with no prompt and with no microphone opened. Then match the rows to
    `audio_out.rs` by name.
- **Rust plays the output.** If the test fails, a single pick uses the group path (§4) with one
  output. Cost: Play and Seek start later by the tap's buffer.

**Not taken: set the Windows per-app preference from code.** That is what the Windows page does.
Windows has no documented call for it, and the sound comes from a WebView2 child process, not from
our exe (AIRPLAY.md §10 rule 3).

**What follows a pick.** The output key in `sound.ts` (`win:<id>`) becomes the picked output, not
the Windows default. The per-output EQ preset and *Fuller at low volume* then read the output the
user hears.

## 4. A group: Rust plays every output

```
graph … bus ── tap ── sink gain (0 while a group plays) ── destination
                │
                ▼ chunks (as for AirPlay)
        Rust: one ring per output
                ├─ hold-back ─ drift correction ─ WASAPI ─ output 1 (Yeti)
                ├─ hold-back ─ drift correction ─ WASAPI ─ output 2 (monitor)
                └─ pacer ─ ALAC ─ AirPlay speaker (the slowest: no hold-back)
```

- The tap is the one copy point. It exists, and it sits after the EQ and the limiter, so every
  output gets the effects.
- The page is silent while a group plays (sink gain 0), as it is for a speaker alone. No output
  gets the song twice.
- Each Windows output gets a shared-mode WASAPI stream on its own thread (a row in the thread
  ledger, DEBUGGING.md § Threads).
- **Drift.** Each device has its own clock. Two outputs that start in time move apart over a long
  song. Rust watches each output's buffer level and resamples by a very small amount to hold it.
  The crate has the resampler (`resample.rs`, used by the AirPlay capture).
- **Volume.** The app's slider sets the group. A level per output is possible in Rust. Whether the
  panel shows one is his design (§7).
- **Cost while a group plays.** Play and Seek start later by the hold-back of the slowest output
  (§5). Pause and volume are instant: Rust empties the rings on a pause.
- **Terms.** AIRPLAY.md §12.2 is the check made on the tap for the Apple agreement. Read it again
  for local outputs before the build: the copy point is the same, the place it goes is new.

## 5. Hold back: how a group plays in time

1. Each output has a delay: the time from "Rust writes a frame" to "the air moves".
2. The group's delay is the largest one.
3. Each other output waits for the difference before it plays the same frame.

| Group | The slowest | Play and Seek start later by |
|---|---|---|
| Yeti + monitor (two wired outputs) | either, tens of ms | about 0.3 to 0.5 s (the tap's buffer) |
| Yeti + a Bluetooth output | Bluetooth, 100 to 300 ms | about 0.5 to 0.8 s |
| Yeti + a HomePod | the HomePod, about 2 s | about 2 s |

The numbers are estimates until measured. `deetsmeter` (music-app-comp.md §17) can measure a wired
output through the WASAPI loopback.

**Where each delay comes from.**
- A wired output: WASAPI reports its stream latency. To check: how close that number is.
- An AirPlay speaker: the session knows its delay (AIRPLAY.md §5, decision 5, the Auto delay).
- Bluetooth: the number Windows reports is often wrong. A trim the user sets by ear is the fix.

## 6. What changes in AirPlay

- A speaker alone: no change.
- *All PC sound* today plays the PC ahead of the speaker. A group of the default row and a speaker
  is the same pair in time. Whether *All PC sound* then stays as a row is open (§7).
- The speaker takes one sender (AIRPLAY.md §11). A group does not change that.

## 7. Open, for the design

Each is his call. None is needed before the test in §3.

1. **The panel.** How the user adds a second output to the one that plays, and how a group reads
   in the list. One pick at a time is the gesture today.
2. **The words.** The name of the default row, and whether *This computer* stays as that name.
3. **A picked output goes away** (the Yeti is unplugged). Pause, or go to the Windows default.
   For a group: go on with the outputs that are left, or pause.
4. **A group across launches.** Kept like a single pick, or one sitting only.
5. **A level per output**, and a trim per output for the cases where the measured delay is wrong.
6. **Rules.** "While the Yeti is connected, play on it" is a *while* decision, so it is a rule
   (RULES.md §19). In scope or later.
7. **Compass and the agent.** Speakers are in Ctrl+Space today (`src/compass.ts`, the Speakers
   group). Outputs join that group by the same rule. The agent route is a line in AGENT.md.
8. ***All PC sound*** (§6).

## 8. Build order (proposal)

1. The test in §3 (names and ids in WebView2). No UI.
2. One output: the rows, the pick, the default row. This alone answers his call 1.
3. The Rust output path, with one output, measured against the page's own path.
4. A group of two wired outputs: hold-back and drift, measured.
5. An AirPlay speaker in the group.

Steps 2 and 3 to 5 are separate features. One is in flight at a time.

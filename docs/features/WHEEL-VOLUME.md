---
status: built
desk_test: open
sources: [src/wheel-step.ts, src/wheel-volume.ts, src/main.ts, src/now-playing-card.ts, src/player.ts, src/settings-store.ts, src/settings-card.ts, src/agent-settings.ts, src/usage-keys.ts, tests/wheel-step.test.ts]
updated: 2026-10-27
---
# The mouse wheel on the volume

> **Built 2026-10-27 on `onepointtwo`, committed and pushed; in the 1.2.0 notes. The desk test (§5) is open.** The title
> bar volume pill took the wheel before this (one 5 % step per wheel event). Now the Now Playing
> card takes it too, and a trackpad can no longer jump the volume to full.

## 1. His calls (2026-10-27)
1. **The wheel anywhere on the Now Playing card steps the volume,** on every surface, the
   full-screen player included. Wheel up is louder.
2. **No extra feedback** beyond the volume bar itself: no readout, no toast. The sound is the
   feedback. Amended the same day: **the small title bar pill grows while the wheel turns when
   no other volume bar is on screen** (§3a).
3. **Settings › Playback › *Scroll over the Player for volume*,** a toggle, default on
   (`playerWheelVolume`). Off: the wheel passes through the card. The title bar pill always
   takes the wheel.
4. **A trackpad's rise is capped at 40 % a second.** Lowering is never capped. A notched mouse
   is never capped.

## 2. The rule (`src/wheel-step.ts`, pure, `tests/wheel-step.test.ts`)
- **The device.** A notched mouse sends a raw `wheelDeltaY` that is a multiple of 120 (one
  notch). A precision touchpad, or a free-spinning wheel, sends small values off that grid. A
  gesture with any value off the grid is **smooth** from then on. A pause of 300 ms ends a
  gesture, and the next one is read again. Anything the rule cannot read (no `wheelDeltaY`,
  lines or pages mode) is smooth: the safe side.
- **The step.** The travel is added up in notches (`wheelDeltaY / 120`, or `deltaY / 100`
  without it). Each whole notch is one 5 % step. A turn the other way starts the count over.
  One step per EVENT was the old pill rule: a touchpad swipe of 50 small events was +250 %.
- **The cap.** A smooth gesture's rise goes through a token bucket that holds one step and
  refills at 40 % a second: the first step comes at once, the next ones at most one every
  125 ms. Travel past the cap is dropped, never banked, so the coast after the finger lifts
  cannot raise it later.
- **The level.** A step starts from the user's own level (`getLevel`, player.ts), not from
  `getVolume`, which includes a duck (the sleep wind-down, a sound clip). Before 2026-10-27 a
  step during a wind-down kept the wound-down level. While muted, wheel up starts at 5 %.

## 3. The wiring (`src/wheel-volume.ts`)
- `wireWheelVolume(el, where, on)`: one stepper for both places, so a gesture that crosses
  from the card to the pill keeps its count and its cap.
- The pill (`main.ts`, the `volume` boot) and the Now Playing card's host
  (`now-playing-card.ts`, unwired on unmount).
- Never ours: a pinch (Ctrl + wheel, which a touchpad sends for a pinch) and a sideways swipe.
- A speaker over AirPlay: `setVolume` sets the speaker's volume, so the cap guards it too.

## 3a. The pill grows on the wheel (his call, 2026-10-27)
- Every wheel event the volume takes calls `onWheelVolume` (wheel-volume.ts). `main.ts` grows
  the small pill on it, through the pill's own `grow`, and shrinks it on the pill's own grace
  (400 ms, `GRACE_MS`) after the last event. A pointer on the pill, a drag or the open "Play
  on" panel still holds it, as before.
- Only when the pill is small (`shrinkMode`: Mini, Midi, a thin window, or Max with *Shrink
  volume bar* on) and no stage volume row (`.np__vol`) is visible. The row shows in Max, in
  Mini's player view and in the full-screen player, so there the pill stays as it is.
- The wheel on the small pill itself grows it too, in click mode as well as hover mode.

## 3b. The pill grows over its neighbors (his call, 2026-10-27)
- Before: the grown pill took more room in the title bar row, so it pushed the window buttons
  (minimize, maximize, close) to the right, and in a narrow window off the screen.
- Now, in its small form (`.vol--shrink`), the pill's slot keeps the small width. The pill sits
  on the slot's right edge (`position: absolute; right: 0`) and grows to the LEFT over the
  title bar buttons beside it (the sleep, Sound, Room and Web buttons, and further in a thin
  window). The window buttons never move.
- `main.ts` `coverNeighbors`: on grow, each title bar button (and the app title) that the grown
  width will cover gets `data-vol-under="on"`, which fades it out on the grow's own time
  (`--vol-grow`) and takes its clicks away. On shrink it goes to `"off"` and fades back. A
  button whose panel is open (`aria-expanded="true"`) stays, and so does every open panel.
- The full bar in Max (*Shrink volume bar* off) keeps its place in the row, as before.

## 4. The log
One `wheel:volume` line in the `diag` ring per gesture (`note: "start"`), and one more if it
turns smooth part way (`note: "smooth"`): `where` (pill / player), `device`, and the raw
`wheelDeltaY`, `deltaY`, `deltaMode`. It is how the notch rule is checked on real hardware.

## 5. Desk test (open)
1. Roll a notched mouse on the Now Playing card: one 5 % step per notch, up is louder. The
   ring shows `device: "notch"` with `wheelDeltaY` ±120.
2. Swipe a touchpad up fast on the card: the volume rises smoothly, no faster than 40 % a
   second, and stops soon after the finger lifts. The ring shows `device: "smooth"`.
3. Swipe the touchpad down fast: it goes down at once.
4. Pinch on the card: the volume does not move.
5. Settings › Playback › *Scroll over the Player for volume* off: the wheel on the card does
   nothing; the title bar pill still steps.
6. Start the sleep timer's wind-down, then roll up one notch: the level goes to the set level
   plus 5 %, not the wound-down level plus 5 %.
7. Muted, roll up one notch: 5 %.
8. Midi: roll on the Now Playing card. The title bar pill grows while the wheel turns and
   shrinks a moment after it stops. Max, and Mini's player view: the pill does not grow (the
   stage volume row is on screen).
9. Mini and Midi, a thin window too: hover (or click) the small pill. It grows to the left over
   the buttons beside it, and those buttons fade out. Minimize, maximize and close do not move.
   Move away: the pill shrinks and the buttons fade back. Open the sleep panel, then hover the
   pill: the sleep button and its panel stay.

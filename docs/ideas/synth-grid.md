---
status: idea
desk_test: none
sources: [src/sound.ts, src/donate-btn.ts, src/dropdown.ts, src/cards.ts, src/motion.ts]
updated: 2026-11-05
---
# Synth grid: a small step synthesizer

**An idea (2026-11-05), from the owner.** A minigame inside DeetsMusic: the user fills a grid,
the grid plays as a loop, and the user locks the loop in and layers another one on top.
Nothing is built. **§1 is what he said and is fixed. The rest is Claude's proposal.** The forks
in §6 are his.

**The terms.**
- *The grid:* 6 rows by 12 columns of cells. A cell is on or off.
- *A step:* one column. The loop plays the steps from left to right, then starts again.
- *The playhead:* the mark that shows the step that plays now.
- *A layer:* a grid that is locked in. It keeps playing, and the user cannot change its cells
  until they open it again.
- *The draft:* the grid that the user edits now.

## 1. What he said (2026-11-05)

- A synthesizer widget, as a minigame.
- A grid of 6 by 12. The 6 is the scale. The 12 is 3 sets of 4.
- Two instruments for now: a drum and a basic piano.
- It loops.
- The user can lock in a loop to keep layering.
- It is a Max only widget: a title bar panel, the first of its kind, like a widget game.

## 2. The picture (proposal)

```
 Piano | Drum        Tempo 100        Play   Lock in   Clear
        set 1       set 2       set 3
 high  . . . .  |  . # . .  |  . . . .
       . . # .  |  . . . .  |  # . . .
       # . . .  |  . . # .  |  . . . #
       . . . #  |  . . . .  |  . # . .
       . # . .  |  # . . .  |  . . # .
 low   # . . .  |  . . . #  |  # . . .

 Layers:  Piano 1   Drum 1   Piano 2
```

- **The three sets are separate to the eye.** A wider gap sits between column 4 and 5, and
  between column 8 and 9, so the user can count 1-2-3-4 three times.
- **A cell plays its note once when the user turns it on,** so the user hears what they picked
  without the loop running.
- **A column can hold more than one cell.** Two cells in a step are a chord, or a kick and a
  hat together.
- **The loop keeps running while the user edits.** A cell that changes is heard the next time
  the playhead reaches it.

## 3. The rows (proposal)

**Piano.** Six notes of one scale, low at the bottom. The first proposal is the major
pentatonic plus the top note: C D E G A C. A pentatonic scale has no two notes that clash, so
any pattern a new user draws sounds good. That matters in a minigame.

**Drum.** A drum has no scale, so *the 6 is the scale* cannot be read literally for this
instrument. The proposal: the six rows are six drum sounds, from low to high: kick, low tom,
snare, clap, closed hat, open hat.

## 4. Lock in (proposal)

1. The user draws a draft and presses **Lock in**.
2. The draft becomes a layer. It keeps playing with no gap.
3. The grid is empty again, and the user draws the next draft over the layers.
4. A layer has one instrument. So the user can lock a piano line, a second piano line and a
   drum line, and all three play.
5. Each layer gets a chip under the grid. The chip mutes the layer. A right-click on the chip
   has *Open in the grid* and *Delete*.
6. The cells of the layers show faintly behind the draft, so the user can see what is already
   there.

## 5. What the code says (read 2026-11-05)

- **Nothing like this exists.** No oscillator and no sequencer are in `src/`. The only sound
  the app makes on its own is a clip (next point).
- **The clip path is the place to join, but not the function.** `playClip` in `src/sound.ts`
  puts a clip into the tap, after the bus. So AirPlay hears it, and the EQ, a rule's tone and the
  meter do not touch it. The synth belongs at the same point. But `playClip` plays one clip at
  a time and drops the next, so a sequencer cannot use it. `sound.ts` must export a new input
  there (one gain node into `tap`). `sound.ts` keeps its rule of one `AudioContext`.
- **The loop must run on the audio clock.** The steps are scheduled a little ahead on
  `ctx.currentTime`, never fired from a timer. The playhead reads the same clock.
- **The context favors playback, not speed.** It is made with `latencyHint: "playback"`
  (bigger buffers). That does no harm to a scheduled loop. But the note that a cell plays on a
  press arrives later than on a low-latency context. Not measured yet. Measure it before a
  build. A press that lags would feel bad in a game.
- **AirPlay adds its own delay.** While a HomePod plays, the sound will trail the playhead.
  Not measured yet.
- **The sounds can be made in code.** Oscillators and filtered noise need no sample files, no
  download, no new outside host and no CSP change. A drum made this way sounds good. A piano made
  this way sounds like a simple electric piano (§6, fork 4).
- **A hidden window is a risk.** The scheduler needs a short timer to queue the next steps.
  Chromium slows timers on a hidden page, so a minimized app may stutter. Test it, or stop the
  loop when the window hides.
- **The panel shape exists.** The precedent is the Donate button (`src/donate-btn.ts`): a Max
  only title bar button, a `makeDropdown` panel, `keepRightInWindow`, `enterRows`. Three things
  differ for a game:
  - The family width (`--quick-panel-w`) is too narrow for 12 columns. The grid needs its own
    width token.
  - *Open menus on hover* would close the panel when the pointer leaves it. The panel needs
    `fixedMode: "click"`, as the Library ⟳ has.
  - A click away closes a panel. `shouldStayOpen` can stop that, if §6 fork 1 wants it.
- **No Apple calls and no Rust.** The grid costs no API call. A saved pattern is a small JSON
  value.
- **The app volume does not reach the clip path.** The volume slider acts on `music.volume`,
  before the graph, and a clip joins after the bus. So the synth needs its own gain that follows
  the slider, and the speaker volume on AirPlay.
- **No limiter sits after the join.** The limiter is in the bus, before the tap. A song and
  several layers can add up past full scale, so the synth needs its own limit before it joins.
- **At build time, walk the list in CLAUDE.md.** The playhead asks `motionReduced()`
  (`src/motion.ts`). The grid gets arrow keys (`wireListKeys` may not fit a 2D grid; check it
  first). A panel has no `snapshot()`, so the grid's state lives in its own module and survives
  a close. The playhead moves, so DESK-TESTS.md §6.6 applies.

## 5a. How heavy it is (estimate, 2026-11-05)

These are estimates from the size of similar files. Nothing is measured, because nothing is
built.

| Part | Lines | Compare |
|---|---|---|
| The panel: grid, chips, keys, state | 400–600 | `rewind-btn.ts` 577 |
| The pure loop rules: steps, layers, lock in | 100–150 | `wheel-step.ts` 96 |
| The sounds and the scheduler | 150–250 | `metal.ts` 420 |
| The sheet | 100–150 | `donate.css` 95 |
| The new input in `sound.ts` | 15–25 | |
| **Total** | **about 800–1,200** | `rulez-card.ts` alone is 1,187 |

- **The bundle.** About 30 KB on `main` (1.34 MB today), so about 2 %. Every card is imported at
  launch in `src/cards.ts`, and no card loads late today. A dynamic `import()` would keep the
  grid out of launch, as `copy-edit` does in dev.
- **While closed.** It costs nothing at run time: no timer, no audio node, no listener.
- **While it plays.** A note is a few short-lived audio nodes, and the loop wakes a short timer.
  The playhead changes one column per step. Expect a small cost. Measure the playhead on Glass
  on `npm run dev:built` before a build is called light.

## 5b. How hard it is (2026-11-05)

Medium overall. A sequencer is a solved problem. The risk is in how it feels and how it fits
the app's sound chain, not in the loop.

| Part | Difficulty | Why |
|---|---|---|
| The grid, the chips, the loop rules | Easy | Plain UI and pure logic, with unit tests |
| The drum sounds | Easy | Oscillators and filtered noise, well known recipes |
| The scheduler, the playhead | Medium | A known pattern, but it must hold in a hidden window and through a tempo change |
| Lock in with no gap | Easy | Every layer reads one clock, so a lock only moves data |
| The volume and the limit | Medium | §5: the join point has neither |
| The piano sound | Medium to hard | Code runs in minutes. Tuning it by ear takes the time |
| The press delay | Unknown | If the `playback` context lags, the fix is a choice, because one context is a rule of `sound.ts` |

## 6. Open forks (his)

Recommendation first in each. None is decided.

1. **When the panel closes.**
   - The loop keeps playing, and the title bar button shows that it runs. The user can pick a
     song and come back. Stop is in the panel.
   - The loop stops when the panel closes. It is simple, but a click away ends the music.
2. **A song that plays when the grid starts.**
   - The song keeps playing, and the user pauses it if they want. The app never takes the
     user's music from them. But the loop and the song do not share a tempo.
   - The song ducks while the loop plays. The clip duck exists for this.
   - The song pauses when the loop starts.
3. **What 3 sets of 4 means in time.**
   - One step is an eighth note, so the loop is 3 s at 120 BPM. It feels quick and repeats
     often, which suits layering.
   - One step is a quarter note, so the loop is 6 s at 120 BPM. It feels slow, with more room
     for a melody.
   - Note: 3 sets of 4 is a three-bar loop. Most songs run in sets of 2 or 4 bars, so the
     loop has a slight turn-around feel. It is his number, and it is fixed (§1). This line is
     only so he hears it before the build.
4. **The piano sound.**
   - Made in code at first. No files, and it matches *a basic piano*. It can change later.
   - A small set of recorded notes. It sounds like a real piano, but it needs a free license
     and adds to the install size.
5. **Is it a game, or a toy?** He said *minigame*.
   - Free play only, at first. The grid is the fun.
   - A goal as well: for example, copy a short pattern by ear. This is new design, and his
     to draw.
6. **Does a pattern last?**
   - The last grid and its layers come back when the panel opens, and nothing more.
   - Named saves, and a share code a friend can paste in.
7. **The controls.** The tempo range, the key, and a limit on layers. For later: these wait
   for forks 1 to 3.

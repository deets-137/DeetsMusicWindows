---
status: sop
desk_test: none
sources: [docs/ops/DESK-TESTS.md, docs/ops/checks/README.md, scripts/shots.mjs]
updated: 2026-10-18
---
# Quality sweep — stress-test every shipped feature, one at a time

His ask (2026-10-18): take the method that tested the song facts box (DESK-TESTS.md §6.5: Sonnet
agents list how a user might break a feature, Claude checks each case against the code, scripts
the real ones and runs them) and apply it to **every feature already shipped**, feature by
feature, so each one is stress-tested the way a new feature is now. Not a one-time audit: a
ledger that says, per feature, when it was swept and what guards it.

Terms:
- **A sweep** is one pass over one feature: the agents' scenarios, the triage, the shots, the
  faults.
- **A scenario** is one way a user might reach a wrong state: steps, what should happen, what
  the code suggests happens.
- **A guard** is a shot with an `expect` kept in `docs/ops/checks/` that fails by itself when the
  scenario breaks again. A guard is written for a scenario that passes today too.
- **The agents** are Sonnet (`model: "sonnet"`), light, one feature and one lens each. They
  read; they do not run.
- **The main session** (Opus or Fable) owns the judgment: which scenarios are worth a script,
  the script, the run, and the reading of the results.

## 1. His calls (2026-10-18)

| | Call | Why |
|---|---|---|
| C1 | Sonnet agents, not Haiku; light and focused on workflows | Haiku gives generic lists ("the network drops"); the first run's value came from agents that read state |
| C2 | The main session decides which scenarios to test, scripts them, and reads the results | an agent reads, it does not run, and half of what it reports is handled in behavior it cannot see |
| C3 | Feature by feature, not seams only | the goal is every shipped feature tested to the standard new features meet since 2026-10-17 |
| C4 | A found fault lands in HANDOFF.md › Open now, ranked likelihood × impact. Fixes go one at a time, each with its desk test | a sweep that fixes 20 things in 10 files is the untested stack of 2026-09-17 by another door |
| C5 | Cadence: a baseline over the ledger now; then a sweep after each shipped feature; the whole guard set re-run before a release | the guard set is the payoff: a regression suite the release check can run |
| C6 | The doc lives in `ops/`, beside DESK-TESTS.md | it is a procedure in use, not an idea |

## 2. What a sweep is not

- **Not a code review.** The agents are not asked to find bugs in the source. They are asked
  what a user does, in order, and what they would see. The code is the main session's to read.
- **Not a fix session.** A sweep ends with a ledger row, shots and a ranked list. A fix is its own
  piece of work with its own desk test (C4). The one exception is a fault that blocks the guard
  from running at all.
- **Not a seam list.** The seams (two cards on one store, the queue during a surface switch, a
  rule firing on a hidden card) are the third lens (§4), inside each feature's sweep, not a
  separate pass.

## 3. One sweep, step by step

1. **Pick the feature** from the ledger (§7), oldest unswept first unless he names one. Read its
   doc's as-built section and desk test, and its `sources`.
2. **Start the agents**: one per lens (§4), in one message, each with the same brief (§5) and its
   lens. Give each the feature doc and the files in `sources`. Nothing else: a focused agent
   writes a focused list.
3. **Triage** each scenario against the code yourself. Every scenario ends in one of five bins:

   | bin | meaning | what happens |
   |---|---|---|
   | fault | the code does what the agent fears | a HANDOFF line (C4) and a guard that fails today |
   | guard | the code handles it, and it is worth keeping true | a guard that passes today |
   | fork | the right behavior is a choice he has not made | a short option list to him |
   | older | a real fault in another feature or a shared primitive | noted in that feature's ledger row, not fixed here |
   | drop | not reachable, or not worth its script | one line in the sweep record, so it is not asked again |

4. **Script the guards** as one shots list per feature, `checks/<feature>-sweep.json`, built in
   `shots/scratch/` first ([checks/README.md](checks/README.md), "How to add one"). The demo for layout, motion and keyboard; the
   dev app (`"source": "dev"`) for data, cache and log lines. Every probe has an `expect`.
   The method and the safety rules are DESK-TESTS.md §6.1 and §6.2.
5. **Run it**, read the strips and the probes, `--seen` each picture, read the `diag` ring and
   the log after a dev-app run.
6. **Record**: the ledger row (§7), a `### Sweep` part in the feature doc with the scenario table
   (LISTENERS.md §8.11 is the shape), one line in WORKLOG.md, and the ranked faults in HANDOFF.
7. **Restore** every setting the run changed.

## 4. The lenses

Each agent gets one. Two were used on the first run; the third is new for the sweep.

| lens | the question | typical finds |
|---|---|---|
| **Workflow and keyboard** | What does a user click, type and press, in what order, on each surface? Where does focus sit? What if they do it twice, fast, or backwards? | a row turned on with its view open; Esc from the wrong place; a second click before the first lands |
| **Data and timing** | What can the data be (full, partial, none, huge, a failure, stale)? What arrives late, out of order, or after the view is gone? What is cached, for how long? | an answer that lands after a redraw; a cache that hides a failure; an off switch that still calls |
| **Neighbors and load** | Which other features share this one's store, keys, cards or events? What happens when both move at once? What happens at his library's size, on Mini, over a slow network, over an hour? | two cards on one key; a rule that fires on a hidden card; a list that re-renders per song |

A fourth agent is not added to be thorough. If a feature needs one, its lens is written here first.

## 5. The brief to give an agent

> You are a solutions engineer testing a developer's build of one feature in a Windows desktop
> music player. Not a code review and not a security review: list how a real user, following
> their own workflow, could reach a wrong state. Read the feature doc and the files named below.
> Your lens is **{lens}** (§4). Give up to 15 scenarios. For each: the steps a user takes, in
> order, with the control named; what should happen; what the code suggests happens, with the
> file and function; likelihood (1–3) and impact (1–3); and whether it can be scripted over CDP
> (a DOM probe, an `invoke` delay or failure, a settings change). Skip anything the doc's desk
> test already covers. Do not propose fixes.

Keep the agent light: one feature doc, its sources, this brief. It does not get the whole
`docs/` tree or CLAUDE.md.

## 6. Reading what comes back

- **Likelihood × impact ranks the triage order**, not the fix order. A 9 that the code already
  handles is a guard; a 2 that the code fails is still a fault.
- **"The code suggests"** is the part to check. The first run's agents were right about the
  user's steps and wrong about the outcome about four times in five (39 scenarios, 7 faults,
  LISTENERS.md §8.11). Expect that ratio.
- **A scenario the agent cannot place in the code** is still read: it may name a path no doc
  covers.
- **Two agents naming the same scenario** is one scenario. It is not more likely for being
  named twice.

## 7. The ledger

One row per feature doc with `status: shipped` or `built`. `scenarios` / `faults` / `guards`
are counts; `swept` is the date of the last sweep. A shared primitive change (the collection
engine, the settings store, the rules engine, the queue) re-opens the rows of the features on
it: mark them `re-sweep` and clear them in the next baseline.

| feature | swept | scenarios | faults | guards | notes |
|---|---|---|---|---|---|
| LISTENERS (the song facts box) | 2026-10-17 | 39 | 7 | song-box-edges.json | the first run; lenses 1 and 2 only |
| album-notes | | | | | |
| filter-rules | | | | | shared with RULEZ: the condition menus |
| UpdatesButton | | | | | |
| PresentationMode | | | | | |
| fullscreen-player | | | | | |
| MAX-CARDS | | | | | geometry pure in layout-rules.ts |
| HIDE-CARDS | | | | | |
| GRAPHICS-FALLBACK | | | | | a WARP fall-back is hard to script; the rule and toast are not |
| USAGE-COUNTS | | | | | the privacy rules are the impact axis |
| COPY-EDIT | | | | | dev-only |
| SEARCH-FIELDS | | | | | six call sites |
| RULEZ | | | | | with architecture/RULES.md |
| QUICK-SETTINGS | | | | | |
| SUGGEST-LESS | | | | | |
| WebRooms | | | | | desk test still open; sweep after it |
| WEB-DEMO | | | | | |
| PLAYLISTS · PLAYLIST-WEB · PLAYLIST-REFRESH | | | | | one store, one sweep |
| HOME | | | | | |
| QUEUE | | | | | foundation; architecture/QUEUE.md first |
| SEARCH | | | | | |
| STATIONS | | | | | |
| FAVORITES | | | | | |
| PINS | | | | | |
| ARTIST-VIEW · FULL-LIB | | | | | one view |
| CREDITS | | | | | |
| SOUND · AUDIO-QUALITY | | | | | one Web Audio graph |
| VINYL | | | | | the spin has its own telemetry (VINYL.md §8) |
| DEETS-REWIND | | | | | |
| DIARY | | | | | |
| LOOK-SCHEDULE | | | | | |
| COMPASS | | | | | |
| TRAY | | | | | OS window: the dev app, not the demo |
| ALBUM-COLOR · COVER-WALLPAPER · OCEAN | | | | | one sweep on the Glass canvas; frames ÷ ms is the measure |
| MOVABLE-ROWS | | | | | |
| ONBOARDING | | | | | |
| integrations: LASTFM · AIRPLAY · ROOMS · FRIENDS · DeetsOTD · EXTENSION · AGENT | | | | | one row each when reached; the workers need the second app |

Order of the baseline: the features built since 2026-10-10 first (they are freshest in the
code and the docs), then the rest oldest-doc first. He can name one to jump the line.

## 8. Cost

Per feature: three Sonnet agents reading one doc and a few files, then the main session's
triage and one shots list. On the first run two agents and the triage took one sitting with
the fixes included; without the fixes, a sweep is a part of a sitting. The ledger has about 40
rows, so the baseline is a run of sittings, not one. That is the reason for C5: the baseline is
started, not finished, and the per-feature sweeps keep it current from then on.

## 9. Open forks

- **F1 Re-run before a release.** Every guard in `checks/*-sweep.json`, as one release-check
  step (RELEASE.md §0b), or by hand from the ledger. My recommendation: the check, once three
  features have guards, so the step is tested on a small set first.
- **F2 The guard's source.** A guard that needs his real library runs on the dev app only, so
  the release check cannot run it unattended. Keep two lists per feature (demo and dev), or mark
  dev-only guards and skip them in the check. My recommendation: mark and skip; the dev-only
  ones run in the sweep itself.

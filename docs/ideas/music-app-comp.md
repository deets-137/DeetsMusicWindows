---
status: idea
desk_test: none
sources: [tools/deetsmeter/src/main.rs, tools/deetsmeter/src/screen.rs, tools/deetsmeter/src/run.rs, tools/deetsmeter/src/calibrate.rs, scripts/bench.mjs, scripts/heaviness-sample.ps1, scripts/boot-log.mjs, scripts/perf-report.mjs, scripts/archive-installer.mjs, scripts/webview-profile.mjs, scripts/shots.mjs, src/perf.ts, src/frames.ts, src/launch-perf.ts, src/telemetry-on.ts]
updated: 2026-10-10
---
# DeetsMusic against the Apple Music app for Windows — metrics and methods

> **An idea, opened 2026-10-06. Since 2026-10-10 the sensor (M1, §17.9) is built; no comparison has been run.** The owner asked for a theory:
> which numbers say one music player is lighter or quicker than another, and how to take
> each number so the same method hits both apps. Every fork in §9 is his. Numbers quoted
> from our own telemetry are the ones already in [DEBUGGING.md](../ops/DEBUGGING.md); none
> was taken against Apple's app.
>
> **2026-10-10: the second half.** §11–§16 use the same outside-in method to measure our OWN
> upgrades: each release against the last one, starting at 0.25.4 (his call: no old
> versions), with Apple's app run in the same sitting as the control. One driver, two uses.
> Open forks: F1–F7, F9, F11, F12 in §9.
>
> **2026-10-10, later: our own measuring tool.** His call: no PresentMon. §17 scopes the build
> of `deetsmeter` (input, screen and sound on one clock). Its forks F13–F16 are decided.

**Terms.** *Apple's app* is the Apple Music app for Windows from the Microsoft Store
(`AppleMusic.exe`, Apple's own player, not a web view). *Ours* is the installed DeetsMusic
release (`deetsmusic.exe` + its WebView2 process tree). A *scene* is one scripted thing a
person does (start the app, press play, scroll the library). A *symmetric* method takes the
same number from both apps with the same tool, from outside the app. An *asymmetric* method
reads our own `[perf]` lines; Apple's app has no equivalent we can read, so it explains a gap
and never scores one.

---

## 1. The rule of the contest

1. **Symmetric or it is not a score.** Our telemetry (`[perf] click→sound`, `[perf] frames`,
   `[perf] launch`) is dev-only and lives in the log file. Apple's app gives us nothing like
   it. So every number in the results table (§8) comes from Windows itself: the process list,
   the composed screen (Desktop Duplication, §17), the audio device, the network stack, the
   file system. Our
   `[perf]` lines are allowed in a footnote that says *why* a number is what it is.
2. **Release against release.** Ours is the installed release, never `npm run tauri dev`:
   DevTools renders in the same GPU process and vite serves unbundled JS
   (DEBUGGING.md §Graphics work has its own rules). If a stage split is wanted, it comes from
   a second installed build made with `VITE_PERF=1` (boot-log.mjs explains the gate), run
   after the scored passes, never during.
3. **Same PC, same hour, same song.** Both apps signed in to the same Apple account, same
   library, same network, same display (244 Hz here; also a 60 Hz run, §7), nothing else
   open. One app runs at a time; the other is fully quit, tray included (ours keeps a tray
   process; Apple's app has a background task for media keys).
4. **Medians of ≥ 3 passes, and the spread beside every median.** `bench.mjs` already refuses
   a noisy machine; the same gate applies here. A row whose spread is over 8% is marked
   NOISY and is not quoted.
5. **Cold and warm are two rows, never averaged.** Cold = after a reboot, or after the standby
   list is emptied (RAMMap › Empty Standby List) and the disk cache with it. Warm = second
   start within a minute.
6. **Report what the other app does that ours cannot.** Lossless, Dolby Atmos, local files,
   library sync. A comparison that leaves those out is marketing, not measurement (§6).

---

## 2. The metrics

Grouped by what a person feels. Each has one symmetric method (§3) and, where we have one,
an asymmetric explainer.

### 2.1 Weight at rest (the app is open and doing nothing)
| metric | unit | why it matters |
|---|---|---|
| Private working set, summed over the process tree | MB | What Task Manager shows people; the number that gets screenshotted. Ours is ~333 MB on 2026-09-27 (renderer 182, GPU 71, CDM 32, WebView2 23, host 15; DEBUGGING.md §Which memory number to quote). |
| Commit charge, summed | MB | What the OS has promised; the honest number on a RAM-poor laptop. |
| Process count | count | WebView2 brings a browser, a renderer, a GPU process, a Widevine CDM, utility processes. Apple's app is fewer. A reader sees this in Task Manager before any MB. |
| Idle CPU, 5-minute mean | % of one core | Timers, animations, polls. For ours this is the Animate-backgrounds and skin question (Glass frost ~36–65% of the GPU process on scroll; Ocean swell 42% GPU idle under WARP). Take it twice: default settings, and Animate backgrounds Off. |
| Idle GPU engine use | % | The compositor and any live backdrop. Apple's app is XAML composition; ours is Chromium. |
| Idle network, 5 minutes | KB, request count where visible | A player at rest should be quiet. Per-process bytes are visible; request counts hide under TLS and are only visible on our side (the Apple call counter, APPLE-CALLS.md). |
| Idle disk writes, 5 minutes | KB | Log rotation, cache, SQLite checkpoints. |

### 2.2 Weight while playing (one album, screen on, no input)
Same seven numbers, taken while a song plays. Add:
| metric | unit | why |
|---|---|---|
| Streaming bytes per song | MB | Both pull Apple's AAC; ours through MusicKit JS. A gap here is a bitrate gap (§6), not an efficiency gap. |
| Audio-process CPU | % | The decode + output path: for us the Widevine CDM plus the renderer's Web Audio graph (the EQ, SOUND.md); for Apple, in-process. |
| Memory drift over 1 hour | MB/h | A leak is a slope. `heaviness-sample.ps1 -Loop` already takes this for both installed apps on this PC, with the per-process split. |

### 2.3 Quickness (how long a person waits)
| metric | unit | where the clock starts and stops |
|---|---|---|
| Start to window | ms | Process create → the main window is shown (a WinEvent `EVENT_OBJECT_SHOW` on a top-level window of that PID). |
| Start to first content | ms | Process create → the first screen frame where the profile's *content probe* (a small area where the first real row draws) is no longer blank or splash (§17.3). Ours has a launch cover (launch-perf.ts); Apple's has a splash. Both count as "not content". |
| Start to first sound (resume on launch) | ms | Only if both apps are set to resume. Ours resumes the queue; Apple's app does not auto-play on launch, so this row may be ours alone (§9, F3). |
| Click → sound | ms | A scripted click on a play button → the first non-silent sample on the audio device. Ours logs `[perf] click→sound` with the stage split as the explainer; the scored number is the loopback one for both. Our own split says ~10 ms is us, the rest MusicKit (click-to-sound memory, 2026-09-12). |
| Next → sound | ms | Same, from a Next press mid-song. Pre-fetch shows here. |
| Search → results | ms | Last keystroke of "radiohead" → the first result row painted (screen diff). Network-bound for both; take 5 passes with the same query so Apple's CDN cache is equally warm. |
| Album open | ms | Click on an album → its track list painted. |
| Seek → sound | ms | Scrub to 50% → first new sample. Ours was reworked on 0.25.4 (the mid-song stall reload). |

### 2.4 Smoothness (frames)
| metric | unit | scene |
|---|---|---|
| Frames delivered ÷ ms, dropped % | fps, % | Library scroll, a scripted drag of 120 steps (the `bench scroll` scene). Judge frames ÷ ms, never the main-thread trace (DEBUGGING.md: `will-change` cut recalc 766→260 ms while fps fell 229→50). |
| 99th-percentile frame time | ms | The hitch a person sees once per scroll. |
| Appearance switch | fps during the switch, total ms | Ours: a theme or skin switch (`bench appearance`). Apple's: Light ↔ Dark in Settings. Not equal in scope (our skin changes geometry; theirs changes color), so it is reported, not scored (§9, F4). |
| Window resize | fps | Drag the corner for 2 s. Ours re-lays the bento (Max); theirs re-lays XAML. |
| Mini player open | ms, fps | Both have one. Ours: the Mini surface; theirs: the MiniPlayer window. |

### 2.5 Footprint on disk
| metric | unit |
|---|---|
| Install size | MB (ours in Program Files or the per-user folder; theirs under `WindowsApps`, read with an elevated listing) |
| Data folder after first sign-in | MB |
| Data folder growth after 1 week of ordinary use | MB (ours: the SQLite cache + art + log; theirs: its cache folder) |
| Cover art cache per 100 albums browsed | MB |

### 2.6 Energy (laptop only)
| metric | method |
|---|---|
| Energy per hour of playback | `powercfg /srumutil` gives per-app estimated energy from SRUM on a battery device. Not meaningful on this desktop. A wall meter on the PC is the honest alternative and measures the whole machine, so it needs a baseline row with no player open. |

### 2.7 Steps (not performance, but asked about in the same breath)
Count the clicks and keystrokes from app-open to: play an album, add a song to a playlist,
find a song by an artist, open the equalizer, start a station. Count the same for both. This
is the "user-empowering" axis and it costs nothing to take. It belongs in a separate table so
it never gets mixed into a ms column.

---

## 3. The methods (symmetric; one tool per metric)

| what | tool | notes |
|---|---|---|
| Memory, process count, CPU per process | `Get-Process` + `Get-Counter '\Process(*)\Working Set - Private'` / PDH, or `heaviness-sample.ps1` extended to Apple's tree | The sampler already roots at an exe and sums its children; Apple's tree is `AppleMusic.exe` + its `RuntimeBroker` share. Sample every 5 s for 5 min, report mean and max. |
| GPU engine use, GPU memory per process | PDH `\GPU Engine(pid_*)\Utilization Percentage`, `\GPU Process Memory(pid_*)\Dedicated Usage` | Task Manager's own counters. Sum the engines of each PID in the tree. |
| Frames, frame times, dropped | **`deetsmeter`, our own tool (§17)**: Desktop Duplication of the window's area | Measures the screen after DWM has composed it: what a person sees, the same way for a Chromium app and a XAML app. Our `[perf] frames` line is the explainer. |
| Timings (start, click → paint) | `deetsmeter`: the injected input and the screen frames on ONE clock (QPC) | The tool sends the input itself with `SendInput` and reads the screen in the same process, so no clock sync is needed. Resolution ≈ one display refresh (4.1 ms at 244 Hz). |

**Why not PresentMon** (decided 2026-10-10, his call: our own tool). PresentMon (Intel, open
source) reads each app's presents from ETW. Two problems for this contest: our frames present
from `msedgewebview2.exe`, not `deetsmusic.exe`; and a XAML app such as Apple's runs much of
its motion inside DWM, so PresentMon may see few presents from `AppleMusic.exe` while the
screen moves smoothly. The composed screen is the one place both apps reach the same way.
| Click → sound, Next → sound, Seek → sound | `deetsmeter`: WASAPI loopback, started before the click; first sample above −60 dBFS | Same process, same clock as the click. Set both apps to the same output device, same volume, EQ flat, crossfade off, no AirPlay. |
| Network bytes per process | ETW `Microsoft-Windows-TCPIP` via `wpr`, or Resource Monitor › Network for a hand run | Bytes only. Request counts are not visible under TLS for Apple's app. Do not install a TLS-intercepting proxy: it changes both apps' behavior and Apple's app may refuse the certificate. |
| Disk I/O per process | `Get-Counter '\Process(*)\IO Write Bytes/sec'` | |
| Install and data size | `Get-ChildItem -Recurse | Measure-Object Length -Sum` | `WindowsApps` needs an elevated shell. |
| Scripted gestures | `deetsmeter`'s `SendInput`, with fixed coordinates per app at a fixed window size and position (the tool places the window) | UI Automation names would be cleaner, but coordinates are the common denominator. Each run's coordinates go in its results file. |
| Steady machine | `bench.mjs`'s noise gate idea: refuse a pass if idle CPU > 5% before it | Wait 60 s after launch before any scene. |

**One driver script, two profiles.** The fair way to run this is one script
(`scripts/compare/run.mjs`, over `deetsmeter`; §17, not built) with a profile per app: exe path, window
title, the coordinates of Play / Next / Search / the library scroller, and the Store-app
launch command (`explorer.exe shell:AppsFolder\AppleInc.AppleMusicWin_nzyj5cx40ttqa!App`;
the package family read from `Get-AppxPackage *AppleMusic*` on this PC, 2026-10-10, version
1.1540.23042.0 — the Store updates it, so every results row records the version). The script
launches, waits, runs the scenes in a fixed order, samples, and writes one CSV row per pass.
A `checks/` entry (ops/checks/README.md) keeps it re-runnable.

---

## 4. The scenes, in order

Each pass runs these in order on one app, then the same on the other, then swaps order on the
next pass (so neither app always goes second with a warmer disk cache).

1. **Cold start** → window → first content. Quit.
2. **Warm start** → window → first content.
3. **Rest, 5 min** (the Home or Listen Now view, nothing playing): memory, CPU, GPU, network,
   disk.
4. **Play an album** (the same one; a pinned Pin for us, a Library favorite for them) →
   click → sound. Then **Next** ×3 → sound each time. Then **Seek** to 50% → sound.
5. **Playing, 5 min**: the §2.2 set.
6. **Library scroll**: the drag script over the Songs list. `deetsmeter` frames.
7. **Search**: type a fixed query → results painted. ×5.
8. **Album open** ×5 from search results.
9. **Appearance**: ours, theme switch; theirs, Light ↔ Dark.
10. **Mini player** open and close.
11. **Resize** 2 s.
12. **Memory after the pass**: the drift row.
13. **Quit** and record the quit-to-process-gone time (ours has the tray; a quit via the tray's
    Quit).

A full pass is about 20 minutes per app. Three passes each is two hours of a quiet PC.

---

## 5. What we already have, and what is missing

| have | missing |
|---|---|
| `heaviness-sample.ps1` samples both *installed and dev* DeetsMusic trees with the per-process split. | It skips every other exe. A `-Also AppleMusic` switch, or a profile list, makes it symmetric. |
| `bench.mjs` drives our scroll and appearance scenes with a noise gate, but through CDP. | CDP does not exist for Apple's app. The driver must be input injection for both: `deetsmeter` (§17). |
| `boot-log.mjs` trends our start-up from the log. | Apple's start-up needs the launch + window + screen path: `deetsmeter` (§17). |
| `[perf] click→sound` with the stage split. | The loopback capture, for both: `deetsmeter` (§17). |
| WASAPI loopback code in the shared AirPlay crate (`DeetsAirplay/crates/airplay/src/capture.rs`), with the process-loopback form. | Nothing new to learn: `deetsmeter` copies the pattern (§17.2). |
| `shots.mjs` for pictures of ours. | A capture of the real OS windows (not the web demo) for both: `deetsmeter`'s kept frames (§17.2). |
| ffmpeg 9.0.2 is on PATH (WinGet, checked 2026-10-10), with `ddagrab` (Desktop Duplication). | Only a fallback (§17.6); the tool does not need it. |
| `perf-history.csv` (195 bench rows, keyed by commit and skin) and `boot-history.csv` (38 start-ups) trend the DEV app. `perf-report.mjs` prints p50 / p95 / worst per `[perf]` name. | All three read dev telemetry. Nothing trends the INSTALLED release from outside. §11–§16. |
| `installers/` keeps 41 shipped setup exes, 0.1.1 to 0.25.4 (`archive-installer.mjs`). | Not used: no old versions (his call, 2026-10-10). The history starts at 0.25.4 (§13). |

---

## 6. Known asymmetries (print these beside the table)

- **Audio tier.** Apple's app plays Lossless and Hi-Res Lossless (ALAC, up to 24/192) and
  Dolby Atmos when the account and device allow. MusicKit JS gives us AAC 256. A "bytes per
  song" or "audio CPU" row favors us for the wrong reason. Set Apple's app to *High Quality*
  (AAC 256) for the scored rows, and report the lossless rows separately as a thing we do not
  have (AUDIO-QUALITY.md).
- **Local files and library sync.** Apple's app indexes local music and syncs devices. Its
  rest-state disk and CPU include that unless the local library folder is empty. Make it
  empty.
- **The web view.** Ours carries a Chromium process tree; the process-count and memory rows
  will never favor us. Say so, and say what the tree buys (one code base, the skins, the
  Rulez card).
- **Skins.** Glass and Ocean are GPU work by design (DEBUGGING.md §Graphics-cost baseline).
  Score on the default skin, and give a second column for the lightest (Press or Cyber hold
  ≥ 209 fps under WARP) so a reader can see the range.
- **Media keys and SMTC.** Both register with the System Media Transport Controls; Apple's
  app also keeps a background task. Quit means quit for both, tray included.
- **Store packaging.** Apple's app is an MSIX; some of its working set is shared framework
  pages (WinUI, .NET-free Swift runtime). Private WS, not shared, is the fair number.

---

## 7. Where to run it

1. **This PC** (RX 6700 XT, 244 Hz): the best case. Every number is the floor.
2. **This PC at 60 Hz** (change the display mode): the common case, and the frame budget that
   most readers have.
3. **`--gpu=off` is ours only** (a WebView2 flag). Apple's app has no equivalent switch, so
   the WARP rows do not go in the comparison. A real laptop with an integrated GPU is the
   honest weak-machine run, if one is at hand.

---

## 8. The results table (empty; the shape)

| metric | scene | unit | DeetsMusic (median · spread) | Apple Music (median · spread) | passes | notes |
|---|---|---|---|---|---|---|
| private WS | rest | MB | | | | |
| commit | rest | MB | | | | |
| processes | rest | n | | | | |
| CPU | rest 5 min | % core | | | | Animate backgrounds On / Off |
| GPU | rest 5 min | % | | | | |
| network | rest 5 min | KB | | | | |
| cold start → content | start | ms | | | | |
| warm start → content | start | ms | | | | |
| click → sound | play | ms | | | | ours: `[perf]` split in a footnote |
| next → sound | play | ms | | | | |
| seek → sound | play | ms | | | | |
| search → results | search | ms | | | | |
| album open | open | ms | | | | |
| scroll fps · dropped | library | fps · % | | | | `deetsmeter` |
| scroll p99 frame | library | ms | | | | |
| appearance switch | theme | ms · fps | | | | reported, not scored (F4) |
| memory drift | 1 h playing | MB/h | | | | |
| install size | disk | MB | | | | |
| data after 1 week | disk | MB | | | | |
| steps to play an album | steps | clicks | | | | §2.7, separate table in the write-up |

One CSV per run under `scripts/compare/results/` (gitignored like heaviness-samples.log) with
the PC, display Hz, both versions, the date and the pass order; the medians copied into this
doc's §8 by hand, with the date.

---

## 9. The forks (his)

- **F1 — Which metrics score.** Recommend: the §2.1 rest set, the §2.3 timings and the scroll
  row of §2.4 score; disk, energy and appearance are reported only. Alternative: everything
  scores, with the asymmetries as footnotes.
- **F2 — Build the driver, or run it by hand once.** Recommend: a hand run first (one pass,
  Task Manager + a phone stopwatch on the loopback waveform; frames wait for `deetsmeter`) to learn which rows
  are close enough to deserve a script. Alternative: the script first, so pass 1 is already
  repeatable.
- **F3 — Resume-on-launch row.** Ours resumes the queue on start; Apple's does not play on
  launch. Recommend: drop the row. Alternative: keep it as ours-only, labelled.
- **F4 — Appearance switch.** Recommend: report, do not score (different scope). Alternative:
  score Light ↔ Dark against our *theme* switch only, never a skin switch.
- **F5 — Where the numbers go.** Recommend: this doc only, until three passes agree; then one
  honest table on the deets.solutions page with the asymmetries printed under it
  (`docs/guide/marketing.md` is the home). Alternative: never publish; use it to steer our
  own work (the rows where we lose become NEXT-VERSION items).
- **F6 — Which skin is the default column.** Recommend: the shipped default, with Press as
  the second column. Alternative: the lightest skin only.
- **F7 — The 60 Hz run.** Recommend: do it; most readers are on 60 Hz laptops. Alternative:
  244 Hz only, with a note.
- **F8 / F10 — Old versions (§13). DECIDED 2026-10-10:** no old versions. Start at 0.25.4
  and go forward one release at a time. (This removed the second-account question.)
- **F9 — The release gate (§14).** Recommend: report only. Each release prints its row
  against the last one, and a red row asks him before `release:publish`. Alternative: a hard
  fail in `release-check.mjs` over a budget. Alternative: no gate; the run is by hand.
- **F11 — Field numbers (§15).** Recommend: none for now; the release history is enough.
  Alternative: add three medians (cold start, click → sound, private WS) to the weekly health
  counts in USAGE-COUNTS.md, under its privacy rules.
- **F12 — Which number is "the" headline (§16).** Recommend: three numbers, one per thing a
  person feels: private WS at rest, cold start → content, click → sound. Alternative: one
  composite score (rejected below: a composite hides which row moved).
- **Frames tool. DECIDED 2026-10-10:** our own tool (`deetsmeter`, §17), not PresentMon.
- **F13–F16 DECIDED 2026-10-10:** his call, the recommendation in each.
- **F13 — Where the tool lives (§17.8).** Recommend: `tools/deetsmeter/`, its own Cargo
  project like `cli/`, never bundled or shipped. Alternative: a hidden subcommand of the
  `deetsmusic` CLI (rejected in the recommendation: that CLI ships to users).
- **F14 — Which sound the tool hears (§17.2).** Recommend: process loopback of the app's
  process tree, so only that app's sound counts. Alternative: the whole system's loopback
  (simpler, but any other sound spoils a pass).
- **F15 — When the screen counts as "settled" (§17.3).** Recommend: 500 ms with no change in
  the region. Alternative: 250 ms (quicker, but a slow fade can read as settled) or 1000 ms.
- **F16 — The network row (§17.5).** Recommend: a hand run in Resource Monitor, reported only.
  Alternative: an elevated ETW mode in the tool (per-process bytes, needs admin).

---

## 10. What the first hand run would tell us (expected, not measured)

- We lose process count and private WS by a wide margin (a Chromium tree against one WinUI
  process); the question is by how much, and whether Animate backgrounds Off closes any of it.
- Click → sound should be close: both wait on Apple's CDN for the first segment. Our
  pre-insert and the station break-out check (79b21e1) are where we could lead on Next.
- Scroll fps at 244 Hz should favor us on Press and Cyber and lose on Glass with frost on.
  At 60 Hz both apps should hold the budget and the row becomes p99 frame time.
- Cold start is unknown. Ours pays WebView2 start plus MusicKit load behind the launch cover;
  theirs pays an MSIX activation and its own sign-in refresh. This is the row most worth taking
  first.

---

## 11. Measuring our own upgrades — the three loops

**Terms.** An *upgrade* is a change that moves a §2 metric the good way by more than the
noise (§12). A *regression* is the same in the bad way. The *baseline* is 0.25.4, the first
release measured (§13).

The Apple contest asks "are we lighter than them". The upgrade question asks "is this
release lighter than the last one". The second question is easier: same app, same code base,
and our own `[perf]` lines are allowed to explain the result. It still needs the outside-in
number, for one reason: **the installed release carries no telemetry** (`telemetry-on.ts`;
release-check item 5 fails a build that does). So every dev number we trend today is a number
about a build no user runs.

There are three loops. Each one answers a different question at a different cost.

| loop | question | build | tool | exists? |
|---|---|---|---|---|
| **Inner** (per change) | Did this edit make the scene slower? | `dev:built` (release-shaped, `VITE_PERF=1`) | `bench.mjs` → `perf-history.csv`; `shots.mjs --vs`; `webview-profile --trace` | Yes. 195 rows, keyed by commit. |
| **Release** (per version) | Is the new release lighter or quicker than the last one, as installed? | the installed release; Apple's app as the control | the §3 driver (§13) | No. §13–§14 design it. |
| **Field** (per week) | Is it quick on PCs that are not this one? | the live release | nothing today | No. F11. |

The inner loop already works and stays as it is. Its gap: a row in `perf-history.csv` is
never compared with an older row of the same scene, skin and Hz. A `--against <commit>`
switch on `perf-report.mjs` (or on `bench.mjs`) closes that: it prints the delta and marks it
with the §12 rule. That is a small change and needs no fork beyond "build it".

---

## 12. When a number counts as a change

A median that moved is not an upgrade. The rule, one for every row:

1. **Both runs pass the noise gate** (§1.4): spread ≤ 8 %, idle CPU ≤ 5 % before the pass.
2. **The ranges do not overlap.** With 3 passes, the worst pass of the better run must beat
   the best pass of the worse run. With 5 or more passes, use the median ± the
   interquartile range. This is crude, but it is honest at 3–5 passes, and a t-test is not
   (the passes are not normal: one cold disk read skews one pass).
3. **The change is larger than the floor of its tool.**

| metric | floor | why |
|---|---|---|
| any screen-diff timing | 8 ms | two capture frames at 240 fps |
| loopback → sound | 10 ms | the WASAPI period plus the −60 dBFS onset |
| private WS | 10 MB or 3 %, the larger | Chromium's allocator returns pages late |
| CPU at rest | 0.5 % of one core | the PDH sample rate |
| fps · dropped | 3 % · 0.5 point | `bench.mjs` tolerance |
| cold start | 5 % | disk cache state between reboots |

A row that passes 1–3 is marked ▲ (upgrade) or ▼ (regression). A row that fails any of
them is marked = (no change), even when its median moved. The release notes may only claim a
▲ row.

---

## 13. The release history — start at 0.25.4

> **Part:** decided · 2026-10-10 — his call: no old versions. The history starts at the
> current release (0.25.4) and grows by one row set per release from here on. The archive in
> `installers/` is not used.

**What it is.** The §3 driver, run on the installed release, on his own Windows account and
his own library. 0.25.4 is the baseline. Each later release, once installed, gets the same
run, and its numbers go below the last ones in `release-history.csv` (§14). Nothing older is
installed, so nothing older ever opens the live data folder (the migrations are forward-only;
an old release on a new database is not defined).

**The fixture is his own library.** No second account and no sign-in: the installed app
already holds the Apple session and the synced library. The library grows slowly between
releases; the song count goes in each row, so a jump in the library is visible beside a jump
in a number.

**The hard part: we cannot re-run the old release.** A number from a month ago and a number
from today differ for reasons that are not our code: the WebView2 runtime (Evergreen, updated
by Windows), the GPU driver, Apple's MusicKit JS (served live, not bundled), and Windows
itself. Two things handle this:

1. **Record what moved.** Each row carries `webview2` (from the registry), `gpu_driver`,
   `musickit` (the build string the page loads), `windows_build` and `songs`.
2. **Apple's app is the control.** Every release run also runs the same scenes on Apple's
   app, in the same sitting, in alternating order (§4). Apple's app did not change because of
   us. So:
   - Our row moved and Apple's did not → the change is ours. It gets its ▲ or ▼ (§12).
   - Both moved the same way → the machine or the network moved. The row is marked `drift`
     and claims nothing.
   - Apple's app updated itself (its version is in the row) → its rows reset; ours still
     compare with our last row, marked `control changed`.

This turns the Apple comparison (§1–§10) and the upgrade history into one run: one sitting
gives the "DeetsMusic vs Apple" table AND the "this release vs the last one" table.

**Release run vs inner loop.** A change that needs a before / after inside one release is
still the inner loop (`bench.mjs` on `dev:built`, same sitting, §11). The release history
answers only "what did users get".

---

## 14. The release check

Today `npm run release` builds, signs and archives, and he installs the build for the hand
test before `release:publish` (RELEASE.md §0b). The run fits in that gap:

1. The new release is installed (the hand-test install; nothing extra).
2. Run the scored scenes (§4 scenes 1–6 and 12; about 12 minutes per app) on the new release
   and on Apple's app, 3 passes each, alternating.
3. Write one row per app per metric to `scripts/compare/release-history.csv` (committed, like
   `boot-history.csv`): `when, app, version, metric, scene, median, spread, passes, webview2,
   gpu_driver, musickit, windows_build, songs, hz, skin, mark`.
4. Print two tables: ours against our last row (with the §12 marks and the §13 control
   check), and ours against Apple's app today. A ▼ row stops and asks him before publish (F9).

**The first run is the baseline:** 0.25.4, now installed. It has no row before it, so it
gets no marks; it sets the numbers the next release is judged against.

**Budgets** (proposed; each number is his to set when F9 is decided). A release that breaks
a budget is a ▼ even when the last release was close to it:

| metric | budget on this PC | where we stand (dev numbers, not the release) |
|---|---|---|
| private WS at rest, default skin | 350 MB | ~333 MB installed (2026-09-27) |
| cold start → content | set from the 0.25.4 baseline | dev to-first-paint 2.3–6.5 s in `boot-history.csv`; the dev server inflates it |
| click → sound, warm | 600 ms | our part ~10 ms; the rest is MusicKit (2026-09-12) |
| library scroll, Press, 244 Hz | ≥ 200 fps, ≤ 1 % dropped | `bench scroll` rows in `perf-history.csv` |
| CPU at rest, Animate backgrounds Off | 1 % of one core | not measured on the release |

The release check does not replace the hand test (RELEASE.md §0b). It finds the slow; the hand
test finds the broken.

---

## 15. Field numbers (F11)

The release history measures one PC. The PCs that matter are the users' PCs, and we know nothing
about them. The only designed path out is the weekly health counts in
[USAGE-COUNTS.md](../features/USAGE-COUNTS.md): no ID, no IP, an allow-list, groups under 5
hidden. Three medians would fit it (cold start, click → sound, private WS at rest), each
bucketed (for example "< 2 s / 2–4 s / > 4 s") so no exact value leaves the PC. That needs a
release-safe timer for each, which is a change to the telemetry gate: today the whole
`[perf]` layer is compiled out. Recommendation: not now. The release history first; the field
only if its rows look good and a user still says "slow".

---

## 16. From a number to work

A number is only worth taking if it can change what we build. Each scored row has a lever
in our code, so a ▼ (or a row where Apple wins) becomes a NEXT-VERSION item with its owner
module named:

| row | the lever | where |
|---|---|---|
| private WS / processes | renderer heap and DOM count; card windowing; the Widevine CDM is fixed cost | LIBRARY-VIRTUALIZATION.md, `heaviness-sample.ps1` split |
| CPU / GPU at rest | Animate backgrounds, the skin's live backdrop, timers | DEBUGGING.md §Graphics-cost baseline, OCEAN.md |
| cold start → content | WebView2 start (fixed), MusicKit load, first card paint behind the launch cover | `launch-perf.ts`, LOOK-SCHEDULE.md (the pre-paint) |
| click → sound / next → sound | pre-insert, queue windowing, the station break-out | QUEUE.md, `perf.ts` stage split |
| scroll fps / p99 | windowing, `--scroller-layer`, the skin's per-row cost | LIBRARY-VIRTUALIZATION.md, `bench scroll` |
| data folder growth | the art cache, the SQLite cache, the log rotation | DATA-ARCHITECTURE.md, LOGGING.md |

**Why not one score** (F12). A composite ("DeetsMusic 87") hides which row moved. A 20 MB
memory win can cover a 300 ms start-up loss, and the loss is the one a user feels. Three
headline numbers, one per thing a person feels, and the full table under them.

**The order to build it in**, if he says go (each step is useful alone):

1. `perf-report.mjs --against <commit>` (§11): deltas in the inner loop. Small.
2. A hand run of the §4 scenes on 0.25.4 and Apple's app, once (F2). Learns which rows are
   close enough to script.
3. `heaviness-sample.ps1 -Also AppleMusic` (§5): the rest rows for both, scripted.
4. `deetsmeter` and its driver, with two profiles: `apple` and `deets` (§17, phases M1–M4).
5. The baseline run on 0.25.4 (§13): the first rows in `release-history.csv`.
6. The release-check step (§14), on the next release. After two releases have run through
   it by hand, F9 decides whether it gates.

---

## 17. `deetsmeter` — our own measuring tool (the build scope)

> **Part:** designed · 2026-10-10 — his call: our own tool, not PresentMon. Not built. The
> forks inside it, F13–F16 (§9), are decided (the recommendation in each): `tools/deetsmeter/`,
> process loopback, 500 ms settle, the network row by hand.

**Terms.** *QPC* is `QueryPerformanceCounter`, the Windows high-resolution clock. *DDA* is
Desktop Duplication (`IDXGIOutputDuplication`): Windows gives a copy of the screen each time
DWM composes a change. The *region* is the app window's area on the screen. A *probe* is a
small rectangle inside the region that the profile names (for example, where the first
library row draws).

### 17.1 The shape: a sensor and a judge

| part | language | job | why there |
|---|---|---|---|
| `deetsmeter.exe` — the sensor | Rust (`windows` crate, as in the app) | Launch the app, place its window, send input, read the screen, hear the sound. Every event gets a QPC time. It reads a step list (JSON) and writes events (JSON lines). It judges nothing. | Node cannot reach DDA or WASAPI without a native addon. One process means one clock: the click time and the frame time need no sync. |
| `scripts/compare/run.mjs` — the judge | Node | The profiles, the scenes (§4), the passes, the noise gate, events → metrics, the CSV (§14), the §12 marks, the report. | The judgement changes often and is read by people; it belongs beside `bench.mjs`. |
| `heaviness-sample.ps1` with a profile list | PowerShell | The rest numbers (§2.1–§2.2): memory, CPU, GPU engine, disk, per process tree. | It does this already for our tree; the sensor does not need to. |

### 17.2 The sensor's parts

| part | Windows API | event it writes |
|---|---|---|
| clock | `QueryPerformanceCounter` | every event: µs from the start of the run |
| launch | `CreateProcessW` (ours); `IApplicationActivationManager::ActivateApplication` (Apple's Store app; it returns the PID) | `launch {pid}`, `gone {pid}` |
| window | `SetWinEventHook` (`EVENT_OBJECT_SHOW`) filtered to the PID tree; `SetWindowPos` to a fixed rectangle; per-monitor DPI aware v2, so every coordinate is a physical pixel | `shown {hwnd}`, `placed {rect}` |
| input | `SendInput`: click, wheel, drag (N steps at a fixed rate), keys, text | `input {kind}` at the call |
| screen | DDA `AcquireNextFrame`: `LastPresentTime` (QPC), `AccumulatedFrames`, the dirty rectangles. A frame whose dirty rectangles miss the region is dropped at once. For the rest, the region is copied to a staging texture and hashed, and each probe is hashed and checked for "one flat color". | `frame {present, accumulated, changed, hash, probes}` |
| kept frames | the same copy, written as PNG for N frames after a step (`"keep": N`), plus one labeled strip, as `shots.mjs` does | files |
| sound | WASAPI loopback. Default (F14): process loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, the target's process tree included), so only that app's sound counts. The pattern is in `DeetsAirplay/crates/airplay/src/capture.rs`, which already uses the process-loopback completion handler. | `sound-on`, `sound-off` (first block above / below −60 dBFS) |
| own cost | `GetProcessTimes` on itself | `self {cpu}` at the end of the run |

The mouse pointer: a pointer-only update (a new `LastMouseUpdateTime` and no dirty
rectangle) is ignored. The driver parks the pointer outside the region after each click.

### 17.3 The judge: events → metrics

| metric | rule |
|---|---|
| input → first change | the first `frame` after the `input` with `changed` in the region (or in the step's probe) |
| input → settled | the last change before F15's quiet time (recommend 500 ms) with no further change |
| start → window | `launch` → `shown` |
| start → first content | `launch` → the first frame where the content probe is not one flat color and not the profile's splash hash |
| fps while moving | inside the motion window only (first input of the gesture → settled): changed frames ÷ ms. A screen that does not move gives no frames, so fps is never read outside a motion window. |
| dropped | inside the motion window: a gap over 1.5 refresh periods. `AccumulatedFrames > 1` means the SENSOR fell behind DWM; it is counted as tool loss, never as an app drop, and a pass with tool loss over 1 % is NOISY. |
| p99 frame time | inside the motion window |
| input → sound | `input` → `sound-on` |
| quit → gone | `input` (the Quit) → `gone` for the last process of the tree |

The math sits in one pure module (`scripts/compare/metrics.mjs`) with a unit test in
`tests/`, as the CLAUDE.md rule asks for a pure rule. The judge also writes one
`[perf] frames …`-shaped line per motion window, so `perf-report.mjs` reads both apps' rows.

### 17.4 Trusting the tool

These are modes of the tool, kept, not a one-off harness:

- **`deetsmeter calibrate`.** The tool opens its own small window, sends a key to it, and the
  window flips black / white. Input → screen for a window with no work in it is the floor of
  the method (expected: 1–2 refresh periods, 4–8 ms at 244 Hz). Every run prints its floor in
  its header; a run whose floor is more than twice the expected value is NOISY.
- **One cross-check against our own telemetry** (once, after M3). On `dev:built`, the same
  library scroll measured by `bench.mjs` and by the tool, and the same play measured by
  `[perf] click→sound` and by the loopback. They must agree inside the §12 floors (the
  loopback number is later than MusicKit's "playing" by the output latency). If they do not,
  the tool is wrong, not the app.
- **Its own cost.** The `self` event goes in each row. Budget: under 3 % of one core at
  244 Hz on a 1280 × 800 region. Over it, the region shrinks to the probes.

### 17.5 Limits (print these with the results)

- The tool sees what DWM composed. A frame the app drew but DWM never showed is not seen. A
  person did not see it either, so this is the right number for this contest.
- The window must be visible, uncovered and on the main monitor. HDR off (DDA's 8-bit format).
  The terminal that runs the tool sits outside the region.
- DRM-protected video shows black in DDA. Our audio is not affected; cover art is not
  protected.
- No admin. `SendInput` cannot reach an elevated window; neither app runs elevated.
- Per-process network bytes need ETW and admin, so the tool does not take them (F16).
- This Claude session is an MSIX package. M1 checks first that DDA and `SendInput` work from
  it. If they do not, he runs the tool from a normal terminal; Claude reads the results files.

### 17.6 If the sensor stalls

`ffmpeg` 9.0.2 on this PC has `ddagrab` (`dup_frames=0` gives a frame only on a change). With
a marker flash to line up its clock with the input, it gives the same frames to within one
refresh. A fallback only: two processes, two clocks.

### 17.7 The phases

Each phase is handed over alone (one load-bearing thing in flight).

| phase | builds | done when | rough size |
|---|---|---|---|
| **M1** sensor core (BUILT 2026-10-10, §17.9) | clock, launch, window, input, screen, kept frames, `calibrate` | `calibrate` prints a floor; one click on our app gives input → first change, with a strip | ~600 lines Rust |
| **M2** sound | process loopback, `sound-on` / `sound-off` | input → sound on both apps for one play | ~200 lines Rust |
| **M3** judge | `run.mjs`, `metrics.mjs` + its test, the two profiles (`apple.json`, `deets.json`: launch, rectangle, coordinates, probes, splash hash), scenes 1–2 and 4–11 of §4, passes, noise gate, CSV, marks; then the §17.4 cross-check | one pass of every timing and frames row on both apps | ~500 lines Node |
| **M4** rest | `heaviness-sample.ps1` profile list (`AppleMusic.exe` tree), GPU engine counters | scenes 3 and 5 on both apps | ~80 lines PowerShell |

After M4: the 0.25.4 baseline run, with Apple's app as the control (§13).

### 17.8 Where it lives (F13)

Recommend `tools/deetsmeter/`, its own Cargo project like `cli/`: not in the app's workspace,
never bundled, never shipped, its `target/` gitignored. The release check does not see it.
The judge and the profiles go in `scripts/compare/`, the results under
`scripts/compare/results/` (gitignored) and `release-history.csv` (committed).

### 17.9 M1 as built (2026-10-10, branch `ten-out-of-ten`)

> **Part:** built · 2026-10-10 — M1 only; M2–M4 not started. Where this disagrees with
> §17.1–§17.7, this is the code.

**Build and use.** `cargo build --release --offline` in `tools/deetsmeter/` (the `windows`
0.61, `serde_json` and `png` 0.17 crates are already in the local registry). Three commands:

```
deetsmeter calibrate [--rounds 30] [--out <dir>]
deetsmeter run <steps.json> [--out <dir>]      (default out: deetsmeter-runs/<unix secs>)
deetsmeter find <exe name | full path>
```

A run file has `app` (`exe` + `args`, `aumid`, or `attach`), an optional `region` and
`probes` (relative to the visible frame), and `steps`: `launch`, `attach`, `wait_window`,
`place` (with or without a `rect`), `focus`, `wait`, `mark`, `move`, `click`, `wheel`,
`drag`, `key`, `text`, `settle` (default 500 ms, F15), `park`, `close`. An input step takes
`keep: N` and `tag`: the next N changed frames are written as PNGs plus a strip.
`tools/deetsmeter/examples/deets-scroll.json` is the reference. Output: `events.jsonl` (every
event, time-ordered, `t` in µs) and `frames/`.

**Changes from the design:**
- *Window found by polling* `EnumWindows` every 1 ms, not by `SetWinEventHook`: the same
  1 ms precision, and no message loop on the main thread.
- *The cover guard* (not in the design; added after the first live run). `place` refuses a
  region another window covers (the centre and 8 px inside each corner, by
  `WindowFromPoint`), and names that app. Every pointer step checks its own point, and
  `key` / `text` check the foreground window. A refused step sends nothing. Why: the first
  run on the live app, 2026-10-10, found DeetsMusic under the League of Legends client; the
  sensor measured the client's animated lobby and the scroll went into the client.
- *The baseline.* A new region re-opens the duplication, so its first frame (the whole
  screen) is a baseline, never a change.
- *Calibrate judges the sensor on missed compositions*, not on changes per second. The test
  window (GDI + `DwmFlush`) sometimes lands two flips in one composition, which reads as no
  change; that is the test window, not the sensor. The sensor's fault is a composition it
  did not see (`AccumulatedFrames − 1`), and the verdict is "keeps up" at ≤ 1 %. The pointer
  is put back on the window before every click.

**First numbers on this PC** (3440 × 1440 at 240 Hz, 2026-10-10):

| run | result |
|---|---|
| calibrate, 30 rounds | floor median 9.1 ms · p90 17.7 · min 4.1 · max 23.9 (27 rounds; 3 clicks lost, see below) |
| calibrate, cadence | 216 compositions/s seen at 240 Hz; 1 composition missed by the sensor (0.31 %) |
| sensor cost | 3.6–6.7 % of one core: over the 3 % budget of §17.4 at a 1402 × 1002 region. To look at in M3 (sample fewer rows, or hash the probes only). |

The 3 lost clicks: no flip and no lost frame (the colour sequence is unbroken), so the click
itself did not land, most likely a pointer move between the tool's move and its press. They
are reported as `missed` and left out of the floor.

**Learned for M3:**
- *A window that animates on its own* (a skin's backdrop, the turning record, a game client)
  changes the region on every composition. Whole-window "first change" is then 0.7 ms after
  any input: a false number. The judge must time a change in the step's PROBE (the area the
  input should change), never the whole region. Each profile needs probes per scene.
- `settle` on a region that never stops moving runs to its timeout; scope it to a probe too.

**Probes, as built (same day, after the first uncovered run).** The owner's run of the scroll
on the installed app (Glass, Cover Wallpaper on, a song playing) gave "first change +0.0 ms",
970 changed frames and two settle timeouts: the backdrop and the song clock change the region
on every composition. So the "learned for M3" item was built into the sensor now:
- A probe is read as a brightness grid (up to 32 × 32 cells, mean luma per cell). A probe
  CHANGES when one cell moves by at least `probe_threshold` (run-file key, default 16 of
  255). Each frame event carries, per probe, `d` (the largest cell change), `m` (the mean)
  and `c` (changed).
- An input step and `settle` take `"probe": "<name>"`: the summary times the first change in
  that probe, `settle` waits for that probe to go quiet, and `keep` keeps frames that change
  in it. The summary also prints the probe's largest cell change in the 500 ms before the
  input (the noise) and after it, so the threshold can be checked on every run.
- `exe` and `attach` expand `%NAME%` (the example attaches by
  `%LOCALAPPDATA%\DeetsMusic\DeetsMusic.exe`: a bare name matched the dev app too, and a full
  path would put a user's own name in a public repo).

**M1's done test: passed (2026-10-10).** `examples/deets-scroll.json` on the installed 0.25.4
(window 1402 × 1002 at 240 Hz, Glass): a 5-notch wheel down and back up over a list.

| input | first change in the probe | settled (500 ms quiet) | probe noise before → after |
|---|---|---|---|
| wheel down | +26.9 ms | +748 ms | 27 → 89 |
| wheel up | +25.0 ms | +327 ms | 36 → 105 |

The probe is quiet before the input (cell changes of 0–1). The one spike in each "before"
(27, 36, about 120 ms before the wheel) is the row HOVER: the pointer moves onto the list
150 ms before the press. So 16 sits above the backdrop seen through the frost and below the
input's own change. The window was in a different layout from the one the example was
drawn on (the Rulez card filled the middle), so the probe named `library` covered the Rulez
list; the scroll was still a scroll in our app. A profile must name its layout (M3).

Sensor cost on this short run: 13.8 % of one core (start-up included); the M3 item stands.

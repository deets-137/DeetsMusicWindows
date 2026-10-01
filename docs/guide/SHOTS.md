---
status: project
desk_test: none
sources: [scripts/shots.mjs, src/marks.ts, docs/guide/shots.json, docs/guide/motion.json, vite.demo.config.ts, demo/shim.ts]
updated: 2026-10-01
---
# DeetsMusic — Shots: pictures and clips of each feature

A script records every feature of the app as a picture or a short clip. The user guide
(DOCS-ORG.md §13) and a marketing overview use the same shots. The script runs again before
each release, so no picture shows an old app.

> **State (2026-09-28, branch `visualz`):** §10 steps 2 and 3 BUILT. The runner takes demo
> pictures and clips (§5a). `shots.json` holds three pictures and two sample clips (the
> Compass, the Midi card swap). `motion.json` is the motion set: 24 clips in the 5 skins (17
> gestures and 7 surface changes, where the runner is the window, §5c), with a console record
> and the app's frame telemetry per clip (§5b). It is the input to the animation design pass
> and a visual debugging tool (his framing, 2026-09-28). F1–F4 closed (§1); U10 open.

**Terms:**
- **Shot** — one picture, or one short clip, of one feature in one look.
- **Shot list** — `docs/guide/shots.json`. Each shot names its setup steps and the doc it covers.
- **Runner** — `scripts/shots.mjs`. It reads the shot list, drives the app, and saves the shots.
- **Demo** — the web build of the real UI with invented tracks (WEB-DEMO.md).
- **Dev app** — `npm run dev:app`. It uses the owner's real library.

## 1. Decisions (the owner, 2026-09-25)

| fork | choice |
|---|---|
| What a shot is | **Pictures and short clips.** A clip is 3–8 s, for motion: card swap, the Press record, the Compass. |
| Where shots come from | **The demo first.** The dev app only for what the demo cannot show (§4). |
| Who makes them | **The runner, again before each release.** Not by hand. |
| Who writes the words | **The guide rule (DOCS-ORG §13.2 U3) holds for marketing too.** Claude writes the outline: the feature, its hook, its shot. The owner writes every sentence a stranger reads. |
| Clip format | **MP4 with a poster picture.** The page plays it with `<video muted autoplay loop playsinline>`. The poster shows while it loads and for reduced motion. |
| Where the shot list lives | **`docs/guide/`** — this doc and `shots.json`. |
| Where shots go (U10) | **Local only, for now.** The owner is checking the cost of each way to host them. U10 stays open. |
| The marketing page | **Decide later**, after the owner sees the first shots. |
| How ffmpeg gets on the PC | **`winget install Gyan.FFmpeg`** (the owner started it, 2026-09-25). Not the `ffmpeg-static` npm package (a ~70 MB dev dependency in the repo), and not WebM from the browser's own recorder (an uneven frame rate, poor in Safari). Installed: ffmpeg 9.0.2, on the PATH (checked 2026-09-26). |
| F1 Which looks (2026-09-26) | **Every look for every shot.** His reason: it is scripted, and the files stay on his PC. The disk estimate in §8 grows by the same factor. |
| F2 Real library in dev-app shots (2026-09-26) | **Allow it, local only.** No swap step. Revisit when U10 puts shots anywhere public. |
| F3 Taskbar and tray icon (2026-09-26) | **Leave them out.** One hand-made picture if the guide needs it. |
| F4 Contact sheet (2026-09-26) | **Yes:** `shots/<version>/index.html`, every shot of the run on one page. |

## 2. What is there (read 2026-09-25)

- The dev app opens a CDP port. `scripts/webview-eval.mjs` finds it in
  `src-tauri/.tauri.dev.gen.json`. The same port gives `Page.captureScreenshot` (a picture)
  and `Page.startScreencast` (a clip as frames). No new npm package is needed.
- `npm run demo` serves the demo with Vite. Edge is installed
  (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`). Headless Edge with
  `--remote-debugging-port` gives the same CDP calls.
- The demo shows all four sizes (Mini 385×550, Player 405×675, Midi 495×670, Max 1100×950),
  every theme and skin, the Compass and Settings. Its catalog is invented: no real album art,
  no Apple name (WEB-DEMO.md §4).
- **ffmpeg is not on this PC.** The runner needs it to turn frames into an MP4. It is a dev
  tool only; the app does not ship it. `winget install Gyan.FFmpeg` puts it on the path.
- 40 docs carry `status: shipped`. They are the feature list the shots must cover (§6).

## 3. The shot list — `shots.json`

One entry per shot:

```json
{
  "id": "compass-calculator",
  "covers": "features/COMPASS.md",
  "kind": "clip",
  "source": "demo",
  "size": "midi",
  "look": { "theme": "night", "skin": "glass" },
  "steps": [
    { "key": "Ctrl+Space" },
    { "type": "12*7", "delay": 90 },
    { "wait": 800 }
  ],
  "frame": "app",
  "seconds": 5,
  "poster": "last"
}
```

- `kind` — `picture` or `clip`.
- `source` — `demo` or `dev` (§4).
- `size` and `look` — set before the steps run, through the app's own settings store. So one
  entry can list several looks (`"looks": [...]`) and the runner saves one shot for each.
- `steps` — a short fixed list of step kinds: `click` (a CSS selector), `key`, `type`, `wait`
  (ms or a selector), `hover`, `drag` (from and to selectors), `eval` (one JS expression, for
  a state no gesture reaches quickly). Steps use the app's real controls, so a broken
  control breaks its shot. The runner reports that.
- `frame` — `app` (the app's surface only) or `window` (the demo page's frame, for a toast
  or a panel that reaches the edge).
- `poster` — `first`, `last` or a time in seconds.
- `settings` (added 2026-09-26) — settings keys to seed for this shot, on top of the runner's
  own: the walk over (`onboardingStep: 0`) and `lookSchedule: "off"`. (The Rewind unlock
  notice covered every shot on the first run; the demo itself now marks it done, WEB-DEMO.md
  §13.)
- `badges` (added 2026-09-26) — `true` keeps the New badges. By default they read as seen (his
  call): the runner hides the badge's three forms (`.new-badge`, and `::after` on `[data-new]`
  for the cog and the quick panel logo), because copying the app's seen list would go stale.
- `looks` — leave it out for every look (F1). The looks are read from `ThemeName` in
  `src/theme.ts` and `SkinName` in `src/skin.ts`, so a new theme or skin joins by itself.

**The runner as built (2026-09-26):** `node scripts/shots.mjs [--only id,…] [--look
theme-skin,…]`. It starts the demo (free port from 1430) and headless Edge (free port from
9300, a throwaway profile, no window), seeds a clean store on EVERY load
(`Page.addScriptToEvaluateOnNewDocument`), sets the size at device scale 2, waits for the load,
the fonts and 1.5 s of arrival motion, runs the steps, and captures. A failed shot keeps its
last good file and is marked in `manifest.json` and on the contact sheet. Edge and Vite are
killed by process tree at the end, and on Ctrl+C. `kind: "clip"` and `source: "dev"` are
reported as skipped until §10 steps 3–4.

## 4. Where each shot comes from

**Demo** — everything the demo can show. The runner starts `npm run demo` on a free port
(probed from the default upward, never a fixed port), opens headless Edge on it with the
window set to the shot's size, and seeds a clean store first. So every run starts from the
same state: "Honey Static" in Now Playing, two weeks of seeded plays (WEB-DEMO.md §9.3).
Device scale 2, so the pictures stay sharp on a high-DPI page.

**Dev app** — only the parts that stay at the desktop (WEB-DEMO.md §5): the tray and its
panel, AirPlay, Last.fm, Rooms, Friends, sign-in, the updater. The runner connects to the
running dev app's CDP port. It does not start the app. These shots show the owner's real
library and real album art: fork F2 (§9).

The tray panel is its own webview (`tray.html`). The runner picks the CDP target by URL.
The Windows parts around it (the taskbar, the tray icon) are outside every webview. CDP
cannot capture them: fork F3.

## 5. Output

```
shots/                       gitignored while U10 is open
  0.14.6/                    the app version at capture
    compass-calculator.night-glass.mp4
    compass-calculator.night-glass.poster.png
    library-sort.day-press.png
    ...
    manifest.json            id, look, covers, source, size, the date, the runner's result
```

- A new app version gets a new folder. Old folders stay, so a shot can be compared with the
  last release.
- A clip: the screencast gives frames only when the page paints, with a time for each. The
  runner writes the frames and their durations to an ffmpeg concat list, so a clip plays at
  the real speed. H.264, no sound, sized for the web.
- Reduced motion is forced off while the runner works (CDP `Emulation.setEmulatedMedia`). A
  second shot with it on is possible later; nothing asks for it now.

## 5a. Clips as built (2026-09-28)

A shot with `"kind": "clip"` records while its `steps` run:
- `prepare` — steps that run before the recording starts (a state the clip starts from).
- `seconds` — the clip's length (default 4). The recording starts 300 ms before the first step.
- `strip` — `{ fps, seconds, cols, width, from }` for the frame strip (default 30 fps, 1.2 s,
  6 columns, 300 px per frame). `"strip": true` on a step starts the strip at that step;
  without it, the strip starts 100 ms before the first action.
- `about` — one line for the contact sheet: what the clip shows.
- New step kind: `rightclick` (a CSS selector).

Each clip gives four files: `<id>.<look>.mp4` (H.264, 60 fps, the real speed),
`.poster.png`, `.strip.png` (the motion window as a grid of frames, each labeled with its ms),
and `.frames.json` (every frame's time, the time of each step, the frame count, the median fps
and the longest gap). The strip is how Claude reviews motion: Claude reads pictures, not video.

Measured on the first run: headless Edge sends ~55–60 fps while the page moves, and fewer
while it rests (a paint only on change). A gap in `frames.json` during motion is a dropped
frame in headless Edge, not proof of one in WebView2: frame numbers in the app are
`[perf] frames` (DEBUGGING.md). A clip is ~140 KB; a strip ~1 MB. ffmpeg's `drawtext` needs
the font named by path on Windows (`consola.ttf`).

## 5b. The motion set and debugging (2026-09-28)

His framing (2026-09-28): the shots are for the guide AND for debugging. So a run can be
repeated on demand, keeps the evidence of what the page did, and never mixes with the shots of
a version.

**The motion set** — `docs/guide/motion.json`: one clip per animation (boot, card swap, card
replace, the Max swap, the title menu, grow, drill, a dropdown, the right-click menu, the quick
panel, the Compass, a hover hint, toasts, next song, play, scroll, a look switch), and the
seven surface changes of §5c. Its list-level
`looks` is `{ "theme": "moonlight", "skin": "*" }`: one theme in each of the 5 skins, because a
skin owns its motion tokens (§1 F1 still holds for `shots.json`). `"*"` works for the theme too.
Run it with `node scripts/shots.mjs --list docs/guide/motion.json`; it writes
`shots/motion/<version>/`. A full run is 24 clips × 5 skins = 120 clips, about 20 minutes.

**Flags:**
- `--list <file>` — another shot list. A scratch list for one bug is the normal way to debug:
  a few steps, `probe` and `snap`, one look.
- `--out <dir>` — write there. Default: `shots/<version>/` for `shots.json`,
  `shots/<list name>/<version>/` for another list, plus `-slow<n>` with `--slow`.
- `--slow <n>` — CSS and Web Animations run n times slower (CDP `Animation.setPlaybackRate`).
  The strip covers n times the seconds and labels its frames in app time, so a 180 ms motion
  shows n times the frames. Motion driven by `requestAnimationFrame` (the Press record, the
  Ocean sea) is not slowed.

**Steps for debugging:** `probe` (one JS expression; its answer goes in the console file),
`snap` (a PNG of this moment, named `<id>.<look>.<snap>.png`, mid-clip too), `reload` (the
page again with the same seed; a clip records the boot across it), `wheel` (`{ "wheel":
selector, "dy", "times", "delay" }`).

**What every shot keeps:** `<id>.<look>.console.txt` — every console line, uncaught error and
probe answer, each with its ms from the shot's start. The demo is a dev build, so the app's own
`[perf] frames` and `[perf] input` lines (src/frames.ts) are in it. The runner prints each
gesture's `[perf] frames` line after the shot and puts it on the contact sheet, beside a count
of console errors (the demo's missing favicon is not counted). A failed shot still writes its
console file: that is the evidence.

**What the numbers mean:**
- `[perf] frames … dropped N` is the smoothness number. The `@N Hz` in headless Edge can read
  wrong (244 Hz on the first run): the window has no display. Judge a drop by the app's own
  numbers in WebView2 (DEBUGGING.md §Frame telemetry). Use a clip to see WHAT moved.
- `.frames.json` `gaps` — every screencast gap over 25 ms after the first action, as
  `[at ms, gap ms]`. At rest the page does not paint, so a gap there is quiet, not a drop.

**What the first runs found (2026-09-28):**
- A demo bug: `user_files_list` had no demo handler, so every load logged a `[files] list
  TypeError`. Fixed in `demo/handlers.ts` (WEB-DEMO.md §9.8 says a new command needs its
  handler).
- **Next before the first Play does nothing, in the demo.** The Queue card holds the restored
  queue, but MusicKit has none until the first play, so `nextTrack()` → `skipToNextItem()` has
  nothing to skip to. Found because `next-song` recorded one frame in vanilla and press (glass,
  ocean and cyber passed only because their backgrounds keep painting); a probe showed the click
  landed on the button and the title did not change. The same path was in the real app, on
  every launch. **Fixed 2026-09-28, his call: stay paused, as Apple Music does** (QUEUE.md
  §Next and Previous before the first Play). The clip still presses Play first (`prepare`),
  to show a playing song change.
- **A lesson for clip design:** a clip that passes can still show nothing, if something else on
  the page keeps painting. Check the strip, or probe the state the gesture should change.

## 5c. The window: surfaces that grow and shrink (2026-09-28)

His wish (2026-09-28): the motion set records a surface growing and shrinking. In headless Edge
the page IS the window, so the runner stands in for it:

- **A pick** (`"window": true` on a shot): the app's own `set_size` reaches the runner, and the
  runner sets the page to that size. The path: `demo/shim.ts` `post()` calls
  `window.__deetsDemoHost` when no host frame exists; the seed script defines it to call the
  CDP binding `__shotsWindow`. The runner follows only after the load, so the boot's own
  `set_size` never moves a shot. Each resize is a `window` line in the console file.
- **A drag** (a `resize` step, `{ "resize": [w, h], "over": ms, "steps": n }`): the page's size
  moves in even steps from its size now, as a hand drag of the window's corner, and the app's
  auto-flip sees each step. **Headless Edge paints no step shorter than ~100 ms:** a 24-step
  drag over 600 ms showed the old size throughout and then one jump. 12 steps over 1.5 s paint
  every step. So a drag clip is slower than a real hand, and it shows each band crossing.
- **The video:** every frame goes on one canvas the size of the largest frame, anchored
  top-left (a Windows window grows from its top-left corner), on a dark desktop color.

The seven clips: Midi → Max, Max → Midi, Midi → Mini, Mini → Midi, Midi → Player (each picked
in the Compass, Places › Surface), and a drag that grows Midi to Max and one that shrinks Max to
Mini.

**What they show today (0.25.1):** a surface change has no motion of its own. A pick changes
the layout in one frame (`activate()` in `surface.ts`), then the OS window takes the new size
(`applySize()`): the Midi → Max clip jumps at one frame. The Enter that switches to Max costs
~300 ms press→paint (`[perf] input keydown`). On a drag, the auto-flip frame shows the new
surface's cards before their content arrives. These are inputs to the motion review, not fixes.

**What the demo cannot show:** the OS window's own resize (WebView2 in a Tauri window repaints
as the OS resizes it; headless Edge has no OS window). The dev-app source (§10 step 4) is the
way to see it.

## 5d. The scratchpad and frames at a step (2026-09-28)

His ask: a shorter, targeted clip for debugging, "and a scratchpad".

**The scratchpad.** `node scripts/shots.mjs --scratch <name>` runs
`shots/scratch/<name>.json` and writes to `shots/scratch/<name>/` (no version folder: a
scratch is for now). A name with no list gets a **starter list** and the run stops: the list
has a `help` block (every step, shot key and flag in six lines) and one clip that uses each
debug tool once. Edit it, run the same command again. `shots/` is gitignored, so scratch lists
never reach the repo. `--slow n` writes to `shots/scratch/<name>-slow<n>/`.

**Frames at a step.** `"frames": N` on any clip step keeps the next N **real** paints after
that step, not the MP4 resampled:
- `<id>.<look>.s<k>-<step>/` — one JPEG per paint, named `<n>_+<ms>ms.jpg` from the step.
- `<id>.<look>.s<k>-<step>.png` — those frames in one picture, each labeled `+ms` and the gap
  before it; a gap over 25 ms is red.
- The log and the contact sheet name them; the console file says when fewer than N came (the
  clip ended, or nothing moved).

**`--raw`** keeps every real frame of a clip in `<id>.<look>.raw/`, for when you do not know
where to look. **`SHOTS_DEBUG=1`** prints ffmpeg's full error and keeps a strip's temp folder.

**What the real frames can and cannot say (measured 2026-09-28):**
- **A gap is when the screencast DELIVERED a frame, not when the app painted it.** A click on a
  card title showed 365 ms with no frame; the app's own `[perf] input pointerup panel__title`
  said 96 ms. For latency, trust `[perf] input` in the console file; use the frames for WHAT
  was painted, in what order.
- Clip frames are 1× (495 px wide for Midi); a `snap` is 2×. Do not pass `maxWidth` /
  `maxHeight` to the screencast: headless Edge then sends its own 756×454 window.
- A frame size that is odd (495) must be padded to an even one for ffmpeg (both the MP4 and
  the strip round up).

**Its first find:** with `--slow 4`, the card title menu appears whole in one frame. It opens
through `makeDropdown` but has no `.pop` and no `enterRows` (CLAUDE.md checklist item 1), and no
`dataset.frames`, so frames.ts does not time it. For the motion review. **Fixed 2026-09-28**
(§5e): `.pop`, `enterRows` on open, `dataset.frames = "title-menu"`.

## 5e. The first motion review (2026-09-28)

Claude read the 120 clips of `shots/motion/0.25.1/` and ran close-ups in the scratchpad
(`review0928`, `grow-menu`, `uncover`). Swaps, replaces, dropdowns, the right-click menu, the
quick panel and the Compass run 160–450 ms by skin with 0–2 dropped frames. The findings, by
payoff:

1. **Grow: the card sat empty ~400 ms** (the pop ease looks open at ~130 ms; the rows waited for
   the whole clip). **BUILT 2026-09-28**, his calls: CARD-GROW.md §19.
2. **A theme pick runs the full launch cover**, 1.0–2.0 s with an opaque stage in the middle.
   A rule's theme change already crossfades (`withThemeFade`, 500 ms). **BUILT 2026-09-28**, his
   calls: a hand pick crossfades, an agent keeps the cover (UX-COVERUPS.md §6c.1).
3. **A surface pick in the Compass** leaves the Compass on screen 190–300 ms after Enter, then
   cuts in one frame. `withAppearanceTransition` has a `surface` kind that only agent changes
   use. Open.
4. **The Now Playing song change** is a hard cut of the title and artist. Open.
5. Smaller: the title menu (fixed, above); the Max diagonal swap crosses two empty cards over a
   third; the drill push changes the header before the slide and shows both levels for ~50 ms;
   boot is 0.75 s (Press) to 1.58 s (Ocean).

**The motion set's own faults (both fixed 2026-09-28):** the `drill` clip clicked a Home tile,
and a Home tile PLAYS (HOME.md), so it recorded a play; it now opens Playlists (`prepare`) and
clicks a playlist row, and each skin logs a `slide push` line. The `grow` clip's second click on
the zone does not collapse a grown card, so no collapse was ever recorded; it presses Escape now.
Six clips give no `[perf] frames` line (title menu until today, drill, hover hint, toasts,
play, next song).

## 5f. Measuring a gap: marks, the change curve, comparisons (2026-09-28)

> **Part:** built · 2026-09-28

His ask, after the theme crossfade review (UX-COVERUPS.md §6c.2): make the runner explain a gap,
not only show it, and make an A/B or an options comparison one command. Five parts, each from a
gap in that review.

**1. App marks on the strip.** `src/marks.ts`: `mark(name, detail)` puts one moment on the
page's clock in `window.__marks`. Dev and `VITE_PERF` only, on the same gate as frames.ts;
release-check item 5 fails a bundle that holds `__marks`. The marks are at generic places, so
most gestures have them with no new code:
- every frames.ts window: `<name>:begin`, `<name>:end` (menus, grow, swaps, `theme-fade`, the cover);
- every `makeDropdown` panel: `panel:open`, `panel:close <why>`;
- the theme fade: `fade:ask`, `fade:exits` (the panel exits ended or cut), `fade:snapshot`
  (the View Transition's `ready`: the snapshot stall ends here); the cover: `cover:wait`.

A new mark is one `mark()` call. The seed script also records, while a clip runs, each input's
own timestamp, every `requestAnimationFrame` and the long tasks (`RECORDER` in shots.mjs).

**2. The change curve.** Each step with `"frames": N` gets a curve: how far each real frame is
from the picture before the step to the picture the step settles on (the last frame before the
next action step). The log and the console file give `onset` (5 %), 50 % and 90 %, in ms from the
step's input. The strip shows `change N%` and a bar at the bottom of each frame. `"region":
selector` on the step measures only that element's box, read when the step starts (it measures
everything drawn in that box, the cards under a closing panel too). `frames.json` has `changes`.

**3. Comparisons.**
- `--tag <name>` writes to `<out>-<name>`; `--tag now` uses a timestamp. A rerun keeps the old one.
- `--vs "<spec>"` runs each shot again with a change: A is the run as is, B, C… one per `--vs`.
  A spec is `--token=value` (inline style on `<html>`, which beats every theme and skin rule) or
  `settingKey=value` (JSON, else text); join several with `;`. `--set` puts a spec on every run.
- Each step with frames gets `<id>.<look>.s<n>.vs.png`: the variants' strips one under the other,
  each under a banner with its change and its curve. `compare.txt` and the log give the same rows
  with the frames lines.

**4. The noise gate and repeats.** Before each run the runner reads the CPU load and waits up to
8 s for it to fall under `--noise` (default 35 %). A shot taken over it is marked `NOISY` in the
log, the manifest (`cpu`, `noisy`) and the contact sheet. `--repeat <n>` runs each shot n times;
the log gives the median of each `[perf] frames` line (by its name) with the range of the dropped
share, and the median curve. A wide range is noise, whatever the median says.

**5. One clock.** A step's time is its input's own `timeStamp` (the strip says `from keydown
Enter`), not the moment the runner sent it. The frames are sorted by time (a `-12` gap came from a
frame delivered after a later one). Each frame's label says what its gap was:
- **red** `stall N`: the page itself missed frames (a rAF gap over 25 ms, or a long task);
- **yellow** `late`: a gap over 25 ms while the page kept its frames, so the screencast was late;
- white: on time. A `stall` under 25 ms is printed but not red (at 240 Hz a 12 ms gap is a miss).

The console file's `clock` line gives the rAF period and the screencast's lag behind the page's
frame (1–3 ms on 2026-09-28: the two clocks agree). A negative or huge lag prints a warning.

**Found while building it:** headless Edge at times sends frames of its own 756×454 window in
place of the page's viewport (the page is top-left; outside it the page background shows, and it
snaps where the page fades). The console file says so in a `window` line, and the curve reads
only the page's box. Seen once in six runs on 2026-09-28; the earlier runs of the day were
the right size.

**The test run** (`shots/scratch/fade-ab.json`, Glass, the fade as built against
`--theme-morph-hand-wait=1`, two runs each, a busy machine): the strips show `fade:exits` at
+101 ms against +205 ms. The page curve's 50 % came at +341 against +453 ms. Every run was
marked noisy (40–68 % CPU), so these numbers are a check of the tool, not a verdict on the fade.

**Example:**

```
node scripts/shots.mjs --scratch fade-ab --vs "--theme-morph-hand-wait=1" --vs "--theme-morph-hand-ease=linear" --repeat 3
```

## 5g. What the album-mark desk test needed (2026-10-01)

> **Part:** idea · 2026-10-01 · each item is his fork; none is built

The first desk test of a layout (not a motion) on the runner: CARD-GROW.md §9b, the list
[ops/checks/album-mark.json](../ops/checks/album-mark.json). It passed, but six gaps in the
tool cost reruns or left a step out. Each gap and a proposal:

1. **A click on a covered control said "ok".** The demo's "Replay updated" notice sits over the
   Max header's right end (the Full | Lib chip). The `click` step clicked the notice; the view did
   not change and the shot passed. The probe after it was the only thing that showed it.
   *Proposal:* before a `click`, the runner checks `elementFromPoint` at the target's center. If
   that is not the target or inside it, the step fails and names the element on top. (The same
   class of fault as §5b: a passing shot whose click did nothing.)
2. **Timed notices cover controls.** *Proposal:* a shot key `"toasts": "off"` that holds the
   timed notices (the sticky ones are a feature to shoot), or a runner default that clears them
   before each step.
3. **No right-click and no menu step.** The run fired `contextmenu` from an `eval` and found the
   menu row by its text. *Proposal:* a `rightclick` step (a selector) and a `menu` step (a row's
   label: `"menu": "Favorite"`), so a menu path is a gesture, as a user makes it.
4. **A reload wipes a plain `localStorage` key.** The runner seeds a clean store on every load,
   so `deets.libraryAdd = off` was lost; the run went through the Settings row instead. That is
   the better test, but a state with no row cannot be set. *Proposal:* a shot key `"storage"`
   (raw keys, seeded with the store), beside `settings`.
5. **The demo cannot show a +.** Every song of every demo album is in the library, so the Full
   view never shows the Add square's + (the + to ✓ press is still a hand test). *Proposal:* one
   demo album that is only partly in the library (demo/catalog.ts).
6. **Column alignment took a hand-written probe.** The fault was 5 px: the numbers ended past
   the "#" header because a cell kept a width from the plain row. *Proposal:* a `__cols.check()`
   on the TELEMETRY gate (beside `__grow`) that returns, per column, the header's and the cells'
   left and right edges and the gap to the next column, and flags any edge that differs by 1 px
   or more. A list of rows is checked in one probe, in every skin.

**A note for probes:** hint.ts moves every `title` into `data-hint` and removes the attribute.
A probe reads `aria-label` or `data-hint`, never `title` (an empty `title` here is not a bug).

## 6. Coverage — no shipped feature without a shot

- `npm run docs:check` learns two warnings. They never fail the build:
  - a doc with `status: shipped` that no shot `covers`;
  - a doc whose `updated` is newer than the newest capture of its shots. That shot may
    show the old UI.
- A shot whose step fails (a selector is gone) is a line in the runner's report and in
  `manifest.json`. The runner goes on to the next shot. It keeps the last good capture.
- A guide page links a shot by its `id` and look, never by a file path. So when U10 is
  decided, the build fills in the real path in one place.

## 7. The marketing outline

When the owner opens the marketing fork, Claude writes `docs/guide/marketing.md` in the
guide's outline shape (DOCS-ORG §13.4): one line per feature — what it is, why a listener
cares, which shot shows it. The owner writes the words. Where the page lives is decided then.

## 8. Cost

- **Build:** one session. `scripts/shots.mjs` (the CDP driver, the two sources, the ffmpeg
  step), `shots.json` with the first list, the two docs:check warnings, `.gitignore`.
- **The first shot list:** Claude drafts it from the 40 shipped docs. About 40–60 shots,
  before looks are multiplied. The owner cuts or adds before the first full run.
- **A run:** local only. No Apple call: the demo has no network (WEB-DEMO.md §9.4), and the
  dev-app shots avoid playback. Time is mostly the clip seconds, so a few minutes.
- **Disk:** a picture is about 100–400 KB, a 5 s MP4 about 0.3–1 MB. ~~A version folder is
  roughly 30–80 MB with every look.~~ **Corrected 2026-09-26 with F1 = every look:** the code
  has 5 skins (vanilla, glass, ocean, press, cyber) and 6 themes (lilac, green, sepia,
  moonlight, black-yellow, black-red), so 30 looks. 40–60 shots × 30 looks is about
  1,200–1,800 files, **roughly 0.5–1.3 GB for each version**, and a full run of **one to three
  hours** (the clip seconds dominate). Measured 2026-09-26: a picture takes about 4 s and is
  0.2–1.7 MB at device scale 2 (Midi ~0.4–0.7 MB, Max ~0.9–1.7 MB; Glass is the largest). A run can take `--only <id>` or `--look <theme-skin>` to redo a part. That size
  is why U10 matters.
- **Tools:** ffmpeg (about 100 MB, dev PC only).

## 9. Open forks

| # | fork | options | recommendation |
|---|---|---|---|
| **U10** | Where shots go for the site | R2 upload on each publish · GitHub `main` · other | open: the owner is checking cost |

F1–F4 closed 2026-09-26; the answers are in §1.

## 10. Build order

1. The owner closes F1–F4. Install ffmpeg.
2. `scripts/shots.mjs` with pictures from the demo. Three sample shots. The owner reviews.
3. Clips (screencast + ffmpeg). Two sample clips. The owner reviews speed and size.
4. The dev-app source, with F2.
5. Claude drafts the full `shots.json` from the shipped docs. The owner edits it.
6. The docs:check warnings (§6). The first full run.
7. Later: U10, then the guide pages link shots; the marketing outline (§7).

## 11. Start of the next sitting (written 2026-09-25, for the evening)

Do these in order. Nothing is built yet, so there is nothing to test first.

1. **Check ffmpeg.** Run `ffmpeg -version` in a new shell (winget changes the PATH, so an old
   shell may not see it). If the command is not found, look in
   `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*` and add its `bin` to the PATH, or
   run `winget install Gyan.FFmpeg` again. The session's own shells may also need a restart
   of the Claude app to see the new PATH.
2. **The owner closes F1–F4** (§9). Ask them as multiple choice, recommendation first. U10
   stays open: he is checking the cost of each way to host.
3. **Build step 2** (§10): `scripts/shots.mjs` with demo pictures only.
   - Start the demo on a free port, probed upward from Vite's default (the global rule: never
     one fixed port). Headless Edge with `--remote-debugging-port` on a free port too.
   - Seed a clean store (clear the `deets.` keys, as the demo page's *Start over* does) before
     each shot. Set the size and look, run the steps, capture.
   - Three sample shots in a first `shots.json`: one Midi picture, one Max picture, one picture
     in a second look. Write them to `shots/<version>/`, and add `shots/` to `.gitignore`.
   - Check: `npx tsc --noEmit` is not needed (the script is `.mjs`); run the script once, and
     show him the three files with SendUserFile.
4. **Build step 3** only after he likes the pictures: clips, two samples.

The inputs the build needs are all in this doc: §3 (the shot list shape), §4 (the two
sources), §5 (the output), §6 (the checks, later).

## 12. The picture check — a regression gate on the shots (designed 2026-09-27)

> **Part:** designed · 2026-09-27 · build with the clips (§10 step 3) or after

**Why.** No check today can see the screen. A CSS move, a token change or a skin edit ends
with "his look" because nothing else can say a pixel moved (UI-ARCHITECTURE.md §4c; the pixel
pass of 2026-09-27). The shots already render the real UI in a browser from the demo. Kept as a
baseline and taken again, they are that check.

**What it is.** `npm run shots:diff` (a mode of `scripts/shots.mjs`):
1. Renders every picture in `shots.json` the way a normal run does (§4: the demo, headless Edge
   over CDP, a clean store, the shot's size and look).
2. Compares each new PNG with its baseline, pixel by pixel, in the same browser page through a
   canvas — no image library, no new dependency. A pixel differs when any channel differs by
   more than a small tolerance (anti-aliasing noise; the value is a constant in the script).
3. Fails when a picture has more differing pixels than a threshold (a constant; start at 0.1 %
   of the picture), and writes three files per failure beside the run: the baseline, the new
   picture, and a diff picture with the changed pixels in one flat color.
4. Prints one line per picture: `ok`, or `N pixels differ (x %)` with the three paths.

**The baseline.** A set of pictures taken from a state the owner has looked at and approved,
committed under `shots/baseline/` (today `shots/` is gitignored, §11 step 3; the baseline
folder is the one exception, `!shots/baseline/`). A change that is meant to move pixels
replaces the baseline in the same commit (`npm run shots:diff -- --accept`), so the diff of
that commit shows the pictures that changed. A baseline is per look and per size, as the shot
list is.

**What it sees, and what it does not.** It sees layout, color, type, the token tiers and the
cascade: everything the split and the pixel pass worried about. It does not see motion (a
still), hover (no pointer), sound, or the WebView2 differences from Edge (same engine, the
same fonts on this PC; a different PC needs its own baseline). The demo's mock tracks are the
data, so a picture never depends on the library.

**When it runs.** By hand, not in the hook: `npm run release` runs it as one more release
check (RELEASE.md §0), and any sitting that moves CSS runs it before and after
(UI-ARCHITECTURE.md §4c step 3). It is not in `npm run check`, because it needs the demo
build and a browser and takes a minute, and the pre-push hook must stay a few seconds.

**Forks for the owner, before the build.** The tolerance and the threshold; whether the
baseline is committed (repo size grows by the set, about 6 × 200 KB today) or kept beside the
repo; whether a failure blocks a release or warns.

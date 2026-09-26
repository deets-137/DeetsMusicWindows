---
status: project
desk_test: none
sources: [scripts/webview-eval.mjs, vite.demo.config.ts, demo/shim.ts]
updated: 2026-09-25
---
# DeetsMusic — Shots: pictures and clips of each feature

A script records every feature of the app as a picture or a short clip. The user guide
(DOCS-ORG.md §13) and a marketing overview use the same shots. The script runs again before
each release, so no picture shows an old app.

> **State (2026-09-25):** paper design. No code. Four forks are still open (§9). The next
> sitting starts at §11.

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
| How ffmpeg gets on the PC | **`winget install Gyan.FFmpeg`** (the owner started it, 2026-09-25). Not the `ffmpeg-static` npm package (a ~70 MB dev dependency in the repo), and not WebM from the browser's own recorder (an uneven frame rate, poor in Safari). |

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
- **Disk:** a picture is about 100–400 KB, a 5 s MP4 about 0.3–1 MB. A version folder is
  roughly 30–80 MB with every look. That size is why U10 matters.
- **Tools:** ffmpeg (about 100 MB, dev PC only).

## 9. Open forks

| # | fork | options | recommendation |
|---|---|---|---|
| **U10** | Where shots go for the site | R2 upload on each publish · GitHub `main` · other | open: the owner is checking cost |
| **F1** | Which looks each shot uses | one look for every shot · one look for most and all looks for the look features · every look for every shot | one look for most, all looks only where the look is the feature (skins, Press, Ocean, Cover Wallpaper) |
| **F2** | Real library in dev-app shots | allow it (local only) · blur the covers and names in the runner · skip dev-app shots until the demo gains those panels | blur in the runner: an `eval` step swaps covers and names for demo ones, CSS only, nothing written |
| **F3** | The taskbar and tray icon | leave them out · capture the screen with a Windows tool | leave them out; one hand-made picture if the guide needs it |
| **F4** | A contact sheet | none · `shots/<version>/index.html`, every shot on one page | the contact sheet: one page to review a run |

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

---
status: sop
desk_test: none
sources: [scripts/shots.mjs, scripts/readability.mjs, docs/ops/checks/readability.mjs, docs/ops/checks/readability-sheet.mjs, scripts/webview-eval.mjs, docs/ops/checks/drop.mjs, docs/ops/checks/smooth.mjs, docs/ops/checks/smooth-monitor.js, docs/ops/checks/mb-support-probe.mjs, docs/ops/checks/lastfm-refresh-probe.mjs]
updated: 2026-10-14
---
# Checks — the archive of re-runnable test scripts

His ask (2026-10-01): a shots list or a drive script written for a desk test is kept here, with
a description, so it can run again later: for a regression check after a change, or to compare
two versions. `shots/` is gitignored, so a list kept in `shots/scratch/` is lost; this folder is
tracked.

Terms:
- **A shots list** is a JSON file for `scripts/shots.mjs` (SHOTS.md §3, §5b–§5f). It runs the web
  demo (the real UI, mock songs, a fake MusicKit) in headless Edge. No dev app is needed.
- **A drive script** is a Node script that drives the DEV app over CDP (DESK-TESTS.md §1). It
  needs `npm run dev:app` or `npm run dev:built` running.

## 1. How to add one

1. Build and debug it in the scratchpad (`node scripts/shots.mjs --scratch <name>`).
2. When it shows what the desk test needs, copy it here with a plain name.
3. Give the list these top-level fields (the runner ignores the ones it does not read):
   - `about` — what it shows, in one or two sentences.
   - `desk_test` — the doc § it covers.
   - `made` — the date.
   - `pass` — what a pass looks like in the strips, the probes and the `[perf]` lines.
   - `run` — the command line.
4. Give each shot an `about` and a `covers` (the doc it belongs to).
5. Add one row to §2.

A list here writes to `shots/<list name>/<version>/`. So a run on the next version sits beside
the last one, and the two can be compared strip by strip. `--tag <word>` keeps two runs of one
version apart; `--vs "--token=value"` runs a variant beside the first (SHOTS.md §5f).

## 2. The archive

| File | Kind | What it checks | Desk test | Made |
|---|---|---|---|---|
| [grow-timing.json](grow-timing.json) | shots list | A grow in Midi (and the old order, `--grow-rows-at: 1`, as a baseline), a wide, a tall and a Fill grow in Max, each with Escape; 5 skins | [CARD-GROW.md §19.1](../../cards/CARD-GROW.md) | 2026-10-01 |
| [theme-crossfade.json](theme-crossfade.json) | shots list | A hand theme pick from the Compass and from the title menu (the panel leaves, then the fade); a skin pick keeps the cover; 5 skins | [UX-COVERUPS.md §6c.1, §6c.2](../../architecture/UX-COVERUPS.md) | 2026-10-01 |
| [album-mark.json](album-mark.json) | shots list | A grown album: the mark column in the Lib view (♥ presses, menu Favorite) and the Full view (✓ → ♥ → ✓), the # column under its header (a probe), the ♥ column kept on Library Songs, Add to Library off; Max, Press | [CARD-GROW.md §9b](../../cards/CARD-GROW.md) | 2026-10-01 |
| [mb-support-probe.mjs](mb-support-probe.mjs) | probe script | MusicBrainz (and Wikidata) coverage of the library's artists: the match by Apple artist URL, then by name + one album; the Support links by type; top 50 / top 200 / the rest. Reads the app's database read-only; no app needed | [SupportArtist.md §5](../../ideas/SupportArtist.md) | 2026-10-13 |
| [lastfm-refresh-probe.mjs](lastfm-refresh-probe.mjs) | probe script | How often Last.fm refreshes its public counts: the top 3 chart songs and two albums read every minute; a line per move with the minutes since the last. No app needed; the key from the build's key file | [PresentationMode.md §7](../../features/PresentationMode.md) | 2026-10-13 |
| [smooth.mjs](smooth.mjs) + [smooth-monitor.js](smooth-monitor.js) | shots runner + probe | The motion monitor: the motion set and the full player's open and close, every skin, each shot watched every frame for a flash, a one-frame snap and a jitter (§2a) | none — a regression run after any motion change ([fullscreen-player.md §13](../../features/fullscreen-player.md)) | 2026-10-14 |
| [readability.mjs](readability.mjs) + [readability.json](readability.json) + [readability-sheet.mjs](readability-sheet.mjs) | shots runner + list + review sheet | The readability check: every text box on screen, in every theme × skin, scored against the real pixels behind it; Glass also with Fancy Glass on at both ends of each slider (§2b) | none — a regression run after any theme, skin or text-color change | 2026-10-14 |
| [drop.mjs](drop.mjs) | drive script | `net <s>`: the webview offline and the Apple check held out for s seconds, on one CDP socket. `battery on\|off`: the page's `BatteryManager.charging` and a `chargingchange`. Prints the ring lines the drop caused | DESK-TESTS.md §1 (a network drop, held; unplug on a desktop) | 2026-10-01 |

**drop.mjs, how to use it.** A network cut does nothing to a song MusicKit has buffered, so seek
past the buffer while it holds: `deetsmusic --port <dev bridge> --token <bridgeToken> seek 85%`
(the token is in `%APPDATA%\com.deetsmusic.dev\settings.json`). Only the webview goes offline;
Rust keeps its network. The battery override tests the `charging` fact and the rules on it, not
the hardware: a real unplug on a laptop stays the owner's test.

### 2a. The motion monitor (smooth.mjs)

His ask (2026-10-14): "a smooth experience all around". `node docs/ops/checks/smooth.mjs` builds
a list from `docs/guide/motion.json` (so a shot added there is watched too) plus the full
player in Max and Midi, runs it on the web demo, and prints one block per shot. `--skin press`,
`--only grow,drill` and `--report` (print the last run again) narrow it. The full run is 130
clips and takes about 35 minutes.

**What a hit is** (`smooth-monitor.js`, every frame for 14 s):
- **FLASH:** a part fully shown goes under 0.85 opacity and is fully shown again within 700 ms.
- **SNAP:** a part's opacity rises by 0.6 or more in one frame: a fade-in that skips, or a
  fade-out that ends with a snap back. A flash that runs on from an intended hide reads as one
  long dip, so only the snap shows it (the full player's first fix, 2026-10-14).
- **JITTER:** a box moves 3 px or more and returns within 1 px inside 250 ms.

**The baseline: hits that are designed motion (2026-10-14, all five skins).** Each one is the
same in every run. A hit not in this list is new, and it needs a look at that shot's frames.

| Shot | Hit | Why it is designed |
|---|---|---|
| card-swap, max-swap (Cyber) | FLASH on both slots, ~250 ms | Cyber's out step: the card plays out, then in |
| card-swap, max-swap (Press, Cyber, Vanilla) | JITTER on the slots, 3–581 px | the swap travel and the skin's swap shape |
| card-replace (all) | FLASH + 11 px JITTER on the slot | the new card rises in |
| grow (all) | FLASH on `panel__body`, the shelves and the edge strip, at the open and the collapse | the rows hide while the clip opens, then come in; the strip is off while grown |
| fullplayer-max / -midi (all) | FLASH on every row part at the open and the close | the rows go first and come in at the new place |
| fullplayer-midi (all) | FLASH on `np__center` after the close | at rest the rows fade in again |
| fullplayer-max (all) | SNAP on `np__meta`, `np__scrub`, `np__times`, `np__bottom`, `np__vol` at the close's end | the real card takes over from its still copy (`restCopy`), which showed the same rows in the same place: no change on screen |
| fullplayer-max / -midi (all) | SNAP on `np__art` and its `IMG` | the flight copy hands over to the real cover: the same picture |
| fullplayer-midi (all) | JITTER 4 px on `np__times`, `np__vol` | the rows' `enterRows` rise |
| surface-mini-to-midi (all) | JITTER ~20 px on `np__center`, back in ~25 ms | not painted: Now Playing's ResizeObserver puts the row right before the paint (the frames show no jump) |
| boot (all) | no report | the shot reloads the page; read its strip |

**Found and fixed with it (2026-10-14):** the full player's rows flashed after the open; the Max close ended with a jump (an empty resting place, then a last sliver)
(fullscreen-player.md §13); the close square popped in beside the rows' fade; the hover hint
blinked off and on after a drill (ONBOARDING.md §1, `STILL_PX`).

### 2b. The readability check (readability.mjs)

His ask (2026-10-14): "a full readability check" after the Settings card in Glass + Moonlight
was hard to read. His calls: **all readable text, subtext too, meets WCAG 2 AA** (4.5:1, or 3:1
for large text: 24 px, or 18.66 px bold); **Glass is checked at its defaults and at both ends of
each Fancy Glass slider** (Tint, Backlight, Canvas glow, Canvas dim), so any setting a user can
reach must read.

`node docs/ops/checks/readability.mjs` runs `readability.json` in every look (pass 1), then the
six Glass looks with Fancy Glass on, at its defaults and at 0 and 100 of each slider (pass 2),
then writes `shots/readability/<version>/readability.html` and `readability-summary.json`.
About 80 s a look; the whole run is about 1 h 45 min. `--look a,b` narrows it, `--no-glass`
skips pass 2, `--report-only` builds the report again from the last readings.

**How a text box is scored** (`scripts/readability.mjs`, the `read` step of the shots runner):
1. The page lists each visible line of text: its color with its alpha times every ancestor's
   opacity, its size and weight, its card (`data-mounted`) and the theme role its color matches.
   Text scrolled out of its list, or under a solid layer, is left out.
2. All animations pause. A screenshot with every text color transparent gives the backdrop alone.
3. The text color is laid over each backdrop pixel under the box, and the WCAG ratio is taken per
   pixel. The score is the 10th percentile: the worst tenth of the backdrop. APCA Lc is beside it,
   for information only.
4. Each failing box is outlined (red under 3:1, amber 3 to 4.5:1) in `<shot>.<look>.<read>.read.png`.

The shots: Max at its defaults; Max with History, Radio, Rewind; Max with Diary and Rulez; the
Settings card with every section open, read page by page; the Compass; the quick panel; the
toasts; a hover hint. A `read` step with `"scroll": selector` reads, scrolls that list down by
85 % of its height, and reads again to the end.

**The review sheet** (2026-10-14, his ask): `node docs/ops/checks/readability-sheet.mjs <after
dir> [<before dir>]` writes `<after dir>/sheet.html`: one theme × skin grid for each view (each
Max shot, each Settings page, the Compass, the quick panel, the toasts, the hint), built from the
clean picture each reading saves (`<shot>.<look>.<read>.clean.png`). With a before dir, each cell
shows both pictures and the worst `--text` / `--subtext` before → after. `--tag <name>` on
`readability.mjs` writes a run to `<version>-<name>`, so the last run stays to compare.

**The report:** §1 each look's worst score per text role (`--title`, `--text`, `--subtext`);
§2 each failing element across looks, so one fix is one row; §3 each look's failures with a
link to the marked picture.

**Limits.** The demo's covers are Apple's real covers, so Glass's backdrop is real; but the
playing song is the demo's, and a brighter cover can score lower. Text on a hover or a focus
state is not read (no pointer rests on a row). A disabled control is listed and never fails.

## 3. Limits

- A shots list runs in headless Edge, not WebView2: its frame rates are not a verdict (the `@N Hz`
  can read wrong). Judge smoothness by `[perf] frames` on `npm run dev:built` (DEBUGGING.md).
- The demo's MusicKit is fake: no real playback, no network, no song change failure.
- A strip shows what moved and when. Whether it looks right is the owner's eye.

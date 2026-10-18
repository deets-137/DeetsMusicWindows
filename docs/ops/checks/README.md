---
status: sop
desk_test: none
sources: [scripts/shots.mjs, docs/ops/checks/rewind-sweep.mjs, docs/ops/checks/rewind-data.mjs, docs/ops/checks/sweep-helpers.mjs, docs/ops/checks/sweep-read.mjs, scripts/readability.mjs, docs/ops/checks/readability.mjs, docs/ops/checks/readability-sheet.mjs, scripts/webview-eval.mjs, docs/ops/checks/drop.mjs, docs/ops/checks/license-fail.mjs, docs/ops/checks/smooth.mjs, docs/ops/checks/smooth-monitor.js, docs/ops/checks/mb-support-probe.mjs, docs/ops/checks/lastfm-refresh-probe.mjs, docs/ops/checks/album-sum-probe.mjs, docs/ops/checks/cpu-split.ps1, docs/ops/checks/spin-rate.ps1, docs/ops/checks/page-sample.mjs, docs/ops/checks/ipc-timing.mjs, docs/ops/checks/refresh-hint.mjs, docs/ops/checks/spin-fps.mjs, docs/ops/checks/spotify-probe.ps1]
updated: 2026-10-18
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
| [album-sum-probe.mjs](album-sum-probe.mjs) | probe script | An album page's plays and listeners against its songs': one `album.getInfo`, then one `track.getInfo` per song of Last.fm's track list, the sum and the top song's listeners, each song's line. No app needed; the key from the build's key file | [LISTENERS.md §9.1](../../features/LISTENERS.md) | 2026-10-17 |
| [smooth.mjs](smooth.mjs) + [smooth-monitor.js](smooth-monitor.js) | shots runner + probe | The motion monitor: the motion set and the full player's open and close, every skin, each shot watched every frame for a flash, a one-frame snap and a jitter (§2a) | none — a regression run after any motion change ([fullscreen-player.md §13](../../features/fullscreen-player.md)) | 2026-10-14 |
| [readability.mjs](readability.mjs) + [readability.json](readability.json) + [readability-sheet.mjs](readability-sheet.mjs) | shots runner + list + review sheet | The readability check: every text box on screen, in every theme × skin, scored against the real pixels behind it; Glass also with Fancy Glass on at both ends of each slider (§2b) | none — a regression run after any theme, skin or text-color change | 2026-10-14 |
| [reveal-live.json](reveal-live.json) | shots list (dev source) | The first load of Playlists, Home, Search (his newest additions, typed and pasted), Library, History and Rewind on his LIVE dev app, cold and warm, plus a cold launch: the pictures each step brought, the late ones, their reading order, the redraws (SHOTS.md §5h) | [UX-COVERUPS.md §7.13](../../architecture/UX-COVERUPS.md) — the baseline, then after each build step | 2026-10-17 |
| [song-box.json](song-box.json) | shots list (dev source) | The song facts box on Song Credits in Max (Search › Bohemian Rhapsody): the box and its About, presentation mode and Esc back to the song page, Hide song info and Undo, *Notes from* › None (set back after). Probes, not only pictures | [LISTENERS.md §8.9](../../features/LISTENERS.md) | 2026-10-17 |
| [album-notes.mjs](album-notes.mjs) → album-notes.json | shots list (dev source), made by a script | Apple's album notes: the About and its press, the note in Max and Midi, song rows and quoted-name mentions, a mention's play (PLAYS A SONG), the Compass's Esc, the row off and *Last.fm only* with no call, a failed read, the song page's About, reduced motion. Every probe has an `expect` | [album-notes.md §8.3](../../features/album-notes.md) | 2026-10-17 |
| [album-reviews.json](album-reviews.json) | shots list (dev source) | The Diary renamed Album Reviews: the card's title and + hint (no "Diary" left in it), a review opened the way *Review This Album* opens it (header *Review: <album>*, Back), its Settings section and *New reviews / Every review*, the Compass finding the card by "diary". The review it makes is deleted at the end. Every probe has an `expect` | [DIARY.md](../../features/DIARY.md) | 2026-10-17 |
| [song-box-edges.mjs](song-box-edges.mjs) → song-box-edges.json | shots list (dev source), made by a script | The song facts box's 16 edge cases and races: late and failed Last.fm answers, the row off and on, presentation mode's exits, all skins on a grown card, Midi, *Notes from*, patched data (a stub wiki, big counts, long tags), reduced motion. Every probe has an `expect` (SHOTS.md §5i) | [LISTENERS.md §8.11](../../features/LISTENERS.md) | 2026-10-17 |
| [rewind-sweep.mjs](rewind-sweep.mjs) → rewind-sweep.json | shots list (dev source), made by a script | The Rewind card's quality sweep: 5 guards (Escape keeps picks, fast dropdown changes, no Unknown flash at launch, Midi fit, a year's read time); 5 fault shots that fail until their fix (F1, F2, F3, F7, F8); the visual pass (the motion monitor over every choice and a song change, the readability check in all 30 looks). PLAYS music (about 80 s, 12 s, 15 s). The last shot puts back slot c, Midi's right card and the Rewind choices | [DEETS-REWIND.md §8](../../features/DEETS-REWIND.md) | 2026-10-18 |
| [rewind-data.mjs](rewind-data.mjs) | probe script | The Rewind sweep's numbers from the live and dev databases, read-only: plays with no minutes (F4), plays of deleted playlists (F1), plays over twice the song (F3), minutes against song length, songs under two IDs. No app needed | [DEETS-REWIND.md §8](../../features/DEETS-REWIND.md) | 2026-10-18 |
| [sweep-helpers.mjs](sweep-helpers.mjs) | module | The shared steps of every sweep list: save and restore the slots and keys, a card into a slot, a menu pick, play (the menu's glyph or row), a key press on the page, a Ctrl+click, the motion monitor over the feature's own parts and its no-hit report, every look | [QUALITY-SWEEP.md §3](../QUALITY-SWEEP.md) | 2026-10-18 |
| [sweep-read.mjs](sweep-read.mjs) | report script | One sweep's readability for one card: the card's own failures, and the shared ones (a role that fails on other cards in the same look) on their own lines | [QUALITY-SWEEP.md §3a](../QUALITY-SWEEP.md) | 2026-10-18 |
| [cpu-split.ps1](cpu-split.ps1) | probe script | The CPU of one app tree over N seconds, split by process type (renderer, GPU, audio, CDM…); 100 = one core. The live app by default, `-Exe` for a dev app | none — any CPU question (WORKLOG 2026-10-17 *CPU hunt*) | 2026-10-17 |
| [spin-rate.ps1](spin-rate.ps1) | drive script | The Press record's spin at full rate, 120, 60 and 30 fps on the second dev app, the CPU of each; `-Hold 120` / `-Hold full` leaves one spinning for an eye test, `-Hold off` stops it | HANDOFF › Open now, *The record's spin rate* | 2026-10-17 |
| [spotify-probe.ps1](spotify-probe.ps1) | probe script | Can DeetsMusic operate the user's own Spotify desktop app: its media session (P0), Odesli's Apple → Spotify map (P1), a `spotify:track:` link starting a song (P2), a seek (P3), a link with a start time (P4), the position clock (P5), pause / play (P6). Windows PowerShell 5.1; no app, no key | [SpotifyRooms.md §6](../../ideas/SpotifyRooms.md) | 2026-10-18 |
| [ipc-timing.mjs](ipc-timing.mjs) | probe script | The command recorder on a running dev app (first by default, `--second`): the handle, the launch reads timed, the log writes not, begin / end marks paired, a failing command cold then warm with `failed 2`, a race of two first calls, the block in the log with names and numbers only, covers counted, `coll:render`, `latency:profile` reads the log. Exit code = failures | [LOADING-SET.md §6](../../guide/LOADING-SET.md) | 2026-10-17 |
| [refresh-hint.mjs](refresh-hint.mjs) | probe script | The Library ⟳ on a running dev app: one full sync from the ⟳ and three clicks while it spins (the hint at once, the dip, three `library:refreshBusy`, no second sync), the words through a full pass and a launch-type pass, the box taking new words, the dip class cleared. About 45 Apple calls. Exit code = failures | [apple-calls.md §4.1](../../ideas/apple-calls.md) | 2026-10-17 |
| [spin-fps.mjs](spin-fps.mjs) | probe script | The Press record's Spin FPS row on the running first dev app (`dev:app`): sets Press and Spin, plays one song, steps the row through 60 · 120 · 144 · 240 and the speed to 78, reads the disc's easing (`steps(n)` / `linear`) and that the angle does not jump; puts the look, the rows and the pause back. With no sound the angle checks read a still disc. Exit code = failures | [VINYL.md §12](../../features/VINYL.md) | 2026-10-17 |
| [page-sample.mjs](page-sample.mjs) | probe script | The page sample on a running dev app (second by default, `--first`): every count present, the six listener sets, no title or id, timers counted and named and cleared back, animation frames, the ring line and `/health`'s `page`, two samples at once, `src/` names in `--built`. Exit code = failures | [DEBUGGING.md § The page sample](../DEBUGGING.md) | 2026-10-17 |
| [license-fail.mjs](license-fail.mjs) | drive script | A refused Apple license on the dev app, then the heal, timed. `next`: 20 s before a song's end, the next song's license is refused (the live case); `start`: a fresh play's license is refused; `--count 2`: the heal's reload is refused too (the toast). CDP `Fetch` answers the request with a made-up refusal (with CORS headers: without them MusicKit sees a network error and asks again later). Prints the ring from the refusal, the gap to the first tick at the spot, the toasts | QUEUE.md §License heal | 2026-10-18 |
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
| rewind-sweep `visual-choices` (dev app, 2026-10-18) | FLASH on the list (`rewind__board`) and its rows at each view change; SNAP of the list and its off-screen rows one frame later; JITTER ≤ 4 px on each row; FLASH of a cover to 0.3 | the reveal: the list holds blank while it reloads, then lifts, and the first screen's rows enter on the wave (4 px rise) and covers fade in from `--art-in-from`. `motionReport` in `sweep-helpers.mjs` takes these out; a row that shows, fades and enters again (V1, fixed) still fails |

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

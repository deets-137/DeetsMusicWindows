---
status: sop
desk_test: none
sources: [scripts/shots.mjs, scripts/webview-eval.mjs, docs/ops/checks/drop.mjs]
updated: 2026-10-01
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
| [drop.mjs](drop.mjs) | drive script | `net <s>`: the webview offline and the Apple check held out for s seconds, on one CDP socket. `battery on\|off`: the page's `BatteryManager.charging` and a `chargingchange`. Prints the ring lines the drop caused | DESK-TESTS.md §1 (a network drop, held; unplug on a desktop) | 2026-10-01 |

**drop.mjs, how to use it.** A network cut does nothing to a song MusicKit has buffered, so seek
past the buffer while it holds: `deetsmusic --port <dev bridge> --token <bridgeToken> seek 85%`
(the token is in `%APPDATA%\com.deetsmusic.dev\settings.json`). Only the webview goes offline;
Rust keeps its network. The battery override tests the `charging` fact and the rules on it, not
the hardware: a real unplug on a laptop stays the owner's test.

## 3. Limits

- A shots list runs in headless Edge, not WebView2: its frame rates are not a verdict (the `@N Hz`
  can read wrong). Judge smoothness by `[perf] frames` on `npm run dev:built` (DEBUGGING.md).
- The demo's MusicKit is fake: no real playback, no network, no song change failure.
- A strip shows what moved and when. Whether it looks right is the owner's eye.

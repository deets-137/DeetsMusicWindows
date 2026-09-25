---
status: built
desk_test: passed 2026-09-24
sources: [demo/shim.ts, demo/handlers.ts, demo/musickit.ts, demo/catalog.ts, vite.demo.config.ts, scripts/demo-publish.mjs, scripts/publish-update.mjs]
updated: 2026-09-21
---
# DeetsMusic — Web demo

A copy of the real UI that runs in a browser on deets.solutions, with mock tracks. Visitors
can try the look before they install. It also serves as a portfolio piece.

> **Status (2026-09-21): BUILT on branch `demo-time`** (this repo, and a local `demo-time` in
> `../DeetsSolutions`, not pushed). §9 = as built; where it differs from §2–§6, §9 is the code.
> Desk test §10 PASSED 2026-09-24. **Open (his ask, 2026-09-24):** make the album light more
> prominent in the demo (§10, after the list). Not designed yet: the forks go to him first.

**Terms:**
- **Demo** — the web page at `deets.solutions/deetsmusic/demo`.
- **Shim** — the browser code that replaces the Rust back-end and MusicKit.
- **Web build** — `vite build --mode web`: the real `src/` with the shim in place of Tauri.

## 1. Decisions (the owner, 2026-09-21)

| fork | choice |
|---|---|
| 1. How to build it | **A** — the real `src/` with a web build flag and the shim. Not a static snapshot. |
| 2. Scope | **A** — all three surfaces (mini / midi / max), every skin and theme, Compass, Settings (look rows only). |
| 3. Sound | **A** — a silent timer. The progress bar and the Press record still move. |
| 4. Where it lives | **A** — `deets.solutions/deetsmusic/demo`, linked from the download page. |
| 5. The frame (2026-09-21) | A plain box drawn in each skin's own card style, set inside the deets.solutions page layout. |
| 6. The copy step (2026-09-21) | Part of `npm run release:publish`, if it can be done without hassle. Else by hand. |
| 7. Hover hints (2026-09-21) | True to the app. No "desktop only" hint; visitors know it is a demo. |

The doc lives in this repo because the code does. `../DeetsSolutions` only receives the
built output.

## 2. The seam (measured 2026-09-21)

- 40 files import from `@tauri-apps/*`: `api/core` (39), `api/event` (13), `api/window` (4),
  `api/app` (1), `plugin-opener` (1).
- 180 distinct `invoke` command names.
- MusicKit is configured in one place: `src/player.ts:124`.
- `src/shell/` (the Linux port adapter) does not exist yet. The web build does not wait for it.

So the seam is the module import, not each call site. In the web build, Vite aliases each
`@tauri-apps/*` module to a file in `src/web/`. No card or engine file changes.

## 3. The shim

1. **`src/web/core.ts`** — `invoke(cmd, args)` looks up a handler table. Each command the demo
   reaches gets a handler that reads or writes an in-memory store seeded from
   `src/web/mock-catalog.json`. An unknown command logs once and returns an empty result of
   the right shape, so a card shows its empty state, not an error.
2. **`src/web/event.ts`** — `listen` / `emit` on a local event bus.
3. **`src/web/window.ts`** — a fake window. A surface change resizes a framed box in the page,
   not the browser window.
4. **MusicKit** — `window.MusicKit` is a fake object with the same calls `player.ts` uses:
   `play`, `pause`, `seekToTime`, `setQueue`, `skipToNextItem`, the playback-state and
   time events. A timer drives `currentPlaybackTime`. No audio element.
5. **Settings** — the real settings store over `localStorage`, under a `demo:` prefix.
   Only the look rows show. The other sections are hidden in the web build.

## 4. The mock catalog

- About 60 tracks over 8 albums and 5 artists, all invented names.
- Covers: generated with the app's own playlist cover styles (Letters, Mosaic, Note), or free
  art with a known license. No real album art. No Apple name, logo or badge anywhere.
- Enough rows for the Library list to scroll and for Home to fill its shelves.

## 5. Desktop-only parts

The tray, keep on top, AirPlay, Last.fm, rooms, Friends, deep links, the updater and sign-in.
Their controls stay visible and keep the app's own hover hints (fork 7). A click does nothing, or opens the same panel the app shows before sign-in.

## 6. The page

- A frame around the app surface, a surface switch (mini / midi / max), and a Download button.
- `npm run demo:build` writes `dist-web/`. `release:publish` copies it into `../DeetsSolutions/deetsmusic/demo/` (fork 6).
- The release check builds the web target too, so the demo cannot silently break.

## 7. Open before build

Every fork in §1 is closed. The build found one more: Settings shows every section (§9.7).

## 8. Desk test

See §10.

## 9. As built (2026-09-21)

**No file in `src/` changed.** Everything is new files, plus four small edits outside `src/`:
`package.json` (three scripts), `.gitignore` (`dist-web`), `scripts/publish-update.mjs` (the
copy step) and this doc.

### 9.1 The seam is one global, not an alias
`@tauri-apps/api` reaches Rust only through `window.__TAURI_INTERNALS__` (`invoke`,
`transformCallback`, `metadata`) and `window.__TAURI_EVENT_PLUGIN_INTERNALS__`. The shim
defines both, so every import — core, event, window, app, opener — works as it is. No Vite
alias. Events (`listen` / `emit`) run on a local table in the shim. §2's alias plan is dropped.

### 9.2 Files
| file | job |
|---|---|
| `demo/shim.ts` | The two Tauri globals, the fake `window.MusicKit` and its `musickitloaded`, the host-page bridge, the network guard. Runs before `main.ts`. |
| `demo/handlers.ts` | One handler per command the demo reaches. An unknown command answers `null` and logs once at debug level. Results are cloned, so the app can never change the store by mutating a result. |
| `demo/musickit.ts` | The fake MusicKit: `setQueue` (items, songs, station), play / pause / stop / seek, next / previous, `changeToMediaAtIndex`, `playNext` / `playLater`, `queue.splice`, the four events, `PlaybackStates`, `MediaItem`. A 250 ms timer moves the clock. At the end of the window it reports no item and `completed`, like MusicKit. An unknown id rejects with MusicKit's "could not be resolved" text, so the app's dead-id path still works. |
| `demo/catalog.ts` | 5 artists, 8 albums, 60 songs, 3 live + 15 genre stations, 2 Apple playlists, 3 starting local playlists. Every name is invented. Covers and artist portraits are SVG data URLs drawn in code, with `{w}{h}{f}` in the URL fragment so the app's template fill works unchanged. |
| `vite.demo.config.ts` | The real `index.html`, served with the MusicKit CDN script removed, the shim added before `main.ts`, and a head script that seeds the app's look from the site's. `base: "./"`, out to `dist-web/`. It fails the build if `index.html` changes shape. |
| `scripts/demo-publish.mjs` | Builds, then copies `dist-web/` to `../DeetsSolutions/deetsmusic/demo/app/`. With `--push` it also commits that folder on DeetsSolutions `master` and pushes (§9.8). |
| `demo/tsconfig.json`, `demo/env.d.ts` | `tsc -p demo` typechecks the demo against the real `src/` types. |

### 9.3 What the visitor starts with
- Signed in to Apple Music, so the first-run walk opens at step 2 (walk.ts' own rule).
- Now Playing holds "Honey Static" with its album in Up Next (a seeded queue snapshot).
- Two weeks of seeded plays, so Home, History, Rewind and play counts are not empty.
- Every change (playlists, ♥, pins, row order, queue, plays) is kept in the visitor's
  localStorage under `deets.demo.store`. The app's own settings keep their real `deets.*` keys.
  The demo has its own origin path on the site and the site's keys use `deets-`, so nothing
  collides. §3.5's `demo:` prefix is dropped.

### 9.4 What stays at the desktop
- Cross-origin `fetch` is refused and `WebSocket` is a socket that fails at once. So Start a
  room and Friends fail with the app's own offline wording, and the demo can never reach
  `rooms.deets.solutions` or `musicfriends.deets.solutions`.
- Export to Apple, Import, Add to an Apple playlist and the playlist web reject with a plain
  reason, and the app shows its own failure toast.
- AirPlay finds no speakers. Last.fm shows "Not connected". Updates show "up to date".

### 9.5 The host page (`../DeetsSolutions/deetsmusic/demo/`)
- `index.html`: the site header, a page bar with *App page* (→ `/deetsmusic/`) and *GitHub*
  (→ the public repo), his line, *Start over*, and the frame: a `.dm-box` (the site's own card)
  holding an iframe of `app/index.html`. No size buttons (his call, 2026-09-21): the app's own
  walk and the cog's N guide a visitor.
- `demo.js`: the app's `set_size` reaches the page as a `resize` message, and the frame takes
  that size. A page narrower than the app scales the iframe down, so a phone sees the whole
  window. **The app's theme and skin reach its box only** (his call, 2026-09-21): the box gets
  `data-theme` / `data-skin`, and because the site's tokens hang on any element with those
  attributes, only the box changes. *Start over* clears the `deets.` keys and reloads, so the
  walk starts again.
- `strings.js`: every string, approved by him 2026-09-21 (no `[ph]` left).
- `styles/main.css`: one `.dmd-*` block, tokens only.

### 9.8 A release updates the live demo (his call, 2026-09-21)
`release:publish` on the live channel ends with `demo-publish.mjs --push`: build, copy to
`../DeetsSolutions/deetsmusic/demo/app/`, commit that folder alone on `master`
("DeetsMusic demo: the build from X"), push. The push deploys deets.solutions. Guards: it
runs only when DeetsSolutions is on `master` and fast-forwards cleanly; it stages nothing
outside `app/`; an unchanged build commits nothing. When a guard stops it, the files are
still copied, the publish still stands, and it says why. Retry: `npm run demo:publish -- --push`.
A new back-end command answers `null` in the demo until it gets a handler in
`demo/handlers.ts`, so a new feature can look empty there until then.

### 9.6 Checked in a browser (2026-09-21, Chrome)
Boot, Now Playing, the Queue, Home shelves, Library, Playlists, Search card mounted, Play and
the clock, the song-end advance with the Queue following, a Library row click, a skin switch
followed by the host page, the Compass, and each of the four sizes resizing the frame
(Mini 385×550, Player 405×675, Midi 495×670, Max 1100×950, scaled to the column).

### 9.7 Differences from the plan, for the owner
- **Settings shows every section,** not only the look rows (fork 2A). Hiding sections needs a
  change in `src/settings-card.ts` or CSS aimed at its markup. Both touch the app, which this
  build avoided. Rows that need the desktop act as they do in the app. **Open fork.**
- **Hover hints are the app's own** (fork 7), and so are its failure toasts for desktop-only
  actions.

## 10. Desk test — **PASSED 2026-09-24**

> **Next (his ask, 2026-09-24):** the album light should be more prominent in the demo. Forks to
> bring him before any build: which light (the Ocean album light, OCEAN.md; the album-colored
> aurora, ALBUM-COLOR.md; or both), and how (a higher demo default, a demo that opens on the
> Ocean skin, or covers with stronger colors in `demo/catalog.ts`).
1. `npm run demo` → open the printed URL. The launch cover lifts. Now Playing shows Honey Static.
   The walk shows step 2.
2. Press Play. The scrubber moves and the Press record turns. Press Next: the Queue follows.
3. Open Library, click a song. It plays. Open an album from Home: the collection pane opens.
4. Search "rain". Songs, albums and stations appear.
5. Make a playlist, add two songs, reload the page. The playlist is still there.
6. Change the skin and the theme. Change the surface from the title menu.
7. Ctrl+Space: the Compass opens. Open Settings.
8. Title bar › Listening room › Start a room: it fails with the app's own wording.
9. `npm run demo:publish`, then serve `../DeetsSolutions` (`npx http-server -p 1431 -c-1 -s .`
   in that folder) and open `/deetsmusic/demo/`. Change the surface in the app: the frame takes
   each size. Change the app's skin: only its box changes. Make the browser narrow: the app
   scales down. *Start over* resets the demo and the walk.

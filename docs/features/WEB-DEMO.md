---
status: built
desk_test: passed 2026-09-24
sources: [demo/boot.ts, demo/shim.ts, demo/handlers.ts, demo/diary.ts, demo/musickit.ts, demo/catalog.ts, vite.demo.config.ts, scripts/demo-publish.mjs, scripts/publish-update.mjs]
updated: 2026-10-23
---
# DeetsMusic — Web demo

A copy of the real UI that runs in a browser on deets.solutions. Since 2026-10-12 its songs
are the owner's Songs of the Day, with Apple's previews (§15). Visitors can try the look
before they install. It also serves as a portfolio piece.

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

> Since 2026-10-12 the songs are the owner's Songs of the Day, with Apple's covers (§15).

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
| `demo/diary.ts` | The Diary's commands on `deets.demo.diary`, with the sample entries (§12). |
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
  attributes, only the box changes. **Only a look the site draws** (his call, 2026-10-21): a
  theme or skin id that is not in the site's own lists (`DeetsAppearance.axes` in
  `js/controls.js`) is not copied, and the box takes the page's own look. Happy is the first
  (the site gets it when it is ported); a user's own mod skin is the reason. *Start over* clears the `deets.` keys and reloads, so the
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

## 11. The album light is wired (2026-09-26)
> **Part:** built · 2026-09-26 · desk test open

**The cause.** His ask (§10) was a stronger album light. The demo had none: its
`album_palette` handler answered `null`, so the NP aurora, the album text, the tray and the
Ocean's glow and neon all fell back to the theme.

**The fix.** `album_palette` now finds the cover by its URL in the mock catalog (songs, albums,
stations) and returns the colors the cover was drawn with: `bg` = `bgColor`, `c1` / `c2` =
`textColors`. The app's own rule (`auroraSlots`, `albumColor`) picks the rim from those.

The rim each album gets (OKLCH chroma; below 0.04 reads as grey):

| Album | Rim | Chroma |
|---|---|---|
| Neon Parable | #ff3864 | 0.231 |
| After Hours Atlas | #c77dff | 0.193 |
| Night Drive Almanac | #9d0208 | 0.178 |
| Low Tide Radio | #ffd166 | 0.135 |
| Paper Boats | #bc6c25 | 0.130 |
| Honey Static (the start song) | #e0a458 | 0.117 |
| Salt & Signal | #0b2545 | 0.068 |
| Rainy Day Ledger | #22223b | 0.046 |

**His calls (2026-09-26):** Ocean's Album light starts at **80** in the demo (the app's own
default stays 0). The two muted covers stay as they are: real albums are muted too. The seed
is in `vite.demo.config.ts` (the head script, beside the look seed). It writes `oceanLight`
into `deets.settings` only while the visitor has no value, so their own change stays, and
*Start over* (which clears `deets.*`) brings back 80.

**Desk test.**
1. `npm run demo` in a fresh browser profile. Now Playing (Honey Static) wears an amber aurora.
   On Glass the title and subtext take the album's colors.
2. Play Neon Parable: the aurora turns pink and cyan.
3. Change to Ocean: the crests already glow in the album's color. Settings › Skin settings ›
   Album light reads 80. Set it to 30 and reload: it stays 30.

## 12. The Diary in the demo (2026-09-26)
> **Part:** built · 2026-09-26 · desk test open

Before this, the demo had no Diary handlers: every `diary_*` command answered `null`, and the
card could not read its list. `demo/diary.ts` now answers every Diary command from
`deets.demo.diary` in localStorage, with the rules of `diary.rs`: an entry is found by its album
key (catalog id, then library id, then name), a note or a score marks a song written, a scale
change alone keeps the scores, a rescale multiplies them, a deleted folder leaves its entries,
and `diary_export` gives the same text as `export_text`.

**The sample entries (his call: samples, not empty).** A visitor starts with:
| Album | State | Scale | Album score | Songs written | Folder |
|---|---|---|---|---|---|
| Neon Parable | Completed, 9 days ago | 10 | 8.5 | 8 of 8, notes on 5 | Night drives |
| After Hours Atlas | In progress, 2 days ago | 5 | none yet | 3 of 6, notes on 2 | none |

Honey Static, the song that plays when the demo opens, has no entry, so the Diary's playing
album box reads "Listening now" and a click starts one. The note texts are in `SAMPLES`.

**Desk test.**
1. `npm run demo`, open the Diary. In progress holds After Hours Atlas; Completed and the
   Night drives folder hold Neon Parable. The top row shows Honey Static, "Listening now".
2. Open Neon Parable: the album note, the 8.5/10 pill, a note under each song you pick.
   Right-click the tile › Export, and paste: the export text.
3. Click the Honey Static box: a new entry opens. Write a note, go back, reload the page: it
   is still there.
4. *Start over* on the site page: the Diary is back to the two samples.

## 13. No "Rewind unlocked" on a fresh visit (2026-09-26)

The seeded plays pass Rewind's 50 starts at once, so every fresh visit and every *Start over*
showed "Rewind unlocked: your listening, ranked…" over the page (found by the Shots runner,
SHOTS.md). His call: fix it. `vite.demo.config.ts` now writes `rewindAutoShown: true` and
`rewindCard: true` while the visitor has no value of their own: the result of the unlock
(stats.ts), without its notice. The same "only while unset" rule as Album light (§11).
Since 2026-10-10 the second key is `hiddenCards: []` (Settings › Cards, HIDE-CARDS.md).

It reaches deets.solutions with the next `release:publish` (§9.8), or `npm run demo:publish
-- --push`.

**Desk test.** `npm run demo`, clear the `deets.` keys (or *Start over*), reload: no toast.
The Rewind card is on the slot menus.

## 14. The shots runner as host; the files handler (2026-09-28)

- **`user_files_list` answers an empty list** (`demo/handlers.ts`). The 0.25.1 files feature
  had no demo handler, so every load logged `[files] list TypeError` (found by the shots
  console record, SHOTS.md §5b). The same §9.8 rule: a new command needs its handler.
- **With no host frame, `post()` calls `window.__deetsDemoHost`** (`demo/shim.ts`). Nothing
  on the site sets it, so a visitor sees no change. The shots runner sets it, so a clip can
  follow the app's own `set_size` and record a surface change (SHOTS.md §5c).

Neither reaches deets.solutions until the next `release:publish` (§9.8).

## 15. The songs are his Songs of the Day (2026-10-12)
> **Part:** built · 2026-10-12 · desk test open (§15.8)

The invented catalog (§4) is gone. The demo plays the owner's own Songs of the Day: the rows
of the site's journal feed (`/sotd/songs.json`, DeetsOTD.md §1b) that he posted. Real covers,
real names, and Apple's 30-second preview when a visitor presses Play.

### 15.1 His calls (2026-10-12)
| fork | choice |
|---|---|
| Where the real songs go | **Everywhere.** No mock catalog stays, the shots runner included. |
| Sound | **Apple's 30-second preview** on Play. |
| Where the songs come from | **The live feed**, read when the page loads. |
| Which songs | **Only his picks** (author "Deets"). No friend's pick and no friend's name. |
| The Apple link | **A panel beside the frame**: Apple's badge, then the song, artist and album. |
| What the feed does not fill | **Built from his picks**: playlists, stations, artist pictures, the Diary sample. |
| A feed that does not load | **A copy built into the demo** at build time. |

Why the panel: Apple lets a developer use a preview "only to promote store content", and a
sample must sit "proximate to a store badge" (the iTunes Search API terms). Right-click ›
Copy Link exists in the demo too, but it copies the link; it is not a badge beside the sound.

### 15.2 The feed
- `demo/catalog.ts` fetches `/sotd/songs.json` (same origin on the site; 4 s limit) and keeps
  the rows with `author: "Deets"`. The author field goes no further.
- The song and album ids come from each row's `apple_music_url` (`…/album/<slug>/<album>?i=<song>`),
  so Copy Link and the panel's badge open the real song. A song picked twice keeps its latest day.
- The cover URL becomes a template (`…/600x600bb.jpg` → `…/{w}x{h}bb.{f}`), so the app asks
  Apple's image server for the size it draws.
- The feed has no artist id. An artist's id is a stable number made from the name, so Copy
  Link on an artist gives a link that does not open (§15.7).
- **The copy built in (fork 7A):** `vite.demo.config.ts` makes the module `virtual:sotd-picks`
  from `../DeetsSolutions/sotd/songs.json`: his rows only, only the fields the demo reads.
  `demo:build` fails when the file is missing or has no picks of his.
- **The dev server** (`npm run demo`, and the shots runner) serves `/sotd/songs.json` from the
  same file, so a dev run reads the feed the same way the site does.

### 15.3 The start
The catalog waits for the feed (a top-level `await`), and `main.ts` must not run before it.
`demo/boot.ts` now takes `main.ts`'s place in the page: it loads the shim (which loads the
catalog), then `main.ts`. `main.ts` starts on `DOMContentLoaded`, which a slow feed lets pass,
so `boot.ts` sends that event to `window` again when it already passed. The demo build targets
ES2022 for the `await`.

### 15.4 Sound, the clock, the album light
- **The preview** plays on an `<audio id="apple-music-player">`, MusicKit's own element id, so
  the Press record reads its exact clock (VINYL.md) and the Sound graph can route it: Apple's
  preview server sends `Access-Control-Allow-Origin: *` and the element is `crossorigin`.
- **The song's length in the player is the preview's (30 s)**, so the bar and the song end
  agree with what the visitor hears. Lists still show the real length from the feed.
- `music.volume` reaches the element, so the app's volume, duck and fades work.
- A browser that refuses the sound pauses the player. A preview that does not load plays the
  song silent on the old timer.
- **The album light:** the feed has no palette, so `album_palette` reads a 48 px copy of the
  cover and runs the rule a user's own picture uses (`paletteFromPixels`, album-slots.ts).
  Apple's image server allows the read. One read per cover per visit. Stations keep drawn covers.

### 15.5 The Apple Music panel (`../DeetsSolutions/deetsmusic/demo/`)
- The shim posts `nowplaying` with the song (title, artist, album, `music.apple.com/song/<id>`)
  on each song change and play state, and once at start with the song the saved queue opens on.
- `demo.js` fills the panel: Apple's badge (`listen-on-apple-music.svg`, downloaded from
  Apple's marketing tools, not redrawn), then the title, the artist and the album. The badge
  links to the song. No song: no panel.
- It sits beside the frame when the app fits beside it at full size, else it wraps below.
  Max is wider than the room beside it on most screens, so there the panel is below the frame
  (he found it there, 2026-10-13). It takes the app's theme and skin, like the frame.
- The iframe has `allow="autoplay"`. Its alt text is one `[ph]` string in `strings.js`.

### 15.6 What I decided inside his calls (for his review)
- **Opens on** the newest pick, with the 11 picks before it up next.
- **Playlists:** one Apple playlist, *Songs of the Day* (every pick, newest first). Three local
  playlists, one per top genre (*Pop Picks*, *Alternative Picks*, *R&B/Soul Picks*).
- **Stations:** *Deets Live* (every pick, shuffled), *Fresh Picks* (the last 30 picks),
  *Throwbacks* (released before 2020). One station per top-5 genre (*Pop Picks* …). A song's
  own station plays the picks of its genre. Station covers stay drawn.
- **Artists:** the picture is the cover of their latest pick; the genre is their most-picked one.
- **The Diary samples** sit on the two albums with the most picks (never the playing one). The
  notes say nothing about the music: "Every song here was a Song of the Day. Done, and I still
  come back to it." and "In progress. A score as I go."; the folder is *Favorites*.
- **Seeded plays** lean on the last 30 picks. **Recently Added** is the day each song was picked.
- **The New shelf** is albums released this year or last.
- The visitor's store (`deets.demo.store`) and Diary (`deets.demo.diary`) went to v2, so an old
  visit with the invented songs starts over.
- `catalog_heals` got a demo handler (an empty answer); every load warned without it.

### 15.7 Limits, and what is still his
- **The page's lede** (`strings.js`, his words) says "everything mocked". **It stays (his call,
  2026-10-17):** "mocked" means the app, not the songs: the demo plays previews, not full songs,
  and has no sign-in, AirPlay, rooms or the rest.
- **Artist links** from right-click › Copy Link do not open: the feed has no artist id. Adding
  `artist_id` to the feed is a DeetsOTD change, which he decided to keep untouched (DeetsOTD.md §7).
- **Lyrics and writer credits** are empty: the feed has neither.
- **The shots runner now loads covers and previews from Apple** (no longer "no network"), and its
  pictures change as he posts picks. `docs/ops/checks/album-mark.json` types "American Teen"
  since 2026-10-17 (his 5 picks, 4 songs; its menu step moved to row 3, because the demo seeds
  row 4, "Location", as a favorite); all 4 shots pass. `docs/guide/shots.json`
  (`max-full-player`, the website's Demos picture) still types "Salt & Signal", and the site's
  48 Demos pictures still show the invented catalog of 2026-10-11. **Fine for now (his call,
  2026-10-17).** At the next re-shoot, the shot needs a new album: his pick, a cover with no
  printed title.
- **Opened directly** at `/deetsmusic/demo/app/` (no host page), a preview plays with no badge.
  The site links only the page with the frame.
- **On deets.solutions since 2026-10-13** (his call): the site files (`demo.js`, `index.html`,
  `strings.js`, `styles/main.css`, the badge) and the demo build in `app/`.

### 15.8 Desk test
1. `npm run demo`. Now Playing opens on the newest Song of the Day, with Apple's cover.
2. Press Play: the preview sounds; the bar runs to 0:30; the next pick follows.
3. Volume, Pause, Seek and Next act on the sound. Press › the record turns with it.
4. Ocean or Glass: the album light takes the cover's colors.
5. Search an artist from the feed; open an album; right-click › Copy Link opens the song.
6. Radio: *Deets Live*, *Fresh Picks*, *Throwbacks* and the genre stations play picks.
7. Diary: two sample entries on real albums.
8. On the site page (`npm run demo:build`, then the page with `app/` from `dist-web/`): the
   panel shows the song beside the frame; the badge opens it on Apple Music; a narrow page puts
   the panel below.
9. Block `/sotd/songs.json` (DevTools › Network › block): the demo still loads, from the copy.

## 16. No grand opening on a first visit (2026-10-23)

> **Part:** built · 2026-10-23

- His call: a visitor gets the first-run tour, not the grand opening. `demo/shim.ts` writes
  `deets.settings` = `{ openingPending: false }` when the visitor has no settings yet, before
  the app loads. The store keeps a value already there (`seedOnboarding`), so the visit is
  still a first run (the tour, the New marks), and `initOnboarding` finds nothing pending.
  No file in `src/` names the demo (§9). The Compass's Onboarding row still opens the page.

**Desk test:** a private window on the demo: the cards rise, Deets and Happy walk to the
wordmark; no grand opening. Ctrl+Space › Onboarding opens it.

---
status: designed
desk_test: none
sources: [src/player.ts, vite.config.ts]
updated: 2026-09-21
---
# DeetsMusic — Web demo

A copy of the real UI that runs in a browser on deets.solutions, with mock tracks. Visitors
can try the look before they install. It also serves as a portfolio piece.

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

None. Every fork is closed (§1).

## 8. Desk test

Not written yet. It is written with the build.

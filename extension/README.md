# DeetsMusic browser extension

One toolbar button. On a YouTube or YouTube Music page it reads the song you're
watching, asks the DeetsMusic app to look it up on Apple Music, and shows the top
match with its cover, title, artist, album, and a **+** that adds it to your library.

It never touches Apple directly. All credentials stay in the app; the extension only
talks to DeetsMusic over loopback (`127.0.0.1`, port 47825–47828); the app trusts the
extension's `Origin` header, so there is nothing to pair.
Design + protocol: [`docs/EXTENSION.md`](../docs/EXTENSION.md).

## Install (unpacked, until it's on the Web Store)

Open `install.html` in a browser — the DeetsMusic installer offers it, and the app's
title menu → **Extension → Install guide…** opens it too. Short version:

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Pin **DeetsMusic**.
3. Done — with DeetsMusic running, click the button on a YouTube video.

## Layout

```
manifest.json          MV3, Chrome-first (activeTab + scripting + storage; deliberately
                       NO host_permissions — one would strip the Origin header the app
                       pairs on, see docs/EXTENSION.md §3)
src/common/shared.js   settings, bridge client, title heuristics, log
src/readers.js         page readers injected on click (YouTube DOM, MAIN world, YT Music)
src/bg/service-worker.js  opens settings on first install; otherwise idle
popup/                 the flow: find app → read tab → resolve → "+"
options/               connection check, look (follow the app / pick), debug panel
styles/                COPIED from ../src/styles by scripts/pack.cjs — never edit here
icons/                 rendered from ../app-icon.png
install.html           load-unpacked walkthrough (self-locating; opened by the installer)
```

## Develop

- Edit, then **Reload** on `chrome://extensions`. The popup reads the page only when
  clicked, so there's nothing to restart on the YouTube side.
- Settings → **Debug** shows, in the popup, what was read from the page, the query, the
  candidates with scores, the extension log, and the app's bridge log.
- `node extension/scripts/pack.cjs --styles-only` re-syncs the token CSS after a change in
  `src/styles/`; without the flag it also stages + zips `extension/dist/deetsmusic-<v>.zip`.

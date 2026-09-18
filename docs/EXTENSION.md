# Browser extension + the local bridge

> Design agreed 2026-09-08. Status: **built and user-tested** (the first test is what
> produced the `host_permissions` fix in §3). Code: `extension/` (MV3, Chrome-first),
> `src-tauri/src/bridge.rs` (loopback server + the now-playing hub), `src/np-bus.ts`
> (main-window half of the hub). Last checked against the app **2026-09-17** (v0.9.5):
> routes unchanged, skin list current (Cyber), token CSS re-synced, `manifest.version`
> now tracks the app.

## 1. What it is

A toolbar button (DeetsFilm lineage — popup only, **no injected DOM, no visuals on the
page**). On a YouTube `/watch` page or in YouTube Music it reads the song, asks the
DeetsMusic app to look it up on Apple Music, and shows the top match — cover, title,
artist, album — with an explicit **+** that adds the *song* (not the music video) to the
user's library. Nothing happens without the click: no page reads before it, no adds
without the **+**.

## 2. Architecture — the app does the Apple work (fork A)

```
YouTube tab ──executeScript──▶ popup ──HTTP 127.0.0.1:47825──▶ DeetsMusic (bridge.rs)
                                                                 ├─ catalog_search (songs)
                                                                 ├─ apple_add_to_library
                                                                 └─ emit library-changed → np-bus reloads the store
```

Why: every Apple call needs the developer token (signed from the private `.p8`) and the
Music User Token. Neither belongs in an extension. So the extension only ever says
"I'm looking at *this*"; search, ranking and the add reuse `apple.rs` untouched. The
Library card refreshes in place after an add. Cost per add: **one catalog search + one
library POST**; no polling, no background traffic.

Rejected: (B) the extension talking to Apple itself — needs the dev token copied around
and a second MusicKit sign-in in the browser; (C) A with B as fallback — overkill.

## 3. Trust model

- Loopback only. Fixed port list `47825–47828` (`bridge::PORTS`), first free one wins;
  the extension probes the same list (last-known port first).
- **No pairing code (decided 2026-09-09).** A request is *the extension* when its
  `Origin` is `chrome-extension://` / `moz-extension://` — the browser sets that header
  and a web page can't forge it. CORS echoes only that origin; a web page gets no CORS
  header at all.
- **The manifest must NOT declare `host_permissions` for `127.0.0.1` (2026-09-09).**
  A host permission makes the popup's fetch a privileged, non-CORS request and Chrome
  then attaches **no `Origin` header at all** — so the only credential vanishes and every
  call is `401 unpaired` (first user test: `bridge.log` showed `GET /health paired=false`
  on every popup open). Without the permission the fetch is a genuine CORS request,
  Chrome sends the `Origin`, and the preflight branch below answers it. `activeTab` +
  `scripting` still cover reading the page, so nothing else is lost. The preflight also
  replies `Access-Control-Allow-Private-Network: true` for Chrome's private-network
  check. Accepted cost: any *native* process on the PC could forge the header
  and add songs / read now-playing — nothing sensitive leaks (no Apple tokens; adds are
  add-only). Rejected: the copy-paste code (friction for a low-stakes surface) and a
  Bluetooth-style Allow prompt (needs a dialog primitive the app doesn't have).
- The `bridge_token` in `<app_data>/settings.json` is kept only as a `curl` alternative
  (`Authorization: Bearer …`) for the debug routes; no UI shows it any more.
- `/health` is unauthenticated on purpose (liveness); `paired` is now always true for
  the extension and only false for an origin-less caller without the token.

## 4. Routes (`bridge.rs`)

| Route | Auth | Body → Reply |
|---|---|---|
| `OPTIONS *` | – | CORS preflight (+ `Allow-Private-Network`) |
| `GET /health` | – | `{ok, app:"DeetsMusic", version, connected, paired, theme, skin}` |
| `POST /resolve` | ✓ | `{title, artist?, album?, source?, url?}` → `{candidates:[{track, inLibrary, score, artworkUrl}]}` (top 3) |
| `POST /add` | ✓ | `{track}` *or* `{album}` → `{ok}`; an album fetches its tracks first (fork A, like the app's menu); emits `library-changed` to the app |
| `POST /search` | ✓ | `{term}` → `{songs:[candidate (score 0)], albums:[{album, artworkUrl}]}` — the popup's mini Search card |
| `GET /now-playing` | ✓ | the hub snapshot (what the tray panel sees) |
| `GET /log` | ✓ | text — the bridge ring log |

Errors: `401 unpaired`, `409 not connected to Apple Music`, `502` Apple failure, `400` bad
JSON. The same server carries the agent/CLI routes (`/play`, `/queue`, `/settings`, `/query`,
`/grow`, `/go`, …); those are [AGENT.md](AGENT.md)'s table, and the extension calls none of them. `theme`/`skin` come from `appearance_publish` (main.ts calls it on every theme/skin
change) so the popup mirrors the app's look by default (options: "Follow DeetsMusic").

### Ranking
`term = "{artist} {title}"` (title only when no artist; retried title-only if the combined
term finds nothing). Each song scores `0.65·dice(title) + 0.35·dice(artist)` on
normalised word sets; top 3 returned, sorted. The popup shows the first; **"Not it? Search instead"** slides open a **mini Search
card** (the app's `.search__*` recipe — songs as rows, albums as a tile scroller, each with
its own **+** / ✓) seeded with the other candidates; typing hits `/search` (debounced
300 ms). A row click makes that song the match up top. `inLibrary` = the id is a synced
`source='library'` row (albums have no membership check — ✓ is session-only after an add).

**Live re-read (2026-09-09):** while the popup is open it re-reads the tab every 2 s
(`executeScript`, no network) and re-resolves when title/artist change; the header's ↻
re-runs the whole flow. Header order: brand · source badge · ↻ · ⚙.

## 5. Reading the page (`extension/src/readers.js`)

Injected with `chrome.scripting.executeScript` under `activeTab` when the popup opens —
no content script, no host permission for YouTube, nothing runs otherwise.

1. **Structured credits win.** YouTube's description "Music" section (rows SONG / ARTIST /
   ALBUM) is read from the DOM (`ytd-video-description-music-section-renderer`, expanded
   rows *or* the collapsed compact card) **and** from the MAIN world (`ytd-watch-flexy`'s
   watch-next data → `videoDescriptionMusicSectionRenderer`), the latter only when its
   `videoId` matches the URL (SPA staleness guard).
2. **Fallback: title heuristic** (`DM_SHARED.parseTitle`). Strips the usual noise
   (`(Official Video)`, `[4K]`, `| channel`, `#tags`…), splits `Artist - Title`, treats a
   `… - Topic` channel as the artist, otherwise uses the channel name unless it looks like a
   label/VEVO account.
3. **YouTube Music**: `ytmusic-player-bar` title + byline (artist · album).

The popup's source badge says which path fired (`YouTube · credits` / `YouTube` /
`YouTube Music`).

## 6. Install + packaging

- The extension ships **inside the NSIS installer** as `$INSTDIR\extension\` (Tauri
  `bundle.resources`). `src-tauri/nsis/hooks.nsh` (`NSIS_HOOK_POSTINSTALL`) asks
  *"Also set up the DeetsMusic browser extension?"* and opens `extension/install.html`.
  **Asked at most once per PC (2026-09-14):** not on an updater or silent install, not once
  the extension has reached the app (`bridge.rs` writes `extension-connected` into the app data
  folder on the first extension request), and not after a No (the hook writes
  `extension-declined`; delete it to be asked again). An update needs no extension step: the
  loaded unpacked extension reads `$INSTDIR\extension`, and the browser takes the new files at
  its next start.
  That file now holds two more macros — `PREINSTALL` / `PREUNINSTALL` stop the bundled CLI,
  which otherwise locks its own exe against the installer ([RELEASE.md](RELEASE.md) §3).
- **Chrome refuses to auto-install anything outside the Web Store**, so `install.html` is a
  themed load-unpacked walkthrough that locates its own folder (copy buttons for the path and
  `chrome://extensions`). The app's Settings card → **Extension → Install guide…** opens the same
  page (`bridge_open_install_page`; repo path in dev, resource dir when installed).
- `node extension/scripts/pack.cjs` re-syncs the token CSS from `src/styles/` and zips
  `extension/dist/deetsmusic-<v>.zip` for a Web Store upload. **Web Store publication is the
  user's step** (developer account, listing); once live, replace the walkthrough with the store link.
- Firefox: not yet (Chrome-first MV3).
- **`manifest.version` tracks the app's version** (0.9.5 from 2026-09-17; it was left at
  0.1.0 until then). It is not a fifth file for the release check — the extension is not
  rebuilt per release — but set it before any Web Store upload.
- **The token CSS in `extension/styles/` goes stale on its own.** Nothing fails loudly: the
  popup keeps the values from the last sync, so a new skin token or a changed one (Glass
  `--glass-tint` was the 2026-09-17 case) silently misses the popup. Re-sync with
  `node extension/scripts/pack.cjs --styles-only` whenever `src/styles/` changes shape.

## 7. Debug

- Popup → Settings → **Debug**: what was read (raw title, channel, credits), the query, the
  candidates with scores, the extension log, and a button that pulls the app's `/log`.
  **Copy report** bundles it all.
- App: Settings card → **Extension → Copy bridge log**; the same ring is also written to
  `<app_data>/deetsmusic.log` (rolling, [LOGGING.md](LOGGING.md)). Every request, resolve, ranking and add is a line.
- `curl` from the machine works with the settings.json `bridge_token` (or by faking the
  header: `-H "Origin: chrome-extension://x"`):
  `curl -H "Authorization: Bearer <token>" http://127.0.0.1:47825/now-playing`.

## 8. Open / later
- **Polling: none.** `/health` (which carries theme/skin) is hit once per popup open and
  once per options-page "Test connection"; the service worker never talks to the app.
- Web Store listing (user). Firefox manifest pass.
- Auto-add on an exact-match setting ("trust exact matches") — deliberately not in v1;
  Apple adds are irreversible from the API.
- Music-video results as a secondary candidate type (song-only for now, as agreed).

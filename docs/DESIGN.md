---
status: foundation
desk_test: none
sources: []
updated: 2026-09-17
---
# DeetsMusic — Design Doc

> Living document. We design on paper here first, then build against it.
> Status legend: ✅ decided · 🔵 proposed (awaiting your call) · ⬜ not yet discussed

---

## 0. What it is

A lightweight Apple Music player for Windows with **two surfaces**:

- **Full window** — the main app: browse, search, library, now-playing, queue.
- **Mini player** — a compact floating player that appears when the full window is minimized.

---

## 1. Decided so far ✅

| Area | Decision |
|---|---|
| Platform | Windows 11, Tauri v2 + WebView2 |
| Frontend | Vanilla TypeScript (no framework) |
| Backend | Rust (Tauri) |
| Playback | MusicKit JS inside the webview — the only DRM-sanctioned full-song path on Windows |
| Auth | Apple Developer Token (Rust-signed JWT, ES256, `.p8`) + Music User Token |
| Form factor | Two surfaces: full window + mini player on minimize |
| Process | Design on paper first, then build slowly, piece by piece |

### ✅ Closed technical risk (full-song DRM playback works in WebView2 — proven, in use since 2026-07)
Full-song DRM playback via MusicKit JS in **WebView2** is not formally supported by Apple
and depends on the runtime's EME/DRM components. We will prove this with a throwaway test
page before investing in the real UI.

> **Update (2026-06-27):** We **decoupled data from playback**. Fetching the library is
> plain REST (no DRM), so the whole data layer is built and working without touching
> this risk. DRM playback remains unsolved and is the gate for the *player*, not the
> *library*. See [HANDOFF.md](HANDOFF.md) and [DATA-ARCHITECTURE.md](architecture/DATA-ARCHITECTURE.md).
>
> Also discovered: the in-app webview **can't open OAuth popups** (Tauri/WebView2), so
> sign-in runs through the user's real browser via a loopback flow — now our permanent
> auth approach.

---

## 2. Decision agenda (we'll go one at a time)

- **A. v1 feature scope** — ✅ start at **Player + Library**, grow feature by feature
- **B. Information architecture** — screens & navigation of the full window ⬜
- **C. Mini player behavior** — trigger, size, always-on-top, contents, how to return ⬜
- **D. Visual identity** — Apple-like vs. its own look; theme; density ⬜
- **E. Data model** — entities, what's cached locally vs. fetched live ⬜
- **F. Technical architecture** — window model, webview/Rust split, IPC, storage, SMTC, hotkeys ⬜
- **G. Apple credentials** — what you need to pull from your Developer account ⬜

---

## A. v1 feature scope ✅

**Nucleus: Player + Library.** We grow outward (Search, Browse, Lyrics, …) feature by feature,
you directing priority. Catalog search is the expected first expansion.

### Feature backlog — Player + Library

Status: ✅ done · 🔵 designing · ⬜ todo · ❄️ deferred to later

**Playback (the player core)**
| # | Feature | Status |
|---|---|---|
| P1 | Auth — sign in / sign out (Apple Music) | ✅ (loopback browser flow) |
| P2 | Transport — play / pause | ✅ (MusicKit JS in WebView2; full-song DRM works) |
| P3 | Skip next / previous | ✅ (native skip within the fed window) |
| P4 | Seek / scrub + time display | ✅ (drag-to-seek scrubber; elapsed / remaining labels in max and the mini player view) |
| P5 | Volume | ✅ (titlebar pill, the max stage row, the tray panel; per-speaker AirPlay volume) |
| P6 | Shuffle | ✅ the mode (2026-09-15, [NEXT-VERSION §14](NEXT-VERSION.md); Settings › Playback › Button is perma-shuffle, off = the 2026-07-02 one-shot, [FUTURE-SETTINGS §5](FUTURE-SETTINGS.md)) |
| P7 | Repeat (off / all / one) | ✅ 2026-09-15 — [NEXT-VERSION §12](NEXT-VERSION.md) |
| P8 | Now Playing display (artwork, title, artist, album) | ✅ (cover / title / artist / album, album-colored text on Glass, ♥ and + squares) |
| P9 | Queue — view upcoming, play-next, reorder, remove | ✅ (Queue card: jump, drag-reorder, remove, Play Next / Add to Queue, cross-card drag and drop, restore across launches — [QUEUE.md](features/QUEUE.md)) |

**Library**
| # | Feature | Status |
|---|---|---|
| L1 | Saved songs | ✅ (synced to SQLite, windowed list, sort / view / search, ♥ filter, click to play) |
| L2 | Saved albums → open → play | ✅ open → Play / Shuffle in the toolbar, or click a song (2026-09-15, [NEXT-VERSION §13](NEXT-VERSION.md)); real album art ✅; artist photos see L3 |
| L3 | Saved artists → open | ✅ artist page with round photo, Albums, Featured / Your Playlists shelves, Popular / Most Played sorts ([ARTIST-VIEW.md](features/ARTIST-VIEW.md)); the Artists *overview* still shows initials (HANDOFF "Real album/artist data") |
| L4 | Playlists — list → open → play | ✅ (Apple mirror + local store, folders, covers, export / import — [PLAYLISTS.md](features/PLAYLISTS.md)) |
| L5 | Add / remove from library (like) | ✅ add ([FAVORITES.md](features/FAVORITES.md)) and ♥ favorites; **remove is not possible** (the Apple Music API is add-only) |
| L6 | Sort / filter within a view | ✅ (sort keys + asc/desc + substring search, client-side) |

**Cross-cutting (not screens, but real work)**
| # | Feature | Status |
|---|---|---|
| X1 | Mini player surface (on minimize) | ✅ mini surface (Mini \| Player views), tray flyout, Keep on top ([TRAY.md](features/TRAY.md)) |
| X2 | SMTC — Windows media overlay + media keys | ✅ native session (`smtc.rs`, 2026-09-10) |
| X3 | Global hotkeys | ✅ media keys via SMTC. In-app keys: Ctrl+K / Q / L / P / , summon cards; **Ctrl+Space opens the Compass** (COMPASS.md: any card, setting, verb or library item from the keyboard) and **Space plays / pauses** (built 2026-09-17); **arrows, Enter, the Menu key and Escape work in every list** (list-keys.ts, built 2026-09-17); open: the popovers' arrows (HANDOFF "polished keyboard control") |
| X4 | **CLI / local-agent control** | ✅ the `deetsmusic` CLI + MCP server, 16 tools, Settings › Connections ([AGENT.md](integrations/AGENT.md)) |

*Order we design/build these = your call (see chat).*

> **Refreshed 2026-09-15.** The table above is the original v1 backlog with its status brought
> up to date. The live state of play is [HANDOFF.md](HANDOFF.md); the feature backlog with
> forks is [NEXT-VERSION.md](NEXT-VERSION.md). Not planned because the platform cannot do
> them: lyrics, crossfade, Sound Check, remove from library (NEXT-VERSION, the review header).

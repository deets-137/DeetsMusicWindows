---
status: foundation
desk_test: none
sources: []
updated: 2026-10-14
---
# DeetsMusic — Design Doc

> The first design doc (2026-06), kept for the product intent and the v1 scope. Every area in
> §2 is decided; each now lives in its own doc. The state of play is [HANDOFF.md](HANDOFF.md).
> Status legend: ✅ decided · 🔵 proposed (awaiting your call) · ⬜ not yet discussed

---

## 0. What it is

A lightweight Apple Music player for Windows. It started as **two surfaces** (a full window and
a mini player on minimize). It has **three** now, one window that changes size
([SURFACES-AND-CARDS.md](architecture/SURFACES-AND-CARDS.md)):

- **Mini** — a compact player, with a Player view and the tray flyout ([TRAY.md](features/TRAY.md)).
- **Midi** — Now Playing and two card slots: browse, search, library, queue.
- **Max** — the stage column (Now Playing and the Queue) and a grid of cards.

---

## 1. Decided so far ✅

| Area | Decision |
|---|---|
| Platform | Windows 11, Tauri v2 + WebView2 |
| Frontend | Vanilla TypeScript (no framework) |
| Backend | Rust (Tauri) |
| Playback | MusicKit JS inside the webview — the only DRM-sanctioned full-song path on Windows |
| Auth | Apple Developer Token (Rust-signed JWT, ES256, `.p8`) + Music User Token |
| Form factor | Mini, Midi and Max: one window in three sizes (was: full window + mini player) |
| Process | Design on paper first, then build slowly, piece by piece |

### ✅ Closed technical risk (full-song DRM playback works in WebView2 — proven, in use since 2026-07)
Full-song DRM playback via MusicKit JS in **WebView2** is not formally supported by Apple
and depends on the runtime's EME/DRM components. The first playback slice proved that it
works: full songs play in WebView2, with the Music User Token injected into MusicKit JS
(HANDOFF.md › Key decisions).

> **Update (2026-06-27):** We **decoupled data from playback**. Fetching the library is
> plain REST (no DRM), so the whole data layer was built without touching this risk. See
> [HANDOFF.md](HANDOFF.md) and [DATA-ARCHITECTURE.md](architecture/DATA-ARCHITECTURE.md).
>
> Also discovered: the in-app webview **can't open OAuth popups** (Tauri/WebView2), so
> sign-in runs through the user's real browser via a loopback flow — now our permanent
> auth approach.

---

## 2. Decision agenda (we'll go one at a time)

Every area is decided. B to G were settled as the app was built; each one's doc is named.

- **A. v1 feature scope** — ✅ start at **Player + Library**, grow feature by feature
- **B. Information architecture** — ✅ cards in slots on three surfaces
  ([SURFACES-AND-CARDS.md](architecture/SURFACES-AND-CARDS.md))
- **C. Mini player behavior** — ✅ the Mini surface, the tray flyout, Keep on top
  ([TRAY.md](features/TRAY.md))
- **D. Visual identity** — ✅ its own look: palette → theme → skin tokens, five skins
  ([UI-ARCHITECTURE.md](architecture/UI-ARCHITECTURE.md))
- **E. Data model** — ✅ the normalized model and the SQLite cache
  ([DATA-ARCHITECTURE.md](architecture/DATA-ARCHITECTURE.md))
- **F. Technical architecture** — ✅ Rust normalizes, the webview plays; SMTC in `smtc.rs`
  (HANDOFF.md › Key decisions, File map)
- **G. Apple credentials** — ✅ the `.p8` key and IDs in `src-tauri/secrets/`; the release mint
  through DeetsSupport ([RELEASE.md](ops/RELEASE.md) §0)

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
| P6 | Shuffle | ✅ the mode (2026-09-15, [NEXT-VERSION §14](archive/NEXT-VERSION.md); Settings › Playback › Button is perma-shuffle, off = the 2026-07-02 one-shot, [FUTURE-SETTINGS §5](FUTURE-SETTINGS.md)) |
| P7 | Repeat (off / all / one) | ✅ 2026-09-15 — [NEXT-VERSION §12](archive/NEXT-VERSION.md) |
| P8 | Now Playing display (artwork, title, artist, album) | ✅ (cover / title / artist / album, album-colored text on Glass, ♥ and + squares) |
| P9 | Queue — view upcoming, play-next, reorder, remove | ✅ (Queue card: jump, drag-reorder, remove, Play Next / Add to Queue, cross-card drag and drop, restore across launches — [QUEUE.md](features/QUEUE.md)) |

**Library**
| # | Feature | Status |
|---|---|---|
| L1 | Saved songs | ✅ (synced to SQLite, windowed list, sort / view / search, ♥ filter, click to play) |
| L2 | Saved albums → open → play | ✅ open → Play / Shuffle in the toolbar, or click a song (2026-09-15, [NEXT-VERSION §13](archive/NEXT-VERSION.md)); real album art ✅; artist photos see L3 |
| L3 | Saved artists → open | ✅ artist page with round photo, Albums, Featured / Your Playlists shelves, Popular / Most Played sorts ([ARTIST-VIEW.md](features/ARTIST-VIEW.md)); the Artists *overview* still shows initials (HANDOFF "Real album/artist data") |
| L4 | Playlists — list → open → play | ✅ (Apple mirror + local store, folders, covers, export / import — [PLAYLISTS.md](features/PLAYLISTS.md)) |
| L5 | Add / remove from library (like) | ✅ add ([FAVORITES.md](features/FAVORITES.md)) and ♥ favorites; **remove is not possible** (the Apple Music API is add-only) |
| L6 | Sort / filter within a view | ✅ (sort keys + asc/desc + substring search, client-side) |

**Cross-cutting (not screens, but real work)**
| # | Feature | Status |
|---|---|---|
| X1 | Mini player surface (on minimize) | ✅ mini surface (Mini \| Player views), tray flyout, Keep on top ([TRAY.md](features/TRAY.md)) |
| X2 | SMTC — Windows media overlay + media keys | ✅ native session (`smtc.rs`, 2026-09-10) |
| X3 | Global hotkeys | ✅ media keys via SMTC. In-app keys: Ctrl+K / Q / L / P / , summon cards; **Ctrl+Space opens the Compass** (COMPASS.md: any card, setting, verb or library item from the keyboard) and **Space plays / pauses** (built 2026-09-17); **arrows, Enter, the Menu key and Escape work in every list** (list-keys.ts, built 2026-09-17); the Sort / View pops take the arrows; open: arrow keys inside the right-click menus (they answer Escape only) |
| X4 | **CLI / local-agent control** | ✅ the `deetsmusic` CLI + MCP server, 21 tools, Settings › Connections ([AGENT.md](integrations/AGENT.md)) |

> **Refreshed 2026-10-14.** The table above is the original v1 backlog with its status brought
> up to date. Everything in it is built. What is open now is HANDOFF.md › Open now; the
> 2026-09 feature batches are in [archive/NEXT-VERSION.md](archive/NEXT-VERSION.md). Not planned
> because the platform cannot do them: lyrics, crossfade, Sound Check, remove from library
> (NEXT-VERSION.md, the listening-loop review).

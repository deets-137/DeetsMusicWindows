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

### ⚠️ Open technical risk (to validate before heavy build)
Full-song DRM playback via MusicKit JS in **WebView2** is not formally supported by Apple
and depends on the runtime's EME/DRM components. We will prove this with a throwaway test
page before investing in the real UI.

> **Update (2026-06-27):** We **decoupled data from playback**. Fetching the library is
> plain REST (no DRM), so the whole data layer is built and working without touching
> this risk. DRM playback remains unsolved and is the gate for the *player*, not the
> *library*. See [HANDOFF.md](HANDOFF.md) and [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md).
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
| P2 | Transport — play / pause | ⬜ |
| P3 | Skip next / previous | ⬜ |
| P4 | Seek / scrub + time display | ⬜ |
| P5 | Volume | ⬜ |
| P6 | Shuffle | ⬜ |
| P7 | Repeat (off / all / one) | ⬜ |
| P8 | Now Playing display (artwork, title, artist, album) | ⬜ |
| P9 | Queue — view upcoming, play-next, reorder, remove | ⬜ |

**Library**
| # | Feature | Status |
|---|---|---|
| L1 | Saved songs | 🔵 (synced to SQLite cache + listed; needs play/art/sort) |
| L2 | Saved albums → open → play | ⬜ |
| L3 | Saved artists → open | ⬜ |
| L4 | Playlists — list → open → play | ⬜ |
| L5 | Add / remove from library (like) | ⬜ |
| L6 | Sort / filter within a view | ⬜ |

**Cross-cutting (not screens, but real work)**
| # | Feature | Status |
|---|---|---|
| X1 | Mini player surface (on minimize) | ⬜ |
| X2 | SMTC — Windows media overlay + media keys | ⬜ |
| X3 | Global hotkeys | ⬜ |

*Order we design/build these = your call (see chat).*

# DeetsMusicWindows

A lightweight **Apple Music player for Windows 11** — Tauri v2 + WebView2, a vanilla
TypeScript front end, and a Rust back end, with full DRM playback and a token-driven
theming system.

**Status:** working build — playback, sign-in, and library sync all work; release
packaging unfinished · **Platform:** Windows 11 desktop (Tauri v2)

Not to be confused with [DeetsMusic](https://github.com/deets-137/DeetsMusic), the
separate SwiftUI iOS app. This is the Windows port, and it shares no code with it.

> **New here? Read [docs/HANDOFF.md](docs/HANDOFF.md) first** — cold-start guide
> (state, how to run, next steps).

## What it does

- **Full DRM playback** through MusicKit JS v3 running in WebView2, with a live-synced
  native queue model, gapless manual queueing, and drag-to-reorder
- **Apple Music sign-in** via a loopback browser flow — a `tiny_http` server catches
  the redirect locally
- **Library sync** into a local SQLite cache, so browsing doesn't hit the network
- **Feature surfaces:** Library, Search, Playlists, Queue, History, Rewind, and Radio
  (Apple stations plus seeded right-click "Start Station")
- **6 themes × 5 skins**, frameless custom chrome, all driven from CSS tokens

## How the Apple Music integration works

The Rust side mints an **ES256 developer-token JWT** from a MusicKit private key
(`src-tauri/src/apple.rs`), then injects MusicKit JS into the WebView so DRM-protected
audio decodes inside the browser engine rather than in Rust. User sign-in is a separate
OAuth-style flow producing a music-user token. Library, catalog enrichment, and playlist
reads/writes go to `api.music.apple.com` over `reqwest`.

## Stack

**Tauri v2** (Rust) + **WebView2** · **vanilla TypeScript** + **Vite**, no framework ·
**SQLite** via `rusqlite` · `reqwest` · `jsonwebtoken` · `tiny_http`

## Prerequisites

- Rust (`x86_64-pc-windows-msvc`) + **Visual Studio 2022 Build Tools** (Desktop
  development with C++ — provides `link.exe`)
- Node + npm
- An **Apple Developer** MusicKit key — see
  [`src-tauri/secrets/README.md`](src-tauri/secrets/README.md)

## Running it

```bash
npm install
npm run tauri dev     # first Rust build is slow
```

## Documentation

[docs/HANDOFF.md](docs/HANDOFF.md) — status, gotchas, next steps ·
[docs/DESIGN.md](docs/DESIGN.md) — product design and backlog ·
[docs/UI-ARCHITECTURE.md](docs/UI-ARCHITECTURE.md) — themes, skins, panels, chrome ·
[docs/DATA-ARCHITECTURE.md](docs/DATA-ARCHITECTURE.md) — auth, model, provider, cache

## Layout

- `index.html`, `src/` — front end (TypeScript + the token CSS system in `src/styles/`)
- `src-tauri/` — Rust (auth, provider/model, SQLite cache)
- `swatch.html` — standalone theme/color reference

## Notes

Toward v1: a settings surface, release packaging, SMTC/media-key integration, and
mini/maximized window surfaces. There is no installer yet — it runs from `tauri dev`.

## License

[MIT](LICENSE)

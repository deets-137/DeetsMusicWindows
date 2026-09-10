# DeetsMusicWindows

A lightweight **Apple Music player for Windows 11** — Tauri v2 + WebView2, a vanilla
TypeScript front end, and a Rust back end, with full DRM playback and a token-driven
theming system.

**Status:** installable — playback, sign-in, and library sync all work; shipping as a
per-user NSIS installer (0.1.3) · **Platform:** Windows 11 desktop (Tauri v2)

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
- **6 themes × 4 skins**, frameless custom chrome, all driven from CSS tokens
- **Tray-first window behavior** — a tray-click flyout, minimize-to-tray, and a single
  running instance however you launch it
- **Agent control** — a `deetsmusic` CLI and MCP server over a loopback bridge, plus an
  MV3 browser extension that sends what you're watching to your library

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
npm run release       # build the installer → installers/DeetsMusic_<version>_x64-setup.exe
```

## Documentation

[docs/HANDOFF.md](docs/HANDOFF.md) — status, gotchas, next steps ·
[docs/DESIGN.md](docs/DESIGN.md) — product design and backlog ·
[docs/UI-ARCHITECTURE.md](docs/UI-ARCHITECTURE.md) — themes, skins, panels, chrome ·
[docs/DATA-ARCHITECTURE.md](docs/DATA-ARCHITECTURE.md) — auth, model, provider, cache ·
[docs/RELEASE.md](docs/RELEASE.md) — build, install, uninstall ·
[docs/TRAY.md](docs/TRAY.md) — tray, panel, window lifecycle ·
[docs/AGENT.md](docs/AGENT.md) — the CLI / MCP surface

## Layout

- `index.html`, `src/` — front end (TypeScript + the token CSS system in `src/styles/`)
- `src-tauri/` — Rust (auth, provider/model, SQLite cache, tray, loopback bridge)
- `cli/` — the `deetsmusic` CLI + MCP server
- `extension/` — the MV3 browser extension
- `swatch.html` — standalone theme/color reference

## Notes

Toward v1: a settings surface, SMTC/media-key integration, and the mini/maximized window
compositions. The installer is **unsigned**, so SmartScreen warns on first run, and there is
no auto-updater — each release is a fresh installer, archived locally
([docs/RELEASE.md](docs/RELEASE.md)).

## License

[MIT](LICENSE)

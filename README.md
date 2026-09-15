# DeetsMusicWindows

A lightweight **Apple Music player for Windows 11** — Tauri v2 + WebView2, a vanilla
TypeScript front end, and a Rust back end, with full DRM playback and a token-driven
theming system.

**Status:** installable — playback, sign-in, and library sync all work; shipping as a
per-user NSIS installer (0.4.1) · **Platform:** Windows 11 desktop (Tauri v2)

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
- Optional: an **Apple Developer** MusicKit key, to sign tokens locally in a dev build —
  see [`src-tauri/secrets/README.md`](src-tauri/secrets/README.md). Without one, a dev build
  fetches its token the same way the installed app does.

To use the app, you do not need any of this. You need Windows 11, an Apple Music
subscription, and the installer ([docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md)).

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
[docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md) — what each version brings, and how to install ·
[docs/RELEASE.md](docs/RELEASE.md) — build, install, uninstall ·
[docs/TRAY.md](docs/TRAY.md) — tray, panel, window lifecycle ·
[docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) — connect Claude Desktop, Claude Code, Cursor, or a terminal (plain words) ·
[docs/AGENT.md](docs/AGENT.md) — the CLI / MCP surface ·
[docs/ideas/](docs/ideas/) — feature ideas that are **not built**

## Layout

- `index.html`, `src/` — front end (TypeScript + the token CSS system in `src/styles/`)
- `src-tauri/` — Rust (auth, provider/model, SQLite cache, tray, loopback bridge)
- `cli/` — the `deetsmusic` CLI + MCP server
- `extension/` — the MV3 browser extension
- `swatch.html` — standalone theme/color reference

## Notes

The roadmap is in [docs/HANDOFF.md](docs/HANDOFF.md). Releases after 0.4.3 are
**Authenticode-signed** (publisher *Aditya Sundaram*), and since 0.4.3 the app **updates
itself** from `music-api.deets.solutions`, with each installer checked against a signature
compiled into the app. How builds are signed, published and updated:
[docs/RELEASE.md](docs/RELEASE.md) ("The release pipeline at a glance").

## Privacy

- **Apple.** Sign-in, your library, search and playback go straight to Apple
  (`api.music.apple.com` and MusicKit). Your Apple sign-in token stays on your PC.
- **The access key.** The app needs an Apple Music developer token. It fetches one from
  `music-api.deets.solutions/token` about once a week. That request carries the app
  version only. The server keeps a daily count of tokens it gives out. It does not store
  your IP address, the token, or anything about you.
- **The log.** The app writes a log file on your PC (Settings › Bugs › App log). It
  redacts tokens, and names catalog ids instead of song titles. It leaves your PC only
  when you send a bug report with Attach log on (Settings › Bugs). The app shows the
  exact text before it sends, and a report goes to `support.deets.solutions` with the
  app version. A suggestion never carries the log.
- **Your playlists.** Playlists you make in DeetsMusic are stored on this PC only. A new
  PC or a reinstalled Windows starts without them. To keep a copy, use Apple Music ▸
  Export to Apple Music on the playlist.
- **Nothing else.** No analytics, no listening history leaves your PC.

## Trademarks

Apple Music is a trademark of Apple Inc., registered in the U.S. and other countries.
DeetsMusic is an independent project. It is not affiliated with, sponsored by, or
endorsed by Apple.

## License

[MIT](LICENSE)

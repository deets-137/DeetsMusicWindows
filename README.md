# DeetsMusic

A lightweight **Apple Music player for Windows 11** — Tauri v2 + WebView2, a vanilla
TypeScript front-end, and a Rust back-end. Designed to be deeply themeable (and, in
time, "skinnable") with a small, variable-driven UI system.

> **New here? Read [docs/HANDOFF.md](docs/HANDOFF.md) first** — it's the cold-start
> guide (state, how to run, next steps).

## Status (2026-06-27)
- ✅ Frameless custom chrome, 3 themes + skin system, settings menu
- ✅ Apple Music sign-in (loopback browser flow), library **songs** synced to a local
  SQLite cache and listed in the Library card
- ⬜ Playback (DRM unknown), albums/artists/playlists data, search, mini/full surfaces

## Stack
- **Tauri v2** (Rust) + **WebView2**, Windows 11
- **Vanilla TypeScript** + **Vite** front-end (no framework)
- **SQLite** (`rusqlite`) library cache, **reqwest** for the Apple Music API

## Prerequisites
- Rust (`x86_64-pc-windows-msvc`) + **Visual Studio 2022 Build Tools** (Desktop
  development with C++ — provides `link.exe`)
- Node + npm
- An **Apple Developer** MusicKit key — see [`src-tauri/secrets/README.md`](src-tauri/secrets/README.md)

## Run
```bash
npm install
npm run tauri dev     # opens the app (first Rust build is slow)
```

## Documentation
- [docs/HANDOFF.md](docs/HANDOFF.md) — status, how to run, gotchas, next steps
- [docs/DESIGN.md](docs/DESIGN.md) — product design & feature backlog
- [docs/UI-ARCHITECTURE.md](docs/UI-ARCHITECTURE.md) — themes, skins, panels, chrome
- [docs/DATA-ARCHITECTURE.md](docs/DATA-ARCHITECTURE.md) — auth, model, provider, cache

## Layout
- `index.html`, `src/` — front-end (TS + the token-based CSS system in `src/styles/`)
- `src-tauri/` — Rust (auth, provider/model, SQLite cache)
- `swatch.html` — standalone theme/color reference

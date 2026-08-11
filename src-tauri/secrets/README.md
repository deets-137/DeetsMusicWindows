# Local Apple Music credentials

Drop your credentials here for local development. **Nothing real in this folder is
committed** — `.gitignore` excludes `*.p8` and `apple.json`. Only `apple.example.json`
and this README are tracked.

## What goes here

1. Your **`.p8`** MusicKit private key, e.g. `AuthKey_YYYYYYYYYY.p8`.
2. A copy of `apple.example.json` named **`apple.json`**, filled in:

```json
{
  "teamId": "XXXXXXXXXX",            // 10-char Apple Team ID
  "keyId": "YYYYYYYYYY",             // 10-char Key ID (matches the .p8)
  "privateKeyFile": "AuthKey_YYYYYYYYYY.p8"
}
```

The Rust side reads `apple.json`, loads the `.p8` next to it, and signs the Apple
Music **developer token** (ES256 JWT). The private key never leaves Rust / never
reaches the frontend.

A third file, **`user-token.txt`**, is written after your first sign-in: it's the
Music User Token captured by the loopback browser auth flow, persisted so later
launches start already signed in. You never create it by hand, and it's gitignored
like the rest. It now lives in app data rather than this folder (see below); delete
it to force a fresh sign-in.

## Dev vs. installed builds

`secrets_dir()` (`src/apple.rs`) checks **two** locations, in order:

1. `%APPDATA%\com.deetsmusic.app\secrets\` — used if it contains an `apple.json`.
2. **This folder**, baked in at compile time via `CARGO_MANIFEST_DIR`.

So `npm run tauri dev` works off this folder with no setup, exactly as before. An
**installed** build (`npm run tauri build`) falls back to a path frozen at compile
time pointing at whoever's machine built it — fine while the repo stays put,
useless anywhere else. To make an install self-contained, copy this folder to
location 1:

```powershell
Copy-Item -Recurse src-tauri\secrets "$env:APPDATA\com.deetsmusic.app\secrets"
```

The captured **user token** is different: it's runtime state, not something you
authored, so it is always written to `%APPDATA%\com.deetsmusic.app\user-token.txt`
regardless of which secrets dir won. A `user-token.txt` still sitting in this
folder from before that change is read once, re-persisted to app data, and can
then be deleted.

## Where to get these

- **Team ID** — developer.apple.com/account → Membership (top-right, 10 chars).
- **Key ID + .p8** — Certificates, Identifiers & Profiles → Keys → create a key with
  **MusicKit** enabled → download the `.p8` (one-time) and note the Key ID.

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

## Where to get these

- **Team ID** — developer.apple.com/account → Membership (top-right, 10 chars).
- **Key ID + .p8** — Certificates, Identifiers & Profiles → Keys → create a key with
  **MusicKit** enabled → download the `.p8` (one-time) and note the Key ID.

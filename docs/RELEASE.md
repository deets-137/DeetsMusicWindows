# Release, install, uninstall

> Status: **the installer line is live** — 0.1.0 → 0.1.3 shipped, 0.1.3 is the first build
> whose installer stops the bundled CLI (below). Code: `package.json` (`release` script),
> `scripts/cli-dist.mjs`, `scripts/archive-installer.mjs`, `src-tauri/nsis/hooks.nsh`,
> `src-tauri/tauri.conf.json` (`bundle`).

House pattern, shared with DeetsAirplay / DeetsRGB: a hand-built **NSIS** installer, per-user,
no admin prompt, no auto-updater. Each shipped setup exe is kept in a local `installers/`
archive.

## 1. Cut a build

Three files hold the version and **must agree**: `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`. Tauri names the installer from `tauri.conf.json`;
`scripts/archive-installer.mjs` looks for it using `package.json`. A mismatch fails the
archive step with a message that says to check all three — deliberately, because the
alternative is an installer that silently never gets archived.

```bash
npm run release     # cli:build → tauri build → archive-installer
```

Three stages, and the order matters:

1. **`npm run cli:build`** — `cargo build --release` on `cli/`, then `scripts/cli-dist.mjs`
   stages the exe at `cli/dist/deetsmusic.exe`, where `bundle.resources` expects it.
   **`tauri build` alone ships the PREVIOUS CLI**, with no warning. Always use `npm run release`.
2. **`tauri build`** — bundles the front end into the exe, then runs `makensis`.
   ~3 min cold, ~1 min warm. Output:
   `src-tauri/target/release/bundle/nsis/DeetsMusic_<version>_x64-setup.exe` (~5.6 MB at 0.1.3).
3. **`scripts/archive-installer.mjs`** — copies that exe into `installers/`.

`installers/` is **gitignored** (~6 MB each), exactly as DeetsAirplay does it. The difference
is that DeetsAirplay fills it by hand and its archive drifted — 0.1.0 sitting in the folder
while the app said 0.1.1 — so here the copy is a build stage instead of a habit.

The archive earns its keep because `src-tauri/target/` is the only other copy, and
`cargo clean` takes it.

## 2. What ships inside

| Path after install | Source | Notes |
|---|---|---|
| `DeetsMusic.exe` | `src-tauri` release build | The app. `mainBinaryName` in `tauri.conf.json` — without it the exe takes the Cargo package name. |
| `cli\deetsmusic.exe` | `cli/dist/` via `bundle.resources` | The agent CLI + MCP server ([AGENT.md](AGENT.md)). |
| `extension\` | `extension/` via `bundle.resources` | Unpacked MV3 source + `install.html` ([EXTENSION.md](EXTENSION.md) §6). |
| `uninstall.exe` | NSIS | Also registered under Installed apps. |

Install root is `%LOCALAPPDATA%\DeetsMusic` (`installMode: currentUser`). User data lives
elsewhere and survives: `%APPDATA%\com.deetsmusic.app` holds `deetsmusic.db`,
`user-token.txt`, `settings.json`, `bridge.log`.

## 3. The NSIS hooks

`src-tauri/nsis/hooks.nsh` supplies three macros that Tauri splices into the generated
installer:

- **`NSIS_HOOK_PREINSTALL`** and **`NSIS_HOOK_PREUNINSTALL`** — stop the bundled CLI.
- **`NSIS_HOOK_POSTINSTALL`** — offer the browser extension walkthrough
  ([EXTENSION.md](EXTENSION.md) §6).

### Why the CLI has to be stopped (2026-09-09)

Tauri's template closes the **app** before it writes or deletes files. It knows nothing about
the CLI beside it, and that CLI is long-lived in practice: `deetsmusic mcp` serves an MCP
session for as long as the agent runs. Windows will not replace or delete a file a process
holds open.

What that actually cost, on the 0.1.2 → 0.1.3 changeover: uninstalling 0.1.2 removed the
registry entry and then failed on `cli\deetsmusic.exe`, leaving **every file on disk** while
Windows reported the app as not installed. A half-uninstall. An upgrade fails the same way,
more quietly — a new app paired with a stale CLI.

The macro matches **by path** (`$INSTDIR\cli\*`), not by image name. `target\debug\deetsmusic.exe`
carries the same name, and an uninstall has no business killing a dev build.

Two quoting traps, both invisible until an install fails: `$$_` is how NSIS emits a literal
`$_` for PowerShell, and `$\'` is how it emits a single quote — double quotes would close
PowerShell's own `-Command "…"` string.

## 4. Install

```bash
installers/DeetsMusic_<version>_x64-setup.exe
```

No admin prompt. Adds a Start Menu entry (right-click → *Pin to taskbar*) and the uninstaller,
then offers the extension walkthrough.

- The installer is **unsigned**, so SmartScreen warns on first run (*More info → Run anyway*).
  Silencing it needs a code-signing certificate.
- **Secrets**: an installed build looks in `%APPDATA%\com.deetsmusic.app\secrets\` first and
  falls back to the compile-time repo path. Copy `src-tauri/secrets/` there to make the install
  self-contained — see `src-tauri/secrets/README.md`.
- A dev build may keep running through an install; it lives in `target/debug` and nothing
  touches it. It does share the installed build's identifier and data dir, though — see
  [TRAY.md](TRAY.md) §6 on the single-instance guard, and use `npm run dev:app` to separate them.

## 5. Uninstall

```bash
"$LOCALAPPDATA/DeetsMusic/uninstall.exe"        # add /S for no prompts
```

Or Settings → Installed apps. The `PREUNINSTALL` hook stops the CLI first.

User data is **not** part of the install root, so this leaves it. Remove it deliberately:

```bash
rm -rf "$APPDATA/com.deetsmusic.app"
```

That costs the sign-in, the library cache (Apple calls to rebuild) and the extension pairing
token (re-pair needed). Keep the folder for an ordinary reinstall; delete it to test the
first-run path.

If a half-uninstall ever happens again — no registry entry, files still present — the
uninstaller is still on disk and can be re-run, or the folder deleted directly.

## 6. Why there is no updater

`tauri-plugin-updater` would need a signing key pair, a hosted `latest.json`, a public host
for the installer, a capability entry, and a check in the app. The blocker is hosting: the
updater fetches its manifest unauthenticated, so a private GitHub repo cannot serve it.

Deferred on cost/benefit while the user is the only installer. The cheap half — keeping every
shipped setup exe — is already automatic (§1). Revisit when someone else installs the app.

One thing an updater would not escape: it runs the same NSIS installer, so it meets the same
open-file rules, and the `PREINSTALL` hook is what makes that survivable.

## 7. Distributing a usable build — the developer token

> Decided 2026-09-09: **long token lifetime · open endpoint, rate-limited by IP · the dev
> seam keeps local signing.** Not built yet; this section is the build order.

### The problem

`developer_token()` (`apple.rs`) signs an ES256 JWT from a MusicKit `.p8`, and a MusicKit key
needs a **paid Apple Developer membership**. So today the app only runs for someone who has
their own key. A working public binary would have to carry the `.p8` — which is exactly the
file that must never ship.

So a **Cloudflare Worker mints the token instead**, on `deets.solutions` infrastructure. The
key becomes a Worker secret and never leaves Cloudflare.

### What this buys, and what it cannot

It cannot verify that the caller really is DeetsMusic. Anything shipped in a public binary
can be extracted, including any secret it would use to prove itself. There is no client
attestation for an open-source desktop app, so the endpoint is deliberately **open**, and
honest about it.

What it does buy, which is enough:

- **The `.p8` never ships.** The whole point.
- **Tokens expire**, so a leaked one dies without revoking the key.
- **A kill switch, rate limits and usage visibility**, all changeable without a new release.

It also stays clean on privacy: the Worker only mints developer tokens. Sign-in remains the
local loopback flow and the **music-user token never leaves the machine**, so the Worker sees
no user data at all. Say that plainly wherever the app is published.

### The one implementation constraint

`developer_token()` is **synchronous and called ~25 times** — `apple.rs`, `enrich.rs`,
`library.rs`, `playlists.rs`, and `player.ts` through the `apple_developer_token` command.
Today each call re-signs locally, which costs microseconds.

A Worker fetch per call would put a network round-trip in front of every Apple request. So
the token **must be cached**: fetched once, held in a `static`, persisted to app data with its
expiry. `developer_token()` stays sync and reads that cache, and **all ~25 call sites stay
untouched**. Anything else turns a small change into an async refactor of the whole Apple layer.

### Repo 1 — the Worker (new sibling repo)

Mirrors **DeetsAccounts** exactly, which is the house pattern for a Worker: its own repo, **no
`package.json` and no dependencies**, plain `src/index.js`, a commented `wrangler.jsonc`, and a
subdomain route. The static site repo holds no Worker code.

```
DeetsMusicToken/           (name + subdomain are the user's call)
  wrangler.jsonc           name, main, compatibility_date, ALLOWED_ORIGINS
  src/index.js             one GET route, plain WebCrypto
  README.md                setup + deploy, in the accounts-setup.md style
```

- **Signing**: WebCrypto `importKey("pkcs8", …)` with `ECDSA` / `P-256`, then `sign` with
  `SHA-256`. Its output is raw `r||s`, which is **already** what JWS ES256 wants — no DER
  unwrapping. Zero dependencies, so the no-dependency rule holds.
- **Stateless**: sign per request. No D1, no KV. Long-lived tokens make caching pointless, and
  a per-request signature avoids handing every client one shared token with one shared expiry.
- **Secrets** — `npx wrangler secret put APPLE_P8`, `… TEAM_ID`, `… KEY_ID`. The `.p8` is
  pasted as a secret; it is never committed, exactly as in this repo.
- **Rate limiting by IP** is a Cloudflare **Rate Limiting rule on the route**, set in the
  dashboard — not code. Keeps the Worker dependency-free and the limit tunable without a deploy.
- Deploy: `npx wrangler deploy`. Local: `npx wrangler dev --port <free port>`.

One deviation from the DeetsAccounts convention worth noting: its design doc lives in
`DeetsSolutions/docs/`. This Worker's consumer is **this app**, not the site, so the design
doc is this section, and `wrangler.jsonc` should point back here.

### Repo 2 — DeetsMusic (this one)

All of it inside `apple.rs`, plus one call in `lib.rs`:

1. `ensure_developer_token()` — run once in `lib.rs` `setup()`, after `set_app_data_dir`.
   **The dev seam:** if `apple.json` is present, sign locally exactly as now; otherwise fetch
   from the Worker. So the dev loop never depends on the network, and a contributor with their
   own MusicKit key still builds fully offline.
2. Cache `{ token, exp }` in a `static`, persisted to `<app_data>/developer-token.json`.
   Refresh when the stored expiry is inside a margin; otherwise use what is on disk.
3. `developer_token()` becomes a sync cache read. Signature unchanged, so no caller moves.
4. Errors must name the cause — no local key *and* no network is a real first-run state, and
   "could not read apple.json" would be the wrong message for it.

Document the new file in [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) §8 alongside
`settings.json` when it lands.

### Repo 3 — DeetsSolutions

Only if the Worker gets a page. The DNS record is created by `wrangler` on first deploy.

### Order

1. Worker repo: sign, deploy to the subdomain, confirm with `curl` that the JWT verifies and
   that Apple accepts it.
2. Add the Cloudflare rate-limiting rule.
3. This repo: the cache + the dev seam, behind the local-key fallback so nothing breaks first.
4. Test a build with `apple.json` **moved away**, which is the state a stranger installs into.
5. Cut the release, attach the installer, then publish.

### Still open

- The repo name, Worker name and subdomain.
- The exact lifetime. Apple's ceiling is ~182 days; this repo currently signs 150. Pick the
  number with the refresh margin together.
- Whether a 401 from Apple should force a refresh, or whether startup-only is enough.

### The cost to name

This makes **one Apple account the dependency for every install**. If that key is throttled or
revoked, every copy stops working, and the membership is an ongoing cost. Apple's MusicKit and
Developer Program terms govern whether minting tokens for other people's installs is allowed at
all — that read is the user's, and it belongs before the app attracts traffic.

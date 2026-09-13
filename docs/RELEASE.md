# Release, install, uninstall

> Status: **the installer line is live** — 0.1.0 → 0.1.3 shipped, 0.1.3 is the first build
> whose installer stops the bundled CLI (below). Code: `package.json` (`release` script),
> `scripts/cli-dist.mjs`, `scripts/archive-installer.mjs`, `src-tauri/nsis/hooks.nsh`,
> `src-tauri/tauri.conf.json` (`bundle`).

House pattern, shared with DeetsAirplay / DeetsRGB: a hand-built **NSIS** installer, per-user,
no admin prompt, no auto-updater. Each shipped setup exe is kept in a local `installers/`
archive.

## 1. Cut a build

Four files hold the version and **must agree**: `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and `cli/Cargo.toml` (what `deetsmusic --version` and the MCP
server info report). Tauri names the installer from `tauri.conf.json`;
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
`user-token.txt`, `settings.json`, `deetsmusic.log`.

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
  The user-facing wording for each release lives in [RELEASE-NOTES.md](RELEASE-NOTES.md);
  paste that entry into the GitHub Release.
- **`npm run tauri dev` and the installed app share `%APPDATA%\com.deetsmusic.app`** (same
  identifier). Anything a dev run writes to `settings.json` the installed build reads. Use
  `npm run dev:app` (own identifier) when testing anything that seeds a one-shot state.
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

**To revisit (2026-09-12) — the hosting blocker has an answer now.** `DeetsSupport` (§7)
already serves `music-api.deets.solutions` unauthenticated. One more route can serve
`latest.json`, and the installer can sit in Cloudflare R2 (or a public release-only GitHub
repo). The user wants a design session on it. The forks to bring:
- **Host:** a route on `DeetsSupport` + R2, or a public release-only repo.
- **Behavior:** update silently at next launch, or ask first (and where: a launch prompt, a
  Settings row).
- **The signing key:** where the Tauri updater's private key lives, and who signs (a local
  step in `npm run release`, or CI).
- **The publish step:** extend `npm run release` to sign, upload, and write `latest.json`.
- **The kill switch:** the worker's `KILL` var must not also block updates, or a bad token
  release could not be fixed by an update.

## 7. Distributing a usable build — the developer token

> Decided 2026-09-09: **long token lifetime · open endpoint, rate-limited by IP · the dev
> seam keeps local signing.** **The worker is live (2026-09-11):** `DeetsSupport` is deployed on
> both hosts, `/token` mints a 60-day ES256 token that Apple accepts (search → 200, corrupted
> signature → 401), wrong `User-Agent` → 403. **Repo 2 is built the same day**: the cache, the
> dev seam, the 429/offline fallback and the once-per-process 401 refetch in `apple.rs`;
> `player.ts` re-runs `configure` on `developer-token-changed`. **Desk-tested 2026-09-11** with
> `apple.json` moved away: one `GET /token` 200 in the Cloudflare tail, `source=worker` in the
> log, playback fine (Order step 4 done). **The 401 refetch is desk-tested too:** a cached token
> with a dead signature → search hits 401 → `refetching once` in the log, one `/token` in the
> Cloudflare tail, the search succeeds on the retry; and with MusicKit already configured on
> the dead token, playback works after the refetch without a restart (the
> `developer-token-changed` reconfigure). **The dead first run is desk-tested via `KILL`:** no key,
> no cache, mint 503 → the window opens, the log reads `no developer token: no local MusicKit key
> and mint switched off (503)`, and a search shows the same text. The offline case shares that
> branch (only the string differs). Wanted later: a launch toast for it (FUTURE-SETTINGS §18).
> Steps 1–4 done; step 5 (the release) remains.

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

> **Superseded 2026-09-11.** The mint is no longer its own repo. It is one route on
> **`DeetsSupport`**, the support worker for every Deets app — status, suggestions, issues,
> anonymous report intake and remote config. Scoped in
> **`DeetsSolutions/docs/support.md`**, which is now the source of truth for the repo, the
> hosts and the schema. What stays true below: the zero-dependency house pattern, the
> WebCrypto signing notes, the secrets, and the rate-limit binding.
>
> Two things that repo's scope pins down, and that this repo depends on:
>
> - The app compiles in **`music-api.deets.solutions/token`** — a second custom-domain route
>   on that one worker, never the `support.` host. That keeps a future split a route move
>   rather than a release.
> - **`/token` returns before any D1 call**, so the boards cannot take down app startup.

Mirrors **DeetsAccounts** exactly, which is the house pattern for a Worker: **no
`package.json` and no dependencies**, plain `src/index.js`, a commented `wrangler.jsonc`, and a
subdomain route. The static site repo holds no Worker code.

```
DeetsSupport/              (renamed 2026-09-11 from the proposed DeetsMusicToken; hosts
                           support.deets.solutions + music-api.deets.solutions — the
                           siblings are api / radio-api / cities-api / mahjong-api / id)
  wrangler.jsonc           name, main, compatibility_date, KILL var, ratelimit binding, routes
  src/index.js             /token via plain WebCrypto, plus the support routes
  schema.sql               D1 — see support.md
  README.md                setup + deploy, in the accounts-setup.md style
```

- **Signing**: WebCrypto `importKey("pkcs8", …)` with `ECDSA` / `P-256`, then `sign` with
  `SHA-256`. Its output is raw `r||s`, which is **already** what JWS ES256 wants — no DER
  unwrapping. Zero dependencies, so the no-dependency rule holds.
- **Stateless**: sign per request. No D1, no KV. Long-lived tokens make caching pointless, and
  a per-request signature avoids handing every client one shared token with one shared expiry.
- **Secrets** — `npx wrangler secret put APPLE_P8`, `… TEAM_ID`, `… KEY_ID`. The `.p8` is
  pasted as a secret; it is never committed, exactly as in this repo.
- **Rate limiting by IP** is a rate-limit binding in `wrangler.jsonc`, **not** a dashboard
  rule (revised 2026-09-10: the binding is versioned with the code). **30 per 60 s**, fail
  OPEN if the binding is absent (raised from 10 on 2026-09-11 — see "What the rate limit is
  actually for" below).
  **Measured 2026-09-11, two corrections to the house pattern:** (1) declare it under the
  top-level **`ratelimits`** key — the older `unsafe.bindings` form deploys as "Unsafe
  Metadata" and never trips (DeetsAccounts, DeetsRadio, DeetsCities, DeetsMahjong and DeetsPoker
  carried that form and were inert — all five moved to `ratelimits` and redeployed the same
  day; DeetsCities also moved off namespace 2001, which it shared with DeetsAccounts, since
  bindings on one namespace share a counter); (2) the binding counts per
  isolate and syncs lazily, so a burst over fresh connections passes while one reused
  connection trips at ~26/30 and holds at 429. Enough for a runaway client loop (reqwest
  pools its connection); not a wall against a scan, which was never claimed.
- **Kill switch**: a `KILL` var; when set, every request gets 503. Flipping it is a
  `wrangler deploy` of the Worker, never a release of the app.
- **No Origin check.** A desktop app sends no browser Origin; the endpoint is open by design.
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
   Read the file first; if more than **30 days** remain, done, zero network. Otherwise fetch.
   `reqwest` here is async-only, so the one fetch runs as
   `tauri::async_runtime::block_on` inside `setup()` with a short timeout (~8 s) — it must
   finish before the webview asks for the token to configure MusicKit. Place it after
   `set_app_data_dir` and before the user-token seed.
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
2. Add the Cloudflare rate-limiting rule (the `ratelimit` binding, not a dashboard rule).
3. This repo: the cache + the dev seam, behind the local-key fallback so nothing breaks first.
4. Test a build with `apple.json` **moved away**, which is the state a stranger installs into.
5. Cut the release, attach the installer, then publish.

### Decided 2026-09-10 (build day is 2026-09-11)

- ~~**Lifetime 150 days**~~ / ~~**startup-only refresh**~~ — both revised 2026-09-11, below.
- ~~**Name / host:** `DeetsMusicToken`~~ — **settled 2026-09-11:** the route
  `music-api.deets.solutions/token` on the **`DeetsSupport`** worker
  (`DeetsSolutions/docs/support.md`). The Backends row is added.

### Revised 2026-09-11 — recovery, not the door

The endpoint stays **open and rate-limited by IP**; that fork is closed (three alternatives
were re-tested against the code and all three are dead: client attestation is impossible in a
public binary; a Turnstile-style human check cannot run, because `ensure_developer_token()`
runs in `setup()` before any webview exists; per-install registration in KV/D1 stops no script
and would put user data in the Worker, which breaks the privacy claim above).

The control that actually matters is **how fast the key can be rotated and how fast every
install recovers**. Two earlier decisions worked against that, so both change:

- **Lifetime 60 days, refresh margin 15 days** (was 150/30). A scraped token cannot be
  revoked, so its lifetime *is* the blast radius. Cost: ~6 startup fetches per install per
  year instead of ~2. Still one fetch at startup, still zero network per Apple call.
- **Refetch once on a 401 from Apple** (was startup-only). The old reasoning — "a refresh
  would mint from the same key" — held while `apple.rs` signed locally. Once the **Worker**
  signs, a rotated key means the Worker mints from a *different* key, so one refetch heals the
  install. Without it, rotating the key leaves honest users broken until the margin passes.
  Guard it with a local cooldown (one refetch per process, or per hour) so an Apple outage
  cannot loop.

Free hardening, no further decision needed:

- Require `User-Agent: DeetsMusic/<version>`; answer anything else **403**. Not security —
  it sheds drive-by scanners and keeps the logs readable.
- Respond `Cache-Control: no-store`. **Never log the token or the client IP.**
- `KEY_ID` is a secret, not a var, so the key can be swapped without a code change.
- The cached token is a bearer credential: it must reach only Rust and the webview
  (`apple_developer_token`). It must **never** appear on the loopback bridge or the agent
  routes. That invariant holds today — keep it.

### What the rate limit is actually for (2026-09-11)

Two things it is **not**. It does not sit in front of Apple: `developer_token()` is called
once per operation and the string is then passed down (`library.rs:585` hands it to
`AppleProvider` for a whole sync; `enrich.rs:284` per batch), so after the cache lands those
are pure memory reads. **A 10,000-track library pull makes zero Worker requests.** And it is
weak anti-theft: a thief needs **one** token and then holds it for 60 days, which no per-IP
limit prevents.

Its real job is to stop a runaway client loop and keep the bill at zero. Judged that way a
tight number is all cost, so:

- **30 per 60 s per IP.** An honest install fetches ~8 times a **year** (one startup fetch,
  only inside the 15-day margin). The headroom is for shared addresses — office NAT, CGNAT,
  a campus, a busy VPN exit — where many installs can leave by one IP.
- **The client must survive a 429.** If the cached token is still inside its expiry, keep
  using it and retry at the next launch. A 429 must never block startup or sign the user out.
- **Cool down the 401 refetch: one per process.** That path is the only way a client can
  generate Worker requests in a tight loop.

### The cost to name

This makes **one Apple account the dependency for every install**. If that key is throttled or
revoked, every copy stops working, and the membership is an ongoing cost. Apple's MusicKit and
Developer Program terms govern whether minting tokens for other people's installs is allowed at
all — that read is the user's, and it belongs before the app attracts traffic.

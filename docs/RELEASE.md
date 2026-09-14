# Release, install, uninstall

> Status: **the installer line is live** — 0.1.0 → 0.1.3 shipped, 0.1.3 is the first build
> whose installer stops the bundled CLI (below). Code: `package.json` (`release` script),
> `scripts/cli-dist.mjs`, `scripts/archive-installer.mjs`, `src-tauri/nsis/hooks.nsh`,
> `src-tauri/tauri.conf.json` (`bundle`).

House pattern, shared with DeetsAirplay / DeetsRGB: a hand-built **NSIS** installer, per-user,
no admin prompt, no auto-updater yet (designed in §6). Each shipped setup exe is kept in a local `installers/`
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

**Before a Worker deploy that follows a theme, skin, palette or font change:** run
`npm run signin:assets` here, then `npx wrangler deploy` in `../DeetsSupport`. The hosted
sign-in page (DATA-ARCHITECTURE.md §2a) serves a COPY of the app's look, and the copy is
only as fresh as the last run. The app never needs the Worker for a release; the Worker
needs the app's look.

## 1a. Stranger parity — the live app must behave like a stranger's install (2026-09-13)

**What slipped.** The installed 0.3.1 on the dev PC logged `token: source=local`: it read the
repo's MusicKit key through a compile-time source path, never used the Worker or its 401 heal,
and broke when that key was rotated. The fallback was documented as intended, so no code
review or diff-based release check would have flagged it. Only runtime evidence from the
installed build showed it. Three layers now guard this:

1. **Structural.** Anything that reads the source tree is compiled out of release builds with
   `#[cfg(debug_assertions)]` — not a runtime `cfg!` check — so the path string is not in
   the exe at all (`apple.rs` `repo_secrets_dir`, the bridge's dev extension path).
2. **Automated gate.** `npm run release` runs `scripts/release-check.mjs` after `tauri build`
   and before archiving. It fails when the exe contains an absolute path into the repo (build
   output under `src-tauri\target\` is allowed) or when the four version files disagree.
   Run it alone with `npm run release:check`.
3. **Checklist on the INSTALLED build — when relevant, not on every release.** Run it before
   any key change, and before a release whose changes touch these paths or the code next to
   them: sign-in and sign-out (`apple.rs` auth, `main.ts` Account, the hosted sign-in page),
   the developer token and the Worker (`ensure_developer_token`, the 401 heal), MusicKit
   configure and authorization, Apple health and the offline or reconnect handling, and
   anything that reads the source tree or secrets. A release of UI-only work (drag and drop,
   cards, settings rows) can skip it; the automated gate above still runs. When in doubt, run
   it. Read the installed log (Settings › Bugs › App log):
   - [ ] the `start:` line shows the new version, and the next line is `token: source=worker`;
   - [ ] sign in from zero (Account › sign out, then sign in) — the page loads, Apple accepts;
   - [ ] signed out, press play → "Sign in to Apple Music to play songs." with **Sign in**;
   - [ ] launch offline → the offline toast, and recovery when the network returns;
   - [ ] **Do NOT force a revoke with `__music.unauthorize()`.** It calls MusicKit's
     `_webPlayerLogout`, which logs the sign-in token out AT APPLE (2026-09-13: the token went
     from 200 to 403 on `/v1/me/storefront`, and it was the same token the installed app used,
     so the live app was signed out too). A revoke test needs a method that clears only
     MusicKit's local copy, and never a token copied from the installed app. Not built yet.

   A second Windows user account (no repo, no app data) is the cheapest real stranger; not
   set up yet.

### Key changes (rotation, revoke) — runbook

Written after the 2026-09-13 rotation, where the revoke broke the installed app because its
token source had not been checked first.

1. **Before anything:** read every live app's log for its token source (`token: source=…`).
   A `local` line in an installed build is a bug — stop and fix it first (§1a).
2. Create the new key in the Apple portal. Copy the `.p8` to `Documents\Deets' Secrets` and
   note its id and purpose in that folder's README. **Never delete a `.p8`.**
3. Put it in the Worker without echoing it: `npx wrangler secret bulk <temp json file>`
   (sends `APPLE_P8` + `KEY_ID` together, so the Worker never pairs a new key with an old id;
   delete the temp file in a `finally`). A PowerShell pipe into `secret bulk` does not work.
4. Verify with status codes only: `/health` ok; a fresh `/token` has the new `kid`; Apple
   answers 200 to it several times in a row.
5. **Only then** revoke the old key. Expect Apple to answer inconsistently for 15+ minutes
   after a revoke (seen 2026-09-13: 200/401 flipping for every key on the team, including a
   brand-new one). Watch with a status-only loop before declaring it done.
6. Re-check each live app: the log shows a `token: 401 … refetching` line followed by a
   successful play, with no restart.

`installers/` is **gitignored** (~6 MB each), exactly as DeetsAirplay does it. Since 0.4.3
each installer has its updater `.sig` beside it (`release:publish` needs it, so keep the pair).
A pre-release version (`0.4.2-t1`, a spike build) archives to `installers/dev/` instead, so the
top folder holds only real releases. The difference
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
  ([EXTENSION.md](EXTENSION.md) §6). Asked at most once per PC (2026-09-14): never on an
  updater or silent install (`$UpdateMode = 1`, `IfSilent`), never once the extension has
  reached the app (`extension-connected`, written by `bridge.rs`), never after a No
  (`extension-declined`, written by the hook). Both files sit in `%APPDATA%\com.deetsmusic.app`.

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
- **An install closes a running dev build too** (seen 2026-09-14, an updater install of
  0.4.2-t2): Tauri's installer closes processes by the name `DeetsMusic.exe`, and Windows
  matches `target\debug\deetsmusic.exe` without case. The dev runner then exits with code 1.
  Restart it after the install; nothing is damaged. It does share the installed build's identifier and data dir, though — see
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

## 6. The updater

> Status: **built on branch `yupdates` 2026-09-14, not yet tested.** Decisions below are the
> user's; the "Test first" list (§6.8) is what the spike must confirm. Code: `src-tauri/src/update.rs`,
> `src/updater.ts`, Settings › Updates (`settings-card.ts`), `scripts/release.mjs`,
> `scripts/publish-update.mjs`, `scripts/cred-read.ps1`, and `DeetsSupport/src/update.js`.
>
> **As built — where it differs from the plan below:**
> - The verified installer is held **in memory**, not staged on disk (§6.4). A file read back
>   later would skip the signature check, which the plugin runs only at download time.
> - Two channels: `deetsmusic` and `deetsmusic-test`, fixed at compile time by
>   `DEETSMUSIC_UPDATE_CHANNEL`. Spike builds never reach a real install.
> - Publishing is its own command, `npm run release:publish`, not a stage of `npm run release`.
>   Test the installed build first; publishing is what makes installs update.
> - The Windows install mode is **passive**: NSIS shows only a progress bar, then relaunches the app.
> - An update restart restores the song, paused, at its position, even when Restore on launch is off.

History: `tauri-plugin-updater` was deferred because it fetches its manifest
unauthenticated, so the private GitHub repo could not serve it. `DeetsSupport` (§7) removes
that blocker.

### 6.1 Terms

- **Updater** — `tauri-plugin-updater`. It reads the manifest, downloads the installer,
  checks its signature, and runs it.
- **Manifest** — the JSON that names the newest version, its URL, its size and its signature.
- **Channel group** — a set of versions that share a compatible cache database (§6.5).

### 6.2 Host — a Worker route + R2 (decided)

- `GET music-api.deets.solutions/update/deetsmusic?v=<current>` returns the manifest. It
  answers from a var or R2 metadata, **never D1**, the same rule as `/token`.
- Installers and their `.sig` files live in an R2 bucket, one object per version. ~6 MB
  each; R2 storage is free to 10 GB and egress is free, so every version is kept.
- The route reads `?v=`, so the Worker can hold back a bad release or offer a rollback
  target per request.
- **`KILL` must not block this route.** Today `KILL` returns 503 on every route
  (`DeetsSupport/src/index.js`). A bad release must stay fixable by an update, so the update
  route checks `KILL_UPDATE` (its own var) instead.
- This is a file channel for **signed installers only**. It never serves code the app loads
  (support.md "config yes, code no").
- **The website reads the same index** (decided 2026-09-14, not built):
  `GET /update/<channel>/releases` is the public release list behind
  `deets.solutions/deetsmusic/` (DeetsSolutions `docs/support.md`, "The page"). No `?v=`;
  newest first; `latest` is the newest live non-pre-release. Each row carries version, date,
  notes, and — only when it has an installer and is not withdrawn — size and a download URL
  on `music-api.`. Signature and group stay off it. `Cache-Control: public, max-age=300`.
  Same rules as the rest of the route: R2 only, before `KILL`, behind `KILL_UPDATE`.
  Two kinds of row the updater never sees, because `readIndex` keeps only entries with a
  `file` and a `signature`:
  - **History rows** — 0.1.3 to 0.4.1 shipped before the updater, so they have no `.sig`.
    They go into the index as notes only (§6.7), so the page's history does not start at 0.4.3.
  - **Withdrawn releases stay listed**, notes and all, marked withdrawn and with no download.
    What went wrong is part of the record. An optional `withdrawn_reason` says why.

### 6.3 Behavior — download in background, ask to restart (decided)

Settings row, verb-first per the label style: **Updates — Automatic / Ask / Off**.

- **Automatic** — check at launch and every few hours; download in the background; a toast
  offers **Restart now** / **Later**. Later re-offers at the next launch. The app often lives
  in the tray and never quits, so "install on quit" alone is not enough.
- **Ask** — the toast offers **Download** first, then the restart toast.
- **Off** — no check. The Settings row still has **Check now**.
- Every offer has **Skip this version**; the skipped version is stored in `settings.json`.
- An update cannot apply while the app runs: Windows will not replace a running exe, and the
  front end is inside it. A restart takes a few seconds. `restoreQueue` brings the song and
  queue back; **the playback position is not saved today** — add it with the build.
- The install closes the bundled CLI (`PREINSTALL` hook), so an open MCP session ends.
- `minVersion` from the remote config (already in the `/token` response) turns the offer into
  a required update. The `notice` string becomes a notice toast (TOASTS.md §5).

### 6.4 Download rules — one at a time (decided)

- **One download in flight.** Rust holds one lock; a check while a download runs does nothing.
- **One staged installer on disk,** in a fixed folder. A newer version replaces it. It is
  deleted after the install, or when the running version already matches.
- **Size cap.** The manifest states the size. The app refuses a manifest above a fixed cap
  (~50 MB) and aborts a download that grows past the stated size.
- The updater buffers the download in memory before writing it; the cap bounds that too.

### 6.5 Rollback — previous version, plus a list (decided)

- Settings shows **Roll back to <previous>** — one press.
- Under it, **Other versions…** lists older versions **in the same channel group** only.
- A rollback marks the version it left as skipped, or Automatic would re-install it at once.
- **Why the group rule:** the cache db migrates forward (`library.rs` v2–v5). v3–v5 only add
  tables and columns, so an older build still reads the newer db. v2 re-keyed rows, so a build
  from before v2 would break on it. **Release rule:** a destructive migration starts a new
  channel group, and the manifest carries the group per version.
- The updater needs a custom version comparator to accept an older version.

### 6.6 Signing — local, password in Credential Manager (decided)

- `npx tauri signer generate` makes the key pair. The **public key** goes in
  `tauri.conf.json` (compiled into every install). The **private key** signs each installer
  at build time (`bundle.createUpdaterArtifacts`, env `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- **Why it matters:** the signature is the defence if the Worker, R2 or DNS is taken. The
  private key **never goes into Cloudflare** or the repo.
- **Lost key = no install can update again.** Every install trusts only its compiled public
  key, and a new key can only ship in a release signed by the old one.
- **Not Authenticode.** This key does not silence SmartScreen on a first install (that needs
  a paid code-signing certificate).

**Where things live — two copies of each, in two places:**

| Item | Copy 1 (this PC) | Copy 2 (off this PC) |
|---|---|---|
| Key password | Windows Credential Manager — the release script reads it | iCloud Passwords (end-to-end encrypted, two-factor) |
| Private key file (encrypted form only) | `Documents\Deets' Secrets`, noted in its README | USB drive or OneDrive — **never iCloud Drive** |

1. The key file and its password never share an account.
2. The key file is only ever stored encrypted.
3. On the day the key is made, sign a test file using **copy 2 of both** to prove the backup.
4. The release script passes the password only to `tauri build`; it never prints or writes it.

**Runbook — the key file is copied, but the password is not known to anyone else.** The file is
encrypted, so it is not usable. Make a new key when convenient and rotate (below). Not urgent.

**Runbook — the key AND its password are exposed.** An attacker also needs the update route
(the Worker, R2 or the DNS record) to push a fake installer. So:
1. Secure Cloudflare first: change the password, check two-factor sign-in, revoke API tokens.
2. Set `KILL_UPDATE` until step 4 ships, if the route itself is in doubt.
3. `npx tauri signer generate` a new key; store it and back it up as above.
4. Ship a release **signed with the OLD key** that carries the **NEW** public key. Installs
   that take it trust only the new key from then on.
5. Raise `minVersion` to that release, so every install is pushed to take it.
6. Installs that never update keep trusting the old key. That gap cannot be closed from here.

**Runbook — the key is LOST (both copies).** No install can verify an update again. There is
no fix inside the updater. The recovery is the config channel, which does not use the key:
1. Make a new key and a release with the new public key.
2. Put it where a person can download it by hand (the GitHub Release, the support page).
3. Set the remote `notice` to say so, with the download link. Every install reads it on the
   `/token` fetch. **So the notice toast must show a link button — build that with the updater.**

**Possible second lock (not decided):** if Artifact Signing is bought, the app can also require
the downloaded installer to carry a valid Authenticode signature with our publisher name before
it runs. Then a stolen updater key plus a taken Worker is still not enough.

Why Credential Manager over a typed prompt: the password protects a copied key file, and
both options protect that equally. Neither protects against malware running as the user.
The vault lets a Claude session run a full release; a prompt would not.

### 6.7 Publish step

`npm run release` gains stages after `release-check`: sign (via the env vars above), upload
the installer and `.sig` to R2, and update the manifest (version, size, signature, channel
group). The local `installers/` archive stays.

**Additions for the website (decided 2026-09-14, not built)** — `scripts/publish-update.mjs`:

- `--history` writes a **notes-only row** for every `## <version>` in RELEASE-NOTES.md that the
  index lacks: `{ version, notes, pub_date, history: true }`, with the date taken from the
  heading. No `file`, no `signature`, so the updater and rollback skip it. Run once for
  0.1.3–0.4.1; safe to re-run.
- `--withdraw <v> --reason "<text>"` stores `withdrawn_reason` beside `withdrawn: true`. The
  reason is shown on the public page, so it is written in plain words for a user.
- `--notes-only <v>` refreshes one row's `notes` from RELEASE-NOTES.md without re-uploading
  the installer. Today a typo fix needs `--replace`, which uploads ~6 MB again.

### 6.8 Test first (spike before the build)

- [x] The release script reads the **real** Credential Manager vault from this session (the
  Claude app's MSIX package virtualized the registry before; the vault is a separate store).
  **Confirmed 2026-09-14:** `CredReadW` on target `DeetsMusicUpdaterKey` (made by the user
  with `cmdkey /generic:DeetsMusicUpdaterKey /user:updater /pass`) returned the password,
  and `tauri signer sign -f <key>` signed a test file with it. Trap: the env var
  `TAURI_SIGNING_PRIVATE_KEY` takes the key's CONTENT, not its path ("Invalid symbol 58").
- [x] NSIS in the updater's mode installs an **older** version over a newer one without a prompt.
- [x] The app relaunches after the update, the **pinned taskbar button keeps its icon**, and
  the relaunched window groups under it. The pin holds only while `mainBinaryName`,
  `productName` and the install folder stay fixed — all three are in `release-check.mjs`.
- [x] An updater download shows no SmartScreen warning (expected: no browser mark on the file).

**Spike result (2026-09-14, installed 0.4.2-t1 ⇄ t2 on `deetsmusic-test`): all pass.**
- Update t1 → t2: offered, downloaded and verified in ~2 s, installed with a progress bar, and
  t2 started by itself 8 s later. The song came back paused and resumed at its position. The pin
  kept its icon. No SmartScreen.
- Rollback t2 → t1: offered only inside group 1, no downgrade prompt, t1 started 8 s later.
- Skip after rollback: `updateSkip` survived the installer's exit. The automatic check 30 s
  after start found t2 and showed no toast; only the two manual **Check now** presses did.
- Found: the install closes a running dev build (§4), and the updater install showed the
  extension question (fixed in `hooks.nsh`, §3; not yet verified in a build).
- The dev PC's installed app is now a **test-channel** build. It will only see test releases,
  so the next real release must be installed by hand once.

**How to run the spike (test channel, never reaches a real install):**
1. Deploy the Worker (`npx wrangler deploy` in DeetsSupport); smoke `/token`, then
   `GET /update/deetsmusic-test?v=0.0.1` → 204 (empty index).
2. Set the version to a test number (e.g. `0.4.2-t1`) in the four files.
   `DEETSMUSIC_UPDATE_CHANNEL=deetsmusic-test npm run release`, then
   `npm run release:publish -- --channel deetsmusic-test`. Install that setup exe by hand; pin it.
3. Bump to `0.4.2-t2`, build and publish the same way. Do not install it.
4. In the installed t1: Settings › Updates › Check now → the restart question → **Restart now**.
   Expect a progress bar, then t2 opens by itself, the song back at its position, the pin intact.
5. In t2: Roll back → `0.4.2-t1` → Install → Restart now. Expect t1, and t2 marked skipped.
6. Set the version back to the real one. A test build stays on `deetsmusic-test` until the
   installed copy is replaced by a normal release.

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
> branch (only the string differs). The launch toast for it is built ([TOASTS.md](TOASTS.md) §5,
> 2026-09-13; not yet desk-tested against `KILL`).
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

### Revised 2026-09-13 — D.7 hardening (Apple terms pass)

Read against the Apple Developer Program License Agreement §3.3.6.D.7 ("not use developer
tokens or private keys … in any manner not expressly authorized") and §2.8 (no sharing access
to Apple services). Decided and built:

- **Lifetime 14 days, one shared token per 7-day window** (was 60 days, a new token per
  request). Every token in a window expires at the same instant, so the Worker hands out one
  token rather than an unlimited supply. Held per isolate and in the colo's Cache API, keyed by
  window + `KEY_ID` + origins; no KV, no D1. `iat` is never back-dated. The app's refresh
  margin drops to **3 days** (it must stay below the window). ~50 fetches per install per year.
- **Mint counter:** D1 `mint_counts` (day, served, limited), written with `waitUntil` after the
  response, errors dropped. No IP, token or UA. Read:
  `npx wrangler d1 execute deets-support --remote --command "SELECT * FROM mint_counts ORDER BY day DESC LIMIT 14"`.
- **`origin` claim — built, switched OFF** (`TOKEN_ORIGINS` var, empty). Probed 2026-09-13
  against `api.music.apple.com`: with a claim, Apple answers **401** to a request whose
  Origin is missing or unlisted (every reqwest call sent none), accepts **no wildcard and no
  bare host**, and matches host + port exactly. So the app now sends
  `Origin: http://tauri.localhost` on every Rust call to Apple, and the sign-in page binds a
  fixed port (47831–47833) instead of an ephemeral one. **Turn it on only once installs older
  than this change are gone** — an old install would get 401 on everything. There is no
  auto-updater, so that is a judgement call, not a date. Value: a lifted token stops working
  on anyone else's web page. It does not stop curl or a native client, which can fake Origin.
  The value to set: `http://tauri.localhost,http://127.0.0.1:47831,http://127.0.0.1:47832,http://127.0.0.1:47833`.
  A contributor without a local key running `npm run dev:app` (origin `localhost:<port>`)
  would also get 401s from MusicKit once it is on; the dev seam (a local `.p8`) is unaffected.
- **Separate key for the live mint (item 4)** — the user's portal step; see HANDOFF.

Compliance items shipped with it: the Apple Music icon replaces the Apple logo on the playlist
badge (Identity Guidelines); a trademark and non-affiliation notice (Settings › About, README);
a privacy section (README); MusicKit `app.build` reports the real version; the log redacts the
Music User Token by value (`log::register_secret`), since it is not JWT-shaped.

### The cost to name

This makes **one Apple account the dependency for every install**. If that key is throttled or
revoked, every copy stops working, and the membership is an ongoing cost. Apple's MusicKit and
Developer Program terms govern whether minting tokens for other people's installs is allowed at
all — that read is the user's, and it belongs before the app attracts traffic.

# DeetsMusic — Handoff / Status

> Cold-start guide — read first. A lightweight Apple Music player for Windows 11:
> **Tauri v2 + WebView2**, vanilla **TypeScript** front-end, **Rust** back-end. Current
> surface is the **midi-player** (480×864 frameless window) showing a home **bento** of cards.
>
> **Where things stand:** the foundation (playback, queue, card/slot system, themes/skins,
> library + catalog data) and the feature cards (Library, Search, Playlists, Queue, History,
> Rewind, **Radio** incl. seeded right-click "Start Station") are built and user-verified.
> **The Apple-radio line is done.** Next: the **v1 push** — see [Next up](#next-up).

Deeper docs, by area:
[DESIGN.md](DESIGN.md) (product) · [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) (front-end tokens/cards) ·
[DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (back-end/data) · [QUEUE.md](QUEUE.md) (queue model +
playback windowing — **read before touching queue.ts/player.ts**) · [DEBUGGING.md](DEBUGGING.md)
(`__diag` log) · [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) (card system + surface seam) ·
[FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) (behaviors hardcoded now, to expose as toggles) · [SETTINGS.md](SETTINGS.md) (the settings store + card) ·
[UX-COVERUPS.md](UX-COVERUPS.md) (latency/jank ledger). Feature specs: [SEARCH.md](SEARCH.md) ·
[PLAYLISTS.md](PLAYLISTS.md) · [STATIONS.md](STATIONS.md) · [FAVORITES.md](FAVORITES.md) ·
[ALBUM-COLOR.md](ALBUM-COLOR.md) · [DEETS-REWIND.md](DEETS-REWIND.md) · [DeetsOTD.md](DeetsOTD.md) ·
[DeetsWeather.md](DeetsWeather.md) · [TRAY.md](TRAY.md) · [EXTENSION.md](EXTENSION.md) · [AGENT.md](AGENT.md) ·
[TOASTS.md](TOASTS.md) (the notice primitive + every call site) · [RELEASE.md](RELEASE.md) (build / install / uninstall).

---

## Run it

Prereqs (one-time, already set up on this machine): **Rust** (`x86_64-pc-windows-msvc`) + **VS
2022 Build Tools** (C++ workload, for `link.exe`); **Node** + npm; **Apple Developer** creds in
`src-tauri/secrets/` (`apple.json`, the `.p8`, and a captured `user-token.txt` — launches
already signed in).

```bash
npm install
npm run tauri dev        # compiles Rust (first run slow), opens the window
npm run dev:app          # same, but SIDE BY SIDE with the installed app (see below)
npx tsc --noEmit         # typecheck front-end
npx vite build           # bundle-check
```

**Dev alongside the installed app (2026-09-09):** `npm run dev:app` merges
`src-tauri/tauri.dev.conf.json`, which changes only the identifier to `com.deetsmusic.dev`
(and the window titles). That gives the dev build its own `%APPDATA%\com.deetsmusic.dev`
(SQLite cache, settings.json, MUT) and its own WebView2 profile — two builds sharing one
profile is what produced the blank window with `ERR_CACHE_READ_FAILURE` on every module.
The bridge just takes the next free port (the extension and the CLI probe the list).
Seed the dev dir once by copying `deetsmusic.db` + `user-token.txt` from the release dir
(zero Apple calls); localStorage (theme/skin/layout) starts fresh.

Devtools **auto-open in dev** (`lib.rs` setup). Debug the player in the console:
`__diag.dump()` / `__diag.copy()` (ring buffer of transport + MusicKit events + desyncs,
auto-captures uncaught errors), `__music` (live instance), `__player.snap()`. Full reference:
[DEBUGGING.md](DEBUGGING.md).

**Dev telemetry + driving the app from a session (2026-09-12).** In dev every song click
(and Next) prints `[perf] click→sound N ms · model+render · setQueue · stream` to the
console and writes the same line, plus MusicKit's own request list, to the dev log
(`%APPDATA%\com.deetsmusic.dev\deetsmusic.log`). The `deetsmusic` MCP drives playback
(`play` returns after the song starts), so a session can run a play, tail the log, and
read the stage split without the devtools — that is how the click-to-sound pass was
measured and verified (cold vs warm, natural advance via `control seek 97`, dead ids,
the queue restore via a restart). Recipe and limits: [DEBUGGING.md](DEBUGGING.md)
"Driving it from outside" and `CLAUDE.md` "How to verify your work". None of it ships:
`src/perf.ts` is gated on Vite's `DEV` flag.

## Ship it (installable Windows app)

Full procedure — version sync, the three build stages, the NSIS hooks, install, uninstall,
and why there's no updater — is in **[RELEASE.md](RELEASE.md)**. The short version:

```bash
npm run release     # cli:build → tauri build → archive-installer; ~3 min cold
```

Produces `src-tauri/target/release/bundle/nsis/DeetsMusic_<version>_x64-setup.exe` (~5.6 MB)
and copies it into `installers/` (gitignored, the DeetsAirplay pattern). Installs per-user to
`%LOCALAPPDATA%\DeetsMusic` with **no admin prompt**.

Three things that bite:

- **Use `npm run release`, not `tauri build`.** Only `release` runs `cli:build` first, which
  stages `cli/dist/deetsmusic.exe`. `tauri build` alone ships the **previous** CLI, silently.
- **The version lives in three files** — `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` — and they must agree or the archive step fails.
- **A running `deetsmusic mcp` blocks install AND uninstall.** Windows won't touch an open
  file; uninstalling 0.1.2 removed the registry entry and then left every file on disk. The
  0.1.3 `PREINSTALL`/`PREUNINSTALL` hooks stop the CLI first (RELEASE.md §3).

Icon: `app-icon.png` (the DM mark, DeetsAirplay/DeetsRGB lineage — transparent background,
scarlet `#E8341C` D + burgundy `#7A1A2E` M, 2026-09-09). Regenerate every size + the `.ico`
with `npx tauri icon app-icon.png` (delete the `android/` / `ios/` dirs it also emits); the
extension's icons are LANCZOS resizes of the same file.

---

## Next up

**2026-09-13 — Apple terms + D.7 pass, built, NOT yet desk-tested or deployed** (branch
`toast-time`; decisions and the origin probe in [RELEASE.md §7](RELEASE.md) "Revised
2026-09-13"). App: Apple Music icon on the playlist badge, Settings › About notice, README
privacy + trademarks, real MusicKit `app.build`, MUT redacted in the log, `Origin:
http://tauri.localhost` on every Rust call to Apple, sign-in on fixed ports 47831–47833,
refresh margin 3 days. Worker (`../DeetsSupport`, uncommitted, **deployed 2026-09-13**,
version `5771f7e5` + secrets): 14-day shared token per 7-day window, `mint_counts` table
(created with `--command`; `--file` imports fail with auth error 10000), `TOKEN_ORIGINS`
claim built but empty. **Key rotated:** the Worker signs with **`63Y9S9P5Z8` (DeetsMusic
PRD)**; `22CB27A4ZK` is **revoked**. Dev signs with **`WPYRNBYCRT` (DeetsMusic DEV)** —
`src-tauri/secrets/apple.json` points at it (the old `.p8` stays in that folder). Right after
the revoke Apple answered inconsistently for a while (the PRD Worker token flipped 200/401,
the brand-new DEV key returned 500, a local PRD token with the same claims got 200) — read as
Apple propagating the key changes; re-verify both keys before trusting either.
Every `.p8` is copied to `Documents\Deets' Secrets` (README there maps ids → apps;
`5685728SWS` is DeetsRadio). **Never delete a `.p8`.** Note: 0.3.0 installs keep a 15-day
margin, so against 14-day tokens they refetch on every launch until they update.

**2026-09-13 — Apple health: say why Apple Music stopped, heal without the user, NOT yet
desk-tested** (branch `toast-time`). Found live after the key rotation: MusicKit showed
"Unable to prepare for playback." as a native dialog, the Account row still said Connected,
the sign-in page said "Error: Unauthorized", and a play-only install never healed (only a
Rust call triggered the token refetch). Built: `apple_check` (which token Apple rejects, with
the bounded heal) + `apple_auth_status` (the page reports failures) in `apple.rs`;
`apple-health.ts` (one toast per cause, Account row states, 5-min recheck while Apple-side);
`requireSignIn` on every play path; every MusicKit `alert()` routed to player.ts; play retry
after a heal; the Worker `notice` shown at launch. Bounds and copy: [TOASTS.md](TOASTS.md)
§Apple health rows. **Rust changed: restart the dev runner.** Test: sign out → play (toast +
Sign in button); sign in; the installed 0.3.0 stays as it is until a new installer. The
hosted sign-in (DATA-ARCHITECTURE §2a, another session) can reuse `apple_auth_status`.
**Sign-in error routes closed (2026-09-13, same day).** Found live: MusicKit revokes its token
after one auth error and its `_webPlayerLogout` can log the token out AT APPLE; the loopback
page then returned that dead token from its own storage and said "Done!". Built: the page
clears its storage before MusicKit loads; Rust checks a delivered token (`/v1/me/storefront`
403 → failed sign-in, not saved); a `/v1/me` 403 anywhere emits `apple-signin-rejected` →
"Apple Music signed you out" (the launch-time sync no longer fails quietly); the restore
re-injects only when the health check says the sign-in still works; sign-out clears
MusicKit's in-memory token (`musicUserToken = ""`, no logout call). Decided: keep MusicKit's
own logout (option B); disabling it would modify MusicKit JS internals (Apple DPLA §3.3.6.D.1).
**Never call `__music.unauthorize()` in a test** (RELEASE.md §1a).
Then, found in the desk test: a sign-in after MusicKit had dropped its token left MusicKit
unauthorized until a restart (only `initPlayer` injected the token, and the failed plays
raised no error — MusicKit showed only its own dialog). Built: Rust emits
`user-token-changed` on capture (and clears the cached health answer), player.ts injects the
new token at once, and `requireSignIn` restores MusicKit before a play when it is signed in
but unauthorized. **Desk-verified 2026-09-13 in the dev app:** launch with a dead token →
"Apple Music signed you out"; Sign out → play → sign-in toast; Sign in → Apple's real screen
→ a song played with no restart. Shipped as **0.3.2**.

**Next version — the hosted sign-in page (DATA-ARCHITECTURE §2a) must handle these odd
cases, not only the happy path.** Carry every lesson from today into its design and desk test:
(1) never reuse a stored token (clear storage before MusicKit loads); (2) the app checks a
delivered token (`/v1/me/storefront`) before saving it; (3) a failure the page sees reaches the
app at once (`AuthStatus::Failed`), including Apple's `AUTHORIZATION_ERROR` on a closed window;
(4) a stale or second tab never says "Done"; (5) a token Apple logged out (MusicKit's own
`_webPlayerLogout`) leads to a working re-sign-in, not a loop; (6) the page says in plain words
what happened and what to do, for each of these; (7) Apple's post-rotation flapping (200/401
for 15+ min) does not end in a saved dead token. Test each one on purpose before shipping it.

**2026-09-13 — Library virtualization (option A, windowing): BUILT on `optimus-deets`,
measured, scripted checks pass, awaiting the desk test.** `src/collection-window.ts`; how it
works: UI-ARCHITECTURE.md §"Long lists: windowing"; before/after and the hand-test list:
**[LIBRARY-VIRTUALIZATION.md](LIBRARY-VIRTUALIZATION.md)** §Results (skin flip 395–558 →
16–40 ms; cold grid drag 75–82% dropped with 345 ms long tasks → 1–4%, worst 8–21 ms; DOM
23k → ~1k nodes). Proven fallback if A stalls: option B (`content-visibility: auto` on rows / 60-tile
blocks), measured in DEBUGGING.md. Also shipped that day: the ambient skin layers
(compositor-only, `--ambient-fps`, paused when hidden) and Settings › Window › **Animate
backgrounds** — both need a fresh installer to reach the installed app.

**2026-09-13 — Hosted sign-in page + deep link: BUILT, Worker DEPLOYED (version
`0ef715d2`, 18:40), desk-tested end to end in Edge the same night** (branch `optimus-deets`). The browser sign-in now opens
`https://music-api.deets.solutions/signin` (the Worker's `/health` answering), else the
loopback page. The page returns the MUT with a `deetsmusic://auth?n=<nonce>&mut=…` link
(a debug build: `deetsmusic-dev://`), so the MUT never passes through the Worker. As built,
with the differences from the plan: **[DATA-ARCHITECTURE.md §2a](DATA-ARCHITECTURE.md)**;
test seams: DEBUGGING.md §Sign-in. Files: `apple.rs` (`begin_hosted`, `handle_link`,
`accept_token`), `lib.rs` (single-instance argv → `handle_link`; debug registers its
scheme), `plugins.deep-link` in both Tauri configs, `apple.ts`/`main.ts` (`connect(local)`,
the "Use local sign-in" link under the Account note), `scripts/signin-assets.mjs`
(`npm run signin:assets` copies the app's look into `../DeetsSupport/src/signin/`), and in
`../DeetsSupport`: `src/signin.js`, `wrangler.jsonc` rules, the router (uncommitted there).
**Verified in the dev app against a `wrangler dev --remote` preview:** the page renders
themed; every link case (stray, wrong nonce, replay, `error=`, refused token, real token
→ Connected, a hosted link after the local page took over); the Worker-down fallback; the
Account-row link. **Not yet verified (needs Apple's own window, the user's step):** Apple's
popup → the automatic `deetsmusic-dev://` return in Chrome and Edge, the Return button, the
Access Request screen's host name + icon, browser history not keeping the link, and a
Worker-page MUT (PRD key) working with the DEV key (§2a desk-test list). **Deployed
2026-09-13 evening** (`npm run signin:assets`, then `npx wrangler deploy` in `../DeetsSupport`;
that repo's changes are not committed yet). The live page answers at
`music-api.deets.solutions/signin`; a build falls back to the loopback page only when that
GET fails. Same evening: the Account button cancels a waiting sign-in on a second click,
and the local page reports its own close (§2a "Cancel"). **Desk test result (2026-09-13,
late): the full hosted sign-in works in Edge** — dialog → Open → Connected. The earlier
"Edge drops the link" was not a browser or app bug: the dev app had been launched from a
Claude desktop session, whose MSIX package redirects registry writes into a private hive,
so the scheme was never really registered (§2a "RESOLVED"; Known gotchas below). A
successful sign-in now shows "Sign-in complete! Enjoy!" (`success`, `all` tier). The
DeetsSupport page's "Signed in" copy was shortened to match; **it needs `npx wrangler deploy`
in `../DeetsSupport`**. Keep the loopback page for one release as decided (§2a fork 5).

> **Committed means tested.** Aditya runs the app constantly and tests as he goes, so
> anything already committed works unless this file says otherwise. Confirmed in use
> 2026-09-11: the extension, the mini/midi/max layouts, stations, and the CLI. Do not
> label committed work "untested" or add a test step for it to a roadmap.

**Public release (decided 2026-09-09, next session)** — the repo is already public and the
secret audit is clean (the `.p8`/MUT/`dev-dumps` were never committed in any branch). The
blocker is that a MusicKit key needs a **paid Apple membership**, so no ordinary subscriber can
run the app. Fix: a **Cloudflare Worker on deets.solutions mints the developer token** — long
lifetime, open endpoint rate-limited by IP, local signing kept as the dev seam. Full build
order, across all three repos, is **[RELEASE.md](RELEASE.md) §7**. Also still needed before
posting: **screenshots** (there are none anywhere), a **GitHub Release** with the installer
attached (none exist), and a plain note about SmartScreen on the unsigned installer.

**Before release: polished keyboard control (added 2026-09-13).** Every action a mouse can do
must also work from the keyboard, with a visible focus ring. Known gaps: search result rows
are `role="button" tabindex="0"` but Enter/Space do not play them; hover-only controls (the
Search Add-to-Library square) only show on `:focus-within`. Scope still to design on paper:
a Tab order per card, arrow keys inside lists and grids, Enter/Space/Menu-key on rows, Escape
to pop a drill pane, focus return after a menu or pane closes, and the fixed shortcut set in
[NEXT-VERSION.md](NEXT-VERSION.md) (`Ctrl+K` Search and friends).

**2026-09-11 — the Worker grew into a support back end.** The mint is now one route on
**`DeetsSupport`**, which also holds the status / suggestions / issues boards, anonymous
report intake and **remote config** for every Deets app. Scope:
**`DeetsSolutions/docs/support.md`** (source of truth for the repo, hosts and schema);
RELEASE.md §7 stays the source of truth for the mint itself, and now says: **60-day token,
15-day margin, one refetch on a 401, 30 req/60 s per IP**. The app compiles in
`music-api.deets.solutions/token`, never the `support.` host.

**The worker is built and deployed (2026-09-11)** — `../DeetsSupport`, both hosts live, `/token`
smoke-tested against Apple; the repo has no commits yet. Decided the same day: config rides
`/token` from a `CONFIG` **var** (no D1 on the mint path); the app re-runs MusicKit configure
after a 401 refetch (an event from Rust); `/health` signs a throwaway token. **Step 2 is built
and desk-tested (same day: `apple.json` moved away → `source=worker`, playback fine; a dead
cached token → one 401 refetch heals search AND an already-configured MusicKit):** `apple.rs` resolves the token once in `setup()` — local key,
else `developer-token.json`, else the mint — and `api_get`/`api_post` retry once after a 401.
To test the stranger's path: move `src-tauri/secrets/apple.json` away and start the app; the
log line `token: source=worker` confirms it. **Rate-limit finding (same day):** the
`unsafe.bindings` ratelimit form is inert; use the top-level `ratelimits` key (done here and
in all five sibling workers, redeployed and pushed the same day). Then,
on this side: the rolling log file, the report form, and **My reports** in Settings. The page
design and the report fields are the user's own pass.

**0.2.2 installer built 2026-09-11 late (`installers/`), for a desk pilot the next day:** the
log, the incremental sync, deets-airplay 0.2.1 (its log rotates too; DeetsAirplay 0.1.2 was
built the same night). Branch `polish`, not yet merged to `main`.

**Logging: steps 1–4 of [LOGGING.md](LOGGING.md) built 2026-09-11, all four desk-verified
(the flush blocks, the unload flush, the incremental line `1 new in 1 page(s)`).**
`src-tauri/src/log.rs` is the rolling `<app_data>/deetsmusic.log` (512 KB × 2, dated lines,
three levels, a panic hook, JWT / `Bearer` scrubbed at the write boundary); the old
`bridge.log` is adopted as `deetsmusic.1.log` on first run and `bridge::log` is an alias.
Startup, token source, every Apple ≥ 400 (status + path), library sync, enrich batches,
AirPlay, sign-in outcomes, migration and the bridge now write to it. `diag.flush()` appends the
front-end ring on an uncaught error, on unload and from **Settings › Bugs › Open log folder**.
Still to do: step 5, the report form + My reports (support.md). **The log's first catch:** the
startup library sync was a full ~40-request pass on every launch; it is now **incremental**
inside a six-hour window (newest-first, stop at the first cached song, upsert only; the
refresh button and a stale cache still run the full pass, which stamps `meta.full_sync_at`
in the cache db) — FUTURE-SETTINGS.md §21 holds the window as a later Settings row. Also fixed that day: `npm run
dev:app` opened TWO full windows — the dev overlay's bare `windows` array replaced the real one
(JSON merge patch), so the tray label lost `tray.html` and loaded the app; the launcher now
stamps "(dev)" onto the full window objects.

**AirPlay: in v0.2.0, desk-tested in dev.** See [AIRPLAY.md](AIRPLAY.md): the sender is the
shared `deets-airplay` crate (git dependency on DeetsAirplay, pinned by `rev`; read that
repo's CLAUDE.md "Never" list before touching wire code). Decisions are locked in §5; v1 =
"All PC sound", the per-process path is parked for v2 (§10). **0.2.1 is desk-tested installed:
prompt shown, speaker plays.** Open: the firewall prompt frightens a first-time user — preface
it with an in-app confirmation or a toast (AIRPLAY.md §9 item 5; toasts exist now, TOASTS.md).

**2026-09-12 — the click-to-sound pass (branch `polish`, desk-tested via the MCP).**
Dev-only telemetry (`src/perf.ts`, [DEBUGGING.md](DEBUGGING.md)) measured every stage
from click to the media element's `playing` event, then five changes landed
([QUEUE.md](QUEUE.md) windowing, [UX-COVERUPS.md](UX-COVERUPS.md) §4–5): the track
store notifies only when a transient ingest added something and the Library card ignores
transient ingests (a full 3,895-row re-render on every click, 100–370 ms, gone); the click
click feeds the clicked song alone as a MediaItem descriptor from the cached play
parameters (`setQueue` ~5 ms; its network resolve, 130–1300 ms, gone), then grows by id
at once (8) and to 200 after 1.5 s — **MusicKit's auto-advance cannot load a descriptor
item** (found and fixed the same day: it ends with no item), so everything after the
clicked song is id-resolved; MusicKit + the Widevine module warm at idle 1.5 s after
launch; a song that fails to start heals by re-window (explicit Next, auto-advance, and a
dead id in the grow all verified). Our part of a click is now ~10 ms; what remains is MusicKit's own
teardown/lookup/license/buffering, 1.0–1.7 s warm and 1.7–1.9 s cold to audible. The
next levers were settled 2026-09-13: hover pre-insert **skipped**; the launch story is a
setting, [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) §22 *Play on launch* (last song / a
station / a playlist in order or shuffled / a song or album, plus starred playlists as a
random pool), documented, not built. Library windowing (option A) is **built** — see the
2026-09-13 entry above and [LIBRARY-VIRTUALIZATION.md](LIBRARY-VIRTUALIZATION.md) §Results.
**Same day, built and verified:** the queue **restores across sessions** — one JSON blob
in the cache db's `meta` (`queue-persist.ts`, QUEUE.md "Restore across sessions"), the
**Restore on launch** settings row (*Last song* default / *Up Next* / *Nothing*), Play
with nothing loaded resumes the restored plan. It restores the plan only: pre-feeding
MusicKit was probed and rejected (`setQueue` fetches nothing, no `prepareToPlay`;
UX-COVERUPS.md §4), so the first Play still pays the cold cost.

**The v1 push** — sequence discussed 2026-07-03 (each item still wants its own design/confirm
pass before building; the user directs):
1. ✅ **Settings card** — built 2026-09-10 as the **hybrid** ([SETTINGS.md](SETTINGS.md)):
   the title menu keeps Theme / Skin / Surface / Account + one **Settings…** row that
   summons the card; the card hosts the rehomed toggles (Always on Top, Minimize to Tray,
   hover menus, Library Add, the Extension block), eight FUTURE-SETTINGS rows (§1 §4 §5a
   §5b §7 §8 §14 §16) and the **Rewind gate** (hidden until 50 play starts). One typed
   store, `deets.settings`. In use.
2. **Release packaging** — secrets/cache out of `CARGO_MANIFEST_DIR` into proper app dirs,
   MUT into Windows Credential Manager, an installable build (the one true v1 blocker).
3. ✅ **SMTC / global hotkeys** — built 2026-09-10 as a **native session** (`src-tauri/src/smtc.rs`,
   registered on the main HWND from `setup`, fed by `np_publish`). The Chromium route was
   probed and found half-working: media keys toggled play, but WebView2 never registered a
   session, so the Win11 overlay stayed blank. The probe (`media-session.ts`) is deleted and
   Chromium's `HardwareMediaKeyHandling` is disabled in `tauri.conf.json` so a key press is
   handled once. Overlay buttons / keys / the overlay scrubber arrive as the same `np-command`
   events the tray panel sends. In use.

**Built 2026-09-08, in use** (each has its own doc — read it before
touching the area): the **tray icon + panel** and **Minimize to Tray** ([TRAY.md](TRAY.md));
the **browser extension + loopback bridge** ([EXTENSION.md](EXTENSION.md), source in
`extension/`, shipped inside the NSIS installer with a post-install prompt). The app icon is
now the DM mark (`app-icon.png` → `npx tauri icon`). The Web Store listing is the user's step.
**2026-09-09 polish:** tray left-click now pops the *app* as mini at the cursor
(TRAY.md §1; the panel moved to the right-click menu); the extension's status line
slides/crossfades instead of jumping; "Not it?" opens a mini Search card (songs +
albums, `/search`); the popup re-reads the tab every 2 s. **Pairing code dropped**: the
bridge trusts the extension's `Origin` (EXTENSION.md §3). Tray right-click *Open* now
restores the real app (full surface + pre-pop position). Mini = one wide column, one
card under Now Playing (user-led from here). **Surfaces:** all three width cutoffs are back
(mini: in < 340 / out > 350 · midi ↔ max at 820 ± 40; `minWidth` lowered to 320 so the
flip into mini is actually reachable) — the user is evaluating resize-into-mini alongside
the tray flyout and the menu pick. **Next:** the mini composition, piece by piece.
**2026-09-09, branch `maxmaxxing` (merged):** the **max composition** (stage + anchored
queue + 2×2 bento, [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) build order #4); the
mini transport row stacks its side buttons when they'd overflow; and the **agent/CLI
routes** on the bridge (`/command` `/play` `/queue` `/history`, [AGENT.md](AGENT.md)) —
plus the `deetsmusic` CLI + MCP binary in `cli/` and `npm run dev:app` for dev alongside the installed app.
**2026-09-09, 0.1.3 (installer line, user-tested):** **one instance only** — the pinned
taskbar button now activates the running app instead of starting a second process
([TRAY.md](TRAY.md) §5); *Open DeetsMusic* is one **clean cut** (hide → resize hidden →
place → show) instead of a visible grow-and-travel; the window **position survives** × and
restart (`settings.json` → `windowPos`); and the NSIS installer **stops the bundled CLI**
before install/uninstall, which is what a half-uninstall of 0.1.2 cost us
([RELEASE.md](RELEASE.md)). `npm run release` now archives each setup exe into `installers/`.

**2026-09-10, branch `release-prep` (merged):** **stations in Search** (a fifth search type,
[SEARCH.md](SEARCH.md)); the **native Windows media session** (`smtc.rs`, item 3 above); the
**radio UX pass** ([STATIONS.md](STATIONS.md) §3b — the station is Up Next's last row, Stop
Station in three right-click menus, the station resumes after a break-out block, Stop leaves
the last song paused); **Library Add now defaults ON**. Second batch, same day: the **Add to
Library square** on Now Playing (+ / spinner / ✓, [FAVORITES.md](FAVORITES.md)); the **max
stage volume row** (mute · slider · a hidden AirPlay square; the titlebar pill stays;
`onVolumeChange` in `player.ts` keeps every control in step); the **Settings card + hybrid
menu** ([SETTINGS.md](SETTINGS.md) — one `deets.settings` store, the v1 rows, the Rewind gate
at 50 play starts; **Play Now now defaults to "Song and rest of list"**). Third batch, same day: **AirPlay**
([AIRPLAY.md](AIRPLAY.md)) — `../DeetsAirplay` is now a library crate (`crates/airplay`) this app
depends on (git, pinned by `rev`); the "Play on" panel behind the AirPlay square (pill
panel in mini/midi, stage row in max), **v1 = "All PC sound"** (loopback of the default
output; the PC keeps playing), one volume slider driving the speaker, now-playing text +
cover to the speaker, no Settings rows. **Connected and played on the desk.** The per-process
"DeetsMusic only" path is built, probe-verified, and parked for v2 behind `V2_PER_PROCESS`
(AIRPLAY.md §10 lists the five things learned about it). Also that evening: **per-speaker
remembered volume** (20 % on a speaker's first use), **Settings › Agents** (Agent control
switch, default on, gating the six agent routes with a 403; "Copy setup for" Claude Desktop /
Claude Code / Cursor / Other; the plain-words [AGENT-SETUP.md](AGENT-SETUP.md)), and
**Start with Windows** (HKCU Run key, `--tray` launch starts hidden; seeded once on the first
installed run, DeetsAirplay pattern).

**Deferred, when prioritized:** **DeetsWeather** ([DeetsWeather.md](DeetsWeather.md);
its own-station premise needs a rethink — that engine was dropped) · **CLI / local-agent
control** · **mini/max surface compositions** · **virtualized scrolling** (only once libraries
get large).

---

## State of play

### Built ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights wired to min/max/close.
- **Themes** (palette → theme → skin, all CSS-variable driven): `lilac`, `green`, `sepia`,
  `moonlight`, `black-yellow`, `black-red`. Title menu (click the title) with Theme / Skin /
  Surface flyouts, a **Settings…** row (summons the Settings card, [SETTINGS.md](SETTINGS.md)),
  and the Account row. A first launch with
  no saved choice follows the OS light/dark preference, landing on Press × Lilac or
  Retro-Future × Black & Red; retired ids (`fairy`/`glade`/`hornet`/`viper`/`desk`/`cyberstorm`)
  migrate via the `RETIRED` maps in `theme.ts` / `skin.ts` and the pre-paint script in
  `index.html` — keep all three in sync.
- **Skins**: `vanilla` (borderless + editorial underline; hidden from the picker since
  2026-09-10, block kept as the base), `press` (riso print shop —
  square trim, halftone stock, offset `--ink-2` plate), `ocean` (recessed cards + SVG wave
  trains), `glass` (frosted, drifting aurora), `retro-future` (lightning storm layer).
  Shared `[data-skin]` base + per-skin deltas; nav/motion/geometry fully tokenized (new
  capabilities like `--hover-lift` / `--panel-backdrop` default to no-ops).
- **Card + slot system** (`cards.ts`, `layout.ts`; [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md)):
  every card is a mountable registry module. Midi bento = anchored **Now Playing** + **two
  swappable content slots**, each slot's **title is a card picker** (persisted, root-only).
  **Surface seam** (`data-surface` mini/midi/max) exists with size-band resize + per-surface
  remembered sizes; mini/max inherit the midi layout until composed.
- **Apple auth**: loopback browser sign-in (themed page), MUT persisted across restarts.
- **Playback** (the load-bearing DRM risk is dead — full-song plays in WebView2): `player.ts`
  configures MusicKit JS in the webview, injects the captured MUT directly (no `authorize()`
  popup), plays. Live drag-to-seek scrubber + volume (shared `slider.ts`, persisted). Catalog→
  library id fallback; **dead-id self-healing** (stale catalog ids don't sink a feed batch).
- **Queue model** (`queue.ts`, [QUEUE.md](QUEUE.md)): history / current / upcoming of lightweight
  handles; origin-based stacking (manual picks survive a new context); backgrounded pre-click
  backlog reachable via Previous. Player keeps it **live-synced to MusicKit** (model-follow) and
  feeds MusicKit a bounded **window** with gapless **re-windowing** (forward top-up +
  Previous-past-the-edge). Manual queueing (Play Now/Next/Add) + Up-Next drag-reorder, all gapless.
- **Data**: `library_sync` pulls all songs → SQLite → **collection-card engine**
  (`collection-card.ts`) with per-context Sort/View/Search. **Lazy catalog enrichment**
  (`enrich.rs`) pulls only what you touch (palette / ISRC / previews ride every fetch). Unified
  `tracks` store on the catalog-first key (`seen`→`library` graduation). **Play-event log**
  (`play_events`, real `ms_listened`) — the un-backfillable clock is running.
- **Feature cards** (all on the collection-card engine unless noted):
  - **Library** — Songs / Albums / Artists (albums/artists derived from songs), drill-in, click
    a song to play + queue the rest in sort order. **Artists consolidate by PARSED credit**
    (2026-07-03, `src/artist-credit.ts`): a vocabulary of solo-proven names splits compound
    credits ("Drake & Future" → both; "Earth, Wind & Fire" stays whole), multi-indexed so a
    collab lands under every credited artist (placement toggle: FUTURE-SETTINGS §19). True
    catalog artist identity is still the post-v1 hydrate below.
  - **Search** ([SEARCH.md](SEARCH.md)) — standalone sectioned discovery (songs/albums/artists/
    playlists), enrichment piggyback, transient + materialized catalog tracks.
  - **Playlists** ([PLAYLISTS.md](PLAYLISTS.md)) — Apple mirror + local store; overview → detail;
    New Playlist, Add to Playlist ▸ submenu, remove-track, empty-only delete. **Folders**
    (2026-07-03, §3a): manual folders + kind auto-clusters (Your Playlists / Apple Mixes /
    From Apple Music) as collapsible sections under the Folders sort; Move to Folder ▸ files
    locals AND mirrors (local metadata, zero Apple calls). Remaining: rename +
    drag-reorder (Rust commands exist), non-empty delete, mosaic covers, gated export.
  - **Queue** (`qcard.ts`) + **History** (`history-card.ts`) — Now Playing + Up Next / session
    play log; shared row markup (`queue-rows.ts`).
  - **Rewind** ([DEETS-REWIND.md](DEETS-REWIND.md)) — listening leaderboard (stat × time-window)
    over the play-event log.
  - **Radio** ([STATIONS.md](STATIONS.md)) — Apple's live / My Station / Discovery / genre
    stations as shelves (Recently Played · For You · Live · Genres); activate → **radio-mode
    playback** (station queue owned by MusicKit; break-out to a finite queue at the song
    boundary; transport caps + LIVE marker; station plays populate History/Rewind durably).
    Data: `radio.ts` + `radio_live`/`radio_my_station`/`radio_discovery`/`radio_genres`/
    `radio_genre_stations`/`radio_seed_station`/`catalog_song_artist` in `apple.rs`. **Seeded
    "Start Station"** right-click verb on every song surface + artists (Search, and Library
    Artists tiles via a lazy two-hop song→artist-id resolve — `src/start-station.ts`, gated
    builders, session-cached). **The own-station generator engine (Deezer BPM, scope toggle,
    thumbs) is DROPPED** — Apple curated is the whole radio story; §4 of the spec is
    research-record only.
- **Album Color** ([ALBUM-COLOR.md](ALBUM-COLOR.md)): real Apple palettes → `--album-*` runtime
  roles → the rotating Now-Playing aurora (Glass-only display).
- **Add to Library** ([FAVORITES.md](FAVORITES.md)): ➕ add a catalog song/album to iCloud Music
  Library, gated behind the **Library Add** settings toggle (default on since 2026-09-10), on Search / Playlists /
  **Queue / History** right-click menus (incl. the now-playing hero). Apple's API is add-only.
- **Go to Artist / Go to Album** (2026-07-06, [SEARCH.md](SEARCH.md)): drill-in right-click verbs on
  **every** song/album surface (Search, Library, Playlists, Rewind, Queue, History, Now Playing —
  NP gained its first menu). Shared builders in `src/go-to.ts`; the id hop is `catalog_related` in
  `apple.rs` (session-cached via `catalogRelated`). Most surfaces route to the **catalog** detail in
  the Search card; the **Library drills IN-PLACE** over the user's library (`LibNav` in
  `library-card.ts`). In-place vs Search is a toggle: FUTURE-SETTINGS §20.

- **2026-09-13 — toasts** ([TOASTS.md](TOASTS.md)): the primitive, the `toasts` tier
  setting, and the ten call sites above. **Awaiting the first desk test.**
- **2026-09-12 — the NEXT-VERSION batch, all desk-verified** ([NEXT-VERSION.md](NEXT-VERSION.md)):
  search pins · playlist covers (user / Apple / mosaic; schema v3 `cover`) · ♥ favorites
  (`favorites.rs` + `favorites.ts`, seeded from Apple's Favorite Songs; the Library ♥
  filter) · weekly Replay (`replay.ts`, three Playback rows) · Search square + Ctrl
  shortcuts · theme/skin View Transitions (`appearance.ts`) · album-colored NP text with
  the contrast guard (Glass) · Glass menus at 90% · explicit badge. Surface-change motion
  (fork B) was tried and walked back the same day (NEXT-VERSION §10). **Next talk: the
  playlist creation flow** (NEXT-VERSION §11).

### Not built yet ⬜
- **Next-version feature notes (2026-09-11)** — pinned search terms · playlist artwork ·
  favorite songs · weekly replay playlists from Rewind · a Search/quick-access shortcut.
  Scoped with the real forks in **[NEXT-VERSION.md](NEXT-VERSION.md)**. None designed yet.
- **♥ Favorites** — the love-only ♥ (Apple `PUT +1`) + local mirror + ♥ on Now Playing / menus.
  Parked, explicitly not the next step (user's call). **Ratings / 👎 are off the roadmap.**
- **Real album/artist data + artist photos in the Library card** — Library's Albums/Artists are
  derived from song artwork + initials (Search's artist drill already shows real photos). Scoped
  2026-07-03: **bigger than it looks** — the Artists overview shows hundreds at once, so lazy
  per-touch enrichment can't fill it (needs an eager one-time backfill, a deliberate exception
  to the enrichment doctrine with a §14-style opt-out) *and* it needs new schema (artist cache
  table), so it should bundle with the deferred schema-versioning work as one post-v1 pass.
  (Start Station on artist tiles does NOT wait for this — shipped via the lazy two-hop resolve.)
- **Hosted sign-in page + `deetsmusic://` deep link** — designed 2026-09-13, forks settled.
  [DATA-ARCHITECTURE.md §2a](DATA-ARCHITECTURE.md).
- **CLI / local-agent control** · **mini/max surface compositions** ·
  **virtualized scrolling** · **playlist rename / drag-reorder / export UX**.

---

## Known gotchas
- **Registry writes from a Claude desktop session are not real (2026-09-13).** The Claude
  app is an MSIX package: every process it starts — its shells, and `npm run dev:app` run
  from them — writes `HKCU\Software\Classes` into a private hive. Those processes read the
  keys back; Edge and every other program do not. This hid the `deetsmusic-dev://` scheme
  for a whole session of "Edge drops the link". Anything that must reach the real registry
  (the deep-link scheme, file associations) has to be written, and checked, from a process
  started outside the package — the user's own terminal, or WMI (DEBUGGING.md §Sign-in).
- **The tray flyout hides the taskbar button, and that used to spawn a second process** —
  `set_skip_taskbar(true)` on a pop (and a hidden window after × to tray) leaves Windows
  nothing to match the pinned shortcut against, so a click on the pin *launched* the exe
  again: second tray icon, second writer on the SQLite file, bridge failed over to port
  47826. Fixed by `tauri-plugin-single-instance`, which **must stay FIRST in the builder**
  (`lib.rs`) or the duplicate opens the DB and takes a port before it's turned away. Its
  callback is `tray::show_main`. See [TRAY.md](TRAY.md) §5 — including why two DeetsMusic
  taskbar icons in dev are expected, and why a debug build flashes a console.
- **A running `deetsmusic mcp` blocks install and uninstall** — Windows won't replace or
  delete an open file, and the CLI is long-lived (an MCP session lasts as long as the agent).
  Uninstalling 0.1.2 removed the registry entry and then left every file on disk. The NSIS
  `PREINSTALL`/`PREUNINSTALL` hooks stop it by path; see [RELEASE.md](RELEASE.md) §3.
- **No in-app OAuth popups** (Tauri/WebView2) — auth is browser-loopback by design (via
  `tauri-plugin-opener`, cross-platform); don't try to "fix" `authorize()` in the webview.
- **Liberation + skin fonts aren't on Windows** — bundled locally; the loopback page serves them
  too (embedded) so it matches the app.
- **Dev-oriented paths**: secrets/cache resolve from `CARGO_MANIFEST_DIR`; release needs them in
  proper app dirs + the MUT in Windows Credential Manager. `dev-dumps/` holds **real account
  data** — gitignored, don't commit.
- **Playback transport races (MusicKit)** — three load-bearing rules, all in `player.ts`:
  - `changeToMediaAtIndex` **already starts playback**: never `play()` after it, and never call
    `changeToMediaAtIndex(0)` on a fresh queue (setQueue sits at 0 — the call makes MusicKit
    double-play against itself). `play()` belongs only on the pos-0 path, guarded by `!isPlaying`.
  - **Leaving a station needs `stop()`, not `pause()`** — a paused continuous controller stays
    primed to advance and AbortErrors the next `setQueue`. The station break-out loads with
    `stopFirst` + `noBack` (block at index 0, clean pos-0 path).
  - MusicKit re-issues `play()` on its **own un-awaited promise chains** during transitions,
    surfacing benign "Uncaught (in promise)" races we can't try/catch. A scoped
    `unhandledrejection` filter (`installMusicKitRejectionFilter`) swallows exactly two messages
    (`play() without a previous stop()/pause()`, `interrupted by a new load request`); everything
    else propagates.
- **Stale catalog ids reject whole feed batches** — `setQueue`/`playNext`/`playLater` are
  all-or-nothing; the player self-heals (session denylist + library-id fallback + rebuild/retry;
  `player:deadIds` diag). See [QUEUE.md §Dead ids](QUEUE.md).
- **Catalog tracks resolve through two layers** — the track-store `transient` map (session
  display) and Rust `source='seen'` rows (durable stats joins). `handlesFrom` feeds both on every
  play; `loadTracks` ingests seen rows at startup. Station plays go through `stationFollow`, whose
  gate skips only the **station container** (`ra.…`) item — NOT on kind/type (station-fed songs
  don't reliably report `kind:"song"`, and gating on it silently dropped every station play from
  history). If a catalog/station song shows "Unknown", that funnel broke, not the queue/log.
- **Model-follow keys off `music.queue.position`** (replays `advance()`/`previous()` on position
  change, suppressed during (re)loads via `loadingContext`, and off entirely in radio `mode`). If
  a MusicKit build reports position differently, fall back to matching `nowPlayingItem` by id.
- **Covers self-heal — don't add per-`<img>` onerror** — emit the `<img>` with a bare `data-art`
  marker; one capture-phase listener in `artwork-heal.ts` owns all retry (backoff + cache-bust +
  focus/visibility resume sweep). Chromium negative-caches a failed cover, so this is the only
  thing that recovers a sleep/wake-killed image.
- **Transport latency to cover up** — nav within MusicKit's window is gapless; anything **outside**
  it (rewind past the backlog, seek, scrub a DRM stream) forces a fresh `setQueue` and **buffers**.
  Needs a UX cover-up (loading state / optimistic icon), not a silent freeze. See [UX-COVERUPS.md](UX-COVERUPS.md).
- **Collection-card CSS traps** — the list/grid density hook is `data-grid`, NOT `data-density`
  (the buttons use `data-density`; reusing it makes the click handler swallow every tile click).
  Restore scroll *after* a pane mounts (in `slide()`), never while detached. `.coll-pane`'s
  transform traps `position: fixed`, so Sort/View popovers **portal to `<body>`**. Every card
  renders music through **`musicCell`** (row-vs-tile + density in one place) — keep new cards on it.
- **Added-Date needs a re-sync** — old cache rows lack `addedRank` until a refresh re-fetches with
  `sort=dateAdded`.

---

## Key decisions (the "why")
- **Data ≠ playback** — library fetching is plain REST (no DRM); the whole data layer was built
  without touching the DRM question.
- **Full-song DRM plays in WebView2** (confirmed) — MusicKit JS in the renderer, MUT injected
  directly. The MUT necessarily reaches the renderer for this one path.
- **Queue model is the source of truth**, decoupled from MusicKit; the player feeds MusicKit a
  bounded window (cheap setQueue + gapless play) and mirrors position back. Lightweight handles
  (ids), not full Tracks — cheap on huge libraries; metadata resolves via the shared track store.
- **Normalization in a Rust `MusicProvider` trait** — UI is provider-agnostic (a second provider
  slots behind the same seam; only playback is MusicKit-specific).
- **Unified `Track`** with both IDs optional (not split library/catalog types).
- **Persisted SQLite cache + sync-on-open** (stale-while-revalidate) — instant launches, offline
  browse; ~76 polite calls per refresh.
- **Loopback browser auth** as the permanent flow, not a workaround.

---

## File map
```
index.html                  home markup (titlebar, settings menu, bento)
swatch.html                 standalone color reference
src/main.ts                 window controls, settings menu, account, toggles, initLayout
src/cards.ts                card registry + CardDef/CardInstance (mountable-card contract)
src/layout.ts               midi layout: anchored NP + 2 swappable slots + picker + slot LRU
src/layout-bus.ts           card-summon bus (requestCard/onCardRequest)
src/now-playing-card.ts     Now Playing transport strip (+ radio LIVE caps)
src/collection-card.ts      reusable navigable browser engine (contexts/groupings, Sort/View/
                            Search, push/pop pane-slide, list(view) state hook)
src/library-card.ts         Library contexts/groupings + drill-in; shared musicCell + trackMenu
src/artist-credit.ts        credit-string parser: vocabulary-gated split → consolidated Artists
src/search.ts / search-card.ts    catalog search data + Search card (SEARCH.md)
src/playlists.ts / playlists-card.ts   playlists data + card (PLAYLISTS.md); Add-to-Playlist ▸
src/qcard.ts                Queue card: Now Playing + Up Next + jump-to-item + right-click menus
src/history-card.ts         History card: session play log (hero + "Previously")
src/queue-rows.ts           shared queue-row rendering (entry→Track resolve, .qrow markup)
src/rewind.ts / rewind-card.ts    Rewind data + leaderboard card (DEETS-REWIND)
src/radio.ts / radio-card.ts      Radio data (session cache + recents) + stations browser card
src/library-add.ts          Add-to-Library toggle + gated menu-item builders (FAVORITES.md)
src/start-station.ts        seeded "Start Station" gated menu-item builder (STATIONS.md §2)
src/go-to.ts                "Go to Artist/Album" menu-item builders + drill-intent bus (SEARCH.md)
src/player.ts               MusicKit engine: init/MUT-inject, windowed loadFromModel, transport,
                            model-follow, radio mode (playStation/stationFollow/stopStation)
src/queue.ts                queue model (history/current/upcoming, backlog, stacking, radio ops)
src/track-store.ts          shared in-memory library: one load, id→Track index + notify
src/stats.ts                play-stats recorder: partial/full counters + play-event log
src/album-color.ts          NP aurora data path: current album palette → --album-* inline
src/context-menu.ts         shared popover: cursor/element-anchored; action/input/submenu items
src/dropdown.ts             shared dropdown primitive + menu-mode fan-out
src/theme.ts / skin.ts / surface.ts / storm.ts    token-tier switches + surface bands + storm layer
src/slider.ts               shared slider primitive (scrubber, volume)
src/diag.ts                 diagnostics ring buffer + window.__diag
src/toast.ts                the transient-notice primitive + window.__toast (TOASTS.md)
src/artwork-heal.ts         cover-<img> self-healing (data-art marker; capture-phase retry)
src/styles.css              app rules (imports token sheets first)
src/styles/qcard.css        Queue/History/Rewind card styling
src/styles/toast.css        the toast host (per-surface position) + strip
src/styles/{palette,themes,skin,fonts}.css + fonts/    the three token tiers + bundled fonts
src-tauri/src/lib.rs        Tauri builder: state, DB open, command registry, devtools
src-tauri/src/apple.rs      dev-token signing, loopback auth, AppleProvider, catalog + radio cmds
src-tauri/src/model.rs      normalized model (Track/Album/Artist/Playlist/Station/…)
src-tauri/src/provider.rs   MusicProvider trait
src-tauri/src/library.rs    SQLite cache + sync + play_stats/play_events + unified track store
src-tauri/src/enrich.rs     lazy catalog enrichment: storefront cache, batch fetch, palette cache
src-tauri/src/playlists.rs  playlists: local store + CRUD, Apple mirror sync + content cache
src-tauri/src/tray.rs       tray icon/menu, window policy, single-instance activation (TRAY.md)
src-tauri/src/settings.rs   back-end settings.json: minimizeToTray, readWindowsMedia,
                            bridgeToken, windowPos
src-tauri/src/bridge.rs     loopback bridge: Hub state relay + extension/agent routes
src-tauri/src/media.rs      Windows media session (GSMTC) + master volume
src-tauri/nsis/hooks.nsh    NSIS hooks: stop the CLI pre-(un)install, offer the extension
cli/                        the `deetsmusic` binary: CLI + MCP server (AGENT.md)
extension/                  MV3 browser extension source (EXTENSION.md)
scripts/dev-app.mjs         generates the dev identifier config for `npm run dev:app`
scripts/cli-dist.mjs        stages cli/dist/deetsmusic.exe for bundle.resources
scripts/archive-installer.mjs   copies each shipped setup exe into installers/
installers/                 local archive of shipped NSIS installers (gitignored)
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

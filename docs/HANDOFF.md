---
status: sop
desk_test: none
sources: [src/toast.ts, src/player.ts, scripts/shots.mjs, scripts/sign.mjs, src/perf.ts, src/room.ts, src/dropdown.ts]
updated: 2026-10-20
---
# DeetsMusic — Handoff

> Cold-start guide — read first. A lightweight Apple Music player for Windows 11:
> **Tauri v2 + WebView2**, vanilla **TypeScript** front-end, **Rust** back-end.
>
> **This file holds what is still true:** how to run and ship the app, what is open now, the
> state of play, the gotchas, the key decisions and the file map. It is corrected in place.
> **The record of each sitting** — what was built, the desk-test scripts, what was decided —
> is [WORKLOG.md](WORKLOG.md), newest first. Split on 2026-09-21 (DOCS-ORG.md §7).

**The docs, by folder** (`CLAUDE.md` › Docs lists every one in a line): `architecture/` the
engine · `cards/` card behavior · `features/` one surface or feature · `integrations/`
anything that talks outside the app · `ops/` build, ship, diagnose · `ideas/` not built ·
`guide/` the user guide (DOCS-ORG.md §13). Each doc's state is its front matter;
`npm run docs:check` proves the links, the section pointers and the versions.

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
The bridge just takes the next free port (the CLI probes the list).
Seed the dev dir once by copying `deetsmusic.db` + `user-token.txt` from the release dir
(zero Apple calls); localStorage (theme/skin/layout) starts fresh.

Devtools **auto-open in dev** (`lib.rs` setup). Debug the player in the console:
`__diag.dump()` / `__diag.copy()` (ring buffer of transport + MusicKit events + desyncs,
auto-captures uncaught errors), `__music` (live instance), `__player.snap()`. Full reference:
[DEBUGGING.md](ops/DEBUGGING.md).

**Dev telemetry + driving the app from a session (2026-09-12).** In dev every song click
(and Next) prints `[perf] click→sound N ms · model+render · setQueue · stream` to the
console and writes the same line, plus MusicKit's own request list, to the dev log
(`%APPDATA%\com.deetsmusic.dev\deetsmusic.log`). The `deetsmusic` MCP drives playback
(`play` returns after the song starts), so a session can run a play, tail the log, and
read the stage split without the devtools — that is how the click-to-sound pass was
measured and verified (cold vs warm, natural advance via `control seek 97`, dead ids,
the queue restore via a restart). Recipe and limits: [DEBUGGING.md](ops/DEBUGGING.md)
"Driving it from outside" and `CLAUDE.md` "How to verify your work". None of it ships:
`src/perf.ts` is gated on Vite's `DEV` flag.

## Ship it (installable Windows app)

Full procedure — version sync, the build stages, Authenticode signing (§6.9), the NSIS hooks,
install, uninstall, publishing and the updater (§6, shipped in 0.4.3) — is in
**[RELEASE.md](ops/RELEASE.md)**; §0 is the one-page overview of commands, secrets and keys. The
short version:

```bash
npm run release          # secrets → cli:build → sign → tauri build (signed + .sig) → release-check → archive; ~3 min cold
npm run release:publish  # after testing the installed build: R2 upload + update index → installs update
```

Since 0.28.0 (Velopack) it produces `installers/velopack/<Id>-<channel>/`: the full and delta
`.nupkg`, `<Id>-<channel>-Setup.exe` (~23 MB) and the signed feed. That folder keeps every
version and is never pruned. The Setup.exe is also copied to
`installers/DeetsMusic_<version>_x64-setup.exe`, beside the NSIS ones up to 0.27.0
(RELEASE.md §2). All gitignored. Installs per-user to `%LOCALAPPDATA%\DeetsMusic` with **no admin prompt**.
A release needs two Credential Manager entries (`DeetsMusicUpdaterKey`,
`DeetsMusicAzureSigning`), the updater key file, and the signing tools in
`%LOCALAPPDATA%\DeetsTools\artifact-signing` (RELEASE.md §0 table).

Things that bite:

- **Use `npm run release`, not `tauri build`.** Only `release` runs `cli:build` first, which
  stages `cli/dist/deetsmusic.exe`. `tauri build` alone ships the **previous** CLI, silently.
- **The version lives in SIX files** — the list is [RELEASE.md §1](ops/RELEASE.md).
  `release-check` compares four (`package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `cli/Cargo.toml`) and fails *after* the bundle is built and signed;
  `docs:check` check 5 covers both `Cargo.lock` files. Run `cargo check` in `cli/` before the
  version commit. The parked extension's manifest is no longer bumped (2026-10-23).
- **A running `deetsmusic mcp` blocks install AND uninstall.** Windows won't touch an open
  file; uninstalling 0.1.2 removed the registry entry and then left every file on disk. The
  Velopack hooks stop our CLIs by path before an update and an uninstall (RELEASE.md §3; the
  NSIS hooks did it from 0.1.3 to 0.27.0, [RELEASE-NSIS.md](archive/RELEASE-NSIS.md) §3).
- **The staged exe is unsigned after a good signed build.** `vpk` signs copies, so
  `src-tauri/target/velopack-stage/DeetsMusic.exe` stays NotSigned. Check the package or the
  installed `current\DeetsMusic.exe` instead (RELEASE.md §6.9).
- **Save secrets with `scripts/cred-write.ps1`, not `cmdkey /pass`.** A paste into the hidden
  `cmdkey` prompt stored extra characters on 2026-09-15 (Azure: "Invalid client secret").
- **A secret expires:** the Azure client secret on **2027-03-14** (runbook RELEASE.md §6.9).

Icon: `app-icon.png` (the DM mark, DeetsAirplay/DeetsRGB lineage — transparent background,
scarlet `#E8341C` D + burgundy `#7A1A2E` M, 2026-09-09). Regenerate every size + the `.ico`
with `npx tauri icon app-icon.png` (delete the `android/` / `ios/` dirs it also emits); the
extension's icons are LANCZOS resizes of the same file.

---

## Open now

- **Replies reach the filer + the admin Inbox (2026-10-26, committed, his desk test open).**
  The app part ships with the next release; the site part (DeetsSolutions) is LIVE since
  2026-10-26 (d6a6528 pushed). The Inbox strings await his OK. WORKLOG 2026-10-26.

The short list of what is not finished, as of 2026-10-19 (pruned for 0.30.0: everything that
shipped or closed went out; the WORKLOG has each day). Each item names where the detail is.
When an item closes, delete it here and write the day in WORKLOG.md. `seventheenth` and
`v-thirty` are merged into `main`; so is `v-thirtyone` (fast-forwarded 2026-10-20, his call),
which carries `ideas-nineteen` and `net-worked`. Everything up to the 0.30.0 release commit
(`b4dffde`) is on live; the work committed after it waits on the next release (0.31.0).

### Open on live: text to fix, watches, data to read

Every hand and desk test listed here before closed on 2026-10-13 (his report, WORKLOG
2026-10-13 *desk tests closed*; the rows are DESK-TESTS.md §5). What is left:
- **Metal's full player drew the cover as a tall strip (0.31.0 on live): fixed and committed
  2026-10-21, ships with the next release.** The box from the square (his call A; the band at the
  cover's width stays, his call after the test), the drum's perspective grows with the cover
  (§6.8.2), the title block under the cover with Cover change = Zoetrope (§6.8.3). The same
  evening's Metal polish, all hand-tested by him: the side covers in the open's flight, the
  Queue list's height following the card, the tray's texture, the textures baked per surface
  color with no blend modes, no texture in software drawing, blank sleeves in empty side slots
  (metal.md §6.7, §6.8). Closed as demo only: the empty previous side cover, the 120 ms close.
  Not measured: the scroll's dropped frames since the bake. The site's demo shows the fix after
  the next release and demo build.
- **Playback, watch the live ring:** the music stopped at a song change and the catalog heal
  (`player:retryCurrent`, `keyRetry`, `recoverSilent`; QUEUE.md); a healed library id's old
  play counts may stay on the old key (read 2026-10-17: the 5 healed songs on live have no
  plays under either id yet, so there is nothing to check). None of these fired on live from
  2026-10-08 to 2026-10-17. (The dead-next heal fired on live 2026-10-17 and played the song
  once: QUEUE.md § The healed song played twice, passed.)
- **Data:** the next song's colors one ahead (ALBUM-COLOR.md, data path item 4). The `db: slow`
  lines were read on 2026-10-13: the read connection is real but not on the launch's path, so
  it stopped there (ideas/WORKERS.md §5.1). What gates `ready` is the library reply itself.
- **deetsmeter's cold start** (below).
- **Readability (2026-10-14):** the first run of the readability check ([the checks archive](ops/checks/README.md), its part 2b)
  failed `--subtext` in Lilac, Green, Sepia and Moonlight in every skin. New paints are built,
  reviewed on the sheet by him and committed (WORKLOG 2026-10-14 *readability, part 2*): the
  opaque skins pass, live since 0.28.0. Open: Ocean's see-through card (50 % under the bar) and
  Glass in Moonlight and Black-Red. Run the check again after any fix.

- **The Deets head icon:** live since 0.28.0, and DeetsSolutions `38abe54` is pushed. The sign-in
  icon (DeetsSupport `201bd06`) is live since the 2026-10-16 deploy. The sign-in page's mark is
  sharp at every display scale since 2026-10-17 (DeetsSupport `16f8f45`, deployed). Left: the
  Discord art asset (his upload). whitelabel.md §10.6 › *Before it goes live*, item 3.
- **Optimization, in his order (his call, 2026-10-17).** The measurement, from a side session on
  live 0.29.0, paused, 20 s: the Rust process has 37 threads (main, watchdog, 16
  `tokio-rt-worker` (one per logical core), db, deets-bridge, audio-out, apple-calls,
  airplay-np, presence, 2 WebView2 host threads (EBWorkerThread, MojoThread), and 11 unnamed
  Windows threads: thread pool, COM, tray, the dbhealth canary). Only `main` works at rest: 9.6
  wakes/s, 15.6 ms of CPU in 20 s (about 0.08 % of a core); the watchdog wakes 0.6 /s; every
  other thread slept. The other 211 of the app's 248 threads are WebView2's (GPU process 83,
  browser 45, renderer 32, services 51).
  1. **The paused CPU floor that grows over hours: the top item.** After 7.8 h on 0.29.0 the
     paused renderer used 20–25 % of one core; a fresh app uses 0 % paused, even after 40 skips.
     Find what grows with the page sample (DEBUGGING.md § The page sample). The sampler run that
     started this (his ask): it started at 15:08 on 2026-10-17 in a Terminal tab
     (`scripts/heaviness-sample.ps1 -Loop 600`, into `scripts/heaviness-samples.log`; the
     morning run did not happen, the log had stopped on 2026-09-27); its first sample, 26 min
     after launch, playing, record still: 37.6 % CPU, renderer 17.5 %, GPU 16.7 %. It also asks
     whether the spin cost grows over the hours. The method and the numbers: WORKLOG 2026-10-17
     *CPU hunt*. Memory is good: a 308 MB private working set.
  2. **What wakes `main` 9.6 times a second while paused.** Run the dev command recorder
     (`src/ipc-timing.ts`) on a paused dev app to name the callers; fix only a caller that has no
     reason to run while paused. Can ride along with item 1.
  (Items 3 and 4, the thread names and the Tokio timers, shipped in 0.30.0.)

  **Not to do:** fewer Tokio workers (an idle worker costs no CPU, and one blocking task holds
  more of a smaller pool); the watchdog's wakes (the price of freeze detection); WebView2's
  threads (not ours).
- **A dev app Claude starts plays again (fixed 2026-10-17, `642943a`):** `npm run dev:app` from
  a Claude shell starts itself outside the Claude package through WMI, on the real dev folder,
  and plays. The private copies of the dev profile are deleted (one dev profile now). Still not
  known: why Widevine began to refuse the package on 2026-10-16. DEBUGGING.md § Sign-in.

### Build order (recommended 2026-10-15, for his next sessions)

One load-bearing feature in flight at a time; two small ones may share a step (CLAUDE.md ›
Working style). Each step is its own branch and session, desk-tested before the next starts.

Steps 1–4 and 6 (the sheen, the Library ⟳'s spin, a song's primary artist and its guests, S1
and S3, Max for a new install, the tray hover text) shipped in 0.28.0; WORKLOG 2026-10-15
(twenty-eighth). Step 7, album notes, was built 2026-10-17 (below, *Built, waiting*). One step
is left:

5. **Hop in** (HOP-IN.md): decided. **Skipped for now (his call, 2026-10-15).**

**Now, with no code:** S2's week of mirror dates (apple-calls.md S2): one read-only call a day,
run from a script, so the evidence is ready when S2 is built. S5 (`fields[…]`) rides along with
each step that touches those calls.

### Decided, not built (his next sittings)

- **Pin on top** (2026-10-26): BUILT the same day, pushed (9460b39), ships in 1.1.0; his hand test passed the four pins. The
  open cases are features/PIN.md §5.1; Claude's choices for his review §3.6 and §8.

- **The loading set** (2026-10-16): BUILT 2026-10-17 on `seventheenth`, all five steps, kept as
  a back-pocket tool (his words). guide/LOADING-SET.md §7, §8; how to use it: DEBUGGING.md § The
  loading set. Open: the first `latency.json` is thin (my reloads, n ≈ 5); run
  `npm run latency:profile` again after some days of use. No UX-COVERUPS rows yet: each finding
  is a fork for him when he picks it up.

- **Rooms: a long queue and stations** (2026-10-16): live since 0.29.0; the worker is deployed
  (`4f61445`). Claude's two-app desk run passed 11 rows without sound (one Apple ID). His desk
  test with real playback passed on his word (2026-10-17). Open: his look at the list of what
  Claude decided (ROOMS.md §21.10).

- **Cruisin and Pro** (2026-09-28): the *Hop in* welcome screen; ready when he says go, but the
  words and the Pro walk's order. HOP-IN.md §5, RULEZ.md §16.

- **Suggest Less and proactive skips** (SUGGEST-LESS.md): live since 0.29.0; schema **v20**.
  §12 is the as-built record. The DeetsSupport usage allow-list copy is deployed (2026-10-17,
  DeetsSupport `9f49f84` and `67b6dc0`, pushed).

### Set for 2026-10-21 (his ask, 2026-10-20; doc only, not started)

- (The card grow stress test and Fable review ran on 2026-10-20 instead: see below.)

### Built, waiting on a release or a desk test

- **Artist page albums (2026-10-26, committed, desk test passed).** The Full artist page's
  Albums shelf holds albums, singles and EPs, and live albums, read whole; Appears On under the
  Top Songs rows; the Top Songs bar has no fill at rest, and a line separates the sections.
  Ships with the next release. ARTIST-VIEW.md §11.

- **1.0.0 is LIVE (2026-10-23, `4e6fa3e`, published; RELEASE.md §0a).** The first public
  release: the grand opening, update group 2, his three-line notes. Next on live: watch the
  first installs and the `csp-` lines in the weekly health counts.
- **0.99.0, a test build (2026-10-23, `be1fe6f`, merged into `main`, not published).** The
  grand opening, the tray fixes (TRAY.md §8) and the CSP **enforced** (CSP.md §6, step 3). Built
  and signed to `installers/DeetsMusic_0.99.0_x64-setup.exe`; he installs it and uses it a day.
  **Next:** read the `csp-<directive>:` lines in his installed app's log and the `diag` ring's
  `csp:blocked`; then the public release as **1.0.0 or higher** (an install of 0.99.0 takes no
  lower version). **Correction (2026-10-23):** 0.32.0 was never published; the live channel's
  latest is 0.31.0 (`/update/deetsmusic/releases`). **Done 2026-10-23:**
  `installers/velopack/DeetsMusic-deetsmusic` is the `before-0.99.0` copy with 0.32.0 taken out
  (its two packages, its feed rows, its `RELEASES` line); its feed now equals the live one,
  0.28.0 … 0.31.0, SHA-256 for SHA-256. So 1.0.0's delta is against 0.31.0 and the live feed
  names no package that is not on R2 (`liveAssets` in publish-update.mjs copies the local
  feed). The 0.99.0 folder is kept as `_DeetsMusic-deetsmusic.with-0.99.0`. The version is
  1.0.0 in the six files; next: `npm run release`. Never `release:publish` 0.99.0. 1.0.0 starts update group 2 (`package.json`, his call
  2026-10-23): no 1.0.0 install can roll back to a 0.x version (RELEASE.md §6.5).
- **The browser extension left v1 (2026-10-23, his call; not in 0.99.0).** `extension/` stays
  in the repo, parked; the installer, Settings › Connections and the bridge no longer carry it
  (EXTENSION.md, the status box). The bridge now refuses any request with an `Origin` header.
  No release-notes line: there are no live users before v1 (his word, 2026-10-23).
  Desk test passed 2026-10-23 (his word).
- **The grand opening (2026-10-22/23, branch `grand-opening`, merged into `main` with 0.99.0).**
  The startup screen: GRAND-OPENING.md §1–§11 (five pages: Hi, Layout-Maxxing Time, Fashion,
  Nitpicks, You're Ready); the tour after it (ONBOARDING.md §4.0: four steps, Next on each,
  Deets points); usage counts told by page 4 (USAGE-COUNTS.md §1). Every desk test passed
  2026-10-23 (his word), with the first sign-in (DATA-ARCHITECTURE.md §5d), Metal's and
  Ocean's cases and the demo. Six commits after 0.99.0 are on `grand-opening` only (the first
  sign-in, the account flyout, the quick panel squares, the walk's pointing, Happy's full
  player, the extension's removal): merge them into `main` before 1.0.0. The nav bar's page
  numbers stay for now (his call: they show how far along a user is). Kept by him 2026-10-23:
  Claude's `point_up.png` and page 4's labels.
- **The sign-in page shows the city icon (2026-10-23, his ask; LIVE, DeetsSupport `86b188d`).** The page's mark
  is the city at 48 CSS px, one file per screen density (`npm run icons` →
  `src-tauri/icons/signin/`, a `srcset`), so the face stays pixel-true; Apple's Access Request
  takes the 1024 city (`app-icon.png`); the browser tab keeps the head (a city is unreadable at
  16 px). `npm run signin:assets` also brought the stylesheets up to the app (the Happy and
  Metal changes) and the Happy faces, now served by `signin.js`. Deployed 2026-10-23 (version
  `8e7679b2`, his go); every mark, the favicon, the icon and the new faces curl 200 and match
  the commit. Open: his look at a real sign-in.
- **The motion monitor for 1.0.0 (2026-10-23):** the demo run passed by an A/B against 0.31.0,
  no new motion fault ([the checks archive](ops/checks/README.md) §2a, *The 1.0.0 run*). The
  `--dev` run is next, his go first. One old fault found (on 0.31.0 too): **the card picker
  draws one tall column for about two frames, then two columns**, in Midi (`fit()` in
  layout.ts runs at open, and a frame trace in headless Edge did not reproduce it: the cause is
  open).
- **Bugs read from his installed log (2026-10-23).** (1) After the PC woke at 13:34 on
  2026-10-22, the app started at 13:35 with no network: the syncs failed and the "offline" check
  ran once; then the log went silent at 13:36 (no 5-minute `diag` flush, no 5-minute Apple
  recheck) until a new start at 13:56 with no quit line. Closed: he ended that session himself
  (his word, 2026-10-23). (2) The tao panic on quit (`cannot move state from Destroyed`) came on
  3 of the last 7 quits. The 03:05 one on 2026-10-23 was his PC shutdown (his word; Windows
  logged no clean shutdown, only "unexpected" at the next boot), so every known case is the
  session-end or sleep path (DEBUGGING.md § What the 2026-09-17 health check found). It comes
  after the `calls quit` line, so the exit's own work is done; Windows has no crash report for
  it. tao 0.37.1 has the same `panic!` (runner.rs:371), so an update does not fix it. Its one
  cost was that each panic was an ERROR line, counted in the weekly `log.error.other`
  (USAGE-COUNTS.md). **Fixed for the count (his call, 2026-10-23):** `log.rs` writes this one
  panic as a WARN `exit: tao panic in a Windows shutdown, known (…)` (LOGGING.md); the panic
  itself stays. Ships with the next release. (3) A WebView2 utility process (kind 4)
  exits with 0xC0000142 one second after every launch; harmless, noise in the log. (4) One 403
  on a library page in a full sync (03:04:53): the Apple check said signed in, and the pass
  finished 4,083 of 4,083.

- **Drill motion review (2026-10-21, on `happy-thirtytwo`; paused by him for the evening).** Go
  to Album / Artist and Back: five faults fixed (CARD-GROW.md §22.2), his four calls built (§22.4,
  §22.6: the skin's own swap motion, a 300 ms wait for the page, no wave when warm, his row's
  Back as one shrink). Fable: round 1 before 3.5 → after 5.5; round 2 after 7 (the swaps 8).
  The fixes after round 2 (the grow waits for the page, the title on the visible move, a Back
  during the open) passed all 20 shots; round 3 was stopped before its scores. **Next:** run
  round 3 (`shots/drill-review/review3/`, sheets made), then the open items: the artist page
  empty past the 300 ms cap on a first visit (a longer hold is his call), and whether a card's
  own page slide in Ocean / Glass should cross in order like the swap. His dev app lost
  *Layout for Max* "4 cards" and the Ocean skin at 13:22 (another session's take), not reset.

- **Card grow: the shell (2026-10-20, on `v-thirtyone`; his calls 1A, 2A, 3A).** The stress test and
  the Fable review ran (CARD-GROW.md §20: Max 5/10, Midi 6/10, 23 faults), and §21 is the fix:
  the card's surface moves as its own shell (a clip over a still fill, plus an edge), the
  content rides the moving edge, the collapse rebuilds first, a hand-off between two cards,
  Escape reverses an open, the edge bar's double click is held, one layout per click. Then
  (§21.5–§21.7) his Glass report fixed (the covers no longer jump: the shell's layer hint),
  Midi's short measure, the Midi stale fill, the title ahead of the edge, and his "flash" report:
  the rows wave in at 0.4 of the open and of the collapse at the full stagger, as live. Fable on the final build: Max 8/10 (live code 5), Midi 7; Claude's check against
  live: no regression (48 clips, every probe; grow-settle.py clean; worst gaps ≤ 29 ms without
  the recorder). Desk test passed 2026-10-20 (his word, §21.4 steps 1–10). Not moved yet: the full player and
  Presentation mode (still the clip and pad); the curve and each skin's own grow motion (his
  calls); a covered card's hairline coming back late (same as live); the Queue title a few px
  above the edge for ~3 frames (§21.6).

- **Get the graphics card back by itself, and Reduce motion** (2026-10-20, on `v-thirtyone`;
  [GRAPHICS-FALLBACK.md](features/GRAPHICS-FALLBACK.md) §10.10). Rust watches the
  adapters and says when the card works again; the app restarts by itself while its window is
  hidden or minimized (between songs if music plays) and comes back the same way, playing on;
  on screen a toast asks. A *Reduce motion* row (first in Settings › Motion, locked On under
  Windows' reduced motion) is the catch-all the graphics rule now holds. Desk test and the
  break-it pass run by Claude (§10.11); his hand test passed 2026-10-20 (his word). Open: the song-start restart with music and
  its gap (P3); a real driver change (P4, his: the Parsec adapter off and on); Glass's blur
  cost (P2).

- **The Metal skin** (2026-10-20, on `v-thirtyone`; [metal.md](features/metal.md) §6.4, §6.7). A
  sixth skin in the title menu: brushed steel or acrylic over every theme (Sepia as brushed brass),
  the thumbwheel scrubber, the zoetrope cover change with the peek, four Settings rows, font B
  (Bahnschrift titles and SemiCondensed labels, §7 F7, his pick). The agent's stress test is done:
  the break-it pass, the scripted motion lists (`docs/ops/checks/metal-*.json`), an independent
  design review at 9/10, the readability check at 0 failures in all six Metal looks. His desk
  test passed 2026-10-20 (his word, DESK-TESTS.md row A11). Defaults (his call, 2026-10-20):
  Steel, Cover change on Zoetrope, Peek on. The texture under software drawing stays on (only
  the 3D turn is in the graphics fallback). Lessons for the next stress test: DESK-TESTS.md §6.7.
  **Open:** DeetsSolutions' skin list (his call). The sign-in page's Metal assets are live: DeetsSupport
  `60127e5`, deployed 2026-10-21 06:54 UTC (read from `wrangler deployments list`, 2026-10-23).
- **The full player's frames** (2026-10-18 and 2026-10-19, on `main`; fullscreen-player.md
  §14, §14.9). The stacked open and close per skin, the frame recorder (`frame-why.mjs`), and
  the player's state moved from `<html>` to the bento (the close's last frame restyles 256–536
  elements, not 1,500–1,868). **Open, for the next sitting:**
  1. His desk test (§14.5): passed 2026-10-20 (his word). It covered the state move: the Compass over the full
     player, the toasts under the title bar, the flip and the History column, stacked and not.
     Nothing on screen should differ from 0.30.0.
  2. Measure again on a quiet PC: the 2026-10-19 A/B ran with the CPU at 90 % (a game was
     running), so its times are high on both sides (§14.9 table).
  3. The close's last frame in Max portrait is still ~60–70 ms on a quiet PC: a layout-tree
     rebuild (`.stage` leaves `display: contents`; the History column goes to `display: none`)
     and ~20 forced passes in frame callbacks (`album-color.ts applyText`, `enterBand`,
     `compass.ts place`, `card-swap.ts onScreen`). Each is its own step, with frame-why first.
  4. The close's click keeps two ~20 ms layout reads (`rect` in `closeFullPlayer`).
  5. **The motion monitor's new checks** (2026-10-19, [the checks archive](ops/checks/README.md),
     part 2a; WORKLOG 2026-10-19 *motion monitor*). TELEPORT and ROW JUMP are built and proved on
     the old code; `smooth.mjs --dev` ran portrait in four skins before he stopped it. Left: the
     rest of the dev run (portrait Cyber, landscape, Midi: `node docs/ops/checks/smooth.mjs
     --dev`); the whole demo set once, to add each shot's designed TELEPORT and ROW JUMP hits to
     the baseline (only the full player shots ran); and one new hit to read in the frames:
     portrait Glass and Ocean, the Queue list's shown part ~25 px shorter in one frame at the
     close's end (`shots/scratch/smooth-dev-portrait/`).
  6. **The moving card box** (§14.10, 2026-10-19, his call after his Glass report): in Max the
     card grows out of its place and shrinks back into it, as an empty card box with the rim and
     the glow; the old left-edge wipe is gone. Committed `98e5a78` on `v-thirtyone`; desk test
     passed 2026-10-19 (his word). Open: the monitor before the release.
  Then a release (the monitor runs first, RELEASE.md §0 step 1a).
- **The Rewind button in the Max title bar** (2026-10-19, on `ideas-nineteen`;
  [features/listening-time.md](features/listening-time.md) §9). The hourglass right of the updates
  button opens a panel: *Today: N mins*, then Top Listens and SOTD, each list sliding in. One new
  setting (`rewindToday`). Desk test passed 2026-10-19 (§9.3, his word and the dev log).
  **Open:** his look at §9.2, whether the Rewind card goes (§9.4), and the merge of
  `v-thirtyone` into `main`. (The `rewindToday` usage key is in the worker deployed 2026-10-19.)
- **The Network panel, v1** (2026-10-19, on `net-worked`; merged on `v-thirtyone`, right of the
  Rewind button;
  [features/speedtest.md](features/speedtest.md) §7–§9). The car button in Max (his
  drawing, 2026-10-19), "Network: Good", per link one status word (numbers on hover) and a bar
  for the last hour, the Test row; Wi-Fi out, AirPlay second (speedtest.md §10, his review);
  the ping every 30 s only while playing; the fetch wrap. Desk test passed 2026-10-19 (§9, his
  word and the dev log: 12 Tests, the AirPlay row). **Open:** the fetch wrap's A/B
  (`checks/fetch-wrap.mjs`, §9 step 8, an agent's), his look at what Claude decided (§8.3). The
  DeetsSupport `/speed` route is live (deployed 2026-10-19, branch `net-worked`).

- **The quality sweep, Rewind: all faults fixed** (2026-10-18, on `v-thirty`;
  [ops/QUALITY-SWEEP.md](ops/QUALITY-SWEEP.md), DEETS-REWIND.md §8). The first sweep found 8
  faults and 2 visual faults (a third, V3, was a test artifact); his ask was to fix all of them in
  one sitting. Every guard and fault shot in `checks/rewind-sweep.mjs` passes, and so do the
  motion shots and readability in all 30 looks. **Schema v22** (`playlist_names`). His calls:
  K1–K3, a deleted playlist keeps its name, one "Deleted playlists" row, saves every 30 s.
  **Open:** his desk test (DEETS-REWIND.md §8.5) and his look at what Claude decided there. V1's
  rule (`styles.css`) also changes the Queue's and every revealed list's entrance: watch them.
  Next sweep: his pick, or the ledger's order (QUALITY-SWEEP.md §7).

- **Shipped in 0.30.0 (2026-10-18), the leftovers only:** Album notes, not run: card memory
  with a note open, the Search album pane, Mini (album-notes.md §8.3). The song facts box: the
  song's Last.fm call asks under Apple's whole artist text; a main-artist form, as the album's,
  is a fork for him (LISTENERS.md §8.10). The ⟳ hint, the card reveal (UX-COVERUPS.md §7.14)
  and Spin FPS (VINYL.md §12) have nothing left.

- **Filter and Rulez Playlists** (features/filter-rules.md): live since 0.29.0. Not built: the
  playlist page's own place for the rule (§13.3, his to design).
- **Usage counts** (USAGE-COUNTS.md): shipped in 0.27.0 (2026-10-14). Watch the first weekly
  reports arrive on deets.solutions/deetsmusic/admin/; the cron's in-window delete is still not
  seen in a run. §11 the as-built record.
- **Rooms on the web** (WebRooms.md): the app side built 2026-10-13, desk test passed 2026-10-17 (§10.5,
  his word; the Safari steps wait for the site page).
  Not built: the site page (part H, a DeetsSolutions session); the worker change is not deployed
  (§10.6).

### His to design or decide (asks and ideas, not built)


- **Two motion ideas** (2026-10-21, found in a frame review): the look change in the full player
  blinks to dark (fullscreen-player.md §15), and a layout change has no motion (MAX-CARDS.md §12).

- **Redesign the sign-in flow before a public release** (2026-10-17, his words: "I wanted to
  redesign the login flow eventually before public (non-friends) release anyway"). The mark's
  size snap (DeetsSupport `16f8f45`) is "for now"; since 2026-10-23 the mark is the city icon
  (above, *Built, waiting*). The flow: DATA-ARCHITECTURE.md §2a, HOP-IN.md.

- **Open an item inside Home** (2026-10-17): today an album, playlist or artist opened from Home
  hops to the card that holds it. On the collection engine it would open inside Home, with
  Back, as in Search and Radio. A product choice; the loading work does not need it.
  UX-COVERUPS.md §7.9.

- **Fewer Apple calls, and a song's primary artist** (2026-10-15): ideas/apple-calls.md. The
  ledger, five savings (about 110 → 15 library calls a day for him), the ⟳'s silent refusal, and
  Go to Artist / Last.fm / Rewind by Apple's primary artist. His calls: Rewind counts a
  collaboration for the primary artist only (P1 A); guests' names ride the enrichment call (P2 A).
  The savings S1–S5 are not yet his calls; S2 needs a week of dates first.

- **Presentation mode** (PresentationMode.md): shipped in 0.27.0, his desk test passed
  2026-10-13 (§9.3). The view's picture is his to draw, the goal marker is paused, and a live
  stream from Last.fm is his idea for later. §7a, §7b.

- **An album's counts from its songs, and a row per song** (features/LISTENERS.md §9,
  designed 2026-10-17, not built): the plays of the library album's songs added up, "at least N"
  listeners, and one row per song in presentation mode. Forks F1–F6 (§9.6) are his; probe §9.4
  (Apple's song names over his library) comes before a build.

- **Network errors in plain words** (2026-10-12): a transport error in an Apple call shows raw
  text (`Failed to load: error sending request…`, three `.catch` sites in search-card.ts). Five
  forks: one classifier into `apple-health`; what a card shows instead; toast at once or after
  the check; an AirPlay drop as a signal; a sweep for other `String(e)`. WORKLOG 2026-10-12.
- **A play that hangs on a network outage** (2026-10-17, his ask: design both parts later). On
  live at 14:42 the PC's name lookups failed for about 30 s at launch. A Library Play click
  hung with no error, and the first sound came 34 s after the click. The app did not know:
  `apple-health.ts` checks only after a play error or a song drop; the queue top-up failure is
  only a `console.warn` (player.ts, `window top-up failed`); `navigator.onLine` stayed true;
  Rust's Apple calls (the library sync) did not fail, so `apple_calls.rs` saw nothing. Part 1:
  **a hung-play check.** A play with no sound after a few seconds runs the health check, shows
  the "can't reach" toast, and writes one WARN line, so hangs stay in the log. The top-up
  failure goes to the health module too. His forks: the wait, and the drop's 5 s quiet hold or
  not. Part 2: **the speed panel's failed-request count** (ideas/speedtest.md): as designed,
  no row would have caught this outage (§2.1); the §5.3 fetch wrap could count MusicKit's
  failed requests for the Apple Music row. It sits beside *Network errors in plain words*
  above (one classifier into `apple-health`). The live logs keep only about 3 days (512 KB × 2);
  from 2026-10-14 to 2026-10-17, 22 of 24 play clicks played in 0.5–2.9 s, and this was the
  only hang. Also open: do covers that failed in the outage load again (not probed).
- **Our scrobble names** (2026-10-12): we scrobble Apple's raw names, so plays land on Last.fm's
  small pages. LASTFM.md §10.
- **Last.fm top tracks and similar artists:** ideas/LastfmArtist.md holds the calls.
- **The Rulez design pass on custom rules** (RULEZ.md §15, with §13), or **Layout**
  (LAYOUT.md), his pick. The graphics fallback rule's place in the engine's order
  (GRAPHICS-FALLBACK.md §9 item 3).
- **Friends see your picks and your Diary** (FRIENDS.md §20; never tell a user it exists).
- **The user guide as a wiki** (DOCS-ORG.md §13.10): next, the outline
  block for each page. The launch and the marketing are his (2026-10-23, his word); the repo holds none of it.
- **Full player:** Mini's player view; a turning copy of the Press record in the flight
  (fullscreen-player.md §8).
- **Motion review forks:** the surface-pick motion, the Now Playing song change (SHOTS.md §5e).
- **Ocean on WARP** (OCEAN.md §6, B15): 27–34 fps with no GPU; a word in the *Animate
  backgrounds* hint then, or not.
- **Code review leftovers:** check each stored choice value against its options before Backup is
  built (settings-store.ts); generated types for `invoke<T>`, if ever.
- **A Diary Done from the CLI or an agent** toasts *Couldn't copy the Diary entry*: the
  clipboard refuses a window without focus. Skip the copy when the window is behind, or say so
  in the toast (DESK-TESTS.md A6).
- **Two update ideas** (2026-09-16, from the archived NEXT-VERSION.md): resume the song after
  an update's restart (today it comes back paused at its place, `queue-persist.ts` →
  `setResumeAt`, since 2026-09-14; playing on by itself is the open part); install an update at
  the end of a song. Not designed.
- **Rewind has no card memory:** it opens at the top after a swap or a restart; the one gap
  in the card-systems table (SURFACES-AND-CARDS.md §5). Close it or leave it.
- **Look at next (2026-10-07):** the DeetsMahjong round-result page (`../DeetsSolutions/mahjong/`;
  ask him what is wrong first); Song of the Day "in the sidebar" (ask which sidebar first).
- **AirPlay tracking (AIRPLAY.md §13.2a–b):** shipped in 0.30.0. Left: the switch timing, left
  out on purpose.
- **Designed earlier:**
  the web demo's album light (WEB-DEMO.md §10); deploy a worker without dropping connections
  (ideas/WorkerDeploy.md); SECOND-SEARCH.md, ROOMS.md §19–§20, DeetsOTD.md §9,
  CREDITS.md §5; DOCS-ORG.md steps 6–8 and its open forks.
### deetsmeter: the judge (M3), desk test partly run

`scripts/compare/`, `tools/deetsmeter/`; music-app-comp.md §17.15–§17.17. Play, scroll, search
and warm start ran on both apps. Found: our Play / Pause button changes after our sound starts
(a fix is his call). **The trap for every start scene:** after `--scene start` (warm), ours
runs inside the Claude package; quit it and start it from the Start menu before changing a
setting that writes the registry. **Next steps:** (1) after a boot, sign in, open neither app,
and within 15 min run `node scripts/compare/run.mjs --scene start --cold` (ours needs 3 Press
passes, Apple 1 more). (2) When the cold runs are done, from a copy started by Explorer: turn
Start with Windows back On (`deetsmusic settings set startWithWindows on`) and *Change look at*
back to Sunrise and sunset (`settings set lookSchedule "Sunrise and sunset"`). Until then his
call holds: *Change look at* is Off, skin Press, theme Black & Red. (3) Then his calls: the seek
fork (scene 4), the Play / Pause lag, the 300 ms search delay, the "first play after a start"
row (§17.17), scroll again on a quiet machine with both monitors on.

**The 2026-09-17 health check:** its open leads are DEBUGGING.md "What the 2026-09-17 health
check found".

---


## State of play

**Live: 0.29.0** (2026-10-16, `deetsmusic` channel, Velopack since 0.28.0). The last beta is
`0.28.0-beta.6` on `deetsmusic-test` (VELOPACK.md §12).
Every release is in the log at [RELEASE.md §0a](ops/RELEASE.md); what each version added is
in [RELEASE-NOTES.md](ops/RELEASE-NOTES.md); the newest work is at the top of
[WORKLOG.md](WORKLOG.md). Each feature doc's front matter names the release it shipped in.
The list below is the long-lived foundation plus dated entries from 2026-09; it is not kept
complete.

### Built ✅
- **Frameless chrome**: custom titlebar, drag region, traffic lights wired to min/max/close.
- **Themes** (palette → theme → skin, all CSS-variable driven): `lilac`, `green`, `sepia`,
  `moonlight`, `black-yellow`, `black-red`. Title menu (click the title) with Theme / Skin /
  Surface flyouts, a **Settings…** row (summons the Settings card, [SETTINGS.md](architecture/SETTINGS.md)),
  and the Account row. A first launch with
  no saved choice follows the OS light/dark preference, landing on Press × Lilac or
  Cyber × Black & Red; retired ids (`fairy`/`glade`/`hornet`/`viper`/`desk`/`cyberstorm`/`retro-future`)
  migrate via the `RETIRED_*` maps in `src/look-ids.ts` and the pre-paint scripts in
  `index.html` and `tray.html` — keep all three in sync (and DeetsSolutions' `js/controls.js`).
- **Skins**: `vanilla` (borderless + editorial underline; hidden from the picker since
  2026-09-10, block kept as the base), `press` (riso print shop —
  square trim, halftone stock, offset `--ink-2` plate), `ocean` (recessed cards + SVG wave
  trains), `glass` (frosted, drifting aurora), `cyber` (lightning storm layer).
  Shared `[data-skin]` base + per-skin deltas; nav/motion/geometry fully tokenized (new
  capabilities like `--hover-lift` / `--panel-backdrop` default to no-ops).
- **Card + slot system** (`cards.ts`, `layout.ts`; [SURFACES-AND-CARDS.md](architecture/SURFACES-AND-CARDS.md)):
  every card is a mountable registry module. Midi bento = anchored **Now Playing** + **two
  swappable content slots**, each slot's **title is a card picker** (persisted, root-only).
  **Surface seam** (`data-surface` mini/midi/max) with size-band resize + per-surface
  remembered sizes. Mini has its own Mini | Player views; Max has the stage column and its own
  card grid (*Layout for Max*, [MAX-CARDS.md](features/MAX-CARDS.md)).
- **Apple auth**: loopback browser sign-in (themed page), MUT persisted across restarts.
- **Playback** (the load-bearing DRM risk is dead — full-song plays in WebView2): `player.ts`
  configures MusicKit JS in the webview, injects the captured MUT directly (no `authorize()`
  popup), plays. Live drag-to-seek scrubber + volume (shared `slider.ts`, persisted). Catalog→
  library id fallback; **dead-id self-healing** (stale catalog ids don't sink a feed batch).
- **Queue model** (`queue.ts`, [QUEUE.md](features/QUEUE.md)): history / current / upcoming of lightweight
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
  - **Search** ([SEARCH.md](features/SEARCH.md)) — standalone sectioned discovery (songs/albums/artists/
    playlists), enrichment piggyback, transient + materialized catalog tracks.
  - **Playlists** ([PLAYLISTS.md](features/PLAYLISTS.md)) — Apple mirror + local store; overview → detail;
    New Playlist, Add to Playlist ▸ submenu, remove-track, empty-only delete. **Folders**
    (2026-07-03, §3a): manual folders + kind auto-clusters (Your Playlists / Apple Mixes /
    Saved from Apple Music) as collapsible sections under the Folders sort; Move to Folder ▸ files
    locals AND mirrors (local metadata, zero Apple calls). Rename, drag-reorder,
    delete with songs, mosaic covers and export / import all built 2026-09-14 (PLAYLISTS.md §10).
  - **Queue** (`qcard.ts`) + **History** (`history-card.ts`) — Now Playing + Up Next / session
    play log; shared row markup (`queue-rows.ts`).
  - **Rewind** ([DEETS-REWIND.md](features/DEETS-REWIND.md)) — listening leaderboard (stat × time-window)
    over the play-event log.
  - **Radio** ([STATIONS.md](features/STATIONS.md)) — Apple's live / My Station / Discovery / genre
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
- **Album Color** ([ALBUM-COLOR.md](features/ALBUM-COLOR.md)): real Apple palettes → `--album-*` runtime
  roles → the rotating Now-Playing aurora (Glass-only display).
- **Add to Library** ([FAVORITES.md](features/FAVORITES.md)): ➕ add a catalog song/album to iCloud Music
  Library, gated behind the **Library Add** settings toggle (default on since 2026-09-10), on Search / Playlists /
  **Queue / History** right-click menus (incl. the now-playing hero). Apple's API is add-only.
- **Go to Artist / Go to Album** (2026-07-06, [SEARCH.md](features/SEARCH.md)): drill-in right-click verbs on
  **every** song/album surface (Search, Library, Playlists, Rewind, Queue, History, Now Playing —
  NP gained its first menu). Shared builders in `src/go-to.ts`; the id hop is `catalog_related` in
  `apple.rs` (session-cached via `catalogRelated`). Most surfaces route to the **catalog** detail in
  the Search card; the **Library drills IN-PLACE** over the user's library (`LibNav` in
  `library-card.ts`). In-place vs Search is a toggle: FUTURE-SETTINGS §20.

- **2026-09-15 — one hover-hint box** ([ONBOARDING.md](features/ONBOARDING.md) §1a): `src/hint.ts`
  replaced the native `title` tooltip everywhere — a themed box in the menu material, with a
  second line, so a cut-off song row shows the full song AND artist. **Central by adoption:**
  no call site changed. The engine sweeps every `title` into `data-hint`, removes the
  attribute, and a MutationObserver keeps doing it for new nodes and later `title` writes, so
  all 81 hint sites (68 in markup, 13 set from code) moved in one step. Row hints come from a
  shape table (`SHAPES`), one delegated handler covering Library, Search, Queue, Rewind,
  History, Home, the Artist shelves and Now Playing. Three Settings rows: Show hover hints,
  Hints appear after, Name songs on hover. Shipped in 0.7.0 (2026-09-16).
- **2026-09-15 — Press record player** ([VINYL.md](features/VINYL.md)): Record player Spin / Still / Off
  (default Off), Show record on, Spin speed (33⅓ / 45 / 78, default 33⅓), Show record plate. The
  cover (Now Playing + tray panel) turns at the chosen rate, locked to the song so each disc starts
  and ends upright at any speed; song changes slide the discs.
  Four desk-test rounds, each fault found with the new dev telemetry (`[perf] vinyl show / snap /
  song`, `__vinyl.sample`) and a computed-transform angle trace (VINYL.md §8–§9). Open: the frame
  cost of a full-rate spin (its own optimization session); Apple artwork-rule reading in §10.
  Committed db65b5c, shipped.
- **2026-09-15 — skin-only settings** ([UI-ARCHITECTURE.md](architecture/UI-ARCHITECTURE.md) §3 *Skin-only
  settings*, [SETTINGS.md](architecture/SETTINGS.md) §3): Look and feel rows that show only under their
  skin (`when` + `onSkinChange`), a new **range** (slider) row kind, and `src/skin-settings.ts`.
  **Glass** (user: "perfect"): Canvas glow · Dim canvas · Backlight · Tint cards. **Ocean**: Draw
  card edges Soft / Sand (grainy card edges, off by default) + Sand width. Committed
  c978fc6, shipped in 0.5.0.
- **2026-09-14/15 — self-update + signed releases** ([RELEASE.md](ops/RELEASE.md) §0, §6, §6.9):
  `tauri-plugin-updater` behind the DeetsSupport Worker + R2 (`deetsmusic` and `deetsmusic-test`
  channels; Settings › Updates Automatic / Ask / Off, Skip, Roll back within a channel group,
  `minVersion` for a required update); shipped in 0.4.3. Every build is signed twice: the
  updater `.sig` (minisign key) and Authenticode via Azure Artifact Signing (`scripts/sign.mjs`).
  Tested end to end with a signed t1 → t2 update on the test channel.
- **2026-09-13 — toasts** ([TOASTS.md](architecture/TOASTS.md)): the primitive, the `toasts` tier
  setting, and the ten call sites above. Desk-tested and shipped; every later call site is a row in TOASTS.md §5.
- **2026-09-12 — the NEXT-VERSION batch, all desk-verified** ([NEXT-VERSION.md](archive/NEXT-VERSION.md)):
  search pins · playlist covers (user / Apple / mosaic; schema v3 `cover`) · ♥ favorites
  (`favorites.rs` + `favorites.ts`, seeded from Apple's Favorite Songs; the Library ♥
  filter) · weekly Replay (`replay.ts`, three Playback rows) · Search square + Ctrl
  shortcuts · theme/skin View Transitions (`appearance.ts`) · album-colored NP text with
  the contrast guard (Glass) · Glass menus at 90% · explicit badge. Surface-change motion
  (fork B) was tried and walked back the same day (NEXT-VERSION §10). The playlist creation
  flow closed 2026-09-15 (NEXT-VERSION §19). The doc is archived; every batch in it shipped.

- **2026-09-17 — the Max stage column** ([STAGE-COLUMN.md](cards/STAGE-COLUMN.md)). The album cover is
  locked to a square and is never cropped (`100cqw` on the cover inside an inline-size `.np`, so
  there is no measured constant); **Now Playing is locked** to its full-width square plus its
  rows and the **Queue absorbs every other pixel** — the owner's rule after stress-testing:
  the art and the now-playing information are what the surface is for, and the queue is
  something a user opens when they want it. A new `.stage` wrapper gives column 1 its own two
  rows (`display: contents` outside Max, so midi / mini / NP render exactly as before), and the
  **Queue grows up over Now Playing** from a zone on its top edge (CARD-GROW.md §16). The
  auto-flip now reads the window's **height** as well as its width: under 745 px a Max window
  becomes Midi, or stops at its 750 px floor — `Settings › Window › "Max window when short"`.
  Default Max size 1100 × 950, sized from Press (the tallest skin) against a 1920 × 1080 work
  area. Desk-tested live on all five skins. **Open:** Press at the floor keeps 101 px of Queue,
  not the 106 the other skins get — move the band to 755 if that reads short.

### Not built yet ⬜
- **Two services, one library (2026-09-15) — PARKED.** Designed in the morning
  (**[PROVIDERS.md](integrations/PROVIDERS.md)**), stopped the same day after the Spotify facts were checked
  (its §9): the owner needs Premium, the ISRC is gone so there is no merge key, search is capped
  at 10, and Developer Policy III.5 forbids mixing another service's content. Reopen only if
  Spotify's dev-mode terms change.
- **Real album/artist data + artist photos in the Library card** — Library's Albums/Artists are
  derived from song artwork + initials (Search's artist drill already shows real photos). Scoped
  2026-07-03: **bigger than it looks** — the Artists overview shows hundreds at once, so lazy
  per-touch enrichment can't fill it (needs an eager one-time backfill, a deliberate exception
  to the enrichment doctrine with a §14-style opt-out) *and* it needs new schema (artist cache
  table), so it should bundle with the deferred schema-versioning work as one post-v1 pass.
  (Start Station on artist tiles does NOT wait for this — shipped via the lazy two-hop resolve.)
- **Play on launch** ([FUTURE-SETTINGS.md §22](FUTURE-SETTINGS.md)) — built 2026-09-27 as a Rulez
  recipe (off by default); the starred pool of what to play is not built.
- **Off the roadmap:** ratings / 👎 (the ♥ favorites shipped instead, 2026-09-12).
- **The agent's "Later" list** ([AGENT.md §7](integrations/AGENT.md)): the installer PATH entry,
  `artist:` ids for `play`, durable history as a second history source, a small-model test of
  `mcp --small`.
- **Built, desk-tested, not released:** Suggest Less ([SUGGEST-LESS.md](features/SUGGEST-LESS.md), 2026-10-16).
- **Designed, not built:** a second
  Search card ([SECOND-SEARCH.md](features/SECOND-SEARCH.md)), Hop in ([HOP-IN.md](features/HOP-IN.md)),
  Layout ([LAYOUT.md](features/LAYOUT.md)), Skinz ([SKINZ.md](features/SKINZ.md)), Backup
  ([BACKUP.md](features/BACKUP.md)), Local radio ([LOCAL-RADIO.md](features/LOCAL-RADIO.md)),
  Threads ([THREADS.md](integrations/THREADS.md)). Ideas with no schedule: [ideas/](ideas/README.md).
- Built since this list was written, so no longer here (2026-09-22 sweep): playlist refresh and
  movable rows (0.12.2), the sticky toast queue (TOASTS.md §4a), the keyboard pass with Space
  (COMPASS.md §5), listening rooms (0.10.0), Friends (0.12.2), the AirPlay speaker-only send and
  claim guard (AIRPLAY.md §11–§12, desk test passed 2026-09-19), the first-run walk
  (`src/walk.ts`), the web demo; earlier: the hosted sign-in page + deep link, the CLI / agent
  control, the mini and max compositions, library windowing, playlist rename / drag-reorder /
  export, and the rest of the listening loop.

---

## Measuring graphics (2026-09-16)

`npm run dev:app` is a poor stand-in for the installed app when the question is draw cost.
DevTools **auto-opens in dev and renders in the app's own GPU process**, and vite serves
unbundled JS with many `<style>` tags. So:

```
npm run dev:perf                          # dev, DevTools held shut
npm run dev:built                         # release-shaped bundle, DevTools shut  <- measure here
npm run dev:built -- --gpu=off            # and pretend the machine has no GPU
npm run bench appearance -- --passes 3    # repeatable; refuses to run on a noisy machine
```

Three rules learned the hard way, all in DEBUGGING.md:

- **Judge by frames / ms, never the main-thread trace alone.** `will-change` on the rising
  panels cut style recalc 766 -> 260 ms while delivered frames fell 229 -> 50 fps: the cost
  moved to raster, where the main-thread view cannot see it.
- **Check the `@N Hz` and `[perf] gpu` lines first.** A stale refresh sample once judged a
  244 Hz display as 34 Hz, making every drop percentage wrong in the forgiving direction.
- **One reading from this PC means nothing** — the same switch measured 36 to 236 fps run to
  run. That is what `bench.mjs` and its noise gate are for.

Where it is heading: FUTURE-SETTINGS.md §25, settings for the heaviest features.

**Graphics pass 2026-09-16 — PAUSED** (the user moved other work ahead of it). Committed
b59e575, shipped in 0.8.0; the checks below are still open:
- ✅ **Fancy Glass** (Settings › Look and feel, Glass only, default off): the painted frost with a
  still aurora and locked sliders 65 / 85 / 40 / 10, or the live blur and the sliders. Shipped
  in 0.8.0; no desk-test result is on record. SETTINGS.md row; numbers in DEBUGGING.md §Fancy
  Glass and the Ocean swell.
- 🟨 **Composited card lists** (`--scroller-layer`, Ocean / Glass / Cyber since 0.8.0; Press and
  Vanilla since 0.26.0): half checked. What is done and what is left: DEBUGGING.md §The composited-scroller pass.
- ⬜ **Swell:** measure Animate backgrounds › Reduced under `--gpu=off`, then maybe a hint line.
- ⬜ Found on the way, older than these changes: a very fast wheel spin (≈ 15,000 px/s) shows
  blank rows in the windowed Library for a few frames (collection-window.ts fills its buffer only
  after the scroll pauses).

## Seeing the UI — shots as a visual debugger (2026-09-28)

`node scripts/shots.mjs` drives the web demo in headless Edge and saves what the screen did:
pictures, clips (MP4), a frame strip per clip (one PNG of the motion, labeled in ms: how Claude
watches motion), and each shot's console with the app's own `[perf] frames` lines. A step with
`"frames": N` keeps the next N real paints after it; the scratchpad (`shots/scratch/`) holds
one-bug lists. No dev app,
nothing on the desktop moves.

```
node scripts/shots.mjs --list docs/guide/motion.json          # the motion set, 5 skins
node scripts/shots.mjs --scratch <name>                       # one bug: a starter list, then run it
node scripts/shots.mjs --scratch <name> --slow 4              # CSS motion 4x slower
```

When to use it and its limits (not WebView2, no MusicKit, no OS window):
[DEBUGGING.md § Seeing it](ops/DEBUGGING.md). The formats: [SHOTS.md §5a–§5c](guide/SHOTS.md).

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
  callback is `tray::show_main`. See [TRAY.md](features/TRAY.md) §5 — including why two DeetsMusic
  taskbar icons in dev are expected, and why a debug build flashes a console.
- **A running `deetsmusic mcp` blocks install and uninstall** — Windows won't replace or
  delete an open file, and the CLI is long-lived (an MCP session lasts as long as the agent).
  Uninstalling 0.1.2 removed the registry entry and then left every file on disk. The
  Velopack hooks stop it by path; see [RELEASE.md](ops/RELEASE.md) §3.
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
  `player:deadIds` diag). See [QUEUE.md §Dead ids](features/QUEUE.md).
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
  Needs a UX cover-up (loading state / optimistic icon), not a silent freeze. See [UX-COVERUPS.md](architecture/UX-COVERUPS.md).
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
src/library-card.ts         Library contexts/groupings + drill-in; shared musicCell + libAlbum
src/artist-credit.ts        credit-string parser: vocabulary-gated split → consolidated Artists
src/search.ts / search-card.ts    catalog search data + Search card (SEARCH.md)
src/playlists.ts / playlists-card.ts   playlists data + card (PLAYLISTS.md); Add-to-Playlist ▸
src/qcard.ts                Queue card: Now Playing + Up Next + jump-to-item + right-click menus
src/history-card.ts         History card: the durable play log (hero + "Previously")
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
src/row-pick.ts             multi-select over rows (Ctrl / Shift picks; NEXT-VERSION §19)
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
                            bridgeToken, windowPos; read field by field, async setters
src-tauri/src/safe_file.rs  write_atomic (beside, flush, rename) + parse_lenient (one bad
                            value resets that field) for settings, keys, tokens, sessions
src/rust-settings.ts        RustSettings: the one front-end shape of SettingsData
                            (tests/rust-settings.test.ts reads settings.rs for drift)
src/settings-repair.ts      the launch toast's words when settings.json reset a field
src-tauri/src/bridge.rs     loopback bridge: Hub state relay + agent routes (token only)
src-tauri/src/media.rs      Windows media session (GSMTC) + master volume
src-tauri/nsis/hooks.nsh    NSIS hooks: stop the CLI pre-(un)install, offer the extension
cli/                        the `deetsmusic` binary: CLI + MCP server (AGENT.md)
extension/                  MV3 browser extension source, PARKED: not built or shipped (EXTENSION.md)
scripts/dev-app.mjs         generates the dev identifier config for `npm run dev:app`
scripts/cli-dist.mjs        stages cli/dist/deetsmusic.exe for bundle.resources
scripts/release.mjs         `npm run release`: reads secrets, builds, signs, checks, archives (RELEASE.md §1)
scripts/sign.mjs            Authenticode signing: signtool + Azure Artifact Signing dlib (RELEASE.md §6.9)
scripts/release-check.mjs   the release gate: repo paths, versions, pin/updater, signatures (§1a)
scripts/publish-update.mjs  `npm run release:publish`: R2 upload + update index, withdraw, notes (§6.7)
scripts/cred-read.ps1       reads a Credential Manager secret for release.mjs (never printed)
scripts/cred-write.ps1      saves a secret to Credential Manager, trimmed and checked
src-tauri/src/update.rs     the updater: channel, check, in-memory verified download, install
src/updater.ts              Settings › Updates + the update toasts (RELEASE.md §6.3)
installers/                 DeetsMusic_<version>_x64-setup.exe per release + velopack/ (every package, never pruned); gitignored
src-tauri/secrets/          Apple key/IDs + captured MUT (gitignored)
dev-dumps/                  raw API samples used to design the model (gitignored)
```

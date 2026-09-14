# DeetsMusic — project guide for Claude

A lightweight Apple Music player for Windows 11 (Tauri v2 + WebView2, vanilla TS
front-end, Rust back-end).

## Start here
- **`docs/HANDOFF.md`** — cold-start: state of play, how to run, roadmap, gotchas.
- `docs/UI-ARCHITECTURE.md` — front-end (token/theme/skin system, collection-card engine).
- `docs/DATA-ARCHITECTURE.md` — auth, model, provider, SQLite cache.
- `docs/DESIGN.md` — product intent.
- `docs/TRAY.md` — tray icon/panel + minimize-to-tray; `docs/EXTENSION.md` — browser
  extension + the loopback bridge (`extension/` is the MV3 source); `docs/AGENT.md` —
  the agent/CLI routes on that bridge; `docs/RELEASE.md` — build, install, uninstall.
- `docs/TOASTS.md` — the transient-notice primitive (`src/toast.ts`), its tiers, and every
  call site; `__toast.demo()` in the console shows one of each kind.
- `docs/LOGGING.md` — the rolling log file + `diag.ts` (built 2026-09-11); the support
  back end that consumes it is `DeetsSolutions/docs/support.md`.

## How to verify your work
- **The user runs the app and tests your changes** (`npm run tauri dev`) and gives
  feedback. **Do NOT build throwaway test harnesses, mock pages, or one-off tooling to
  verify UI behavior** — it wastes time/tokens. Make the change, sanity-check it
  compiles, then hand it to the user to try.
- Cheap checks that ARE worth running (not harnesses): `npx tsc --noEmit` and
  `npx vite build` to catch type/compile/bundle errors before handing off.
- If something genuinely can't be reasoned through and the user is away, ask them to
  test rather than scaffolding a harness.
- **Playback can be driven and measured from the session (2026-09-12).** Start the dev
  app (`npm run dev:app`, in the background), then use the `deetsmusic` MCP tools
  (`search` / `list` → `play`, `queue`, `control`, `now_playing`). A `play` call returns
  after the song has started, and every play writes one `[perf] click→sound …` line to
  `%APPDATA%\com.deetsmusic.dev\deetsmusic.log` with the stage split, MusicKit's own
  requests, and out-of-click events (`grow`, `deadNext`, `desync`, `misalign`) — read it
  with a `grep "\[perf\]" … | tail -1`. Song-end behaviour: `control seek 97` and wait.
  Cold start: stop the dev exe (the runner exits with it), relaunch, wait for the
  `start:` log line. Limits: the MCP plays a list from its first song (the 3,895-row
  library click is a hand test) and its round trip is ~1 s (Previous within 3 s of a
  click can't be reached). Full reference: `docs/DEBUGGING.md`. This is dev-only
  telemetry (`src/perf.ts`, Vite `DEV` flag) — the release bundle carries none of it.
- **Frame smoothness is measured the same way (2026-09-13).** `src/frames.ts` logs one
  `[perf] frames …` line per scroll / scrub / pane slide / folder open / queue drag / menu /
  appearance switch, judged against the sampled display refresh rate, plus `[perf] input …`
  for any slow press→paint. `__frames.sample(ms)` from `scripts/webview-eval.mjs` measures a
  scripted scroll. DEBUGGING.md §Frame telemetry.
- **Heaviness + profiling:** `scripts/heaviness-sample.ps1 -Loop 3600` logs both apps' memory
  and CPU hourly; `scripts/webview-profile.mjs [--trace] "<expr>"` profiles the dev page. How
  to read all of it: DEBUGGING.md §Reviewing the telemetry.
- **Registry writes from this session are not real.** The Claude desktop app is an MSIX
  package: your shells, and a `dev:app` you launch, write `HKCU\Software\Classes` into a
  private hive that Edge and other programs cannot see (the deep-link scheme hid this way,
  2026-09-13). Check or write the real registry through a WMI-started process. DEBUGGING.md
  §Sign-in.

## Working style (the user directs the architecture)
- For non-trivial features, **design on paper / talk it through first**, surface the
  real forks (he responds well to multiple-choice), confirm, then build.
- **Everything is token-based**: never hardcode a color, px, font, or motion value in a
  component — add/route through the palette → theme → skin tiers. Color → theme role;
  geometry/type/spacing/motion → skin token.
- He values polish and good stewardship (e.g. minimize Apple API calls; ask cost before
  committing to a fetch-heavy approach).
- **Do NOT delegate to subagents (the `Agent` tool) for this codebase.** It's small
  enough to hold in context directly — explore, read, and edit files yourself so you
  keep the full picture while building. Only exception: if he explicitly asks for one.

## How to explain things to me
- Write in ASD-STE100 (Simplified Technical English): short sentences, active
  voice, one idea per sentence, plain approved words, no metaphor.
- Name the exact control or gesture ("the tray icon", "the pinned taskbar
  button"). Define the terms once, at the start.
- Test each option against the code BEFORE you show it to me. Discard the
  options that the code already rules out. Show the real forks only.
- A question about the UI needs the front-end state, not only the Rust. Check
  localStorage keys and the `surface`/`theme`/`skin` modules first.

## Run
```
npm install
npm run tauri dev     # compiles Rust (first run slow), opens the 480×864 window
npm run dev:app       # same, isolated from the INSTALLED app (own identifier/data dir)
npm run release       # build the installer (→ installers/; see docs/RELEASE.md)
npx tsc --noEmit      # front-end typecheck
```
Devtools auto-open in dev (`src-tauri/src/lib.rs`).

## Conventions
- Front-end only ever sees the normalized model (`Track`/`Album`/…), never raw Apple
  shapes — normalization lives in Rust.
- Commit only when the user asks. Co-author trailer — name the model that did the work
  (today `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`); update this line when
  the model changes.

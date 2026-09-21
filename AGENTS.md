# DeetsMusic — project guide for Codex

A lightweight Apple Music player for Windows 11 (Tauri v2 + WebView2, vanilla TS
front-end, Rust back-end).

## Start here
- **`docs/HANDOFF.md`** — cold-start: how to run, **Open now** (what is not finished), gotchas.
  **`docs/WORKLOG.md`** — the record of each sitting, newest first.
- The docs sit in folders by area: `architecture/ cards/ features/ integrations/ ops/ ideas/`.
  Each doc's state is in its front matter (`status`, `shipped_in`, `desk_test`). Run
  `npm run docs:check` after a doc edit; move a doc only with `scripts/docs-move.mjs`
  (DOCS-ORG.md).
- `docs/architecture/UI-ARCHITECTURE.md` — front-end (token/theme/skin system, collection-card engine).
- `docs/architecture/DATA-ARCHITECTURE.md` — auth, model, provider, SQLite cache.
- `docs/DESIGN.md` — product intent.
- `docs/features/TRAY.md` — tray icon/panel, minimize-to-tray, window lifecycle (single instance);
  `docs/integrations/EXTENSION.md` — browser extension + the loopback bridge (`extension/` is the MV3
  source); `docs/integrations/AGENT.md` — the agent/CLI routes on that bridge; `docs/ops/RELEASE.md` — build,
  install, uninstall.
- `docs/architecture/TOASTS.md` — the transient-notice primitive (`src/toast.ts`), its tiers, and every
  call site; `__toast.demo()` in the console shows one of each kind.
- `docs/ops/LOGGING.md` — the rolling log file + `diag.ts`.
- `docs/ideas/` — feature ideas that are **not built**.

## How to verify your work
- **The user runs the app and tests your changes** (`npm run tauri dev`) and gives
  feedback. **Do NOT build throwaway test harnesses, mock pages, or one-off tooling to
  verify UI behavior** — it wastes time/tokens. Make the change, sanity-check it
  compiles, then hand it to the user to try.
- Cheap checks that ARE worth running (not harnesses): `npx tsc --noEmit` and
  `npx vite build` to catch type/compile/bundle errors before handing off.
- If something genuinely can't be reasoned through and the user is away, ask them to
  test rather than scaffolding a harness.
- Playback, frame smoothness, and heaviness can be measured from a session (dev-only
  telemetry, `[perf]` lines in `%APPDATA%\com.deetsmusic.dev\deetsmusic.log`). Recipes:
  `docs/ops/DEBUGGING.md`.

## Working style (the user directs the architecture)
- For non-trivial features, **design on paper / talk it through first**, surface the
  real forks (he responds well to multiple-choice), confirm, then build.
- **Everything is token-based**: never hardcode a color, px, font, or motion value in a
  component — add/route through the palette → theme → skin tiers. Color → theme role;
  geometry/type/spacing/motion → skin token.
- He values polish and good stewardship (e.g. minimize Apple API calls; ask cost before
  committing to a fetch-heavy approach).
- **Do NOT delegate to subagents for this codebase.** It's small enough to hold in context
  directly — explore, read, and edit files yourself so you keep the full picture while
  building. Only exception: if he explicitly asks for one.

## How to explain things to me
- Write in ASD-STE100 (Simplified Technical English): short sentences, active voice, one
  idea per sentence, plain approved words, no metaphor.
- Name the exact control or gesture ("the tray icon", "the pinned taskbar button"). Define
  the terms once, at the start.
- Test each option against the code BEFORE you show it to me. Discard the options that the
  code already rules out. Show the real forks only.
- A question about the UI needs the front-end state, not only the Rust. Check localStorage
  keys and the `surface`/`theme`/`skin` modules first.

## Run
```
npm install
npm run tauri dev     # compiles Rust (first run slow), opens the 480×864 window
npm run dev:app       # same, isolated from the INSTALLED app (own identifier/data dir)
npm run release       # build the installer (→ installers/; see docs/ops/RELEASE.md)
npx tsc --noEmit      # front-end typecheck
```
Devtools auto-open in dev (`src-tauri/src/lib.rs`).

## Conventions
- Front-end only ever sees the normalized model (`Track`/`Album`/…), never raw Apple
  shapes — normalization lives in Rust.
- Commit only when the user asks.

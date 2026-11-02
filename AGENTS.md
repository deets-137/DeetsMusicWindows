# DeetsMusic — project guide for Codex

A lightweight Apple Music player for Windows 11 (Tauri v2 + WebView2, vanilla TS
front-end, Rust back-end).

**The full project guide is [`CLAUDE.md`](CLAUDE.md). Read it first; every rule in it applies
to you.** It holds the doc map (one line per doc), how to verify your work, the build list for
a new panel, row, button or card, and the conventions. This file repeats only the rules that
cost the most when missed, so it cannot drift far from that one.

## Start here
- **`docs/HANDOFF.md`** — cold start: run, ship, **Open now** (everything not finished),
  gotchas, file map. **`docs/WORKLOG.md`** — the record of each sitting, newest first.
- **`docs/LESSONS.md`** — what the owner tends to want. It shapes what you recommend; it never
  closes a fork.
- The docs sit in folders by area: `architecture/ cards/ features/ integrations/ ops/ ideas/
  guide/ legal/ archive/`. Each doc's state is in its front matter (`status`, `shipped_in`,
  `desk_test`). Run `npm run docs:check` after a doc or code edit; move a doc only with
  `node scripts/docs-move.mjs NAME=area` (DOCS-ORG.md).
- `docs/ideas/` — not built; never tell a user the app does these.

## The rules that cost the most when missed
- **He decides every fork.** A default, a wording, a placement, a motion value, a new row, a
  schema shape: bring him the choice before you build it, your recommendation first. Inside a
  fork he chose, build the full, polished thing.
- **Do not build throwaway test harnesses.** Run `npm run check` (tsc + tests + docs:check +
  cargo check + cargo test), then hand the change to him to try.
- **Everything is token-based**: never hardcode a color, px, font, or motion value in a
  component. Color → theme role (`themes.css`); geometry, type, spacing, motion → skin token
  (`skin.css`).
- **A new control builds on the app's existing pattern** for that kind of control, and walks
  the build list in CLAUDE.md › Working style (hints, toasts, settings keys, scrollbars,
  right-click, keys, popovers, the CSP).
- **A synchronous `#[tauri::command]` runs on the UI thread.** Never let one reach blocking
  I/O; make it `async fn` + `spawn_blocking`.
- Front-end only ever sees the normalized model (`Track`/`Album`/…); normalization lives in Rust.
- Minimize Apple API calls; ask the cost before a fetch-heavy approach.
- Commit only when the user asks. A worker deploy is always his call.

## How to explain things to me
- Write in ASD-STE100 (Simplified Technical English): short sentences, active voice, one
  idea per sentence, plain approved words, no metaphor.
- Name the exact control or gesture. Define the terms once, at the start.
- Test each option against the code BEFORE you show it to me. Show the real forks only.

## Run
```
npm install
npm run tauri dev     # compiles Rust (first run slow), opens the 480×864 window
npm run dev:app       # same, isolated from the INSTALLED app (own identifier/data dir)
npm run check         # tsc + tests + docs:check + cargo check + cargo test (the pre-push hook)
npm run release       # build + sign the installer (→ installers/; see docs/ops/RELEASE.md §0)
```

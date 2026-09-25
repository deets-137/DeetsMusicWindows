---
status: designed
desk_test: none
sources: [src-tauri/src/apple.rs, src-tauri/src/log.rs]
updated: 2026-09-25
---
# Apple calls — the counter and the 429 back-off

> How many Apple Music API calls the app makes, and what it does when Apple says "too many".
> Designed 2026-09-24 (the owner: "doc A + B now, build later"). Not built.
> Status: ✅ decided · 🔵 open · ⬜ later.

---

## 0. Terms

- **Apple call** — one HTTP request from Rust to `api.music.apple.com`. MusicKit's own requests
  from the webview (playback, the queue) are not Apple calls here (§4).
- **The four functions** — every Apple call goes through one of them, in `apple.rs`:
  `api_get`, `api_post`, `api_send`, `status_only`. `enrich.rs`, `favorites.rs`,
  `playlists.rs` and `web.rs` use them too. Each one calls `log_failure`.
- **Background job** — a call the app starts on its own (a timer, a launch sync). A **user
  call** starts from a click, a key or an agent request.

## 1. What is there now (read 2026-09-24)

- `log_failure` (apple.rs) writes `apple: {status} {path}` for every reply of 400 or higher.
  A 429 always leaves a line.
- Nothing counts the calls. The volume is unknown.
- A 429 is treated like any other failure. Nothing reads `Retry-After`. Nothing waits.
- **Evidence, 2026-09-17 → 2026-09-24:** no 429 in the installed app, the beta or the dev
  log. The dev log has 8 × 401 on `/v1/me`, all healed by the token refetch. The 23
  `[perf] click→sound` lines show no MusicKit request status other than 200.
- The risk: every install shares one developer token (DeetsSupport mints it). Apple does not
  publish its limits, or say if they count per token or per user. If per token, the limit is
  shared by all users, and the risk grows with the user count.

## 2. A — the counter

- One counter table in `apple.rs`, in memory: **group × status class** → count.
  - Groups, from the path: `library` (`/v1/me/library…`), `me` (other `/v1/me…`),
    `catalog` (`/v1/catalog/…` except search), `search` (`…/search`), `write` (any
    POST / PUT / DELETE), `probe` (`status_only`).
  - Status classes: `2xx`, `401`, `403`, `404`, `429`, `4xx` (other), `5xx`, `net` (no reply).
- The four functions add 1 after each reply. The retry after `refetch_after_401` adds 1 too,
  because Apple sees two requests.
- **The log line**: `[apple] calls 1h: library 12 · catalog 40 (404 ×1) · search 6 · me 3 ·
  write 2 · 429 0` — once an hour when the hour had any call, and once at quit. Then the
  hour's counts reset. A running total since launch goes in the same line.
- **The diag tool**: the `diag` MCP tool and `deetsmusic diag` show the counts since launch and
  the last hour, and the back-off state (§3).
- Release and dev both. It is a log line with no ids, the same class of data as today's
  `apple:` line (LOGGING.md).
- Cost: 0 Apple calls. No schema change.

## 3. B — the 429 back-off

- **On a 429**: read `Retry-After` (seconds, or an HTTP date). No header → 60 s. Hold
  `BACKOFF_UNTIL` (a `Mutex<Option<Instant>>` in `apple.rs`) at the later of the old and the
  new time. Cap: 10 minutes.
- **Background jobs** ask `apple::backing_off()` before they call. While it holds, they skip
  this turn and try at their next turn. They do not retry in a loop. The list of background
  jobs is made at build time, by reading every timer and launch sync that reaches the four
  functions (the playlist refresh, the launch library sync and the Home New shelf are known).
- **User calls** still go out. A user who clicks gets an answer or an error, never a silent wait.
- **Log / diag**: `apple: back-off arm {s}s ({path})`, `apple: back-off skip {job}` (at most
  once per job per back-off), `apple: back-off off`. The same three as `diag` events
  (CLAUDE.md checklist item 6).
- No toast for a background job. The user has nothing to do about it.
- ✅ **A user call that gets a 429 shows a toast** (the owner, 2026-09-24). TOASTS.md §5 gets a
  row when it is built. ✅ **The words and the tier (his call, 2026-09-25):** `warn`, timed
  (6 s): "Apple Music is busy right now. Try again in N seconds." N is `Retry-After`; with no
  header (60 s) it reads "Try again in a minute." Decided inside his call: while one is on
  screen, a second failed click does not show another.

## 4. Later (⬜ C)

- MusicKit's requests in the release build: a small release copy of `perf.ts`'s resource-timing
  read, which counts only non-200 statuses into the same `[apple]` line.

## 5. Desk test (planned)

1. Use the app for an hour. Read the `[apple] calls 1h` line. Check the groups against what you
   did.
2. Dev app only: force a 429 (a debug hook in `api_get_once` that returns 429 with
   `Retry-After: 30`). A background job logs `back-off skip`. A click still loads. After 30 s,
   `back-off off`.
3. `diag` shows the counts and the back-off state.

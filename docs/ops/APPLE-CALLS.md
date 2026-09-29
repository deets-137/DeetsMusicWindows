---
status: built
desk_test: open
sources: [src-tauri/src/apple.rs, src-tauri/src/apple_calls.rs, src-tauri/src/log.rs, src/apple-health.ts, src-tauri/src/heal.rs, src-tauri/src/library.rs, src/track-store.ts]
updated: 2026-09-29
---
# Apple calls — the counter and the 429 back-off

> How many Apple Music API calls the app makes, and what it does when Apple says "too many".
> Designed 2026-09-24 (the owner: "doc A + B now, build later"). **A and B built 2026-09-25 —
> read §6 (as built) first; the desk test is §5.** C is later.
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

## 5. Desk test (restart the dev runner: new Rust)

> **2026-09-25:** steps 2 and 3 were run in the dev app by Claude: the user search got the
> 429 and the toast ("… in 20 seconds"), `playlist_refetch` logged one `back-off skip` and no
> toast, a second search went out, `back-off off` came 20.0 s after the arm. **Open: step 1**
> (an hour of normal use, then read the `[apple] calls 1h` and `quit` lines).

1. Use the app for an hour. Read the `[apple] calls 1h` line in the log (and `apple:calls` in
   `deetsmusic diag`). Check the groups against what you did. Quit: one `[apple] calls quit`.
2. Dev app only (Claude runs the command): `node scripts/webview-eval.mjs "window.__TAURI_INTERNALS__.invoke('apple_force_429', { n: 1, secs: 60 })"`.
   Then search for something. The toast reads "Apple Music is busy right now. Try again in 60
   seconds." The log has `apple: back-off arm 60s`. Search again at once: it goes out and
   answers, with no second toast.
3. Within that minute, open the Home card or a playlist that is due a refresh. The log has
   `apple: back-off skip <job>`, and no toast shows. After the minute: `apple: back-off off`.
4. "Try again in a minute" shows only when Apple sends no `Retry-After`; the forced 429 always
   sends one, so this wording is not reachable by hand.

## 6. As built (2026-09-25)

- **`src-tauri/src/apple_calls.rs`** holds both parts (a module of its own rather than more of
  `apple.rs`). The four functions call `observe()` after each reply: `count`, then `on_429` on a
  429, then the old `log_failure`. A request that gets no reply counts as `net`.
- **The counter:** the table of §2. `[apple] calls 1h: … | since launch: …` from a thread that
  wakes once an hour (the watchdog's pattern), written only when the hour had a call.
  `[apple] calls quit` from `RunEvent::Exit` in lib.rs, which covers every way out (the tray's
  Quit and the last window closed). The same text reaches the ring as `apple:calls`.
  `apple_calls_status` (a command) returns the counts and the back-off now.
- **Background or user:** a `tokio::task_local` scope. A background command runs its body inside
  `apple_calls::background(job, …)`, so every Apple call in its tree is known to be background,
  helpers included. Before it starts, it asks `skip(job)`: while a back-off holds it returns at
  once — an empty result where that cannot mislead (`library_sync` 0, `apple_playlists_sync` 0,
  `apple_playlist_counts` 0), or the error `apple_calls::BUSY` where an empty result would be
  stored as an answer (`playlist_refetch`, `recent_played_tracks`, `recent_added`,
  `artist_new_releases`, `favorites_reconcile`, `favorite_collection_reconcile`). The front end
  keeps what it has on that error; `isAppleBusy` (apple-health.ts) keeps the playlist refresh's
  skip out of the ERROR log. Inside the scope, the four functions also refuse to call.
- **The background jobs** (read from every timer and launch path, 2026-09-25): the startup
  library sync (`library_sync` with `full` not true — the Refresh button passes `full: true`
  and is the user's), the mirror sync (`apple_playlists_sync` with `fresh: false` — the ⟳ is
  the user's), the eager playlist counts, the playlist refresh (hourly and on open), Home's two
  Apple reads and its New shelf, and the two ♥ reconciles. Everything else is a user call.
  **Added 2026-09-28:** the catalog heal (`catalog_heal`, heal.rs), after every library sync —
  one catalog search per library song Apple sent with no play id, at most 50 per pass, stopping
  at the first failed call. Its backstop `catalog_heal_one` (one song, when MusicKit leaves a
  library id out of an insert) is a user-path call: it serves a play.
- **The 429 toast** (`apple-busy`, apple-health.ts): `warn`, 6 s, the words of §3; a second 429
  within 6 s adds none. `apple_check`'s probe reads a 429 as "the token is fine" (`ok`), so a
  busy Apple never shows "Apple Music isn't responding to DeetsMusic".
- **The desk test's 429:** `apple_force_429 { n, secs }` — the next `n` calls answer 429 with
  that `Retry-After`, sent nowhere. A release build refuses it.
- **A network drop in a song (2026-09-27, TOASTS.md §5):** `apple_check` takes `live` (skip
  the cached answer; the drop's first check, at most 2 calls) and lets a fresh check through
  after "unreachable" (a request with no reply never reached Apple). The fast rechecks
  (2, 5, 10, 20, 30 s, then 60 s) run only while the network is out. The desk test's drop:
  `apple_force_offline { secs }` — the check's probes fail as if no reply came. A release
  build refuses it.
- New dependencies, both already in the tree: `tokio` (`rt`, for `task_local`) and `httpdate`.
- Unit tests: the groups, the classes, `Retry-After` as seconds and as a date, the summary line.
- **Known gap:** a user call that gets a 429 may also show its own failure toast ("Couldn't
  search") beside the busy toast. Not seen: no 429 has ever reached a log.

## 6a. The library sync and a 429 (as built 2026-09-29)

- **Before:** a 429 on a page of the full sync ended it with `phase: "error"`, and the sync toast
  said "Check your connection" / "Try Refresh in Library". The straggler retry loop (failed pages
  retried one at a time) did not ask `backing_off()`, so it sent more requests into the 429.
- **Now:** the retry loop asks `apple_calls::backing_off()` before each page; while it holds, the
  rest are skipped (`retry skipped (Apple back-off, Ns left)` in the error message). Every sync
  `error` event carries `busy` (the back-off holds) and `background` (`apple_calls::in_background()`).
- **The front end** (track-store.ts): `busy` shows no sync toast. The user's pass (the ⟳, the
  sign-in pass) calls `tellBusy()` (apple-health.ts), which shows the §3 busy toast only when
  one is not already on screen — the 429 itself usually just showed it. A background pass stays
  quiet, as §3 says. Diag: `library:syncBusy { background }`.
- **The sync's own cost** (DATA-ARCHITECTURE.md §5a, the same day): a launch is now 1 call
  (`limit=1` count) + 1–2 incremental pages + 1 artist count, where a full pass (~40–60 calls)
  used to run on most launches. The full pass runs when the count changed, weekly, or on the ⟳.

### Desk test (dev app; restart the runner: new Rust)

1. `apple_force_429 { n: 1, secs: 30 }` (§5 step 2's command), then the Library ⟳. The
   pass's first page gets the 429: ONE busy toast ("… Try again in 30 seconds."), no "Couldn't
   sync your library. Check your connection.", and `library:syncBusy` in `deetsmusic diag`.
   (The retry-loop skip needs a 429 in the middle of the parallel burst; the forced 429 hits
   the next call, which is the first page. Read the code for it: `backing_off()` in the loop.)
2. Restart the app within the 30 s: the launch sync logs `apple: back-off skip library_sync`
   (only if a back-off still holds) and no toast.

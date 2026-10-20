---
status: designed
desk_test: none
sources: [src-tauri/src/apple_calls.rs, src-tauri/src/apple.rs, src-tauri/src/lastfm.rs, src-tauri/src/report.rs, src-tauri/src/usage.rs, src-tauri/src/update.rs, src-tauri/src/velo.rs, src-tauri/src/sotd/discord.rs, src/perf.ts, src/player.ts, src/room.ts, src/friends.ts, src/presence.ts, src/mosaic-worker.ts, src/album-color.ts]
updated: 2026-10-18
---
# Net calls — one counter for every call the app makes outside the PC

> Designed 2026-10-18 (his ask: "a comprehensive counter / metric for API calls across Apple,
> Last.fm"). Not built. §1 is what talks to the network today, read from the code. §3 is the
> design. §5 holds the open forks. The Apple counter that this grows from is
> [APPLE-CALLS.md](APPLE-CALLS.md); the Apple ledger of call sites is
> [ideas/apple-calls.md](../ideas/apple-calls.md).

---

## 0. Terms

- **Net call** — one request from the app to a server outside the PC. A request to the loopback
  bridge, to `*.localhost` (covers, the wallpaper, user files) or to an AirPlay speaker on the
  LAN is not a net call.
- **Service** — who answers: `apple` (the Apple Music API), `musickit` (MusicKit JS's own
  requests from the webview), `art` (Apple's cover images), `lastfm`, `deets` (our own workers:
  the token mint, the update feed, reports, usage), `rooms`, `friends`, `discord` (Song of the
  Day webhooks).
- **Group** — a part of one service (for Apple: `library`, `me`, `catalog`, `search`, `write`,
  `probe`, as today).
- **Class** — the result: `2xx`, `401`, `403`, `404`, `429`, `4xx`, `5xx`, `net` (no reply).
  These are Apple's eight classes, unchanged (APPLE-CALLS.md §2).
- **Choke point** — the one function that every call of a service passes through. A counter
  sits there, so a new call site is counted with no extra work.

## 1. What talks to the network (read 2026-10-18)

Apple and Last.fm are the two outside APIs with limits that we do not control. There are six
more services.

| Service | Runs in | Choke point | Counted today |
|---|---|---|---|
| `apple` | Rust | the four functions in `apple.rs` (`api_get`, `api_post`, `api_send`, `status_only`) | **Yes**: `apple_calls.rs`, hourly log line, weekly usage counts |
| `musickit` | the webview | none: MusicKit JS makes its own requests (playback, licenses, the queue, `js-cdn.music.apple.com`) | Dev only: one `[perf] click→sound` line per play lists that play's requests (`perf.ts:181`) |
| `art` | the webview | none: `<img>` tags, plus `fetch` in `mosaic-worker.ts`, `album-color.ts`, `playlists.ts:188`, `wallpaper-worker.ts` | No. WebView2's HTTP cache answers most of them |
| `lastfm` | Rust | `call()` in `lastfm.rs:163`: 7 methods (`auth.getToken`, `auth.getSession`, `track.updateNowPlaying`, `track.scrobble`, `track.getInfo`, `album.getInfo`, `artist.getInfo`) | No. Failures go to the log, with no count |
| `deets` | Rust | four places: the mint (`apple.rs`, `music-api.deets.solutions`), the update feed (`update.rs`, `velo.rs`), reports (`report.rs`), usage (`usage.rs`) | No |
| `rooms` | the webview | `room.ts` (one `POST /room` and a WebSocket), `presence.ts` | No |
| `friends` | the webview | `friends.ts` (a WebSocket) | No |
| `discord` | Rust | `sotd/discord.rs` (webhook posts) | No |

**Found while reading (not part of the counter):**
- A Last.fm read (`track.getInfo`, `album.getInfo`, `artist.getInfo`) that gets error 29 (rate
  limit) does not wait. Only the scrobble queue waits (`RETRY`, 5 min, `lastfm.rs:706`).
  Last.fm's terms allow 5 requests a second per IP, averaged over 5 minutes. Presentation mode
  re-reads counts every 5 min, so today's volume is far below that.
- A Last.fm connect polls `auth.getSession` every 3 s for up to 5 min: up to 100 calls for one
  connect. That is normal for Last.fm's desktop auth flow, but the counter will show it.
- `call()` builds a new HTTP client for each call, so it opens a new TLS connection each time.

## 2. What he gets

1. One answer to "how many calls did the app make, to whom, and how many failed", for any hour
   of any day, with no log reading.
2. The same answer across installs, by week, on the owner page (if §5 F3 is yes).
3. A warning sign before a service limits us: a 429 (or Last.fm error 29) from any service is
   counted and logged, not only Apple's.

## 3. The design

### 3.1 One table in Rust (`net_calls.rs`)

- `apple_calls.rs` keeps the 429 back-off and the background scope. Its counter table moves to a
  new `net_calls.rs` and grows one axis: **service × group × class**.
- Each Rust choke point calls `net_calls::count(service, group, status)` after each reply. The
  Apple path does what it does today, through the new table.
- **The Last.fm classes.** Last.fm sends its own error codes in the JSON body. They map onto the
  same eight classes: 4, 9, 14, 15 (auth) → `401`; 6 (not found) → `404`; 29 (rate limit) →
  `429`; 11, 16 (service down) → `5xx`; any other code → `4xx`.
- **The Last.fm groups:** `scrobble`, `nowplaying`, `info` (the three `getInfo` methods),
  `auth`.
- **The `deets` groups:** `mint`, `update`, `report`, `usage`. **`discord`:** `webhook`.
- **Time taken.** Each count also adds its round trip into a small per-group histogram (the
  fixed buckets: under 100 ms, 100–250, 250–500, 500 ms–1 s, 1–3 s, over 3 s), so the line can give p50 and p90. (Fork F1.)

### 3.2 The webview's requests (`net-watch.ts`)

- A `PerformanceObserver` on `resource` entries, in the release build too. It replaces nothing:
  `perf.ts` keeps its dev-only per-click line.
- It sorts each entry by host into `musickit`, `art`, `rooms`, `friends`, and drops
  `*.localhost` and `ipc.localhost`. Classes come from `responseStatus`.
- **A cache hit** (`transferSize` 0 with a body) counts as `cached`, apart from the network
  calls. This shows how often a cover or a MusicKit file came from the disk.
- Every 60 s it sends its counts to Rust in one `invoke` (`net_calls_add`). Rust folds them into
  the same table. So there is one table, one log line and one report.
- **The WebSockets** (`rooms`, `friends`): a connect, a reconnect, a close with an error. Not each
  message.

### 3.3 Where it shows

- **The log line**, hourly and at quit, beside the `[apple]` line:
  `[net] calls 1h: apple 113 (404 ×1) · lastfm 42 · musickit 61 (cached 140) · art 9 (cached 512) · deets 2 · 429 0 | since launch: …`.
  The `[apple]` line stays as it is: scripts and docs read it.
- **`diag`**: `net:calls` in the ring, and a `net_calls_status` command (counts, p50 / p90, the
  back-off state) that the `diag` MCP tool reads.
- **The weekly health report** and the owner page (fork F3).
- **A place in the app** (fork F2).

### 3.4 Keep a day's numbers (fork F4)

- Today the counts live in memory and reset at each launch. The only history is the log.
- The design: a `net_calls` table, one row per **day × service × group × class**, with the count
  and the histogram. The hourly fold adds the hour into the day's row. That is about 24 small
  upserts a day, well under 1 MB of disk writes a month.
- Kept 13 months, the same as the usage counts.

## 4. What it costs

- 0 extra net calls. No new thread: the fold rides the hourly `apple-calls` wake.
- One `invoke` a minute from the webview, only when there were new entries.
- Schema change only if F4 is yes.
- The usage allow-list and the DeetsSupport worker change only if F3 is yes. A worker deploy is
  his call.

## 5. Forks (open)

- **F1 — what each call records.**
  - **A (recommended):** the count and the class, plus time taken (p50 / p90 per group) and, for
    the webview, cache hits and KB down. Cost: a histogram per group; the webview numbers depend
    on probe N1.
  - B: the count and the class only (what Apple has today). Cost: no timing data for the network
    health panel ([ideas/speedtest.md](../features/speedtest.md)).
- **F2 — a place for the user to see it.**
  - **A (recommended):** a *Network* section in Settings › Updates (or the speed test panel when
    it is built): calls today and this week per service, failures, cache hits, and the 429
    count. Read only. Cost: a new section, its hints, a New mark, a Compass row.
  - B: owner only: the log, `diag` and the owner page. Cost: a user who asks "why is my app
    slow" has no answer on screen.
- **F3 — the weekly health report across installs.**
  - **A (recommended):** add the new services to the counters that already go out (numbers only,
    the same buckets, USAGE-COUNTS.md §2's rules). Cost: the allow-list, the worker's metric list,
    the README › Privacy paragraph, a deploy.
  - B: Apple only, as today. Cost: he sees Last.fm and MusicKit failures only on his own PC.
- **F4 — keep a day's numbers on disk.**
  - **A (recommended):** the `net_calls` table of §3.4. Cost: a schema bump (v22).
  - B: memory and the log, as today. Cost: F2's "this week" needs the log, and the log rotates.

## 6. Probes before a build

- **N1.** Does WebView2 give `responseStatus`, `transferSize` and `encodedBodySize` for
  cross-origin `<img>` loads from Apple's cover host? MusicKit's own requests are readable (the
  dev `[perf]` lines show their statuses). An `<img>` is a no-cors request; without a
  `Timing-Allow-Origin` header the sizes read 0 and the status may read 0. If so, `art` counts
  requests and time only, and a cache hit cannot be told from a network load.
- **N2.** How many `resource` entries does a long session make? The buffer holds 250 by default;
  the observer must read them as they come and clear the buffer.

## 7. Desk test (to write at build time)

Not written yet. It will force a 429 on each Rust service (`apple_force_429` today; a Last.fm
twin), then read the `[net]` line, `net_calls_status` and, for F2, the section on screen.

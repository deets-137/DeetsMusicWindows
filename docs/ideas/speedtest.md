---
status: idea
desk_test: none
sources: [src/airplay.ts, src-tauri/src/airplay.rs, src/player.ts, src/apple-health.ts, src/rules-facts.ts, src-tauri/src/apple_calls.rs, index.html]
updated: 2026-10-16
---
# Speed test — a race car button and a panel for the network's health

> An idea (2026-10-16), not built. His ask, with a drawing of a race car (a low body, a rear
> wing, two wheels, a speed line): a title bar button with the race car glyph. It opens a panel
> that tells the user how good their network is for music: the internet link, Apple Music, the
> stream, and the AirPlay link. His words: "without much extra tooling if possible". §1 is
> what the app already knows; §2 what the panel shows; §3 the new code; §4 the rules that
> follow; §5 the forks (all closed
> 2026-10-16, his calls), the probe of what Apple sends (§5.2), the fetch wrap (§5.3, his call);
> §6 how the wrap is tested on every change.

## 0. Terms

- **Race car button**: the new title bar button. The glyph is his drawing.
- **Speed panel**: the dropdown panel the button opens.
- **Health row**: one row of the panel. It names one link and gives one verdict word.
- **Verdict**: *Good*, *Fair* or *Poor*. The number behind it is in the row's hover hint.
- **Passive signal**: a number the app gets from work it does anyway. It costs no request.
- **Active test**: a request the app sends only to measure (a download of a test file).

## 1. What the app already knows (read 2026-10-16)

Most of the panel needs no new request. These are passive signals:

- **Online or offline.** `navigator.onLine` and the `online` / `offline` events. The rules
  engine already has the fact `online` (`src/rules-facts.ts`).
- **Chromium's network estimate.** `navigator.connection` gives `downlink` (Mbps),
  `rtt` (ms), `effectiveType` (`4g`, `3g`, …) and `saveData`, with a `change` event. The
  player reads `downlink` today to pick the stream bitrate (`applyStreamQuality`,
  `src/player.ts`). Chromium rounds these values and caps `downlink` at 10 Mbps, so it is an
  estimate, not a measurement. It is good enough for a *Poor* verdict, not for a number to brag
  about.
- **The stream bitrate.** `music.bitrate`: HIGH (256 kbps) or STANDARD (64 kbps), and the
  `player:bitrate` diag line says why it changed.
- **Stalls.** The player sees MusicKit's `waiting` and `stalled` states (`buffering` in
  `src/player.ts`). Nothing counts them today.
- **Apple Music's state.** `src/apple-health.ts` names the trouble: `none`, `app` (Apple
  refuses), `offline`, `signin`. `src-tauri/src/apple_calls.rs` counts every Apple call with
  its status, and holds the 429 back-off (`backing_off()`).
- **The AirPlay link.** The crate's `Session::stats()` (`deets_airplay`, `session.rs`) gives:
  `rtt_last_ms` and `rtt_p95_ms` (keep-alive round trips), `retransmit_requests` (packets the
  speaker asked for again: lost packets), `packets_sent`, `starved_packets` (silence because the
  PC ran dry), `latency_ms` (the buffer). Rust reads it every poll and logs a `stats` line each
  60 s (AIRPLAY.md §13.4). **But `airplay_status` sends only `latencyMs` to the front end**
  (`Connected` in `src-tauri/src/airplay.rs`). The rest stays in Rust.
- **The tap.** `tapStarved`: tap mode, the player plays, but no audio came for 10 s.

What the app does **not** know today:

- **Real throughput.** No number says "your link carries N Mbps". Two ways to get one: §2.3.
- **Wi-Fi signal strength.** Windows gives it through the WLAN API (`WlanQueryInterface`,
  signal quality 0–100, and Wi-Fi or Ethernet). The `windows` crate is already a dependency;
  this is one more feature flag (`Win32_NetworkManagement_WiFi`). No new tool.
- **Rooms and Friends sockets.** Not read for this doc. A probe: does either socket keep a
  ping time?

## 2. What the panel shows

### 2.1 The rows

One health row per link, top to bottom, in the order the music travels:

| Row | Verdict from | Hover hint shows |
|---|---|---|
| **Internet** | online + `effectiveType` + `rtt` | "About 9 Mbps, 50 ms (Windows' estimate)" |
| **Wi-Fi** (only on Wi-Fi) | signal quality | "Signal 72 %" |
| **Apple Music** | `apple-health` trouble + recent call errors + back-off | "Last 10 calls fine" or the cause |
| **Stream** | bitrate + stalls this hour | "256 kbps · 0 stalls" |
| **AirPlay** (only when connected) | `rtt_p95_ms` + retransmits per minute + starved | "HomePod · 12 ms · 0.1 % resent" |

A row with nothing to say does not show (no AirPlay row without a speaker). A row in *Poor*
says one short line under it in the user's terms ("Songs may pause to load."), never a code.

### 2.2 The button's state

The glyph stays still when all is well. When a row goes *Poor*, the button can say so (a color
or a motion). That is a fork (§5 F3), because it is a new signal in the title bar.

### 2.3 An active test (a fork, §5 F1)

A true "speed test" sends a download and times it. Options, all at zero Apple calls:

- **Read the stream's own downloads.** MusicKit fetches the song in segments. The webview's
  Resource Timing (`performance.getEntriesByType("resource")`) has each fetch's duration. If
  Apple's CDN sends `Timing-Allow-Origin`, it has the byte count too, and the app gets real
  throughput from songs that play anyway. A probe decides it: read the entries in DevTools
  while a song plays. Passive, free, the best if it works.
- **A test file on our own worker.** A *Run test* button downloads a fixed file (at most
  2 MB, §5 F1) from deets.solutions and times it. No third party sees the user. It costs our
  Cloudflare bandwidth, and it uses the user's data, so it runs only on a click.
- **A third-party test** (Cloudflare's speed endpoint, Ookla): ruled out. It sends the user's
  IP to a service they did not pick.

## 3. The new code (small)

- **Rust:** `airplay_status` adds the crate's `Stats` fields to `Connected` (serde, no new
  logic). Optional: one `net_wifi` command over the WLAN API (`spawn_blocking`, CLAUDE.md
  Conventions). Optional: an `apple_calls` summary for the panel (errors in the last N calls).
- **Front end:** a `src/speed.ts` module: it collects the signals, counts stalls, computes
  each verdict, and builds the panel on `makeDropdown` with `.pop` and `enterRows`
  (CLAUDE.md checklist item 1). It polls only while the panel is open, as `airplay.ts` does.
- **No new thread** that only waits (checklist item 16).

## 4. The rules that follow

- The button joins the **icon square** family of the title bar (the Compass button is the
  reference), its own token alias, no raw value.
- Each verdict word and each line is a hover hint in ONBOARDING.md §1.
- **Rules (checklist item 10):** a `network` fact (`good` / `fair` / `poor`) fits the rules
  engine beside `online` and `dataSaver`. A user rule could then say "when the network is poor,
  stream at Low". That is a later step, not part of the panel.
- **Compass:** the panel exports an opener, so "speed" or "network" in Ctrl+Space opens it
  (COMPASS.md §9); the words go in COMPASS-TERMS.md.
- **Agent:** the `diag` MCP tool could return the same verdicts, so an agent can answer "why
  does the music stutter?".
- If a *Poor* verdict ever raises a toast, it goes through `apple-health.ts` (one cause, one
  toast), never a second toast of its own.

## 5. The forks — closed 2026-10-16 (his calls)

- **F1 — what measures throughput: passive first, a small test file as well.** The song
  downloads the app makes anyway are the main measure (§2.3, first option). A *Run test* file
  on our own worker is allowed on two conditions (his words): it is **no more than a couple of
  MB**, and it **adds no storage to the app**. So:
  - The file is at most 2 MB. A larger file needs his OK.
  - The download uses `fetch(url, { cache: "no-store" })`, reads the body as a stream, counts
    the bytes, and drops them. Nothing goes to disk: not the WebView2 HTTP cache, not the
    database, not a file. Only the result (Mbps, ms, the time) stays, in memory, for the panel.
  - It runs only on a click of *Run test*, never on its own.
  - Before the build: the probe in §2.3 (does Apple's CDN send `Timing-Allow-Origin`?). If it
    does not, the passive row shows only Chromium's estimate and the stall count, and the test
    file is the one real number.
- **F2 — where the button sits: (a)** the Max title bar, beside the Compass and the Updates
  button (UpdatesButton.md).
- **F3 — does the button warn: (a)** yes. The glyph changes when a row is *Poor*. The exact
  change (a color, or the car slows) is his drawing, with the glyph.

### 5.1 Why the song downloads can measure the link (his question, 2026-10-16)

Yes, with two limits:

1. **The byte count may be hidden.** The webview records every download's start and end time
   for any server. It records the size of a download from another server only when that server
   sends the `Timing-Allow-Origin` header. Without it, the app knows *how long* each piece took
   but not *how big* it was. The probe in §2.3 answers this.
2. **The pieces are small.** A song comes in pieces of a few hundred KB, and the player asks
   for one only when its buffer needs it. A small download never reaches the link's full speed.
   So this number answers "is the link fast enough for music?", not "how fast is the link?".
   The test file (2 MB, one piece) gets closer to the full speed, and the panel says which
   number came from which source.

**First look, from the dev log (2026-10-16, no request sent).** The dev app's `[perf]
click→sound` lines already list MusicKit's downloads (`netSince()` in `src/perf.ts`). A song
comes from `aod-ssl.itunes.apple.com` as many byte-range reads (`206`), about 20 in the first
300 ms, and most take 1 to 3 ms each. A read that short is a cache hit or a tiny range, so its
time says little about the link. The lines do not print the size, so the
`Timing-Allow-Origin` question is still open. The probe reads `encodedBodySize` of those
entries in the dev app while a song plays.

### 5.2 The probe — run 2026-10-16 (his go), and its answer

**How:** the dev app (`dev:app --hidden`, the code at 78b6a64 plus the open work in the tree),
the resource buffer cleared, one song played over the dev bridge (`deetsmusic --port 47826 play
"Bohemian Rhapsody Queen"`), then `performance.getEntriesByType("resource")` read with
`webview-eval.mjs`. No code was changed. The dev app was stopped after. The installed app,
which was playing at the time, kept playing until he paused it himself (its diag ring shows
the press on the Now Playing card).

**What Apple sends:**

| Host | What | Duration | Size fields | `responseStart` |
|---|---|---|---|---|
| `aod-ssl.itunes.apple.com` | the song: one `.m3u8`, then 9 byte-range reads of the `.mp4` (`206`) | 76–300 ms each | **0** | **0** |
| `play.itunes.apple.com` | `webPlayback`, `widevineCert`, the license | 173–547 ms | 0 | 0 |
| `api.music.apple.com` | `/v1/me/account` | 453 ms | 0 | 0 |
| `is1-ssl.mzstatic.com` | cover art | 33–120 ms | **real** (4 KB, 11 KB, 45 KB) | real |

1. **The song server does not send `Timing-Allow-Origin`.** Every size field of a song
   download is 0, and so is every timing point inside it (`responseStart`). The app knows only
   when each download started and ended, not how big it was. **The Resource Timing route alone
   cannot give a speed.**
2. **The cover-art server does send it** (`mzstatic.com`: sizes, HTTP/3). Covers are small
   (4–45 KB), so they say little about the speed.
3. **Status codes do come through** (`responseStatus` 200 / 206): the server allows the page
   to read the response (CORS), it only hides the timing details.
4. With no cache (a cold song), each range read took 76–300 ms. The 1–3 ms reads in the old dev
   log (§5.1) were cache hits.

### 5.3 The fetch wrap — his call (2026-10-16)

**His call: wrap `fetch`, and test it every time for lag, cost and faults (§6).** MusicKit
fetches the song with `fetch()` in our own page, so the page can see each song download at zero
extra requests. The wrap is the lightest form that answers the question:

- **What it reads:** for a response from `aod-ssl.itunes.apple.com` only, the URL and the
  `Content-Length` header (a CORS-safelisted header, so the page may read it). The duration comes
  from Resource Timing, which gives `startTime` and `responseEnd` without `Timing-Allow-Origin`
  (§5.2). Size ÷ duration is the speed of that piece. The duration includes the connection setup
  and the queue, so the number is coarse: it answers "is the link fast enough for music?".
- **What it never does** (the rules, so it stays inside DPLA §3.3.6.D, quoted in SOUND.md):
  it never reads, clones or tees the body; it never changes the request or the response; it
  keeps no byte of the song. It returns MusicKit's own `Response` object, the same one `fetch`
  gave.
- **Every other URL** goes straight to the original `fetch`, with no work beyond one host test.
- **A fault** (a throw in our part) falls back to the plain result, logs one `diag` line, and
  counts it. After 3 faults in a session the wrap removes itself.
- **One switch:** a DevTools flag turns the wrap off with no rebuild, for the A/B runs in §6.
- **Memory:** a ring of the last 50 pieces (URL host, bytes, ms), never more.

Apple's terms read for this: the wrap does not download, upload or modify MusicKit content, and
the song still plays only as MusicKit JS renders it. That is our reading of the clause on file,
not a full re-read of the agreement.

- **Not forks (his drawing decides):** the glyph is the race car. He draws its final shape and
  any motion.
- **For later:** the `network` rule fact (§4); a history graph of the last hour.

## 6. How the fetch wrap is tested — every time (his ask, 2026-10-16)

His words: "ensure we consistently test for any lag, performance, issues". So the wrap gets a
check that runs again on every change to it and before every release that carries it, not a
one-off desk test. All of it uses tools the repo already has (DEBUGGING.md).

### 6.1 Before the first build: a baseline

On the dev app, with the wrap absent (today's code), record N = 20 cold song starts over the
dev bridge (`deetsmusic --port <dev port> play …`), each with its `[perf] click→sound` line.
Keep the medians of: click→sound total, the `stream` stage, and the count of out-of-click
events (`deadNext`, `windowDry`, `misalign`, `desync`, `playbackError`). This is the bar.

### 6.2 The A/B, on every change to the wrap

The same 20 starts with the wrap on and with the DevTools flag off, run in turns (A B A B), on
`dev:built` (the honest build, CLAUDE.md › Graphics):

| Measure | Pass |
|---|---|
| click→sound, median and worst | wrap on within 5 ms of wrap off (the wrap does one host test and one header read) |
| `stream` stage, median | within 5 ms |
| out-of-click events | none that the off run does not also show |
| song-to-song advance (`control seek 97`, 5 times) | no `deadNext`, `windowDry` or `desync` |
| a 20-minute play, the `diag` ring | 0 wrap faults |
| memory (`heaviness-sample.ps1`) | no growth beyond the 50-row ring |
| the wrap's own cost | `performance.measure` around our part: under 0.1 ms per call |
| the numbers it gives | bytes match the `Range` sizes the server sent (a spot check in DevTools) |

A result outside a line is a finding. It is fixed, or the wrap stays off.

### 6.3 Kept so it runs again

- The run is a script in `docs/ops/checks/` (`fetch-wrap.mjs`), listed in its README, so the
  A/B runs the same way each time (his ask of 2026-10-01 for re-runnable checks).
- The pure parts (the host test, the speed from bytes and ms, the ring) live in a small pure
  file with unit tests in `tests/` (CLAUDE.md › unit tests).
- A row in DESK-TESTS.md, and a line in RELEASE.md §0b: a release that changes the wrap runs
  §6.2 before it publishes. A wrap fault is a hang-or-silence risk, so such a release is never
  auto-published.
- The dev telemetry gets one `[perf] fetchwrap …` line per song start (pieces, bytes, ms,
  faults), so any later click→sound line shows whether the wrap was in the path.

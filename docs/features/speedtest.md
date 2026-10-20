---
status: built
desk_test: open
sources: [src/net.ts, src/net-rules.ts, src/net-feed.ts, src/fetch-wrap.ts, src/styles/net.css, src-tauri/src/net.rs, src-tauri/src/airplay.rs, src-tauri/src/apple_calls.rs, src/airplay.ts, src/player.ts, src/room.ts, src/friends.ts, src/perf.ts, src/compass.ts, src/apple-health.ts, index.html, tests/net-rules.test.ts, docs/ops/checks/fetch-wrap.mjs, ../DeetsSupport/src/index.js]
updated: 2026-10-19
---
# Speed test — a race car button and a panel for the network's health

> **Built 2026-10-19 (v1) on `net-worked`; desk test open (§9, his, tonight).** §7 his calls for v1
> (2026-10-19); §8 the as-built record; §9 the desk test. The worker's `/speed` route is on the
> DeetsSupport branch `net-worked`, **deployed 2026-10-19** at his word (version 44de8440, with
> `velopack` merged in; `/speed` answers `2097152 200`). The text below §7 is the design
> as it was; where it disagrees with §8, §8 is the code.
>
> An idea (2026-10-16). His ask, with a drawing of a race car (a low body, a rear
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

## 7. v1 — his calls (2026-10-19)

> **Part:** built · 2026-10-19

His layout: the panel opens on a title line, **"Network:"** and the verdict in the title face,
bold. Under it, graphs of how steady the network has been: packet loss, dropped connections.
At the bottom, the Test: the result on the left, a **Test** button on the right. The forks, each
his:

- **N1 — the words: Good · OK · Bad** (his, spelled "OK"). They replace §0's Good / Fair / Poor.
- **N2 — the graphs: (c)** a status-page bar per link, 60 cells, one per minute of the last
  hour, plus two lines on the AirPlay row (its round trip and its resent share), the one link
  whose numbers are continuous. Line graphs for the rest were ruled out: Chromium rounds its
  estimate, and most signals are events, so a line would sit flat.
- **N3 — internet packet loss: (b)** a ping from Rust to `support.deets.solutions` (our own
  worker on Cloudflare) every 30 s, **only while music plays**. It is the one packet-loss number
  the app has for the internet link; a webview cannot ping.
- **N4 — the fetch wrap in v1: (b)** built as §5.3 says. He runs §6 on his machine.
- **N5 — the Wi-Fi row: (b)** in v1, from the WLAN API.
- **N6 — the Test file: yes**, a `/speed` route on DeetsSupport, bytes made per request.
- **N7 — the glyph: (a)** Claude draws a placeholder race car from his words (a low body, a
  rear wing, two wheels, a speed line); he replaces it. The warning's final form (F3) is his.
  **Replaced 2026-10-19** by his drawing: straight lines, a rear wing, two wheels of one size,
  no speed line. His motion: the open drives the car off to the right as the next one drives in
  from the left; the close, the other way (`drive` in net.ts, `--net-drive` = the updates
  arrows' roll). The warning is still the Bad color.

## 8. As built (2026-10-19)

> **Part:** built · 2026-10-19

### 8.1 What each row reads

| Row | Shows when | Reads | A cell is Bad when (net-rules.ts) |
|---|---|---|---|
| **Internet** | always | `offline` events; `net_ping` (3 echoes per 30 s while playing); Rooms and Friends (home) socket closes | offline; 3 of 6 echoes lost; median round trip ≥ 250 ms; 3 socket drops |
| **Wi-Fi** | a Wi-Fi reading this hour | `net_wifi` (60 s while playing, and on each open): Windows' signal quality | quality < 40 (OK < 65) |
| **Apple Music** | always | `apple_calls_minutes` (Rust's last 60 minutes of calls: fine / failed); `apple-health` trouble now | 3 failed calls, or only failures; trouble `app` or `offline` now |
| **Stream** | always | mid-song pauses to load ≥ 1 s and song-end gaps (player.ts); the fetch wrap's piece speeds | 2 pauses, or 10 s of pause |
| **AirPlay** | a speaker this hour | each `airplay_status` poll (2 s while connected): the crate's `Stats`, now in `Connected` | resent ≥ 2 % of packets (OK: 0.5 %, a gap from the PC, or a p95 ≥ 150 ms) |

A minute with nothing to judge (no ping while paused, no Apple call) is an empty cell, drawn in
the EQ grid's line. Each threshold's reason is beside it in `src/net-rules.ts`.

- **The title** is the worst cell of any shown row in the last 5 minutes; offline now is Bad;
  nothing to judge is Good. The button's glyph takes the Bad color while the title says Bad
  (F3, a placeholder for his drawing).
- **The row's line** (right of its name): the numbers now: "24 ms · 0 % lost", "Signal 72 % ·
  866 Mbps link", "12 calls this hour, 1 failed", "256 kbps · 0 pauses this hour · songs load at
  9.4 Mbps", "HomePod · 12 ms · 0.1 % resent". A row Bad in the last 5 minutes shows one line
  under its bar in the user's terms ("Songs may pause to load.").
- **A cell's hover hint:** its time and its numbers ("2:14 PM · 6 of 6 pings back · 24 ms").
- **The Test row:** "Pings our server, then downloads 2 MB" before the first test; "Testing…";
  then "38 Mbps · 42 ms · 2 min ago" (a lost echo adds "· 1 lost"). The Bad tone (under 0.5 Mbps)
  takes the Bad color. The Test does not change the title.

### 8.2 The parts

- **`src-tauri/src/net.rs`** — `net_ping(n)` (`IcmpSendEcho`, 1 s per echo, at most 5, IPv4 of
  the worker's host; no admin right), `net_wifi()` (`WlanOpenHandle` → the connected adapter's
  `wlanSignalQuality` and receive rate; `None` on Ethernet or with the WLAN service off),
  `net_test()` (3 echoes, then `GET support.deets.solutions/speed`, each piece counted and
  dropped; one `net: test …` log line). Each is `spawn_blocking` or async: no new thread.
  Two `windows` features (`Win32_NetworkManagement_IpHelper`, `_WiFi`), no new crate.
- **`apple_calls.rs`** — `note_minute` beside `count`: a 60-entry ring of (minute, fine, failed);
  failed = 429, 5xx or no reply. `apple_calls_minutes` reads it.
- **`airplay.rs`** — `Connected` carries `rttMs`, `rttP95Ms`, `packets`, `resends`, `starved`.
- **`src/net-feed.ts`** — the feed, with no imports: `stall` (player.ts), `drop` (room.ts, the
  Friends home socket in friends.ts), `airplay` (airplay.ts, each poll), `piece` (the wrap).
- **`src/net-rules.ts`** — pure: the verdicts, the title, the Test's tone, the wrap's host test
  and piece speed (tests/net-rules.test.ts, 12 tests).
- **`src/fetch-wrap.ts`** — §5.3 as designed: one host test per `fetch`; on Apple's song server,
  `Content-Length` from the same Response; the time from a `PerformanceObserver` on resource
  entries, matched to the call by URL and start time (within 50 ms). Under MusicKit and under the
  license watch (license-watch.ts wraps on top at `initPlayer`), so main.ts imports it third.
  Faults: 3 and it passes every call straight through (it cannot unwrap: the license watch sits
  on top). `deets.dev.fetchWrap = "off"` + a reload never installs it. Dev: `__fetchWrap.stats()`;
  one `[perf] fetchwrap {…}` line after each `[perf] click→sound` line (pieces, timed, bytes,
  ms, unseen, faults, costPerCallMs). `unseen` counts song downloads Resource Timing saw that
  no wrapped `fetch` made: if MusicKit reads the song by XHR, it says so on the first play.
- **`src/net.ts`** + **`styles/net.css`** — the button and the panel on `makeDropdown`, `.pop` and
  `enterRows`; `keepRightInWindow`. The panel rebuilds only when a row comes or goes, and
  otherwise patches each cell, so a hover hint stays put. Timers: the ping (30 s) and Wi-Fi (60 s)
  only while music plays; a 5 s re-read only while the panel is open. Diag: `net:watch`,
  `net:verdict`, `net:open`, `net:test`, `net:offline` / `net:online`, `net:ping` (once, on a fault).
- **Compass:** "Network" in Places (Max only), aliases speed test, internet, wifi, ping,
  connection, packet loss.
- **The worker** (DeetsSupport `net-worked`): `GET /speed` → 2 MB, a 64 KB random block 32
  times, `application/octet-stream`, `no-store`, `SPEED_RL` 6 a minute per IP. Not deployed.
- **Demo:** handlers for the four commands (a steady made-up link).

### 8.3 What Claude decided inside his calls (for his OK)

1. **The Test runs in Rust**, not the webview: the worker's CORS list does not hold the app's
   origin, and Rust counts and drops the bytes with nothing on disk (F1's rule holds).
2. **The Test pings first** (3 echoes), so its line has a round trip; the download alone would
   time a fresh TLS connection.
3. **The Wi-Fi read** runs every 60 s while playing (and on each open), not every 30 s.
4. **The colors** are the traffic lights' three (`--go`, `--pause`, `--stop`), with Good drawn
   quieter than OK so a one-color theme (Moonlight, Black-Red, the yellow one) still tells
   them apart. The title's word stays in the title ink; only Bad takes the Bad color.
5. **No settings key, no New badge, no rule fact** in v1. The `network` rule fact (§4) and an
   agent route stay for later.
6. **The thresholds** in §8.1 (each with its reason in net-rules.ts).
7. **The button's place:** right of the updates button.

### 8.4 Known limits

- Cloudflare's edge may drop an echo under its own load; a lost echo there reads as loss on
  the user's link. Watch the Internet row against the Stream row.
- The bars start empty at each launch (memory only, F1's rule).
- The ping and the Rust code were type-checked for Windows in a cloud session (the
  `x86_64-pc-windows-gnu` target), never run. The demo could not start there either.

## 9. Desk test (his, on the dev app)

1. `npm run dev:app`, Max. The car is right of the Rewind button (on `v-thirtyone`). Hover:
   "Network: Good". Open the panel: the car drives off to the right and the next one drives in
   from the left. Close it: off to the left, in from the right.
2. Play a song. Open the panel: "Network: Good"; Internet, Apple Music, Stream, each with one
   status word on the right (§10). Within 30 s Internet reads "Good". Hover it: "0 % of pings lost
   in the last 5 min, N ms round trip." The newest cell is green.
3. Hover a cell: its time and numbers.
4. Click **Test**: Speed reads "Testing…", then "Good". Hover it: "Just now: N Mbps down, N ms
   round trip." The log has one `net: test` line.
5. Pause. The ping stops (`net:watch {on:false}` in `diag`); the newest Internet cells go empty.
6. Turn Wi-Fi off (or pull the cable): the title says Bad, the car turns the Bad color, the
   Internet row reads Bad at once (its hint: "Offline.") and its newest cell is Bad. Back on: the drop's minutes stay Bad, the title goes back
   to Good after 5 minutes.
7. AirPlay to a speaker: the AirPlay row appears under Internet, and stays for the session.
   Hover its status: the speaker's name, the sound sent again, the round trip.
8. The fetch wrap: after a play, `grep "\[perf\] fetchwrap" …deetsmusic.log | tail -1`:
   `pieces` > 0 and `unseen` 0 means MusicKit reads songs with `fetch`; `faults` 0. Then run
   `node docs/ops/checks/fetch-wrap.mjs` on `dev:built` (§6.2).
9. The worker: once deployed, `curl -s -o /dev/null -w '%{size_download} %{http_code}\n'
   https://support.deets.solutions/speed` → `2097152 200`. Until then, step 4 shows "The test
   did not finish".

## 10. Revised 2026-10-19, evening (his calls)

His review of v1 on `v-thirtyone`, after a fit test of every string in all five skins on the
dev app (the Stream line was cut short in every skin; a long AirPlay speaker name in Press):

- **Wi-Fi is out** ("chuck wifi out"). The row, the `net_wifi` command and its WLAN code
  (`net.rs`), the `Win32_NetworkManagement_WiFi` feature, the `wifi` minute field and
  `wifiVerdict` with its test are gone. N5 is undone.
- **AirPlay takes its place**, under Internet, once a speaker has played this session (not
  only in the hour). Its two lines under the bar (N2 c) are gone. It is the one thing that
  changes the panel's size (about 40 px, once a session); when it comes with the panel open,
  the panel grows gently and the row slides in (his ask: `--pop-grow`, `--pop-ease`,
  `enterRows`, the Rewind panel's own motion).
- **"Played" means music** (found by the motion pass below): the row comes the first time music
  plays while a speaker is on, in this app run. Not on a stats poll, and not on its packets: a
  kept speaker's sender streams silence to hold the session (~125 packets a second with
  nothing playing, measured 2026-10-19), so a connected speaker looked played at launch.

**The motion pass (2026-10-19, his ask: "a similar review for the network widget").** The shots
list [checks/title-panels-motion.json](../ops/checks/title-panels-motion.json) runs the panel on
the dev app in Press and Glass, after a page reload: the open, a status's hover hint, the
AirPlay row arriving with the panel open (`window.__net.speakerPlayed()`, a dev-only handle that
does what music on a speaker does to the row), the Test press (a real 2 MB test), the close.
One fault: the AirPlay row comes in the middle, so the rows under it moved down in one frame
while only the panel's edge glided. Now the row opens its own room (`openRoom`: its height and
the gap above it from nothing, on `--pop-grow`), so the rows under it glide. Worst frames after:
open 16–21 ms, the row's arrival 17–25 ms, the car 8–9 ms; the Test press holds the button in
place ("Testing…", then the word).
- **Minimal text** ("just statuses with interpretation in hover text"). Each row shows one
  word on the right: Good, OK or Bad over the last 5 minutes (the title's words and window),
  "–" while it has nothing to judge. The numbers and what they mean are that word's hover
  hint, in sentences; for a Bad row the hint ends with the advice that was the red line under
  it. The Test row reads "Speed" and the Test's status the same way (`testVerdict`), its
  Mbps, round trip and age in the hint.

**What Claude decided inside his calls (for his OK):**
- Only Bad takes a color, as the title's word does; "–" is in the subtext color.
- The Test row's left word, "Speed".
- Offline reads Bad on the Internet row at once, as the title does, before its minute is judged.
- Apple's wait reads in minutes or hours above 2 minutes ("wait 12 min", not "720 s").
- The hint wording: "N % of pings lost in the last 5 min, N ms round trip.", "None of N calls
  to Apple failed this hour.", "No pauses to load this hour. Songs load at N Mbps.",
  "Living Room: 0.4 % of the sound sent again, 22 ms round trip.", "Just now: N Mbps down, N ms
  round trip."

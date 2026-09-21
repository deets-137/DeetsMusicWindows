---
status: shipped
shipped_in: 0.3.2
desk_test: none
sources: [src/diag.ts, src-tauri/src/log.rs, src-tauri/src/bridge.rs, src-tauri/src/report.rs, src-tauri/src/watchdog.rs]
updated: 2026-09-20
---
# Logging — the rolling log file

What the app writes down, so a fault a user cannot reproduce is still
readable afterwards. It is also the payload an in-app bug report
attaches (`DeetsSolutions/docs/support.md`).

**Scoped 2026-09-11. Steps 1–4 built the same day** (`src-tauri/src/log.rs`, `diag.flush()`, Settings › Bugs;
the "What already exists" section below describes the state before it).
Step 5, the report form, built 2026-09-14 (§The report form, at the end). Two halves already
existed and were not rebuilt; this doc bounds them, joins them, and says what starts writing.

> **Revised 2026-09-13 — front-end warnings and errors are written AS THEY HAPPEN.** Before,
> the front end reached the file only through `diag_flush` (an uncaught error, unload, Open
> folder), so the installed 0.3.1's "Unable to prepare for playback." left no trace at all.
> Now `diag.warn(tag, data)` / `diag.error(tag, data)` fill the ring AND write one line
> through the Rust `log_event` command: `WARN  fe: <tag> <json>`, scrubbed by `write`,
> data capped at 600 chars, same tag+data within 2 s sent once, and at most 60 lines per
> minute (the overflow is counted in one line). Callers: every `warn`/`error` toast
> (`fe: toast`, muted ones too), `player:playFailed` / `playbackError` / `mkTrouble` /
> `authorization` / `reauth` / `reauthLimited` / `reconfigureFailed`, `apple:trouble`,
> `apple:checkFailed`, `account:signInFailed`, and uncaught errors and rejections — unless a
> later listener swallowed a known benign MusicKit race (`defaultPrevented`).
> The unload flush now writes the 300-event block **only when a warn/error happened** since
> the last flush; writing it on every reload rotated the 512 KB file within a day. The
> `start:` line now carries the UTC offset (line times are local; the Worker's are UTC).

---

## What already exists

**Front end — [`src/diag.ts`](../src/diag.ts).** A 300-event ring buffer
with monotonic timestamps. It auto-captures `window:error` and
`unhandledrejection`, exposes `window.__diag` (in release builds too),
and `report()` already returns pasteable text. Its own header calls
itself the future bug-report payload. **Do not rebuild it.** The only
change it needs is a way to reach disk.

**Back end — [`bridge.rs`](../src-tauri/src/bridge.rs) `log()`.** Keeps a
400-line in-memory ring **and appends to `<app_data>/bridge.log`**.
`log_text()` serves that ring at `GET /log`, behind the pairing token.

So a log file exists today. It has five defects.

1. **No rotation, no size cap.** `OpenOptions::new().append(true)`,
   forever. Every bridge request writes a line, so the file grows without
   limit wherever the extension is in daily use. This is a live defect,
   independent of bug reports.
2. **Misnamed.** It now carries autostart and SMTC failures
   (`lib.rs`). It is the app log wearing one module's name.
3. **Almost nothing writes to it** — two call sites outside `bridge.rs`.
   Apple failures, library sync, enrich, playlists, AirPlay and the v2
   migration use `println!`, which no release build shows, or say nothing.
4. **The front-end buffer never reaches disk.** It dies with the window,
   so a reload or a crash loses exactly the evidence worth having.
5. **No redaction, and the file is readable over loopback.** The app
   holds two bearer credentials — the music-user token and the developer
   token — and `/log` hands the buffer to any paired local caller.

---

## The design

`src-tauri/src/log.rs`, about 60 lines, hand-rolled. **No new
dependency**: not `tracing`, not `tauri-plugin-log`. `chrono` is already
in the tree.

```
<app_data>/deetsmusic.log      current
<app_data>/deetsmusic.1.log    previous
```

- **Rotate at 512 KB, keep one generation.** Bounded at about 1 MB,
  permanently. Two files rather than truncating one, because a truncate
  throws away the run-up to the fault, which is the part worth reading.
- **One line per event:**
  `2026-09-11 14:03:22.481  WARN  apple: catalog 429 /v1/catalog/us/songs`.
  The **date** is new — today's format is `%H:%M:%S%.3f`, so a file
  spanning two days cannot be read.
- **Three levels, `INFO` / `WARN` / `ERROR`.** Nothing configurable.
  A level filter is a thing to tune instead of a thing to fix.
- **Always on** (decided 2026-09-11). A useful report needs the log to
  exist *before* anyone knew there was a fault — the reporter usually
  cannot reproduce it on demand. Opt-in logging guarantees the first
  report of every fault is empty. Cost is a few hundred KB and small,
  occasional writes, which is what `bridge.log` already does.
- **A panic hook.** `std::panic::set_hook` writes the payload and
  location. Today a panic on a worker thread vanishes silently. This is
  the highest-value line in the whole change.

### Redaction happens at the write boundary

One scrubber runs inside the write function, **not at the call sites**:
strip anything matching a JWT shape (`eyJ…`), and anything following
`Bearer `. Put it anywhere else and one careless `format!` in a year
defeats it. Two things make this load-bearing rather than tidy: the file
is served over loopback at `/log`, and it becomes the body of a bug
report.

### Ids, never titles

**The log records catalog ids, never track titles or artists** (decided
2026-09-11). A line reads `play song:1445040745 failed 403`. An id can
still be looked up when triaging.

The reason is the report: a log full of titles is a listening history,
and attaching one to a support ticket sends that history to the worker.
Ids keep the file useful and keep the report honest. It also keeps the
report form's wording simple, which matters because that copy is
hand-written.

### Migration

`bridge::log` becomes a thin alias, so existing calls do not churn. On
first run an existing `bridge.log` is **renamed** to `deetsmusic.1.log`,
not orphaned and not deleted.

---

## What starts writing

Deliberately short. A log nobody can read is the same as no log.

| Area | Lines |
|---|---|
| Startup | version, Windows build, which data dir (release or dev) |
| Developer token | **source** — local `.p8` or the worker — and the expiry date. **Never the token.** |
| Apple | failures only: status code + endpoint path |
| Library | sync start / end / counts, and any abort |
| Enrich | batch failures |
| AirPlay | connect, drop, error |
| SMTC / tray / bridge | init failures, port binding |
| Migration | v2 detection, backup path, result |
| Panics | payload + location, from the hook |

Success paths stay quiet apart from those counts. The file must remain
readable by a human at 3 a.m.

## The front-end bridge

A `diag_flush` command appends `diag.report()` into the same file.
Called on `window:error`, on `beforeunload`, and when the report form
opens. Normal use therefore writes nothing extra, and a crash still
leaves a trace.

## Settings

One row: **Open log folder**, via `tauri-plugin-opener` — already a
dependency. The user must be able to read the file before anything is
sent anywhere. Label and hint copy are Aditya's, per the settings row
style.

---

## Build order

1. `log.rs`: the writer, the rotation, the scrubber, the panic hook.
   Point `bridge::log` at it and rename the old file once.
2. Add the call sites in the table above.
3. `diag_flush` and its three triggers.
4. The Settings row.
5. Only then the report form, which is where this meets
   `DeetsSolutions/docs/support.md`.

Steps 1 and 2 are worth doing on their own merits. The unbounded
`bridge.log` is a defect today, and a silent panic is a fault you cannot
diagnose at all.

---

## The report form

**Built 2026-09-14.** `src-tauri/src/report.rs` and Settings › Bugs
(`settings-card.ts`). The worker contract is `DeetsSolutions/docs/support.md`
§Intake.

**Rows, top to bottom:** a title field, a details field, **What went wrong**
(a menu), **Attach log** (on/off + Preview), the preview text, **Send**
(Bug | Suggestion), a status line, **App log**, then **My reports**.

**Who sends.** Rust, not the page. The worker's CORS lists only the
`deets.solutions` pages, so a `fetch` from the app page could send the post
but could not read the code back. `report_send` posts with
`User-Agent: DeetsMusic/<v>` and `source: "app"`.

**What a post carries.** `app`, `kind` (`issue` | `suggestion`), `title`
(10 words, whitespace collapsed first), `body` (4,000), and
`meta: {version, log?}`. A suggestion never carries `log`.

**The log cut.** *What went wrong* picks tags, so the 8 KB `meta` holds the
lines that matter:

| Menu | Tags kept |
|---|---|
| Playback | `player:` `apple:` `token:` `smtc:` `airplay:` `toast` `window:` |
| Sign-in | `sign-in:` `token:` `account:` `apple:` `webview:` |
| Library or playlists | `library:` `playlists:` `favorites:` `enrich:` `migration:` `apple:` |
| AirPlay | `airplay:` `player:` |
| Updates | `update:` |
| Something else | every line |

Every choice also keeps `start:`, `panic:` and every `ERROR` line. A tag is
read after the level, after `fe: `, or after a diag block line's `1234ms  `.
Both log generations are read; the newest lines that fit are kept.

**The user sees what is sent.** Preview shows `report_log`'s text, and a bug
sends that same text. Without Preview, the same cut is taken at Send.
`report_send` scrubs it again, trims the oldest lines if `meta` (8 KB) or
the request (16 KB) would overflow, and refuses a JWT-shaped payload before
it leaves the PC (the worker refuses it too, with a bare 400).

**The code.** The reply's `code` is the only way back to the thread, and it
is a credential. So it is **never logged** (the log rides later reports),
the app saves `{code, kind, title, at}` to `<app_data>/reports.json` (write
beside, then rename; newest 100), and My reports shows each with Open (the
browser, only a saved code) and Copy link. The link is
`https://deets.solutions/deetsmusic/#t=<code>` — a fragment, never a query.

**Privacy pass (2026-09-15).** A report sends log lines, so four leaks were
closed where they start, not in the report code:

- `scrub` writes the user's folder (`USERPROFILE`, both slash forms) as
  `%USERPROFILE%`. A path no longer names the Windows account.
- The migration line logs the backup's file name only.
- The bridge's add lines log ids (`add song <id>`), never titles or artists.
- The AirPlay connect line logs the port only. Every `airplay:` line masks
  IPv4 addresses as `[ip]`, because the crate's error text can hold one.
- **Toast rule:** `toast.ts` logs its text with every “quoted” span replaced by
  `“…”`. **Callers must quote names** (playlists, songs, artists, stations,
  speakers); an unquoted name reaches the log. The station and AirPlay
  messages were changed to quote theirs.
- `report_send` runs the title and details through `scrub` as well, so a
  pasted music-user token (not JWT-shaped) is caught.

**Errors** are plain sentences: no network, 429 (wait a minute), 503 `off`
(switched off for now), 413 / `meta` (turn off Attach log), `title_words`.
The fields keep their text on any failure.

**Tracking (2026-09-15).** My reports has a **Refresh** row and, per report, a
state tag, a dot for an unseen owner reply, and Open | Copy link | Close.

- **Refresh is the only request** (the user's call: nothing at launch or on
  unfold). `report_refresh` sends one `GET /t/<code>` per saved report, in turn,
  and stores `state` and the owner-reply count in `reports.json`, so the tags
  survive a restart. A 404 stores `gone` ("Removed"). A failed request keeps the
  last known values.
- **New reply:** `owner_replies > seen_replies`. **Open** marks them seen
  (reading happens on the web page; the app shows no thread).
- **Close** is two clicks (Close → Sure?), then `POST /t/<code>/close`. It shares
  the worker's 5-per-minute limit. Closed and removed reports hide the button.
- **Right-click a report:** Open, Copy link, Close (sends at once: picking it from
  the menu is the second step), and **Clear**, which removes it from this PC only.
  The post stays on the worker; without its link it cannot be found again.
- **One day for closed posts.** `save` stamps `closed_at` the first time a report
  is stored `closed` or `gone`; `load` drops it 24 hours later. Open reports are
  kept (newest 100). The file stays small without a cleanup job.

---

## Auto-flush — the ring buffer lands every 5 minutes (BUILT 2026-09-18)

**Why.** The user reported: a song played from a Home tile, then **Go to Album**,
then the album's **Play** — and only that one song played. The cause was one diag
line, `player:reclick`. That line was in the ring buffer, in memory. It was NOT in
the log file, because `diag_flush` ran only on `window:error`, on `beforeunload`
and when the report form opened (see **The front-end bridge**). None of the three
had happened, so the file still held the PREVIOUS session. The session had to be
read from `plays.context` over SQL, and the answer stayed a guess between two code
paths until the user flushed by hand.

A bug that does not throw left no front-end trace at all. Most bugs do not throw.

**As built** (`src/diag.ts`):

- **Every event carries a sequence number** (`DiagEvent.n`), and the module keeps
  `flushedSeq` — how far the file has it. `report(since)` filters on it.
- **A flush writes only what is new.** `flush()` returns at once when nothing is
  new, so nothing is written. `flush(true)` re-writes the whole ring
  (`__diag.flush(true)` from the console). This cursor is what makes a frequent
  flush affordable: writing all 300 events per flush is what filled the 512 KB
  file and rotated it on 2026-09-13.
- **A 5-minute timer** (`FLUSH_EVERY_MS`) calls `flush()`. An idle app writes
  nothing.
- **The unload flush is no longer gated on a warn/error.** It writes whatever the
  timer has not, which is at most one interval of events.
- **`__diag.pending()`** prints the text a flush would write now.
- No Settings row: the file is local, rotated and already redacted.

**Two log lines got their context at the same time.**
`player:playContext` now logs `{startIndex, len, ctx}` — two different lists of the
same length used to read the same. `player:reclick` now logs `{id, ctx, len}`, so
the line says what it rejected.

---

## Reading it from outside (BUILT 2026-09-18)

The log file only ever holds what a flush has written. A session being debugged has
more than that in memory. `GET /diag` reads the window's ring as it is now.

- **Route:** `GET /diag?limit=100&since=0&tag=` → `{events:[{n, t, tag, data}], dropped}`,
  oldest first. `since` takes the `n` of an event already read, so a second call carries
  on where the first stopped. `tag` keeps the tags that START with it (`player` takes
  `player:np`, `player:reclick`, …).
- **Where it runs:** `np-bus.ts` case `diag-get` — the window answers, because the ring
  lives there. `bridge.rs` puts `/diag` in `AGENT_ROUTES`, so the Agent control switch
  governs it like every other agent read. It carries song ids, and it is a read of the
  app's own behaviour, so it needs no second switch of its own.
- **CLI:** `deetsmusic diag -n 50 --tag player`. **MCP tool:** `diag` (full pack only —
  a small local model has no use for it).

## The click trail (BUILT 2026-09-18)

`ui:act` says which gesture ran, at the shared primitives only — not per card:

| Where | Line |
| --- | --- |
| `context-menu.ts`, an item runs | `{do:"menu", what:"Go to Album"}` |
| `collection-card.ts`, the Play / Shuffle row | `{at:"<storeKey>:<grouping>", do:"play"\|"shuffle", n, picked}` |
| `collection-card.ts`, a row activates | `{at:"<storeKey>:<grouping>", do:"row", i, n}` |
| `search-card.ts`, a pane's Play / Shuffle row | `{at:"<context>", do:"play"\|"shuffle", n, picked}` |
| `search-card.ts`, a pane row | `{at:"<context>", do:"row", i, n}` |
| `home-card.ts`, a tile | `{at:"home", do:"tile", kind, n}` |

`presence.ts` logs what your Discord profile is told (FRIENDS.md §8.10): `presence:set
{why, song, sent}` — `sent: false` means Discord is not running, which is the ordinary state
of most PCs and not an error — plus `presence:clear`, `presence:off` and the
`presence:pause-arm` / `presence:pause-cancel` pair. The song title is content, and it is here
on purpose: it is the one line that answers "why did my profile say that", and it never leaves
this machine any more than the profile does.

Beside the trail, `row-order.ts` logs every committed MOVE (MOVABLE-ROWS.md §13.7):
`order:set {scope, n, id, to, after}` — which list, how long it is, what moved, the index it
landed on and the id it now follows — plus `order:reset {scope}` and `order:restore {n}`. That
is what makes "my Home is in the wrong order" readable rather than guessed. `scope` and `id`
are our own names (`home.shelves` / `pinned`), except a playlist's id, which is its libraryId.

`n` is what the gesture ACTS ON, which is the fact that reads a bug: a Home song tile
logs `n:1`, and the album's Play under it logs `n:6`. Reading the play that follows
without this is guesswork — it was, on 2026-09-18.

**The one content exception, on purpose:** a menu row logs its **label**, capped at 40
characters. The label is the gesture; it is a UI word, not a song title, and the trail is
worth nothing without it. A submenu row can carry a playlist name the user wrote. Nothing
else in the trail carries content — the rest is counts, indices and surface names.

---

## The freeze watchdog (BUILT 2026-09-20)

`src-tauri/src/watchdog.rs`. **A freeze is the one failure that cannot report itself**: the
thread that would write the line is the thread that is stuck. On 2026-09-20 the app froze on
live for 36 minutes and wrote nothing at all — the log simply stopped mid-session, and the
only evidence was `AppHangB1` in the Windows Application log, found hours later
(FRIENDS.md §8.11).

So a thread outside the event loop watches it. Every **2 s** it posts a closure to the UI
thread with `run_on_main_thread` and walks away — posting is not waiting, so the watcher is
never caught by what it is watching. If that closure has not run for **5 s**, the UI thread is
wedged, and the watcher can still write, because logging never touches the event loop:

```
WARN  ui: the window stopped answering 7.2 s ago — inside command `presence_set` for 7.4 s
INFO  ui: the window is answering again
```

**It names the command because `lib.rs` wraps the invoke handler** (`invoke_with_watchdog`):
every command records its name on the way in and clears it on the way out. The timing is the
whole point — an **async** command returns almost at once, because `spawn_blocking` moved its
body off this thread, so it clears its name and is never blamed. A name still sitting there
after five seconds is a **synchronous** command blocking the thread that paints. That is the
0.12.0 fault exactly, and this line names it in one second instead of an afternoon.
`— no command was in flight` means the stall is not an invoke: a paint, a plugin, or the OS.

**It ships.** This is not dev-only telemetry like `frames.ts`: the failure it catches happened
to a user on a release build. It costs one wake every 2 s and two atomics. The thresholds are
deliberately slack — a slow frame, a big sort or a cold paint must never write this line.

The gate that stops the cause reaching a build at all is `release-check` check 9
(RELEASE.md §1). The watchdog is the second layer, for a stall the gate cannot see.

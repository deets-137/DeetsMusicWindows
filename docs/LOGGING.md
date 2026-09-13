# Logging — the rolling log file

What the app writes down, so a fault a user cannot reproduce is still
readable afterwards. It is also the payload an in-app bug report
attaches (`DeetsSolutions/docs/support.md`).

**Scoped 2026-09-11. Steps 1–4 built the same day** (`src-tauri/src/log.rs`, `diag.flush()`, Settings › Bugs;
the "What already exists" section below describes the state before it).
Step 5, the report form, is open. Two halves already existed and were not rebuilt; this
doc bounds them, joins them, and says what starts writing.

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

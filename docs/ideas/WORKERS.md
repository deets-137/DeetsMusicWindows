---
status: idea
desk_test: none
sources: [src-tauri/src/db_thread.rs, src-tauri/src/lib.rs, src-tauri/src/library.rs, src-tauri/src/presence.rs, src-tauri/src/lastfm.rs, src-tauri/src/airplay.rs, src-tauri/src/apple.rs, src/home.ts, src/album-color.ts, vite.config.ts]
updated: 2026-09-25
---
# Workers and queues in Rust

Opened 2026-09-25 by the owner. He designs and builds from this doc on 2026-09-26. Nothing
below is decided except the part marked **built**. The forks are his.

**Terms.** A **worker** is one thread or one async task that owns a loop. A **queue** is a
channel: one side sends a message, the worker side receives it. An **actor** is a worker that
owns its state and only receives messages, so no other code needs a lock on that state. The
**UI thread** is the thread that paints the window; a synchronous `#[tauri::command]` runs on
it (RELEASE.md §1 check 9).

---

## 1. What the Rust side does today (measured 2026-09-25)

| Fact | Count | Where |
|---|---|---|
| Thread or task spawn sites | 41 in 12 files | `airplay.rs` 8, `lastfm.rs` 6, `media.rs` 6, `bridge.rs` 5, `apple.rs` 4, `presence.rs` 3, the rest 1–2 |
| Long-lived loops | 11 | `apple.rs`, `audio_out.rs`, `dbhealth.rs`, `lastfm.rs` ×2, `library.rs`, `log.rs`, `presence.rs`, `query.rs`, `report.rs`, `watchdog.rs` |
| Channels before today | 0 | every subsystem shared its state through a `Mutex` |
| Raw `.lock().unwrap()` outside `Db::lock` | ~150 | `apple.rs` 52, `airplay.rs` 30, `lastfm.rs` 22, `bridge.rs` 15 (moved to `lock_or_recover` on 2026-09-25, `lock.rs`) |
| Tauri commands | 216 | 146 sync, 70 async before the database thread landed |

Each subsystem starts its own thread and keeps its own state behind a lock. Nothing holds
"work to do" as a value you can count, order, or cancel. The three shapes below are the ones
that fit this codebase. A general job system with priorities and retries for everything is
**not** one of them: the three workloads have three different shapes, and one queue for all
of them reads worse than three small ones. No new runtime is needed: Tauri already runs
tokio in the process, and `std::sync::mpsc` is enough at these message rates.

---

## 2. Shape 3 — one database thread
> **Part:** built · 2026-09-25 (`src-tauri/src/db_thread.rs`, uncommitted; desk test open)

Every command that takes `Db::lock` runs on one thread, one job at a time, in arrival
order. A command sends its closure down a channel and awaits the reply; the UI thread never
waits on the lock. His call on 2026-09-25, built the same day in the codebase-evaluation
session. The record is DB-HEALTH.md and the module's own header comment.

**Why one thread and not a pool.** Windows does not hand a waiting mutex out in arrival
order, so two quick writes to one row during a sync could land reversed. One thread with one
first-in-first-out queue keeps the order the user tapped.

**What it does not change.** A call made during the library sync still waits for the sync
to release the lock between pages. The window no longer freezes while it waits. §5.1 is the
next step from here.

---

## 3. Shape 1 — one actor per subsystem that talks outside the app

One `std::sync::mpsc` channel and one thread per subsystem. The thread owns the HTTP client,
the socket or the pipe, and the subsystem's state. A Tauri command becomes "send a message,
return at once", so it can never block the UI thread, and the `Mutex` on that subsystem's
state goes away because only the actor touches it.

Candidates, in order of the pain they caused:

| Subsystem | Today | Why an actor |
|---|---|---|
| `presence.rs` (Discord) | 3 spawns, a pipe, a loop | the 0.12.0 freeze was a blocking wait in a sync command on this pipe (FRIENDS.md §8.11) |
| `lastfm.rs` | 6 spawns, 2 loops, 22 raw locks | scrobble, now-playing and auth share one state under one lock |
| `airplay.rs` | 8 spawns, 30 raw locks | scan, connect, volume and the tap are four writers to one state |
| `apple.rs` write calls | 4 spawns, 52 raw locks | the token and link state; the read side belongs to shape 2 |

**Cost.** One `enum Msg` per actor and about 60 lines of loop each. **Benefit.** The
release gate's job gets simpler: a command that only sends has nothing to block on.

**Forks for him.** Which subsystem first (my pick: `presence.rs`, smallest and the one
that froze live). Whether the actor replies through a `oneshot` (a command that needs an
answer, like the Last.fm status) or fire-and-forget (a scrobble).

---

## 4. Shape 2 — one Apple call queue

This is APPLE-CALLS.md (designed, not built) given a worker. One task owns every catalog and
library request. It counts calls, holds a priority per job, dedups the same URL in flight,
and does the 429 back-off in one place. A caller sends a job and awaits a `oneshot` reply.

**Today** the Home shelves (two recents lists at open), the New shelf (four calls a day),
credits, artwork, the palette and the playlist refresh each call Apple on their own schedule,
and each dedups its own in-flight calls by hand (`appleInFlight` in `home.ts`, `inFlight` in
`album-color.ts`). **Benefit.** The call counter and the back-off become real, and a burst at
startup can be ordered: what the user sees first, first.

**Forks for him.** The call budget per minute, before anything else. The priority classes
(my pick: `visible`, `soon`, `background`). Whether the queue lives in Rust behind one
`apple_call` command, or in the front end over the existing commands.

---

## 5. Where a worker or a queue speeds the app up (read 2026-09-25)

The honest picture first. **Click-to-sound is at Apple's floor**: our part is ~10 ms and the
rest is MusicKit's teardown, asset lookup, license and buffering (UX-COVERUPS.md §5). No
worker moves it. **Boot** reads `boot:ready` at ~650–700 ms in the dev app and ~410 ms
installed (the cover's own time, from the app log). The levers below are the ones the code
shows, largest first. Measure before and after each with the numbers named.

### 5.1 Reads beside the database thread — the largest lever
The database runs in WAL mode (LOCAL-DATA.md §3), which lets readers run **while** the
writer writes. The new database thread (§2) serializes reads and writes on one connection,
so it gives that up: Home's open runs five reads in `Promise.all`
(`playEventsSince`, `playlistsCached`, `addedAtMap`, `artistPhotos`, `playCounts`), and they
now run one after the other, and every one of them waits behind a sync page write.

**The change.** A second connection, read-only, for the read commands (`library_tracks`,
`seen_tracks`, `play_counts`, `diary_list`, `favorites_cached`, the `query` sandbox already
opens its own). The writer thread keeps every write in order; reads never enter its queue.
**Expected gain.** A read during the library sync goes from "wait for the page" (up to
seconds) to milliseconds; Home's five reads overlap again. **How to measure.** Add one diag
line in `db_thread.rs`: the queue wait of any job over 50 ms, with its name. If that line
never prints, this lever is not real and stops here.

### 5.2 Pipeline the library sync
`library.rs` fetches a page of 100, then writes it, then fetches the next. A first full pass
of a 3,895-song library is 39 pages, so network and SQLite take turns. **The change.** Two
stages on a channel: a fetcher task that keeps one page ahead, and the writer that upserts.
**Expected gain.** Total time near `max(network, write)` instead of their sum, on the first
run and the daily full pass only; the incremental pass stops at the first known page and
gains nothing. **How to measure.** The `library: incremental sync done … in N page(s)` log
line already carries the count; add its elapsed ms.

### 5.3 Pre-warm the next song's palette and cover
`album_palette` is cache-first, then one Apple lookup on a miss, fired at the song change.
On a miss the aurora and the album text land after the fetch, not with the song. **The
change.** A small prefetch: when the queue settles, ask for the next item's palette and
cover. It is one job for the Apple queue (§4) at `soon` priority. **Expected gain.** The
color swap lands with the song on every song, not only cached ones. **How to measure.**
`[perf] click→sound` already logs the stages; add the palette's arrival offset.

### 5.4 Split the bundle
Vite emits one 754 kB main chunk. Only `np-bus`, `search` and `settings-store` load lazily.
`settings-card.ts` (2,756 lines), `sound-panel.ts` (1,485), `compass.ts` (1,449),
`diary-card.ts` (1,346) and `web.ts` (1,203) are about a fifth of the front end and none is
needed to paint the first frame. **The change.** `import()` each at its opener, behind the
same `.pop` motion. **Expected gain.** Less script to parse and compile on a cold start,
tens of ms rather than hundreds: WebView2 caches compiled bytecode, so a warm start gains
less. **How to measure.** `boot:ready` in the app log, ten cold starts before and after.
This is not a worker; it is here because it is the one boot lever left.

### 5.5 Not worth a worker
- The `cover` and `wallpaper` URI protocols spawn one thread per request. At their rate
  that is fine.
- The mosaic already runs on a Web Worker (`mosaic-worker.ts`).
- Search already drops stale replies with a token and debounces at the field.
- The Ocean perf check (OCEAN.md §6) is open in HANDOFF; it is a GPU question, not a thread
  one.

---

## 6. The order, for him to accept or change

1. The diag line in §5.1 (one line; tells us whether the read connection is worth building).
2. Shape 1 on `presence.rs`, then `lastfm.rs`: the freeze class, smallest blast radius.
3. The read connection (§5.1) if the line prints.
4. Shape 2, the Apple queue, once the call budget is decided; §5.3 rides on it.
5. §5.2 and §5.4 as measured, separate, low-risk changes.

One at a time: each shape is a load-bearing primitive (CLAUDE.md › Working style).

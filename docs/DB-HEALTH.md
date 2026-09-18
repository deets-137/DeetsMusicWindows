# DeetsMusic — is the database still writable?

What happens when a SQLite write fails, what we now measure, and why there is no queue.

Status: **built 2026-09-17.** Code: `src-tauri/src/dbhealth.rs`, `Db::lock` in
`src-tauri/src/library.rs`.
Siblings: [LOCAL-DATA](LOCAL-DATA.md) (WAL, the read-only SQL tool),
[LOGGING](LOGGING.md) (the rolling log these lines land in),
[LASTFM](LASTFM.md) (the one real queue in the app, and why it is one).

Terms used in this doc:
- **Canary** — a write, a read back and a compare, run on a timer to prove the path works.
- **Poisoned lock** — a Rust `Mutex` that a thread panicked while holding.
- **`busy_timeout`** — how long SQLite retries a locked database before it gives up.

---

## 1. What the app did before

Four patterns, no fifth:

| Pattern | Sites | What happened |
|---|---|---|
| Propagate to the caller (`map_err`) | ~14 | the command rejects; the front end decides |
| Warn and carry on (`log::warn`) | 73 | one log line, the work continues |
| Silent discard (`let _ = conn.execute`) | 4 | nothing at all |
| `.lock().unwrap()` | 88 | not handling. A panic |

And the front end mostly swallowed the rejection. `record_play` is the honest example: the
caller catches, writes a diag line, and drops it (`src/stats.ts`). A play that failed to
record was simply gone.

So there was no retry, no queue and no count — and therefore **no evidence that a write had
ever failed**.

## 2. The fix: `Db::lock`

A Rust `Mutex` poisons when a thread panics while it holds the lock. With
`.lock().unwrap()` at 88 call sites, one panic in any write path made every later lock panic
too. The app kept running and silently stopped remembering anything: plays, scrobbles,
playlists, settings. Nothing recovered it but a restart, and nothing told the user.

`Db::lock()` takes the guard back instead:

```rust
match self.0.lock() {
    Ok(g) => g,
    Err(poisoned) => { dbhealth::note_poisoned(); poisoned.into_inner() }
}
```

Recovering is safe here because every write is one statement or an explicit transaction: a
panic cannot leave a half-applied multi-step invariant in the connection, and SQLite rolls
back an interrupted statement itself. All 88 sites now call it. The first poisoning is
logged and counted, because a panic still happened and somebody should know.

## 3. What is measured

| What | Where from |
|---|---|
| `writesFailed` | `dbhealth::note_fail`, called by `watch(...)` at the write paths that cannot return an error |
| `poisoned` | `Db::lock`, every recovery |
| `canaryRuns` / `canaryFails` | the timer, every 10 minutes, and each `db_health` call |
| `lastError`, `lastFailAt` | the newest failure of any kind |

`watch` is a pass-through, so wrapping a write changes nothing but the counting:

```rust
dbhealth::watch("play", conn.execute(sql, params))
```

**Wrapped so far:** the play tally (`library.rs`), the scrobble queue's status write
(`lastfm.rs`), the web's name cache (`web.rs`) and the credit collection (`credits.rs`) —
that is every site that silently dropped an error, plus the play write, whose caller logs
and moves on. The other ~100 `execute` sites return their error to a caller that reports it.

### 3.1 The canary

A timer thread writes `db_canary`, reads the value back and compares it, every 10 minutes,
starting at launch. It proves the **whole path**, not one statement: a database that has
gone read-only, full or corrupt fails here even when no feature happens to be writing.

The first run is immediate on purpose. A database that is already unwritable at startup is
exactly the case the user must hear about before an hour of listening goes missing.

### 3.2 Reading it

`db_health` (a Tauri command, no Apple call) runs the canary now and returns everything
counted this session. From the devtools console:

```js
await window.__TAURI__.core.invoke("db_health")
```

## 4. What the user sees

One toast, once a session, when any write fails (`db-unwritable`):

> DeetsMusic can't save right now. Plays, playlists and settings won't be kept until this is
> fixed. Check the disk has free space, then restart the app.

It is an **error** tier with a `dismissKey`, so it is silenceable and it lands in the log
(TOASTS.md §5). Silence was the worst outcome available: the app looks fine and remembers
nothing.

## 5. Why there is no queue

The question that started this was "why not queue a failed write, or keep a scratchpad?".
Three answers, in order of weight.

1. **SQLite already queues the common case.** `busy_timeout(2s)` (`lib.rs`) makes SQLite
   retry internally when the database is locked — which is the overwhelmingly common write
   failure, and the reason WAL went in (LOCAL-DATA.md §3). That retry lives one layer below
   us, where it belongs.
2. **A durable queue needs the disk that just failed.** What is left after `busy_timeout` is
   a full disk, an I/O error, a read-only file or corruption. In every one of those, writing
   the queue fails for the same reason the write failed. An in-memory queue dodges that and
   then dies with the process — which is the case it was meant to survive.
3. **We have never seen it happen.** There was no counter. Building a recovery path for an
   unobserved failure is guessing, and this project fixes causes, not symptoms.

Where a queue **is** right, the app already has one: `play_events.lastfm` is a durable queue
with `queued` / `sent` / `failed` states, a restart-safe backlog and one retry timer
(LASTFM.md). Note which way round it runs — the database is the queue for the *network*, not
the other way about. A network call fails transiently and a disk does not.

**Revisit this when the numbers say so.** If `writesFailed` or `canaryFails` is ever above
zero on a real machine, that is the evidence this decision was missing.

## 6. Desk test

Restart the dev runner (new Rust code).

1. `await window.__TAURI__.core.invoke("db_health")` → `writable: true`, `canaryRuns` at
   least 1, every counter 0.
2. Play a song, skip through a few, make a playlist. Run it again: still all zeros.
3. `cargo test --lib dbhealth` passes (the round trip, and a read-only database reporting
   `write:`).
4. Leave the app open for 10 minutes and run it again: `canaryRuns` has gone up on its own.
5. The log has no `db:` warning lines.

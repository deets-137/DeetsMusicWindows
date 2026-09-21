---
status: shipped
shipped_in: 0.8.0
desk_test: passed 2026-09-19
sources: [src-tauri/src/lib.rs, src-tauri/src/query.rs, src-tauri/src/bridge.rs, cli/src/main.rs]
updated: 2026-09-20
---
# Local data for agents and users — the library tool and read-only SQL

Designed and **built 2026-09-16**, shipped in 0.8.0. Desk test (§11): steps 1–8 passed
(with the history-off 403 fix, 6116286); step 9 (from an agent over MCP) is open. The guards have unit tests:
`cargo test --lib query` in `src-tauri` (9 tests, all pass). Zero Apple calls: everything here
reads the local cache (`deetsmusic.db`) and the play history DeetsMusic already keeps.

**Terms**
- **Export tables:** the five tables a query can see (§4). They are a copy, made fresh for each
  query, in a database that lives in memory.
- **Bridge:** the loopback HTTP server the CLI and MCP tools already use (AGENT.md §3).
- **WAL:** SQLite's write-ahead journal mode. Readers and the writer do not block each other.

## 1. Why

A user's agent asked "what is my shortest song?" had no tool for it. `search` finds by name,
and `list` covered the queue, history, playlists and one album. Claude answered it on
2026-09-16 only by reading the database file with Python, which needs the path, the internal
table shapes and a JSON column, and which breaks on the next schema change.

## 2. Decisions (2026-09-16)

| # | Fork | Decision |
|---|---|---|
| 1 | What SQL can see | **A: a few stable tables only**, never the internal ones. Read-only, guarded in layers (§5). |
| 2 | How agents reach it | **A: both.** `list what=library` for every tool set (the small one too); the `query` tool and `deetsmusic sql` for the full set. |
| 3 | Play history | **B: its own row**, Settings › Connections › **Agents read play history**, default on, agents off only. |
| 4 | The file itself | **A:** document the file and the export tables, switch the db to WAL, say only the tool is supported. |

**Changed while building (2026-09-16): views → an in-memory copy.** The design put TEMP views
over the real file and let the authorizer allow reads "through" a view. A test showed SQLite
reports a `WITH` name as the *accessor* exactly as it reports a view, so
`WITH songs AS (SELECT * FROM main.tracks) SELECT * FROM songs` would have looked like a read
through the allowed view. So each query now gets a fresh in-memory database that holds only the
export tables. The internal tables are not fenced off; they are simply absent. Cost: ~40 ms per
query to build the copy (4,060 songs, 236 plays, measured).

## 3. WAL (a fix in its own right)

- **Found 2026-09-16:** the db ran in SQLite's default `delete` journal mode, and the app
  connection had no busy timeout. Any reader holding the file (a DB browser, a copy for a query)
  made the app's next write fail at once: a play event, a scrobble, a Rewind count.
- **Fix (`lib.rs`):** `PRAGMA journal_mode = WAL` at open (stored in the file) and a 2 s
  `busy_timeout`. `deetsmusic.db-wal` and `-shm` appear beside the file. A mode that does not
  take is logged: `db: journal mode stayed …`.
- **The dev seed** (first `dev:app` run copies the installed app's db) now uses `VACUUM INTO`
  from a read-only connection, so writes still in the installed app's `-wal` are not lost.

## 4. The export tables (the contract)

Built by `query.rs` `BUILD` / `BUILD_HISTORY`. Ids carry the same prefixes the other agent tools
take, so a row plays at once. Times are local ISO text (`2026-09-16T14:37:14`).

| Table | Columns | Needs the history row |
|---|---|---|
| `songs` | `id` (`song:…`), `title`, `artist`, `album`, `length_s`, `genre` (comma list), `release_date`, `in_library` (1 = synced library, 0 = a song only seen), `added_rank` (higher = added later), `added_at` (only for songs added through DeetsMusic) | no |
| `playlists` | `id` (`playlist:local:N` / `playlist:p.…`), `name`, `source` (DeetsMusic / Apple Music), `song_count` (songs DeetsMusic has read) | no |
| `playlist_songs` | `playlist_id`, `position` (1 = first), `song_id` | no |
| `pins` | `id` (the pin key: `playlist:…`, `station:…`, `album:…`, `artist:…`, `song:…`), `kind`, `pinned_at`, `act` (what a click does — `play` | `shuffle` | `open`, or NULL for the card's own rule; PINS.md §8, 2026-09-20) | no |
| `row_order` | `scope` (`settings.sections`, `home.shelves`, `radio.sections`, `playlists.sections`, `playlists.folder:<key>`, `pins`), `id`, `rank` (0 = first) — the order the user set by hand; a scope holds ONLY the ids they moved past, and anything unnamed draws last in its card's built-in order (MOVABLE-ROWS.md, 2026-09-20) | no |
| `plays` | `song_id`, `started_at`, `listened_s` (NULL = not finished yet), `finished`, `skipped`, `context` | **yes** |
| `play_counts` | `song_id`, `starts`, `finishes`, `last_played` | **yes** |

Never exported: `meta`, `dead_ids`, the Apple mirror's raw JSON, artwork, the Last.fm state,
settings, tokens (those are not in the db at all).

With **Agents read play history** off, `plays` and `play_counts` are not built, the history
sorts of `list what=library` answer 403-style text, and `GET /history` (so `list what=history`
and `deetsmusic history`) answers 403. All say where to turn it on.

## 5. Security — the layers

The user writes the SQL, so the risk is not injection into our own query. The risks are what
that SQL could do. Each has a guard, and each guard has a test (`query.rs` `tests`):

| # | Guard | Stops | Test |
|---|---|---|---|
| 1 | **The route:** `POST /query` and `POST /songs`, loopback only, bearer token required. A browser-extension `Origin` is refused (403) even though it counts as paired. Both obey Agent control. The body is capped at 64 KB (the bridge's own cap). | Web pages, other extensions | desk test §11 |
| 2 | **The copy:** a fresh in-memory db per query. The app's file is attached `mode=ro` only while the copy is made, then detached, before any user SQL. The app's own connection and its lock are never used. | Reading internal tables or other files; any write to the file; a slow query stalling playback | `internal_tables_are_out_of_reach`, `the_file_is_never_written` |
| 3 | **Limits:** 0 attached databases, SQL ≤ 8 KB, any value ≤ 1 MB, expression depth 100, 20 compound selects, 16 function arguments, no triggers, no worker threads, an 8 MB page cache (a bigger sort spills to a temp file) | `ATTACH` even past the authorizer; giant strings | `limits_hold` |
| 4 | `PRAGMA query_only = ON` | Writes, even to the copy | `nothing_but_select` |
| 5 | **The authorizer** allows `SELECT`, recursive `WITH`, reads of the listed tables in `main` (plus `sqlite_schema`), reads of `WITH` results (no database; each stored table inside is checked on its own read), and a list of functions (aggregates, windows, text, numbers, dates). It denies everything else: `PRAGMA`, `ATTACH`/`DETACH`, every write, `CREATE`, `DROP`, transactions, `temp`, and any function not listed (`load_extension`, `randomblob`, `readfile` …). | Everything that is not a read | `nothing_but_select`, `functions_are_listed` |
| 6 | **One statement:** a second statement, even a refused one, refuses the whole call; SQLite must also call the statement read-only | `…; DELETE …` | `one_statement` |
| 7 | **Time and size:** a progress handler stops the query after 2 s; ≤ 500 rows (the reply says it was cut); text cells cut at 1,000 characters | A query that never ends; a huge reply | `limits_hold` |
| 8 | **Plain errors** name only the export tables ("Unknown table: tracks. Tables: songs, …") | Leaking internal names | `internal_tables_are_out_of_reach` |
| 9 | **The library tool** builds its SQL from fixed pieces picked from lists; the user's text only arrives as bound parameters, with LIKE's `%` and `_` escaped | Injection through `sort`, `order`, `artist` … | `library_tool_binds_its_text` |
| 10 | **Log:** one line per call — bytes, rows, ms, or why refused. The SQL text is never logged (the bridge logs body size only). | A silent route | — |

## 6. The structured tool — `list what=library`

`POST /songs`, MCP `list what=library` (both tool sets), CLI `deetsmusic library`.

| Argument | Takes |
|---|---|
| `sort` | `title` · `artist` · `album` · `length` · `added` · `plays` · `last_played` · `skips` (the last three need the history row) |
| `order` | `asc` · `desc` (default: A–Z and shortest first; `added`, `plays`, `last_played`, `skips` highest first) |
| `limit` | 1–100, default 20 |
| `artist`, `genre` | text; the name contains it (case-insensitive) |
| `shorter_than`, `longer_than` | seconds or `m:ss` |

Only synced library songs (`in_library = 1`). Reply: a numbered list, `song:…` id first, with
`[N plays, K skips]` when there are any. Example:
`deetsmusic library --sort length --longer-than 0:30 -n 5`.

## 7. The full-set tool — `query`

`POST /query {sql}`, MCP `query {sql}` (full set only), CLI `deetsmusic sql "<select>"`. Reply:
`{columns, rows, truncated, ms}`; the CLI prints a text table (cells cut at 40 characters,
`--json` for the rest). The MCP description lists every table and column, so an agent needs no
other doc. Example: the ten most-played songs —
`SELECT s.title, s.artist, c.starts FROM play_counts c JOIN songs s ON s.id = c.song_id ORDER BY c.starts DESC LIMIT 10`.

## 8. The file (fork 4A)

- Path: `%APPDATA%\com.deetsmusic.app\deetsmusic.db` (`…\com.deetsmusic.dev\…` for `dev:app`).
- Open it **read-only**. With WAL on (§3), a reader no longer blocks the app.
- **Only `deetsmusic sql` and its export tables are supported.** The internal tables change
  between versions without notice. The `BUILD` SQL in `query.rs` shows how each export column
  is read, for anyone who wants the same shapes in their own tool.

## 9. Settings

| Where | Row (hint) | Owner | Default |
|---|---|---|---|
| Settings › Connections | Agents read play history (Lets a connected agent see what you played, when, and what you skipped) | Rust `agent_history`, `settings_set_agent_history` (the bridge reads it per call) | on |

Agent spec `agentHistory`: **off only**, like Agent control (AGENT.md §6).

## 10. What was built

| Part | Where |
|---|---|
| WAL, busy timeout, the seed | `src-tauri/src/lib.rs` |
| The copy, the guards, both tools, the tests | `src-tauri/src/query.rs` (rusqlite features `hooks`, `limits`) |
| The routes, the extension refusal, the `/history` gate | `src-tauri/src/bridge.rs` |
| The setting | `settings.rs`; `settings-card.ts` (Connections); `agent-settings.ts` |
| CLI + MCP | `cli/src/main.rs`: `library`, `sql`, `list what=library`, `query` |

**Restarts:** the Rust side needs a dev-runner restart. The CLI is a separate binary: rebuild it
(`npm run cli:build`, or `cargo build` in `cli/` for the dev bridge) before `deetsmusic sql` or the
new MCP tools exist, and restart the agent app that runs `deetsmusic mcp`.

## 11. Desk test — PASSED 2026-09-19 (steps 1–8 on 2026-09-16; step 9, over MCP, confirmed 2026-09-19)

1. **WAL:** after the restart, `deetsmusic.db-wal` and `-shm` sit beside the db, and the log has no
   `db: journal mode stayed` line.
2. `deetsmusic sql "select title, length_s from songs where in_library and length_s > 30 order by length_s limit 3"`
   → Oooh La La, Welcome, Reminiscing.
3. `deetsmusic sql "select * from tracks"` → "Unknown table: tracks. Tables: …".
4. `deetsmusic sql "delete from songs"` → "Only SELECT is allowed."; `"pragma query_only=0"` → PRAGMA refused.
5. `deetsmusic sql "with recursive r(n) as (select 1 union all select n+1 from r) select count(*) from r"`
   → "Stopped after 2 s", while music keeps playing without a gap.
6. `deetsmusic library --sort plays -n 5` → your most-started songs, with play counts.
7. Settings › Connections › Agents read play history **off** → `deetsmusic sql "select * from plays"`,
   `deetsmusic library --sort plays` and `deetsmusic history` all say play history is off. Turn it on.
8. Open the db in a DB browser (read-only) and play songs for a minute → History and Last.fm still record.
9. From an agent (MCP): "what are my five shortest songs over 30 seconds?" → it uses `list what=library`
   or `query` and can play the answer by id.

## 12. Later — a SQL card (idea, shape TBD)

The user's idea (2026-09-16): a **card** that runs SQL over the same export tables, and that can
be shared — downloaded, picked like an applet, a plugin or an extension. It opens the door to
user customization: a "Songs I skip on Mondays" card, a "Longest albums I never finish" card.

Open questions, not decided:
- **Shape:** a query box with a result table (a power-user card), or a saved query shown as a
  normal collection card (rows play, drag and right-click like any list), or both.
- **The package:** a small file (name, description, the SQL, how to show the rows: list, tiles,
  a single number). Where people find and install one (a folder, a link, a gallery).
- **Parameters:** a card with pickers (an artist, a date range) that bind into its SQL as
  parameters, never as text.
- **Trust:** a card from someone else runs inside the same sandbox (§5) — read-only, the export
  tables only, 2 s, no network. It still sees the user's play history, so installing one should
  say so, and the history row (§9) should apply to cards too. No card code (JS/HTML) at first:
  SQL plus a display kind only, so a shared card cannot run script in the app.
- **Cost:** zero Apple calls while cards only read the export tables. A card that wants catalog
  data (artwork, related artists) is a separate question.

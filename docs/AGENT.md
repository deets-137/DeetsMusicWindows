# Agent / CLI control — `deetsmusic`

> Design agreed 2026-09-09 (DESIGN.md X4). Status: **built, awaiting first user test.**
> User-facing setup: [AGENT-SETUP.md](AGENT-SETUP.md). **Settings › Connections › Agent control**
> (default on, `agentControl` in `settings.json`) gates the six agent routes with a `403` and a
> plain sentence; the extension's routes are never gated. The card's **Copy setup for** row
> copies a ready config per client (`agent_setup_text`), with the installed exe path.
> Code: `src-tauri/src/bridge.rs` (routes + the `ask()` request/reply), `src/np-bus.ts`
> (`runAgent`, the main-window half), `cli/` (the `deetsmusic` binary: CLI + MCP server).

## 1. What it is

A way for anything local — a shell, a script, Claude Code, a small local model — to
drive DeetsMusic: play, control the transport, search, browse radio, queue, and read
the queue and history. It rides the **same loopback bridge the browser extension uses**
(EXTENSION.md §3): `127.0.0.1:47825–47828`, JSON, and the `bridgeToken` from
`<app_data>/settings.json` as `Authorization: Bearer …`. No new server, port, or trust
surface. Plain `deets` is reserved for other things; this is `deetsmusic`.

**Designed for small tool-calling models** (LFM2.5-class): seven tools, flat string /
enum arguments, **prefixed ids everywhere**, and a two-step flow — search (or list
stations) first, then play or queue by the returned id. Free-text `play "<term>"` exists
only as a human shortcut on the CLI; the MCP `play` tool rejects anything that isn't an id.

**It is a long-lived process.** `deetsmusic mcp` runs for the whole agent session, which
means the installed `cli\deetsmusic.exe` is an **open file** — Windows then refuses to replace
or delete it, so it blocks both an install and an uninstall of the app. The NSIS
`PREINSTALL` / `PREUNINSTALL` hooks stop it by path ([RELEASE.md](RELEASE.md) §3). Note also
that an MCP client config (e.g. `.claude.json`) holds the **absolute path** to that exe, so an
uninstall breaks the tools until a reinstall puts it back in the same place.

## 2. Architecture

```
deetsmusic (CLI / MCP) ──HTTP──▶ bridge.rs ──emit "agent-request" {id, kind, payload}──▶ main window (np-bus.ts)
                       ◀─JSON──  bridge.rs ◀──invoke agent_reply(id, ok, result|error)──  player / queue / MusicKit
```

The main window owns MusicKit and the queue model, so every route that touches playback
is a request/reply round-trip to the window: `ask()` parks a oneshot keyed by id, emits
the event, and awaits the answer; a watchdog fails it after 15 s (`504`). Search,
stations, playlists and now-playing never leave Rust. Search **materializes** its song
hits (a local upsert), so a `play song:<id>` right after resolves with no Apple call;
an unseen song id costs one album fetch.

### Ids

| Prefix | Example | Resolves via |
|---|---|---|
| `song:` | `song:1440857781` | local store → else `catalog_related` + the album's tracks |
| `album:` | `album:1440857779` | `catalog_collection_tracks("albums")` — plays in order |
| `playlist:` | `playlist:pl.u-…` / `playlist:p.…` / `playlist:local:3` | catalog · Apple mirror (`apple_playlist_tracks`) · local store |
| `station:` | `station:ra.978194965` | the bridge's session cache of every station it has listed (`/stations` must run first — the CLI/MCP search does this for you) |

## 3. Routes (`bridge.rs`)

All need the token (or an extension `Origin`). Errors: `400` bad body / bad id / no hit ·
`401` unpaired · `409` not connected to Apple Music · `502` Apple / player failure ·
`504` the window didn't answer.

| Route | Body → Reply |
|---|---|
| `GET /now-playing` | `{active, playing, title, artist, album, artworkUrl, catalogId, inLibrary, live, progress, currentTime, duration, volume, muted}` |
| `POST /command` | `{kind, value?}` — `play-pause` · `play` · `pause` · `next` · `previous` · `seek` (0..1) · `volume` (0..1) · `mute` · `shuffle` · `clear` (drops Up Next) → the snapshot after |
| `POST /play` | `{id}` \| `{term}` \| `{track}` \| `{tracks:[…]}` → `{ok, tracks}` or `{ok, station}` |
| `POST /queue` | same + `{mode: "next" \| "later"}` → `{ok, tracks}` (a station → `400`) |
| `GET /queue` | `{current, upcoming:[Track…], history:[Track…]}` |
| `GET /history?limit=50` | `{plays:[Track…]}` — the **session** play log, newest first |
| `GET /stations?group=` | `featured` (My Station · Discovery · live) · `genres` · `genre:<id>` → `{stations, genres}` |
| `GET /playlists` | `{playlists:[Playlist…]}` — Apple mirror + local, zero Apple calls |
| `POST /search` | `{term, types:["songs","albums","artists","playlists"]}` → `SearchResults`. Without `types` it's the extension's popup shape |

**Notices (2026-09-13).** A successful `/command`, `/play` or `/queue` reply can carry
`notices: [{kind, text}]`. These are the app's `warn` and `error` toasts
([TOASTS.md](TOASTS.md)) raised while the request ran — for example, "Skipped “Title” —
Apple Music no longer offers it." They are included whatever the user's *Show notices*
tier is, so the agent learns that the command went wrong and can correct it. The window
still shows them under the tier. A request that starts playback (`play`, `queue`, a
station, `next`, `previous`, `play`, `play-pause`) waits 1.5 s after it finishes to
catch late toasts. The key is absent when nothing was raised. A failed request keeps the
`{error}` reply, and the notice texts are appended to it after " — ", because MusicKit's
raw error ("One or more items could not be resolved: 0") does not say what went wrong
(for example: `… — Skipped “Title” — Apple Music no longer offers it.`). The CLI and the
MCP print each success notice under the result line as `! warn: <text>`.

```bash
T=$(jq -r .bridgeToken "$APPDATA/com.deetsmusic.app/settings.json")
curl -s -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"id":"album:1440857779"}' http://127.0.0.1:47825/play
```

## 4. The `deetsmusic` binary (`cli/`)

A standalone crate (not in the Tauri workspace, so it never contends with `tauri dev`
for a target dir): clap + ureq + serde_json, no async. Discovery: `--port` / `--token`
(or `DEETSMUSIC_PORT` / `DEETSMUSIC_TOKEN`), else it reads every `settings.json` under
`%APPDATA%\com.deetsmusic.{app,dev}` and probes the port list with each token — so it
finds the installed app **or** the dev build, whichever is up.

```
deetsmusic np | status
deetsmusic search "<query>" [--albums|--artists|--playlists|--stations] [-n 5]
deetsmusic stations [--genres | --genre <id>]
deetsmusic playlists
deetsmusic play <id>            # song:… album:… playlist:… station:…  (or free text = song search, top hit)
deetsmusic queue                # now + up next
deetsmusic queue <id> [--later] # play next (default) / add to end
deetsmusic queue clear
deetsmusic pause | resume | toggle | next | prev | shuffle | mute
deetsmusic seek 1:23 | 83 | 45%
deetsmusic vol 40 | +5 | -5
deetsmusic history [-n 20]
deetsmusic add                  # current song → library
deetsmusic mcp                  # serve the tools over stdio
--json on anything
```

Exit codes: `2` not connected to Apple Music · `3` bad id / no match · `4` the app didn't
answer · `5` no bridge running · `1` other.

Output is one line per item, **id first** (`song:123  Title — Artist  ·  Album`), numbered
— what a model reads back most reliably.

### MCP (`deetsmusic mcp`)

Hand-rolled JSON-RPC over stdio (initialize · tools/list · tools/call · ping) — the
subset a tool server needs, no SDK. Tools:

| Tool | Args | Notes |
|---|---|---|
| `now_playing` | — | one line |
| `search` | `query`, `kind: song\|album\|artist\|playlist\|station` | 5 hits, id first. `playlist` checks your own playlists before the catalog; `station` name-matches featured stations and genre names |
| `stations` | `group: featured\|genres\|genre:<id>` | |
| `play` | `id` | rejects non-ids with "search first" |
| `queue` | `id`, `position: next\|later` | |
| `control` | `action: play\|pause\|next\|previous\|shuffle\|mute\|seek\|volume\|clear_queue`, `value?` (percent) | |
| `list` | `what: queue\|history\|playlists` | |

Register in Claude Code: `claude mcp add deetsmusic -- <path>\deetsmusic.exe mcp`.

### Build + ship

- `npm run cli:build` → `cargo build --release` in `cli/` + stages `cli/dist/deetsmusic.exe`.
- `npm run release` runs that first; `tauri.conf.json` ships it as a resource at
  `<install>\cli\deetsmusic.exe` (a subfolder, because `deetsmusic.exe` next to
  `DeetsMusic.exe` would collide on Windows). **Not yet:** the installer adding that
  folder to PATH — add `%LOCALAPPDATA%\DeetsMusic\cli` yourself for now.
- Dev: `cargo run --manifest-path cli/Cargo.toml -- np`, or put `cli/dist` on PATH.
- **A debug build reads only the dev token** (`com.deetsmusic.dev`, 2026-09-13), so it
  reaches `npm run dev:app` and never the installed app, even when both are open. Only the
  release build (`npm run cli:build`) reads both tokens.

## 5. Later
- Installer PATH entry (NSIS hook).
- Durable history (`play_events` + the track store) as a second history source.
- `artist:` ids for `play` (artist top songs) — search returns them, play doesn't take them yet.

### The comprehensive CLI pass (parked 2026-09-14)

Checked 2026-09-14: the CLI/MCP only plays, queues, controls, and reads. None of the 0.4.x
playlist, library, or drag-and-drop work reaches it. Do these together in one design-first pass:

- **Local playlists** (no Apple calls): create, add songs (end or position —
  `playlist_insert_tracks`), remove a song, reorder, rename, delete, set/remove the cover,
  folders.
- **Apple playlist writes** (Apple has no undo): add to your own Apple playlist
  (`apple_playlist_add`), Export / Send New Songs, Import to Edit, Get New Songs.
- **Library writes** (Apple has no undo): Add to Library (song, album), ♥ Favorite.
- **Queue:** insert at a position (`queue.insertManyAt` / `insertInQueue`), remove, move,
  jump to an Up Next entry; play-and-keep-Up-Next (`playTracksKeepQueue`).
- **Open design questions:**
  - A consent gate for the Apple-account writes, beyond the existing Agent control setting
    (per action? the app's own one-time questions?).
  - UI refresh after an agent edit: the playlist change bus (`onPlaylistsChange`) is
    front-end only, so the bridge must emit an event the front end listens to.
  - Toasts for agent-made changes (show them, or stay quiet?).

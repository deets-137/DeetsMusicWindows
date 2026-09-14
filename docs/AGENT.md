# Agent / CLI control — `deetsmusic`

> Design agreed 2026-09-09 (DESIGN.md X4). Playback control built and tested. **The write pass
> (§5: library, playlists, folders, queue edits, updates) built 2026-09-14, awaiting desk test.**
> User-facing setup: [AGENT-SETUP.md](AGENT-SETUP.md). **Settings › Connections › Agent control**
> (default on, `agentControl` in `settings.json`) gates every agent route with a `403` and a
> plain sentence; the extension's routes are never gated. The card's **Copy setup for** row
> copies a ready config per client (`agent_setup_text`), with the installed exe path.
> Code: `src-tauri/src/bridge.rs` (routes + the `ask()` request/reply), `src/np-bus.ts`
> (`runAgent`, the main-window half), `src/agent-writes.ts` (the writes), `cli/` (the
> `deetsmusic` binary: CLI + MCP server).

## 1. What it is

A way for anything local — a shell, a script, Claude Code, a small local model — to
drive DeetsMusic: play, control the transport, search, browse radio, queue, and read
the queue and history. It rides the **same loopback bridge the browser extension uses**
(EXTENSION.md §3): `127.0.0.1:47825–47828`, JSON, and the `bridgeToken` from
`<app_data>/settings.json` as `Authorization: Bearer …`. No new server, port, or trust
surface. Plain `deets` is reserved for other things; this is `deetsmusic`.

**Two MCP profiles (2026-09-14).** `deetsmusic mcp` serves all 15 tools, for Claude-class
clients. `deetsmusic mcp --small` serves 10, for small tool-calling models (LFM2.5, Gemma
4B-class): flat string / enum arguments, and no argument whose meaning depends on the action.
Both use **prefixed ids everywhere** and a two-step flow — search (or list stations) first,
then act on the returned id. Free-text `play "<term>"` exists only as a human shortcut on
the CLI; the MCP `play` tool rejects anything that isn't an id. The CLI is for power users;
the MCP is the surface a person actually uses, so every write lives there too.

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
`401` unpaired · `403` a setting blocks it (Agent control, Add to Library, Export playlists) ·
`409` not connected to Apple Music · `502` Apple / player failure · `504` the window didn't
answer (15 s; 90 s for `export`, `new_copy`, `get_songs`, `import`). `POST /add` is the
extension's only: a token caller gets `403` and uses `/library`, which obeys the consent rules.

| Route | Body → Reply |
|---|---|
| `GET /now-playing` | `{active, playing, title, artist, album, artworkUrl, catalogId, inLibrary, live, progress, currentTime, duration, volume, muted}` |
| `POST /command` | `{kind, value?}` — `play-pause` · `play` · `pause` · `next` · `previous` · `seek` (0..1) · `volume` (0..1) · `mute` · `shuffle` · `clear` (drops Up Next) → the snapshot after |
| `POST /play` | `{id}` \| `{term}` \| `{track}` \| `{tracks:[…]}`, `keepQueue?` → `{ok, tracks}` or `{ok, station}` |
| `POST /queue` | same + `{mode: "next" \| "later"}` or `{at: N}` (row of Up Next, 1 = top) → `{ok, tracks}` (a station → `400`) |
| `GET /queue` | `{current, upcoming:[Track…], history:[Track…]}` |
| `POST /queue/edit` | `{action: remove \| move \| jump, index, to?}` (1-based rows) → the fresh `GET /queue` shape |
| `POST /library` | `{action: add \| favorite \| unfavorite, id}` (`song:` · `album:` · `current`) → `{ok, message}` or `{ok, pending: "user", message}` |
| `POST /playlist` | `{action, playlist?, id?, index?, to?, value?}` — `show` → `{tracks}`; `create` · `add` · `remove` · `move` · `rename` · `delete` · `cover` · `export` · `new_copy` · `get_songs` · `import` · `folder` → `{ok, message}` / `pending` (§5) |
| `POST /folder` | `{action: list \| create \| rename \| delete, name, value?}` → `{folders:[{name, playlists}]}` or `{ok, message}` |
| `GET /update` · `POST /update` | status `{state, current, channel, version, …, mode, skip}` · `{action: check \| install \| rollback \| mode \| skip, value?}` |
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
deetsmusic play <id> [--keep]           # song:… album:… playlist:… station:… (free text = top song hit); --keep keeps Up Next
deetsmusic queue                        # now + numbered up next
deetsmusic queue <id> [--later | --at N]
deetsmusic queue clear | remove N | move N TO | jump N
deetsmusic pause | resume | toggle | next | prev | shuffle | mute
deetsmusic seek 1:23 | 83 | 45%
deetsmusic vol 40 | +5 | -5
deetsmusic history [-n 20]
deetsmusic add [id] | love [id] | unlove [id]      # default: the playing song
deetsmusic playlist show|create|add|remove|move|rename|delete|cover|export|new-copy|get-songs|import|file …
deetsmusic folder list | create <name> | rename <name> <new> | delete <name>
deetsmusic update [status|check|install|versions|rollback <v>|mode auto|ask|off|skip <v>|none]
deetsmusic mcp [--small]                # serve the tools over stdio
--json on anything
```

Exit codes: `2` not connected to Apple Music · `3` bad id / no match · `4` the app didn't
answer · `5` no bridge running · `6` a setting blocks it · `1` other. A `pending` reply
(the user must answer in the app) exits `0` and prints `Waiting for the user: …`.

Output is one line per item, **id first** (`song:123  Title — Artist  ·  Album`), numbered
— what a model reads back most reliably.

### MCP (`deetsmusic mcp`)

Hand-rolled JSON-RPC over stdio (initialize · tools/list · tools/call · ping) — the
subset a tool server needs, no SDK. Tools:

| Tool | Args | Profile | Notes |
|---|---|---|---|
| `now_playing` | — | both | one line |
| `search` | `query`, `kind: song\|album\|artist\|playlist\|station` | both | 5 hits, id first. `playlist` checks your own playlists before the catalog; `station` name-matches featured stations and genre names |
| `stations` | `group: featured\|genres\|genre:<id>` | both | |
| `play` | `id` (+ `keep_queue` full) | both | rejects non-ids with "search first" |
| `queue` | `id`, `position: next\|later` (full: also a row number) | both | |
| `control` | `action: play\|pause\|next\|previous\|shuffle\|mute\|seek\|volume\|clear_queue`, `value?` (percent) | both | |
| `list` | `what: queue\|history\|playlists` | both | playlists are tagged `[DeetsMusic]` / `[Apple Music, yours]` / `[Apple Music, read-only]` |
| `library` | `action: add\|favorite\|unfavorite`, `id` (`current` allowed) | both | consent rules, §5 |
| `playlist_add` | `playlist`, `id` (`current` allowed) | both | local or your own Apple playlist |
| `update` | `action: status\|check\|install\|rollback` (full: `mode`, `skip`), `value?` | both | install/rollback end in the app's Restart question |
| `playlist_show` | `playlist` | full | numbered rows |
| `playlist_create` | `name` | full | returns `playlist:local:N` |
| `playlist_edit` | `action`, `playlist`, `index?`, `to?`, `value?` | full | rename · remove · move · delete · cover · export · new_copy · get_songs · import · folder |
| `queue_edit` | `action: remove\|move\|jump`, `index`, `to?` | full | replies with the fresh queue |
| `folder` | `action: list\|create\|rename\|delete`, `name`, `new_name?` | full | by name |

Register in Claude Code: `claude mcp add deetsmusic -- <path>\deetsmusic.exe mcp`. The
**Copy setup for** menu: Claude Desktop, Claude Code, Cursor, **Other (Full)** → `mcp`;
**Other (Sm)** → `mcp --small`.

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

## 5. Writes — library, playlists, folders, queue edits, updates (built 2026-09-14)

Decided with the user 2026-09-14. The window runs every write (`src/agent-writes.ts`)
through the same functions the menus call, so the cards refresh through their own change
buses (`onPlaylistsChange`, the track store, the queue) and the toasts match the app's.
The bridge resolves ids, songs, and cover images first (`tracks_payload`, `cover_image`).

**Consent — the app's own records, no new switch.**

| Write | Setting (off → `403`) | "Done before" flag |
|---|---|---|
| Add to Library, ♥ / un-♥ | `deets.libraryAdd` (Settings › Apple Music) | `deets.notice.addOneWay` |
| Add to your own Apple playlist | `playlistExport` | `deets.notice.appleAdd` |
| Export, Make a New Copy | `playlistExport` | `deets.notice.exportOneWay` |
| Get New Songs | `playlistExport` | — (a read; the write is local) |

- Flag already set → the write runs.
- Never done → a sticky question in the window (**Allow** / **Not now**). The reply comes
  **at once**: `{ok, pending: "user", message}`, and the message tells the agent to point the
  user to that question. **Allow** sets the flag and runs the write. The agent retries after.
- A setting that is off → `403` with the Settings path. No toast: the user chose off.

**Playlist delete always asks** (a red sticky question, the card's wording plus "An agent
wants to…"); the reply is `pending`. Folder delete does not ask: its playlists stay.

**Toasts (3A).** Every playlist, folder, library, and update-policy write shows a quiet info
toast ("An agent added 3 songs to “Road Trip”."). Info toasts show only under Show notices ›
Everything. Queue edits, play, and queue show none: the Queue and Now Playing cards show them.
Export and Get New Songs keep their own result toasts, and those texts are the reply message.

**Rules kept from the update design.**
- `install` and `rollback` never restart the app. They download, then the app's own Restart
  question appears; the reply is `pending` and says the restart stops these tools until the
  agent app restarts them (the installer stops `cli\deetsmusic.exe`, RELEASE.md §3).
- `check` is `checkForUpdate(manual)` — the same as Settings › Updates › Check now.
- `rollback` with no value lists the versions (`olderVersions`, one request per session).

**What an agent can't do.** Rename, reorder, remove from, or delete an Apple Music playlist
(Apple's API has no path; `import` first). Edit a Replay by hand (§10.8). Add to a linked Apple
copy (the reply names its local playlist). Reach `/add` (extension only).

**Rows.** Every row is the 1-based number the listing printed. `queue_edit` replies with the
fresh queue, so a second edit uses current numbers.

## 6. Later
- Installer PATH entry (NSIS hook).
- A small-model test of `mcp --small` (LM Studio / Ollama) with the AGENT-SETUP §3 phrases.
- Durable history (`play_events` + the track store) as a second history source.
- `artist:` ids for `play` (artist top songs) — search returns them, play doesn't take them yet.


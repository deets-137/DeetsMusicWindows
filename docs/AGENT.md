# Agent / CLI control — `deetsmusic`

> Design agreed 2026-09-09 (DESIGN.md X4). Playback control built and tested. **The write pass
> (§5: library, playlists, folders, queue edits, updates) built 2026-09-14, desk-tested and shipped.**
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

**Two MCP profiles (2026-09-14).** `deetsmusic mcp` serves all 16 tools, for Claude-class
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
| `GET /now-playing` | `{active, playing, title, artist, album, artworkUrl, catalogId, inLibrary, live, progress, currentTime, duration, volume, muted, repeat, shuffle}` (`repeat` = off / all / one; `shuffle` = the mode is on) |
| `POST /command` | `{kind, value?}` — `play-pause` · `play` · `pause` · `next` · `previous` · `seek` (0..1) · `volume` (0..1) · `mute` · `shuffle` (the button: the mode, or once) · `shuffle-on` / `shuffle-off` · `repeat` (cycle) · `repeat-off` / `repeat-all` / `repeat-one` · `clear` (drops Up Next) → the snapshot after |
| `POST /play` | `{id}` \| `{term}` \| `{track}` \| `{tracks:[…]}`, `keepQueue?` → `{ok, tracks}` or `{ok, station}` |
| `POST /queue` | same + `{mode: "next" \| "later"}` or `{at: N}` (row of Up Next, 1 = top) → `{ok, tracks}` (a station → `400`) |
| `POST /tracks` | same body as `/play` → `{tracks:[Track…]}`. A **read**: it resolves the id and hands back the songs without touching playback. Use it to see inside an album or playlist (a station → `400`, it has no fixed list). Added 2026-09-16, so reading a tracklist no longer means writing one to a playlist first. |
| `GET /queue` | `{current, upcoming:[Track…], history:[Track…]}` |
| `POST /queue/edit` | `{action: remove \| move \| jump, index, to?}` (1-based rows) → the fresh `GET /queue` shape |
| `POST /library` | `{action: add \| favorite \| unfavorite, id}` (`song:` · `album:` · `current`) → `{ok, message}` or `{ok, pending: "user", message}` |
| `POST /playlist` | `{action, playlist?, id?, index?, to?, value?}` — `show` → `{tracks}`; `create` · `add` · `remove` · `move` · `rename` · `delete` · `cover` · `export` · `new_copy` · `get_songs` · `import` · `folder` → `{ok, message}` / `pending` (§5) |
| `POST /folder` | `{action: list \| create \| rename \| delete, name, value?}` → `{folders:[{name, playlists}]}` or `{ok, message}` |
| `GET /update` · `POST /update` | status `{state, current, channel, version, …, mode, skip}` · `{action: check \| install \| rollback \| mode \| skip, value?}` |
| `GET /go` · `POST /go` | `{ok, places:[…]}` · `{target}` → `{ok, went, also, message}` — go to a place ([COMPASS.md](COMPASS.md) §10): a card, the Sound panel, the Sleep timer, resolved by the Compass's own registry. Navigation only: a theme, a skin or a surface is a stored setting and is refused with a pointer at `settings set`, which has the consent row and the cover. CLI: `deetsmusic go` (the list) · `deetsmusic go rewind` · `deetsmusic go sleep timer`. Not an MCP tool |
| `GET /grow` · `POST /grow` | `{ok, message, state}` · `{action: grow \| collapse \| pin \| unpin \| state, card?, dir?}` — the card grow ([CARD-GROW.md](CARD-GROW.md)): `card` is a card name (Library) or a slot (left, right, c, d); `dir` is right · left · up · down · full, or absent for the header button's next step. A grow answers after its motion. A test handle more than an agent verb (2026-09-16); not an MCP tool. CLI: `deetsmusic grow Library right` · `grow collapse` · `grow pin` · `grow state` |
| `GET /settings[?section=]` · `POST /settings` | `{settings:[Row…]}` · `{action: list \| get \| set, key, value?}` → `{row}` / `{ok, message}` / `pending` (§6) |
| `GET /history?limit=50` | `{plays:[Track…]}` — the **session** play log, newest first. 403 while Settings › Connections › Agents read play history is off |
| `POST /songs` | `{sort?, order?, limit?, artist?, genre?, shorterThan?, longerThan?}` → `{songs:[{id, title, artist, album, length_s, starts?, finishes?, last_played?, skips?}]}` — the library, sorted and filtered, zero Apple calls ([LOCAL-DATA.md](LOCAL-DATA.md) §6). Token callers only |
| `POST /query` | `{sql}` → `{columns, rows, truncated, ms}` — one read-only SELECT over the export tables in a sandbox ([LOCAL-DATA.md](LOCAL-DATA.md) §5, §7). Token callers only |
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
deetsmusic pause | resume | toggle | next | prev | mute
deetsmusic shuffle [on | off]           # the button, or set the mode
deetsmusic repeat [off | all | one]     # cycle, or set
deetsmusic seek 1:23 | 83 | 45%
deetsmusic vol 40 | +5 | -5
deetsmusic history [-n 20]
deetsmusic library [--sort title|artist|album|length|added|plays|last_played|skips] [--order asc|desc] [-n 20] [--artist X] [--genre X] [--shorter-than 3:00] [--longer-than 0:30]
deetsmusic sql "select title, length_s from songs order by length_s limit 5"   # read-only, LOCAL-DATA.md §7
deetsmusic add [id] | love [id] | unlove [id]      # default: the playing song
deetsmusic playlist show|create|add|remove|move|rename|delete|cover|export|new-copy|get-songs|import|file …
deetsmusic folder list | create <name> | rename <name> <new> | delete <name>
deetsmusic update [status|check|install|versions|rollback <v>|mode auto|ask|off|skip <v>|none]
deetsmusic settings [list [section]] | get <key> | set <key> <value>   # §6
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
| `control` | `action: play\|pause\|next\|previous\|shuffle\|repeat\|mute\|seek\|volume\|clear_queue`, `value?` (percent), `mode?` (repeat: off / all / one, else cycle; shuffle: on / off, else the button) | both | |
| `list` | `what: queue\|history\|playlists\|album\|library`, `id?`; library: `sort?`, `order?`, `limit?`, `artist?`, `genre?`, `shorter_than?`, `longer_than?` | both | `what=library` = `POST /songs` (LOCAL-DATA.md §6); CLI: `deetsmusic library --sort length -n 5`. playlists are tagged `[DeetsMusic]` / `[Apple Music, yours]` / `[Apple Music, read-only]`. `what=album` + an `album:` / `playlist:` id prints the numbered tracklist (`POST /tracks`); CLI: `deetsmusic tracks <id>` |
| `library` | `action: add\|favorite\|unfavorite`, `id` (`current` allowed) | both | consent rules, §5 |
| `playlist_add` | `playlist`, `id` (`current` allowed) | both | local or your own Apple playlist |
| `update` | `action: status\|check\|install\|rollback` (full: `mode`, `skip`), `value?` | both | install/rollback end in the app's Restart question |
| `playlist_show` | `playlist` | full | numbered rows |
| `playlist_create` | `name` | full | returns `playlist:local:N` |
| `playlist_edit` | `action`, `playlist`, `index?`, `to?`, `value?` | full | rename · remove · move · delete · cover · export · new_copy · get_songs · import · folder |
| `queue_edit` | `action: remove\|move\|jump`, `index`, `to?` | full | replies with the fresh queue |
| `folder` | `action: list\|create\|rename\|delete`, `name`, `new_name?` | full | by name |
| `settings` | `action: list\|get\|set`, `key?`, `value?`, `section?` | full | §6: key or label; off-only gates; may be `pending` |
| `query` | `sql` | full | one read-only SELECT over songs · playlists · playlist_songs · plays · play_counts; the description lists every column; 2 s, 500 rows ([LOCAL-DATA.md](LOCAL-DATA.md) §5, §7) |

Register in Claude Code: `claude mcp add deetsmusic -- <path>\deetsmusic.exe mcp`. The
**Copy setup for** menu: Claude Desktop, Claude Code, Cursor, **Other (Full)** → `mcp`;
**Other (Small)** → `mcp --small`.

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

## 6. Settings — BUILT 2026-09-15, shipped

An agent reads and changes the app's settings with the same setters the Settings card uses.
**Full pack only** (`deetsmusic mcp`): a frontier model maps "keep DeetsMusic on top" to a
key by itself; `--small` does not get the tool. Code: `src/agent-settings.ts`.

### Surfaces

| Surface | Shape |
|---|---|
| MCP tool `settings` | `action: list \| get \| set`, `key?`, `value?`, `section?` |
| CLI | `deetsmusic settings [list [section]]` · `settings get <key>` · `settings set <key> <value…>` (the value's words are joined, so `set theme Black & Red` needs quotes only for the shell's `&`) |
| Routes | `GET /settings[?section=]` → `{settings:[Row…]}` · `POST /settings` `{action: list \| get \| set, key, value?}` → `{row}` (get) · `{ok, message}` or `{ok, pending: "user", message}` (set) |

`/settings` is in `AGENT_ROUTES` (Agent control gates it). The bridge asks the window
(`settings-get`, `settings`), like `/update`; `agent-writes.ts` `runAgentWrite` hands both kinds
to `agent-settings.ts`.

Tool description (the model reads this): *"Read or change DeetsMusic settings. list (optionally
one section) shows every key with its label, current value and what it takes. get reads one key.
set takes a key (or the label) and a value: a choice's label or value, on/off, a number, or
HH:MM. theme, skin and surface are keys too. Add to Library and ♥, Export playlists and Agent
control can be turned off, but only the user can turn them on. Depending on the user's setting,
DeetsMusic may ask them first; then tell them to answer in DeetsMusic and don't send it again."*

### The permission — Settings › Connections › Agent changes settings

`agentSettings`: **Ask** (default) · Allow · Off. The user's call 2026-09-15: a runtime
permission on top of the off-only gates.

- **Ask:** a sticky question in the window, "An agent wants to set Keep on top to Always."
  (**Allow** / **Not now**). The reply is `pending` at once and tells the agent not to resend:
  **Allow** applies the change itself.
- **Allow:** the set applies at once, with a quiet info toast (§5, 3A): "An agent set Keep on
  top to Always."
- **Off:** `403` "Agent changes settings is off in DeetsMusic › Settings › Connections."
- Reads (`list`, `get`) always work. A set to the current value answers "… is already …" and
  asks nothing.
- Agents can never change `agentSettings` (read-only, `403`).

### A row

One line per setting, **key first**, the Settings card's own words after it (`setting_line`, cli):

```
alwaysOnTop           Keep on top: Off  (Always | Player | Off)  · Window
backgroundMotion      Animate backgrounds: On  (On | Reduced | Off)  · Motion
glassTint             Tint cards: 65%  (0–100)  [Glass only, with Fancy Glass on]  · Skin settings
dayStart              Day starts at: 07:00  (HH:MM on :00 or :30, 04:00–12:00)  · Look schedule
libraryAdd            Add to Library and ♥: On  (On | Off)  [off only]  · Apple Music
agentSettings         Agent changes settings: Ask  (Allow | Ask | Off)  [read-only]  · Connections
```

JSON `Row`: `{key, label, section, value, valueLabel, accepts, only?, limit?: "off only" | "read-only"}`.

### Values

- A **key or its label**, any case: `alwaysOnTop`, `Keep on top`. An unknown key → `400` with
  "did you mean" keys.
- A choice takes its pill label or its store value, any case: `Always`, `always`. `sunShift`
  takes `+15 min`, `15`, `-15` (−60…60 in 15-minute steps, the card's menu).
- A toggle takes `on` / `off` (also `true` / `false`, `yes` / `no`).
- The **Sleep** section (2026-09-15, NEXT-VERSION §17): `sleepSchedule` (Off | Sunset | At a
  time), `sleepAt` (HH:MM in 15-minute steps, any hour), `sleepWind` (Off | 1 | 2 | 5 | 10 | 15 |
  30 min) and `sleepPlayOut`. These are the schedule and the wind-down; a running timer is set
  in the app's own panel and has no agent verb yet. Since 2026-09-18 all four are rows of
  **Settings › Sleep** as well as of the sleep panel, so the agent and the card name the same
  four things.
- **Playlists › Web reach / Web size / Web prefers songs** (2026-09-16, PLAYLIST-WEB.md): `webReach`
  (1 | 2 | 3), `webSize` (25 | 50 | 100), `webPrefer` (Familiar | Discover | Mix) and `webSeedFilter`
  ("Web genre chips filter": All songs | Keep 5 | Web only) and `webMakeMotion` ("Web panel closes":
  Shrink to chip | Pop out). Building a web has no agent verb yet; the panel under the Playlists
  web button uses these two values.
- **Playlists › Temp web playlist days** (2026-09-17, PLAYLIST-WEB.md §10): `webTempDays`
  (1 | 3 | 5 | 7 | 30). No Settings row: it is the web panel's Temp | N days button under Make
  playlist, and sets the next web playlist only. Every new web starts on Temp.
- The Press record rows (2026-09-15): `pressVinyl` (Spin | Still | Off), `pressVinylWhere`
  (Stage | Stage + card | Everywhere), `pressVinylPlate` (on | off),
  `pressVinylSpeed` (33⅓ | 45 | 78, the record speed in turns each minute) — each `[Press only]`; a set
  under another skin is stored, and the reply says it shows while Press is the skin.
- A slider takes a whole number 0–100 (`oceanSand`, `glassBacklight`, `glassTint`,
  `glassCanvasGlow`, `glassCanvasDim`), with or without `%`. The four Glass sliders are
  `[Glass only, with Fancy Glass on]`: while `glassFancy` is off they store a value but the look
  holds the locked values (65 / 85 / 40 / 10).
- `glassFancy` (on | off, 2026-09-16) `[Glass only]`: the live frost and the moving background.
- The **Sound** section (2026-09-16, SOUND.md): `soundEq` and `soundAdaptive` are **off only** —
  every effect ships off (Apple DPLA §3.3.6.D) and turning one on is the user's own choice in the
  Sound panel; `set … on` → `403`. Since 2026-09-18 nine of this section's rows are rows of
  **Settings › Sound** as well as of the panel; the master switches, the curve and the presets
  are in the panel alone. The rest set freely: `soundEqPreset` (a preset id or its name:
  Flat, Bass lift, Vocal, Treble lift, Warm, Late night, Custom, or a saved one), `soundEqMode`
  (Sliders | Dots), `soundEqPreamp` "Avoid distortion" (Limiter only | When needed | Always | By hand), `soundEqPerOutput`
  "Remember each output", `soundLoudness`, `soundLoudTarget` "Match songs to" (Standard −16 | Louder −14 |
  Quieter −18 LUFS), `soundLoudAlbum` "Keep albums together", `soundLoudUnmeasured` "Songs not measured
  yet" (Usual amount | No change), `soundLowVol` (Off | Gentle | Full), `soundLowVolKey` "Follow the
  volume of" (App + Windows | App only),
  `soundCrossfeed` (Auto | Always | Off), `soundCrossfeedLevel` (Light | Medium | Strong),
  `soundReviewDays` (7 | 14 | 3 days | Never). The bands themselves are not an agent value.
- `streamQuality` (Auto | High | Low, 2026-09-16): the stream bitrate. A set takes effect from the
  next song; the song that plays does not reload.
- A time takes `HH:MM` on the hour or the half hour, inside the card's menu range
  (`dayStart` 04:00–12:00, `nightStart` 15:00–23:30).
- An **open size** takes `W×H` in px (`600x640`, `600 x 640`, `600×640`), at least the view's
  minimum: `sizeMini` / `sizeMidi` / `sizeMax` 340×560, `sizePlayer` 420×460. A set for the view
  on screen resizes the window at once (SETTINGS.md §3, FUTURE-SETTINGS §8a).
- The **card grow** rows (2026-09-16, CARD-GROW.md §8): `cardGrow` "Grow cards from edges"
  (on | off), `cardGrowOutside` "Collapse on outside click" (on | off), `compassCloseAway` "Compass closes on outside click" (on | off), `maxShortWindow` "Max window when short" (flip | floor), `cardGrowPick` "Grown
  card on card pick" (Keep | Collapse), `cardGrowView` "Keep view when grown" (Keep | Per size),
  `cardDrill` "Card on drill" (In place | Summon) and `cardDrillBring` "Bring a card already
  open" (on | off, 2026-09-17, CARD-GROW.md §15). A grow itself has no agent verb: it is a hand gesture
  and lasts only the session. An agent's own card request never swaps a grown card: the swap
  follows the last press of the user's, so an agent request collapses as before (§14.2).
- The **Rooms** section (2026-09-17, ROOMS.md §8): `roomGuests.playPause`, `roomGuests.skip`,
  `roomGuests.seek`, `roomGuests.add`, `roomGuests.changeQueue` (Everyone | Host only) — the
  controls a room YOU host starts with. They are defaults, not the live room: a change inside a
  room is a room command from the panel, not a setting. Setting `roomGuests.playPause` to Host
  only replies with the note that a guest's Pause still stops their own app (§12.3). `roomName`
  and `roomsUrl` are text, and this route has no text kind, so they are the panel's and the
  Settings card's alone. An agent in a room needs no new verb: `play`, `queue` and `control` pass
  through the same bridge every click does, so they become room commands (ROOMS.md §16.2).
- **`cardMemoryDisk`** "Keep card places on restart" (on | off, 2026-09-17, CARD-MEMORY.md §7).
  Where a card is has no agent verb; the card comes back where the user left it.
- A bad value → `400` that says what the setting takes.

### Which settings

Every value row in SETTINGS.md §3, plus `theme`, `skin`, `surface` (Mini · Mini player · Midi ·
Max), **except**:

| Left out or limited | Why |
|---|---|
| `libraryAdd` (Add to Library and ♥), `playlistExport` (Export playlists), `agentControl` (Agent control), `agentHistory` (Agents read play history, 2026-09-16, [LOCAL-DATA.md](LOCAL-DATA.md) §9), `lastfmScrobble` (Scrobble plays), `lastfmNowPlaying` (Show now playing; both 2026-09-16, [LASTFM.md](LASTFM.md) §6) — **off only**. `set … off` follows the permission; `set … on` → `403`, "Only you can turn on … in DeetsMusic › Settings › …" | The consent gates of §5. Off takes power away from agents. An agent that could turn them on would skip the user's Allow. |
| `agentSettings` — **read-only** | The permission itself. |
| `addSquareOwned` (Show ✓ on songs you have, 2026-09-17) — **not** limited, an ordinary toggle | It changes only what the Add-to-Library square shows. It writes nothing to Apple, so it is not a gate. |
| `rewindAutoShown`, `updateSkip` | Internal flags. `update action=skip` keeps owning the skip. |
| Check for updates, Roll back, App log, the report form | Actions, not values. `update` covers the first two. |

Rust-owned rows take readable keys: `closeToTray` → `settings_set_minimize_to_tray`,
`startWithWindows` → `autostart_set`, `agentControl` → `settings_set_agent_control`,
`lastfmScrobble` → `settings_set_lastfm_scrobble`, `lastfmNowPlaying` → `settings_set_lastfm_now_playing`,
`airplaySend` (AirPlay › Send to speaker, `app` / `system`, 2026-09-17, [AIRPLAY.md](AIRPLAY.md) §7) →
`settings_set_airplay_capture` (a change while a speaker plays reconnects it in place). After one,
`notifyOwnedSettingChange()` (settings-store.ts) makes an open Settings card read them again.
A skin-only row sets at any time; the reply adds "It shows while Ocean / Glass is the skin."
`updateMode` is here and stays on `update action=mode` too (same write).

### Writes

- `agent-settings.ts` `SPECS` calls the card's own setters: `setSetting`, `setLibraryAddEnabled`,
  the Rust commands. `theme` / `skin` run `noteHandPick` + `withAppearanceTransition` +
  `publishAppearance`, as the title menu does; `surface` runs `applySurface` + `tray_pin_main`.
- **The words:** `SPECS` repeats the card's labels, sections and choices (the card builds its rows
  inside `mountSettings`, with local state, so they can't be shared as-is). A new card row joins
  `SPECS` too — SETTINGS.md §5 step 5.
- **The sections must match the card, row for row.** They are what the Compass prints under a
  Settings row (`compass.ts` `sub: e.section`), so a name only `SPECS` knows is a name the user
  is told and cannot find. On 2026-09-18 the card caught up with `SPECS`: **Sound** and **Sleep**
  became real card sections, and `"Look and feel"` split into **Theme and skin** (the live theme
  and skin, which the title menu owns), **Look schedule**, **Motion**, **Skin settings** and
  **Menus, hints and notices** — which is where `compassCloseAway` moved from Window.
- Reply notes: `closeToTray off` — "The × button now quits DeetsMusic, and that stops these tools
  until DeetsMusic starts again." `agentControl off` — "Agent control is off. Only you can turn it
  on again, in DeetsMusic › Settings › Connections." (The request has passed the gate, so this
  reply still arrives.) `theme` / `skin` while a look schedule runs — the pick lasts as Menu pick
  lasts says.

### Decisions (2026-09-15)

1. **Theme, skin, surface: A** — keys; a theme or skin set counts as a hand pick.
2. **The consent gates: B (off only), all three** — the user's reason: safety and accidents.
3. **Close to tray and Start with Windows: A (included)**, with the reply note above.
4. **Agent changes settings: Allow / Ask / Off, default Ask** — the user asked for a runtime
   permission row on top of 2.

## 7. Later
- **Agent look and surface changes under a slower cover** — planned 2026-09-15, forks settled
  the same day (1A agents only, 2A one `--agent-motion` scale, 3A no label), BUILT the same day:
  [UX-COVERUPS.md §6b](UX-COVERUPS.md).
- Installer PATH entry (NSIS hook).
- **Connect AI apps for the user** — `deetsmusic mcp install` + a Settings panel over one shared
  crate: [MCP-INSTALL.md](MCP-INSTALL.md) (designed 2026-09-16, forks open).
- A small-model test of `mcp --small` (LM Studio / Ollama) with the AGENT-SETUP §3 phrases.
- Durable history (`play_events` + the track store) as a second history source.
- `artist:` ids for `play` (artist top songs) — search returns them, play doesn't take them yet.


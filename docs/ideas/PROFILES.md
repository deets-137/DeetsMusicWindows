---
status: idea
desk_test: none
sources: [src-tauri/src/lib.rs, src-tauri/src/apple.rs, src-tauri/src/settings.rs, src-tauri/src/library.rs, src-tauri/src/db_thread.rs, src-tauri/src/query.rs, src-tauri/src/lastfm.rs, src-tauri/src/friends.rs, src-tauri/src/sotd/outlet.rs, src-tauri/src/user_files.rs, src-tauri/src/wallpaper.rs, src-tauri/src/bridge.rs, src-tauri/src/beta.rs, src/settings-store.ts, src/agent-settings.ts, src/player.ts]
updated: 2026-10-18
---
# Profiles — more than one listener on one PC

> An idea (2026-10-18), not built. His ask: a family or a group of friends shares one PC or a
> TV. Each person has a profile. A switch brings back that person's settings, Apple Music
> account, Last.fm account, friends and library. §1 is his calls. §2 is what the code does
> today. §3–§6 is the design inside his calls. §8 is the open forks. Build it after the paused
> CPU floor (HANDOFF.md › Open now, optimization item 1), and design it together with Backup
> (features/BACKUP.md): both need the same list of what belongs to a user.

## 0. Terms

- **Profile:** one person's data in the app: settings, sign-ins, library cache, plays,
  playlists, the Diary, pins and picks.
- **Active profile:** the profile that the app uses now. There is always exactly one.
- **Root folder:** the app data folder (`%APPDATA%\com.deetsmusic.app`, the dev app
  `com.deetsmusic.dev`).
- **Profile folder:** `<root>\profiles\<id>\`, one for each profile.
- **Shared database:** `<root>\profiles.db`, one for the PC. It holds the profile list and the
  data that every profile uses.
- **Switch:** the change from one active profile to another while the app runs.

## 1. His calls (2026-10-18)

1. **Each profile has its own subfolder** of the root folder.
2. **Settings are stored on disk for each profile.** At a switch, the app saves the leaving
   profile's settings to its folder. It applies the arriving profile's settings through the
   path that the CLI uses to change settings, so that the change shows live.
3. **A shared database at the top** holds the profile list and the data that all profiles
   share. His example: the AirPlay speakers.
4. **Discord is out of scope.** Rich Presence talks to the Discord desktop app on the PC
   (`presence.rs`). It shows the Discord account that is signed in on the PC. A profile does
   not change that.
5. **No lock between profiles.** Family and friends do not need protection from each other.
   Any person can switch to any profile. There is no PIN.
6. **A switch is a visible change:** the theme, skin and settings change with their usual
   transitions. The music pauses, and the queue resets.

## 2. What happens today (read 2026-10-18)

- **Almost all user data is in the root folder:** `deetsmusic.db`, `settings.json`,
  `user-token.txt`, `lastfm-session.json`, `friends.json`, `sotd-outlets.json`, `files.json`
  and `files/`, `wallpaper.json`, `storefront.json` and the `library-*.json` dumps.
- **Rust holds the Apple user token, not MusicKit.** Rust reads `user-token.txt` at setup and
  gives the token to MusicKit (`injectUserToken`, player.ts). The `user-token-changed` event
  already gives MusicKit a new token while the app runs (`applyNewUserToken`, player.ts:200).
  `clearMusicKitSignIn` (player.ts:426) clears it without `unauthorize()`. `unauthorize()`
  would also sign the token out at Apple, so a switch must never call it.
- **The data folder is set one time, at launch.** These modules keep it in a `OnceLock` and
  cannot change it: `apple.rs` (`APP_DATA_DIR`), `lastfm.rs` (`DATA_DIR`), `friends.rs`,
  `query.rs` (`DB_PATH`), `sotd/outlet.rs`, `log.rs`. These call `app_data_dir()` each time:
  `user_files.rs`, `wallpaper.rs`, `report.rs`. The library database opens one time in
  `setup()` (`Db(Mutex<Connection>)`, library.rs; the database thread, db_thread.rs).
- **The web settings live in the webview's storage:** `deets.settings` (the settings store)
  and about 50 other `deets.*` keys (card memory, layouts, recents, folds, surface sizes). All
  profiles share one webview storage. The settings store reads `deets.settings` at import
  (BACKUP.md §5.3 uses a reload for this reason).
- **The CLI's settings path:** `POST /settings` on the bridge (bridge.rs:1076) asks the window
  (`ask(&app, "settings")`). The window finds the key's spec in `agent-settings.ts`, and the
  spec calls `setSetting` (settings-store.ts). `setSetting` tells each listener, so the theme
  fade, the skin change and every other change show live. docs:check 20 makes sure that every
  settings key has a spec.
- **The Rust settings file mixes two kinds of key** (`SettingsData`, settings.rs): keys for
  the PC (AirPlay, the tray, the bridge token, the window position, autostart) and keys for
  the person (Last.fm, Song of the Day, agent consent).
- **MusicKit gives no Apple user ID** (BACKUP.md §5.4). A profile is a name that the person
  picks. Two profiles can use the same Apple account.
- **Last.fm's waiting scrobbles live in `play_events`** (`queued`, lastfm.rs:10). They are in
  the profile's own database, so they wait there and go to the right account at the next
  switch in.
- **The app already keeps a second set of these files.** Beta copies `user-token.txt`,
  `developer-token.json` and `lastfm-session.json` (beta.rs:30). The dev seed copies the
  database with `VACUUM INTO` (lib.rs:145). A profile uses the same methods.

## 3. The folders

```
<root>\
  profiles.db              shared: the profile list, the PC's settings, AirPlay, catalog caches
  settings.json            the Rust keys for the PC (§4.2)
  developer-token.json     the app's MusicKit key: one for the PC
  deetsmusic.log           one log; each line after a switch names the profile id
  usage-week.json          the install's usage counts (USAGE-COUNTS.md): one install
  reports.json             the bug reports from this install
  profiles\<id>\
    deetsmusic.db          the person's library cache and their own data (§4.1)
    settings.json          the Rust keys for the person (§4.2)
    web-settings.json      the person's deets.* keys, saved at switch out (§5)
    user-token.txt         Apple
    lastfm-session.json    Last.fm
    friends.json           the friend key and the friend list (DPAPI, as today)
    sotd-outlets.json      the Song of the Day outlets
    files.json, files\     the person's own pictures and clips
    wallpaper.json, storefront.json, library-*.json
```

The `<id>` is a short random id, not the name. A rename then changes no path.

## 4. What is shared and what is the person's

### 4.1 The library database

BACKUP.md §3.1 already sorts the tables into the user's data and the caches. Profiles use the
same sort, with one more step: a cache that is a fact about Apple's catalog is the same for
every person, so it goes in the shared database. A cache that is about one Apple account stays
in the profile.

| Where | Tables |
|---|---|
| **Profile** (the person's own data) | `local_playlists`, `local_playlist_tracks`, `playlist_folders`, `playlist_folder_members`, `playlist_apple_baseline`, `playlist_refresh`, `play_stats`, `play_events`, `favorites`, `added_at`, `pins`, `row_order`, `diary_entries`, `diary_songs`, `diary_folders`, `picks`, `pick_posts`, `suggest_less`, `filter_rules`, `meta` |
| **Profile** (a cache of one Apple account) | `tracks`, `apple_playlists`, `apple_playlist_tracks`, `web_seed_list` |
| **Shared** (a cache of Apple's catalog) | `track_catalog`, `artist_catalog`, `artist_info`, `album_info`, `album_notes`, `album_note_songs`, `album_palette`, `song_credits`, `listen_counts`, `catalog_heal`, `dead_ids`, `web_artists`, `web_names`, `web_albums`, `loudness` |
| **Each file** | `db_canary` (DB-HEALTH.md: one canary for each file) |

- **The shared catalog cache has the storefront in its key.** A friend's account in another
  country can have a different catalog. A row from the US store must not answer for the UK
  store.
- **One connection reads both files.** The profile database is `main`, and `profiles.db` is
  attached as `shared`. A query that joins `tracks` to `track_catalog` names
  `shared.track_catalog`. A switch detaches one profile file and attaches the next, on the
  database thread.
- `loudness` is a fact about a song's audio, so it is shared. Each person's listening fills it
  for everyone.

### 4.2 The settings

**A draft for him to edit.** The PC's settings stay the same at a switch. The person's
settings change.

| Stays with the PC (shared) | Changes with the person |
|---|---|
| AirPlay: the speakers, the last speaker, the volume and latency of each speaker, the capture mode, the firewall exe | The theme, the skin, the look schedule, the album colors |
| Minimize to tray, autostart, Read Windows media | Every card setting, the hidden cards, the layouts, the card memory |
| The bridge token (the extension and the CLI pair with the PC) | The Equalizer and the sound settings |
| The window position, the surface sizes (`deets.surface.size.*`) | Last.fm scrobble and now playing |
| *If graphics fail* (GRAPHICS-FALLBACK.md: the GPU belongs to the PC) | Song of the Day, its outlets, its times |
| The output device | Agent control, agent history, agent Diary (each person gives their own consent) |
| The developer switches (`deets.dev.*`, `deets.debug`) | Rules (Rulez), Filter rules, the New badges seen, the tips seen, the onboarding step |
| | Search recents, Radio recents, folds, the volume, muted |

The shared keys of the settings store move to a short list, `SHARED_KEYS` in a new
`src/profile-keys.ts`, so one place says which keys a switch leaves alone. A Rust test and a
docs:check row keep this table and that list the same.

### 4.3 The sign-ins

- **Apple:** each profile signs in on its own. A new profile starts signed out, and the
  existing sign-in screen asks for Apple. The token goes to the profile folder.
- **Last.fm, Friends, Song of the Day outlets:** each profile connects its own. The friend
  code is the profile's: a friend sees the person, not the PC.
- **Discord:** not part of a profile (§1.4).

## 5. The switch, step by step

1. **The music stops.** The player pauses. The queue clears. A room is left (the guests see
   the host leave, as today). The sleep timer stops. The now-playing line to Last.fm and to
   friends ends.
2. **Background jobs stop.** Each job that writes to the library database (the library sync,
   enrich, the playlist refresh, the Rulez playlists, the catalog heal, Last.fm's flush) holds
   a profile epoch, as the rooms code does (ROOMS.md §18). A job whose epoch is old writes
   nothing. Without this, a sync that started for one person writes into the next person's
   library.
3. **The leaving profile is saved.** The front end reads every `deets.*` key that is not in
   `SHARED_KEYS` and sends it to Rust. Rust writes `web-settings.json` in the leaving folder
   with `safe_file::write_atomic`.
4. **Rust changes folders.** A new `profile.rs` holds the active folder behind a lock.
   Every `OnceLock` path in §2 becomes a call to `profile::dir()`. The database thread
   detaches the old file and attaches the new one. `AppleState.user_token` gets the new token.
   The Rust settings for the person load from the new folder. `profiles.db` records the new
   active profile, so a crash or a restart opens the same profile.
5. **The new settings apply live (his call §1.2).** The front end reads the arriving
   profile's `web-settings.json` and calls `setSetting` for each key, the same function the
   CLI's `POST /settings` ends in. The theme fades, the skin changes, the cards change. It
   calls `setSetting` directly, not the HTTP route: the route waits for the agent consent
   (Ask / Allow / Off) and the pairing token, and a switch is the person's own act.
6. **The other keys** (card memory, recents, layouts) are read at import by about 29 modules.
   How they change is fork P1 (§8).
7. **MusicKit gets the new token** through `applyNewUserToken`. A profile with no sign-in gets
   `clearMusicKitSignIn` and the sign-in screen.
8. **The library loads from the new file** at zero Apple calls. The library sync then runs as
   at any start.
9. **Log lines:** `profile: switch <from> → <to> (<ms> ms)`, `profile: saved <id> (<keys>)`,
   `profile: job dropped <job> (old epoch)`.

## 6. The first time

- **An install with one person changes nothing that the person can see.** The profile list has
  one profile, and the switch control does not show until a second profile exists, or it shows
  only *Add a person* (fork P3).
- **The move into a subfolder** happens when the second profile is made, not at the update.
  Rust copies the database to `profiles\<id>\deetsmusic.db` with `VACUUM INTO`, moves the
  person's files (§3), moves the catalog cache tables to `profiles.db`, and keeps the old file
  as `deetsmusic.pre-profiles.<stamp>.bak.db` (DB-HEALTH.md §7 lists it). A failure at any
  step leaves the old layout and logs the cause.
- **The dev seed** (lib.rs:136) and **Beta** (beta.rs) copy files from the root today. They
  must learn the new layout: copy the active profile's folder, and `profiles.db`.

## 7. Neighbors

- **The agent, the CLI and the MCP** act on the active profile. `query` reads the active
  profile's file. A `profile` verb (list, switch) is a row in AGENT.md.
- **The extension** pairs with the PC (the shared bridge token), and shows the active
  profile's song.
- **The tray** shows the active profile. A switch row in the tray menu is fork P3.
- **The Compass:** *Switch to <name>* is a verb row in `src/compass.ts` (COMPASS.md §9).
- **Rules:** the active profile's name is a fact (RULES.md §19), so a rule can say *if Mom is
  listening*. A rule can never switch the profile: only a person does that.
- **Backup** (BACKUP.md): one backup is one profile's data. BACKUP.md §8 gets a fork: back up
  one profile, or every profile.
- **Usage counts** (USAGE-COUNTS.md): one install is counted once. A count of profiles is a
  new key and goes through the privacy rules of USAGE-COUNTS.md §2 first. Not now.
- **Hop in** (HOP-IN.md): a new profile is a new person, so it goes through the welcome screen
  and the Cruisin / Pro pick. Until Hop in is built, see fork P4.
- **Rooms and friends:** a room code and a friend code are the profile's.

## 8. Open forks

**P1. How the rest of the page changes at a switch.** The settings apply live (§1.2). About
29 modules read other `deets.*` keys only at import.
- **A (recommended): the look changes live, then a covered reload.** Step 5 runs, so the
  theme and skin transition plays. Then a cover (the new theme's background and the profile
  name) hides one page reload, and every module starts clean. Cost: about 1–2 s under the
  cover while MusicKit starts again (probe §9.2). No leftover from the last person can show.
- **B: everything live.** Each of the 29 modules gets a `profile-changed` reset. Cost: no
  cover, but a module that misses its reset shows the last person's queue, recents or card
  memory. A new module must remember the reset; a docs:check row can catch a module that reads
  `deets.*` with no reset.

**P2. Which profile opens at launch.**
- **A (recommended): the last active profile.** One person on one PC sees no change.
- **B: ask *Who is listening?* at each launch** when there are two or more profiles. Cost: one
  more click for every start, the TV case's habit.
- **C: A, with a setting for B.** Cost: one more row in Settings.

**P3. Where the switch is.** He designs the UI. The places:
- **A (recommended): a profile button in the title bar** (Midi and Max), a row in the tray
  menu, and a Compass verb. The button shows after the second profile exists.
- **B: Settings › Profiles only**, plus the Compass verb. Cost: a switch takes three clicks.

**P4. What a new profile starts with, before Hop in is built.**
- **A (recommended): the defaults** (Cruisin, HOP-IN.md §1). A friend is a new user.
- **B: a choice: the defaults, or a copy of a profile's settings.**

**Not now:** a profile's picture (he designs it), Backup of one or all profiles (BACKUP.md §8),
a profile count in the usage row (USAGE-COUNTS.md §2).

## 9. The probes before a build

1. **The token swap from A to B.** `applyNewUserToken` was built for a new sign-in. Check that
   a swap from one account to another leaves no part of A's library, recommendations or
   storefront in MusicKit's memory.
2. **The reload time** under the cover for P1-A: the dev app, from reload to `ready`, ten runs.
3. **Every job that writes the database:** list them for the epoch (§5.2).
4. **Every reader of the `OnceLock` paths** and of `app_data_dir()`: grep, and list each one
   with its new call.
5. **The attached catalog:** run the queries that join to the catalog tables with `shared.`,
   and time them against today's single file.

## 10. Checklist (CLAUDE.md, Working style)

- New settings rows (the profile list, Add a person): a `NEW_MARKS` line, a spec in
  `agent-settings.ts`, a line in AGENT.md.
- Toasts (a switch failed, a profile was added): rows in TOASTS.md §5.
- Hover hints: the ONBOARDING.md §1 ledger.
- The switch panel: `makeDropdown`, `.pop` and `enterRows`, `app-scroll` for a long list.
- Log lines (§5.9). A new thread: none planned; the switch runs in `spawn_blocking`.
- The schema: `profiles.db` gets its own version and migrations; the profile file's schema
  version rises by one for the catalog move.

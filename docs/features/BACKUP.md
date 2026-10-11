---
status: designed
desk_test: none
sources: [src-tauri/src/library.rs, src-tauri/src/db_open.rs, src-tauri/src/db_thread.rs, src-tauri/src/settings.rs, src-tauri/src/user_files.rs, src/settings-store.ts]
updated: 2026-10-11
---
# DeetsMusic — Backup: one file that holds your DeetsMusic

> **Designed 2026-10-11, not built.** He closed three forks on 2026-10-11 (§1). The open
> forks are §8. The cloud copy on Cloudflare R2 is an idea with its own forks (§9). Nothing
> here is in the app. Do not tell a user that the app makes backups.

## 0. Terms

- **Library file:** `deetsmusic.db`, the SQLite database in `%APPDATA%\com.deetsmusic.app`.
- **App settings file:** `settings.json` in the same folder. The Rust side owns it
  (`settings.rs`).
- **Web settings:** the `deets.*` keys in the WebView's local storage. They live in
  `%LOCALAPPDATA%\com.deetsmusic.app\EBWebView`. `deets.settings` is the settings store
  (`settings-store.ts`); it holds the Rulez rules too.
- **User files:** the pictures and sound clips a user adds (`files/` and `files.json`,
  `user_files.rs`).
- **Backup file:** one zip file that this design makes. It holds a copy of the four items above,
  less the secrets and the caches (§3).
- **Cache:** a table that Apple's data fills again after a sign-in and a library sync.

## 1. His calls (2026-10-11)

| Fork | His call |
|---|---|
| What a backup holds | **One backup file for everything.** It leaves out the secrets and the caches that Apple fills again. |
| How the file gets made | **A *Back up now* button, plus an automatic copy every week to a folder the user picks.** A OneDrive folder takes it to a new PC with no server from us. |
| What a restore does | **Replace all, on a fresh install.** The Hop in welcome screen offers *Restore from a backup*. |

**Second round (2026-10-11):**

| Fork | His call |
|---|---|
| Where the rows live (§8.1) | **Settings › Updates.** |
| The file type (§8.5) | **`.deetsbackup`.** |
| The cloud copy (§9) | **Yes, on R2. A worker validates accounts and handles the encryption.** |
| The account (§9.2, R1) | **Sign in with Apple.** |
| Who can read a cloud copy (§9.2, R2) | **The worker holds the key, for now.** A later move to a key the user holds stays possible (§9.3). |
| Apple's CloudKit (§9.4) | **Add it as an option beside R2.** Where the cloud copy lives is fork R0, open. |

Not chosen: a separate export for each feature, our own cloud sync as the main path, and a
merge into existing data. Readable exports (plays as CSV, the Diary as Markdown) are a
separate idea, not part of this design.

## 2. What happens today (read 2026-10-11)

- **A reinstall on the same PC keeps everything.** The data folders are not in the install
  folder, and the uninstaller leaves them (RELEASE.md §5).
- **A new PC, a Windows reset or a dead disk loses everything but Apple's data.** Apple gives
  back the library, the Apple playlists, the loves and the catalog.
- **There is no backup.** The only `.bak.db` is the one copy that the v2 migration made
  (DB-HEALTH.md §7). A corrupt library file loses the same data.
- **Partial exports exist:** a rule as JSON (RULEZ.md §4), one Diary album as text (DIARY.md
  §10), a local playlist to Apple Music (PLAYLISTS.md), the friend key with *Copy my key*
  (FRIENDS.md §2a), and the read-only `query` tool for agents (LOCAL-DATA.md).

**Sizes, measured on his live library file (2026-10-11):**

| | Size |
|---|---|
| The whole library file | 21.7 MB |
| Less the cache tables (§3.1) | 1.5 MB |
| The same, zipped | **385 KB** |

So the caches are 93 % of the file. A backup without them is small enough to keep many
copies and to send to a cloud folder every week.

## 3. What the backup file holds

### 3.1 The library file: every table but the caches

**Kept (the user's own data):** `local_playlists`, `local_playlist_tracks`,
`playlist_folders`, `playlist_folder_members`, `playlist_apple_baseline`, `playlist_refresh`,
`play_stats`, `play_events`, `favorites`, `added_at`, `pins`, `row_order`, `diary_entries`,
`diary_songs`, `diary_folders`, `picks`, `pick_posts`, `loudness`, `meta` (less
`full_sync_at`, so the first start makes a full sync).

`loudness` is kept: we measure it while a song plays, so only more listening fills it again.

**Left out (caches):** `tracks`, `track_catalog`, `artist_catalog`, `album_palette`,
`song_credits`, `apple_playlists`, `apple_playlist_tracks`, `dead_ids`, `catalog_heal`,
`web_artists`, `web_names`, `web_albums`, `web_seed_list`, `db_canary`.

**A check before the build:** `lastfm.rs` joins `play_events` to `tracks` for a song's
details. Read every reader of `play_events`, `play_stats` and `picks`. Each one must show a
song before the library sync ends, or wait for it. A song that is not in the library has no
`tracks` row after a restore. If a reader needs one, keep the `tracks` rows that those tables
name. They are few.

### 3.2 The web settings: every `deets.*` key but these

- `deets.dev.*`, `deets.debug`, `deets.notice.demo`: developer switches.
- `deets.look.prepaint`: it is made again from the look at the first paint.
- `deets.surface.size.*`: window sizes. A new PC has a different screen.
- `deets.muted`: a restore must not start a silent app.

### 3.3 The app settings file: every key but these

- `bridgeToken`: a secret. The new install makes its own.
- `airplayFirewallExe`: a path on the old PC.
- `autostartSeeded`: a one-time flag for each install.
- `windowPos`: a position on the old screen.

### 3.4 The user files

All of `files/` and `files.json`. They are the user's own pictures and clips. A 2560 px
picture is 1–3 MB. His live app has none today.

### 3.5 Never in a backup file

`user-token.txt` and `developer-token.json` (Apple), `lastfm-session.json`, `friends.json`
(the friend key), `extension-connected` / `extension-declined`, and the logs. A user signs in
again on a new PC. A sign-in must not travel in a zip (SECRETS-AND-CSP.md). The friend key
keeps its own path, *Copy my key*.

### 3.6 The manifest

The zip carries `manifest.json`:
`{ format: 1, app_version, schema_version, made_at, storefront, counts: { playlists, plays,
diary, picks, pins, files } }`. The counts let a restore say what the file holds before it
replaces anything (§5).

## 4. Making a backup

### 4.1 How

1. The front end reads the `deets.*` keys (§3.2) and sends them to Rust. Rust cannot read the
   WebView's storage.
2. On the database thread (DB-HEALTH.md §2a), Rust runs `VACUUM INTO` to a temp file. This
   gives one consistent copy while the app runs. rusqlite needs no new feature for it.
3. Rust deletes the cache rows (§3.1) from the temp copy and runs `VACUUM`.
4. Rust writes the backup file, a zip with the `.deetsbackup` type (his call): `library.db`, `web-settings.json`, `app-settings.json`, `files/`,
   `manifest.json`. It writes to a `.tmp` name, then renames, so a cut-off write never looks
   like a backup.
5. All of this runs in `spawn_blocking`. A sync command must never do I/O (CLAUDE.md,
   Conventions).
6. One log line: `backup: made <name> (<KB>, <ms> ms, <why>)`, where `<why>` is `now` or
   `weekly`. A failure logs the cause.

**A new crate:** the app has no zip crate. The build adds `zip` (deflate only).

### 4.2 Back up now

A button. It writes to the chosen folder (§4.3) and a toast says where, with a *Show* button
that opens the folder.

### 4.3 The weekly copy

- A setting: the folder and on / off.
- At each start, and once a day while the app runs, the app checks the date of the newest
  backup in the folder. If it is 7 days old or more, the app makes one.
- The app keeps the newest N copies in that folder and deletes older ones. It deletes only
  files with its own name pattern.
- If the folder is gone (a removed USB drive, a OneDrive sign-out), the app logs it and skips.
  After three skipped weeks, one toast says so (§8).

**Why a OneDrive folder works:** when OneDrive's folder backup is on, Windows keeps
*Documents* inside OneDrive. A default of `Documents\DeetsMusic Backups` then reaches a new PC
with no setup for many users.

## 5. Restoring

**His call: replace all, on a fresh install.**

### 5.1 Where

- **The Hop in welcome screen** (HOP-IN.md, designed, not built) offers *Restore from a
  backup* beside the Cruisin / Pro pick. A fresh install has no data to lose.
- Until Hop in is built, Settings needs a way in too (§8).

### 5.2 What the user sees

1. The user picks a backup file.
2. The app reads the manifest and shows what it holds: *5 playlists, 2,923 plays, 2 Diary
   reviews, 202 Song of the Day picks, made 2026-10-11.*
3. The app says that this replaces the data on this PC. The user confirms.
4. The app restarts. After the start, the library sync fills the caches.

### 5.3 How

1. Rust checks the manifest. A backup with a `schema_version` higher than this app knows is
   refused: *This backup is from a newer DeetsMusic. Update the app first.* A lower one is
   fine: the migrations run on it at open, as for any old library file.
2. Rust writes `deetsmusic.restore.db` and `restore.json` (the web and app settings) and
   copies the user files.
3. The app restarts. Before the database opens, Rust renames the current library file to
   `deetsmusic.pre-restore.<stamp>.bak.db` and moves the restore file into its place. The
   `.bak.db` name means `db_open::backups` lists it (DB-HEALTH.md §7).
4. The app settings file is written with the backup's keys, over the new install's keys.
   `bridgeToken` and the other keys in §3.3 stay as they are.
5. At boot, the front end asks Rust for the pending web settings, writes them to local
   storage, and reloads the page once. The settings store reads at import, so a reload is the
   clean way.
6. Log lines: `backup: restore armed <name>`, `backup: restore done (<counts>)`.

### 5.4 Another Apple account

The backup holds no Apple user ID; MusicKit gives none. If the storefront in the manifest is
not the current one, the app warns before step 3 of §5.2. Catalog IDs (`song:…`, `album:…`)
work for any account. Library IDs (`i.…`) of the old account do not; pins and playlist songs
that name them show as missing.

## 6. The checklist (CLAUDE.md, Working style)

- **Settings keys:** `backupWeekly` (on / off), `backupFolder`, `backupKeep`. Each gets a
  default with the why, a spec in `agent-settings.ts` and a line in AGENT.md. The agent can
  read them. Whether the agent can start a backup or a restore is a fork (§8).
- **New badge:** the new rows get lines in `NEW_MARKS`.
- **Hints:** every `title` goes in the ONBOARDING.md §1 ledger.
- **Toasts:** *Backup saved*, *Backups skipped*, *Restore ready, restarting*, *Backup is from a
  newer app*: each a row in TOASTS.md §5.
- **Compass:** the rows are store-backed, so automatic; *Back up now* is one verb row.
- **Rules:** the weekly copy is a plain schedule, not a rule. A rule event "after a backup" is
  not needed.
- **Log lines:** §4.1 step 6 and §5.3 step 6.

## 7. Build scope

| Part | Where |
|---|---|
| Make, list, prune, read the manifest, arm and finish a restore | `src-tauri/src/backup.rs` (new); pure parts (the key filters, the prune rule, the version check) tested in Rust |
| The swap before the database opens | `db_open.rs` |
| Collect and apply the web keys; the weekly check | `src/backup.ts` (new); the key filter in a small pure file with a test |
| The rows | Settings (place: §8) |
| Restore on the welcome screen | with Hop in, when it is built |

## 8. Open forks

1. ~~**Where the rows live.**~~ **CLOSED 2026-10-11: Settings › Updates** (his call). The
   section today holds *Get updates*, *Check for updates* and *Roll back*
   (`settings-card.ts`, the `Updates` section). The backup rows go below them. Still open:
   whether the section title changes (for example *Updates and backup*), part of fork 8.
2. **The weekly copy's default.** On, to `Documents\DeetsMusic Backups`; or off until the user
   picks a folder. My recommendation: on. A backup the user must remember to turn on is the
   one that is not there on the day the disk dies.
3. **How many copies to keep.** My recommendation: 4 (a month of weeks, about 1.5 MB).
4. **Restore from Settings before Hop in exists.** My recommendation: yes, with the confirm in
   §5.2 and the `.bak.db` of the old data, so it can be undone by hand.
5. ~~**The file name and type.**~~ **CLOSED 2026-10-11: `.deetsbackup`** (his call), for
   example `DeetsMusic backup 2026-10-11.deetsbackup`. The inside is still a zip. Still open:
   does the installer register the type (Tauri's `fileAssociations`), so a double-click opens
   the restore screen (§5.2)? My recommendation: yes.
6. **The agent.** Can the agent start *Back up now*? Can it restore? My recommendation: back
   up yes, restore no.
7. **The skipped-backup toast.** After three skipped weeks, or never. My recommendation: after
   three.
8. **The words** of every row, toast and the restore screen.

## 9. The cloud copy on Cloudflare R2

> **Part:** designed in part · 2026-10-11. His calls: yes to R2; a worker validates accounts
> and handles the encryption; the account is Sign in with Apple (R1 A); the worker holds the
> key, for now (R2 A). R3 to R6 are open (§9.2).

### 9.1 What it adds

**What it adds.** The folder copy (§4.3) needs OneDrive or another cloud folder. A copy on our
own R2 bucket works for a user with neither. It is the same backup file; R2 is only one more
place to put it. Build the folder copy first.

**The facts to work from:**
- A backup is about 400 KB zipped today (§2). With pictures it can be a few MB.
- R2 charges for storage and for operations, not for downloads. Its free tier is about 10 GB
  of storage a month (check the prices at build time). 1,000 users with 2 copies of 5 MB each
  is 10 GB. A weekly write for 1,000 users is about 4,300 writes a month, far under the free
  operations.
- The workers deploy with `npx wrangler` 4 (CLAUDE.md, Conventions). DeetsSupport holds no
  live sockets, so a deploy there drops nothing.
- The backup holds the Diary. DIARY.md calls it private writing, and FRIENDS.md §20 says a
  friend sees no Diary today. Who can read the cloud copy is a real choice (§9.2, R2).
- **The Apple Music sign-in cannot be the account.** MusicKit's user token gives no stable
  user ID, and the Apple Music API has no "who am I" call. So the worker needs its own way to
  know the user (R1).
- R2 already encrypts every object at rest. A worker's own encryption adds protection only
  against a leak of the bucket's contents, unless the key is out of our reach (R2, option B).

### 9.2 The forks

**R1 and R2 are CLOSED 2026-10-11:** R1 A, Sign in with Apple; R2 A, the worker holds the key,
"for now" (his words). The table keeps the options as they were shown to him.

| # | Fork | Options |
|---|---|---|
| R1 | **The account.** How the worker knows the user on a new PC. | A) **Sign in with Apple.** Apple checks the user and gives a stable user ID; we store no password. Every user of the app has an Apple ID. It needs a Services ID and a key in the Apple developer account, and a web page on deets.solutions (the hosted sign-in is the reference). The worker checks Apple's ID token. B) **Email and a one-time code.** The worker stores an email address and needs a mail sender. A new store of personal data (USAGE-COUNTS.md §2). C) **The friend key.** The worker checks an Ed25519 signature. No new account, but the user carries the key with *Copy my key*, as today. |
| R2 | **Who can read the file.** | A) **The worker holds the key.** It encrypts with a key for each account and keeps the keys as a worker secret. The user carries nothing but the account. We, the operators, can read every backup, the Diary too. B) **The worker holds the account, the user holds the key.** The app encrypts with a passphrase before the upload; the worker stores only ciphertext. Nobody but the user can read it. A lost passphrase loses the cloud copy (the folder copy still works). |
| R3 | **The worker.** | A) A route on DeetsSupport (it holds no live sockets, so a deploy drops nothing). B) A new worker. |
| R4 | **The limits.** | A size cap (for example 25 MB), copies kept (for example the newest 2), one upload a day for each account, the expiry (for example 180 days with no write). |
| R5 | **The default.** | Off until the user signs in, or offered on the restore screen and in Settings › Updates. |
| R6 | **Apple's terms.** The file holds catalog IDs and song names (the Track snapshots). | Read the Apple Music API terms on storing data on a server before the build (RELEASE.md, the D.7 hardening notes). |

My recommendations for the open ones: R3 A, R5 off until sign-in. R4 and R6 need numbers and
a read of the terms first.

### 9.3 What his R2 call means

- **The words must not over-promise.** The worker can read a cloud copy. No row, hint or page
  says "only you can read it" or "end-to-end". A plain line is fine: *Stored encrypted on
  DeetsMusic's server.* The words are fork 8 (§8).
- **The key store.** The worker makes one random key for each account. A master key, kept as a
  worker secret, wraps it; the wrapped key sits beside the account record. A leaked bucket
  alone then reads as noise.
- **"For now" stays cheap.** The file carries a header: `{ enc: "worker", v: 1 }`. A later
  `enc: "user"` (the app encrypts with a passphrase before the upload) can sit beside it. The
  next weekly upload then replaces the old copy, and the worker deletes the key it held.
- **Sign in with Apple, the parts:** a Services ID and a key in his Apple developer account; a
  return page on deets.solutions; the worker checks Apple's ID token against Apple's public
  keys and keys the account by the token's `sub`. The `sub` is stable for one developer team.
  If Apple shares an email address, the worker does not store it.

### 9.4 Apple's CloudKit, an option beside R2

> **Part:** idea · 2026-10-11. His call: add it beside R2, and leave the choice open. Fork R0
> below. Nothing is tested.

**Terms.** *CloudKit* is Apple's storage service in iCloud. *The private database* is the part
of a CloudKit container that holds one user's data. *CloudKit JS* is Apple's web route to it,
for clients that are not Apple devices.

**What it is.** The app writes the backup file, as one record with the file as an asset, to the
user's private database in our CloudKit container. The user signs in to iCloud with their
Apple ID. There is no worker, no key store and no R2 bucket.

**What Apple's documents say (read 2026-10-11):**
- Data in the private database counts against the **user's** iCloud storage, not ours
  (TN2241, *Migrating to CloudKit*; the `CKDatabase` private scope page).
- The private database needs an iCloud account. Without one, every call fails.
- A web client writes user data as a user signed in to iCloud (TN2241).

**Against R2 (§9.1–§9.3):**

| | R2 and our worker | CloudKit private database |
|---|---|---|
| Storage cost | Ours (small, §9.1) | The user's iCloud; nothing for us |
| The account | Sign in with Apple; we build the worker side (§9.3) | The iCloud sign-in; Apple runs it |
| Who can read a copy | We can (R2 A, "for now") | Not us, as far as we know (to confirm, unknown 4) |
| What we build | A worker, the key store, a return page, the limits (R4) | The app side only |
| Risk | Low; we run workers today | The iCloud sign-in in WebView2 on Windows is not proven |

If CloudKit wins, R1 to R4 fall away: Apple holds the account, the key and the limits. R5
(the default) and R6 (Apple's terms) stay.

**The unknowns, in the order to test them:**
1. **The sign-in in WebView2.** No Apple document covers the iCloud sign-in for a Windows
   client. A developer forum thread reports that the sign-in for the private database fails
   ([thread 844105](https://developer.apple.com/forums/thread/844105)). This decides the
   option. The test: sign in to iCloud with CloudKit JS inside the dev app, then write and read
   one small record. A short test, not a build. No test code is written until he says go.
2. **A full iCloud.** The free plan is 5 GB, and photos often fill it. The file is about
   400 KB (§2), but a full iCloud refuses any write. The app must say so in plain words and
   keep the folder copy (§4.3).
3. **CloudKit JS is still maintained.** No 2026 news either way. Check Apple's current
   CloudKit JS reference at the test.
4. **Who can read the private database.** Our belief is that the developer cannot see a
   user's private records. Confirm it in Apple's documents before any row says so.
5. **The setup.** An iCloud container and an API token in his Apple developer account.

**Fork R0 (open): where the cloud copy lives.**
- A) R2 and our worker (§9.1–§9.3, his calls R1 A and R2 A apply).
- B) CloudKit's private database.
- C) CloudKit, with R2 as the fallback if unknown 1 fails.

My recommendation: C. Run the sign-in test first; it costs little and decides between A and B.

**What the user does, in any shape:** Settings › Updates › *Back up to the cloud* › sign in.
The weekly copy (§4.3) then also goes to the cloud. On a new PC, the restore screen (§5.2)
offers *Restore from the cloud*: sign in, pick a copy, confirm. *Delete my cloud backup* is a
button in the same rows.

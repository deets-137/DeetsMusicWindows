# DeetsMusic — Data Architecture

> The back-end half: how we authenticate, model music, fetch it, and cache it.
> UI lives in [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md). For "where are we / how do
> I run it", see [HANDOFF.md](HANDOFF.md).

The guiding rule mirrors the UI's: **the front-end only ever sees our normalized
model — never a raw Apple (or future Spotify) shape.** Normalization lives in Rust.

---

## 1. The shape of it

```
  Frontend (TS)                Rust (src-tauri/src/)
  ─────────────                ─────────────────────
  apple.ts     ──invoke──▶     apple.rs      auth + AppleProvider (normalizer)
  library.ts   ──invoke──▶     library.rs    SQLite cache + sync orchestration
                               provider.rs   MusicProvider trait (the boundary)
                               model.rs      Track / Album / Artist / Playlist / Artwork
                               lib.rs        wiring: state, DB open, command registry
```

- **Rust owns** secrets, network calls, normalization, and the cache.
- **Frontend** calls commands, renders our model, and listens for sync events.
- Adding **Spotify** later = a new provider impl + adapter in Rust; **zero UI change**.

---

## 2. Auth — the loopback browser flow

> Two tokens, two different problems. The **developer token** is minted from the MusicKit
> `.p8` and identifies the *app*; the **music-user token (MUT)** comes from the flow below and
> identifies the *listener*. This section is about the MUT. The developer token is about to
> move off the client entirely — a MusicKit key needs a paid Apple membership, so a public
> build cannot carry one. See [RELEASE.md](RELEASE.md) §7 for the Cloudflare Worker that
> mints it and the cache that keeps `developer_token()` synchronous.

The in-app webview **cannot open OAuth popups** (a known Tauri/WebView2 limitation,
[tauri#14263](https://github.com/tauri-apps/tauri/issues/14263)), and MusicKit's
`authorize()` is popup-based — so in-app auth hangs forever. We sign in via the
**user's real browser** instead, which is also our permanent approach.

Flow (`apple_begin_auth`):
1. Rust signs an Apple **developer token** (ES256 JWT from the `.p8`, ~150-day exp).
2. Rust starts a **one-shot loopback HTTP server** on `127.0.0.1`, on the first free
   fixed port of 47831–47833 (the `origin` claim needs exact ports), and
   opens the user's default browser at it (via `tauri-plugin-opener` —
   cross-platform: Windows/macOS/Linux, no `cmd`/`xdg-open` shell-out).
3. The served page is the app's own themed sign-in page (see §6) — it loads
   MusicKit JS, configures with the dev token, runs `authorize()` (popups work in a
   real browser), and **POSTs the Music User Token back** to `/callback`.
4. Rust validates a random **nonce**, stores the MUT, and shuts the server down.

### Security guards (all implemented)
- Binds **`127.0.0.1` only** (never `0.0.0.0`) — unreachable off-machine.
- **Fixed port + one-shot**: server lives only during sign-in, exits on capture or
  5-min timeout. (Was an ephemeral port until 2026-09-13; see `AUTH_PORTS` in apple.rs.)
- **Nonce**: Rust embeds a random nonce in the page; the callback must echo it, so a
  stray local page/process can't inject a token. Page and callback are same-origin.
- **MUT never reaches the renderer** — it lives in Rust memory + a gitignored file.
  The `.p8` never leaves Rust at all.
- **Production TODO:** move the MUT from `secrets/user-token.txt` (plaintext) to the
  **Windows Credential Manager** (keychain). That's the one ship-blocker here.

The MUT is persisted to `src-tauri/secrets/user-token.txt` and reloaded on startup
(`load_persisted_user_token`), so sign-in survives restarts.

### 2a. Planned: hosted sign-in page + deep link (decided 2026-09-13, NOT built)

> Replaces the `http://127.0.0.1:4783x` address in the browser with a real HTTPS domain.
> Apple sign-in is not OAuth: `authorize()` works on any page that has a valid developer
> token, so Apple needs no redirect URL. The design problem is only the return path.

**Terms**
- **Hosted page**: `https://music-api.deets.solutions/signin`, served by the DeetsSupport Worker.
- **Deep link**: a `deetsmusic://…` URL. Windows gives it to our exe.
- **Nonce**: a random one-time value. It proves that the link belongs to a sign-in the app started.

**Flow**
1. The user clicks Sign in. Rust makes a nonce and keeps it in memory for 5 minutes.
2. Rust opens `https://music-api.deets.solutions/signin?n=<nonce>&theme=<t>&skin=<s>&s=deetsmusic`.
3. The page fetches a developer token from `/token` (same origin, no CORS), then runs `authorize()`.
4. The page opens `deetsmusic://auth?n=<nonce>&mut=<MUT>` automatically, and also shows a
   **Return to DeetsMusic** button. The browser asks "Open DeetsMusic?"
5. Windows starts a second `DeetsMusic.exe` with the URL. The single-instance plugin
   (`lib.rs`, first plugin) forwards it to the running app. The second process exits.
6. Rust checks the nonce (match, not expired, not used), then stores the MUT with the
   existing capture code (`register_secret` → memory → `persist_user_token`). The
   `apple.ts` poll on `apple_connection_status` sees it. **No front-end change.**

**Decisions**

| # | Fork | Decision | Why |
|---|---|---|---|
| 1 | Page host | `music-api.deets.solutions/signin` | Same origin as `/token`, so no CORS. Adds one exact origin to `TOKEN_ORIGINS`, not three ports. The page is static, so the mint host stays D1-free (`index.js` router rule). |
| 2 | Page look | Themed | At Worker deploy, copy `src/styles/{palette,themes,skin,fonts}.css` + the two Liberation Serif fonts into the Worker. The page reads `theme`/`skin` from the query. An unknown value falls back to `lilac`/`press`. **Risk:** the copy is stale when the app adds a theme, so the copy step belongs in the release checklist. |
| 3 | Return trigger | Automatic link + **Return to DeetsMusic** button | After the Apple popup closes, the page can lose user activation. Chrome can then block the automatic link without a message. The button always works. |
| 4 | Dev build | Own scheme `deetsmusic-dev://` | The scheme is one HKCU registry entry that points to one exe. If `dev:app` registered `deetsmusic://`, it would take the scheme from the installed app. The page accepts only the two values `s=deetsmusic` and `s=deetsmusic-dev`. |
| 5 | Loopback page after ship | Keep for one release as a fallback | The app shows a link: "Browser page didn't load? Use local sign-in". This covers a Worker outage or a blocked domain. Remove it in the next release if nothing uses it. |

**Security**
- **Any web page can open a `deetsmusic://` link.** Without the nonce, a hostile page could
  sign the user in to *its* Apple account. So: reject a link when there is no pending
  sign-in, when the nonce does not match, after 5 minutes, and after the first use.
- **Cold start:** if the app is closed, the link starts a fresh app with no pending nonce.
  That link is rejected. This is correct behavior, not a bug.
- **MUT in the URL:** it is briefly in the second process's command line. Programs that run
  as the same user can read that. They can already read `user-token.txt`, so the risk is not new.
- **The MUT never passes through the Worker.** The About/README privacy notice stays true.

**Implementation notes**
- `tauri-plugin-single-instance` needs its `deep-link` feature. Its callback ignores `argv`
  today and must parse the URL. Add `tauri-plugin-deep-link` with the scheme under
  `plugins.deep-link.desktop.schemes`: `deetsmusic` in `tauri.conf.json`, `deetsmusic-dev`
  in `tauri.dev.conf.json`. The dev build registers its scheme at runtime.
- Tauri's NSIS installer writes and removes the scheme's registry entry. `nsis/hooks.nsh`
  needs no change.
- `TOKEN_ORIGINS` (when it is turned on) = `http://tauri.localhost`,
  `https://music-api.deets.solutions`, and the three loopback ports until old installs are gone.
- Cost: no new Apple API calls. Each sign-in adds one page load and one `/token` fetch on
  the Worker.
- The browser stays signed in: MusicKit keeps the MUT in the hosted page's localStorage.
  `apple_disconnect` does not clear it. This already happens with the fixed loopback ports.

**Check in the first desk test**
1. A MUT from the hosted page (Worker key `63Y9S9P5Z8`) works with the dev key
   `WPYRNBYCRT`. Expected, because Apple ties a MUT to the team, not the key. If Apple
   rejects it, the dev build must take its developer token from the Worker for sign-in.
2. Chrome and Edge do not save the `deetsmusic://auth?…mut=` link in history.
3. The automatic link works after `authorize()` in Chrome and Edge. If not, the button is the path.

---

## 3. The model (`model.rs`)

Designed from real dumps (`dev-dumps/`). The central lesson: Apple splits **library**
vs **catalog**, so:

- **`Track`** carries **both** `libraryId?` and `catalogId?` (either may be absent),
  plus catalog-only optionals (`isrc`, `artwork.textColors`). One unified type covers
  library items, catalog items, and Spotify. **`addedRank?`** powers the "Added
  Date" sort: `library/songs` exposes *no* per-song `dateAdded`, so `songs_page`
  fetches with `sort=dateAdded` and records each row's global position
  (`offset + index`) as its rank (lower = added earlier). The card **negates** the
  rank so the default ↑ direction surfaces *most-recently-added first*; a derived
  album's rank is its **most-recent** track (`max`). **Old cache rows have no rank
  until a re-sync** backfills them. (Derived albums key on album-name + **cover-art
  URL** — all of an album's tracks share one cover — so featured-/various-artist tracks
  stay unified and the album shows its *dominant* track artist; the real library/catalog
  album id arrives via on-demand catalog access (the Search card / lazy enrichment), not a
  batch pre-fetch.)
- **`Artwork`** is a URL **template** (`…/{w}x{h}bb.jpg`) + intrinsic size + optional
  palette colors (catalog only — a future hook for per-album accent theming).
- **`PlayParams`** is preserved on every Track — it's what MusicKit needs to actually
  play later. Don't drop it.
- **`Page<T>`** = `{ items, total, nextOffset }` — the paging contract.

`Album`/`Artist` are defined but **not yet wired** as synced entities (the Library card
*derives* them from songs — see below). `Playlist` **is wired** (2026-07-02): the Apple
mirror + local store in `playlists.rs` ([PLAYLISTS.md](PLAYLISTS.md)); local rows ride a
synthetic `local:{rowid}` library id, and their `created_at` serializes into
`date_added` (RFC3339, chrono) so one comparator sorts both sources. Artists are
near-empty in the library API (name only) and need on-demand catalog access (lazy
enrichment / Search) for art/genres.

> **Albums in the Library card are *derived*, not synced.** The card groups cached
> tracks by album+artist in TS (`groupAlbums` in `library-card.ts`) to populate its
> Albums view — zero extra Apple calls. A real `albums_page` sync can replace this
> later behind the same UI; see [UI-ARCHITECTURE §4a](UI-ARCHITECTURE.md).

Serde uses `camelCase`, so the TS interfaces in `library.ts` match field-for-field.

---

## 4. Provider trait + Apple adapter

`provider.rs` defines `MusicProvider` (currently just `songs_page`). `apple.rs`'s
`AppleProvider { dev, user, client }` implements it: it GETs
`/v1/me/library/songs?limit&offset`, maps each resource via
`track_from_library_song`, and returns a `Page<Track>` (reads `meta.total` + `next`).

The trait has since grown `playlists_page` / `playlist_tracks_page` (the Apple mirror
read-in, [PLAYLISTS.md](PLAYLISTS.md)) and the Search/enrichment catalog paths; it will
keep growing (`albums_page`, …) as we extend.

---

## 5. Cache + sync (`library.rs`)

**Store:** SQLite (`rusqlite`, bundled) at `<app_data_dir>/deetsmusic.db`, opened in
`lib.rs` setup and held as managed `Db(Mutex<Connection>)`.

```sql
tracks(library_id TEXT PRIMARY KEY, sort_key TEXT, json TEXT)  -- + idx_tracks_sort
```
Each row stores the full `Track` as JSON plus a `sort_key` (`lower(title)lower(artist)`)
for ordered, paged reads. Upserts are one transaction.

**Play stats** (listening tallies, for a future data-vis):
```sql
play_stats(track_id TEXT PRIMARY KEY, partial_count INTEGER, full_count INTEGER, last_played INTEGER)
```
`track_id` is `library_id ?? catalog_id` — the **same rule as the tracks PK**, so stats
join straight to track metadata. `record_play(catalogId?, libraryId?, kind)` bumps one
tally: **partial** = the song became now-playing (it *started*); **full** = playback
crossed the listened-through threshold (~90%, configurable later — see
[FUTURE-SETTINGS §7](FUTURE-SETTINGS.md)). `full_count ⊆ partial_count` (every finish also
started); `last_played` is epoch-ms of the most recent start. The front-end fires both from
`player.ts` via [`src/stats.ts`](../src/stats.ts), **deduped per song-start** so re-clicks,
seeks, and window rebuilds don't inflate the count. Purely local — no Apple calls. The full
plan for reading this back into a stats card lives in [DEETS-REWIND.md](DEETS-REWIND.md).

**Sync (`library_sync`):** stale-while-revalidate.
1. Fetch page 0 → learn `total`.
2. Compute all remaining offsets, fetch them **≤5 concurrent** (`buffer_unordered(5)`).
3. Upsert everything in one transaction.
4. Emit `library-sync` events: `{phase:"start"}` → `{phase:"progress",fetched,total}`
   → `{phase:"done",count,total}`.

~3,716 songs ≈ 38 calls ≈ 3–5s parallel. The frontend renders from cache instantly
and re-renders on `done`.

**Read (`library_tracks(offset, limit)`):** paged `Page<Track>` from SQLite, ordered
by `sort_key`.

---

## 6. The themed loopback page

To make the browser sign-in page match the app pixel-for-pixel, Rust **serves the
app's actual token CSS + bundled fonts** (embedded via `include_str!`/`include_bytes!`
from `src/styles/`), and the page's `<html data-theme data-skin>` is set from the
values the frontend passes to `apple_begin_auth`. So the page reskins with the app.

---

## 7. Command + event reference

| Command | Where | Purpose |
|---|---|---|
| `apple_developer_token` | apple.rs | sign the ES256 dev token |
| `apple_begin_auth(theme, skin)` | apple.rs | start loopback sign-in, open browser |
| `apple_connection_status` | apple.rs | is a MUT present? |
| `apple_disconnect` | apple.rs | clear MUT (memory + file) |
| `apple_dump_library` | apple.rs | **dev**: write raw API samples to `dev-dumps/` |
| `library_sync` | library.rs | full songs sync → cache (emits events) |
| `library_tracks(offset, limit)` | library.rs | paged read from cache (synced rows only) |
| `seen_tracks` | library.rs | all materialized (`source='seen'`) rows — ingested as track-store transients so historical plays resolve cross-session |
| `record_play(catalogId?, libraryId?, kind)` | library.rs | bump a track's `partial`/`full` play tally |
| `play_events_since(sinceTs)` | library.rs | windowed read of the play-event log (the Rewind card) |

| Event | Payload |
|---|---|
| `library-sync` | `{ phase: "start" \| "progress" \| "done", fetched?, count?, total? }` |

---

## 8. Where data lives

| Thing | Path | Committed? |
|---|---|---|
| Apple key + IDs | `src-tauri/secrets/{apple.json, *.p8}` | ✗ gitignored |
| Captured MUT | `src-tauri/secrets/user-token.txt` | ✗ gitignored |
| Library cache | `<app_data_dir>/deetsmusic.db` | n/a (runtime) |
| Back-end settings | `<app_data_dir>/settings.json` | n/a (runtime) |
| App log | `<app_data_dir>/deetsmusic.log` (+ `.1.log`, LOGGING.md) | n/a (runtime) |
| Raw API dumps | `dev-dumps/` | ✗ gitignored |
| Shipped installers | `installers/` | ✗ gitignored ([RELEASE.md](RELEASE.md)) |
| Cached developer token | `<app_data_dir>/developer-token.json` | n/a (runtime) — `{token, exp, source, config}`; written only when the mint is used, [RELEASE.md](RELEASE.md) §7 |

`<app_data_dir>` is `%APPDATA%\com.deetsmusic.app`, or `…\com.deetsmusic.dev` under
`npm run dev:app` — the identifier is the only thing that config changes, which is what keeps
a dev build off the installed build's cache, settings and WebView2 profile.

**`settings.json` (`settings.rs`)** is the handful of choices Rust must know *before* the
webview is up, so they can't live in localStorage: `minimizeToTray` (the × policy runs before
any JS could answer), `readWindowsMedia` (the tray panel's GSMTC fallback), `bridgeToken` (the
extension's shared secret), and `windowPos` (where the real window sat, so the tray flyout can
be put back — [TRAY.md](TRAY.md) §5). Every field has a default, so a missing or stale file
never blocks startup. Everything else — theme, skin, layout, surface — stays in localStorage.

**Path resolution:** `secrets_dir()` prefers `<app_data_dir>/secrets/` and falls back to the
compile-time `CARGO_MANIFEST_DIR`, so an installed build can be made self-contained by copying
`src-tauri/secrets/` there (`secrets/README.md`). The captured MUT is always *written* to app
data — an installed app writing back into the source tree is the thing that fix was for. Only
`dev-dumps/` is still repo-relative, which is correct: it's a dev-only artifact.

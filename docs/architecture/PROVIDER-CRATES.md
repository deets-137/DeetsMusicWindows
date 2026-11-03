---
status: designed
desk_test: none
sources: [src-tauri/src/apple.rs, src-tauri/src/provider.rs, src-tauri/src/model.rs, src-tauri/src/apple_calls.rs, src-tauri/src/web.rs, src-tauri/src/enrich.rs, src-tauri/src/favorites.rs, src-tauri/src/notes.rs, src-tauri/src/playlists.rs, src-tauri/src/suggest.rs, crates/mcp-install/Cargo.toml]
updated: 2026-11-03
---
# Provider crates — Apple Music in its own crate

> **Part:** designed · 2026-11-03. His ask: "Design the rust crate. Let's pretend we'll have a
> similar crate for Soundcloud or Spotify eventually." Both forks are closed (§9, his calls,
> 2026-11-03). **A design only: he has not asked for a build** ("this is just a design for now").
> A second service ships as a **separate app**, not inside this one (§10, his direction,
> 2026-11-03).

**Terms.**
- A *service* is Apple Music, Spotify or SoundCloud.
- A *provider crate* is the Rust crate that talks to one service: `crates/apple-music` now,
  `crates/spotify` or `crates/soundcloud` later.
- The *core crate* is `crates/music-core`: the normalized model and the provider trait that every
  provider crate implements.
- The *host* is the app (`src-tauri`). It gives a provider crate its counter, its log, its token
  storage and its redaction, through one trait (§5).
- *Data* is everything over HTTP: library, catalog, search, stations, ratings, notes.
- *Playback* is the sound. For Apple it is MusicKit JS in the webview. This design does not touch it (§8).

Read with [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) §4 (the trait as it is),
[PROVIDERS.md](../integrations/PROVIDERS.md) (the parked two-service design: ids §2, capabilities
§6, the playback backend §7) and [APPLE-CALLS.md](../ops/APPLE-CALLS.md) (the counter and the back-off).

---

## 1. What is true today (read 2026-11-03)

1. **Every Apple request already goes through apple.rs.** `api_get`, `api_post` and `api_send`
   (apple.rs, about line 1273) count each reply, arm the 429 back-off, refuse a background job
   while backing off, and log failures. No module sends to Apple on its own client. So the counter
   covers every call today. The crate keeps that property; it does not create it.
2. **The URLs and the JSON reading are spread out.** Seven modules besides apple.rs build their
   own `api.music.apple.com` URLs and read Apple's JSON themselves:

   | Module | Apple calls it builds |
   |---|---|
   | `web.rs` | artists with views, an artist view page, albums with tracks, search, a song (8 sites) |
   | `favorites.rs` | ratings: read, set, delete, many at once (4) |
   | `enrich.rs` | the storefront, songs by id with artists (2) |
   | `notes.rs` | an album's editorial notes, from an album or a song (2) |
   | `playlists.rs` | create a playlist, add tracks (2) |
   | `suggest.rs` | the −1 rating (1) |
   | `heal.rs` | none of its own; it reads the storefront through `enrich.rs` |

3. **apple.rs does five jobs in 3,235 lines.** (a) Tokens and sign-in: the developer token (local
   JWT or the DeetsSupport mint), the user token file, the loopback page, the deep link. (b) The
   HTTP transport above. (c) Apple JSON → our model (`track_from_library_song`,
   `playlist_from_catalog`, `station_from_catalog`, `album_from_library` …). (d) About 35 Tauri
   commands. (e) Cache glue: 19 uses of `library::Db`, `enrich::cache_tracks`, `notes::seed`,
   `credits::note_tracks`.
4. **The trait is small.** `MusicProvider` (provider.rs, 37 lines) has 4 reads: `songs_page`,
   `playlists_page`, `playlist_tracks_page`, `search`. Everything else goes around it.
5. **The model is already free of the app.** model.rs imports only `serde`, so it can move to a
   crate as it is. 29 `model::` paths in the app point at it.
6. **The precedents.** `crates/mcp-install` is a path crate in this repo, not a workspace member;
   `src-tauri` and `cli/` list it by path. `deets-airplay` is a git crate in its own repo, because
   the DeetsAirplay tray app shares it.

## 2. The shape

```
crates/
  music-core/      model.rs (moved), the Provider trait, Caps, ProviderError, the Host trait
  apple-music/     transport, tokens, endpoints, Apple JSON → model. Depends on music-core only.
  (spotify/)       later: the same trait, its own transport and tokens
  (soundcloud/)    later
src-tauri/         the Tauri commands, the cache, the sign-in screens, the Host impl
```

- **Two crates, not one.** A provider crate never depends on another provider crate. Both depend
  on `music-core`. The app depends on all. With one crate, a Spotify crate would have to depend on
  the Apple crate to get the model.
- **Path crates in this repo**, the `mcp-install` way. No other program uses an Apple client, so
  a second repo and a pinned `rev` would only add steps.
- **No Tauri and no SQLite in a provider crate.** It takes ids and tokens, and returns models. This
  is the boundary that makes a crate replaceable. The cache stays the app's job (§6).

## 3. `music-core`

- `model` — today's model.rs, moved as it is. The app keeps `pub use music_core::model;` in
  `src-tauri/src/model.rs`, so the 29 paths do not change in the first step.
- `ProviderError` — replaces the bare `String` errors at the boundary:
  `Unsupported` (this service cannot do it), `SignedOut`, `RateLimited { retry_after }`,
  `Busy` (a background job refused during the back-off; today `apple_calls::BUSY`),
  `Http { status, path }`, `Net(String)`, `Parse(String)`. The commands still turn it into a
  `String` for the front end, so nothing on the page changes.
- `Caps` — what a service can do, one flag each: `library`, `playlists`, `playlist_write`,
  `search`, `artist_page`, `related`, `stations`, `ratings`, `add_to_library`, `notes`,
  `recent`, `preview`. The table in PROVIDERS.md §6 is the starting values.
- `Provider` — the trait (§4). `Host` — the trait the app implements (§5).

## 4. The trait

Grouped by capability, so a new service reads as a checklist. Each method returns
`Result<_, ProviderError>`.

| Group | Methods | Today's code |
|---|---|---|
| Account | `check()`, `storefront()` | `apple_check`, `enrich::storefront` |
| Library | `songs_page`, `playlists_page`, `playlist_tracks_page`, `recent_played`, `recent_added`, `library_artists_page` | the trait, `recent_*_run`, `sync_artist_catalog` |
| Library write | `add_to_library(ids)`, `playlist_create`, `playlist_add` | `apple_add_to_library`, playlists.rs |
| Catalog | `search`, `songs(ids)`, `albums(ids)`, `collection_tracks`, `artist(id, views)`, `artist_view_page`, `song_artist`, `related` | catalog commands, web.rs, enrich.rs |
| Stations | `stations_live`, `my_station`, `discovery`, `genres`, `genre_stations`, `seed_station` | the 6 `radio_*` commands |
| Ratings | `rating_get(ids)`, `rating_set`, `rating_clear` | favorites.rs, suggest.rs |
| Editorial | `album_notes` | notes.rs |
| Playback hand-off | `play_params(track)` | `PlayParams` in the model, read by MusicKit |

- `fn caps(&self) -> Caps` — one place that says what the service does.
- **The trait is native `async fn`**, as provider.rs is now. No `async-trait` crate. The app holds
  the providers as an enum (`enum AnyProvider { Apple(AppleMusic) }`) and matches on it. A new
  service is one more arm. A method a service cannot do has a default body that returns
  `Unsupported`; the app reads `caps()` to hide its control (§9 F1).

## 5. The `Host` trait (what the app gives a provider crate)

A provider crate cannot reach the app's log, counter or files. The app hands it one object:

| Method | Today | Why the crate needs it |
|---|---|---|
| `count(kind, path, status)` | `apple_calls::count` | the per-minute counter and the groups |
| `on_rate_limit(path, retry_after)` | `apple_calls::on_429` | the back-off |
| `may_call(kind) -> Result<(), ProviderError>` | `refuse_in_background`, `take_forced`, `forced_offline` | the background refusal and the dev-only forced 429 / offline |
| `redact(secret)` | `log::register_secret` | **every token is redacted from the log before it is used** |
| `log(level, line)` | `log::info` / `warn` / `error` | failures, as today (status + path, never the query's tokens) |
| `load_token(name)` / `save_token(name, value)` | the user token file, `safe_file::write_atomic` | the file stays atomic and lenient (CLAUDE.md conventions) |
| `on_signed_out()` | the `apple-signin-rejected` event | a 403 on `/me` tells the front end |

- **The counter's rules move with the provider, its numbers stay in the app.** The path groups
  (`library`, `me`, `catalog`, `search`, `write`, `probe`) are Apple's, so `apple-music` names
  the group and passes it in `count`. `apple_calls.rs` keeps the tables, the minutes ring, the
  back-off clock and `apple_calls_status`. A Spotify crate passes its own groups to the same counter,
  keyed by service. The Settings and `diag` reads stay one place.
- **The host is the only door out.** A provider crate has no `std::fs` writes and no globals that
  hold a token. This is a security gain over today: the dev token and the user token are now
  `static Mutex`es in apple.rs that any module can read.

## 6. What moves, what stays

**Moves to `apple-music`:**
- The transport: `api_get_once`, `api_post_once`, `api_send_once`, `observe`, `log_failure`, the
  401 refetch (`refetch_after_401`), the one `reqwest::Client`.
- The developer token: the local JWT signing (`sign_local`), the mint request (`fetch_from_mint`,
  `MintResponse`), the refresh margin, the cooldowns. Storage goes through `Host`.
- Every URL in §1.2 and in apple.rs, as one function per endpoint (`endpoints.rs`).
- Every Apple JSON reader: `track_from_library_song`, `artwork_from`, `playlist_from_catalog`,
  `playlist_from_library`, `station_from_catalog`, `album_from_catalog`, `album_from_library`,
  and the readers now inside web.rs, favorites.rs, enrich.rs and notes.rs.
- Their unit tests. The readers are pure, so `cargo test` in the crate runs on saved replies
  (`apple_dump_library` already writes them) with no network.

**Stays in `src-tauri`:**
- The Tauri commands. Each becomes a few lines: get the provider, call it, cache, return.
- The cache and every SQLite write (`library::Db`, `enrich::cache_tracks`, `notes::seed`,
  `credits::note_tracks`, the artist tables). The crate returns models; the app decides what to keep.
- The sign-in screens: the loopback page (it embeds the app's CSS and fonts), the deep link, the
  hosted page on DeetsSupport, `AppleState`'s auth status. The crate gives the pieces (the dev token
  to show, the accepted user token); the app owns the window and the browser hop.
- `apple_calls.rs`'s tables and clock (§5), and the dev-only `apple_force_429` / `apple_force_offline`.
- `build_key()` and `BUILD_HEADER`: they belong to DeetsSupport, not to Apple. They move to a
  small `support.rs` in the app. `report.rs` and `usage.rs` use them, not Apple code.

## 7. Build order (each step compiles, `npm run check` passes, nothing on screen changes)

1. **`music-core`.** Move model.rs; re-export it. Add `ProviderError`, `Caps`, `Host`. No behavior change.
2. **`apple-music` transport and tokens.** Move the transport and the developer token. apple.rs's
   `api_get` / `api_post` / `api_send` become one-line calls into the crate, so every caller still
   compiles. The app implements `Host`. Check: the `[apple]` counter lines read the same before and after.
3. **The readers and the endpoints, one module at a time:** apple.rs's own, then `favorites.rs`,
   `suggest.rs`, `notes.rs`, `playlists.rs`, `enrich.rs`, `web.rs`. Each is its own step with its tests.
4. **The trait grows to §4** and the commands become thin. `provider.rs` is removed; the trait
   lives in `music-core`.
5. **A docs:check rule:** the string `api.music.apple.com` outside `crates/apple-music/` fails
   the check. This is what keeps the URLs from spreading again.

A restart of the dev runner is needed after each step (a crate change rebuilds Rust).

## 8. What this does not do

- **Playback.** MusicKit stays in `player.ts` and about 35 other files. A player interface is
  needed only on the day a second service makes sound, and §10.3 says how small it is with one app
  per service. Until a service is real, an interface has one implementation and no test of its
  shape, so it is not built now.
- **Ids.** Track ids stay Apple ids. With one app per service (§10) no id prefix is needed: each
  app's data folder holds one service's ids. The `am:` / `sp:` namespace of PROVIDERS.md §2 belongs
  to the parked one-app design.
- **A second service.** Spotify is parked on its terms (PROVIDERS.md §9). Check SoundCloud's API
  terms before any design of that crate.

## 9. The forks (closed 2026-11-03)

His calls: **F1 = A** and **F2 = A**. The options are kept below as the record.

**F1. A method a service cannot do.**
- **A (recommended): a default body that returns `Unsupported`, plus `caps()`.** A new crate
  implements only what its service does. The app reads `caps()` to hide a control, and
  `Unsupported` is the safe answer if a call slips through. Cost: the compiler does not force a
  new crate to fill a method; `caps()` and a test per crate do.
- **B: one trait per group (`Library`, `Catalog`, `Stations` …).** The compiler knows exactly what
  each service has. Cost: native `async fn` traits are not object-safe, so the app needs a
  generic or a per-group enum for each group, and every command matches on more types.

**F2. The front end in this move.**
- **A (recommended): no front-end change now.** The commands keep their names (`apple_*`,
  `catalog_*`, `radio_*`). The page, `web/handlers.ts` and `demo/handlers.ts` are not touched. The
  rename and `caps()` on the page are the first step of a second-service design. Cost: the page still
  names Apple until then.
- **B: neutral names and caps on the page now.** For example `catalog_search` stays, and
  `apple_add_to_library` → `add_to_library`; a `provider_caps` command; cards hide a control by
  capability. Cost: 16 TS files, the web and demo handlers, the bridge and the agent docs change,
  with only one service to test against.

## 10. One app per service

> **Part:** designed · 2026-11-03. His direction: a second service is "a second version of the
> app available on the website", so users do not mix services in one app's data and ids. Not built.

**Terms.** A *service app* is a separate install for one service, with its own name, data folder
and download. A *flavor* is how this repo builds one. DeetsMusic Beta is the precedent
([BETA.md](../ops/BETA.md) §3): its own identifier, name, icon, link scheme, CLI and update
channel, from one overlay (`tauri.beta.conf.json`) and `release.mjs --beta`.

### 10.1 Why one app per service

- **The services' terms can require it.** An API's terms can forbid mixing its content with another
  service's, and can forbid the service's name in the app's name. One app per service keeps both
  rules by construction. The name then comes from the brand config
  ([whitelabel.md](../ideas/whitelabel.md) §6).
- **It removes the hardest parts of the one-app design** (PROVIDERS.md):

  | One app, two services | One app per service |
  |---|---|
  | The `am:` / `sp:` id prefix across the cache, favorites, the queue restore, Rewind and the bridge | Not needed: one service's ids per data folder |
  | A mixed Queue, a player switch at a song's end, a ~300–800 ms gap | Gone: one player per app |
  | Two rows in the Account flyout; one merged library on the ISRC | Gone |
  | A choice of service at run time | Made at build time (§10.2) |

### 10.2 The service is picked at build time

- **Rust:** a Cargo feature per provider crate (`apple`, later `soundcloud` …). `AnyProvider` has
  one arm in each build.
- **The page:** a Vite flag picks the player and the service's code. A build that is not Apple's
  never loads the MusicKit script, and its CSP (`architecture/CSP.md`) lists only its own service's
  hosts. Code a build does not use is compiled out, as for the release bundle today.
- **`caps()` is still read** (§9 F1): the service app hides what its service cannot do (stations,
  editorial notes, Add to Library …). The page's first read of `caps()` comes with the first
  flavor (§9 F2).

### 10.3 The player interface, in this shape

Still needed, but smaller than PROVIDERS.md §7: no switch between players in the middle of the
Queue, no two players at once, no shared volume. It is one seam per build. `player.ts` and the files
that read MusicKit call the interface; the build puts MusicKit or a plain `<audio>` player behind
it. Without it, a flavor needs a second `player.ts` or a service check in about 35 files.

### 10.4 What a flavor needs

From the Beta: an overlay (identifier, `productName`, `mainBinaryName`, icon, link scheme),
`release.mjs --flavor <name>`, its own update feed, its own package identity (IDENTITY.md), its own
CLI and MCP names, its own Launch-at-startup value. Four more that the Beta does not solve:

1. **The agent bridge port.** 47825 belongs to whichever app started first. With two apps on one
   PC, each MCP must reach its own app (BETA.md §7 has the same gap).
2. **Rooms and Friends** are per service: two listeners on different services cannot share a room.
   Invite links carry the flavor's own link scheme.
3. **DeetsSupport.** The board already keys posts by `app`; the usage counts need the same key
   (USAGE-COUNTS.md).
4. **Signing.** The signing step takes a certificate per flavor (RELEASE.md §0).

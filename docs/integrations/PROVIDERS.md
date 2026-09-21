---
status: parked
desk_test: none
sources: []
updated: 2026-09-15
---
# DeetsMusic — Two services, one library (Apple Music + Spotify)

> **Status (2026-09-15): PARKED — not built, not planned.** Designed as option **B** (both
> services at once, one merged library) earlier the same day; then the Spotify facts in §9
> were checked and the user stopped it. The blockers are Spotify's, not ours: the app owner
> must hold Premium; the ISRC is gone, so the merge has no key; search is capped at 10; artist
> top tracks are removed; Developer Policy III.5 forbids integration with another service's
> content and II.4 demands Spotify's marks and link-backs; and the Web Playback SDK bars
> commercial use without written approval. The design below is kept as a record. Reopen only
> if Spotify's dev-mode terms change.

**Terms.** A *service* is Apple Music or Spotify. A *provider* is the Rust object that
talks to one service and returns our normalized model (`MusicProvider`, `provider.rs`).
A *backend* is the code in the webview that makes sound for one service (MusicKit JS
today). An *account* is one signed-in service. The *Account flyout* is the sub-menu under
**Account ›** in the title menu (`index.html`, `data-row="account"`). A *match* is one
song that both services carry, joined by its ISRC.

---

## 0. The rules the user set

1. **Both at once.** A user can be signed in to Apple Music and Spotify at the same time.
   Either alone must keep working exactly as today.
2. **One library.** The Library card shows one list. A song that both services carry is
   one row, not two.
3. **The Account flyout is the switch.** Each service is one row in the flyout: sign in,
   sign out, and which service plays a matched song.
4. **Bring your own Spotify key.** The user pastes a Spotify *Client ID* they made
   themselves. DeetsMusic guides a non-power user through the 4 steps (§4). Apple keeps
   the hosted DeetsSupport mint; "use my own Apple key" stays a power-user row.
5. **No UI rewrite.** The cards keep the normalized model. A service that cannot do a thing
   hides that thing (§6). Nothing in a card branches on "Apple" or "Spotify" by name.
6. **Token-based, as always.** The source badge is a theme role and a skin token
   (PLAYLISTS.md §3 already says so). No logos.

---

## 1. What exists today (checked 2026-09-15)

**Already provider-agnostic**

- `provider.rs`: the `MusicProvider` trait with 4 read methods — `songs_page`,
  `playlists_page`, `playlist_tracks_page`, `search`. `apple.rs` implements it.
- `model.rs`: one `Track` for library and catalog items, `libraryId?` + `catalogId?` both
  optional, `isrc?` present. `PlayParams` is preserved for MusicKit.
- The queue (`queue.ts`, QUEUE.md) is the source of truth. The player mirrors a bounded
  window of it into MusicKit. Handles are ids, not Tracks.
- Sign-in runs in the user's real browser through a loopback page on `127.0.0.1:<ephemeral>`
  (`apple.rs`, DATA-ARCHITECTURE.md §2). Spotify's PKCE flow needs exactly this shape.
- Playlists: the unified list with a per-source badge is already designed (PLAYLISTS.md
  §3); local rows already ride a synthetic `local:{rowid}` id.

**Apple-only, and the reason B is not free**

- **About 20 Tauri commands bypass the trait** and are invoked by name from the cards:
  `catalog_search`, `catalog_artist`, `catalog_related`, `catalog_song_artist`,
  `catalog_collection_tracks`, `catalog_enrich`, `album_palette`, `apple_add_to_library`,
  `favorite_set` / `favorites_reconcile`, and 7 `radio_*` commands.
- **The backend is MusicKit through and through.** `player.ts` alone has ~155 MusicKit
  references; 13 front-end files touch `MusicKit`.
- **One id space.** `song:<catalog id>` in the agent bridge (`bridge.rs`), the SQLite
  cache (`library.rs`), favorites, dead ids, the queue restore blob, the session play log
  and Rewind all assume Apple ids.
- **The Account flyout has one hard-coded row** ("Apple Music", `#account-action`,
  `#account-status`, painted by `main.ts`).

---

## 2. Ids — the provider namespace

Every id that leaves Rust gets a service prefix. Apple ids keep working unprefixed for one
release through a read shim; new writes always carry the prefix.

| Kind | Apple | Spotify |
|---|---|---|
| Song catalog id | `am:1440857781` | `sp:4uLU6hMCjMI75M1A2tKUQC` |
| Library id | `am:i.xxxxx` | `sp:` + the same id (Spotify has no separate library id) |
| Playlist | `am:pl.…` / `am:p.…` | `sp:37i9…` |
| Local playlist | `local:N` (unchanged) | — |
| Station | `am:ra.…` | — (§6) |

- `Track` gains **`service: "am" | "sp"`** (serde, camelCase). `libraryId?` / `catalogId?`
  keep their meaning inside that service.
- The agent bridge keeps `song:` / `album:` / `playlist:` and takes the prefixed id after
  the colon: `song:sp:4uLU…`. AGENT.md §ids gets one line.
- The SQLite cache adds a `service` column to `tracks`, `playlists`, `favorites`,
  `dead_ids`, `play_events` (schema bump; the migration stamps existing rows `am`).
- Rewind counts a **match** once: play events are keyed by the *merged row id* (§3), not
  the service id. A song played on Spotify and later on Apple is one song in Rewind.

---

## 3. One library — the merge

The merge happens **in Rust, after sync, before the cache is read** (`library.rs`), so the
cards see one list and stay dumb.

- **Key = ISRC.** Apple gives it on catalog items (the lazy enrichment already fetches it,
  `enrich.rs`); Spotify gives it on every track (`external_ids.isrc`). No ISRC on either side
  → no merge; the row stays single-service.
- **A merged row** carries **both** service ids: `ids: { am?: TrackIds, sp?: TrackIds }`,
  plus one display set (title, artist, album, artwork, duration). Display fields come from
  the **preferred play service** (§5) so what you see is what plays.
- **Union, not intersection.** A song in only one library shows with that service's badge.
  A song in both shows one row with a **two-dot badge** (theme roles `--source-am`,
  `--source-sp`; skin token for the dot size).
- **Derived albums** (`groupAlbums`, `library-card.ts`) group on album name + cover URL
  today. Covers differ across services, so a merged row groups on album name + **the
  preferred service's** cover. An album that exists on both services with different
  covers merges when ≥ 1 track in it is a match; otherwise it stays two albums (rare,
  accepted).
- **Playlists** are not merged. Each service's playlists appear in the unified list with
  its badge (PLAYLISTS.md §3 as designed). Local playlists hold merged rows, so a local
  playlist can mix both services freely.
- **Favorites** are per service (Apple ♥ ≠ Spotify "saved"). The ♥ on a merged row writes
  to the **preferred play service** and shows filled if *either* service has it. FAVORITES.md
  gets a §"Two services" note.

**Cost.** Spotify's library read is 50 per page (`GET /me/tracks`), so a 3,900-song
library is ~80 calls, the same order as Apple's ~76. The merge is a hash join in Rust,
one pass, no network.

---

## 4. Sign-in — Spotify PKCE on the existing loopback

- **Client ID row.** Settings › Accounts › "Spotify Client ID" (text row, new row kind
  `TEXT`, or reuse `HTML`). Below it, a 4-step guide in plain words, each step one line,
  with a *Copy* pill for the redirect address:
  1. Open developer.spotify.com › Dashboard and press *Create app*.
  2. Paste this Redirect URI: `http://127.0.0.1:<port>/spotify`.
  3. Tick *Web API* and *Web Playback SDK*. Save.
  4. Copy the *Client ID* into the box above.
- **The flow.** Same loopback server as Apple (`apple.rs` → lift the server into
  `loopback.rs`, both flows share it). PKCE: Rust makes the verifier + challenge, opens
  `accounts.spotify.com/authorize` in the browser, receives `code` on the loopback page,
  swaps it for `access_token` + `refresh_token`. No client secret anywhere.
- **Scopes.** `user-library-read user-read-playback-state user-modify-playback-state
  streaming playlist-read-private playlist-read-collaborative user-library-modify`
  (the last one only if Library Add is on — same gate as Apple, FAVORITES.md §gate).
- **Refresh.** Spotify access tokens live 1 hour. Rust refreshes on demand and 60 s before
  expiry while playing; the webview never sees the refresh token. The access token *does*
  reach the webview for the Web Playback SDK (the same "MUT reaches the renderer for one
  path" exception as MusicKit, HANDOFF.md §decisions).
- **Storage.** Next to the Apple user token, same store, keyed by service.
- **Port.** ⚠️ **Verify before build (§9):** whether Spotify tolerates a variable port on
  `127.0.0.1` redirects. If not, the Spotify loopback binds a fixed port from a short list
  (first free of, say, 7391 / 7392 / 7393), and the guide shows all three as URIs to
  register. This is the one place the "never hardcode one port" rule bends, and only
  because Spotify's server checks the string.

---

## 5. The Account flyout

Today: one row. Designed: **one row per service + one choice row**.

```
Account ›
  ● Apple Music        Signed in as …        [Sign out]
  ○ Spotify            Not signed in         [Sign in]
  Play matches on      [Apple | Spotify]     (shows only while both are signed in)
```

- Each service row keeps today's three states (`out` / `loading` / `in`) and the status
  line under it. The Spotify row's *Sign in* is disabled with the hint "Add a Client ID in
  Settings › Accounts" until one is saved.
- **"Play matches on"** is the *preferred play service* (`settings-store` key
  `playService: "am" | "sp"`, default = the first service signed in). It decides:
  which service plays a merged row, which display fields a merged row shows (§3), and
  where ♥ writes. Changing it re-paints the Library (display fields swap); it does not
  touch the queue mid-song.
- A single-service song always plays on its own service regardless of this choice.
- The Settings card's Accounts section holds the slow things: Client ID, the guide,
  "use my own Apple key" (power-user, collapsed), and a "Forget Spotify" that wipes tokens
  + cache rows for `sp`.

---

## 6. Capabilities — what hides per service

The cards must not know service names. Rust exposes one command,
`provider_capabilities() → { am: Caps, sp: Caps }`, and each card asks `caps(service)`.

| Capability | Apple | Spotify (apps made after 2024-11-27) | Where it matters |
|---|---|---|---|
| `library`, `playlists`, `search` | yes | yes | trait methods |
| `artistPage` | yes | yes (`GET /artists`, top tracks, albums) | `catalog_artist` |
| `related` | yes | **no** (related-artists removed) | Related row, `catalog_related` |
| `radio` | yes | **no** (recommendations removed) | Radio card, `radio_*`, Stations |
| `enrich` (ISRC, palette) | yes | ISRC yes, palette **no** (§7) | `catalog_enrich`, Album Color |
| `preview` | yes | **no** (30 s previews removed) | `preview_url` |
| `addToLibrary`, `favorite` | yes | yes (`PUT /me/tracks`) | Library Add gate |
| `lyrics` | flag only | no | `has_lyrics` |

- **Radio card**: Apple-only. It stays a card; it shows "Radio is an Apple Music feature"
  when only Spotify is signed in. Stations seeded from a Spotify-only song are not offered
  (`radio_seed_station` is gated by `caps(track.service).radio`).
- **Related** rows hide for `sp` rows. **Album Color** falls back to the local palette
  extraction the mosaic already does (`mosaic.ts` reads pixels) — a small extractor over
  the cover, no network. This is the one place Spotify gets a *new* code path.
- The ~20 direct commands stay as they are for Apple; each gains a `sp` arm or returns
  `Unsupported` which the card maps to "hide". The trait grows by `artist`, `collection_tracks`,
  `add_to_library`, `favorite_set` (the 4 that both do).

---

## 7. Playback — the second backend

The biggest slice. Build the DRM proof first (memory: build-first, do not re-argue the
risk).

- **`Backend` interface** in `src/backend.ts`: `load(handles, index)`, `play()`, `pause()`,
  `seek(s)`, `next()`, `prev()`, `setVolume()`, `position()`, `onState(cb)`,
  `onEnded(cb)`, `onError(cb)`. `player.ts` keeps the queue window logic and the
  click→sound telemetry; it calls the backend instead of `music.*`.
- **MusicKit backend** = today's code, moved. No behavior change; this is the refactor
  that has to land with zero regressions (perf.ts lines must stay identical).
- **Spotify backend** = the Web Playback SDK inside the webview. It registers a Spotify
  Connect device named "DeetsMusic"; play = `PUT /me/player/play {device_id, uris}` from
  Rust (the token stays server-side for the API; the SDK gets it through its
  `getOAuthToken` callback). Position and state come from `player_state_changed`.
  Widevine is the DRM; WebView2 is Chromium and ships it, so the proof is expected to
  pass but must be run. **Premium is required**; a free account gets one toast at sign-in
  ("Spotify plays only with Premium. Your library still shows.") and `caps.sp.play = false`.
- **Switching mid-queue.** The queue can hold rows from both services. When the *next*
  row is on the other service: pause the old backend, `load` the new one with its own
  bounded window, play. Gapless across services is out of scope; a ~300–800 ms gap is
  accepted and logged as `[perf] switch am→sp …`. Within one service, gapless is unchanged.
- **Volume** is per backend; the volume pill sets both. **SMTC**, **AirPlay** and the tray
  follow the *active* backend through `np-bus.ts` as today; AirPlay (AIRPLAY.md) is
  loopback capture of our own process, so it works for both.
- **Restore across sessions** (QUEUE.md §Restore) stores prefixed ids; the restore path
  picks the backend from the prefix of the row it lands on.

---

## 8. Build order (each phase compiles and is testable alone)

| # | Slice | Sessions | Test |
|---|---|---|---|
| 1 | Id namespace + `service` on `Track` + schema bump + agent id shim | 1 | Apple unchanged; `song:am:…` and bare ids both play |
| 2 | Loopback lifted to `loopback.rs`; Spotify PKCE; Client ID row + guide; refresh | 1 | Sign in, tokens refresh, "Forget Spotify" |
| 3 | `SpotifyProvider`: the 4 trait methods + normalizer; cache rows with `sp` | 1–2 | Library shows Spotify songs with badge; search has both |
| 4 | Account flyout: two rows + "Play matches on" | ½ | Sign in/out both; choice persists |
| 5 | `Backend` split; MusicKit moved with zero regression | 1 | perf lines identical; full hand test |
| 6 | Spotify backend: DRM proof, then play/seek/next, mid-queue switch | 1–2 | Play a Spotify song; a mixed queue crosses services |
| 7 | Capabilities + gating of the ~20 commands; Album Color local fallback | 1–2 | Radio/related hide for `sp`; palette still paints |
| 8 | ISRC merge + two-dot badge + Rewind by merged row + ♥ on preferred | 1–2 | A matched song is one row; plays on the chosen service |

Total ≈ 8–11 sessions. Phases 1–4 are useful on their own (a Spotify library you can
browse). Phase 6 is the gate for the whole thing and should be started early with its DRM
proof even if 5 is not finished.

---

## 9. Service facts (checked 2026-09-15 against Spotify's developer pages)

The §9 list of "verify before build" items was checked on 2026-09-15. Several answers
change §3, §4 and §6. Sources: the Feb 2026 migration guide, the 2026-02-06 and
2026-07-23 developer blog posts, the Redirect URI and Quota modes concept pages, the
Web Playback SDK page, and the Developer Policy.

**Development Mode (the only mode a DeetsMusic user can be in)**

- The app **owner must hold Spotify Premium**; a lapsed Premium stops the app. Because
  each DeetsMusic user is the owner of their own app, **Spotify in DeetsMusic needs
  Premium, full stop** — not only for playback.
- 5 users per app (irrelevant: the owner is the only user). 25 Client IDs per developer
  since 2026-07-23; quota is per developer account; a quota hit is a 429 whose body says
  `"reason": "QUOTA_EXCEEDED"` (distinct from a rate limit).
- Extended quota is for registered companies with 250k MAU. Bring-your-own Client ID is
  confirmed as the only public route.

**Endpoints for apps created after 2026-02-11 (ours)**

- `GET /me/tracks` is gone → **`GET /me/library`** (page size unverified). `PUT/DELETE
  /me/tracks` → `PUT/DELETE /me/library`; `…/contains` → `GET /me/library/contains`.
- Batch `GET /tracks?ids=` etc. are gone; single-item `GET /tracks/{id}` stays.
- `GET /artists/{id}/top-tracks` is gone → the artist view's **Popular** sort hides for `sp`.
- `GET /search`: `limit` max **10** (was 50), default 5.
- Playlists: `/playlists/{id}/tracks` → `/playlists/{id}/items`; the `tracks` field →
  `items`. `POST /me/playlists` creates.
- **Removed response fields:** Track loses `external_ids` (**the ISRC**), `popularity`,
  `available_markets`; `GET /me` loses `product` (**no Premium check by API** — the Web
  Playback SDK's `account_error` event is the only signal) and `email`.
- Player endpoints (`/me/player/*`, devices, transfer) are not in the removed list. The
  Web Playback SDK page is unchanged: Premium required, Chrome/Edge supported, the SDK
  "must not be used in commercial projects without Spotify's prior written approval".
- Apps created before 2026-02-11 keep the old endpoints for now (Spotify postponed that
  cut). Do not design for them.

**Redirect URI**

- `localhost` is refused; `http://127.0.0.1` is allowed, HTTP is fine for loopback.
- **A loopback URI may be registered without a port and the request adds the dynamic
  port.** §4's fixed-port bend is not needed. The guide shows one string to paste:
  `http://127.0.0.1/spotify` (path allowed per the docs' example; confirm on the first
  real sign-in; the fallback is the short fixed-port list).

**Developer Policy (the user is the signatory: it is their app)**

- **III.5:** "Do not create any product or service which is integrated with streams or
  content from another service." This is the clause option B (and A) sits on. Same shape
  as the accepted Apple §7.6 risk; decide it the same way, on the record.
- **II.4.1:** Spotify content must be attributed "by using the Spotify Marks" → the `sp`
  badge must be Spotify's mark, not a theme dot. This closes the first Open item below.
- **II.4.2:** metadata and cover art "must be accompanied by a link back" to Spotify →
  an *Open in Spotify* row in the context menu of every `sp` item (`copy-link.ts` already
  does the Apple equivalent).
- No cache-duration number in the policy text.

**What this reopens (decide before slice 3)**

1. **The merge key.** No ISRC from Spotify means §3's ISRC join cannot run. Options: (a)
   no merge — union with badges, a song in both shows twice, "Play matches on" is dropped;
   (b) an exact normalized key — lowercased title + first artist + duration within 2 s,
   in Rust, no network; (c) an Apple catalog search per Spotify song — 1 call per song,
   rejected on cost.
2. **Popular sort** and **Related** both hide for `sp`; **Radio** stays Apple-only (unchanged).
3. **Premium detection** moves from `GET /me` to the SDK's `account_error` at first play.

## Decisions (closed 2026-09-15)

- **B over A**: both services at once, one merged library. (A = one at a time was the
  cheaper fork, ~5 sessions; rejected.)
- **The Account flyout is the switch**, not a new card and not a Settings-only control.
- **Bring-your-own Spotify Client ID** with an in-app 4-step guide; Apple stays hosted.
- **ISRC is the only merge key.** No fuzzy title/artist matching.
- **Preferred play service** is one global choice, not per song.
- **Gapless across services is out of scope.**

## Open

- Whether the Spotify badge must carry Spotify's own mark (§9, policy).
- Whether a merged row's display fields should be *Apple by default for art* (Apple's art
  templates are higher resolution) regardless of play service. Decide after seeing both.
- Cross-service **Export** (PLAYLISTS.md §6): a local playlist with `sp` rows exported to
  Apple would need an ISRC → Apple catalog lookup per row (`catalog_search` by ISRC works).
  Parked until §8 lands.

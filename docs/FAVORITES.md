# DeetsMusic — Favorites & library writes

> **➕ Add to Library** and a **♥ Favorite**, everywhere a track shows up (Now Playing · Library ·
> Search · Queue). Writes go to Apple via the **add-to-library** endpoint and the **love-rating**
> (`+1`) — using the **Music User Token we already hold** (no new auth). The interesting part is a
> **data-model change**: the moment a user favorites/plays a song that isn't in their library, our
> library-only store has nowhere to put it — so `tracks` becomes a **unified store of every track
> we've touched**. Read with [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (model + cache),
> [SEARCH.md](SEARCH.md) (where catalog tracks enter). Status: ✅ decided · 🔵 open · ⬜ later ·
> ✂️ dropped.
>
> **Two build steps (2026-07-02 direction):** **(1) Add to Library** — the active slice (below).
> **(2) Favorites (♥)** — a **separate, later build step**. **Ratings (👎 Dislike + the thumbs /
> refinement system) are OFF the roadmap** — see [Dropped](#decisions).

---

## What it is

Two account-mutating actions, exposed as **deliberate** controls (never silent — same posture as
the [Playlists export decision](PLAYLISTS.md)):

- **➕ Add to Library** — add a **catalog** resource into the user's iCloud Music Library.
  **The active build step** (gated behind the [Library Add setting](#the-library-add-setting-the-gate)).
- **♥ Favorite** — Apple's **love** rating (`+1`); the 2024 "Favorite ⭐". Feeds Apple's
  recommendations + a generated "Favorite Songs" playlist. **A separate, later build step** — the
  positive signal only. *(Under the hood it's a ratings `PUT +1`, but as a feature it's just ♥ —
  there is no 👎 and no ratings-as-a-system; those are [dropped](#decisions).)*

**Favorite ≠ Add to Library** — independent actions (you can favorite without adding, and vice versa).

### Where the buttons live
- **Add to Library** (active step) — a right-click item on **Search** (song rows + album tiles) and
  **Playlists** (detail song rows), shown only when the track isn't already in the library and only
  while the [Library Add setting](#the-library-add-setting-the-gate) is on.
- **♥ Favorite** (later step) — a dedicated **♥** on Now Playing (filled if loved) + a right-click
  item across Library / Search / Queue. Surfaces TBD when that step is built.
- All are icon/theme-tokened glyphs — no hardcoded colors/sizes.

> **Add-to-Library — ✅ BUILT + user-verified 2026-07-03.** Its own slice **ahead of the separate
> ♥ Favorites step (5b, parked — not next per the user)**, **gated behind the "Library Add" settings toggle**
> (see [§The "Library Add" setting](#the-library-add-setting-the-gate)). Scoped to **Search**
> (song rows + album tiles) and **Playlists** (detail song rows) right-click menus; **Now Playing
> deferred** (own discussion). Built with **fork A** (album adds fetch + graduate their tracks so
> they appear immediately) and a **synthetic `added_rank`** stamp (Unix seconds) so a just-added
> track sorts to the top of Added-Date until the next sync overwrites it. Files: new
> `src/library-add.ts` (flag + invoke + `addSongToLibraryItem`/`addAlbumToLibraryItem`),
> `apple.rs` (`api_post` + `apple_add_to_library`), `library.rs` (`graduate_tracks`), `lib.rs`,
> `index.html` + `main.ts` (the toggle), `search-card.ts` + `playlists-card.ts` (menu wiring).
> Verify-time fix: the already-in-library guard checks **real** membership via the track store
> (`inLibrary(catalogId||libraryId)`), not the presence of a `libraryId` — mirror-playlist tracks
> all carry a relationship id, which had wrongly hidden the action inside added editorial playlists.
> *(A further idea for the add flow is still being thought through — this is the foundation.)*

---

## The "Library Add" setting (the gate)

Add-to-Library is **off by default** and revealed by a settings toggle — **Library Add** — modeled
on the existing **Hover-Menu** / **Always on Top** rows. When **on**, the **Add to Library** item
appears in the right-click menu on catalog tracks; when **off**, it's absent everywhere. The toggle
*is* the deliberate consent: with it enabled, the action itself is frictionless — **silent, no
per-add confirm** (the track just appears in Library). This is the posture that lets Add-to-Library
be one-click without risking accidental account writes, given there's **no remove counterpart**
(see [Risks](#risks--verify)).

### As it looks / works
- **The row.** A `menu__row--toggle` in the settings menu (`index.html`), grouped with **Always on
  Top** / **Hover-Menu**, above **Account**: `role="menuitemcheckbox"`, a `.menu__label`
  ("Library Add") + the `.menu__dot` indicator. Same markup shape as the AOT row.
- **Persistence.** `localStorage["deets.libraryAdd"]` (`"on"` / `"off"`), **default off** — mirrors
  `deets.alwaysOnTop` / `deets.menuMode`. Seeded on launch into `aria-checked`; click flips +
  persists.
- **No live fan-out needed** — the key difference from **Hover-Menu**. Right-click menus are built
  on demand (`menu()` → items), so the flag only has to be **readable at menu-build time**; the
  next right-click reflects any change. Hover-Menu, by contrast, must push `setDropdownMode` to
  every live dropdown instance. So the wiring is just: read the flag when assembling the menu — no
  re-render, no registry.
- **Shared builder.** `addSongToLibraryItem(t)` / `addAlbumToLibraryItem(id, getTracks)` (siblings of
  `addToPlaylistItem` in `playlists.ts`) return the `MenuItem` **or `null`** — `null` when (a) the
  toggle is off, (b) the song is **actually in the synced library** (`inLibrary(catalogId||libraryId)`
  via the track store — **not** the mere presence of a `libraryId`, since a mirror playlist's tracks
  all carry a relationship id even when the song isn't in the library), or (c) there's no catalog id
  (catalog-less uploads can't be added). Callers spread it into their menu array and `.filter(Boolean)`
  drops the null. One home for the gate + the membership check, so no surface can drift.
- **Surfaces (v1).** **Search** song rows + album tiles, and **Playlists detail** song rows.
  Albums add via `ids[albums]` (one call). **Now Playing deferred**; adding a whole **playlist** as
  a library resource is out of scope here (overlaps the mirror).
- **Wiring** mirrors the AOT toggle in `main.ts`: read initial state → set `aria-checked` → on
  click flip + persist + update the module flag. A tiny `src/library-add.ts` owns the flag
  (get/set + persistence), the `addToLibrary` invoke wrapper, and the `addToLibraryItem` builder.

### On success (silent graduation)
On a successful add, flip the track's `source` `'seen' → 'library'` **locally** (materialize first
if we've never seen it) and notify the track store, so the Library card shows it **immediately** —
no full re-sync. Optimistic: on a write failure, roll the local graduation back (don't leave a
phantom library row). Apple assigns the real `library_id` asynchronously; the next `library_sync`
reconciles it.

---

## Apple's write APIs (auth we already have)

- **Ratings:** `PUT /v1/me/ratings/songs/{id}` body `{ attributes: { value: 1 | -1 } }`;
  `GET /v1/me/ratings/songs?ids=…` reads state (batch); `DELETE …/ratings/songs/{id}` clears.
  Works on songs (and albums/playlists/stations). ([ratings docs](https://developer.apple.com/documentation/applemusicapi/))
- **Add to library:** `POST /v1/me/library?ids[songs]={id}` (also `ids[albums]`, `ids[playlists]`).
  ([Add a Resource to a Library](https://developer.apple.com/documentation/applemusicapi/add-a-resource-to-a-library))
- Both require the **developer token + Music User Token** — both already in hand (the MUT reaches
  Rust for these writes exactly like every other `me/*` call). Normalized behind the provider trait;
  the front-end calls a command, never Apple directly.

> **Fuzzy edge to confirm when the Favorites step is built:** the stable documented mechanism is the
> ratings endpoint (love `+1`). Whether Apple exposes a *distinct* "favorites" endpoint separate from
> ratings is unresolved — verify against live docs. The capability (favorite/unfavorite a song/artist,
> read state) is definitely there; the exact route may be `ratings` under the hood.

---

## The data-model change (the heart — "what if the song isn't in our library?")

### The problem
Our `tracks` table is the **library cache** (synced from `/v1/me/library/songs`) — today it holds
only library songs. But a user can **rate / favorite / play a catalog-only song** (from
[Search](SEARCH.md) or a [Station](STATIONS.md)) that has **no row in `tracks`**. Every feedback
table keyed by track id — `play_stats`, the new `ratings`, `station_feedback`, `song_of_day` — would
then reference an id with **no local metadata**, so it can't render in Rewind / a favorites list /
the diary. This gap **already latently exists** for catalog plays; ratings just makes it unavoidable.

### The fix: `tracks` becomes a unified store (your proposal — yes)
Materialize **every track we actually touch**, not just synced library ones:

- **Add `source` to `tracks`** — `'library'` (synced) vs **`'seen'`** (materialized from an
  interaction). Library views query `WHERE source='library'`; **all feedback joins `tracks`
  regardless of source** → metadata always resolves.
- **Materialize-on-interaction, no extra Apple call.** When a non-library track is **played** or
  gets any **feedback/library write**, upsert its **already-normalized `Track`** (from the search
  result, the now-playing item, or the queue handle resolved via [track-store](../src/track-store.ts))
  with `source='seen'`. We already hold the full Track at that moment — it's a **local upsert only**.
- A `'seen'` row **graduates to `'library'`** if the user later adds it (flip `source` on the add /
  next sync).

### Canonical identity — the churn fix (important)
Today the PK is `library_id ?? catalog_id` (**library-first**). That breaks under materialization: a
`'seen'` catalog track keyed by `catalog_id`, once **added to the library**, gains a `library_id` and
would want to re-key — **orphaning its ratings/stats**. Fix by adopting a **catalog-first canonical
key**: `track_key = catalog_id ?? library_id`.
- The [probe](STATIONS.md) showed **99.8% of library songs already carry a `catalogId`** (in
  `playParams`), and catalog/search tracks carry it too — so `catalogId` is a **stable cross-source
  identity** for ~everything; `library_id` is the fallback for the ~0.2% catalog-less items (uploads).
- Result: "rate in Search → later add to Library" lands on the **same row**, feedback intact.
- **Migration** (one-time, mechanical): re-key existing `tracks` + `play_stats` from library-first to
  catalog-first (both ids are present, so it's a straight map). Small, pre-release, low-risk.

### What triggers materialization 🔵
- **Play** (we already fire `record_play`) and **any feedback/library write** (rate, favorite, add,
  song-of-day) — the durable references. **Recommended scope.**
- **Queued-but-never-played** tracks are *transient* (the in-memory track-store already renders them;
  the queue clears) — a durable row isn't needed until one actually plays or gets feedback. So
  "every *played* or *rated* track" (my default) rather than literally every queued one — but
  materializing on queue too is cheap if you'd rather (your call).

### Local favorites mirror (so the ♥ has state) — the later step
A `favorites(track_key, loved, synced_at)` cache so the ♥ renders filled/unfilled instantly without a
per-view GET. Write-through on action (love `PUT +1` + update local); **reconcile** via a batched
`GET …/ratings?ids=` for visible tracks (a ♥ set on the user's phone). Stewardship: batch the reads,
cache, don't poll. *(Belongs to the Favorites build step, not the active Add-to-Library slice.)*

---

## Ties to Stations (why ♥ matters beyond a button)
Because the **Music Genome is gated off** ([STATIONS](STATIONS.md) research), our own stations run on
the signals *we* can collect. With **ratings/👎 off the roadmap** ([Dropped](#decisions)), the
**♥ Favorite** (when that step lands) is the strongest *explicit positive* signal we have — it can
boost a track's neighborhood in **[station generation](STATIONS.md#4c-our-own-station-engine)**.
The **👎 dislike / thumbs-refinement loop** STATIONS once leaned on is **no longer planned**; that
engine will rely on ♥ + play-stats (skips, completion) instead of an explicit thumbs-down.
> ⚠️ **Cross-doc:** STATIONS.md still describes a ♥/👎 thumbs loop as a genome substitute — it needs
> updating to drop the dislike half. Not done here (own edit).

---

## Decisions

**Closed ✅**
- **Two build steps, not one:** **(1) Add to Library** (active) and **(2) Favorites ♥** (separate,
  later). Ratings/👎 are [dropped](#decisions).
- **Add-to-Library — the active slice.** **Gated behind a "Library Add" settings toggle** (default
  off; the Hover-Menu row pattern — see [§The "Library Add" setting](#the-library-add-setting-the-gate)),
  scoped to **Search** (songs + albums) and **Playlists** (detail songs) right-click menus, **Now
  Playing deferred**. Confirm is **silent** — the track appears in Library. Local **seen→library
  graduation** on success (optimistic, rolled back on write failure).
- **No remove-from-library action** — Apple exposes **no public delete endpoint** for library
  resources (add-only); see [Risks](#risks--verify). Add is effectively one-way from the app.
- **Favorites ♥ — a later step**, positive signal only: a love `PUT +1`, a local **favorites mirror**
  (write-through + batched reconcile) for instant ♥ state, ♥ on Now Playing + menus.
- `tracks` becomes a **unified store** (`source` = library | seen); **materialize-on-interaction**
  from the already-normalized Track (no extra Apple call). *(Built — build-queue #3.)*
- **Catalog-first canonical key** (`catalog_id ?? library_id`) across `tracks` + feedback tables;
  one-time migration. Fixes seen→library churn. *(Built — build-queue #3.)*

**Open 🔵**
- **A further idea for the add flow** — being thought through; the [§Library Add setting](#the-library-add-setting-the-gate)
  is the foundation it will extend. *(Capture it here when it lands.)*
- **Library Add default state** — landing **off** (opt-in consent). Revisit if hiding the action
  by default reads as "feature missing."
- **Favorite scope** (Favorites step) — songs only for v1, or also **favorite artists/albums**
  (Apple supports it; natural extension).

**Dropped ✂️ (off the roadmap, 2026-07-02)**
- **👎 Dislike** and the **ratings-as-a-system** framing — no thumbs-down button, no love/dislike
  poles, no dedicated dislike write. The ♥ Favorite (love only) survives as its own step.
- **The thumbs / Pandora refinement loop** as a Stations signal — Stations will use ♥ + play-stats
  (skips, completion) instead. STATIONS.md needs a matching edit (noted above).
- *(The analysis below on the ratings mirror / reconcile is retained as reference for the Favorites
  step — love state only. The dislike research is kept for history but is not planned work.)*

---

## Risks / verify
- **No remove-from-library endpoint (add is one-way).** Apple's public API is **add-only** for
  library resources — there is **no documented `DELETE /v1/me/library/songs|albums/{id}`** (the only
  library-area `DELETE`s are for *ratings*, and an undocumented/unreliable playlist delete). So the
  app **cannot** offer "Remove from Library" / a true undo. A user removing a track in Apple Music
  proper is reflected on the next `library_sync` (the prune drops `source='library'` rows absent
  from the sync set). This is *why* Add is gated (the Library Add toggle) + silent rather than freely
  reversible. Verified 2026-07-02 ([Apple Developer Forums](https://developer.apple.com/forums/thread/107807),
  [API index](https://developer.apple.com/documentation/applemusicapi/)). Matches the Playlists
  mirror being create/append-only.
- **The identity migration** — re-keying `tracks`/`play_stats` to catalog-first; verify no feedback
  rows orphan (the ~0.2% catalog-less library items must still key on `library_id`).
- **Favorite-state drift** (Favorites step) — the mirror is a cache; reconcile with Apple so a ♥ set
  on the phone shows here (and vice-versa). Handle the read being stale gracefully.
- **Exact favorites endpoint** (Favorites step) — confirm love-rating-vs-dedicated-favorites route
  against live docs.
- **Account-mutating writes** — gated + deliberate; an errant auto-favorite would pollute the user's
  real Apple taste + recommendations. Confirm each write is user-initiated.
- **Offline / write failure** — queue the write or surface failure; don't show a filled ♥ for a PUT
  that 500'd (optimistic UI must roll back on error).
- **Store growth** — `'seen'` rows accrue with listening; negligible (~1 KB/Track), but a prune of
  seen rows with zero feedback/stats is an easy later option.

---

## Build notes (file touches)

**Data model — ✅ already built (build-queue #3):** `tracks.source` (library|seen), catalog-first
`track_key` (+ migration), seen→library graduation on sync, and the `materialize_track` command are
all in `library.rs` / `lib.rs`. The Add-to-Library slice builds on top of these.

**Add-to-Library slice (this build):**
- `src-tauri/src/apple.rs` / `provider.rs` — an authed **POST** helper (the existing GET helper at
  `apple.rs` attaches `Bearer {dev}` + `Music-User-Token`; add the POST sibling) + an
  `add_to_library(kind, ids)` provider method → `POST /v1/me/library?ids[songs|albums]={id}`.
- `src-tauri/src/library.rs` — a `graduate_track(track_key)` (flip `source` `'seen'→'library'`,
  materializing first if absent) invoked after a successful add; command wrapper.
- `src-tauri/src/lib.rs` — register `add_to_library` (+ any graduate command).
- `src/library-add.ts` (**new**) — owns the **Library Add** flag (get/set + `deets.libraryAdd`
  persistence), the `addToLibrary` invoke wrapper, and the shared **`addToLibraryItem(get)`** menu
  builder (returns `MenuItem | null`; gate + already-in-library check).
- `index.html` + `src/main.ts` — the **Library Add** `menu__row--toggle` + its wiring (mirrors the
  Always-on-Top toggle).
- `src/search-card.ts` / `src/playlists-card.ts` `menu()` — spread in `addToLibraryItem` for songs
  (+ Search album tiles). Notify the track store on success so Library re-renders.

**Favorites ♥ step (separate, later):** a `favorites` table + `set_favorite`/`get_favorites` (love
`PUT +1` / read); `src/favorites.ts` (mirror + write-through + batched reconcile); the **♥** control
(love only — no 👎) on Now Playing + menus; a "Favorites" styling block (theme roles + skin tokens
only).

**Dropped ✂️ (not planned):** the **👎 Dislike** write, a dislike control, and the ratings-as-a-system
/ thumbs-refinement loop. See [Dropped](#decisions).

# DeetsMusic — Favorites, ratings & library writes

> Dedicated **♥ Favorite** / **👎 Dislike** buttons and **Add to Library**, everywhere a track
> shows up (Now Playing · Library · Search · Queue). Writes go to Apple via the **ratings API**
> (love `+1` / dislike `-1`) and the **add-to-library** endpoint — using the **Music User Token we
> already hold** (no new auth). The interesting part is a **data-model change**: the moment a user
> rates a song that isn't in their library, our library-only store has nowhere to put it — so
> `tracks` becomes a **unified store of every track we've touched**. Read with
> [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (model + cache), [STATIONS.md](STATIONS.md) (ratings
> feed our stations), [SEARCH.md](SEARCH.md) (where catalog tracks enter). Status: ✅ decided · 🔵
> open · ⬜ later.

---

## What it is

Three account-mutating actions, exposed as **deliberate** controls (never silent — same posture as
the [Playlists export decision](PLAYLISTS.md)):

- **♥ Favorite** — Apple ratings **love (`+1`)**. The 2024 "Favorite ⭐" is this love rating; it
  feeds Apple's recommendations and a generated "Favorite Songs" playlist.
- **👎 Dislike** — Apple ratings **dislike (`-1`)** ("suggest less").
- **➕ Add to Library** — add a **catalog** resource into the user's iCloud Music Library.

**Favorite ≠ Add to Library** — independent actions (you can favorite without adding, and vice
versa). Favorite/Dislike are the two poles of one **ratings** mechanism (a native 👍/👎).

### Where the buttons live
- **Now Playing** — a dedicated **♥** (and a **👎**) on the transport card, reflecting the current
  track's live rating state (filled ♥ if loved). The hero surface.
- **Right-click menus** (the [context-menu primitive](UI-ARCHITECTURE.md#4a-the-collection-card-navigable-browser-engine)) on
  **Library / Search / Queue** rows: **Favorite · Dislike · Add to Library** (Add-to-Library shown
  when the track isn't already in the library).
- All are icon/theme-tokened glyphs — no hardcoded colors/sizes.

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

> **Fuzzy edge to confirm at build:** the stable documented mechanism is the ratings endpoint
> (love/dislike). Whether Apple exposes a *distinct* "favorites" endpoint separate from ratings is
> unresolved — verify against live docs. The capability (favorite/unfavorite a song/artist, read
> state) is definitely there; the exact route may be `ratings` under the hood.

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

### Local ratings mirror (so the buttons have state)
A `ratings(track_key, value, synced_at)` cache so the ♥/👎 render instantly without a per-view GET.
Write-through on action (PUT + update local); **reconcile** via a batched `GET …/ratings?ids=` for
visible tracks (ratings can change on the user's phone). Stewardship: batch the reads, cache, don't
poll.

---

## Ties to Stations (why this matters beyond a button)
Because the **Music Genome is gated off** ([STATIONS](STATIONS.md) research), our own stations run on
the signals *we* can collect — and an **explicit ♥/👎 is the strongest one**, far better than
inferred play-stats. So the same ratings power **[station generation](STATIONS.md#4c-our-own-station-engine)**
(♥ → boost that track's neighborhood; 👎 → banish + down-weight) and are the natural, first-class
form of the **[thumbs refinement loop](STATIONS.md#4d-thumbs-feedback--the-pandora-refinement-loop-future)**.
The dedicated buttons *are* the thumbs. (And a station 👎 can, opt-in, also write the Apple dislike —
but ratings are account-global, so keep that explicit, not automatic.)

---

## Decisions

**Closed ✅**
- Three deliberate actions: **♥ Favorite (love +1)** · **👎 Dislike (−1)** · **Add to Library** —
  via the ratings + add-to-library endpoints, over the MUT we already hold; gated, never silent.
- Buttons on **Now Playing** (dedicated ♥/👎) + right-click on **Library / Search / Queue**.
- `tracks` becomes a **unified store** (`source` = library | seen); **materialize-on-interaction**
  from the already-normalized Track (no extra Apple call).
- **Catalog-first canonical key** (`catalog_id ?? library_id`) across `tracks` + all feedback tables;
  one-time migration. Fixes seen→library churn.
- Local **`ratings` mirror** (write-through + batched reconcile) for instant button state.
- Ratings are a **first-class Stations signal** (genome substitute).

**Open 🔵**
- **Materialization trigger** — play + feedback (recommended) vs. also every queued track.
- **Favorite scope** — songs only for v1, or also **favorite artists/albums** (Apple supports it;
  natural extension).
- **Dislike UX** — does a 👎 in the app also skip/remove the track from the current queue, or purely
  record the rating? (Recommend: rating only in v1; skip is a station-mode behavior.)

---

## Risks / verify
- **The identity migration** — re-keying `tracks`/`play_stats` to catalog-first; verify no feedback
  rows orphan (the ~0.2% catalog-less library items must still key on `library_id`).
- **Ratings-state drift** — the mirror is a cache; reconcile with Apple so a ♥ set on the phone shows
  here (and vice-versa). Handle the read being stale gracefully.
- **Exact favorites endpoint** — confirm ratings-vs-dedicated-favorites route against live docs.
- **Account-mutating writes** — gated + deliberate; an errant auto-favorite would pollute the user's
  real Apple taste + recommendations. Confirm each write is user-initiated.
- **Offline / write failure** — queue the write or surface failure; don't show a filled ♥ for a PUT
  that 500'd (optimistic UI must roll back on error).
- **Store growth** — `'seen'` rows accrue with listening; negligible (~1 KB/Track), but a prune of
  seen rows with zero feedback/stats is an easy later option.

---

## Build notes (file touches)
- `src-tauri/src/library.rs` — `tracks` gains `source`; adopt the catalog-first `track_key`
  (+ migration); a `ratings` table; `set_rating` / `get_ratings` / `add_to_library` /
  `materialize_track` commands (model on `record_play`).
- `src-tauri/src/apple.rs` / `provider.rs` — provider methods: `set_rating`, `get_ratings` (batch),
  `add_to_library`.
- `src-tauri/src/lib.rs` — register the commands.
- `src/now-playing-card.ts` — the ♥/👎 controls + live rating state.
- `src/library-card.ts` / `src/search-card.ts` / `src/qcard.ts` `menu()` — the Favorite / Dislike /
  Add-to-Library actions.
- A small `src/ratings.ts` (mirror + write-through) feeding all surfaces; styling under a "Favorites"
  block in `styles.css` (theme roles + skin tokens only).

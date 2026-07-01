# DeetsMusic — Stations (radio) & audio-feature enrichment

> Two ways to get an endless stream: **Apple's stations** (opaque, server-fed) and **our own
> stations** (generated over our library from metadata + derived audio features). Plus the
> **Deezer enrichment provider** that supplies the BPM our own stations run on. Read with
> [QUEUE.md](QUEUE.md) (the queue model this bends), [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md)
> (provider trait + cache), [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) (the card system).
> Status: ✅ decided · 🔵 open (my proposal unless you red-line) · ⬜ later.

---

## 0. Two kinds of station, one playback mode

| | **Apple station** | **Our own station** |
|---|---|---|
| Source | Apple's servers | our library (later: + catalog) |
| The future | **opaque** — one track at a time, no visible Up Next, no reorder | **ours** — a generator refills `upcoming`; fully inspectable + reorderable |
| Feature control | none (can't steer by BPM/key/era) | full (BPM band, genre, era, artist, play-stats) |
| Offline | no | yes (library + cached features) |
| Effort | low | medium (needs the feature pipeline) |
| Fits our model | **poorly** (see §2) | **natively** (it's just a generated context) |

Both present to the user as **"radio mode"** — an endless now-playing stream — but they're two
engines behind one façade. Our own stations fit DeetsMusic's architecture far better; Apple's
are the quick win and the source of *seeded* radio ("start a station from this song").

---

## 1. "Radio mode" — the shared playback state

The queue model ([QUEUE.md](QUEUE.md)) assumes **we own the full plan** (`history / current /
upcoming`, windowed into MusicKit). A station breaks one half of that: the **future is not a
fixed list**. So radio mode is a `PlayerMode = "queue" | "radio"` flag on the player:

- **History still works normally.** The **heard trail** (`played: true`) keeps growing as
  tracks advance, so **Previous**, recently-played, and **play-stats** ([DEETS-REWIND](DEETS-REWIND.md))
  are unaffected — radio doesn't touch the durable trail.
- **`upcoming` is either opaque (Apple) or generator-fed (ours).** For Apple stations it's
  empty/one-lookahead; for our own it's refilled by a generator (§4).
- **Entering radio** parks the current finite queue's *unheard* plan (same disposal rule as a
  new context) and sets `mode = "radio"`. **Exiting** (playing any finite context again, or
  "Stop station") drops back to `mode = "queue"`.
- **Transport capabilities vary and must be reflected in the UI:**
  - **Live radio** (Apple Music 1): no seek, no skip, no duration → hide scrubber, disable
    prev/next, show a "LIVE" badge.
  - **On-demand stations** (personal/genre/ours): skip-forward allowed; Previous walks our
    heard trail; scrubber works per current track.
- **Manual queueing interplay** 🔵 — inserting a "Play Next" mid-station. Proposal: a manual
  insert **breaks out of radio** into a normal finite queue seeded with `[current, inserteds…]`
  (Apple can't accept inserts anyway). Alternative: disable manual queueing while a station
  plays and offer only "Stop station." Recommend the break-out.

---

## 2. Apple stations

### Types
1. **Live radio** — Apple Music 1 / Hits / Country (`isLive: true`).
2. **Personal Station** — `…/stations?filter[identity]=personal` (the user's own).
3. **Genre / mood** — curated catalog stations (`/v1/catalog/{sf}/stations`, browse by
   `/v1/catalog/{sf}/station-genres`).
4. **Seeded** — "Create Station from this song/artist/album."

### Player wiring
- `playStation(stationId)` in `player.ts`: set the MusicKit queue to the station, `play()`,
  set `mode = "radio"`, park the finite queue.
  - 🔎 **VERIFY (load-bearing):** the exact **MusicKit JS** call to queue a station. Native
    MusicKit has `setStationQueue`; MusicKit JS is expected to accept a station via the queue
    descriptor (e.g. `music.setQueue({ station: id })` or the station's `playParams`). Since our
    whole player is MusicKit JS in WebView2, **prove this on a throwaway before speccing the card
    deeper** — same discipline as the original DRM risk.
- **Model-follow in radio:** on `nowPlayingItemDidChange`, append the *previous* now-playing to
  the heard trail and set the new `current`; **do not** try to reconstruct `upcoming`
  (`syncModelToMusicKit`'s window-walk is a no-op in radio — guard it on `mode`).
- **Capabilities:** read the station's attributes for `isLive` / skip allowance and drive the
  transport enable/disable + scrubber visibility above.

### Seeded stations = a context-menu action (fits what we have)
Add **"Start Station"** to the existing right-click menus (library song / artist / album — the
`menu()` grouping accessor, [UI-ARCHITECTURE §4a](UI-ARCHITECTURE.md)). It resolves the seed to
an Apple station (from the entity's `playParams`/station kind) and calls `playStation`. Zero new
UI surface — it rides the context-menu primitive we already ship.

---

## 3. The Station card(s)

Two distinct jobs — keep them separate:

**(a) The Stations browser** — a launcher, built as a **collection-card context** (reuses the
engine, [UI-ARCHITECTURE §4a](UI-ARCHITECTURE.md)) so it's a registry card the slot picker can
mount. Sections: **Live Radio · For You (personal) · Genre & Mood · Recently played (local)**
and later **My Stations** (our own, §4). Rows show station art + name + tagline + a LIVE badge;
`activate(station)` → `playStation`. Stations are leaves (no drill), or a genre drills into its
station list. The **View** pill auto-hides (no density needed) — the engine already does this
when grouping/density aren't meaningful.

**(b) The radio-mode display** — while a station plays, the **Qcard** enters radio mode: title
becomes `📻 <Station name>`, the body shows the current track + a "Up next chosen by <station>"
note instead of an editable list (Apple) *or* the generated Up Next (ours — which stays fully
editable), plus a **Stop station / Back to queue** affordance. 🔵 Reuse the Qcard (recommended —
it's already the now-playing/queue surface) vs. a dedicated Station card.

---

## 4. Deezer enrichment + our own stations (the payoff)

### 4a. Deezer is an *enrichment* provider, not a playback one
We can't play Deezer audio in an Apple-licensed app — **playback stays MusicKit**. Deezer joins
purely as a **metadata source for audio features**, which fits our provider-agnostic model
(Rust `MusicProvider` trait, [DATA-ARCHITECTURE](DATA-ARCHITECTURE.md)) — the same seam the
`isrc`-carrying second-provider note anticipated.

> **⚠️ Library probe (2026-07-01) — the ISRC premise needs a catalog hop.** A count over the
> live cache (3,717 songs) found **0 with an ISRC**: the library sync pulls Apple's *library*
> endpoint, and ISRC is a *catalog* attribute, so it's never in that payload. But **99.8%
> (3,708) carry a catalog ID**, so ISRC is fully **recoverable** via catalog fetch — and the
> batch catalog-songs endpoint (`?ids=` up to ~300/call) backfills the *whole* library's ISRCs
> in **~13 calls**. Key consequence: **both BPM paths require a catalog fetch first** — Deezer
> needs the ISRC, preview-analysis needs the preview URL, and *neither* is on the library
> object. That catalog fetch is the **same one** that carries the album **palette**
> ([ALBUM-COLOR](ALBUM-COLOR.md)) and the 30s **previews** — so build the lazy
> catalog-enrichment layer (roadmap #7) once, as the shared substrate for album color + ISRC→BPM
> + preview-analysis.

- **Lookup by ISRC** (obtained via the catalog hop above — *not* present in the library cache):
  `GET https://api.deezer.com/track/isrc:{isrc}` — **free, no auth, no key**.

Deezer offers three station-relevant buckets — only the first is "audio features":

1. **Per-track attributes** (`/track/{id}` or the ISRC lookup) — the *enrichment* role:
   **`bpm`** (tempo, the headline signal), **`gain`** (loudness, a rough energy proxy),
   **`rank`** (popularity — bias toward hits or deep cuts), plus `isrc`, `preview`,
   `explicit_lyrics`, duration, artist/album.
2. **Similarity & discovery** — the *discovery* role: `/radio/{id}` · `list_radios` ·
   `/radio/top` (editorial mixes), `/chart?genre_id=` (top per genre), and (raw REST, **verify
   the exact path**) `/artist/{id}/related` (related-artist graph) + `/artist/{id}/radio` (a
   similar-track flow) — the natural "more like this artist" source.
3. **Advanced search filters** — **`bpm_min` / `bpm_max`** (+ `dur_min`/`dur_max`): pull catalog
   tracks *directly* in a tempo band.
- **The hard limit:** Deezer gives **no key, energy, danceability, valence, or mood**. "Similar"
  = artist-graph + editorial radio + genre + BPM band + popularity — **not audio-content
  similarity.** True "sounds-like" needs local **preview-analysis** embeddings (Essentia.js/WASM),
  which would also give **key** for harmonic mixing — a later thing.
- **Caveats to design around:** BPM coverage is **partial** (many tracks return `bpm: 0`/missing);
  values are occasionally wrong (halved/doubled tempo); ISRC match is exact when present, else a
  fuzzy title+artist search; **rate-limited** (~50 req / 5 s unauth) — so **throttle + batch +
  cache**, matching our "minimize API calls" ethos.

### 4b. Where features live in the model
Keep the normalized `Track` **clean** — features are enrichment, not identity (mirrors how the
album **palette** is a separate per-cover cache, [ALBUM-COLOR](ALBUM-COLOR.md)):

- New SQLite table `track_features(isrc PK, bpm, gain, source, fetched_at)` (add `key`, `energy`
  columns later if preview-analysis lands). Keyed by **ISRC** (per recording).
- An in-memory index + `getFeatures(track)` accessor (like `track-store`); optionally
  denormalize `bpm?` onto the live in-memory `Track` once loaded, for convenience.
- **Demand-driven + cached**: enrich when a station build (or a track-detail view) needs it,
  never a batch pre-pass — same doctrine as palette/artist-photos (roadmap #7).

### 4c. Our own station engine
This is where owning the queue pays off. An own-station is **just a context whose `upcoming` is
generated and continuously refilled** — it plugs straight into the existing auto-tail +
**re-windowing top-up** ([QUEUE.md](QUEUE.md) §Windowing / roadmap #3): when playback nears the
end of `upcoming`, call the generator for the next batch instead of loading more of a fixed list.

- **A station = `{ seed, scope, rules }` → a generator** drawing on: **BPM** (Deezer/preview),
  **genre** (`Track.genreNames`), **artist** similarity, **release era**, **play-stats**
  (never-heard / recently-played), and — strongest of all — **explicit ♥/👎 ratings**
  ([FAVORITES.md](FAVORITES.md)): a conscious taste signal, and our **best substitute for the gated
  Music Genome** (♥ boosts a track's neighborhood, 👎 banishes it).
- **`scope` is a first-class, user-chosen parameter** — library-only is an **option**, not a
  constraint (per your call). Every station recipe can run in either scope, and Deezer plays a
  *different role* in each:
  - **`scope: "library"`** — "play similar songs **within my library**." Candidate pool = the
    user's library; Deezer is used purely as an **attribute source** (enrich library tracks with
    `bpm`/`gain`/`rank`, optionally rank library artists against the seed via `/artist/related`),
    then we filter/order **our own songs**. *No Deezer track needs to be playable* — we only
    borrow numbers. Cheap, offline-friendly once enriched.
  - **`scope: "catalog"`** — reach **beyond** the library. Pool = Deezer discovery
    (radio/related/`bpm_min-max` search) → candidate tracks → **map back to Apple by ISRC** →
    play via MusicKit. Deezer is the **discovery engine**, Apple is playback. (Filter to tracks
    that actually exist in Apple's catalog — not every Deezer ISRC maps.)
- **Recipes** (seeds), each runnable in either scope: *Workout* (BPM 160–175), *Chill* (BPM <
  100), *More like this artist/song*, *Deep cuts I haven't heard* (library + play-stats),
  *Time machine* (era). Tempo recipes are the ones Deezer's BPM unlocks.
- **Ship order** 🔵 — **`library` scope first** (needs only enrichment + our in-memory library;
  zero discovery plumbing, works offline), **`catalog` scope second** (needs Deezer discovery +
  the ISRC→Apple mapping, and leans on the Search/catalog path, roadmap #4). Recommend that
  sequence; both are the goal.
- Own stations surface in the Stations browser under **My Stations**, are **fully editable**
  (they're our normal `upcoming`), and can be **saved** as a recipe.

### 4d. Thumbs feedback — the Pandora refinement loop (future ⬜)

Pandora's magic is the **thumbs loop** (👍 = more like this · 👎 = banish + avoid similar). We can't
have its **Music Genome** (a trade secret, never exposed) or its cross-user data — but the
*interaction* is ours to take, because **in our world thumbs is a local rule-steering loop, not
collaborative filtering.**

> **"But we don't maintain a catalog across users" — correct, and we don't need to.** Thumbs only
> ever reshapes selection over pools we **already access per request**:
> - **`scope:"library"`** — the pool *is* the user's own library, **fully cached locally**. Thumbs
>   reweights selection *within it*. No external/shared catalog involved at all.
> - **`scope:"catalog"`** — the pool is **live discovery** (Deezer related/radio + Apple catalog
>   search + Apple recommendations), queried per station. Thumbs steers which seeds we pursue and
>   which we drop. We never *store* a catalog — we query one on demand and forget it.
>
> So the only thing we persist is **feedback, not a catalog**: a tiny local
> `station_feedback(track_id, seed, verdict, ts)` table (per-user, keyed to our own ids, sibling to
> `play_stats`). *That's* the "memory" — a taste weighting future stations read, not a music database.

**What each verdict does to the generator's rules/weights:**
- **👎 down** — drop the track from this station now; **down-weight its neighborhood** (artist /
  sub-genre / BPM band / era) for the session; optionally a persistent per-seed blocklist. *This half
  is high-value and reliable* — "never this / less like this" is easy to honor locally.
- **👍 up** — **boost the shared signals** (artist / genre / BPM / era), pull the artist + its
  Deezer-related artists into the pool, persist a soft "like." *This half is only as good as our
  similarity signals* (genre + Deezer artist-graph + BPM) — coarser than Pandora's genome, but a real
  lift over static rules.

**Optional Apple bridge (with a caveat).** For `scope:"catalog"` stations we *could* also write the
thumb to Apple's **ratings API** (love `+1` / dislike `-1`) to borrow **Apple's own recommender**.
But ratings are **account-global and persistent** — a *station-scoped* thumb shouldn't silently
reshape the user's whole Apple taste. So: **local-first by default**, "also tell Apple Music" as an
explicit opt-in. (Same account-mutating-write caution as the [Playlists export](PLAYLISTS.md) and
Add-to-Library decisions.)

Related taste signals already in the app — `play_stats` (behavioural), **♥/👎 [ratings](FAVORITES.md)**
(explicit — and the app's **dedicated Favorite/Dislike buttons** *are* the thumbs), and
[Song of the Day](DeetsOTD.md) (curated) — feed the *same* weighting; thumbs is the **in-station
expression** of one shared taste model.

---

## Decisions

**Closed ✅**
- Two engines, one "radio mode" façade; radio keeps the heard trail (Previous/stats intact),
  only the *future* differs.
- Apple stations: 4 types; seeded stations = a context-menu action; transport/scrubber reflect
  live-vs-on-demand capabilities.
- Station card split into **browser (launcher)** + **radio-mode display**.
- Deezer = **enrichment-only** provider (playback stays MusicKit); features in a **separate
  cache** (Track stays clean), demand-driven + throttled + cached. Gives **BPM/gain/rank** +
  discovery endpoints (radio/related/chart) + **`bpm_min-max` search**; **no key/energy** (that's
  preview-analysis, later).
- Our own stations fit the queue model natively (generator refills `upcoming`).
- **Own stations take a user-chosen `scope`**: **`library`** (similar songs *within* the user's
  library — Deezer as attribute source) and **`catalog`** (reach beyond — Deezer as discovery,
  ISRC-mapped to Apple for playback). Library-only is an **option, not a constraint** — both ship.

**Open 🔵**
- Manual-queue interplay during a station: **break out to a finite queue** (recommended) vs.
  disable inserts.
- Radio-mode display: **reuse the Qcard** (recommended) vs. a dedicated card.
- Own-station **ship order** (scope itself is decided — both `library` and `catalog` are the
  goal): **`library` scope first, `catalog` second** (recommended) vs. both at once.
- BPM source order: **Deezer-by-ISRC first, preview-analysis fallback** (recommended) — or skip
  Deezer and go straight to preview-analysis for full control (no coverage gaps, no third party,
  but more work + gives key too eventually).

---

## Risks / verify
- **MusicKit JS station playback** (§2) — the load-bearing unknown; prove it on a throwaway
  before building the card, exactly like the DRM risk.
- **Infinite queue + windowing** — an own-station's generator must top up `upcoming` before the
  window edge or playback dead-ends; reuses `reconcileUpcoming`/re-window (roadmap #3).
- **Radio Previous** — walking back into the heard trail during an Apple station may require
  re-requesting tracks Apple won't replay; on-demand only, and library-resident tracks replay
  fine.
- **Deezer coverage/accuracy + rate limits** — cache aggressively; tolerate missing/zero BPM
  (a track with no tempo simply isn't eligible for a tempo recipe); sanity-clamp obvious
  half/double-tempo errors.
- **Model purity** — features must not leak hexes/DSP into the normalized `Track`; keep the
  `track_features` cache separate (doctrine parallel to the palette cache).

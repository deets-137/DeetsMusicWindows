# DeetsMusic — Stations (radio) & audio-feature enrichment

> **✅ RADIO CARD COMPLETE (2026-07-03).** The Radio card (Apple's live / My Station /
> Discovery / genre stations) and the full radio-mode playback wiring are **built + user-
> verified**: stations play, the break-out swap works, transport caps + LIVE marker are wired,
> and station plays populate History/Rewind durably. Remaining Apple-station work is **one
> follow-up**: the seeded **right-click "Start Station"** verb (song/artist → its station) —
> **next build session** — plus the search-card stations section. The **own-station engine
> (§4) is dropped**; Deezer/§4 text is research-record only.
>
> Original framing (kept for context): two ways to get an endless stream — **Apple's stations**
> (opaque, server-fed) and ~~our own stations~~ (dropped). Read with [QUEUE.md](QUEUE.md) (the
> queue model this bends), [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (provider trait + cache),
> [SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) (the card system).
> Status: ✅ decided/built · 🔵 open · ⬜ later.

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

> **🗑 2026-07-03 — the own-station engine is DROPPED.** Apple's curated + personalized
> stations are the whole radio story ("Apple curated is perfect"). The right column of the
> table above, §4 (Deezer enrichment, generator, scope, thumbs), and the "My Stations" shelf
> are retired; §4's text stays below purely as research record (Deezer findings, the ISRC
> probe). **Ripple:** [DeetsWeather.md](DeetsWeather.md) was premised on the own-station
> engine — its recipe needs a rethink (Apple-station/playlist-picking instead of generation)
> if it's ever picked up.

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
  - **On-demand stations** (Discovery/genre/ours): skip-forward allowed; Previous walks our
    heard trail; scrubber works per current track.
- **Manual queueing interplay** ✅ (2026-07-03) — a manual insert **breaks out of radio at the
  song boundary**: the block lands in the model only, the Qcard shows it as editable Up Next,
  and when the current station song ends the block takes over as a normal finite queue. The
  boundary swap is fiddly (MusicKit's continuous/station controller fights a naive rebuild):
  it's **deferred a macrotask out of the `nowPlayingItemDidChange` handler**, then loaded with
  **`stopFirst` + `noBack`** — a full `stop()` of the station controller (a mere pause leaves
  it primed to advance, and that advance AbortErrors our `setQueue`, leaving the station's next
  song playing under a model already moved to the block) and the block placed at **index 0**
  (skips the `changeToMediaAtIndex` that also raced the transition). The station's next song
  may sound for a beat while it buffers. Starting a station
  disposes manual picks too (an explicit departure — keeping them would trigger an instant
  break-out). [FUTURE-SETTINGS §17](FUTURE-SETTINGS.md): optionally resume the station when
  the block ends (default: stop).

---

## 2. Apple stations

### Types
1. **Live radio** — Apple Music 1 / Hits / Country / Música Uno / Club / Chill
   (`isLive: true`; the whole lineup is one `filter[featured]=apple-music-live-radio` call).
2. **Personalized** — Apple ships exactly two, and we surface both on the For You shelf
   (✅ 2026-07-03), My Station first (Apple's own ordering):
   - **My Station** ("&lt;Name&gt;'s Station" — heavy rotation of known taste, `ra.u-…`):
     the cleanly documented one, `…/stations?filter[identity]=personal` (needs the MUT).
   - **Discovery Station** (new music, `ra.q-…`): **no documented filter exists** — it
     surfaces inside `/v1/me/recommendations`, so we scan every recommendation's contents
     for station resources and pick the `ra.q-` one (name-match fallback).
   Either one absent (or its per-user endpoint hiccuping) just hides its row — never a
   card failure.
3. **Genre / mood** — curated catalog stations (`/v1/catalog/{sf}/stations`, browse by
   `/v1/catalog/{sf}/station-genres` → each genre's `stations` relationship).
4. **Seeded** — "Create Station from this song/artist/album."

### Player wiring — ✅ built 2026-07-03 (core batch; first-click probe pending)
- `playStation(station)` in `player.ts`: dispose the plan (manual picks included), set
  `mode = "radio"`, feed MusicKit the station, `play()`, record the recents row.
  - 🔎 **Descriptor probe** (`setStationQueue`): tries `{ station: id }` → `{ stations: [id] }`
    and diag-logs which took (`player:stationQueue` / `…Fail`). The speculative `{ url }` shape
    was **removed** — it made MusicKit throw internally ("s is not a constructor", surfaced as a
    dialog). Stations confirmed queuing/playing 2026-07-03 (live + on-demand); the exact winning
    shape is in the `player:stationQueue` log.
- **Model-follow in radio** (`stationFollow`): on `nowPlayingItemDidChange`, the new item is
  ingested through the standard funnel (transient + durable 'seen' row → Qcard/History/Rewind
  all resolve) and `queue.appendCurrent` grows the heard trail; `stats.recordStart` +
  `recordProgress` log the durable play/event (keyed by catalog id) so **station plays are
  revisitable across restarts**. Gate: skip only the station **container** item (`ra.…`) —
  NOT on kind/type. (An early `kind.includes("song")` check silently dropped every station
  play from history, because station-fed song items don't always report `kind:"song"` like
  library songs; `player:stationFollow` diag logs type+kind for visibility.) All window
  machinery (`syncModelToMusicKit`, top-up, `reconcileUpcoming`, alignment canaries) is guarded
  on `mode`; any finite-window load exits radio in one place (`doLoadFromModel`).
- **Capabilities:** `PlayerState.station = { name, live }`; live → the NP card swaps the
  scrubber for a LIVE marker (`--stop` role, same slot so the strip keeps height) and disables
  prev/next. On-demand: next = native station skip; **Previous is restart-only in v1** (no
  backward walk — Apple may refuse replays).
- **Stop Station** (`stopStation`): exit radio, `stop()` + `clearQueue()` where available
  (`clearQueue` is UNSUPPORTED for continuous playback — swallowed quietly; `stop()` already
  halts the stream); heard trail stays, transport goes idle.
- **MusicKit transport-race filter** (`installMusicKitRejectionFilter`): the break-out swap
  makes MusicKit re-issue `play()` on its own internal (un-awaited) promise chains, surfacing
  benign "Uncaught (in promise)" races we can't try/catch — `play() without a previous
  stop()/pause()` and the `interrupted by a new load request` AbortError. A scoped
  `unhandledrejection` handler swallows **exactly** those two messages (logged to diag);
  everything else propagates, and our own awaited calls still surface normally.

### Seeded stations = a context-menu action (fits what we have)
Add **"Start Station"** to the existing right-click menus (library song / artist / album — the
`menu()` grouping accessor, [UI-ARCHITECTURE §4a](UI-ARCHITECTURE.md)). It resolves the seed to
an Apple station (from the entity's `playParams`/station kind) and calls `playStation`. Zero new
UI surface — it rides the context-menu primitive we already ship.

---

## 3. The Station card(s)

Two distinct jobs — keep them separate:

**(a) The Stations browser** — ✅ **built 2026-07-03 (browse-first)** as the **Radio card**
(`src/radio-card.ts` + `src/radio.ts` data layer; Rust commands `radio_live` / `radio_discovery`
/ `radio_genres` / `radio_genre_stations` in `apple.rs`). It rides the collection-card engine
([UI-ARCHITECTURE §4a](UI-ARCHITECTURE.md)) with one root grouping over a **heterogeneous shelf
list** (header / station / genre rows — headers exist only in **Featured(↑)** order; an A–Z sort
or a search query flattens the pane to plain deduped rows, via the engine's `list(view)` state).
Shelves: **Recently Played (local, hidden when empty) · For You (My Station + Discovery) ·
Live · Genres**. Rows show station art + name + tagline (genres get
round initial thumbs); the full **Sort · View · Search** trio applies (Featured/A–Z ×
lines/small/large — headers span grid rows). No LIVE chip on rows (✅ 2026-07-03: redundant
under the Live shelf — live-ness resurfaces as the radio-mode transport's LIVE state, §1). A
genre drills (pane-slide) into its lazily fetched station list. Everything is **session-cached** (`radio.ts` module scope — a slot remount
costs zero Apple calls; header ⟳ drops the cache); recents live in `localStorage`
(`deets.radio.recents`, cap 6) via `recordStationPlay`, which the wiring batch will call.
`activate(station)` is a **stub** until `playStation` lands — build order (✅ your call
2026-07-03): **card first, MusicKit probe + wiring after**, which is also when the seeded
"Start Station" context-menu verb and search-card stations turn on. Engine polish that rode
along: the **Sort pill auto-hides** when no grouping offers >1 sort (mirrors the View pill).

**(b) The radio-mode display** — 🔵 **deferred to a dedicated UX pass** (2026-07-03). A first
cut (station banner + Stop Station + "Up next chosen by Apple Music" in the Qcard) was built
and then **reverted** — the user wants to design the whole "what the now-playing/queue surface
does while a station plays" experience holistically first. So today the Qcard renders
**normally** during a station (Now Playing + an empty/edit-only Up Next). Consequences to
resolve in that pass: **Stop Station currently has no button** (`stopStation()` exists in
player.ts, unwired) — you leave a station by playing anything else or by a break-out; and the
LIVE treatment currently lives only on the **Now Playing card** (scrubber→LIVE marker, skip
disabled), which the user kept. Note for the pass: the panel title can't simply become
`📻 <name>` — it's the slot-picker trigger, so station identity needs its own slot.

---

## 4. Deezer enrichment + our own stations — 🗑 DROPPED 2026-07-03 (kept as research record, see §0 note)

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
- **(2026-07-03) Apple-only radio: the own-station engine (§4) is dropped** — "Apple curated
  is perfect." Both personalized stations ship on For You: **My Station** (documented filter)
  above **Discovery** (recommendations scan, `ra.q-` id + name fallback); either row hides
  gracefully. Shelf order: Recently Played · For You · Live · Genres.
- **(2026-07-03) Browser ships browse-first** — the Radio card is built with `activate` stubbed;
  the MusicKit station-queue probe gates the *wiring* batch (playStation + radio mode + seeded
  "Start Station" menu verb + search-card stations), not the card.
- Station card split into **browser (launcher)** + **radio-mode display**.
- 🗑 *(dropped with §4, 2026-07-03)* Deezer = enrichment-only provider; own stations fit the
  queue model natively; own-station `scope` (`library`/`catalog`). Kept for the record only.

- **(2026-07-03) Core wiring built + verified**: stations play (live + on-demand); break-out at
  the **song boundary** (`stopFirst`+`noBack` clean swap; [FUTURE-SETTINGS §17](FUTURE-SETTINGS.md)
  = optional station resume); Previous restart-only in radio v1; **station plays populate
  History/Rewind** durably (the `stationFollow` gate skips only the `ra.` container, not on
  kind); benign MusicKit transport-race rejections are filtered. Radio-mode Qcard face was
  reverted — a **dedicated radio now-playing/queue UX pass** is deferred (§3b), which also owns
  Stop Station's home (`stopStation()` exists, currently unwired to any button).
- **Remaining Apple-station work — NEXT SESSION**: seeded **right-click "Start Station"** on
  song/artist (resolve the entity's `station` relationship → `playStation`) + the search-card
  stations section. That's the last of the Apple-radio line.

**Open 🔵**
- ~~Manual-queue interplay~~ / ~~radio-mode display~~ — ✅ closed above (2026-07-03).
- ~~Own-station ship order~~ / ~~BPM source order~~ — 🗑 moot (own-station engine dropped).

---

## Risks / verify
- **MusicKit JS station playback** (§2) — the load-bearing unknown; the card shipped
  browse-first, so this probe now gates the *wiring* batch.
- **Radio Previous** — walking back into the heard trail during an Apple station may require
  re-requesting tracks Apple won't replay; on-demand only, and library-resident tracks replay
  fine.
- **Discovery Station placement** — its recommendations-scan is undocumented; if Apple
  reshuffles `/v1/me/recommendations`, the row hides (graceful) — check the `ra.q-` scan first.
- 🗑 *(dropped with §4)* infinite-queue windowing, Deezer coverage/rate limits, feature-cache
  model purity.

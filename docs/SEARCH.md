# DeetsMusic — Search card (catalog search)

> A midi content card that searches **Apple Music's catalog** — songs · albums · playlists ·
> stations (music videos skipped) — with a search bar and right-click **queue** actions. This is
> roadmap **#4**. It **reuses the [collection-card engine](UI-ARCHITECTURE.md#4a-the-collection-card-navigable-browser-engine)**
> (drill-in, play-on-click, right-click menus, pane-slide nav come for free) — the one new muscle
> is a search bar that drives a **server query** instead of a client-side filter. Siblings:
> [STATIONS.md](STATIONS.md) (station results + radio playback), [PLAYLISTS.md](PLAYLISTS.md)
> (playlist model), [QUEUE.md](QUEUE.md) (the enqueue path), [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md)
> (provider/model/storefront). Status: ✅ decided · 🔵 open · ⬜ later.

---

## What it is & where it fits

The Library card browses **your synced library** (client-side). The Search card browses the
**whole catalog** (server-side): the user types, we query Apple, and results normalize into our
model — **catalog objects**, carrying real art, **previews (30s)**, **ISRC**, and **palette** for
free (so Search doubles as a lazy-enrichment source; see [roadmap #7](HANDOFF.md) / the
[Album-Color](ALBUM-COLOR.md) + [Stations](STATIONS.md) data paths). It's also the **discovery
surface** that a `scope:"catalog"` [own-station](STATIONS.md#4c-our-own-station-engine) leans on.

> **Search *card* ≠ the Search *pill*.** The Library card's toolbar has a **Search pill** that
> slides down an inline bar and **filters the already-loaded list** (client-side substring). The
> Search **card** is different: its bar is **always-on** and drives a **catalog API query**. Don't
> conflate them — the card does *not* use the client-side Search pill.

---

## Categories ✅

Query these five Apple `types`, presented as a **category selector** (a pill row under the bar):

**Songs · Albums · Artists · Playlists · Stations** — `types=songs,albums,artists,playlists,stations`.

- **Skip music videos** ✅ — never request `music-videos`.
- **Artists** ✅ — a full category: an artist result **drills into their albums + top songs**, like
  Library's Artist context (catalog fetch for the artist's releases; the artist **photo** rides the
  catalog object for free — no separate lookup).

Each category maps to a **collection-card grouping** (exactly how Library switches
Songs/Albums/Artists), so the selector *is* the engine's grouping control — minimal new code.

---

## The search flow

```
search bar (always-on)  ──debounce──▶  provider.search(term, types)  ──normalize──▶
   results per category  ──▶  the engine renders the selected category's grouping
```

- **Debounced, metered** ✅ (stewardship): fire on a **~300 ms** debounce, **min 2 chars**, and
  **cancel the in-flight request** when the term changes — no per-keystroke calls. Optionally cache
  the last few terms in-session.
- **Storefront** (prerequisite): catalog search is `/v1/catalog/{storefront}/search`. Fetch the
  user's storefront once (`/v1/me/storefront`) and **cache** it (rarely changes); the provider
  needs it for every catalog call — Search, and later enrichment, share it.
- **The API:** `GET /v1/catalog/{sf}/search?term=…&types=songs,albums,artists,playlists,stations&limit=25`.
  Response is a `results` object keyed by type, each `{ data[], href, next }` for **pagination**
  (load-more as the user scrolls a category). Normalize in Rust to `Track` / `Album` / `Artist` /
  `Playlist` / `Station` (playlists/stations per [PLAYLISTS](PLAYLISTS.md) / [STATIONS](STATIONS.md);
  add the normalized types if absent). **Front-end only ever sees our model**, never raw Apple shapes.

### Presentation ✅ (decided 2026-07-01 — user call, supersedes the pill-row MVP)
**Blended sectioned results**: a single scrolling body of **vertical sections divided by a
bar — Artists first, then Songs, then Albums, then Playlists** — each section a **horizontal
scroller ~2 rows tall** (Apple-Music-mobile style: e.g. songs as h-scrolling columns of 2,
artists as round thumbs, albums as tiles). A **filter control next to the search bar** lets the
user narrow which categories are searched (default: all; narrowing also trims the `types=`
param — fewer bytes fetched). **Stations stays hidden** until the station-playback probe passes
(the 2026-07-01 probe returned HTTP 400). Empty state: **prompt + recent searches** (a small
localStorage ring, tappable). Song tap plays **just the one** (interject) — queue-the-rest is
recorded as a future setting (FUTURE-SETTINGS §1 sibling).

**Architecture ✅ (user call, 2026-07-01): Search is a STANDALONE card** (like the Qcard), not a
collection-card context. The screen taxonomy is **collections** (the engine: browse/sort/filter) ·
**queues** (Qcard: a live ordered stream) · **searches** (this card: blended discovery) — each
archetype owns its display idiom, sharing the primitives (row/tile CSS, context-menu,
`playContext`, track-store, dropdown, the `--nav-*` motion tokens so drill-in feels identical).
The future Stations browser's sectioned root follows the search idiom, not the engine.

---

## Interactions

### Tap (left-click / Enter) — per type
- **Song** → **plays in full** (you're authorized → full DRM playback, proven). 🔵 **Queue scope:**
  play just the one (interject — my default for a discovery surface) vs. play it + queue the rest of
  the Songs results (mirrors Library's "play this list, starting here"). Recommend **just the one**;
  it's a sibling of the [Play-Now-scope setting](FUTURE-SETTINGS.md#1-play-now-scope-right-click-menu).
- **Album / Playlist** → **drill in** (`open`) to its tracks — a **catalog fetch** for that
  collection's tracks (`/v1/catalog/{sf}/albums/{id}` or `…/playlists/{id}` with `?include=tracks`)
  — then a track tap plays. Same pane-slide drill the Library uses.
- **Artist** → **drill in** to their **albums + top songs** (catalog fetch), like Library's Artist
  context; from there tap a track to play or an album to drill further.
- **Station** → **play it** → enters **radio mode** ([STATIONS §1–2](STATIONS.md)). (Depends on the
  MusicKit-JS station-playback probe flagged in Stations.)

### Right-click menu ✅ (the queue actions you asked for)
Rides the existing `menu()` grouping accessor → [context-menu.ts](../src/context-menu.ts), and the
gapless [enqueue path](QUEUE.md#manual-queueing--play-next--add-to-queue):
- **Song** → **Play Now · Play Next · Add to Queue** (+ **Add to Library**). Straight to
  `playContext` / `queueTracksNext` / `queueTracksLater`.
- **Album / Playlist** → same actions, but **fetch the collection's tracks first, then enqueue** the
  block (an album/playlist is its tracks in order — the wrappers already accept a `Track[]`). One
  catalog fetch on demand; note the tiny latency (cover with the loading state).
- **Artist** → **Go to Artist** (drill) · **Start Station** (seed an Apple station from the artist,
  [STATIONS](STATIONS.md)). An artist isn't directly queueable, so no Play-Next/Add-to-Queue —
  matching Library, where Artists declare no queue menu.
- **Station** → **Play** / **Start Station** (no queue-insert — stations are their own mode).
- **Add to Library** writes via the catalog id (create/append, gated — consistent with the
  [Playlists export decision](PLAYLISTS.md)); on library-only surfaces this stays the one Apple write.

---

## Empty state 🔵
Before a query, the body can show **recent searches** (local, tap to re-run) and/or a simple prompt.
Recents are a nice, cheap touch (a small `localStorage` ring); a curated "browse/for-you" landing is
a later, fetch-heavier idea. Recommend **recents + prompt** for MVP.

---

## Decisions

**Closed ✅**
- Categories: **Songs / Albums / Artists / Playlists / Stations**; **music videos skipped**.
  Artist result drills into albums + top songs (like Library's Artist context).
- **Reuses the collection-card engine** (categories = groupings; drill-in, play-on-click,
  right-click menus, nav all inherited). The search bar is an **always-on server query**, not the
  client-side Search pill.
- **Debounced + min-length + cancel-in-flight**, over a **cached storefront**; results are catalog
  objects (carry art/preview/ISRC/palette → enrichment shortcut).
- **Tap:** song → full playback; album/playlist → drill (catalog fetch); station → radio mode.
- **Right-click:** Play Now / Play Next / Add to Queue (+ Add to Library) for song/album/playlist
  (albums/playlists fetch-then-enqueue); stations play, not queue.
- Front-end sees only the normalized model; Rust owns the `search` provider method + normalization.

**Open 🔵**
- **Presentation** — category-selector MVP vs. blended Top-results overview (recommend selector).
- **Song-tap queue scope** — just-the-one vs. queue-the-rest (recommend just-the-one).
- **Empty state** — recents + prompt vs. a browse landing (recommend recents).
- **30s preview audition** — a tap-to-preview mode is deferred (full playback is the default, per
  the roadmap #4 decision); revisit if wanted.

---

## Risks / verify
- **Storefront fetch** — a hard prerequisite for every catalog call; get + cache it before the card
  can query. Missing storefront = every search 404s.
- **Station results depend on the MusicKit-JS station probe** ([STATIONS](STATIONS.md)) — if that
  playback path isn't proven, ship Search with the Stations category **display-only** (or hidden)
  until it is.
- **Album/playlist enqueue latency** — "Add to Queue" on a collection needs a tracks fetch first;
  keep it snappy and show the loading state, don't freeze the menu.
- **Rate/quotas** — debounce + min-length + cancel-in-flight are the guard; verify no keystroke
  storms in `__diag`. Paginate (`next`) rather than over-fetching a big `limit`.
- **Model completeness** — normalized `Artist` / `Playlist` / `Station` types must exist (or be
  added) so search results have somewhere to land; keep raw Apple shapes out of the front-end.
  (Library *derives* artists from songs; a catalog `Artist` object — with a real photo — is a
  distinct shape, so confirm it normalizes cleanly.)

---

## As built (2026-07-01)
- `src-tauri/src/apple.rs` — catalog normalizers (`track_from_catalog_song` / album / artist /
  playlist), the `search` trait method (URL-encoded term, category whitelist, never
  music-videos), and three commands: `catalog_search`, `catalog_collection_tracks` (album/playlist
  tracks, follows `next` pagination capped at 10 pages, skips music videos),
  `catalog_artist` (`views=top-songs,full-albums`). All three **piggyback results into the
  enrichment caches** (`enrich::cache_tracks`) — every search warms palette/ISRC/preview.
- `src-tauri/src/model.rs` — `Playlist` reshaped (both ids optional, like Track; + curator,
  trackCount), `SearchResults`, `ArtistDetail`, `Track.preview_url`, `play_params` defaulted on
  deserialize (Tracks round-trip through the frontend for `materialize_track`).
- `src/search.ts` — TS wrappers + types. `src/search-card.ts` — the standalone card: debounced
  (300ms / 2-char min / stale-token-guarded) bar, filter popover (persisted `deets.search.types`;
  narrowing trims the `types=` param) — rides the shared `makeDropdown` primitive so it follows the
  global click/hover menu mode (Hover-Menu setting), sectioned root (songs = a 2-row h-scroll grid; artists =
  round thumbs; albums/playlists = tiles), recents empty state (`deets.search.recents`), drill
  panes on the shared `--nav-*` tokens, right-click menus, `onHeaderChange` so the slot picker
  disables while drilled.
- **Semantics as built:** a *result* song tap plays just-the-one; a row tap inside a
  *detail pane* (album/playlist/artist top songs) plays that list from the row — Library
  semantics, an album is its tracks. Catalog tracks are `addTransientTracks`'d into the
  track-store (session display: Qcard/album-color resolve) **and** `materialize_track`'d
  (durable stats join) on play *and* enqueue — the cheap end of FAVORITES' open trigger fork.
- Styling under the "Search card" block in `styles.css` (theme roles + skin tokens only).
- **UI polish (2026-07-02) — aligned to the Library card for consistency:**
  - **Search bar mirrors Library's `.lib-search`**: a `--canvas`-filled well (border +
    `--radius-control`) holding a leading magnifier + a *borderless, transparent* input
    (no per-input box/focus-ring — the well is the box).
  - **Themed clear button** (`.search__clear`) replaces the native (blue)
    `::-webkit-search-cancel-button`, which is suppressed; it shows only when there's text
    and sits at the input's trailing edge, with the **busy dot to its left**. Both use
    theme roles (`--subtext` → `--title`).
  - **Filter button matches `.lib-pill--icon`** (surface fill, `--lib-pill-radius`, `--text`
    icon at stroke 1.6, bg-only hover).
  - **Scrollbars** (vertical panes + horizontal section scrollers) use the same
    `--scrollbar-*` treatment as `.lib-view`.
  - **Empty state**: flavor prompt removed; recents (`deets.search.recents`) stack vertically.
  - **Right-click fix**: album tiles in the **artist drill pane** now open our `collectionMenu`
    (Play Now / Play Next / Add to Queue, fetch-then-enqueue). They live outside `root`, so the
    root's delegated right-click never reached them and the native menu showed instead.
  - *(Sibling Library tweaks: the Library toolbar's search pill is now a circle sized to the
    sort/view pill height — `aspect-ratio:1` on the flex **cell**, not the inner pill; and
    `.lib-grid { align-content: start }` stops sparse tile grids from stretching tiles to full
    pane height — see HANDOFF gotchas.)*
- **Add to Library** is deliberately absent until Favorites (item 5) lands the gated write path.

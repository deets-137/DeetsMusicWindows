---
status: shipped
shipped_in: 0.9.5
desk_test: passed 2026-09-19
sources: [src/card-memory.ts, src/collection-card.ts, src/layout.ts, src/search.ts, src/search-card.ts, scripts/webview-profile.mjs]
updated: 2026-09-19
---
# Card memory — a card comes back where you left it

Designed 2026-09-17. **BUILT the same day** (§11 = as built). Forks decided the same day (§10).

Files: `src/card-memory.ts` (the map, the disk row, the plain-card scroll helpers) ·
`src/collection-card.ts` (keys, `snapshot` / `restore` / `hold`, the Back return) ·
`src/layout.ts` (save on unmount, give back on mount) · `src/search.ts` (§6 caches) ·
`src/search-card.ts` (its own pane snapshot) · library-, playlists-, radio-, home-,
history-, settings-card.ts (keys and resolvers).

## 0. The problem

A card is destroyed and built again (a **remount**) on:

- a summon into a slot (`requestCard`, `layout.ts` `onCardRequest`),
- a card pick in a slot's title menu,
- a surface change between Midi and Max (every content slot remounts),
- the drill swap in a grown card (CARD-GROW.md §14).

A remount starts the card at its root, at the top. The open playlist, the album, the scroll
place and the filter text are lost. `layout.ts` accepts this in its header comment ("it only
discards scroll position, which is negligible"). That was true while the title picker was the
only swap and it works only at the root. Summons, the grow and the drill swap make it false.

Why the state cannot be kept as it is: a drill level (`Frame` in `collection-card.ts`) holds a
`Context`, and a `Context` is closures over the card's live data (`groupings`, `hero`,
`shelves`, `dropInto`). Nothing outside the card can build it again.

## 1. Terms

- **Remount:** `CardInstance.destroy()` and then `CardDef.mount(host)`.
- **Level:** one entry in a card's drill stack (Playlists › "Road Trip" has two levels).
- **Key:** a short string that names what a level shows (`playlist:local:12`).
- **Snapshot:** the keys of a card's levels, with each level's view state.
- **Card memory:** the store of snapshots, one per card id.

## 2. The snapshot

```ts
interface CardSnapshot {
  v: 1;
  levels: LevelSnapshot[];   // root first
}
interface LevelSnapshot {
  key: string;               // "" for the root
  scroll: number;            // scrollTop of the level's scroller
  grouping?: string;         // a deeper level only (§4)
  sortKey?: string;
  sortDir?: "asc" | "desc";
  density?: "lines" | "small" | "large";
  query?: string;            // the level's filter text
}
```

Size: about 150 bytes a level as JSON. A deep stack is 4–6 levels, so at most about 1 KB a card
and about 10 KB for all ten cards.

**A snapshot never holds** DOM, `items` arrays, `Track` objects or artwork. It holds keys only.
The card loads its data again from the stores it already uses (§6).

## 3. Lifetime (fork 1: A, with B as a row)

- **Default:** a `Map<CardId, CardSnapshot>` in memory (new module `src/card-memory.ts`). It
  lasts while the app runs.
- **Row "Keep card places on restart"** (`cardMemoryDisk`, Off by default): the same map is also
  written to `localStorage` under `deets.cardMemory`. On launch the map is read back once.
- **Writes to disk** happen on a card's destroy and on `pagehide` / `visibilitychange` to hidden.
  Never on scroll.
- **Turning the row Off** removes the stored key at once. The memory map stays.

## 4. Save and restore

**Save** — `layout.ts` `unmountSlot` calls `inst.snapshot?.()` before `inst.destroy()` and puts
the result in card memory. A card with no `snapshot` saves nothing.

**Restore** — `layout.ts` `mountSlot` passes the stored snapshot to the card:
`def.mount(host, { memory })`. The card applies it when its data is ready.

Rules:

1. **A held request wins.** If the card mounts to take a request (open a playlist, a Library
   drill, a Search term, a Settings row), it follows the request and drops the snapshot.
2. **No root flash.** While a restore waits for data, the card's viewport stays hidden
   (`visibility: hidden`) for up to `--memory-wait` (a new motion token, 400 ms). Then the
   levels build with no slide and the viewport shows. If the data is late, the root shows, and
   the levels are applied when the data arrives, only if the user has not acted in the card
   (a pointerdown in the card cancels the restore).
3. **A key that does not resolve** (the playlist was deleted, a sign-out) stops the restore at
   the level above it.
4. **Scroll comes last**, after the rows exist: `Windower.scrollTo(scroll)` on a windowed list,
   `scrollTop` on the others. A `.is-selected` row does not override a restored scroll.
5. **The root level** restores only `scroll` and `query`. Its grouping, sort and density
   already persist per size (`collection-card.ts` `persist`, `modeKey`), so memory does not fight
   them. A deeper level restores its own view state.
6. **The snapshot stays** in memory after a restore. The next destroy replaces it.
7. **Log line:** `diag.log("memory", { card, cause, levels, late })`, where `cause` is
   `restore`, `stale-key`, `cancelled`, `moved` or `load` (the read at launch).

## 5. Keys and resolvers per card

The engine (`collection-card.ts`) gets two options:

- `Context.key?: string` — set by the card where it builds a context.
- `CardOptions.resolve?(key): Context | null` — the card turns a key back into a context.

The engine adds `snapshot()` and `restore(s)` to its return value.

| Card | Levels and keys | Resolver builds with | Data ready when |
|---|---|---|---|
| Library | `artist:<name>`, `album:<albumKey>` | `artistDetail(...)`, `albumDetail(al)` | the library lists have loaded |
| Playlists | `playlist:<pid>` (a folder is a section, not a level) | `detail(p)` | `load()` has listed the playlists |
| Radio | `genre:<id>` | `genreCtx(g)` | its genres have loaded |
| Search | §5a | the pane openers | at once (the panes load themselves) |
| Home | root only: shelf row scroll + each shelf's `scrollLeft` | — | shelves drawn |
| History | root only: scroll | — | first page drawn |
| Settings | root only: scroll. Open sections already persist (`FOLDS_KEY`) | — | at once |
| Queue | nothing. It follows the playing song | — | — |
| Rewind | nothing (its pick already persists in `STORE_KEY`) | — | — |

The keys are the ids those cards already use: `albumKey(t)` in the Library, `pid(p)` in
Playlists, `g.id` in Radio.

### 5a. Search

Search has its own pane stack (`search-card.ts` `pushPane` / `popPane`), not the engine. Its
snapshot has a different shape:

```ts
interface SearchSnapshot {
  v: 1;
  term: string;                // the field text
  scroll: number;              // results scroll
  panes: { open: PaneOpen; scroll: number }[];
}
type PaneOpen =
  | { kind: "album" | "playlist"; id: string; meta: CollectionMeta }   // as built: the hero's facts in one object
  | { kind: "artist"; id: string }
  | { kind: "related"; srcKind: "songs" | "albums"; srcId: string; rel: "artists" | "albums"; name: string };
```

Each `pushPane` records its `PaneOpen`. A restore runs the search for `term` (a debounced call,
as a typed term) and opens each pane with no slide. A `related` pane uses the `relatedCache` hop.
The category filter already persists (`TYPES_KEY`).

**Apple calls on a Search restore:** none within a session — the term and every pane come from
the §6 caches. After a restart (the disk row on) it is 1 search call plus 1 per pane. Measure it
in the desk test.

## 6. The session cache for catalog lists and artists

`collectionTracks(kind, id)` (`search.ts` → `catalog_collection_tracks`, `apple.rs`) calls Apple
on **every** open: 1 call for an album, plus 1 call per extra 100 songs for a catalog playlist.
The memo `relatedCache` in `search.ts` keeps only the id hop.

- **Where:** one `Map<string, Track[] | ArtistDetail>` in `search.ts`, next to `relatedCache`,
  keyed `albums:<id>` / `playlists:<id>` / `artists:<id>`. `collectionTracks` and `artistDetail`
  read it first. A second cache holds the last 10 **search results**, keyed by the term and the
  category filter, so a restored card's term costs no call either. Both hand each caller its own
  arrays: a shuffle or a splice on a result must never change what the cache holds.
- **Two opens at once share one call** (a chip flight's `prepare` and the pane it opens): a fetch
  in flight is kept under its key, and the second caller waits on the same promise.
- **Why there, not in the snapshot:** every open of the same list gains, not only a restore
  (Back to that pane, a second "Go to Album", a chip flight's `prepare`).
- **Cap:** the 30 lists used most recently (a `Map` in insertion order: a hit deletes and sets
  again; past 30, the oldest entry goes).
- **Memory:** a `Track` is about 0.5–1 KB in the heap. An album of 12 songs ≈ 10 KB, a catalog
  playlist of 100 ≈ 100 KB. The cap holds the worst case near 3 MB; a normal session is a few
  hundred KB. These are estimates: measure with `scripts/webview-profile.mjs` in the desk test.
- **Memory only, never on disk.** Apple's terms limit stored catalog content; the 100-cover
  mosaic took the same rule (memory only). With `cardMemoryDisk` on, the disk snapshot holds
  keys only, so after a restart each pane makes its call once.
- **Artist panes are in.** `artistDetail(id)` → `catalog_artist` (`apple.rs`) is **one** call
  (`views=top-songs,full-albums,featured-playlists`) and it is not cached anywhere today
  (`artist_catalog` is the Library artist view's table, keyed by name). The same map holds the
  `ArtistDetail` under `artists:<id>`; it counts toward the cap of 30. About 30–60 KB an artist
  (top songs, albums, featured playlists — links only, no image bytes). The pane's **Your
  Playlists** shelf is not cached: it is local (zero calls) and changes with your playlists, so it
  is read again on each open, as today.
- **Freshness:** an album almost never changes; editorial playlists change about weekly. A list
  from the same session is fresh enough. A failed fetch is not cached.
- **Log line:** `[perf]`-style counters are not needed; `diag.log("tracks-cache", { hit, key })`
  in dev only.

## 7. Settings row

| Key | Label | Pills | Default | Why |
|---|---|---|---|---|
| `cardMemoryDisk` | Keep card places on restart | On / Off | Off | After a restart an old drill can be stale or confusing; the owner chose memory-only by default with this row (fork 1). |

Section: Settings › Window, after the Grow rows. Hint: "Opens each card where you left it, also
after you restart DeetsMusic". Needs: `settings-store.ts` default with the why, a spec in
`agent-settings.ts`, a line in AGENT.md, a row in SETTINGS.md, a hint in the ONBOARDING.md ledger.

## 8. Build checklist (CLAUDE.md › Working style)

1. **Motion:** a restore has none (rule 2). The drill swap motion is CARD-GROW.md §14.
2. **Tokens:** `--memory-wait` in `skin.css` base. Regenerate TOKENS.md.
3. **Hints:** the new row only.
4. **Toasts:** none.
5. **Settings keys:** `cardMemoryDisk` (§7).
6. **Log lines:** §4 rule 7, §6.
6a. **Scrollbars:** no new scroller.
7. **Telemetry:** none new; the drill swap has its own (CARD-GROW.md §14).
8. **Check:** `npx tsc --noEmit`, `npx vite build`.

Also: the header comment of `layout.ts` (the "negligible" line) changes to point here.

## 9. Desk test — PASSED 2026-09-19

1. Playlists: open a playlist, scroll half way. Summon a card into that slot (the NP card's
   queue button in Midi). Pick Playlists again in the title menu. The playlist is open at the
   same scroll place, with no root flash.
2. Library: open an artist, then an album, filter the album. Switch Midi → Max → Midi. Both
   levels come back, the filter text too. Back goes album → artist → root.
3. Delete a playlist that is open in memory (from another card or the agent). Bring Playlists
   back: it shows the root.
4. Held request wins: with Playlists in memory at playlist A, open playlist B from a Home tile.
   B opens, not A.
5. Search: type a term, open an album pane, scroll it. Remount Search. The term, the results and
   the album pane are back. The `[perf]` / network log shows no `catalog/albums` call for the
   album (§6 cache).
6. Open the same catalog album three times from different rows: one Apple call. The same for an artist pane (one `catalog/artists` call).
7. Open 31 different albums: the first one costs a call again.
8. Heap: `webview-profile` before and after 30 catalog playlists. Record the growth here.
9. Row Off: quit and start. Every card starts at its root. Row On: quit and start. Each card
   opens where it was. The Search panes each make one call.
10. Turn the row Off: `deets.cardMemory` is gone from `localStorage`.
11. Scroll in a card during a slow restore: the restore stops, the card stays where you are.

## 10. Decisions (2026-09-17)

| Fork | Pick |
|---|---|
| 1. Lifetime | **A** memory only, with the row for **B** (disk) |
| Cache the song lists, not only the ids | Yes: a session `Track[]` cache for albums and catalog playlists (§6) |
| Cap 30; scope albums, catalog playlists and artist panes | Decided alone, flagged for the desk test (artists first left out on a wrong reading of the calls, corrected the same day) |

## 11. As built (2026-09-17)

Where the build differs from the design above:

- **Search results are cached too** (§6): 10 terms, memory only. The design said a restore costs
  1 search call; within a session it now costs none.
- **`CardDef.mount(host, opts)`** takes a second argument (`MountOpts` in `cards.ts`): the
  snapshot, and — for the drill swap — `onReturn` and `returnTitle`. Every card ignores what it
  does not use.
- **The engine's API** is `snapshot()`, `restore(s)`, `hold()` and `depth()`. `hold()` hides the
  viewport for `--memory-wait`; a `pointerdown` in the card cancels the restore for good.
- **The root level keeps its filter text as well as its scroll**, and reopens the search bar when
  the text is not empty.
- **Home** keeps each shelf's sideways place, not only the body scroll. History and Settings keep
  the body scroll. Queue and Rewind keep nothing, as designed.
- **The Library waits for its store**: on a cold start with a saved place, the body holds, and the
  levels build when the first library tracks land.
- **Not built:** a schema version migration. `v: 1` is checked and anything else is ignored, which
  is enough while the only writer is this version.

# DeetsMusic — Playlists

> A **local-first** playlist store, a **read-only mirror** of the user's Apple Music
> playlists (Spotify later) in the same list, and a **gated one-way export** back to
> Apple. Siblings: [HANDOFF](HANDOFF.md) · [DATA-ARCHITECTURE](DATA-ARCHITECTURE.md)
> (model / provider / cache) · [UI-ARCHITECTURE](UI-ARCHITECTURE.md) (collection-card
> engine) · [SURFACES-AND-CARDS](SURFACES-AND-CARDS.md) (the card system this rides) ·
> [FUTURE-SETTINGS](FUTURE-SETTINGS.md) (the export toggles).
>
> **Status: read/play path BUILT + USER-VERIFIED (2026-07-02) — the card is
> VIEW/PLAY-ONLY for now.**
> Built: the Rust local store + CRUD commands (`src-tauri/src/playlists.rs`, no UI
> callers yet), the Apple mirror read-in (`playlists_page`/`playlist_tracks_page` on the
> provider, `apple_playlists_sync` + cache-first `apple_playlist_tracks`), and the real
> card (`src/playlists-card.ts` on the collection-card engine: overview → detail,
> click-to-play with `playlist:{id}` origin, Play Now/Next/Queue menus, once-per-session
> auto-sync + explicit ⟳). **Deferred to the creation-UX session:** New Playlist,
> Add to Playlist ▸, rename/reorder/remove, Import-to-edit, source badges, mosaic
> covers, export (§6) — the §10 open questions stand. This doc still fixes *what* and
> *why* for those parts.

---

## 0. The one principle

**Local is the source of truth and the only fully-editable copy.** DeetsMusic playlists
live in local SQLite and can be freely created, renamed, reordered, and deleted. Playlists
from a service (Apple now, Spotify later) appear in the **same unified list** as **read-only
mirrors**, tagged with a **source badge**; to edit one you **Import to edit** (a deep-copy
into a new local playlist). Local playlists carry no badge — they're yours.

---

## 1. Why local-first — the Apple write ceiling

This is the load-bearing constraint, and the reason the store can't just be Apple-backed:

- **The public Apple Music API can only _create_ a library playlist and _append_ tracks.**
  Rename, reorder, remove-track, and delete return **403** (no longer supported).
- **`amp-api` is rejected — do not re-raise it.** The web player's private
  `amp-api.music.apple.com` can do full edits, but it authenticates with the **web client's
  privileged bearer token + session cookies** (scraped from a logged-in `music.apple.com`
  session) — *not* our self-signed developer token. Using it means impersonating Apple's
  first-party client; it's explicitly unsanctioned ("only the documented method is supported;
  any other may be blocked at any time"), and abuse of that privileged token has caused users
  to **lose library content**. Not a foundation for a player we want to steward well.

⇒ A credible editor **must** be local. Apple is read-in + create/append-out, nothing more.

---

## 2. What Apple returns — the read side

`GET /v1/me/library/playlists` returns `library-playlists` resources whose attributes map
almost 1:1 onto `Playlist` in [`model.rs`](../src-tauri/src/model.rs): `name`, `description`,
`artwork` (**often absent**), `canEdit`, `isPublic`, `hasCatalog`, `dateAdded`, and
`playParams` (`id`, `isLibrary`, optional `globalId`). The tracks relationship resolves to
**`library-songs` _and_ `library-music-videos`**, in **authored order**.

Apple sends every playlist with the **same shape regardless of kind** — there's no clean
`type` field; you infer the kind:

| Kind | Tell | Import handling |
|---|---|---|
| **User-authored** ("My" playlists) | `canEdit: true`, no `globalId` | First-class — deep-copy into local, fully editable. |
| **Catalog playlist added to library** (editorial / curator / a friend's) | `canEdit: false`, `hasCatalog: true`, `globalId` | Snapshot-copy; it's a *frozen* copy of a list Apple may keep updating — flag on import. |
| **Smart playlist** (rule-based, made in desktop Music) | `canEdit: false`, **rules never exposed** | The API only returns *materialised tracks*. Import = a static snapshot; the smartness is lost. |
| **Personalised mixes / Replay** (`personal-mix`, `replay`) | mostly catalog-side; here only if explicitly added | Same as catalog-added if present; otherwise Search/discovery territory, not this card. |

**Folders:** they exist as a real resource (`library-playlist-folders`, with get-root /
get / create endpoints), **but the flat `/me/library/playlists` sync omits hierarchy** —
folder membership is only reachable by recursively walking from the root folder. Per the
minimise-Apple-calls ethos, **v1 flattens**: sync the flat list, get every playlist, drop the
hierarchy. Folder reconstruction (and the fact that folder *creation* is actually sanctioned)
is a deferrable nice-to-have. *(Verify-later: whether the flat list can opt into a `parent`
relationship via `?include=` — doesn't change the v1 flatten.)*

---

## 3. The unified card

Reuses the collection-card engine (`src/collection-card.ts`), same pattern as the Library
card (`src/library-card.ts`). Rows/tiles render through the shared **`musicCell`** builder
(exported from `library-card.ts`), so playlists present music identically to the Library —
one cell, one density system, no per-card drift.

**Overview (root context)** — one **"Playlists"** grouping (not songs/albums/artists):
- **Cover:** a 2×2 **mosaic** composited from the first distinct track covers (the same
  cover-URL trick as derived albums); curated Apple playlists use their real artwork; ♪
  placeholder otherwise.
- **Subtitle:** "N songs" + the **source badge** on mirrored rows.
- **Sorts:** A–Z · Recently Updated · Recently Added. **Search:** by name.
- **Header actions:** `＋ New Playlist` and `⟳ Sync` (refresh the Apple mirror), mirroring
  Library's refresh button.
- **Tile → drills in** (`open`, like albums — you want to *see* it first). Play is via
  right-click / detail, never a bare tile click.
- **Right-click menu**, per class: local → Play Now / Next / Queue · Rename · Duplicate ·
  Export · Delete; mirror → Play Now / Next / Queue · **Import to edit**.

**Detail (drill-in)** — the playlist's tracks, authored order:
- **Default sort = "Playlist order"** (a position-based `SortSpec`); A–Z / Artist / Added
  are opt-in.
- **Local:** rows are **drag-to-reorder** (reuse the Up-Next `reconcileUpcoming` drag
  primitive — writes new positions; active only in Playlist-order sort). Row menu: Play Now /
  Next / Queue · **Remove from Playlist**. Header: Play + overflow (Rename · Add Songs ·
  Export · Delete).
- **Mirror:** a read-only pill; primary action **Import to edit**. Play / queue / click-to-
  play all work; no reorder/remove.
- Click a song → plays the playlist from there, origin-tagged **`playlist:{id}`** through the
  existing `playContext`.

**The marker:** non-local rows carry a **source badge** — a neutral per-service glyph (Apple
now, Spotify later), **not** Apple's logo (trademark-safe). Token-driven, so a new source is a
glyph + tint, not a rebuild. A badge means "mirrored, read-only until imported."

---

## 4. Building playlists

Two entry points, both on the `src/context-menu.ts` primitive:
- **`＋ New Playlist`** → name input → empty local playlist → drills in → empty state invites
  "Add songs from your Library or Search."
- **`Add to Playlist ▸`** — a submenu **grafted onto the existing track menus** (Library
  songs/albums via `trackMenu` in `library-card.ts`, Qcard rows; Search later). Lists local
  playlists + "New Playlist…". Appends to the end. Only local playlists are targets.

---

## 5. Import (mirror → local)

Deep-copies the mirror's **current** tracks into a new editable local playlist and drills into
it. Surfaced caveats: smart playlists become a **static snapshot** (Apple never gives us the
rule); **music videos are skipped with a count** ("imported 47 of 49 — 2 music videos
skipped"), since `Track` is song-only. The Apple original **stays** in the list (it still
exists on Apple; we can't and shouldn't delete it) — optionally dimmed/"imported" once copied.

---

## 6. Export — the gated one-way bridge

Lives behind an **"Apple Music sync" settings section** (see
[FUTURE-SETTINGS](FUTURE-SETTINGS.md)):

- **Enable Export to Apple Music** — **off by default**. Turning it on reveals the caveat
  copy; the **first** export also shows a one-time confirm.
- **On re-export** — a user setting: **Fresh copy** *(default)* · Append new songs only.
  Fresh copy makes a new Apple playlist each time; append adds only newly-added songs to the
  existing Apple copy (the one edit Apple allows) and notes that reorders/removals won't sync.
- **Caveat copy** (plainly stated): *DeetsMusic can create and add to Apple playlists, but
  can't rename, reorder, remove tracks, or delete them afterwards — manage those here.*

**Flow:** `POST` create playlist (name + description) → add tracks (catalog/library song ids);
unresolvable tracks (music videos) skipped with a count; store the resulting Apple id + date on
the local playlist (`exportedAppleId`) so the row can show **"Exported ✓ (Jun 30)."**

---

## 7. Data + plumbing (all local writes hit SQLite; zero Apple calls)

- **Provider** (`provider.rs` / `apple.rs`): add `playlists_page(offset, limit)` and
  `playlist_tracks(id, offset, limit)` — Apple mirror reads.
- **`library.rs`:** local CRUD commands (`playlist_create` / `rename` / `delete` /
  `add_tracks` / `remove_track` / `reorder` / `list` / `get`) against SQLite;
  `apple_playlists_sync` (flat mirror, stale-while-revalidate like songs);
  `playlist_export_apple(local_id)` (the only Apple-write path).
- **Tables:**
  - `local_playlists` — id, name, description, created/updated, `exported_apple_id?`, exported_at?
  - `local_playlist_tracks` — playlist_id, **position**, + a **denormalised `Track` snapshot**
    per row (so a playlist is self-contained even when it holds catalog tracks not in the
    library cache — mirrors how the queue keeps handles but resolves via the store).
  - `apple_playlists` — mirror cache (playlist json); tracks fetched on-demand when opened.
- **`model.rs`:** `Playlist` is ~90% there; add `source`/`kind`, `trackCount`,
  `exportedAppleId` (local and mirror may want distinct structs).
- **Card:** a real `CardDef.mount` reusing `initCollectionCard` (storeKey
  `deets.playlists.view`). This is the **second live engine instance** alongside Library, so
  **verify `collection-card.ts` holds no module-level state** (the risk SURFACES-AND-CARDS
  already flagged).

---

## 8. Reused primitives (why this is cheap)

Collection-card engine · `context-menu` · the Up-Next **drag-reorder** primitive
(`reconcileUpcoming`) · `playContext` origin tags · the shared **track-store** · the mosaic
cover logic · the dropdown / menu-mode fan-out · the settings-row pattern.

---

## 9. Build order (each phase compiles + is testable on its own)

1. **Rust local store** — `local_playlists` / `local_playlist_tracks` + CRUD. Zero Apple
   calls; testable against SQLite.
2. **Card + overview + detail (local only)** — real `CardDef.mount` reusing
   `initCollectionCard`; New Playlist, drill-in, drag-reorder, remove. A fully usable local
   playlist manager with **no Apple involvement**.
3. **`Add to Playlist ▸`** — wire the submenu into Library/Qcard track menus. Now you can
   actually build playlists.
4. **Apple mirror (read-in)** — `playlists_page` + `playlist_tracks`, `apple_playlists_sync`,
   source badges, Import-to-edit.
5. **Export (create/append)** — the settings block + `playlist_export_apple`.

Phases 1–3 deliver the whole make-and-manage experience with **no API risk**; 4–5 layer Apple
on top. First thing to verify at Phase 2: the collection-card second-instance check above.

---

## Decisions (closed)

Local-first source of truth · **no amp-api** · unified card, local editable + service mirror
with a **source badge** · **Import to edit** deep-copy · export is a **gated one-way**
create/append bridge · re-export is a user setting, **default fresh copy** · **flatten
folders** in v1 · music videos **skipped-with-count** · smart playlists import as a **static
snapshot** · playlists play with a `playlist:{id}` queue origin · local playlist rows store a
**denormalised `Track` snapshot** keyed by position.

## Open — next session (UI/UX)

Overview layout (tiles vs lines, default density) · the source-badge **glyph + placement** ·
detail-header composition (Play / overflow / read-only pill) · the New-Playlist input
affordance · the `Add to Playlist ▸` submenu UX · empty states · the export enable-toggle +
confirm-dialog design · mosaic-cover rendering specifics · whether imported Apple originals are
dimmed vs hidden.

---

## Sources (Apple Music API)

- [Apple Music API docs](https://developer.apple.com/documentation/applemusicapi/) ·
  [Get a Library Playlist](https://developer.apple.com/documentation/applemusicapi/get-a-library-playlist) ·
  [LibraryPlaylists.Attributes](https://developer.apple.com/documentation/applemusicapi/libraryplaylists/attributes)
- Write ceiling: [DELETE/PUT no longer work (Apple Dev Forums)](https://developer.apple.com/forums/thread/107807)
- amp-api / privileged-token risk: [Apple Dev Forums](https://developer.apple.com/forums/thread/702228)
- Folders: [Get Root Library Playlists Folder](https://developer.apple.com/documentation/applemusicapi/get-root-library-playlists-folder) ·
  [Create a New Library Playlist Folder](https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist-folder)
</content>
</invoke>

# DeetsMusic — Playlists

> A **local-first** playlist store, a **read-only mirror** of the user's Apple Music
> playlists (Spotify later) in the same list, and a **gated one-way export** back to
> Apple. Siblings: [HANDOFF](HANDOFF.md) · [DATA-ARCHITECTURE](DATA-ARCHITECTURE.md)
> (model / provider / cache) · [UI-ARCHITECTURE](UI-ARCHITECTURE.md) (collection-card
> engine) · [SURFACES-AND-CARDS](SURFACES-AND-CARDS.md) (the card system this rides) ·
> [FUTURE-SETTINGS](FUTURE-SETTINGS.md) (the export toggles).
>
> **Status: read/play path + the core make-and-fill flow BUILT (2026-07-02).**
> Built: the Rust local store + CRUD commands (`src-tauri/src/playlists.rs`), the Apple
> mirror read-in (`playlists_page`/`playlist_tracks_page` on the provider,
> `apple_playlists_sync` + cache-first `apple_playlist_tracks`), and the real card
> (`src/playlists-card.ts` on the collection-card engine: overview → detail,
> click-to-play with `playlist:{id}` origin, Play Now/Next/Queue menus, once-per-session
> auto-sync + explicit ⟳). Also (2026-07-02): **eager overview count backfill** — the flat
> mirror list carries no track count (Apple rejects `extend`/`include`/`fields`, HTTP 400,
> probed), so `apple_playlist_counts` fills each uncounted tile with one tiny `tracks?limit=1`
> call (`meta.total`), persisted once; opt out via `deets.playlists.eagerCounts=off`
> ([FUTURE-SETTINGS §14](FUTURE-SETTINGS.md)).
>
> **Creation-UX session (2026-07-02) — BUILT:**
> - **New Playlist (+)** — the root-only header button opens an anchored dropdown
>   (`openContextMenuUnder` + an `InputItem` text field, `src/context-menu.ts`): Enter
>   creates → drills into the empty detail ("Add songs from your Library or Search.") →
>   summons the Search card into the other slot (`requestCard`). Escape/click-away cancels.
> - **Add to Playlist ▸** (§4) — a JS-latched side flyout (`SubmenuItem`; the settings-menu
>   flyout grammar, side-flipped + clamped) on song/album menus (the shared `trackMenu` →
>   Library + playlist detail), playlist rows (bulk add, self-excluded; mirrors work as
>   sources = a lightweight partial import), and Search songs/albums/playlists
>   (fetch-then-add). Targets: local playlists only, sorted recent-first
>   ([FUTURE-SETTINGS §15](FUTURE-SETTINGS.md)), topped by a "New Playlist…" field
>   (create-and-add in one gesture). A change bus (`onPlaylistsChange`, `src/playlists.ts`)
>   live-refreshes the card after mutations from any surface.
> - **Delete Playlist** — local rows only; enabled only while empty (greyed with songs —
>   the non-empty delete UX is still an open fork). Locals' `created_at` serializes into
>   `date_added` (RFC3339, chrono) so the Added Date sort covers both sources.
> - **Remove from Playlist** — on song rows in a LOCAL playlist's detail (destructive-last;
>   mirrors keep the shared menu). Identity is the row's authored POSITION, re-resolved
>   live at click time (duplicates are legal; the qcard re-resolve pattern), via
>   `playlist_remove_track` + the change bus.
>
> **Folders session (2026-07-03) — BUILT:** manual folders + kind auto-clusters as
> **collapsible sections** in the overview (§3a). Local metadata over the unified
> list — mirrors are filable too, zero Apple calls.
>
> **Still deferred:** rename/reorder, Import-to-edit, non-empty delete, mosaic covers,
> export (§6 — the **Export ▸ menu is now spec'd** there, parked with the gating
> decision, alongside the parked **direct-append-to-editable-Apple-playlists** idea).
> This doc still fixes *what* and *why* for those parts.

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
  Library's refresh button. **As built (2026-07-02):** both live. The `＋` (root-only,
  directly left of Sync) opens an anchored dropdown text field (**flow B won** over
  create-then-rename / mini-dialog): Enter creates → drills into the empty detail →
  summons Search into the other slot ([FUTURE-SETTINGS §16](FUTURE-SETTINGS.md));
  Escape / click-away cancels.
- **Tile → drills in** (`open`, like albums — you want to *see* it first). Play is via
  right-click / detail, never a bare tile click.
- **Right-click menu**, per class. **As built (2026-07-02):** local → Play Now / Next /
  Queue · Add to Playlist ▸ · Delete (enabled only while empty); mirror → Play Now /
  Next / Queue · Add to Playlist ▸ (bulk add = a lightweight partial import). **Still
  future:** Rename · Duplicate · Export ▸ (§6) on locals; **Import to edit** on mirrors;
  the non-empty delete UX.

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

## 3a. Folders + sections (built 2026-07-03)

**The user's mental groups** — Apple weeklies together, personal together, per-artist
together — need **manual folders** ("artist ones" isn't derivable from Apple metadata),
plus **kind auto-clusters** so the unfiled pile self-organizes. Both render as
**collapsible sections** in one scrolling overview (drill-in folder tiles lost the fork).

**These are OUR folders, not Apple's.** Purely local metadata over the unified list
(zero Apple calls); reconstructing Apple's own folder hierarchy (§2) stays deferred.

- **Data:** `playlist_folders` (id, name, created_at) + `playlist_folder_members`
  (playlist_key PK → folder_id), keyed on the front-end `libraryId` (`local:{rowid}` or
  the Apple playlist id) — so **mirrors are filable** and membership survives a mirror
  re-sync. One folder per playlist. `playlists_cached` stamps `folderId` onto every row
  fresh per read (never baked into cached json). Housekeeping: local delete and
  gone-from-Apple sync rows drop their membership.
- **Commands:** `playlist_folders_list` / `playlist_folder_create` / `_rename` /
  `_delete` (members unfile — playlists untouched) / `_assign(playlist_key, folder_id?)`
  (None = unfile). Front-end wrappers in `playlists.ts` ride the change bus.
- **Sections (the Radio shelf grammar):** the overview grouping is a heterogeneous
  pos-pinned `PlRow` list — folder sections A–Z first (empty folders still show, for
  rename/delete reach), then unfiled auto-clusters in fixed order: **Your Playlists**
  (locals + `kind:"user"` mirrors) · **Apple Mixes** (non-user mirrors matching
  `/\bmix$/i` — the weeklies) · **Replays** (`/^replay\b/i` — the yearly Replay
  playlists) · **From Apple Music** (the rest); empty clusters hide.
  Headers exist only under the **Folders(↑)** sort with no query — any other sort or an
  active search **flattens** (headers never match; so search reaches into collapsed
  sections). A one-time pref migration (`deets.playlists.foldersMigrated`) rewrites a
  pre-folders persisted sortKey to `folders`.
- **Collapse:** header click toggles; state = a section-key set in
  `deets.playlists.collapsed` (survives remounts/restarts). Header row =
  `.lib-shelf--toggle` (chevron + count on the Radio `.lib-shelf` voice).
- **Menus:** playlist rows gain **Move to Folder ▸** (the Add-to-Playlist flyout
  grammar: "New Folder…" create-and-file input, folders A–Z, "Remove from Folder" when
  filed) between Add to Playlist ▸ and Delete. Folder headers: **Rename** (input) ·
  **Delete Folder**. Cluster headers: no menu.
- **The ＋ dropdown** holds TWO labelled create fields (`InputItem.label`, a new
  context-menu affordance — a `.ctx-menu__label` title row above the well): "Playlist"
  (create → drill in → summon Search, as before) and "Folder" (create → the empty
  section appears in place).

## 4. Building playlists

Two entry points, both on the `src/context-menu.ts` primitive — **both BUILT 2026-07-02**:
- **`＋ New Playlist`** → name input → empty local playlist → drills in → empty state invites
  "Add songs from your Library or Search."
- **`Add to Playlist ▸`** — a JS-latched side-flyout submenu (`SubmenuItem`) on Library
  songs/albums (shared `trackMenu` — playlist-detail rows ride it too), playlist rows
  (bulk add, self-excluded), and Search songs/albums/playlists (fetch-then-add). Lists
  local playlists (recent-first, [FUTURE-SETTINGS §15](FUTURE-SETTINGS.md)) topped by a
  "New Playlist…" field (create-and-add in one gesture). Appends to the end; duplicates
  legal. Only local playlists are targets (direct Apple append is parked in §6). Qcard /
  History rows are future tenants (handles, not full Tracks — [FUTURE-SETTINGS §2](FUTURE-SETTINGS.md)).

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

**Menu entry — spec'd 2026-07-02 (design chat), parked with the gating decision.**
- **Shape:** an **`Export ▸`** `SubmenuItem` on LOCAL playlist rows only, between
  Add to Playlist ▸ and Delete; its flyout lists destinations — "Apple Music" (with the
  source sigil) today, Spotify slots in later. **Greyed while the playlist is empty**
  (same disabled-with-reason pattern as Delete).
- **Click flow (2 API calls):** create (local name + description) → one tracks-append
  POST with all ids, mapped `catalogId → "songs"` else `libraryId → "library-songs"` →
  store `exported_apple_id` + `exported_at` (columns already in `local_playlists`) →
  kick a non-fresh `apple_playlists_sync` so the Apple copy **appears in the unified
  list with its sigil** — that appearance IS the success feedback (no toast needed).
- **v1 hardcodes §6's decided defaults:** re-export = **fresh copy** (append-new-only is
  the future setting); repeated exports accumulate same-named Apple copies — documented
  trade. **Partial failure:** create-succeeded/append-failed still stores the Apple id
  (the playlist genuinely exists there) + logs; fresh-copy re-export is the recovery.
  No rollback pretense — we can't delete it anyway.
- **Rust to build:** `playlist_export_apple(local_id)` (§7 lists it; ~80 lines: provider
  create + append). The schema is ready.
- **Gating (the open fork):** the settings toggle above, or ship earlier with a one-time
  in-menu confirm (`deets.playlists.exportConfirmed`) — export is *less* dangerous than
  direct append (it only ever creates new things on Apple), so confirm-only is
  proportionate; parked alongside the append idea below until decided.

**Direct append to editable Apple playlists (idea parked 2026-07-02 — build when the
settings toggle above exists).** Append isn't limited to playlists we created:
`POST /me/library/playlists/{id}/tracks` works on any mirror with `canEdit: true` (the
user-authored class — editorial/smart rows are `canEdit: false` and self-exclude). The
sketch: the **Add to Playlist ▸** flyout grows a sectioned tail — an "On Apple Music"
label row, then the editable mirrors with the source sigil. Needs: a Rust
`apple_playlist_append(id, tracks)` (POST → drop that playlist's content cache + bump its
count), the change bus carrying a cache key instead of a local rowid, a menu label-item
primitive, and a **first-use confirm** ("adds to your playlist on Apple Music —
DeetsMusic can't remove it afterwards", `deets.playlists.appleAppendConfirmed`) that
graduates into the same Apple-Music-sync settings section as the export enable. The
irreversibility is the whole caveat: append is the one write with no undo on our side.
Duplicates: allowed, like Apple's own client — no de-dupe in v1.

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

1. ✅ **Rust local store** — `local_playlists` / `local_playlist_tracks` + CRUD. Zero Apple
   calls; testable against SQLite.
2. **Card + overview + detail (local only)** — real `CardDef.mount` reusing
   `initCollectionCard`; New Playlist ✅, drill-in ✅, remove ✅, empty-delete ✅;
   **drag-reorder + rename still open**.
3. ✅ **`Add to Playlist ▸`** — the flyout submenu on Library/Playlists/Search menus
   (Qcard rows deferred — handles, not Tracks). Now you can actually build playlists.
4. ✅ **Apple mirror (read-in)** — `playlists_page` + `playlist_tracks`, `apple_playlists_sync`,
   the source sigil. **Import-to-edit still open.**
5. **Export (create/append)** — the settings block + `playlist_export_apple`. Menu spec'd
   (§6), parked with the gating decision.

Phases 1–3 deliver the whole make-and-manage experience with **no API risk**; 4–5 layer Apple
on top. The collection-card second-instance check passed at Phase 2 (engine holds no module state).

---

## Decisions (closed)

Local-first source of truth · **no amp-api** · unified card, local editable + service mirror
with a **source badge** · **Import to edit** deep-copy · export is a **gated one-way**
create/append bridge · re-export is a user setting, **default fresh copy** · **flatten
Apple's folders** in v1 (our own local folders shipped 2026-07-03 — §3a; manual folders +
kind auto-clusters as collapsible sections, one folder per playlist, mirrors filable) ·
music videos **skipped-with-count** · smart playlists import as a **static
snapshot** · playlists play with a `playlist:{id}` queue origin · local playlist rows store a
**denormalised `Track` snapshot** keyed by position.

## Open (UI/UX — deferred, pick up when playlists polish is prioritized)

*(Closed 2026-07-02: the New-Playlist input affordance → anchored dropdown field; the
`Add to Playlist ▸` submenu UX → JS-latched side flyout; empty states → `emptyText` on the
detail context; source badge → the `.lib-src-badge` sigil on the count row.)*

Still open: detail-header composition (Play / overflow / read-only pill) · drag-reorder +
rename on locals · the non-empty delete UX · the export enable-toggle + first-use confirm
design (§6 — gates both Export ▸ and direct Apple append) · mosaic-cover rendering
specifics · whether imported Apple originals are dimmed vs hidden.

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

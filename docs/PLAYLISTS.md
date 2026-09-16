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
> **Built since:** mosaic + custom covers (NEXT-VERSION §2; the hero cover button 2026-09-14)
> and **Export to Apple Music** (§6, 2026-09-14).
>
> **Built 2026-09-14 (§10.1–10.8, not desk-tested):** drag to reorder, rename, the
> *Apple Music ▸* menu (Send / Get New Songs, Make a New Copy), the red delete confirm, named
> skipped uploads, covers served as links, the README note, and the Replay guard.
>
> **Built 2026-09-14 (§10.9, not desk-tested):** Import to Edit, adding straight to your own
> Apple playlists, and the Local Playlists section.
>
> **Still deferred:** the backup file (§10.7, an idea only).
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
- **Cover:** the playlist's own cover (a picked image, or a drawn Letters / Note cover);
  curated Apple playlists use their real artwork; otherwise a **mosaic** of up to 100
  distinct track covers, drawn in memory (§11); ♪ placeholder until then.
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

Three entry points. The first two are on the `src/context-menu.ts` primitive — **both BUILT
2026-07-02**; the third is multi-select — **BUILT 2026-09-15**
([NEXT-VERSION §19](NEXT-VERSION.md)): Ctrl+click and Shift+click pick song rows, then either
drag the set onto a playlist (or into an open one), or right-click it and take
*Add to Playlist ▸ New Playlist…*, which makes the list and fills it in one gesture. It works
in every list in the app — the Library (songs, and album and artist tiles), the Playlists
overview and a playlist's own rows, Search, the Queue's Up Next, History and Rewind. A picked
set also drags as one payload, because `DragPayload` always carried a track list and a count,
and a hand-made playlist's rows offer *Remove N songs from Playlist*, which deletes from the
bottom up so the positions still to go stay true.
- **`＋ New Playlist`** → name input → empty local playlist → drills in → the empty state.
  **The empty pane is the filled pane's skeleton (2026-09-15).** The hero holds the full width,
  the Play / Shuffle row draws disabled, and the invite is one row-shaped slot with a dashed rim
  where the first song will land: *"Drag songs here, or add them from your Library or Search."*
  The pane has always accepted a drop; now it says so, and a drag lights the slot
  ([UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) §4a, *An empty pane keeps the shape*).
  Search is summoned beside it per Settings › Playlists › *New playlist opens Search*
  (**Not in mini** by default — mini has one slot, so a summon there hid the new playlist;
  [FUTURE-SETTINGS §16](FUTURE-SETTINGS.md)).
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

## 6. Export — the one-way bridge (BUILT 2026-09-14)

Decided 2026-09-14 (supersedes the 2026-07-02 spec: the off-by-default section, the
re-export setting, and "no toast"). Code: `src/playlist-export.ts`, `playlist_export_plan`
+ `playlist_export_apple` in `playlists.rs`.

**The limit.** Apple's public API can create a library playlist (name + description — no
cover) and add songs to it. It cannot rename, reorder, remove songs, or delete. The user can
do all of those in the Music app.

**The setting.** Settings › Apple Music › **Export playlists** (`playlistExport`, **default on**,
hint "Can't rename, reorder, or delete on Apple Music via DeetsMusic"). Off hides Export ▸.

**The entry.** **Export ▸** on a LOCAL playlist — its row's right-click and the hero cover
menu. The flyout:
- **No live Apple copy** → one row, **Apple Music**: make a copy.
- **A live copy** (`exported_apple_id` is still in the `apple_playlists` mirror — fork 6A, no
  Apple call to learn it) → **Add New Songs to Apple Copy** · **Make a New Apple Copy**.

**Make a copy** (`mode: "new"`): create → stamp `exported_apple_id` + `exported_at` at once (a
partial failure still leaves a real Apple playlist) → append every song with a catalog id,
100 per call, in order → the card re-syncs the mirror (non-fresh) so the copy shows with its
sigil. Toasts: the first time, a once-notice (`deets.notice.exportOneWay`, **[Settings] [Got it]**, the
[Settings] button opens this row) — *Made "X" on Apple
Music. DeetsMusic can't rename, reorder, or delete it there; use the Music app.* After that a
`success` (a re-export adds "The old copy is still there."). Songs with no catalog id
(uploads) are skipped with a count, which turns the toast into a `warn`.

**Add New Songs** (fork 4A — compare with the real Apple copy, one read per 100 songs):
`playlist_export_plan` diffs catalog ids as multisets (duplicates are legal). The first
min(local, apple) occurrences are on both sides; extra local ones are additions, extra Apple
ones are removals Apple can't make; `reordered` = the Apple order after the append (kept +
added at the end) differs from the local order. Then:
- only additions → send them, `success` toast;
- nothing to do → "The Apple copy of "X" is up to date.";
- additions + removals/order → a **sticky question before any write**: what can be added (a
  few titles), what can't carry over, **[Add N songs] [Make a New Copy] [Dismiss]**;
- removals/order only → sticky warn with **[Make a New Copy]**;
- the copy is gone from the mirror, or the append fails → sticky warn with **[Make a New Copy]**.
An append drops that copy's content cache so its next open shows the new songs.

**After an export (2026-09-14).** A playlist made in DeetsMusic is one row: the list hides
its linked Apple copy (`exported_apple_id`) and favors the local version. An older copy from
Make a New Apple Copy is unlinked, so it lists as its own Apple row. The local playlist with a
live Apple copy carries the Apple Music sigil; its detail hero adds "Exported on <date>" (`exported_at`).
With no cover of its own, it shows the artwork Apple gave its copy (the mirror row — zero
calls), before the song mosaic. The first-export notice adds "Your cover stays in
DeetsMusic; Apple Music makes its own." only when the playlist has its own cover.
**Apple lists a new playlist late (found 2026-09-14).** The library list showed the "jank"
copy about 15 s after the create; the card's sync 0.8 s later still returned the old list, so
the copy looked gone (no sigil, Export offered again). Fix: the export seeds the mirror row
from the create reply (`seed_created_copy`, zero extra calls), and `apple_playlists_sync`
keeps a copy exported in the last 30 seconds (`EXPORT_LIST_LAG_MS`) that Apple's list
doesn't show yet (log: `kept just-exported …`). A delay before the sync was rejected: the
lag is not a fixed time.
**The create reply is gzip-compressed** whatever the request asks: `reqwest` needs its
`gzip` feature, or the new playlist's id is unreadable (found 2026-09-14 — two empty copies
were made before the fix).

**Why no confirm before the first write** (fork 5C): it is the Add to Library pattern — the
flyout row already names Apple Music, and everything it makes can be removed in the Music app.

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

## 10. The wrap-up — decided 2026-09-14, BUILT the same day (10.1–10.9), not desk-tested

Talked through with the user after the export desk test. The toast rows are in TOASTS.md §5.

**As built (read this before the plan below):**
- **10.1 drag** — (2026-09-14: the primitive now also carries songs between cards, and an
  open local playlist takes drops at the line via `playlist_insert_tracks` — DRAG-DROP.md.)
  `src/row-drag.ts` is the one primitive; `qcard.ts` and the collection
  engine both use it. The engine offers it through `Grouping.reorder = { sortKey, move }`:
  lines density, that sort ascending, no search. Rows are found by `data-idx`, and the drop
  index is `offsetTop` math from the pressed row, so a windowed list works. A reload that
  arrives mid-drag waits for the drop. The card moves its cached tracks at once, then calls
  `playlist_reorder`. The change bus now **revalidates** an edited playlist over its cache (no
  blank pane between the eviction and the refetch). The shared CSS is `styles.css` §Row drag
  (`.is-dragging`, `.is-reordering`, `.drop-line`).
- **10.2** — the Rename field (`InputItem.value`, new: the field opens holding the name) heads
  the local items shared by the row menu and the hero cover menu. `Make a New Copy (named
  “X”)` shows when the local name differs from the mirror row's name (no new column).
- **10.3** — `toast.ts`: a question with a **Cancel** gets no Dismiss, and a question writes no
  `warn`/`error` diag line.
- **10.4** — `playlist_get_apple_songs` (Rust) reads the copy, runs `export_diff` swapped, and
  appends the Apple `Track`s locally in one command.
- **10.5** — `ExportPlan` / `ExportResult` carry `skippedTitles` instead of a count.
- **10.6** — lib.rs registers the `cover` scheme (asynchronous, off the webview thread);
  `playlists_cached` sends `http://cover.localhost/<rowid>?v=<cover_at>`. **Schema v5** adds
  `cover_at` (so a song add doesn't refetch the image) and `role`.
- **10.8** — `local_playlists.role = 'replay'`, set by `playlist_create(…, role)` from
  `replay.ts`; v5 backfills name + Replay-folder matches. `isReplay` excludes them from Add to
  Playlist targets, Remove, Rename, drag, and Get New Songs. The rolling Replay is found by
  role + name, so a hand-made "Replay" is never deleted.

### 10.1 Drag to reorder (like the queue)
- **Extract** the queue's drag (`qcard.ts` "Drag-to-reorder", ~140 lines: whole-row
  press-and-hold, 6 px threshold, an insertion LINE, edge auto-scroll, render suspended mid-drag,
  click suppressed after a drop) into one shared module; the queue and playlists both use it.
- **Where:** a LOCAL playlist's detail, only in **Playlist Order** with no search active (a drop
  position means nothing in A–Z / Artist order or a filtered list). Mirrors never drag.
- **Windowed lists** (> `WINDOW_MIN` = 200 songs, `collection-window.ts`): rows have one fixed
  height, so the drop index is row math on the list's scroll position, not on rendered rows.
- **Commit:** `playlist_reorder(id, from, to)` already exists in Rust (no UI caller yet), then
  the change bus. Identity is the authored position (duplicates are legal).

### 10.2 Rename + the "Apple Music ▸" wording
- **Rename:** an `InputItem` field in the row's right-click menu AND the hero cover menu (the
  "New Playlist…" field idiom). `playlist_rename` exists in Rust (no UI caller yet).
- **"Export ▸" becomes "Apple Music ▸"**, its rows worded from local state only (zero calls):
  - not exported → *Export to Apple Music*;
  - exported (live copy) → *Send New Songs* · *Get New Songs* (10.4) · *Make a New Copy*;
  - renamed since the export → the copy keeps its old name (Apple can't rename), so say it,
    e.g. *Make a New Copy (named "Road Trip")*. Store the exported name (a column, or compare
    with the mirror row's name).

### 10.3 Delete a playlist that has songs
- Today **Delete Playlist** is greyed while the playlist has songs.
- New: a **red sticky question** (`kind: "error"`, sticky with actions → shows under every tier):
  *Delete "Road Trip" and its 24 songs? This can't be undone.* **[Delete] [Cancel]**.
- **Exported playlist:** the same toast adds *Its copy on Apple Music stays and will show in
  your list.* (Deleting the local row un-hides the linked copy — §6 "one row".)

### 10.4 Get New Songs (Apple copy → local)
- Fork **A** (user's pick): add the songs that are on the Apple copy but not in the local
  playlist, **at the end**. Nothing is lost, so no confirm.
- Cost: one Apple read per 100 songs (reuse `export_diff` with the sides swapped — the extra
  Apple occurrences). Match by catalog id; rows without one can't be matched.
- Toast: *Added 3 songs from Apple Music to "Road Trip".* / *"Road Trip" already has every song
  from its Apple copy.*

### 10.5 Name the skipped uploads
- Uploaded songs DO work in DeetsMusic (Library, playback by library id, local playlists); only
  catalog actions hide (Copy Link, Go To, ♥, Add to Library, export).
- Export's skipped count names them the dead-song way instead of a Details button (toast
  buttons can't open a list): *2 songs skipped: "A" and "B" aren't in the Apple Music catalog.*
  Rust returns the skipped titles with the count.

### 10.6 Covers as links, not text (the Library's way)
- **Why:** a custom cover is a ≈50 KB data URL inside EVERY `playlists_cached` reply. Library
  covers are short Apple links, loaded by `<img loading="lazy">` only for rows near the screen
  (windowing) and cached by the browser.
- **Do the same:** Rust serves each cover from the db at its own link (a custom URI scheme,
  e.g. `http://cover.localhost/<rowid>?v=<updated_at>`); the model carries only that link. The
  `v` changes when the cover changes, so the cache never shows a stale image. Zero Apple calls.

### 10.7 Backup: export/import file
- Local playlists live only in this PC's SQLite (`app_data_dir`). A reinstall or a new PC loses
  them; Export to Apple Music is the only backup today.
- **Idea (documented, not decided further):** Settings › Playlists › *Save playlists to a file* /
  *Load playlists from a file* — one JSON file (names, descriptions, folder, covers, the Track
  snapshots in order). Load adds; it never overwrites.
- **Now:** a README note — *Playlists you make in DeetsMusic are stored on this PC only.*

### 10.8 Replay playlists are not add targets (bug)
- Replay playlists are ordinary local playlists (`replay.ts`: the rolling one is named
  "Replay", dated ones "Replay — <window>, <date>", both filed in the Replay folder). Nothing
  marks them, so **Add to Playlist ▸** offers them and accepts songs. It must not: a Replay is
  made from listening, not by hand.
- **Fix:** mark them at creation (a `kind`/role on `local_playlists`, e.g. `replay`) — not a
  name match, which a user's own "Replay trip" would hit. Then exclude them from Add to Playlist
  targets, Remove from Playlist, rename, drag, and Get New Songs. Existing Replays need a one-time
  backfill (name + Replay folder).

### 10.9 Import to edit (§5) and adding straight to Apple playlists (§6, parked idea)

**Decided + built 2026-09-14 (not desk-tested).** The user's picks:
- **Import link — linked, one row.** `playlist_import(apple_id)` (Rust) copies a mirror into a
  new local playlist (songs from the content cache when cached, else one read per 100) and
  files it in the original's folder. A `canEdit` original becomes the copy's
  `exported_apple_id`, so the original hides and Send / Get New Songs work at once. The
  `exported_at` stays empty (the hero doesn't say "Exported on" for an import). An Apple-made
  playlist (mix, editorial, smart) imports unlinked. Entry: **Import to Edit** on a mirror
  row's right-click and on a mirror's hero cover (the cover is a button there too). It drills
  into the copy.
- **Add menu — one mixed list.** `addToPlaylistItem` lists hand-made locals AND `canEdit`
  mirrors that are not a linked copy, recent first; an Apple row carries the sigil
  (`ActionItem.badge`, new; the sigil moved to `src/apple-sigil.ts`). A linked local lists
  without the sigil: the add is local. The first Apple add asks once
  (`deets.notice.appleAdd`, [Add] silences it). `apple_playlist_add(apple_id, tracks)`
  (Rust) refuses a non-`canEdit` row, appends 100 per call, drops the content cache, and
  raises a known count. The change bus carries the Apple id (`(rowid?, appleId?)`).
- **Section — auto.** `CLUSTERS` gains `local` → **Local Playlists** (first); `yours` is now
  **Your Apple Playlists** (`kind: "user"` mirrors). A collapsed "yours" key now collapses the
  Apple half only.
- **Setting — the same row.** Export playlists off hides the Apple targets. Import to Edit
  always shows (a local write).

The plan as written before the build:
- **Import to edit:** copy an Apple playlist into a new local playlist the user can edit. The
  Apple original stays.
- **Add straight to Apple playlists:** **Add to Playlist ▸** also lists Apple playlists the user
  may add to — `canEdit: true` only (their own). Apple's Replay, mixes, editorial and smart
  playlists are `canEdit: false` and never show.
- **First add to an Apple playlist:** a confirmation toast before the write, once
  (a sticky question, then a key remembers it): *Add to "Road Trip" on Apple Music? DeetsMusic
  can't remove songs from it afterwards.* **[Add] [Cancel]**.
- **A "Local Playlists" section:** today "Your Playlists" mixes local playlists with the user's
  own Apple playlists (`clusterOf`: `source === "local" || kind === "user"`). Split it into
  **Local Playlists** (made in DeetsMusic) and **Your Apple Playlists**, so the two write paths
  never look alike. Open detail for that session: an auto section (a `CLUSTERS` entry, as now)
  vs a real folder the user can rename.

### Order
1. 10.1 drag (shared module) · 2. 10.2 rename + Apple Music ▸ wording · 3. 10.3 delete confirm ·
4. 10.4 Get New Songs · 5. 10.5 named skips · 6. 10.6 cover links · 7. 10.7 README note + backup
doc · 8. 10.8 Replay guard (small; can go first if it bites) · later 10.9.

## 11. Playlist covers — decided and BUILT 2026-09-15, not desk-tested

Two Settings rows in the Playlists section:

| Row | Pills | Key | Default |
|---|---|---|---|
| Show cover | Album / Playlist | `nowPlayingCover` | album |
| New cover | Letters / Mosaic / Note | `newPlaylistCover` | letters |

### 11.1 Show cover (Now Playing card, mini player, tray panel)
- **Playlist:** a song played from a playlist shows the playlist's **saved** cover: the
  user's own image, a drawn Letters / Note cover, or Apple's artwork for the playlist.
- A mosaic playlist has no saved cover, so it keeps the album cover.
- "From a playlist" = the queue entry's context tag: `playlist:<pid>` (Playlists card,
  Rewind) or `search-playlists:<catalogId>` (Search, when the playlist is in the cached list).
- Not changed: the album tint (`album-color.ts`), the Windows media overlay (`smtc.rs`),
  AirPlay, the queue card. The tray gets the cover as `NpState.coverUrl`.
- Code: `playlist-cover.ts` (context → playlist map from `playlistsCached`, zero Apple
  calls), `now-playing-card.ts`, `np-bus.ts` → `bridge.rs` → `tray.ts`.

### 11.2 New cover
- Applies to playlists made through `playlistCreate`: New Playlist (card, add-to menu,
  agent) and Replay. Imported copies keep Apple's cover. Old playlists are not changed.
- **Letters:** up to two letters or digits, the first of each of the first two words
  ("Late Night" → LN). They cannot be changed, and a rename does not redraw. Drawn like
  the DM mark: Anton in every skin, first letter higher in `--album-c1`, second lower in
  `--album-c2`, on `--album-bg`. A name with no letter or digit draws Note.
- **Note:** a ♪ drawn as a shape (Anton has no ♪): head and stem in c1, flag in c2.
- Both are saved once as a PNG through `playlist_set_cover`, in the theme in use at that
  moment, so the cover shows the theme the playlist was made in. Code: `cover-art.ts`.
- **Mosaic:** nothing is saved. **Remove Cover** also returns a playlist to the mosaic.
- **Generate Cover ›** (added 2026-09-15): beside Set / Change Cover… and Choose Image…, on any
  local playlist, old ones included. The flyout offers **Letters (XY)** (only when the name has
  a letter or digit) and **Note**. It draws in the current theme and replaces the cover.

### 11.3 The mosaic
- Up to 100 distinct track covers (Rust `mosaic_urls` via `json_extract`; the card's
  `mosaicOf` from the tracks in hand). A square count (1, 4, 9 … 100) is an even grid; any
  other count is cut into mixed tile sizes that fill the square. The playlist's id seeds
  the layout and the tile order, so each playlist has its own picture.
- **Memory only, never saved** (user's call: compliance). No picture made from Apple
  artwork is stored; the cover images sit only in the webview's HTTP cache, which Apple's
  headers allow (`Access-Control-Allow-Origin: *`, long `max-age`).
- **Kept light:** drawn in a worker (`mosaic-worker.ts`, OffscreenCanvas → 480 px JPEG),
  one playlist at a time, in idle time, only while the window shows, only once the slot
  is on screen. The slot shows ♪ until then. Each draw logs `mosaic:drawn {covers, ms}`.
- Apple policy checked 2026-09-15: the Apple Music Identity Guidelines have no artwork
  rules for apps; the "no 2×2 grid" rule is in the Curator Best Practices and applies to
  playlist art uploaded to Apple.

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

*(Closed 2026-09-14: drag-reorder and rename on locals, and the non-empty delete confirm —
§10 "As built". Closed 2026-09-15: the creation flow — NEXT-VERSION §19.)*

Still open: detail-header composition (Play / overflow / read-only pill) · the export
enable-toggle + first-use confirm design (§6 — gates both Export ▸ and direct Apple append) ·
mosaic-cover rendering specifics · whether imported Apple originals are dimmed vs hidden.

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

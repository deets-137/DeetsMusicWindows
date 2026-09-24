---
status: shipped
shipped_in: 0.4.3
desk_test: passed 2026-09-14
sources: [src/row-drag.ts, src/row-pick.ts]
updated: 2026-09-17
---
# DeetsMusic — Drag and drop between cards

> **Status (2026-09-14): BUILT the same day, tested, committed de12ec3, shipped in 0.4.1.** Everything below was checked
> against the code on this date. The user's picks: Library drop = the menu's behavior;
> a drop on Now Playing plays now, a drop on the Queue card queues; the ghost is a row copy;
> text fields get our own Cut/Copy/Paste menu. "As built" notes are in §7.

**Terms.** A *source* is a row or tile you can press and drag. A *target* is a place that
takes songs when you release over it. The *ghost* is the small floating copy that follows
the pointer. *Up Next* is the Queue card's list after the current song.

---

## 0. The rules the user set

1. **Drop anywhere songs can be taken:** the Queue, a playlist, the Library.
2. **Drag from anywhere a song or a song collection shows:** songs, albums, playlists,
   artists, queue and history rows.
3. **Extend `src/row-drag.ts`.** It is the one drag primitive (Up Next + local playlist
   reorder today).
4. **No browser defaults.** No HTML5 drag and drop (`draggable`, `dataTransfer`), no native
   image drag, no native right-click menu, no browser keys such as Ctrl+F (§6).

---

## 1. What exists today (checked 2026-09-14)

- `row-drag.ts`: whole-row press, 6 px **vertical** threshold, the row follows the pointer
  inside its own list, an insertion line, edge auto-scroll, row math that works in a
  windowed list, a swallowed trailing click. It only reorders inside one list.
- Callers: `qcard.ts` (Up Next → `queue.move` + `reconcileUpcoming`) and the collection
  engine (`Grouping.reorder` → a local playlist in Playlist Order, lines density, no search).
- The queue model has no insert-at-position (`playNextMany` / `addToQueueMany` / `move`
  only). `reconcileUpcoming()` already mirrors ANY model order into MusicKit gaplessly.
- Local playlists append only (`playlist_add_tracks`) or move one row (`playlist_reorder`).
- Apple playlists: `apple_playlist_add` appends (built §10.9, first add asks once).
- The Library: `library-add.ts` adds songs or an album to iCloud Music Library, gated by the
  Library Add setting; no confirm before, a one-time notice after.
- The mini surface shows ONE content card (CSS hides the right slot). Midi shows two, max
  shows four plus the Queue.
- No global handler blocks `contextmenu`, `dragstart`, or browser keys. Each card replaces
  the right-click menu only on its own rows.

---

## 2. Sources — what you can drag

Every source gives the drag a **payload**: a label, a cover, a count when it is known, and a
lazy `tracks()` that runs only at the drop (so a Search album costs no fetch until you drop).

| Card | Rows / tiles | `tracks()` |
|---|---|---|
| Library | songs · albums · artists | the song · `albumOrder` of its songs · the artist's songs in album order |
| Search | songs · albums · playlists | the song · `collectionTracks(kind, id)` (fetch at drop) |
| Playlists | a playlist row (overview) · a song row (detail) | `playlistTracks(p)` · the song |
| Queue | an Up Next row · the Now Playing hero | the entry's handle |
| History | a row · the hero | the entry's handle |
| Rewind | songs · albums · playlists | as its right-click menu (media-menu.ts builders, lazy playlist fetch) |
| Now Playing | the cover | the current song |
| **A picked set** (2026-09-15) | anything picked with Ctrl / Shift — song rows anywhere, Library album and artist tiles, playlist rows, Search results and panes, Rewind | every picked item's songs, as ONE payload (`count` = how many) |

| Radio · Search | a **station** row / tile (2026-09-15) | none — `kind: "station"`, `station` set, `play` = `playStation`. The Queue card makes it the station return (`queueStationAfter`: plays once the queue runs dry, the Qcard row says *Will resume after*); Now Playing plays it now; playlists and the Library refuse it (the *can't drop* ghost) |

**Not sources:** Radio genres (not song lists), folder and shelf headers, the Up Next
station row. One item per drag (there is no multi-select in the app).

---

## 3. Targets — where songs land

| Target | Where it lands | Write |
|---|---|---|
| **Queue card, Up Next** | at the insertion line | `queue.insertManyAt(at, handles)` (new) → `reconcileUpcoming()`; radio mode: model only (the break-out rule); nothing playing: start the block (`playContext`) |
| **Queue card, anywhere else** (its Now Playing hero, the label, the empty space) | the top of Up Next, or the end when released below the last row (fork 2: the Queue card queues) | `insertManyAt(0 \| length, …)` → `reconcileUpcoming()` |
| **Now Playing card** (also mini's one other card) | plays at once (fork 2) | `playTracks(tracks, 0, context)` — Play Now: manual Up Next picks are kept |
| **Playlists card, a local playlist row** | at the end | `playlist_add_tracks` |
| **Playlists card, your own Apple playlist row** (`canEdit`, Export playlists on) | at the end | `apple_playlist_add` — the first add asks once (§10.9) |
| **Playlists card, an open local playlist** | Playlist Order + no search: at the insertion line; otherwise at the end | `playlist_insert_tracks(id, at, tracks)` (new Rust, one transaction) |
| **Library card** | the library | Add to Library, the menu's behavior (fork 1): no question; the one-time notice after the first add, then a success toast. Not a target while the Library Add setting is off. A song payload adds as songs, an album payload as the album; songs already in the library and uploads are skipped. |
| **Mini surface** | only Now Playing is on screen | the Now Playing target above (plays at once) |

**Not targets:** Apple-made playlists (mixes, editorial, smart), Replays (`role: replay`),
Search, History, Rewind, Radio, Settings. Hovering one shows the *can't drop* ghost.

**Inside the source's own list** the drag stays a **reorder** (today's behavior) where one
is allowed: Up Next, and an open local playlist in Playlist Order. A drag that leaves the
list becomes a copy to another target. A drop back on the source playlist row does nothing.

**After a drop:** a `success` toast (Everything tier) — *Added 12 songs to Up Next.* /
*Added “Song” to “Road Trip”.* Failures are `warn` (every tier), the same text as the menus.
An Apple write keeps its own question and notices.

---

## 4. The mechanism — `row-drag.ts` grows two parts

1. **A source may carry a payload.** `rowAt` may return `payload?: DragPayload`. A source
   with no reorder (Library, Search, History, …) returns `reorder: false`; the threshold
   becomes 2-D (6 px in any direction) so a grid tile drags too.
2. **A drop-target registry** (module level, so every card shares one drag):
   `registerDropTarget({ el, accepts(payload), over(x, y) → Indicator | null, drop(payload, hit) })`.
   Each pointer move: inside the source's own reorderable list → today's line; else
   `document.elementFromPoint` → the nearest registered target → its `over()` draws its
   indicator (the existing `.drop-line`, or a row / card highlight). Cards register on
   mount and unregister on destroy.

**The ghost** (fork 3: a row copy, every drag): a clone of the pressed row or tile, portaled
to `<body>` at the row's own size, so it can cross card edges (a row moving inside its list
is clipped by the card). It wears today's drag look — `--drag-lift`, `--shadow-panel`, the
hover fill — plus a new skin token `--drag-ghost-opacity` (draft 0.85) so the list under it
stays readable. **Today's dragged row is opaque** (checked: `.is-dragging` has no opacity);
the translucency is new. The pressed row stays in place and dims (`--drag-source-opacity`)
while the copy follows the pointer 1:1, reorders included. Reduced motion: the lift snaps,
the copy still follows. A collection payload adds its count to the copy (*12 songs*) only
when it is known at press time.

**Kept from today:** the swallowed trailing click, edge auto-scroll (now in the TARGET list
under the pointer, not only the source), render suspended in the source and the hovered
target until the drop, `frames.begin("drag", label)` telemetry (label `cross` for a copy).
**Escape** cancels a drag.

---

## 5. Build order (each step compiles and can be tested)

1. §6 browser defaults (small, stands alone).
2. `row-drag.ts`: payload, 2-D threshold, the registry, the ghost. Up Next and the playlist
   reorder keep working unchanged.
3. Targets: Up Next (`insertManyAt`), playlist rows, an open local playlist
   (`playlist_insert_tracks`, Rust → dev runner restart), the Library.
4. Sources, card by card: Library, Playlists, Search, Queue, History, Rewind, Now Playing.
5. Docs: this file "as built", QUEUE.md (insert), PLAYLISTS.md, TOASTS.md rows, DEBUGGING.md
   (`drag cross`).

---

## 6. Browser defaults — replace them

- **`dragstart`**: one window listener, `preventDefault()` — no native image or text drag
  anywhere. A file dragged in from Explorer is not a `dragstart` in the page, so the playlist
  cover drop keeps working.
- **`contextmenu`**: one window listener in the bubble phase, `preventDefault()` when no card
  handled it — no native menu on empty space, headers, or covers. Text fields (fork 4): our
  own menu on `context-menu.ts` — Cut · Copy · Paste · Select All, greyed when they can't act
  (nothing selected, a read-only field).
- **Browser keys** (Ctrl+F find, Ctrl+P print, Ctrl+R / F5 reload, Ctrl+plus/minus zoom,
  F7 caret browsing, Alt+Left back): WebView2 `AreBrowserAcceleratorKeysEnabled = false` on
  the main window (Rust, `with_webview`). Release only, so F12 devtools stay in dev. The
  app's own Ctrl shortcuts (`main.ts`) are page listeners and keep working.

---

## 7. As built (2026-09-14)

**Files.** `row-drag.ts` (primitive + registry + ghost), `drop-actions.ts` (the writes and
toasts behind each target), `browser-defaults.ts` (§6 page half), `queue.insertManyAt` +
`player.insertInQueue` / `queueTracksAt`, `playlists.playlistInsertTracks` (Rust
`playlist_insert_tracks`), `library-add.addDroppedToLibrary`, `webview2-com` in Cargo.toml.

**A picked set drags as one thing** (multi-select, `src/row-pick.ts`,
[NEXT-VERSION §19](../NEXT-VERSION.md)). The drop side needed no change at all: `DragPayload`
already carried `tracks()` and `count`, because an album tile always dragged many songs. Two
rules: a drag that starts on a picked row is always a **copy**, never a reorder (a block of
rows has no single new position), and the ghost's count badge, which used to be for
collections only, now also shows for a song payload of more than one.

**Engine hooks** (`collection-card.ts`): `Grouping.drag(x) → DragPayload | null` (a source),
`Grouping.pick` (multi-select: `noun?`, `can?`, `id?`, `menu`, `drag`, `play` — present = these
rows pick),
`Grouping.dropOn(x, p) → action | null` (a row target: a playlist row), and
`Context.dropInto(p) → action(at) | null` (a pane target: an open playlist). The engine
registers one target on its viewport; with no hook it returns null and an outer target
answers (the Library card registers on its whole panel).

**The registry.** `registerDropTarget({ el, over(under, x, y, payload) → DropHit | null })`.
The pointer's element is found with `elementFromPoint`; targets whose `el` contains it are
asked innermost first. A `DropHit` has `highlight` (outlined, `.is-drop-target`), `slots`
(an insertion line among a list's `[data-idx]` rows; the drop gets the index), `scroll`
(auto-scrolled near its edges), and `drop`. A hit without `drop` scrolls but shows the
*can't drop* ghost. A mini surface needs nothing special: the hidden slot is never under
the pointer.

**Differences from the plan above.**
- The ghost keeps the row's card styling by sitting inside `display: contents` shells that
  repeat the row's ancestor chain (same tags, classes, `data-*`) — the shells draw no box.
- Every card holds its re-renders during ANY drag (`isDragging()` / `onDragEnd`), not only
  the source and the hovered target. Drags are short; this is simpler and covers a queue
  change landing while a History row is pressed.
- The trailing click is swallowed for every card by one capture listener, also after an
  Escape (the release comes later).
- **Drop on Now Playing keeps Up Next by default** (user's call after the first build,
  2026-09-14): Settings › Playback › Drop on Now Playing, `dropPlayQueue` *keep* / *replace*.
  Keep: the dropped songs go to the top of Up Next and the player jumps to the first; the
  song that was playing joins History; everything that was queued plays after them
  (`player.playTracksKeepQueue`). An Up Next row moves to the top, then plays. Replace: the
  plan above (`playTracks`; an Up Next row jumps, as its menu's Play Now). The Queue card refuses its own Up Next rows outside the list; its Now
  Playing hero (`queue-now`) can be dropped into Up Next as a copy.
- An open **Apple** playlist you can edit (Export playlists on) also takes a drop at the
  end, like its row.
- Add to Library from a drop sends at most 100 song ids per Apple call (the ids ride the URL).
- A drop that finds every song already in the library says so (`info`).
- The accelerator-keys switch is `cfg(not(debug_assertions))`: it can only be tested in an
  installed build.

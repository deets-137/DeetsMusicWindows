# DeetsMusic — Next version (feature notes)

> Aditya's feature notes for the version after 0.2.2, captured 2026-09-11. This file is
> the **feature** backlog. It is not [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md), which holds
> deferred *toggles* for behavior that already ships.
>
> Each entry: what it means, what the code has today, the real forks (the options the code
> does not already rule out), and the Apple-call cost. **All seven were decided on 2026-09-12**
> (the **Decisions** block under each entry). They build as one batch; the batch carries one
> schema bump (v3: the `favorites` table and `local_playlists.cover`). **All eight built
> and desk-verified 2026-09-12** (user: "look good"). Same day, on top: the extras in §9;
> the surface-change motion (fork B) was built, judged janky, and walked back (§10).
> **To talk through next session: the playlist creation flow** (§11). The toast
> primitive is built ([TOASTS.md](TOASTS.md), 2026-09-13) with the Add-to-Library notice;
> the playlist-cover notice (§2) waits on the cover flow itself.

| # | Feature | Cost to Apple | Needs new schema |
|---|---|---|---|
| 1 | Pin search terms (**agreed 2026-09-12**) | none | no |
| 2 | Playlist artwork (**agreed 2026-09-12**) | none | yes (`cover_path`) |
| 3 | Favorite songs (**agreed 2026-09-12**) | low (one `PUT` per ♥) | yes (mirror) |
| 4 | Weekly replay playlists (**agreed 2026-09-12**) | none | no |
| 5 | Search shortcut (**agreed 2026-09-12**) | none | no |
| 6 | Theme and skin switch animation (**agreed 2026-09-12**) | none | no |
| 7 | Album-colored Now Playing text + contrast guard (**agreed 2026-09-12**) | none | no |
| 8 | Glass menu opacity (**agreed 2026-09-12**) | none | no |

---

## 1. Pin search terms

**What it means.** Keep a search term at the top of the Search card, above the recents.

**What the code has.** The Search card keeps a recents ring in `localStorage` under
`deets.search.recents` ([search-card.ts:25](../src/search-card.ts:25)). Before a query the
body shows a **Recent** label and the rows; a tap re-runs the term
([search-card.ts:116](../src/search-card.ts:116)). Everything is front-end. There are no
pins today.

**The shape.** A second key (`deets.search.pins`) and a **Pinned** block above **Recent**.
A pinned term never falls out of the ring.

**Forks.**
- **(a) How you pin.** Right-click a recent row (the app already uses right-click menus
  everywhere) · a small pin glyph on row hover · both.
- **(b) What a pin holds.** The query text only · the text **plus** the category filter, so
  "Adele → Albums" comes back exactly as you left it.
- **(c) The cap.** A fixed maximum (say 5) · no cap, the block scrolls.

**Decisions (2026-09-12).**
- **(a) Gesture — a split pill.** Each Recent row becomes one pill cut in two by a divider:
  `term | pin`. The left half re-runs the term. The right half is a small pin glyph that pins
  or unpins. Same markup in the Pinned block (the glyph shows filled there). No right-click
  item. Divider, glyph size and the two hit areas are skin tokens.
- **(b) A pin holds the term plus the category filter.** `deets.search.pins` stores
  `{ term, types }`, so "Adele → Albums" comes back exactly as you left it. Recents stay
  text-only as today.
- **(c) No cap.** The Pinned block scrolls with the card. Pinning removes the term from the
  recents ring; unpinning puts it back at the top.

**Cost.** Zero Apple calls.

---

## 2. Playlist artwork

**What it means.** A local playlist gets a cover instead of the ♪ placeholder.

**What the code has.** `local_playlists` has **no artwork column**
([playlists.rs:28](../src-tauri/src/playlists.rs:28)). The card renders `p.artwork` through
`musicCell` ([playlists-card.ts:393](../src/playlists-card.ts:393)), so a local playlist
shows the placeholder. Apple mirror playlists carry their own artwork when Apple sends one
(it is **often absent** — [PLAYLISTS.md §2](PLAYLISTS.md)). "Mosaic-cover rendering
specifics" is already an open item in PLAYLISTS.md.

**Forks.**
- **(a) Derived mosaic.** Build the cover from the first four tracks' album art. No schema,
  no Apple calls, no user work. The cover changes when the playlist changes.
- **(b) Borrow one track's art.** The single album cover of the first (or most-played)
  track. This is the trick the Library and Rewind cards already use. Cheapest of all.
- **(c) A chosen image.** The user picks a file. This needs a new column on
  `local_playlists` **and** a copy of the file into the app data folder, so the cover
  survives a moved or deleted source file.

**Note.** (c) is a schema change. Per the standing decision, schema changes ride the
**deferred schema-versioning pass** with the artist-cache work. (a) and (b) do not touch
the schema and can ship alone.

**Decisions (2026-09-12).** A three-step precedence, first match wins:
1. **A cover the user set.** Right-click a local playlist → **Set cover…** (file picker) /
   **Remove cover**. The file is copied into the app data folder (`playlist-covers/{id}.{ext}`)
   and its path lands in a new `local_playlists.cover_path` column (**schema v3**, an
   `ALTER TABLE … ADD COLUMN` on the existing `migrate_v2` pattern in `library.rs`). Local only:
   the public Apple API has no way to set a playlist cover (create takes name and description
   only), so an exported playlist keeps whatever Apple generates. A one-time notice that
   says so is parked with the toast work ([FUTURE-SETTINGS §18](FUTURE-SETTINGS.md)).
2. **Apple's own artwork** on a mirror playlist, when Apple sends one (already stored).
3. **The derived 2×2 mosaic** from the first four distinct album covers. Fewer than four:
   one cover. Empty: the ♪ placeholder. Rendered in `musicCell` from cached art URLs.

**Cost.** Zero Apple calls; (1) and (3) are local, (2) rides the mirror sync.

**As built (differs from step 1 above).** The image is not copied as a file: the front end
center-crops it to a 512 px JPEG data URL (≈50 KB) and `playlist_set_cover` stores it in
`local_playlists.cover`. **2026-09-14:** on a local playlist's detail page the hero cover is a
button — **Choose Image…** · **Remove Cover** · **Export ▸** (fork 1B) — and takes a dropped
image file (fork 3B; `dragDropEnabled: false` on the main window hands file drops to the page,
and `main.ts` stops a stray drop from navigating). Apple playlists get no cover (fork 2A).
A local playlist with no image of its own but an exported Apple copy shows that copy's Apple
artwork, ahead of the mosaic (2026-09-14; PLAYLISTS.md §6).

---

## 3. Integration with favorite songs

**What it means.** Apple's **Favorite** (the ♥ / love `+1`).

**What the code has.** Nothing. There is no `favorite` in `src/` or `src-tauri/src/`.
It is fully scoped as **step 5b** in [FAVORITES.md](FAVORITES.md), parked by your own call
after Add-to-Library shipped. The scope there: ♥ is a ratings `PUT +1`, love only; there is
no 👎 and no ratings system.

**The fork that matters — the two halves are separate features.**
- **(a) Write the ♥.** A ♥ square on Now Playing (next to `#np-add`) plus a right-click item
  across Library / Search / Queue. Needs a **local favorites mirror** table so the ♥ can show
  filled state without a read call per song ([FAVORITES.md](FAVORITES.md) §Local favorites mirror).
- **(b) Read Apple's "Favorite Songs".** Apple generates a *Favorite Songs* playlist from
  those loves. Showing it in the Playlists card is a different job: a mirror playlist to
  fetch, not a button to build.

Say which half "integration" means, or say both and we sequence (a) then (b).

**Also.** ♥ feeds Apple's recommendations, so it improves Stations
([FAVORITES.md](FAVORITES.md) §Ties to Stations).

**Decisions (2026-09-12). Both halves, sequenced (a) then (b).**
- **What Apple gives us.** Write: `PUT /v1/me/ratings/songs/{id}` value `1` sets Favorite;
  `DELETE` clears it. Read: `GET /v1/me/ratings/songs?ids=…` for a batch of ids only — there is
  **no list-all-favorites endpoint**. The generated **Favorite Songs** playlist is the only
  "list all", and it arrives on the normal library-playlist mirror path, read-only. No dislike,
  no scale. Artists/albums possible but out of scope.
- **(a) The ♥.** A ♥ square on Now Playing between `#np-add` and the queue summon (hidden with
  no catalog id), plus a **Favorite / Unfavorite** item in the right-click menus on Library,
  Search, Queue and Playlists rows. A `favorites(track_key, loved, synced_at)` table
  (**schema v3**) backs the filled state. Write-through: optimistic flip, `PUT`/`DELETE`, roll
  back on failure. Reconcile: one batched `GET` for the visible rows on card render, cached
  for the session, never polled. Materialize a `'seen'` row on ♥ like Add-to-Library does.
- **(b) Favorite Songs — and it seeds the mirror.** Apple keeps one generated library
  playlist named **Favorite Songs** (read-only, `canEdit: false`, no `globalId`; it exists
  once the user has favorited at least one song). It mirrors like any library playlist, so it
  shows in the Playlists card for free. More useful: it is the **only list-all** Apple gives
  us, so the mirror sync reads its tracks and marks every one `loved` in `favorites`. That
  makes the batched `GET …/ratings` a fallback for rows the playlist has not caught up with
  yet, not the main path. Identify it by name plus the read-only tell (there is no type
  field); if it is absent, the seed is a no-op. Our own ♥ writes still go through the
  ratings `PUT`/`DELETE`; the playlist is Apple's to edit.
- **Gate.** Rides the existing **Library Add** toggle (account writes are one consent).

**Cost.** One `PUT`/`DELETE` per ♥; one batched `GET` per card render for unknown ids.

---

## 4. Weekly replay playlists from Rewind

**What it means.** A playlist of the songs you played most in the past week, made for you.

**What the code has.** All the data. `play_events` logs every play with `started_ts`,
`ms_listened` and `context`, live since 2026-07-01
([DEETS-REWIND.md](DEETS-REWIND.md) §5a). [rewind.ts](../src/rewind.ts) already ranks
**Songs × Past Week** by minutes listened — that is the Rewind card's default view. The
playlist store is local-first and its writes cost zero Apple calls
([PLAYLISTS.md](PLAYLISTS.md) §7). Folders exist, so the playlists can be filed together.

**So this is a generator, not new plumbing:** take the existing Past-Week ranking, make a
local playlist from the top N.

**Forks.**
- **(a) The trigger.** A **Make playlist** button on the Rewind card (manual, honest, zero
  surprise) · automatic every Monday · both.
- **(b) One playlist or many.** One rolling **This Week** playlist, overwritten each week ·
  one dated playlist per week (`Replay — 8 Sep 2026`), so they accrue into a listening diary.
- **(c) The rule.** Top by **minutes listened** (Rewind's own ranking) · top by **play
  count** · only songs played **two or more** times · exclude the songs in last week's list.
- **(d) The size.** 25 songs is the usual shape. The card already shows a top-20.
- **(e) Where it lands.** A **Replay** folder in the Playlists card.

**Caveat to accept.** A quiet week makes a thin playlist. Decide the minimum: skip the week,
or fill it out with the next-best songs.

**Decisions (2026-09-12).**
- **(a) Trigger — both.** A **Make playlist** button on the Rewind card (uses the card's current
  range and ranking). Plus an automatic run on the first launch on or after the chosen day each
  week, for the past seven days.
- **(b) Shape — rolling by default, dated optional.** The automatic run overwrites one **Replay**
  playlist. With the setting on, it instead creates `Replay — 8 Sep 2026` and files it in a
  **Replay** folder. The manual button always makes a dated one named after the range.
- **(c) Rule — top 25 by minutes listened, repeats allowed.** Rewind's own ranking, unchanged.
- **(d) Quiet week.** Fewer than 5 qualifying songs: the automatic run skips and logs it. The
  button never skips.
- **(e) Settings rows.** Playback section, per the label style:

| Row (hint) | Key | Values | Default |
|---|---|---|---|
| Make a Replay each week (A playlist of the past week's most-played songs, made for you) | `replayAuto` | on / off | on |
| Replay day (The day the weekly Replay is made) | `replayDay` | Mon … Sun | Mon |
| Keep every Replay (Each week gets its own dated playlist in a Replay folder. Off: one playlist, replaced weekly) | `replayKeep` | on / off | off |

**Cost.** Zero Apple calls. Everything is local SQLite.

---

## 5. Search shortcut button (quick-access menu)

**What it means.** Reach the Search card as fast as you reach the Queue card.

**What the code has.** Now Playing's right cluster holds two squares: **+** (Add to Library,
`#np-add`) and the **queue summon** (`#np-summon`), which calls `requestCard("queue")`
([now-playing-card.ts:71](../src/now-playing-card.ts:71)). The summon bus
([layout-bus.ts](../src/layout-bus.ts)) can bring in **any** card, not only the Queue. The
row already drops the two side buttons to a second row when the width is too small
([now-playing-card.ts:257](../src/now-playing-card.ts:257)) — so a third square is not free.
A card picker also already exists as the card's own title menu
([SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) §3).

**Forks.**
- **(a) One more square: Search.** Cheapest. It matches the queue summon exactly. But the
  cluster is already tight at mini and midi widths, and it only ever solves Search.
- **(b) One square opens a quick-access menu.** One glyph, a short list: Search · Library ·
  Playlists · Rewind · Radio · History · Settings. One square, and it scales to every card.
  This is the "quick access menu" note. It is a second entry point into the same
  `requestCard` bus the title picker uses.
- **(c) A keyboard shortcut only.** No pixels, but a new user never finds it.

**Decisions (2026-09-12).**
- **(a) One Search square.** A third square in the Now Playing right cluster, before the queue
  summon; it calls `requestCard("search")`. The card title menu already is the quick-access
  menu, so (b) is not needed. The existing narrow-width drop to a second row handles the third
  square; verify at mini width.
- **Keyboard shortcuts, fixed set.** No global shortcuts exist today, so these are free:
  `Ctrl+K` Search · `Ctrl+Q` Queue · `Ctrl+L` Library · `Ctrl+P` Playlists · `Ctrl+,` Settings.
  Ignored while a text field has focus.
- **Deferred to [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md):** rebinding the shortcuts, and
  choosing the order and content of the Now Playing squares.

**Cost.** Zero Apple calls.

---

## 6. Theme and skin switch animation

> **Agreed 2026-09-12.** Unlike the entries above, the forks here are decided. Not built yet.

**What it means.** A theme or skin switch animates from the old look to the new one. Today
it snaps.

**What the code has.** A switch sets one attribute on `<html>`
([theme.ts:38](../src/theme.ts:38), [skin.ts:32](../src/skin.ts:32)). A theme changes only
colors. A skin also changes fonts, sizes, radii, gradients, the Ocean and storm SVG layers,
and the Glass blur. Most of these cannot be animated with CSS transitions (the theme roles
are not `@property`-registered; gradients, `font-family` and `display` do not interpolate).

**Mechanism.** A View Transition (`document.startViewTransition`, available in WebView2).
The browser snapshots the old state, applies the switch, then animates snapshot → live new
state. Transition types (`:active-view-transition-type(theme | skin)`) tell the two apart.

**Decisions.**
- **(A) Look — theme and skin animate differently.** A theme switch is a color crossfade. A
  skin switch arrives in the *incoming* skin's idiom (during the animation `<html>` already
  carries the new skin, so its tokens drive it): Vanilla fade · Press hard stamp-down wipe ·
  Ocean rise-from-below · Glass blur-dissolve into focus · Retro-Future skewed snap.
  Token-based: each skin block gets `--appearance-dur`, `--appearance-ease`,
  `--appearance-anim`. No per-card `view-transition-name` morphs (rejected: text stretch,
  unique names across dynamic panes).
- **(B) Origin — full-window crossfade.** A circular reveal from the settings button is a
  possible later polish.
- **(C) Tray panel and extension popup — snap.** The tray panel is usually hidden, and its
  `fit()` resizes the window ([tray.ts:349](../src/tray.ts:349)).
- **(D) Reduced motion — snap.** Under `prefers-reduced-motion: reduce` there is no
  animation at all, same as today. (This is stricter than the album crossfade, which stays.)

**Settings row.** Window section, per the label style (verb-first, one-sentence hint):

| Section | Row (hint) | Key | Values | Read site |
|---|---|---|---|---|
| Window | Animate look changes (Theme and skin switches fade into each other. Off: they change at once) | `appearanceMotion` | on / off | the transition helper |

The OS reduced-motion preference overrides the row: it snaps even when the row is on. Add
the row to [SETTINGS.md §3](SETTINGS.md) when this ships.

**Build notes.**
- One helper (e.g. `withAppearanceTransition(kind, fn)`), called from the click handlers in
  [main.ts:68](../src/main.ts:68) and any Settings-card picker. Not from `initTheme()` /
  `initSkin()` — startup stays instant.
- It snaps (calls `fn` directly) when the row is off, reduced motion is on, or the API is
  missing.
- Close the settings menu inside the update callback, so the old snapshot does not catch
  the menu half-closed.
- Await `document.fonts.load(...)` for the new skin's faces inside the callback. Bundled
  faces load on first use; without this the new state shows fallback fonts, then swaps.
- A second switch during an animation calls `skipTransition()` on the running one.
- Accepted: clicks do not reach controls for the ~300 ms of the animation; the aurora,
  storm and waves freeze in the old snapshot only.

**Cost.** Zero Apple calls.

---

## 7. Album-colored Now Playing text + contrast guard

> **Agreed 2026-09-12.** Forks decided; not built. Fork 1 is "try it and feel it out" —
> build it, then the user tests on real covers before it is final.

**What it means.** In Glass, the Now Playing text takes its color from the album cover, and a
contrast check keeps it readable on every cover. It fixes a real bug first: on bright or warm
covers the artist, album and times are almost invisible.

**Why the text is faint today.** The Glass panel is part-transparent, and under it the album
aurora mixes the cover colors at `--album-aurora-strength: 52%`
([skin.css:427](../src/styles/skin.css:427)). A bright cover makes the backdrop light. The
text keeps the theme roles: the title uses `--title`, the artist, album and times use
`--subtext` ([styles.css:1452](../src/styles.css:1452)). `--subtext` is a mid grey for a dark
panel, so it falls well below 4.5:1 there. The aurora rotates, so the backdrop under the text
also changes over time.

**What the code has.** Apple's palette comes with every cover and is already cached — zero
new calls. Rust keeps `bgColor` and `textColor1–4`
([apple.rs:817](../src-tauri/src/apple.rs:817)); `album_palette` (enrich.rs) returns
`bg`/`c1`/`c2`; [album-color.ts](../src/album-color.ts) sets them as inline roles
`--album-bg/-c1/-c2` on the `.np` card, with an `@property` crossfade
([styles.css:1280](../src/styles.css:1280)). See [ALBUM-COLOR.md](ALBUM-COLOR.md).
Apple's text colors are readable on **`bgColor`**, not on our backdrop (theme surface +
frost + aurora), so they always need the check below.

**Decisions.**
- **(1) Text source — Apple's text colors, guarded (B).** Title ← `textColor1`, subtext ←
  `textColor2`, each passed through the contrast guard. Alternative kept for the test: the
  theme roles with the guard only (A). If B feels wrong on real covers, fall back to A.
  `album_palette` returns only `bg/c1/c2` today, so it must also return text colors 1 and 2
  (check whether `c1`/`c2` already *are* those and what the aurora wants instead).
- **(2) Reach — text plus accents (B).** Title, artist, album, times, **and** the scrub bar
  fill and the "on"-state squares (shuffle, AirPlay `data-state="on"`, `#np-add` done).
  Accents need 3:1 (non-text UI), text needs 4.5:1.
- **(3) Skins — Glass only (A).** The aurora exists only in Glass
  (`--album-aurora-display`), and only Glass has the bug. Gate by a skin token so another skin
  can opt in later.

**The contrast guard (JS, in `album-color.ts`).**
1. On album change **and** on theme/skin change, estimate the backdrop: mix the theme surface
   (`--panel`) with each aurora stop at the skin's strength.
2. Take the **worst case** over `bg`, `c1`, `c2` (the aurora rotates).
3. Measure the WCAG 2 contrast ratio of each candidate against it.
4. If it fails, move only the OKLCH **lightness** (toward white on a dark backdrop, toward black
   on a light one) until it passes. Hue and chroma stay, so it still reads as the album.
5. Write runtime roles — e.g. `--np-title`, `--np-subtext`, `--np-accent` — inline on `.np`.
   Their defaults in `themes.css` are `var(--title)` / `var(--subtext)` / the theme accent, so
   no palette means today's look. Register them with `@property` to share the crossfade.

CSS cannot measure a contrast ratio (and WebView2 has no `contrast-color()`), so the math is
JS. It runs once per album change — cheap.

**Edge cases to tune.**
- **Mid-grey backdrop.** Neither lighter nor darker may reach 4.5:1. Fallback: the title color
  for all text, or a soft text shadow / scrim behind `.np__meta` from a skin token.
- **No palette** (some library-only tracks). Theme roles stay; the guard still runs against the
  theme's aurora fallback (`themes.css:37`).
- **Crossfade.** ~600 ms of possible low contrast during a track change. Accepted.
- **Light themes.** The lightness moves the other way; same code.
- **Tray window.** It reuses the NP card, so it gets this too — check it there.
- **Max stage.** Bigger cover and aurora (`--np-stage-cover`); confirm the worst case holds.

**Cost.** Zero Apple calls.

---

## 8. Glass menu opacity

**What it means.** In Glass the AirPlay **Play on** panel is too see-through: the card under
it (its title, search bar, rows) shows through the rows of speakers.

**What the code has.** The panel (`.ap`, [styles.css:294](../src/styles.css:294)) uses the
same recipe as the right-click menu and the Search category popover: `--menu-surface` +
`--menu-backdrop`. In Glass `--menu-surface` is 65% of the theme surface over transparent
with a 16px blur ([skin.css:433](../src/styles/skin.css:433)); every other skin uses the
opaque surface. The panel is portaled to `<body>`, so it frosts whatever card it hangs over.
Nothing is broken; 65% is the design value and it is too thin for a list of names.

**Fork.**
- **(a) All Glass menus milkier.** Raise the Glass `--menu-surface` mix (65% → ~85%). The
  Play-on panel, the right-click menu, the category popover and the settings flyout all gain
  the same legibility. One line.
- **(b) Play-on panel only.** A new skin token (`--ap-surface`, default `var(--menu-surface)`)
  that Glass sets milkier; the other menus stay at 65%.

**Decision (2026-09-12) — (a), at 90%.** The Play-on panel was the only menu where it was
noticed, but the recipe is shared, so all Glass menus go to 90% of the surface. One token.

**Cost.** Zero Apple calls. A token change only.

---

## 9. Extras built 2026-09-12 (from the desk test)

- Now Playing row order: shuffle · queue · search on the left; ♥ · Add-to-Library on the
  right. The two right squares grey out (stay in place) when nothing is playing; only the
  Library Add toggle removes them.
- Between-songs jitter: the card fills the MusicKit gap from the queue's current entry
  (no placeholder / "Not playing" flash); the cover rebuilds only when the artwork
  changes; the artist and album lines keep their height when empty; the cover is a
  square as tall as the text column (min `--np-cover`), both children out of flow.
- The app scrollbar on every panel body (Settings had the OS bar).
- Drill panes lost their permanent `will-change` (grayscale-AA text read fuzzy).
- **Explicit badge** (`contentRating: "explicit"`, already normalized): `EXPLICIT_SIGIL`
  in the Apple-sigil badge slot on Library rows, playlist detail rows, Search rows and
  the NP title.
- **Library ♥ filter**: a heart pill between View and Search narrows the source list
  (songs, albums, artists) to favorites; the engine gained `Context.filter`.

## 10. Surface change motion (fork B) — tried and walked back, 2026-09-12

Built: a stepped native resize per frame (eased, then fire-and-forget) with a content
crossfade on a pick, and a canvas-colored "BRB" veil over drags. **Verdict at the desk: not
smooth** — every step is a native resize plus a full WebView2 relayout, so it cannot reach
frame-rate motion — and the user would rather have no motion than jank. Removed the same
day: the size loop, the veil, the `surfaceMotion` row and tokens. Kept: the native window
background now follows the theme canvas (`theme.ts` `syncWindowBackground`), which costs
nothing and hides any late paint. If this comes back, the only honest route is a
Rust-side loop with few large steps, or no window motion and a content crossfade only.

## 11. To discuss next session — the playlist creation flow

Not designed. The user wants to talk through how a playlist gets made (today: the ＋ in
the Playlists header opens a name field, Enter creates an empty list and summons Search;
Add to Playlist ▸ New Playlist… creates-and-adds from any row). Bring the real forks.

---

## See also
- [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) — deferred toggles (not features).
- [HANDOFF.md](HANDOFF.md) §Not built yet — the older not-built list.

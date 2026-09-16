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
> **To talk through next session: the playlist creation flow** (§11). **2026-09-15: the listening-loop review added §12–§17** (repeat, Play/Shuffle on a collection, shuffle mode, Home, durable History, sleep timer); **§12–§14 decided and BUILT the same day as the transport pass** (awaiting the desk test). The toast
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

> **Superseded 2026-09-15 (user's call: 1A, 2A, 3B).** Every theme and skin change now plays
> the launch animation: the cover fades in over the old look, the look changes under it, and
> the cards rise. Each skin tunes the rise with `--boot-*` tokens. The View Transition, the
> `--appearance-*` tokens and the five skin entrances below are removed. See
> [UX-COVERUPS.md §6a](UX-COVERUPS.md).

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

## 11. The playlist creation flow — CLOSED 2026-09-15, see §19

Talked through on 2026-09-15. The creation gestures were already right; what was missing was
how songs reach a playlist. Built as §19: `Add to Playlist ▸` on the four cards that lacked
it, and multi-select rows (`src/row-pick.ts`) so a hand-picked set becomes a playlist in one
gesture. The name must still exist before the playlist does.

---

# The listening-loop review (2026-09-15)

A review of the daily listening loop found four transport gaps and three smaller ones. The
platform (queue model, healing, windowing, tray, SMTC, updater) is not the problem; the loop
is. Sections 12–17 hold the scope and the forks. Build order agreed: §12 + §13 (+ §14 if
chosen) as one **transport pass**, then Space with the keyboard pass (HANDOFF "polished
keyboard control"), then §15.

Not possible, so not planned: **lyrics** (the Apple Music API gives third parties only a
`hasLyrics` flag), **crossfade** and **Sound Check** (MusicKit JS drives one media element),
**remove from library** (the API is add-only; the Settings hint already says so).

## 12. Repeat button (off / all / one) — BUILT 2026-09-15 (12a A, 12b–12g as recommended)

**What the code has today.** Nothing. No `repeat` in `player.ts`, `queue.ts` or the settings
store. When Up Next runs out, `maybeFinishQueue` moves the last song to the heard trail and
playback stops.

**Where it goes — the space.** The Now Playing bottom row (`now-playing-card.ts`,
`.np__bottom`) is a `1fr auto 1fr` grid: **left cluster** Shuffle · Queue · Search (three
`panel__action` squares), **center** Previous · Play · Next, **right cluster** ♥ · + (two
squares, both hidden until a song with a catalog id plays, and + only while Library Add is
on). In mini at minimum width a ResizeObserver stacks the two clusters onto a second row
(`np__bottom--stacked`), so a fourth square never breaks the row: it only moves the stack
threshold a little earlier. The tray panel has only + and the transport.

| Fork | Option | Verdict |
|---|---|---|
| **12a. Where** | **A (recommended): left cluster, after Shuffle** — Shuffle · Repeat · Queue · Search. Modes sit together, on the side that already holds a mode. Left 4 vs right 2 is optical only: the `1fr auto 1fr` grid keeps the transport centered. | Build |
| | B: right cluster — ♥ · + · Repeat. Symmetric 3 vs 3, but that side means "this song" (♥, +) and Repeat is a mode. And with nothing playing Repeat stands alone on the right. | Possible |
| | C: replace the Search square with Repeat (Ctrl+K and the title picker still reach Search). | Ruled out: the square was added on purpose 2026-09-12 (§5). |
| **12b. One button or two** | **One square that cycles** off → all → one (the standard). Icon: the loop arrows; **one** adds a small "1" over the arrows. **Off** draws at the plain action color; **all** / **one** use the same pressed look as the ♥ square (`aria-pressed="true"`, color `--title`). | Build |
| **12c. Repeat one — engine** | **MusicKit `repeatMode = one`** (its own `PlayerRepeatMode`). The fed window collapses repeated ids (`buildWindow`), so a model-level "insert the same song again" cannot work. Model-follow keys off `queue.position`, which does not change on a repeat, so the model stays correct on its own. **Check before shipping:** the play-event log (`stats.ts`) counts a play from the item change; with repeat one there is none, so a repeat must be counted from the `ended → playing` state change or it never reaches Rewind. | Build; verify the stats path |
| **12d. Repeat all — engine** | Model level. When `advance()` would find no upcoming and the mode is **all**, refill upcoming from the plan: the heard trail (in order) + current, all as `auto` entries. Manual picks repeat too (Apple does the same). | Build |
| | Gapless or not: the forward top-up could pre-wrap the window across the end, but the same id collapse means a list shorter than the window (a 3-song EP) dedups to nothing. **Decision: no pre-wrap.** The wrap is one `loadFromModel` at the end, with the `loading` cover from UX-COVERUPS §1. One buffering gap per lap. Pre-wrap only for lists longer than the window is a later polish. | Accept the gap |
| **12e. Radio mode** | Repeat has no meaning in a station. Hide the square in radio mode, as the transport caps already do, and clear the MusicKit repeat mode on `playStation`. | Build |
| **12f. Persist** | One settings key `repeatMode: "off" \| "all" \| "one"` in `deets.settings`, **no Settings row** (the button is the control). Survives launch, like Apple. Restore on launch applies it to MusicKit at the first play. | Build |
| **12g. Other surfaces** | Agent: a `repeat` action on `POST /command` and the `control` tool (`value` = off / all / one, none = cycle), and a `repeat` field in the snapshot (AGENT.md). CLI: `deetsmusic repeat [off\|all\|one]`. Tray panel: none for now. SMTC: the Windows overlay has no repeat button; skip. | Build agent + CLI |

Cost to Apple: none. Schema: none.

**As built (2026-09-15).** The square sits after Shuffle in `now-playing-card.ts` (`#np-repeat`,
`data-state` off / all / one, the "1" is `.np__repeat-one` centered in the loop; pressed =
`--np-accent`, the ♥ rule). `player.ts`: `getRepeat` / `setRepeat` / `cycleRepeat`, the mode in
`settings.repeatMode` (no row; Settings › Reset › Playback clears it; the agent `settings`
tool can set it — the `onSettingsChange` listener re-applies). **One** = MusicKit
`repeatMode` (`applyRepeatToMusicKit`, applied after every window feed and cleared on
`playStation`); the loop is counted for Rewind from the progress clock (`emitProgress`: the
last 1.5 s → under 1 s, same item → `stats.recordRestart`). **All** = `queue.refillFromPlan`
in `maybeFinishQueue`: the whole list of the last `setContext` (`plan`, not persisted — after
a restart the lap is the back-chain + current), shuffled when the shuffle mode is on, then one
`loadFromModel` (the buffering gap, `loading` cover). A **one** with a MusicKit build that
ignores `repeatMode` falls back to the same reload of the current song. Hidden in radio mode
(`paintModes`, which also re-runs the transport-row stack check). Agent: `POST /command`
kinds `repeat` (cycle) · `repeat-off` · `repeat-all` · `repeat-one`; the snapshot carries
`repeat` and `shuffle`; the `control` tool takes `mode`; CLI `deetsmusic repeat [off|all|one]`.

## 13. Play and Shuffle on a collection (album, playlist, artist, Songs) — BUILT 2026-09-15 (13a B, 13b–13e as recommended)

**What the code has today.** A collection pane's hero (`heroHTML` in `collection-card.ts`) is
cover · title · subtitle · meta. No transport verb anywhere on the pane. To play an album the
user clicks its first song (Play Now = "Song and rest of list"); to shuffle a playlist the
user clicks a song, then presses Shuffle on Now Playing. Heroes exist on: Library album
(`library-card.ts` ~491), Library artist (~606, the only context with `toolbarBelow`, whose
bar sticks to the top of the scroll — ARTIST-VIEW.md §2.2), local and Apple playlist detail
(`playlists-card.ts` ~362), Search album / artist detail (`search-card.ts` ~429). Every other
context's toolbar (Sort · View · Search · the ♥ filter) lives in the card head, which never
scrolls.

| Fork | Option | Verdict |
|---|---|---|
| **13a. Where** | **B (recommended): in the toolbar row**, first, before Sort. In every context the toolbar is already always reachable: the head does not scroll, and the artist view's bar is sticky (the reference: `.lib-view-bar`, the `--sticky-bar-*` tokens, kept alive across a sort or a keystroke by `heads`). One place in the engine, zero new sticky work, and the artist view keeps Play / Shuffle in view while 400 songs pass under. | Build |
| | A: two buttons in the hero, under the meta line (the Apple / Spotify placement). Scrolls away with the hero in the artist view; needs a second copy in the sticky bar to stay reachable. | Ruled out by its own duplicate |
| **13b. Shape** | **A `Play` pill with a filled ▶ and the word, then a Shuffle icon square** (the `lib-pill--icon` shape the ♥ filter uses). Two text pills plus Sort · View · Search crowd the 480-wide midi head; one word is enough. | Build |
| **13c. What plays** | The context's rows **in the current sort and filter**, from the first row: an album in Track Order, an artist's songs in Popular when that sort is on, a playlist in its own order, a ♥-filtered list as filtered. Shuffle = the same list through `shuffleInPlace`, then `playContext(handles, 0)`. Both reuse the row-click path (`activate` → `playContext`), so the Play Now scope and drop rules stay as they are. | Build |
| **13d. Root contexts** | Show on the Library › Songs, Albums, Artists and Playlists roots too? Songs root: Play = all songs in sort order, Shuffle = the idle-shuffle list. Albums / Artists / Playlists roots: their rows are groups, not songs; a Play there would flatten hundreds of groups. **Decision: show only where the rows are songs.** | Build |
| **13e. Engine hook** | A `Context.actions?: { play(): void; shuffle(): void }` next to `filter`; the toolbar renders them when present. Each card fills it from its own `activate` list. | Build |

Cost to Apple: none (the rows are already in memory).

**As built (2026-09-15; placement changed the same day on the desk: the toolbar square was
"a weird size", so the pair is now its own row).** `Grouping.playAll` (collection-card.ts)
marks a song list; `actionsHTML` draws a row of two half-width buttons (`.lib-actions`,
`data-act`) **under the hero, above the shelves** — or at the top of the list where there is
no hero — as part of the head block, so the windower measures it and a View switch to Albums
at the Library root drops it. In the artist view the row scrolls away with the hero (the
sticky bar keeps only Sort / View / Search). Play runs `g.activate(items[0], 0, items)` on the sorted + filtered rows —
the row-click path, so Play Now scope and the queue rules hold; Shuffle runs it on a shuffled
copy and, with "Button is perma-shuffle", turns the mode on first. Play while the mode is on also
starts shuffled (Apple's behaviour). Set on `songsGrouping` (Library Songs root, album detail,
the artist view's Songs — whose sticky bar keeps them in view) and the playlist detail
grouping. **Hover text says what the list is** (`ActionTitles`): the Library artist view's
row reads "Play every song by X in your library, in this order" / "Shuffle every song by X
in your library" — the rows are your library's songs by the artist, not the catalog
discography; the defaults elsewhere are "Play these songs in this order" / "Shuffle these
songs". **The Search card has the row too** (same day): `actionsRowHTML` + `runListAction`
are exported from the engine; an album / playlist pane puts the row under its hero ("Play
the album in order"), and the artist pane puts it under the artist's name, acting on the
**Top Songs** Apple returned ("Play X's Top Songs from Apple Music, in order"). Styles:
`.lib-action--play` filled with the title ink (the surface as text), Shuffle the pill
outline; both `--fs-text`.

## 14. A shuffle mode (the second half of P6) — DECIDED A + BUILT 2026-09-15

**What the code has today.** Shuffle is a one-shot reorder of Up Next (FUTURE-SETTINGS §5).
Nothing stays on: the next album a user clicks plays in track order.

**What a mode is.** A toggle that stays on, as in Apple Music and Spotify: while it is on,
every new context starts shuffled (the clicked song first, the rest of its list shuffled
behind it), the Shuffle square shows pressed, and pressing it again turns it off (whether Up
Next then returns to list order is a fork of its own).

**Why it comes up now.** §13's Shuffle button on an album says "shuffle this album". If the
user then clicks a song elsewhere, Apple keeps shuffle on; DeetsMusic would not. Two paths:

| Option | Meaning |
|---|---|
| **A (recommended if §13 ships): build the mode with §13.** The Shuffle square on Now Playing becomes the toggle (pressed look as §12b); the one-shot reorder stays as its "turn on" effect. `settings.shuffleMode` persists. §13's Shuffle turns the mode on and starts the list. | One more state in `player.ts` (`setContext` shuffles the tail when on); the manual-pick rule in FUTURE-SETTINGS §5a applies unchanged. |
| B: keep one-shot only. §13's Shuffle is then "start this list shuffled, once". | Nothing else changes. Already documented as the P6 TODO. |

**Decision (2026-09-15): A, with a Settings row for the toggle.** Settings › Playback ›
**Button is perma-shuffle** (`shuffleStays`, default on): the Now Playing Shuffle square is a mode —
press = on (Up Next shuffles at once, the one-shot) and shows pressed (`aria-pressed`,
`--np-accent`); press again = off (Up Next stays as it is; the next list plays in order —
the Spotify answer to FUTURE-SETTINGS §5's open question). With the row off the square is
the 2026-07-02 one-shot again. The state is `settings.shuffleMode` (persisted, no row).
While on, `playContext` → `queue.setContext(…, shuffle = true)` puts the clicked song first
and the rest of its list shuffled behind it (manual picks stay in front, §5a unchanged),
and a Repeat-all lap is shuffled too. Agent: `shuffle` presses the button, `shuffle-on` /
`shuffle-off` set the mode; the snapshot's `shuffle` says whether it is on.

**2026-09-16 — the "on" state was invisible, and a press had no answer.** Two faults, both fixed:

1. *Pressed drew nothing.* The only signal was `color: var(--np-accent)`, and `--np-accent`
   falls back to `var(--title)` (`themes.css`) — the square's own off color. It is overwritten
   per song, inline, only in skins that opt into `--np-album-text`. In every other skin the on
   and off squares were the same pixels. `aria-pressed` was right all along, so screen readers
   were never affected; only the eye was. **Fix:** "on" now fills the square —
   `background: var(--picked)` + `border-color: var(--title)`, the same `aria-pressed` pattern
   the sleep chips and the settings half-buttons use. A shape change, not a hue change, so it
   holds under any album color and for colorblind users. The accent tint stays on top of it.
   **Repeat had the identical collision** (`data-state="all" | "one"`) and is fixed with it.
   ♥ and repeat-one were already safe — they change shape (fill / the small "1").
2. *A press had no feedback while the mode was off.* With `shuffleStays` off the square is a
   one-shot: it shuffles Up Next and there is no mode to paint, so nothing moved. **Fix — "cross
   the wires":** the icon's two arrows swing apart to parallel, hold a beat, then re-cross.
   The `<svg>` is now two `<g>` wires (each line plus its own arrowhead); each rotates ∓45° to
   flat and translates apart, or they would overlap instead of reading as two. Tokens
   `--sh-cross-dur` / `--sh-cross-gap` (skin tier); reduced motion snaps. It runs on **every**
   press, on and off, so the press always answers.

**2026-09-16, second pass — the parted wires showed a hole, and Repeat got its own move.**

3. *The lower wire broke when it straightened.* Feather draws that wire as two stubs with a
   gap, which is how the icon says "this one passes under". The cue only works while they
   cross; the moment they part it reads as a broken line. **Fix:** the wire is now **one whole
   line** (`4,4 → 21,21`), and the under-pass is a soft hole in an SVG mask at the centre —
   a radial gradient, so the wire fades out and back rather than stopping dead. The mask sits
   on a still wrapper `<g>`, so the hole stays put in the icon's frame while the wire inside
   turns. The hole **closes** during the parallel beat (`np-sh-fade` drives `stop-opacity` on
   the inner stops): nothing crosses then, so nothing should fade. Black and white inside the
   mask are luminance, not palette — a mask has no other alphabet.
4. *Repeat one now turns.* The press that lands on **"one"** sends the loop right round once
   (`--rp-loop-dur`, 0.5s): one song, going round and round. Only that press — `off` and `all`
   stay still, so the turn names the mode it lands on. `cycleRepeat()` already returns the new
   mode, so the trigger is the press itself, never a repaint (a persisted "one" does not spin
   on load). The glyph keeps its rounded-rectangle shape; it simply ends where it started. The
   "1" is a sibling `<span>`, not part of the `<svg>`, so it stays upright while the loop turns.

**Still sharing the old fault:** the AirPlay square (`.ap-square[data-state="on"]`) is hue-only
on `--np-accent` too. Left alone for now — its own row names the speaker in words.

## 15. A Home card — DESIGNED + BUILT 2026-09-15

**Why.** The app opens on the last two cards, not on a landing. There is no "Recently Played"
or "Recently Added" for songs and albums (Radio has a Recents shelf; the Library has an Added
Date sort). The play-event log is durable, so the data is here.

**Built.** Three mixed shelves. Everything local but one thing: a first-time artist photo
costs one Apple call, once ever, saved in `artist_catalog`. Recently Played collapses consecutive
plays that share a `context` into one container tile (playlist / album / station / artist);
Recently Added interleaves songs, albums and playlists by kind and prints no dates (Apple
sends no per-song `dateAdded`, so we know the order, never the day); the third shelf is the
current weekday/weekend × part-of-day bucket, scored on decayed minutes, capped at half
containers, with songs suppressed when they came mostly from a listed container. Right-click
› Hide takes a tile off and the shelf refills at once; playing it again brings it back.
Each shelf is one sideways-scrolling row of twelve tiles, stacked down the card (the artist
view's shelves), so all three are on screen at once. Settings › Home holds *Hiding lasts* and *Hidden tiles › Clear*. New in Rust: the `added_at`
table + `added_at_map` — the true add clock for anything added through DeetsMusic from now
on. Whether Home is the fresh-install default slot waits for the default-cards talk.
**The whole record, with every fork: [HOME.md](HOME.md).**

## 16. A durable History card — BUILT 2026-09-15

**What the code had.** The card read `queue.getPlayLog()`, the session log, so it emptied at
every launch. Rewind already read the durable `play_events` table.

**As built.** The card reads `play_events_since(now − 14 days)` at mount — one SQLite call,
no Apple calls, 200 rows held — and re-reads the last **two hours** on every write to the log
(`onPlayEvent` in `stats.ts`, fired when `record_event_start` and `record_event_end` land),
which catches both a new play and the finalize of the one before it. The session log is no
longer read by anything.

**The decisions (user, 2026-09-15).**
- **Names are not copied into the event.** The first plan added `title` / `artist` columns
  (a `migrate_v6`). Checking the code first killed it: every played track that is not in your
  library is already materialized as a `seen` row, and `track-store.ts` loads those into the
  store at launch **for exactly this reason**. So the join already survives a restart, and the
  schema is untouched — no Rust change, no dev-runner restart.
- **The card keeps its shape.** Hero + "Previously" + a flat list, as before. **No day
  dividers**: the day is opt-in, and it shows inside the row's own subtitle line
  (*"Miles Davis · Yesterday"*) under Settings › Playback › **Show the day in History**,
  default off.
- **Each row says when.** The clock time on the right, and the Next glyph when the song was
  cut short (`completed = 0` on a finalized row), hint *You skipped this one*. A mark, not the
  word "Skipped": most listening has skips in it and a column of words would shout.
- **Repeats stay real.** Three plays make three rows.

## 17. Sleep timer — DESIGNED + BUILT 2026-09-15 (branch `wakin-up`), awaiting the desk test

**Terms.** The *mark* is the moment the room goes quiet. The *wind-down* is the last minutes
before the mark, over which the volume sinks to nothing. The *dial* is the panel's kitchen
timer. The *schedule* is a mark that sets itself every day.

**Where.** An alarm clock (with two z's) in the title bar, left of the volume pill, in every
surface (the pill hides in the NP view; the clock stays — it is a clock, not a level). Armed,
it takes the title color, and its hover hint says the remaining time. Its panel follows the
menu mode like every dropdown (click, or hover per Settings). Code: `src/sleep.ts`; markup in
`index.html`; the `.sleep__*` block in `styles.css`; the `--sleep-*` tokens in `skin.css`.

**The panel.**
- **The dial.** One turn = 120 minutes, with a click every 5. The numbers run
  counter-clockwise, as a kitchen timer is printed, so a clockwise turn winds it up; the
  face turns back under a fixed mark at the top, one step a second (`--sleep-turn`; reduced
  motion snaps once a minute). Drag it, roll the wheel over it, or use the arrow keys (Home
  or Delete = off). The centre reads the time left (`m:ss`) and a caption (*Sleep in* ·
  *End of song* · *End of Up Next* · *Every day at 10:00 PM*). Off reads *Off · Turn the dial*.
- **Two chips.** *End of song* and *End of Up Next*. A click on another song moves the end to
  that song (the timer does not fire on a hand change: a change with more than 1.5 s left
  is a click, not the end). *End of Up Next* rolls to each next song while Up Next has any.
- **Wind down.** A pill that cycles Off · 1 · 2 · 5 · 10 · 15 · 30 min (default 5).
- **Every day.** A pill that cycles Off · Sunset · At a time, with a ‹ 10:00 PM › stepper
  (15-minute steps) for the time. A status line says what will happen: *Pauses at sunset,
  7:12 PM in Chicago, if music is playing.*
- **Play out song.** An On/Off pill (default Off). On: a mark that comes mid-song moves to
  the song's end, and the wind-down fills the song's last minutes instead. The dial shows
  the moved end as soon as the mark falls inside the playing song. Key `sleepPlayOut`.
- **Off** (or **Not tonight** for a scheduled countdown) sits in the centre of the dial, in
  the help line's place, while armed. Its press does not start a turn.

**Touch-ups from the first desk look (user, 2026-09-16).** The centre says only *Turn the
timer* when off and the time alone while armed (the mode captions went; the button's hover
hint carries them). The icon is the clock face and two z's, no bells and no feet, at 16 px so
it reads level with the 14-px pill and lights. The panel's parts slide in one after another
on open (`enterRows`, pop.ts) and any part that appears later (the time stepper, the status
line, Off) slides in the same way. *Missed on the first build: I read the volume panel as the
reference, and it never used `enterRows`; the "Play on" panel and the Settings folds do.
The checklist in CLAUDE.md is the fix.*

**Second look (2026-09-16).** The line under the time (the help, then Off) sat in no
reserved space, so the swap moved the time and a turn of the dial flickered it. It is now a
slot of fixed height (`--sleep-line-h`) and each arrival fades up over `--sleep-swap`
(0.42 s, gentler than a row's slide; reduced motion: none). The z's on the icon are larger.
The traffic lights follow Windows' order: minimize, maximize, close (the CSS never depended
on the order; only the markup moved).

**The decisions (user, 2026-09-15 — all as recommended).**
1. **The mark is the silence.** "30 min" = silent at 30; the wind-down fills the last W
   minutes before it. "10 PM" = silent at 10:00.
2. **The dial is one turn of 120 minutes**, 5-minute detents, numbers every 15.
3. **The two chips are in.** They fade into the song's end and pause on the item change at
   gain 0 (with no wind-down, the last half second is at gain 0 too), so the next song never
   sounds.
4. **The schedule lives in the panel only.** It arms itself once its mark is within one turn
   (two hours), so the button lights and the dial counts down like a hand-set timer. It fires
   only if music is playing at the mark; Play after the mark does not re-fire until tomorrow.
   A hand-set timer holds the night: the schedule's mark passes under it. No rows in Settings
   — the three keys (`sleepSchedule`, `sleepAt`, `sleepWind`) are in the store, so the agent's
   `settings` tool reaches them under a **Sleep** section (`sleepAt` takes :15 steps).
5. **A hand on the volume during the fade turns the timer off**, with an *Undo* toast. Before
   the fade, the volume is free. (The agent's volume set counts as a hand.)
6. **AirPlay fades too**: the sink gets one write a second while the speaker holds the volume.
7. **Icon only while armed**; the remaining time is the hover hint, and a toast at one minute
   offers **+15 min**. The tray tooltip is a fixed string in Rust and stays out of this pass.

**How the fade works — the one trap.** `setVolume` persists on every call, so a fade through
it would have written the stored level down to 0. The wind-down is a separate **gain factor**
in `player.ts` (`setDuck`), multiplied into MusicKit's volume on the way out; `getVolume`
reports the product, so the pill and the stage row show the level sinking, but the stored
level never moves. After the pause the factor snaps to 1, so the next Play is at the set
level. The curve is the fraction squared: gain falls faster than loudness, so the fade sounds
even instead of dropping off a cliff at the end. A speaker's own move under a fade is read
back in the set level's frame (`reflectExternalVolume`).

**Sunset** comes from `look-schedule.ts` (`sunTimes`, `sunCity`): the time zone's main city,
no location, no request. The look schedule's *Shift sun times* does not apply here.

**Toasts** (TOASTS.md §5): *Sleep in 1 minute.* **[+15 min]** (once per arm, only while music
plays) · *Sleep timer off.* **[Undo]** (the volume cancel). Both `info`.

**Log lines** (`diag`): `sleep:arm` (mode, the mark, scheduled, wind) · `sleep:fire` (playing
or not) · `sleep:off` (why: dial, chip, button, volume, schedule).

No Apple calls. No Rust change: no dev-runner restart. Not in this pass: agent verbs for the
timer itself (`sleep 30`), the tray tooltip, a Now Playing badge.

**Desk test.** Turn the dial to 10 (the readout, the button lights; the hint), then to 0
(off). Set 1 min with wind-down 1 min: the pill sinks, the toast at 1 min, silence at the
mark, then Play is at the old level. Drag the volume during a fade: off, Undo brings it back.
*End of song* near a song's end, then click another song (the end moves). Every day › Sunset:
the status line; set the time to two minutes from now and play: the button lights, the
countdown, the pause. Reduced motion: the face snaps once a minute. Ask the agent:
`settings set sleepAt 22:15`.

## 18. Surface open sizes + the NP record jitter — BUILT + SHIPPED in 0.6.2, 2026-09-15

Each view (Mini, NP, Midi, Max) opens at a size set in Settings › Window, with a `W × H`
menu and *Set current*. Every view has a floor, and that floor is its default: Mini 385 × 550,
NP 405 × 675, Midi 495 × 670, Max 1100 × 820. NP never flips surface on a resize. The record
jitter needed no CSS: NP's 404-px floor, plus the `61b1ae1` ResizeObserver fix, settled it.
Two bugs turned up on the way — Play / Shuffle drew on an empty list, and a skin switch
scrolled a card's head out of view. Commits `18de3a7` + `5a52852`; the whole record, with the
shipped numbers, is [FUTURE-SETTINGS.md §8a](FUTURE-SETTINGS.md).

## 19. Multi-select rows, and the playlist creation flow — BUILT 2026-09-15

The flow review (§11) found the way a playlist gets made was not the problem — the way
songs REACH one was. Three things were missing, and all three are now built.

**19a. `Add to Playlist ▸` reached four cards it had missed.** It was on the Library, the
artist view, Search, Rewind and the Playlists rows, and the Home tiles (through
`trackMenu`). It was NOT on the Queue's Up Next rows, the Queue's Now Playing hero, the
History rows, or the Now Playing card's cover. All four have it now, in `trackMenu`'s own
place: after the play and queue verbs, before the Go to… drill-ins. It shows only once the
song has resolved.

**A station song files like any other.** A song heard on a station is ingested as a
transient track and, once its play is logged, kept as a durable `seen` row, so it resolves
to a real `Track` with a catalog id. That is why "save a station's songs" is not a feature:
right-click the song and file it. (Fork D, dropped 2026-09-15.)

**19b. The name still has to exist.** Enter with a name is the only way to commit a new
playlist. No "Untitled Playlist" to rename later (the user's call — it keeps junk lists out).

**19c. Multi-select — `src/row-pick.ts`.** One store, shared by every list that takes it.

| Gesture | What it does |
|---|---|
| Click | Plays the row, as before — and drops what was picked |
| Ctrl+click | Adds or removes one row |
| Shift+click | Takes the run from the last row touched to this one (widens only) |
| Ctrl+A | Takes every row in the current sort and filter, while the card has the focus |
| Escape, or a click on blank space | Clears |

Decisions (the user, 2026-09-15):
1. **Picks are identities, not positions.** A sort, a filter, a search, a background sync or
   a queue advance keeps them. A playlist detail is the exception: the same song can sit in
   one twice, so those rows pick by object identity (each ROW is its own pick).
2. **A fill, not the outline.** `is-selected` was NOT reused: it means the one row you
   drilled in from, and the engine scrolls the pane to it (`isSelected` → `reveal`). A block
   of ten picks must not drag the view around, and it must read next to that outline. New
   mark: the `data-picked` attribute, filled with the theme's `--title` at
   `--picked-strength` (skin, 14%). Theme role `--picked`, mixed once in themes.css.
3. **Song rows first, then tiles.** Tiles came in the second pass (below).
4. **The Queue and History are in too**, though they are off the collection engine.
5. **A count row.** While rows are picked, the Play / Shuffle row becomes
   *N songs · Play · Shuffle* (`picksRowHTML`). **No Clear button** (the user, 2026-09-15):
   a click on any row, or Escape, already drops the picks. The count **slides in on the
   first pick** and the two buttons shrink to make room. One animation does both: the count
   is `flex: 0 0 auto` and the buttons are `flex: 1`, so growing the count's `max-width`
   from 0 shrinks them in the same layout pass, with no second animation to keep in step. It
   runs on the first pick only (`is-entering` — a later pick just retypes the number, and
   re-running it every Ctrl+click would jitter the row). Reduced motion: no animation.
   The Queue and History have no such row, so their section label carries the count
   instead ("Up Next · 12 songs").
6. **Off in mini.** One narrow slot, nothing to drop into (`canPick()`).

What a picked set does:
- **Drags as one payload.** `DragPayload` already carried `tracks()` and `count`, because an
  album tile always did — so every drop target took a set on day one with no change. A drag
  off a picked row is always a COPY, never a reorder: a block of rows has no single new
  position. The ghost's count badge now shows for a song payload of more than one.
- **Right-click acts on the set.** The collection engine hands the picked tracks to
  `trackMenu`, so *Add to Playlist ▸ New Playlist…* builds a playlist from a hand-picked set
  in one gesture — the creation flow the review was after. The Queue's set menu is Add to
  Playlist + *Remove N songs* (removal walks the live indexes from the bottom up, so the
  rows still to go cannot shift). History's is Play / Play Next / Add to Queue / Add to
  Playlist.

### 19d. The second pass — everywhere else (2026-09-15, same day)

The four gaps left by 19c are closed. Multi-select now reaches **every list in the app**.

- **Tiles.** Albums and artists in the Library, and playlist rows on the Playlists overview.
  A picked set of albums plays each album in its own disc/track order, albums back to back;
  artists the same, each in album order; playlists each in their own order. `Grouping.pick`
  gained **`noun`** (the count says "3 albums", not "3 songs") and **`can`** (the Playlists
  overview is a mixed list — shelf and folder headers never pick, and a shift run steps over
  them). The count row now wins over `playAll`, so a grouping with no Play / Shuffle row of
  its own still shows the count while tiles are picked: the row arrives with the picks and
  leaves with them.
- **The Search card.** It has TWO song surfaces — the root's Songs results and a drill pane's
  track list — so one store reads whichever is on top (`activeList`), and a pane push, a pane
  pop or a new search term drops the picks. It never rebuilds a pane to repaint: a rebuild
  would refetch the collection, so `paintPicks()` re-marks the rows in place and swaps the
  pane's Play / Shuffle row for the count row (the original is kept in `paneActions`). The
  root has no such row, so its **Songs section title** carries the count instead. Tiles there
  (album, playlist, station) stay a drill or a play, not a pick.
- **The Rewind card.** Songs, albums and playlists pick; **artists do not** — "play an artist"
  has no obvious order here, which is why they already carry no menu and no drag. A stat or
  window change drops the picks. Its store is named `picks`, because `pick` already means the
  card's stat + window choice. A playlist row's songs still load lazily, at the menu pick.
- **Remove from Playlist for a set.** Offered on a hand-made playlist's rows. It resolves
  every picked row's position first, then deletes **from the bottom up**: each delete
  renumbers the rows below it, so a descending walk is the only order in which the positions
  still to go stay true. A failure puts the stored order back (`revalidate`).

**Where it is live, after 19d:** every song list in the app — the Library card (Songs, an
album, the artist view), its Albums and Artists tiles, the Playlists overview and a playlist's
rows, the Search card (results and drill panes), the Queue's Up Next, History, and Rewind.
Off in mini.

---

---

## 20. The volume pill grows in place — BUILT 2026-09-16 (fork A), awaiting the desk test

**What changed.** The Vol. pill no longer drops a flyout. It is a **full bar all the time**
(120 × 20; user's call after the first look, 2026-09-16): the mute speaker at its left end,
the fill as a horizontal slider across the whole bar (it sweeps under the squares, so 100 %
reaches the far end), the AirPlay square at its right end in every surface (max has a second
one on the stage row; both follow the same state). The wheel over the bar and the arrow keys
step 5 %; M mutes.

**Settings › Window › Shrink volume bar** (default off, key `volumeShrink`) brings back the
small 32 × 14 pill. It grows in place the way the menus open: in click mode a press on the
small pill grows it (and does not scrub), and a click away or Escape shrinks it; in hover mode
the pointer grows it and it shrinks 0.4 s after leaving. A drag or the open "Play on" panel
holds it either way. Reduced motion: the grow snaps.

**The forks (user, 2026-09-16: A).** A = no panel, everything in the grown pill. B = a
smaller panel (mute + AirPlay) still dropping on hover — two motions at once. C = the panel
on click — but a click on a slider should set the level, as the seek bar does.

**Code.** `index.html` (the pill is now a `role="slider"` div holding the three parts),
`main.ts` (the grow / shrink with a 400 ms grace, `makeSlider` on the track with `axis: "x"`;
the flyout's `makeDropdown` is gone), `styles.css` (`.vol__pill.is-grown`), `skin.css`
(`--vol-pill-grown-w / -h`, `--vol-pill-pad`, `--vol-grow`; `--vol-track-len` and
`--vol-panel-pad` are gone with the flyout). The fill rides the slider's own `--slider-fill`.
The grow is timed like a menu (`frames.during("menu", …, "volume")`). The tray panel and the
max stage row keep their own volume controls; only the title bar changed.

**Desk test.** The full bar shows at launch; drag it to 100 % (the fill reaches the far end,
under the AirPlay square); the wheel; Tab + arrows; M. Max: the bar's AirPlay square and the
stage row's show the same state. Settings › Window › Shrink volume bar on: the small pill;
click it (click mode) — it grows and the press does not move the level; click away — it
shrinks; open "Play on" from the grown pill and move into that panel — it stays. Menus set to
hover: hover grows it, leaving shrinks it after a moment. NP view: no pill (as before).

## 21. Fancy scrubbers — BUILT 2026-09-16, awaiting the desk test and a performance eval

The per-skin handle idea, redone. The plain masked handles stay as the off state; on
(Settings › Look and feel › **Fancy scrubber**, default on, key `fancyScrubber`) each skin
draws its own playhead over them:

| Skin | Playhead | Under the hand | While playing |
|---|---|---|---|
| Press | the I-beam: a 2 px stroke with an 8 px bar top and bottom, 14 px tall | the stroke thickens to 4 px and takes the `--ink-2` plate shadow | still |
| Ocean | the float: an 11 px teardrop, point up (smaller than the others so the ripple carries the eye) | dips 1 px and shrinks; rises on release | bobs 1.5 px, and a faint ripple ring spreads to 1.8× and fades, every 2.4 s |
| Glass | the hollow lens: a clear centre the rail passes through, a rim lit top-left in `--glint` and shaded bottom-right, a soft flare of light across the top-left; 14 px | swells 20 % | the flare drifts, 6 s each way |

**Second desk look.** The lens's specular dot was drawn in `--surface`, which is black on a
dark theme — a black dot on the lens. Light is white in every theme, so `themes.css` gains the
one role no theme remaps, **`--glint`** (a `light-dark()` white, dimmer on dark themes), and the
dot became a soft radial flare. The Ocean float shrank to 11 px and its ripple to 1.8× at 40 %.
| Retro-Future | the bolt | burns tight and bright; one flicker on release | a `--title` glow breathes, 3 s each way |

**First desk look (2026-09-16).** The first cut had a nib with a 4 px flag, a drop with a
same-color crest, and a lens with a `backdrop-filter`. Press read as a bare line, Ocean as the
base disc, Glass as a solid bead (over a flat canvas the backdrop had nothing to blur). All
three were 12 px on a 3 px rail. Redrawn as the table says, at 14 px, and the backdrop is
gone — which also removes the top frame suspect.

On every `.scrub`: the seek bar, the max stage volume, the Settings ranges. **Not** the
title-bar volume bar (user's call: its clean fill stays). Gates: `data-playing` on `<html>`
(new, main.ts), `data-dragging` / `data-released` on the slider (new, slider.ts), reduced
motion. The full map is [UI-ARCHITECTURE.md §3 SCRUBBERS](UI-ARCHITECTURE.md).

**Performance eval (next session).** Measure on `npm run dev:built` per CLAUDE.md's graphics
rules: frames ÷ ms with a skin's loop running against Fancy scrubber off. The Glass lens is
the one to watch (a `backdrop-filter` element that moves every progress tick); the bolt's
breathing `drop-shadow` is the other. If either costs frames, the fallbacks are a static
lens (no backdrop) and a glow on a pseudo-element.

**Desk test.** Each skin: play a song and watch the seek bar's handle; hover it; drag it;
release it. Glass: the lens over the album art. Settings › Fancy scrubber off: the plain
handles, no motion. Pause: every loop stops. The title-bar bar: no handle.

## See also
- [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) — deferred toggles (not features).
- [HANDOFF.md](HANDOFF.md) §Not built yet — the older not-built list.

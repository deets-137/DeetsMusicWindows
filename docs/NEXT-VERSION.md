# DeetsMusic — Next version (feature notes)

> Aditya's feature notes for the version after 0.2.2, captured 2026-09-11. This file is
> the **feature** backlog. It is not [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md), which holds
> deferred *toggles* for behavior that already ships.
>
> Each entry: what it means, what the code has today, the real forks (the options the code
> does not already rule out), and the Apple-call cost. Nothing here is designed or agreed.
> Pick one, design it on paper, then build.

| # | Feature | Cost to Apple | Needs new schema |
|---|---|---|---|
| 1 | Pin search terms | none | no |
| 2 | Playlist artwork | none, or low | yes (option c) |
| 3 | Favorite songs | low (one `PUT` per ♥) | yes (mirror) |
| 4 | Weekly replay playlists | none | no |
| 5 | Search shortcut / quick-access menu | none | no |
| 6 | Theme and skin switch animation (**agreed 2026-09-12**) | none | no |
| 7 | Album-colored Now Playing text + contrast guard (**agreed 2026-09-12**) | none | no |

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

**Cost.** Zero Apple calls. The tap re-runs a normal search.

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

**Cost.** Zero Apple calls for (a) and (b); the art is already cached.

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

**Cost.** One small `PUT` per ♥. (b) costs one playlist fetch, on the normal mirror path.

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

**My read.** (b) is the better buy at about the same build cost, because the width problem
in (a) comes back with every new shortcut.

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

## See also
- [FUTURE-SETTINGS.md](FUTURE-SETTINGS.md) — deferred toggles (not features).
- [HANDOFF.md](HANDOFF.md) §Not built yet — the older not-built list.

# DeetsMusic — DeetsOTD (Song of the Day)

> Mark one song per day; over time it becomes a **music diary** — a reverse-chronological record
> of the song that defined each day, optionally with a note on *why*. Fully **local, zero API
> cost**, and it rides systems we already have (the [card registry](SURFACES-AND-CARDS.md), the
> [context-menu primitive](UI-ARCHITECTURE.md#4a-the-collection-card-navigable-browser-engine),
> the `play_stats` sibling table in [library.rs](../src-tauri/src/library.rs)). Cross-links:
> [DEETS-REWIND.md](DEETS-REWIND.md) (stats surface it complements), [PLAYLISTS.md](PLAYLISTS.md)
> (the store the auto-playlist would ride). Status: ✅ decided · 🔵 open (my default unless you
> red-line) · ⬜ later.

---

## What it is (and what it isn't)

The *marking* is one small action; the **history is the feature**. A single slot per day, filled
with the song that mattered that day, accumulating into a scrollable diary you can replay and read
back. It is deliberately **not** a play-count or a favorites list — those are *behavioural*
signals ([play_stats](../src-tauri/src/library.rs) / [Rewind](DEETS-REWIND.md)). Song of the Day
is a **conscious, curated** signal: "*I* chose this, today." That distinction is the whole point,
and it's why it lives beside the stats, not inside them.

---

## Data model (trivially small)

```sql
CREATE TABLE IF NOT EXISTS song_of_day (
    date      TEXT PRIMARY KEY,   -- local calendar day, 'YYYY-MM-DD'
    track_id  TEXT NOT NULL,      -- catalog_id ?? library_id (the catalog-first canonical key, FAVORITES.md)
    marked_at INTEGER NOT NULL,   -- epoch-ms when set/last-changed
    note      TEXT                -- optional journal line ("why this song today"); nullable
);
```

- **PK on `date` ⇒ one per day**, and a re-mark is a plain **upsert** (last-write-wins). No extra
  conflict logic in the schema.
- **`track_id`** uses the **catalog-first canonical key** (`catalog_id ?? library_id`) decided in
  [FAVORITES.md](FAVORITES.md) — the rule `tracks` + `play_stats` adopt after that migration — so
  a diary row **joins to track metadata for free** (cover/title/artist via the track store). (If
  this ships *before* the migration lands, use catalog-first anyway; the track store indexes both
  ids, so the join works either way and the row needs no re-keying later.)
- **The day is the frontend's local calendar day.** The **frontend computes `YYYY-MM-DD`** (it
  knows the local timezone) and passes it to the command — Rust never guesses the day, mirroring how
  `record_play` takes ids from the caller rather than deriving them.

### Command (sibling to `record_play`)
`set_song_of_day(date, catalog_id?, library_id?, note?)` → upsert; returns the stored row.
`clear_song_of_day(date)` → delete (un-mark). `songs_of_day(from?, to?)` → the diary range for the
card. All **purely local — no Apple calls** (same shape/ethos as `record_play`).

---

## Marking a song

Two entry points, both riding existing surfaces — no new primitive:

- **Now Playing affordance (the hero).** A small **star** on the [Now Playing card](../src/now-playing-card.ts):
  most songs *become* the one while you're listening. State:
  - hollow → today's slot is empty **or** holds a different song; click sets the current song as
    today's.
  - filled → the current NP song **is** today's Song of the Day; click **clears** it (toggle).
  - The star is skin/theme-tokened like every other glyph (a `--icon-*` wrapper + a theme role),
    never a hardcoded color/size.
- **Right-click → "Mark as Song of the Day"** on any library / queue row — rides the existing
  `menu()` grouping accessor → [context-menu.ts](../src/context-menu.ts). The label reflects state:
  *"Mark as Song of the Day"* · *"★ Today's Song of the Day"* (already this song) · *"Replace
  today's Song of the Day"* (a different song is set).

**Re-mark within a day** = **silent replace, with a subtle "replaced — undo" toast** 🔵
(my default). Taste shifts through a day; the slot is last-wins, and undo covers the misclick.
(Alt: a confirm prompt — rejected as too heavy for a one-tap gesture.)

---

## The diary (the history card)

A **Song of the Day card** — a registry card, slot-pickable alongside Library/Queue/Playlists —
rendering the diary **reverse-chronologically**, grouped by month:

- Each row: **date · cover · title/artist · the note** (if any). Click a row → **play** that song.
- **Inline note editing** — tap the note to add/change the "why" for any day.
- **Backfill / edit past days** 🔵 (my default: **allowed**) — a forgotten day shouldn't be a
  permanent hole. Selecting a past/empty day opens a **track picker** (reuse library search /
  recently-played) to set or change that day's song. Backfill writes the same `set_song_of_day`
  with the chosen `date`.
- **Today's row is pinned at top** with an empty-state prompt if unset ("Pick today's song").

**Card engine choice** 🔵 — a **lightweight standalone renderer** (like the [Qcard](../src/qcard.ts))
is enough for MVP (a flat, month-grouped list). Reuse the **collection-card engine** instead *if*
we want search ("which day did I pick X?") + sort — a clean upgrade later, since the engine already
does play-on-click + scroll-restore. Recommend standalone for v1.

---

## Payoff hooks (extensions, not MVP)

- **"Songs of the Day" auto-collection** ⬜ — append each pick to a local **"Songs of the Day
  {year}"** playlist in the [local-first playlist store](PLAYLISTS.md); **Apple export stays gated
  + create/append-only**, exactly like every other playlist write (no special path). Or seed a
  **station** from the diary ("play my songs of the day"). Rides existing engines.
- **Rewind cross-link** ⬜ — a "**your songs of the day this month**" panel in
  [Deets-Rewind](DEETS-REWIND.md); the diary is a natural data source for the stats surface.
- **Streaks + a gentle daily nudge** ⬜ — "you've marked N days running" and an optional "pick
  today's song?" prompt, **off by default**, exposed as a [FUTURE-SETTINGS](FUTURE-SETTINGS.md)
  toggle. Deliberately opt-in — a music app shouldn't nag.

---

## Decisions

**Closed ✅**
- One slot per day (PK on local `YYYY-MM-DD`); re-mark = upsert (last-wins). Frontend supplies the
  day.
- Separate `song_of_day` table (a **curated** signal), distinct from behavioural `play_stats`;
  joins to track metadata via the shared key.
- Two mark gestures: NP **star** (toggle) + right-click action — both on existing surfaces.
- Diary = a slot-pickable card, reverse-chron, month-grouped, click-to-play.
- Purely local; playback + metadata reuse the existing player + track store; no Apple calls.

**Open 🔵 (my default noted)**
- **The note** — **in from v1** (my default: it's a nullable column + a text field, and it's what
  makes this a *diary*, not a list). Alt: hold for v1.1.
- **Backfill past days** — **allowed** (my default). Alt: today-only.
- **Re-mark UX** — **silent replace + undo toast** (my default). Alt: confirm prompt.
- **Card engine** — **standalone renderer** for v1 (my default); collection-card context if
  search/sort is wanted later.

---

## Risks / verify
- **Day-boundary correctness** — the day is *local*; compute `YYYY-MM-DD` on the frontend and pass
  it, so a user past local midnight marks the right day (and travel/DST can't shift it). Don't
  derive the day in Rust from a UTC clock.
- **Track identity churn** — a diary row stores the id at mark-time; if a library-only track later
  gains a catalog id (enrichment), the stored `library_id`-based key still resolves via the track
  store — but verify the join tolerates either id (same concern `play_stats` already handles).
- **Empty/orphaned entries** — a marked track removed from the library should still render from
  cached metadata (or degrade gracefully to "unavailable"), never break the diary render.
- **No new tokens smuggled in** — the star + diary rows reuse existing icon/row tokens; nothing
  hardcoded (doctrine canary).

---

## Build notes (file touches)
- `src-tauri/src/library.rs` — `song_of_day` table in `init_db`; `set_song_of_day` /
  `clear_song_of_day` / `songs_of_day` commands (model them on `record_play`).
- `src-tauri/src/lib.rs` — register the three commands.
- `src/now-playing-card.ts` — the star affordance + today's-state read.
- `src/library-card.ts` / the `menu()` accessors — the right-click action.
- `src/otd-card.ts` (new) + registry entry in `src/cards.ts` — the diary card.
- Styling under a new "Song of the Day" block in `styles.css` (theme roles + skin tokens only).

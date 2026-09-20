# DeetsMusic — Playlist refresh

> **Status (2026-09-19): PAPER DESIGN, NOT BUILT — but every fork is CLOSED.** The owner's ten
> decisions are in §3; §9 records how the last three were settled. What is left is the build.
> Every claim about the code was checked against the tree on this date.

Siblings: [PLAYLISTS.md](PLAYLISTS.md) (the store, the mirror, the export) ·
[TOASTS.md](TOASTS.md) · [SETTINGS.md](SETTINGS.md).

---

## 0. The bug this fixes

A mirrored Apple playlist caches its songs **once, forever**.

`apple_playlist_tracks` ([playlists.rs:1008](../src-tauri/src/playlists.rs)) is cache-first
with no time check: one row in the cache and it returns it, zero Apple calls. The only
automatic eviction is the once-per-session sync, and it evicts a playlist **only when that
playlist's flat-list JSON changed** ([playlists.rs:846](../src-tauri/src/playlists.rs)). The
code comment there already names the hole:

> A changed row is the staleness tell (no lastModified on the flat list) — note pure content
> edits don't change any attribute, hence the `fresh` knob.

Apple rewrites **New Music Mix** every Friday **without changing any attribute we read** —
same name, same description, same artwork, same count. The JSON is byte-identical, nothing
is evicted, and the card serves last Friday's songs. A restart does not help: the sync runs,
finds no change, and leaves the cache alone.

**The owner hit this on 2026-09-19.** Today the only fix is the **⟳** button in the
Playlists card header (`doSync(true)`), which drops *every* playlist's content cache.

The same hole covers every non-editable mirror whose songs change with no attribute change:
the personalised mixes, the smart playlists, and Apple's generated lists.

**Why the owner's own Apple playlists are NOT affected:** an edit you make in the Music app
bumps `lastModifiedDate`, which we do parse
([apple.rs:1643](../src-tauri/src/apple.rs)) and which is part of the compared JSON. So that
eviction path works. It is Apple's own machine-made lists that slip through.

---

## 1. Can we tell Apple's playlists from the user's?

Yes, and the card already shows the answer in its section headers: **Made Here · Your Apple
Playlists · Apple Mixes · Apple Replays · Saved from Apple Music**.

Every signal comes from the flat sync, no extra calls (PLAYLISTS.md §2,
[apple.rs:1620](../src-tauri/src/apple.rs)):

| What it is | The tell | `kind` |
|---|---|---|
| The user made it on Apple | `canEdit: true` | `user` |
| A catalog playlist in the library — Apple editorial, a curator, a personalised mix, a friend's | `canEdit: false` + `globalId` present | `catalog` |
| A smart playlist the user made in the desktop Music app (rules never exposed) | `canEdit: false`, no `globalId` | `smart` |

**The one thing `kind` cannot tell us:** Apple's *personalised mixes* (rewritten weekly) from
Apple *editorial* (static). Both are `catalog`. The card guesses from the name today —
`/\bmix$/i` ([playlists-card.ts:138](../src/playlists-card.ts)).

Apple's **catalog** Playlists resource does carry `attributes.playlistType`
(`personal-mix` · `replay` · `editorial` · `external` · `user-shared`), and one batched
`/v1/catalog/{sf}/playlists?ids=…` over the catalog mirrors' globalIds would classify the
whole library at once. **The owner declined that call (D4):** users' setups differ too much
for a type table to be worth a probe, and the refresh default keys on `kind`, not on the
name. So the `/\bmix$/i` regex stays where it is — the **cluster label** — and is **not
load-bearing for refresh**. That is the point of D4: nothing here depends on telling a mix
from an editorial list.

---

## 2. What the user sees

A right-click on a playlist row (or its detail hero) gains one row:

```
Refresh ▸        Daily
                 Weekly ▸      Mon Tue Wed Thu Fri Sat Sun
                 Off
```

The current choice rides the parent row as a badge — `Refresh ▸  Weekly · Fri`. The chosen
row inside the submenu is marked the same way.

**The control is a submenu (D1), not a split pill.** A split pill is what the owner drew
first, and it reads better in one glance, but the context-menu primitive has **no split, no
toggle and no checked state** — `MenuItem` is only `ActionItem | InputItem | SubmenuItem`
([context-menu.ts:48](../src/context-menu.ts)). A submenu is the same grammar as *Move to
Folder ▸* and *Add to Playlist ▸* already in this card, and `ActionItem.badge` (which carries
the Apple sigil today) shows the state for free.

**One risk to check at build time:** `SubmenuItem.sub` can return another `SubmenuItem`, so
*Weekly ▸* nests by the types. I could not find a second-level flyout anywhere in the app, so
its clamping and side-flipping are **untested**, not broken. Budget a little time for it.

---

## 3. Decided (the owner, 2026-09-19)

| # | Decision |
|---|---|
| **D1** | **A submenu**, not a split pill — *Refresh ▸ Daily · Weekly ▸ (Mon…Sun) · Off*, current choice as a badge. |
| **D2** | **Defaults by kind.** `catalog` → **Daily**. `user` (the owner's own Apple playlists) → **Off**. An exported local playlist → **Off**. |
| **D3** | **Every Apple mirror gets the row.** A local playlist that has been **exported at least once** also gets it, defaulting to Off. A local-only playlist does **not** — there is no remote copy to read. |
| **D4** | **No catalog probe.** No `playlistType` call (§1). Defaults key on `kind`. |
| **D5** | **Two triggers:** on **open** (lazy), and a **day-change check while the app is open**, which refreshes by itself. |
| **D6** | **One global off switch** in Settings › Playlists. |
| **D7** | **One toast per check.** It names the playlist and its detail when exactly one changed; it counts when more than one did. |
| **D8** | **A smart playlist defaults to Daily**, with `catalog` — Apple's rules rewrite its songs, and no attribute changes when they do. |
| **D9** | **An exported local playlist never writes by itself.** A refresh there **reads and offers**: a sticky toast with **[Get them]**. Nothing touches the user's playlist until he presses. |
| **D10** | **At most 25 refetches per day-change check**, run in sequence. The rest are left to the on-open trigger, which costs nothing extra. |

---

## 4. What "Daily" and "Weekly · Fri" mean

No scheduler, and no timer that fires while the app is shut.

Each covered playlist carries a `fetched_at` stamp. A playlist is **due** when:

- **Daily** — `fetched_at` is before the most recent local midnight.
- **Weekly · Fri** — `fetched_at` is before the most recent local Friday midnight.
- **Off** — never.

That is arithmetic both triggers compute, so the two paths can never disagree:

1. **On open (D5).** A due playlist refetches on the way in, before its rows draw. So an
   opened playlist is never stale. The cost of the lazy path alone is that the *overview*
   tile's count and mosaic stay stale until you open it — which is exactly what the second
   trigger fixes.
2. **On a day change, app open (D5).** Every due playlist refreshes by itself, so the
   overview is right before you click anything.

**How the day change is noticed.** Not a midnight timer — that dies on sleep, on a clock
change and on a timezone change. Instead the pattern `playlist-expiry.ts` already uses: a
check a minute after launch, then **hourly**, comparing the **local calendar date** with the
one the last check saw ([playlist-expiry.ts:64](../src/playlist-expiry.ts)). Plus a check
when the window becomes visible again, the way `look-schedule.ts` re-ticks after a resume
([look-schedule.ts:290](../src/look-schedule.ts)). A laptop that sleeps through midnight
catches up on the next tick or the next look.

This acts on its own, so by the CLAUDE.md checklist (item 6) it logs its **arm**, its
**fire** and its **off** through `diag.log("playlist:refresh", …)` — the arm at init with the
interval, each fire with how many were due and how many changed.

---

## 5. What a refresh actually does — two different things

This is the part the owner's D3 opened up, and the two halves are not the same risk.

| Covered playlist | The refresh | Risk |
|---|---|---|
| An **Apple mirror** (`user` · `catalog` · `smart`) | Drop that playlist's `apple_playlist_tracks` rows and refetch. One Apple read per 100 songs | **None.** The mirror is read-only; the cache is a cache |
| A **local playlist exported to Apple** | **A read only.** One Apple read, the diff computed, and a **sticky toast offering** the new songs (D9). The user's playlist is untouched until he presses **[Get them]** | **None.** Nothing is written unattended |

**D9 is why the second row is a read.** "Refresh" meaning "re-read a cache" and "refresh"
meaning "silently add songs to my playlist" are different promises, and only the first one is
safe to make while nobody is watching.

### 5.1 The read-only path does not exist yet

`playlist_get_apple_songs` ([playlists.rs:507](../src-tauri/src/playlists.rs)) reads **and**
writes: one Apple read, `export_diff`, then `append_local` behind a single
`if !tracks.is_empty()` at line 529. D9 needs that block skipped, so the command takes a
`dry_run: bool` and returns the **tracks** (not only their titles) when it is set.

**The offer must not cost a second Apple read.** The peeked tracks ride in the toast's own
closure, and **[Get them]** writes them with the existing local-only `playlist_add_tracks`.
So the whole gesture is **one** Apple read whether or not the user presses — the owner's
minimise-calls rule applied to his own D9. Calling `getNew` from the toast instead would read
Apple twice for one result.

`getNew`'s own toasts (TOASTS.md §5) stay exactly as they are: the automatic path never calls
it, so there is nothing to suppress. The manual *Apple Music ▸ Get New Songs* menu item is
untouched.

---

## 6. Where the preference lives

**Not on the mirror row.** `apple_playlists` is `DELETE`d whole and rebuilt on **every** sync
([playlists.rs:832](../src-tauri/src/playlists.rs)), so anything stored there is wiped weekly.

A new table, keyed on the playlist key, the way `playlist_folder_members` already survives
every sync:

```sql
CREATE TABLE IF NOT EXISTS playlist_refresh (
  playlist_key TEXT PRIMARY KEY,   -- a mirror's libraryId, or "local:<id>"
  mode         TEXT NOT NULL,      -- 'daily' | 'weekly' | 'off'
  weekday      INTEGER,            -- 0..6, weekly only
  fetched_at   INTEGER             -- ms; the staleness stamp
);
```

A row exists only once the user chooses something, or once a refresh has run. **No row means
the default for that playlist's kind** (D2), so a new mix Apple adds next month is on Daily
without anything being written.

A playlist deleted on Apple drops its row in the same sweep that already drops its folder
membership ([playlists.rs:886](../src-tauri/src/playlists.rs)).

---

## 7. The toasts (D7, D9)

**The stack caps at 3, and a sticky toast only yields once nothing timed is left**
(TOASTS.md §3). That constraint decides the shape: a check fires **at most two** toasts, never
one per playlist, or the notices would evict each other.

### 7.1 Mirrors that changed — one timed toast

`success`, `all` tier, the same shape as `replay.ts`'s *"Replay updated: N songs from this
week."*

| Case | Text |
|---|---|
| One playlist changed | *“New Music Mix” has 12 new songs.* |
| Several changed | *3 playlists updated.* |
| Due, refetched, nothing changed | **silent** — a daily "nothing changed" line is noise |
| A refetch failed | `warn`, and the playlist keeps its old cache **and its old stamp**, so the next trigger tries again |

"New songs" is counted honestly: songs in the new list that were not in the old one. A mix
replaces rather than appends, so this is the only count that means anything.

### 7.2 Exported local playlists with new songs — one sticky offer

`info`, sticky, with its own action — so it shows under **every** tier (TOASTS.md §4: a
question always shows) and never times out.

| Case | Text |
|---|---|
| One playlist | *“Road Trip” has 3 new songs on Apple Music.* **[Get them] [Dismiss]** |
| Two or three | *“Road Trip” (3) and “Gym” (1) have new songs on Apple Music.* **[Get them all] [Dismiss]** |
| More than three | *4 playlists have new songs on Apple Music.* **[Get them all] [Dismiss]** |

**One toast, not one per playlist** — forced by the cap above. **[Get them all]** writes every
peeked playlist with `playlist_add_tracks`, no further Apple call (§5.1). Dismiss writes
nothing and moves no stamp, so the next check offers again.

Five new rows in TOASTS.md §5.

## 8. The checklist (CLAUDE.md)

1. **Motion.** The submenu is the existing flyout; `.pop` + `enterRows` come with it.
2. **Tokens.** None new. The badge is `ActionItem.badge`, already styled.
2a. **Family.** The rows join the **menu row** family, whole. The badge joins the mark the
   Apple sigil already uses.
3. **Hints.** The `Refresh ▸` parent carries the `title`: *"How often DeetsMusic re-reads this
   playlist's songs from Apple Music."* One row in the ONBOARDING.md ledger, and the
   right-click coverage table gains the new item.
4. **Toasts.** §7 — five rows in TOASTS.md §5, and §7.2's sticky offer is a *question*, so it
   is admitted under every tier.
5. **Settings keys.** D6's switch — `playlistAutoRefresh` (boolean, default on) in
   `settings-store.ts` with its "why", a spec in `agent-settings.ts`, a line in AGENT.md, and
   a row in Settings › Playlists. Off stops **both** triggers; the per-playlist choices are
   remembered and resume when it is switched back on.
6. **Log lines.** §4: `diag.log("playlist:refresh", …)` for the arm, each fire, and off.
7. **Telemetry.** Nothing animates.
8. **Check.** `npx tsc --noEmit`, `npx vite build`, then the desk test in §10.
9. **Compass.** The Settings row is automatic (it names the store). Worth one verb row in
   `src/compass.ts`: *Refresh playlists now* → the existing `doSync(true)`. `SYNONYMS` gains
   "refresh", "stale", "update playlists". One line in COMPASS-TERMS.md.

---

## 9. How the last three forks closed (2026-09-19)

| Fork | The question | The owner's answer |
|---|---|---|
| **F1** | A smart playlist's default — Daily with `catalog`, or Off with the user's own? | **Daily** (→ D8). The test is who rewrites the songs, not who named the playlist |
| **F2** | On an exported local playlist, does an automatic refresh write? | **No — a sticky toast** (→ D9). It reads and offers; the user presses |
| **F3** | How many refetches at one day change? | **25 per check** (→ D10), in his words: *minimise calls, but you have to do what you have to do* |

**Decided inside D9, because the code and the toast cap forced it** — listed here so nothing
ships unseen:

1. The offer costs **one** Apple read, not two: `playlist_get_apple_songs` gains `dry_run` and
   returns the tracks, the toast holds them, and **[Get them]** writes locally (§5.1). Calling
   `getNew` from the toast would have read Apple a second time for a result already in hand.
2. **One** sticky toast per check, not one per playlist — the toast stack caps at 3 and sticky
   toasts hold it (§7.2). More than three playlists collapse to a count.
3. A dismissed offer **does not move the stamp**, so the next check offers again. A silently
   forgotten offer would be worse than a repeated one.

## 10. The desk test (after the build)

1. Right-click a mirror row → **Refresh ▸** shows, with the badge matching its kind's default
   (a catalog mirror reads *Daily*, one of your own Apple playlists reads *Off*).
2. Pick **Weekly ▸ Fri**. The badge reads *Weekly · Fri*. Re-open the menu — it still does.
   Restart the app — it still does (the §6 table, not the wiped `apple_playlists`).
3. **⟳** a full fresh sync, then re-open the menu: the choice survived the sync that deletes
   `apple_playlists`. This is the test that would catch the preference being stored wrong.
4. Set a catalog mirror's `fetched_at` back two days in SQLite, open the playlist: it refetches
   before the rows draw, and the toast names it if its songs changed.
5. Set three playlists back, then move the machine's clock forward one day with the app open:
   within the hour they refresh by themselves and **one** toast says *3 playlists updated*.
6. Same, with one playlist: the toast names it and its new-song count.
7. Due, refetched, nothing changed → **no toast at all** (§7).
8. Settings › Playlists → the global switch off. Move the clock forward: nothing refreshes, no
   toast. Open a due playlist: it does not refetch. Switch it back on: the per-playlist choices
   are still there.
9. Pull the network, then open a due playlist: a `warn`, the old songs still show, and the
   stamp did not move, so the next open tries again.
10. A local-only playlist has **no** Refresh row. Export it to Apple once — the row appears,
    reading *Off* (D3).
11. An exported local playlist set to Daily, with a song added to its Apple copy elsewhere: the
    check **offers** with a sticky toast and the local playlist is **unchanged** (D9). Press
    **[Get them]** — the songs land, and the network shows **no second Apple read** (§5.1).
    Dismiss instead, and the next check offers again.
12. Thirty due catalog mirrors at one day change: 25 refetch, one toast counts them, and the
    remaining five refetch when opened (D10).
13. `npx tsc --noEmit` and `npx vite build` clean.

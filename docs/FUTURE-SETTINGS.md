# DeetsMusic — Future Settings (deferred toggles)

> A ledger of behaviors we've **deliberately hardcoded for now** but intend to expose
> as user-configurable settings later. When a design choice has a defensible default
> *and* a reasonable person could want the opposite, we record it here instead of
> agonizing — pick a default, ship, and note it so the alternative isn't lost.
>
> Each entry: the behavior, the options, the current hardcoded default, where the
> toggle would live, and any wiring notes. **The pattern for a shipped setting is now the
> Settings card + the `deets.settings` store — see [SETTINGS.md](SETTINGS.md)** (2026-09-10;
> the old title-menu `.menu__row--toggle` idiom is retired for preferences).
>
> **Built into the Settings card 2026-09-10 (v1 cut):** §1 (`playNowScope`), §4
> (`previousReach`), §5a (`shuffleManual`), §5b (`shuffleIdle`), §7 (`fullPlayRule`),
> §8's auto-flip toggle (`surfaceAutoFlip`), §14 (`playlistEagerCounts`), §16
> (`playlistCreateSummon`). §17's resume is the default since the radio UX pass. The
> entries below stay as the design record; SETTINGS.md §3 is the live table.
>
> **Section numbers are stable IDs** (assigned in creation order and referenced from source
> comments + other docs — e.g. `stats.ts` → §7, `surface.ts` → §8, `layout-bus.ts` → §10), so
> new entries **append**; don't renumber. For triage, read by the topic groups below, not by
> number order.

### Grouped by topic (for triage)
- **Menus & context-menu actions** — §1 "Play Now" scope · §2 Queue menu actions & order ·
  §6 Menu caret affordance (click vs hover) · §9 Per-menu open mode (hover vs click) ·
  §20 Drill-in target (in-place vs Search card)
- **Playback** — §4 "Previous" reach · §5 Shuffle behavior
- **Queue & layout interaction** — §3 Qcard drag initiation · §10 Queue summon (flip vs no-op)
- **Stats** — §7 Listened-through threshold
- **Library** — §21 Sync cadence (full pass every 6 h; incremental at startup)
- **Window / surface** — §8 Surface switching
- **Skin looks** — §11 Title underline behavior · §12 Glass pop intensity (skin-specific) ·
  §13 Retro-Future storm dials (skin-specific)
- **Playlists** — §14 Eager playlist-count backfill · §15 Add-to-Playlist submenu sort ·
  §16 New-Playlist Search summon
- **Radio** — §17 Resume station after break-out
- **Feedback & notices** — §18 Quiet-failure feedback (toast system) — **built, [TOASTS.md](TOASTS.md)**

---

## 1. "Play Now" scope (right-click menu)

**Behavior.** What the right-click **Play Now** action queues after the selected song.

**Options.**
- **(a) Just this song** — plays only the selected track as a single-song context;
  whatever was queued is replaced. *(the default until 2026-09-10)*
- **(b) This song, then the rest of the list** — plays the selected track and queues
  the remainder of the current sorted/filtered list from that point (this is what a
  **left-click** on a song does today). ***(current default — built as the Settings
  card's "Play Now plays" row, `playNowScope`, 2026-09-10; user's call.)***

**Current behavior (hardcoded, as built):**
- **left-click** a song → **(b)**: plays it and queues the rest of the current list from
  that point, snapshotting the list as sorted/filtered *at click time*. This is the
  long-standing behavior and we kept it.
- **right-click → Play Now** → **(a)**: plays only the selected song
  (`playContext([handle], 0)`), replacing the queue.

So the two gestures express *different intents* by design:
- **left-click** = "play this list, starting here" (DJ the list)
- **right-click → Play Now** = "just play this one thing now" (interject)

**What the future toggle changes.** Let the user customize either gesture's scope to
their liking — e.g. make right-click Play Now also queue the rest, or make left-click
play just the one song. The intents above are the *defaults*, not a fixed law.

**Open questions to settle when we build the setting.**
- One global preference, or per-gesture (left-click scope vs Play Now scope independently)?
- If a gesture queues "the rest," keep the snapshot semantics (matches today) — confirmed
  for left-click; apply the same to any gesture set to queue-the-rest.

**Wiring sketch.** `localStorage` key(s) e.g. `deets.playNowScope` / `deets.songClickScope`
= `"song" | "list"`; a toggle row (or, as settings grow, a small "Playback" subsection).
Defaults: Play Now `"song"`, left-click `"list"`.

**Sibling (added 2026-07-01): Search-result tap scope.** A song tap in the Search card plays
**just the one** (decided — a discovery surface interjects). The alternative — play it and
queue the rest of the song results — is this same setting family: e.g.
`deets.searchTapScope` = `"song" | "list"`, default `"song"`.

---

## 2. Queue right-click menu — actions & order

**Behavior.** Which actions the **queue** (Up Next) context menu offers, and in what order.

**Current default (hardcoded):** Play Now · Move to Top · Move to Bottom · Remove.

**What the future setting changes.** Let the user choose which of these appear, reorder
them, and opt into extras as they land (e.g. Add to Library, Go to Album / Artist, Add to
Playlist). Likely a small checklist/reorder UI rather than a single toggle.

**Notes.** The library row menu (Play Now / Play Next / Add to Queue) is a sibling that
will want the same treatment — a shared "which actions, what order" model keyed by surface
(`library-row` vs `queue-row`). `localStorage`, e.g. `deets.menu.queue` = ordered action ids.

---

## 3. Qcard drag initiation

**Behavior.** How a drag-to-reorder starts on an Up Next row.

**Current default (hardcoded):** **whole-row press-and-drag** — press and move past a ~6px
threshold to drag; a quick click still plays (jumps to) the row. No separate handle.

**What the future setting changes.** Offer a **dedicated grip handle** (a `⋮⋮` affordance on
each row) as an alternative — unambiguous, and friendlier for touch where vertical drag
competes with scroll. Whole-row is cleaner on the narrow card for mouse users; the handle
trades a little clutter for clarity. Likely a single toggle (`deets.qcard.dragMode` =
`"row" | "handle"`), defaulting to `"row"`.

---

## 4. "Previous" reach — context lookback vs. heard-only

**Behavior.** What the **Previous** button is allowed to walk back into.

**Current default (hardcoded).** The two-layer history (see [QUEUE.md](QUEUE.md)): a durable
**heard trail** (songs actually played, surviving across contexts) *plus* a **parked
lookback** — the tracks that sat *before* the one you clicked in a list, seeded so Previous
can rewind "up" into them even though you jumped into the middle. Previous pops the
most-recently-*heard* song first, then descends into the lookback. Starting a new context
discards the prior context's *unheard* lookback (anything you did hear stays in the trail).

**Options.**
- **(a) Context lookback** — Previous can rewind into the not-yet-heard tracks above your
  click within the current list. *(current default — "rewind the list I'm in")*
- **(b) Heard-only** — Previous walks strictly the songs you actually listened to; clicking
  into the middle of a list and pressing Previous goes to the last thing you *heard*, not the
  row above the click ("step back through my listening history").

**What the future toggle changes.** Lets the user pick which mental model Previous follows.
Both are defensible; we shipped (a). Implementation note: the lookback is *seeded* in
`setContext` ([queue.ts](../src/queue.ts)) — option (b) is simply "don't seed the parked
lookback," leaving only the heard trail.

**Related sub-knob.** `prevTrack` ([player.ts](../src/player.ts)) restarts the current song
if you're past **3 s** in, otherwise skips back. That threshold (and whether to restart at
all vs. always skip) is a smaller, related setting.

**Wiring sketch.** `localStorage` `deets.previousReach` = `"lookback" | "heard"`; restart
threshold e.g. `deets.prevRestartSecs` (default `3`).

---

## 5. Shuffle behavior

**Shipped (2026-07-02): the one-shot shuffle button** on the NP card's transport row
(`shuffleQueue` in [player.ts](../src/player.ts) → `shuffleUpcoming` in
[queue.ts](../src/queue.ts), synced to MusicKit via `reconcileUpcoming` — gapless, no
rebuild). This is a *one-time reorder action*, **not** the P6 persistent shuffle **mode**
(see below). Two behaviors were hardcoded and each is a future setting:

**5a. Manual picks on shuffle — placement rule.**
- **(current default) Manual-to-top** — every `manual` entry (Play-Next *and* Add-to-Queue)
  rises to the top of upcoming, relative order kept; the `auto` tail shuffles below. Your
  explicit picks are promises — shuffle keeps them next.
- Alternatives for the setting: **hold-slots** (manual entries keep their exact positions,
  autos permute around them) and **mix-everything** (one flat shuffle, origins ignored).
- Wiring: `deets.shuffle.manual` = `"top" | "hold" | "mix"` (default `"top"`), read in
  `queue.shuffleUpcoming`.

**5b. Idle press — bootstrap vs no-op.**
- **(current default) Play the library shuffled** — with nothing playing, the button
  shuffles the entire cached library (client-side, no extra API calls) and plays it as a
  fresh context.
- Alternative: **no-op** (the button only ever acts on an existing queue).
- Wiring: `deets.shuffle.idle` = `"library" | "noop"` (default `"library"`), read in
  `player.shuffleQueue`.

**Still future (P6): the persistent shuffle MODE** (Apple Music/Spotify-style sticky
toggle — future contexts start shuffled). To pin down when built: whether un-shuffling
**restores** the original context order (Apple Music) or leaves the shuffled order
(Spotify); whether toggling it on mid-playback reshuffles the live `auto` tail or only
affects the *next* context. The one-shot button is the natural host for the mode (press
becomes toggle) — record the chosen defaults here when P6 lands.

---

## 6. Menu caret affordance (click vs hover mode)

**Behavior.** Whether menu triggers — the slot-card pickers (a content slot's title) and,
by extension, the titlebar dropdowns — show a caret/chevron hinting they open a menu.

**Current (hardcoded):** **no caret anywhere** — triggers are plain text (the slot title
matches the DeetsMusic settings title).

**What to build later.** In **click** mode a caret helps signal the trigger is interactive
(you have to click to discover it); in **hover** mode it's unnecessary (hovering reveals the
menu), so suppress it. So: show a caret when `deets.menuMode === "click"`, hide it in hover
mode. Apply to the slot-picker titles first (the discoverability gap is sharpest there since
they look like ordinary headings); optionally extend to the settings/volume triggers. Drive
it off the mode the dropdown primitive already tracks (`setDropdownMode`) — e.g. a
`data-menu-mode` attribute on `<html>` (or a class on the trigger) that the caret CSS keys
off, so it flips with the Hover-Menu toggle and needs no per-trigger JS.

---

## 7. Listened-through threshold (play-count "full")

**Behavior.** How much of a track must play for it to count as a **full** ("listened
through") play in the listening stats. The companion **partial** count fires when a song
*starts* (becomes now-playing) and is not configurable — it's the definition of a start.

**Current default (hardcoded):** **90%** — `FULL_THRESHOLD = 0.9` in
[`src/stats.ts`](../src/stats.ts). Crossing 0.9 of the track's duration credits one full
play (latched per play, so seeking past/back over the mark counts once). Robust to skipping
the outro.

**Options.**
- **(a) Fraction threshold** — counts at *N%* of the track. *(current default, N = 90)*
- **(b) Strict end-of-track** — only a natural finish counts (skipping the last seconds
  doesn't; seeking won't trigger it).
- **(c) Scrobble rule (Last.fm)** — counts once you've heard **≥50%** *or* **≥4 min**,
  whichever comes first — kinder to long tracks.

**What the future setting changes.** Lets the user pick the definition (and, for (a), the
percentage). Both partial and full are stored per track in SQLite (`play_stats`); only the
**full** trigger's rule changes — the recording plumbing and schema stay put.

**Wiring sketch.** `localStorage` `deets.stats.fullThreshold` (a `0..1` fraction for mode
(a)) and/or `deets.stats.fullMode` = `"fraction" | "end" | "scrobble"`, read in
`src/stats.ts` (replace the `FULL_THRESHOLD` constant + the `recordProgress` comparison).
Likely a small **Playback** / **Stats** subsection in the settings menu once one exists.

---

## 8. Surface switching — trigger & resize allowance

**Behavior.** How the app moves between the three surfaces (`mini` / `midi` / `max`; see
[SURFACES-AND-CARDS.md](SURFACES-AND-CARDS.md) §4) and how much free window resizing is
tolerated before the surface *flips*.

**Decided model (the default to build toward).**
- **Surface is a deliberate user choice**, not a pure function of window size. The user
  picks the surface (a control — likely the title menu, plus mini via the minimize button),
  and each surface has its **own remembered window size**.
- **Within a surface, the user may freely resize inside an allowance band.** Resizing stays
  in the current surface until the window crosses that surface's threshold, at which point it
  **snaps to the adjacent surface** (shrink past mini's floor → still mini but clamped;
  grow past midi's ceiling → max; shrink past midi's floor → mini). So resize is forgiving
  in the middle and only flips at the edges — no jitter around a single breakpoint.

**What the setting captures (this is the part to build as configurable):**
- **Per-surface size band** — min/max width & height (and/or aspect) that define where each
  surface lives and where the flip thresholds sit. These are the numbers we'll otherwise
  hardcode; the setting exposes them (or at least a coarse "compact / roomy" preset).
- **Auto-flip on resize: on/off** — whether crossing a threshold flips the surface at all,
  or whether surface only ever changes by explicit selection (resize then just clamps to the
  current surface's band). Some users will want the window to *stay put* in the surface they
  chose.
- **Hysteresis / allowance width** — how far past a threshold you must drag before it flips
  (dead-band), so a surface doesn't oscillate when you hover the boundary.

**Current default (hardcoded, once Phase 3 lands):** deliberate selection + a single
hardcoded per-surface band with auto-flip **on** and a small hysteresis. No UI yet.

**Wiring sketch.** `src/surface.ts` owns the `ResizeObserver` and the band table. Persist
the chosen surface + each surface's last window size (`deets.surface` = `"mini"|"midi"|"max"`,
`deets.surface.size.{mini,midi,max}`); the configurable bands live under e.g.
`deets.surface.bands` and `deets.surface.autoFlip`. Read them where `surface.ts` computes the
active surface from size. A **Window / Layout** settings subsection would host the toggle +
(advanced) the band editor.

---

## 9. Per-menu open mode (hover vs click granularity)

**Behavior.** Which menus/popovers open on **hover** vs on **click**. Today this is one
**global** switch — the **Hover-Menu** toggle calls `setDropdownMode` ([dropdown.ts](../src/dropdown.ts)),
which fans a single mode out to *every* live dropdown (settings menu, volume flyout,
slot-card pickers, and now the Search card's category filter). All menus move together.

**Current default (hardcoded):** **one mode for all** — flip Hover-Menu and every dropdown
becomes hover (or click) at once; default **click**.

**What the future setting changes.** Let the mode be set **per menu** (or per menu *class*),
so a user can have, say, the lightweight titlebar/volume flyouts on **hover** while
heavier or destructive-adjacent menus (or the Search filter, which sits right next to a
text field you're actively typing in) stay on **click** — and vice-versa. The global toggle
stays as the default/bulk control; per-menu overrides layer on top.

**Why it fits cleanly.** The primitive already carries a *per-instance* `mode` with its own
`setMode(...)` — the global fan-out just overwrites them all. Granularity is "stop blasting
every instance and let some keep an overridden mode." Each `makeDropdown` call site is
already a natural key (settings / volume / slot-picker / search-filter).

**Wiring sketch.** Give `makeDropdown` an optional stable `id`; persist overrides as a small
map, e.g. `deets.menuMode.overrides` = `{ "search-filter": "click", ... }`, with the global
`deets.menuMode` as the fallback. `setDropdownMode(global)` applies to instances *without* an
override; a per-menu control (or a small settings list of known menus) writes the map and
calls that instance's `setMode`. Ties into §6 (the caret affordance would then key off each
menu's *effective* mode, not just the global one).

---

## 10. Queue summon — flip vs no-op when Queue is already visible

**Behavior.** What the NP card's **queue button** does when the Queue card is *already
on-screen* in one of the two content slots. (When it's off-screen the button always mounts
it into the least-recently-touched slot — that part isn't in question.)

**Options.**
- **(a) Flip** — Queue takes over the least-recently-touched slot anyway; the displaced
  card moves to Queue's old slot (the two slots exchange). The button always visibly does
  something. *(current default)*
- **(b) No-op** — Queue is already visible, so pressing the button does nothing (optionally
  a brief pulse on the Queue card to acknowledge the press).

**Current default (hardcoded):** **(a) flip** — `setSlot(lruSlot(), "queue")` in
[`src/layout.ts`](../src/layout.ts); the exchange branch of `setSlot` provides the flip for
free. Note both slots remount on a flip, so a drilled card in *either* slot returns to root.

**Wiring sketch.** `localStorage` `deets.summonFlip` = `"flip" | "noop"` (default `"flip"`),
read in the `onCardRequest` handler in `layout.ts`: for `"noop"`, return early when the
requested card is already in `layout.left`/`layout.right`. If (b) grows the acknowledgment
pulse, that's a skin motion token, not a color.

---

## 11. Title underline behavior (always / hover / off)

**Behavior.** Vanilla draws an **editorial underline** under the app title and the card
titles (`--title-underline` + `-w` / `-offset` skin tokens; base is a no-op, Vanilla opts
in — the ink is `currentColor` = `--title`, so the theme owns the color). When it should
*show* is a taste knob: constant rule, hover-only affordance, or off.

**Options.**
- **(a) Always** — a permanent typographic rule; part of the skin's identity. *(current default)*
- **(b) On hover** — the underline becomes the hover affordance (could then drop the
  `--surface-hover` wash on `.app-title` for an even quieter titlebar).
- **(c) Off** — suppress it even where the skin opts in.

**Current default (hardcoded):** **(a) always**, and only under Vanilla.

**Wiring sketch.** `localStorage` `deets.titleUnderline` = `"always" | "hover" | "off"`
(default `"always"`), applied as `data-underline` on `<html>` next to `data-theme`/`data-skin`.
CSS gates the *line* only — `[data-underline="off"]` zeroes `text-decoration-line`;
`[data-underline="hover"]` zeroes it at rest and restores `var(--title-underline)` on
`:hover`/`:focus-visible` of `.app-title` / `.panel__title.is-pickable` (a static panel title
has no hover concept — hover mode simply hides its rule). The skin tokens stay the single
source of *shape*; the setting only picks *when* they apply, so every skin that later opts
in gets the toggle for free.

---

## 12. Glass pop intensity — the tunable numbers

**Tag: skin-specific (Glass).** Unlike §1–11 (app behaviors), these are *aesthetic
intensity knobs of one skin*, hardcoded in the `[data-skin="glass"]` block. If a
"skin options" settings surface ever exists, these are its first tenants; they'd apply
only while Glass is active.

**The knobs (2026-07-02 "pop" batch values):**
- **Frost saturation** — `--panel-backdrop: blur(14px) saturate(1.5)` (was 1.3).
- **Canvas aurora heat** — the three blob mixes, now `50/44/38%` (was `38/34/30%`).
  "Polite" ≈ the old values; "vivid" ≈ current.
- **Aurora drift** — `--canvas-anim: aurora-drift 60s ease-in-out infinite`
  (speed/off are the obvious toggles; `prefers-reduced-motion` already forces off).
- **Album aurora** — `--album-aurora-reach: 3.5`, `--album-spin-dur: 30s`
  (base 3 / 48s; strength 52% unchanged).
- **Menu frost** — `--menu-surface` at 65% alpha + `--menu-backdrop: blur(16px)
  saturate(1.4)`. Menus are deliberately milkier than panels (55%) for text legibility.

**Wiring sketch.** No per-knob toggles — if exposed, a single **intensity preset**
(`deets.glass.pop` = `"calm" | "vivid"`, default `"vivid"`) applied as a `data-` attr
that swaps the token values in one `[data-skin="glass"][data-glass-pop="calm"]` block.
Per-knob granularity is a rabbit hole; two curated presets is the honest setting.

---

## 13. Retro-Future storm dials — the tunable numbers

**Tag: skin-specific (Retro-Future).** Same species as §12: aesthetic intensity knobs of
one skin, hardcoded in the `[data-skin="retro-future"]` block (+ the `storm-strike`
keyframes and `src/storm.ts`). Tenants of the same future "skin options" surface;
apply only while Retro-Future is active.

**The knobs (initial 2026-07-02 values):**
- **Strike cycles** — `--storm-cycle-1: 8s` / `--storm-cycle-2: 12s`. The draw phase is
  60% of the cycle (fixed in the `storm-strike` keyframes), so the bolts crawl down in
  ~4.8s / ~7.2s — the agreed "5-second" feel. Faster storm = shorter cycles; the
  keyframe *percentages* (draw span, flicker, dark window) are a deeper cut of the
  same dial.
- **Glow radius/heat** — `--storm-glow: drop-shadow(0 0 6px color-mix(in srgb,
  var(--title) 60%, transparent))`. 6px/60% is "present but not neon".
- **Stroke width** — `--storm-w: 2px` (non-scaling, so it's a true px).
- **Panel translucency** — `--panel: color-mix(in srgb, var(--canvas) 86%,
  transparent)`. The 14% window is what lets a bolt glow *through* a card; 100%
  (opaque) confines the storm to the gutters, lower mixes trade text contrast for
  drama.
- **Bolt count** — two `<path>`s in the markup today. More bolts = more markup + one
  `nth-child` rule each, not a token; noted so "make it a real storm" has a home.
- **Bolt shape / branching** — each `--storm-path-N` is a **forked channel**: a main trunk
  plus branch detours drawn as out-and-back **retraces**, kept a single continuous subpath
  so the top-down draw-on stays one clean wipe (separate `M` subpaths fragment the reveal —
  `stroke-dasharray` restarts per subpath). Fork count, branch length, and jag irregularity
  are pure geometry edits to the two path tokens; forks inherit the trunk's stroke width
  (**tapered branches** would need separate `<path>` children with their own `--storm-w` +
  staggered `animation-delay` — the one shape change that isn't a token-only edit).
- **Position scatter** — `storm.ts` rolls 8..92 viewBox units + a coin-flip mirror.
- **Two-tone option (decided against for now)** — both bolts strike in `--title`;
  the runner-up was bolt 2 in an accent role (`--pause`). A one-line change in the
  `.storm__bolt:nth-child(2)` ink if it ever becomes a preference.

**Wiring sketch.** Like §12: a single preset (`deets.retro-future.storm` =
`"distant" | "overhead"`, default `"distant"`) as a `data-` attr swapping cycle/glow/
translucency values in one block — not per-knob controls.

---

## 14. Eager playlist-count backfill

**Tag: behavior, default ON.** The Playlists overview shows "N songs" under each tile —
but Apple's library-playlists *list* endpoint carries **no track count** (and rejects the
`extend` / `include=tracks` / `fields[…]` tricks with HTTP 400 — probed 2026-07-02). A
count is only knowable by asking a playlist's tracks relationship. So on overview open,
the card **eagerly backfills** the missing counts: one tiny `tracks?limit=1` call per
uncounted playlist (reads `meta.total`, not the contents), persisted onto the row — a
playlist is counted **once ever**, then served from cache with zero Apple calls. Fills in
a second or two after the card opens; opening a playlist still learns its count the
accurate (song-only) way regardless.

**The knob:** `deets.playlists.eagerCounts` (localStorage, default eager) — set to `"off"`
to skip the backfill and leave uncounted tiles reading **"Playlist"** until the user opens
them (the pre-2026-07-02 behavior). A privacy/stewardship-minded user who doesn't want the
one-time N-call burst can opt out; everyone else gets counts for free.

**Cost:** ~one lightweight call per *uncounted* playlist, once (N = playlists never opened;
for a ~50-playlist library, ~50 tiny calls the first time, `buffer_unordered(5)` polite),
then never again. Not a per-session cost.

**Caveat (known, minor):** `meta.total` counts **all** playlist items including music
videos, while the drill-in count is **songs-only** (we skip videos). A playlist with videos
can read e.g. "100 songs" on the overview and "98 songs" once opened. Rare in library
playlists and small; filtering it out would defeat the cheap probe (it needs the full
track list), so we accept the drift. If it ever matters, the fix is a "songs only" vs
"all items" label choice, not more fetching.

**Wiring:** the eager path is `apple_playlist_counts` (Rust, `src-tauri/src/playlists.rs`);
the front-end gate is the one `localStorage` read in `src/playlists-card.ts`. Graduating it
to a real toggle is a checkbox in the (future) Playlists settings that writes the key.

---

## 15. Add-to-Playlist submenu — target-list sort

**Behavior.** The order of the local playlists listed in the **Add to Playlist ▸**
submenu (on song / album / playlist right-click menus).

**Current default (hardcoded):** **Recently Added first** — sorted by `date_added`
descending (for locals that's creation time, serialized from `created_at`). Rationale:
the playlist you're actively filling is almost always the one you just created, so it
sits at the top where the repeated add-add-add gesture is cheapest.

**Options.**
- **(a) Recently Added first** *(current default)* — best for the create-then-fill burst.
- **(b) A–Z** — stable positions; better once the playlist set is large and long-lived
  (muscle memory beats recency).
- **(c) Recently Updated first** — the playlists you're *using* bubble up even if old.
  Needs `updated_at` surfaced onto the model (it's already stored in `local_playlists`
  and bumped by add/remove/reorder/rename); Apple mirrors would need `lastModified`,
  which the flat sync doesn't carry — but mirrors are never add-targets, so this is
  locals-only and cheap.

**Wiring sketch.** `localStorage` `deets.playlists.addMenuSort` = `"added" | "az" |
"updated"` (default `"added"`), read where the submenu items are built. A Playlists
settings subsection tenant alongside §14.

---

## 16. New-Playlist flow — Search card summon

**Behavior.** Committing a name in the **New Playlist (+)** dropdown drills into the
fresh playlist's empty detail **and force-summons the Search card** into the other
content slot (`requestCard("search")` in `src/playlists-card.ts` — the same
least-recently-touched/flip mechanics as the NP queue button, §10).

**Current default (hardcoded):** **summon ON** — the whole flow is choreographed to
land you in "empty playlist here, Search beside it, start adding." But it *does*
commandeer the other slot, evicting whatever card was there (and a flip remounts both
slots, dropping any drilled-in state) — a user who creates playlists ahead of filling
them, or who curates from the Library card instead of Search, may want the slots left
alone.

**Options.**
- **(a) Summon Search** *(current default)* — create → drill → Search appears.
- **(b) No summon** — create → drill only; the other slot keeps whatever it had.

**Wiring sketch.** `localStorage` `deets.playlists.createSummon` = `"search" | "none"`
(default `"search"`), read at the `requestCard("search")` call in `createAndEnter`
(`src/playlists-card.ts`). A Playlists settings tenant alongside §14/§15. If the §10
summon behavior ever grows options, this should follow the same vocabulary.

---

## 17. Radio break-out — resume the station after the manual queue ends

**Behavior.** What happens when the **break-out block** finishes. Queueing songs while
an Apple station plays (Play Next / Add to Queue) defers a **break-out**: the block
waits for the current station song to end, then takes over as a normal finite queue
(STATIONS.md §1 — decided 2026-07-03).

**Current default (built 2026-09-10, the radio UX pass): (b) resume the station.** The
Qcard shows the station as the row *after* the block ("Resumes after the queue"), and a
right-click **"Don't resume"** on that row is the per-instance opt-out. The toggle below
would make (a) the standing default for users who never want the return.

**Options.**
- **(a) Stop when the block ends** — predictable; radio was left.
- **(b) Resume the station** *(current default)* — the interrupted station re-enters when
  the block's last song ends ("play these three songs, then back to my station").
  Built as: `player.ts` remembers the interrupted `Station` at break-out
  (`resumeStation`), and `maybeResumeStation` on the end-of-queue moment (model
  `upcoming` empty + MusicKit `completed`/`ended`) calls
  `playStation` again. The re-entry rebuilds the station queue, so there's a boundary
  buffer — same as the break-out itself.

**Wiring sketch.** `localStorage` `deets.radio.resumeAfterBreakout` = `"off" | "on"`
(default `"off"`), read where the break-out swaps engines (`onNowPlayingChange`'s radio
branch in `src/player.ts` — stash the station there; act on it at queue exhaustion). A
Radio settings tenant.

---

## 18. Quiet-failure feedback — the toast system

> **BUILT 2026-09-13 — see [TOASTS.md](TOASTS.md)** (the spec, the sticky rule, every call
> site, and what was investigated and not built). Setting: `toasts` = `failures` (default)
> · `all` · `off`, Settings › Window › Show notices. Decisions taken that day: mini/midi
> bottom-centred, max top-right; a stack of 3; `error` sticky by default; notices show under
> `failures`. The text below is the design history, kept for the "why".

**Behavior.** How the app tells the user a menu action quietly did nothing. Today every
"couldn't do it" lands in the console only — the user just sees nothing happen. The
motivating case (2026-07-03): **Start Station** on a seed with no Apple station
(`startStationItem` in [start-station.ts](../src/start-station.ts) — a rare but real
click-and-nothing-happens). Same species: a failed enqueue/play from a menu, a failed
Add to Library, a failed playlist write — all `console.error`/`warn` today.

**Current default (hardcoded):** **silent** — a `console.warn`/`error`, no visible surface.

**What to build later.** A small **toast/notice primitive** (one transient, self-dismissing
strip — likely bottom of the window, sibling of the context-menu/dropdown primitives; all
geometry/motion through skin tokens, color through theme roles). Then route the known quiet
failures through it. This is *capability first, setting second*: the entry exists so the
alternative isn't lost, and because once toasts exist, "how chatty" is a real preference.

**Options (once the primitive exists).**
- **(a) Failures only** — toasts appear only when an action couldn't do what it said.
  *(the sensible default)*
- **(b) Silent (off)** — keep today's console-only behavior; a user who never wants
  transient UI can opt out.
- **(c) Failures + confirmations** — also acknowledge fire-and-forget successes (e.g.
  "Added to Library") — the chattiest tier; pairs with FAVORITES.md's silent-success
  doctrine, so default off.

**Wiring sketch.** `localStorage` `deets.toasts` = `"failures" | "off" | "all"` (default
`"failures"` once built). The primitive exposes `toast(msg, kind)`; call sites keep their
console logging regardless (diag stays the debugging source of truth). Until built, the
ledger rule for new features: quiet failures log to console and get a pointer to this
entry (see STATIONS.md §2).

**Two one-time notices (added 2026-09-12, own session).** Besides failures, the primitive
owes the user two facts the UI cannot show any other way. Each is an `info` toast with a
**Don't show again** button that writes `"off"` to its own key, so silencing one does not
silence the other:

| When | Text (draft) | Key |
|---|---|---|
| The user sets a local playlist cover (NEXT-VERSION §2) | Covers stay in DeetsMusic. Apple Music makes its own. | `deets.notice.coverLocal` |
| The first Add to Library in a session (`#np-add`, a Search row square, or a menu item) | Added. Apple has no undo from here; remove it in the Music app. | `deets.notice.addOneWay` |

Shape when built: `toast(msg, { kind, action?, dismissKey? })` in a new `src/toast.ts`; one
strip, newest replaces the previous, auto-dismiss after a skin-token duration (`--toast-dur`,
`--toast-pad`, `--toast-radius`, `--toast-w`, `--toast-motion`; reduced motion snaps). Main
window only; the tray panel and the extension popup keep the console.

**Reference build: the Deets.Solutions toast (read 2026-09-12).** The site already ships
a toast system with the same token model as this app. Read these before the build session:
[`DeetsSolutions/js/toast.js`](../../DeetsSolutions/js/toast.js) (the API is in the file
header), the `/* ── Toasts` block in
[`DeetsSolutions/styles/chrome.css`](../../DeetsSolutions/styles/chrome.css), and
[`DeetsSolutions/docs/ui.md`](../../DeetsSolutions/docs/ui.md) §Toasts.

*What to take (checked against this app's tokens — every role and token it uses already
exists here, so the port is close to 1:1):*
- **API:** `push({ kind, text, sticky, timeout, actions })` → `{ dismiss, update }`. The
  handle lets a caller retire its own toast (for example, "Reconnecting…" dies on reconnect)
  or rewrite the text in place (a countdown or a sync progress line).
- **Four kinds:** `info` | `success` | `warn` | `error`. The kind colors a 3 px left stripe
  from the theme's traffic-light roles: success `--go`, warn `--pause`, error `--stop`, info
  `--panel-border`. `themes.css` defines all three lights for every theme, including the
  monochrome Moonlight, Hazard and Siren themes, so each theme gets its own in-family look
  for free.
- **Surface:** `--menu-surface` + `--menu-backdrop` (so the Glass skin frosts the toast),
  `--radius-panel`, `--shadow-panel`, border `--border`. Motion: `--dur-med` / `--ease-ui`.
  All already exist in `skin.css`.
- **Timed by default (3.2 s)** with a 2 px countdown bar in the stripe color. **Hover pauses**
  the bar and the dismiss timer together.
- **Sticky** toasts have no timer and must carry an action. **Dismiss is an ordinary action
  button** on sticky toasts; timed toasts have no buttons unless the caller adds some. Any
  button press runs its `onPick`, then dismisses.
- **Accessibility:** the host is `aria-live="polite"`; an `error` toast is `role="alert"`,
  the rest `role="status"`. Reduced motion removes the slide.
- **No copy in the module.** Callers own their strings.

*How "behavior per level" actually works there:* the module changes only the color and the
ARIA role per kind. Sticky-or-timed is the **caller's** choice, with a convention seen in
`cities/cities.js`: a thing done TO the user is a sticky `error` with Dismiss; a routine
failure is a timed `error`; a result that invites a next step is a sticky `success` with
that action; a gain is a timed `success`; a loss is a timed `warn`. **Fork for the session:**
copy that (callers decide) or build the defaults into the kind here (for example, `error`
sticky by default).

*What must differ here — forks to settle in the session:*
- **Position.** The site uses a top-right column under the header. This window is 480 px
  wide and has mini and max modes. The plan above says a bottom strip.
- **Stack or single.** The site stacks up to 4 (the oldest timed toast goes first; sticky
  ones go last). The plan above says one strip, and the newest replaces the previous.
- **The `deets.toasts` tiers against the kinds.** For example: failures = `warn` + `error`;
  all = every kind; off = none. Also decide whether the one-time notices (`info` with a
  `dismissKey`) obey "off". The site has no setting and no `dismissKey`. Both are new here.
- **Tokens.** Replace the draft `--toast-dur/-pad/-radius/-w/-motion` above with the
  site's split: reuse the existing panel/menu/motion tokens, and add only a width and a
  default duration to the skin.

(Side note: `DeetsSolutions/docs/css-split.md` says `--toast-accent` "is set nowhere". That
is stale. `chrome.css` sets it on `.toast--success/--warn/--error`.)

**Candidate added 2026-09-11 — no developer token at startup.** A first run with no local
MusicKit key and no reachable mint (offline, or the worker's `KILL` switch — desk-tested via
`KILL`, RELEASE.md §7) opens the window normally, and the user only learns something is wrong
when a search fails with "Search failed: no developer token: no local MusicKit key and mint
switched off (503)". The message is right; the *timing* is the confusion — a stranger sees a
working-looking app that cannot do anything. Once toasts exist, `ensure_developer_token()`'s
`Err` (surfaced from `lib.rs` `setup()`, or read by the front end at boot via
`apple_developer_token`) should raise one toast at launch: "Can't reach the token service —
check your connection and restart." Same species as the rest of this entry: failures-only tier.

**Three more candidates, 2026-09-11 (the log's first day).** (1) **Sign-in did not
complete** — the browser sign-in times out after 5 min or the callback is rejected;
`apple.rs` logs `sign-in: …` and the Account row just goes back to "Sign in". (2) **Signed
in, no Apple Music subscription** — sign-in succeeds, playback fails, nothing says why; the
first playback failure after a fresh sign-in should say "This Apple ID has no Apple Music
subscription". (3) **A library playlist Apple no longer has** — the count backfill
(`playlists.rs`) gets a 404 for one playlist every launch (`apple: 404
/v1/me/library/playlists/<id>/tracks`; on the desk it was "Tamil Amma Songs"). The toast
must **name the playlist** so the user can deal with it, and the backfill should remember the
404 instead of asking again each launch.

**Candidate added 2026-09-12 — songs Apple Music no longer offers.** The player marks a song
ID as dead when MusicKit rejects it: "could not be resolved" on a queue feed or insert
(`insertWithRetry` / `doLoadFromModel` in [player.ts](../src/player.ts)), or "currently
unavailable" on a skip (`healDeadNext`, `bank = true`). The song-end failure is never marked
(it also follows short-lived license errors). Today the marks are in memory only
(`deadIds`, via `markDead`). **The disk half is BUILT (2026-09-12); only the toast waits.**
- **Built — marks saved to disk**: both MusicKit rejections, in the cache db's `dead_ids`
  table (a cache reset clears them), loaded at launch (`loadDeadIds`), so the first play
  skips them without a failed request. A mark **expires after 7 days**; then the app tries the
  ID once more, and a new rejection refreshes the mark. See QUEUE.md §Dead ids.
- **Not built — toast only when an ID is first found dead**, naming the song(s): "Skipped 2
  songs Apple Music no longer offers." Known dead IDs skip silently. Failures-only tier.
- **List rows are not dimmed** for now (a separate UI change with its own theme role).

**Toast wiring shape (ready for the toast session).**
- **Trigger:** `markDead` in [player.ts](../src/player.ts). `dead_ids_mark` already returns
  `fresh` — the ids with no earlier row on this install (`first_seen` survives the 7-day
  expiry, so a re-mark does not toast again). Today that branch only logs
  `player:deadFresh`; the toast call goes there.
- **Name songs, not ids.** A dead catalog ID whose library ID still plays is not skipped
  (`playId` falls back), so it must not toast. Toast only for handles where `playId(h)` is
  now `undefined`; name them with `trackById(id)?.title`.
- **Coalesce.** One feed rejection marks a batch in one call, but the retry and
  `healDeadNext` can mark more within a second. Collect the fresh names for ~1 s, then raise
  ONE toast: one song → "Skipped “<title>” — Apple Music no longer offers it."; more →
  "Skipped N songs Apple Music no longer offers." (first 2 titles + "and N more").
- **Kind:** `failure` (tier (a)). No **Don't show again** key: it is a failure, not a notice.
  Main window only, like the rest of §18.

## 19. Artist grouping — collab/feature placement

**Behavior.** Where a multi-artist song lands in the Library's Artists view. Since the
2026-07-03 consolidation, credits are PARSED ([artist-credit.ts](../src/artist-credit.ts)):
"Drake & Future" no longer spawns its own artist tile. The open taste question is
*placement*: under every credited artist, or only the primary?

**Current default (hardcoded): multi-index** — the song appears under each credited
artist the library vocabulary knows (an artist's tile collects everything they appear
on; Spotify's behavior). The user chose this 2026-07-03.

**Options.**
- **(a) Every credited artist** *(current)* — consolidating, but songCounts count
  appearances (a song can live under 2–3 tiles).
- **(b) Primary artist only** — each song in exactly one place (Apple Music's
  behavior); a loved feature won't surface under the guest.

**Wiring sketch.** `localStorage` `deets.library.artistPlacement` = `"all" | "primary"`
(default `"all"`). In `creditArtists` (artist-credit.ts), primary-only keeps just the
first resolved name (leading remainder or first match) and skips feat guests. The
vocabulary/split machinery is shared either way.

---

## 20. Drill-in target — in-place (local) vs Search card (catalog)

**Behavior.** Where the right-click **Go to Artist** / **Go to Album** verbs land. Two
targets exist and both are shipped today, chosen **per surface**:
- **In-place (local)** — push the artist/album context inside the *current* card's own
  drill stack, over the **user's library** (the artist's albums/songs *they own*). This is
  what clicking an Artist/Album tile in the Library already does.
- **Catalog (Search)** — summon the **Search card** and open the **Apple catalog** artist/
  album detail (resolved via one `include=` hop, cached). Works from any surface for any
  track with a catalog id.

**Current default (hardcoded, as built 2026-07-06):**
- **Library card → in-place.** Its song/album/artist menus drill locally (the user asked
  for this explicitly). Collab songs offer each credited artist as a **submenu**; album
  tiles target the album's *dominant* credited artist (see §19's credit parsing).
- **Everywhere else → catalog in Search.** Playlists, Rewind, Queue, History, and the Now
  Playing strip all route their Go-to verbs to the Search card.

**Why the split is deliberate, not arbitrary.** In-place only *works* on a surface that
already owns an artist/album context to push — the **Library** does (its collection-card
engine has Artists/Albums groupings). The Queue, History, and Now Playing cards have no
such local stack, so **catalog/Search is their only option**. The Playlists card uses the
same engine but is organized by playlist, not by artist/album — a playlist song has no
natural *local* artist context, so it too routes to catalog. So the real choice this
setting exposes is **Library's** (in-place vs Search); the non-collection surfaces are
catalog-only unless a third mode (below) is built.

**Options.**
- **(a) In-place where the surface supports it, else Search** *(current default)* — Library
  local, the rest catalog.
- **(b) Always Search (catalog)** — even in the Library, Go-to opens the Apple catalog
  detail in the Search card (uniform behavior, one mental model; loses the "my library"
  framing).
- **(c) Route to the Library card, drilled** *(a richer future mode)* — from *any* surface,
  "Go to Artist" could summon the **Library** card drilled to that artist (when the track is
  in the library), falling back to catalog/Search only for non-library tracks. This unifies
  "in-place" across surfaces by borrowing Library's stack via the summon bus, instead of
  each card growing its own contexts. More wiring (cross-card drill target + a library-
  membership check); recorded so the idea isn't lost.

**Wiring sketch.** The mechanism already exists: `trackMenu(items, ctx, nav?)`
([library-card.ts](../src/library-card.ts)) picks in-place when handed a `LibNav`, catalog
when not — the Library supplies one (`libNav`, closing over the card's `drill` + its
detail-context builders), Playlists/Rewind pass nothing. The catalog path is the shared
`go-to.ts` builders (`goToArtistItem`/`goToAlbumItem`) → a drill-intent bus → the Search
card's `drillRelated`. So the toggle is simply **"does the Library pass its `nav`"**:
`localStorage` `deets.goTo.target` = `"inPlace" | "search"` (default `"inPlace"`), read where
the Library builds `libNav` (pass `undefined` for `"search"`). Option (c) is a larger change
— a new intent that targets the Library card via `requestCard("library")` + a programmatic
`card.drill`, gated on a library-membership lookup. If (c) lands, this key grows a third
value (`"library"`). A **Menus** settings subsection tenant alongside §1/§2.

## 21. Library sync cadence — how often the full pass runs

**Behavior.** At startup the app re-syncs the library (stale-while-revalidate,
`track-store.ts`). Since 2026-09-11 that startup call is **incremental** when the last
complete pass is under **six hours** old: `library.rs` fetches newest-added first, one page
of 100 at a time, and stops at the first page holding a song already cached — so an album
added on the phone is one or two Apple requests, not ~40. Upsert only; a song removed on
another device disappears at the next full pass. The refresh button in the Library card is
always a full pass, and a full pass writes `meta.full_sync_at` in the cache db (it dies with
the cache, so a fresh db always full-syncs).

**Options.** The window: 1 h · 6 h *(current default)* · 24 h · only on refresh (never
automatic). Possibly a second switch: incremental at startup on/off.

**Where.** Settings › Library, one CHOICE row ("Check library fully every"). **Wiring.** A
`librarySyncWindowHours` key in `deets.settings`, passed to `library_sync` as an argument
(the constant `FULL_SYNC_EVERY_SECS` becomes the default). The log line
`library: incremental sync done, N new in P page(s)` shows what a launch cost.

# DeetsMusic — Future Settings (deferred toggles)

> A ledger of behaviors we've **deliberately hardcoded for now** but intend to expose
> as user-configurable settings later. When a design choice has a defensible default
> *and* a reasonable person could want the opposite, we record it here instead of
> agonizing — pick a default, ship, and note it so the alternative isn't lost.
>
> Each entry: the behavior, the options, the current hardcoded default, where the
> toggle would live, and any wiring notes. The established pattern for a settings
> toggle is a `.menu__row--toggle` in the title menu + a `localStorage` key, re-applied
> on launch (see **Always on Top** / **Hover-Menu** in [UI-ARCHITECTURE.md](UI-ARCHITECTURE.md) §4).
>
> **Section numbers are stable IDs** (assigned in creation order and referenced from source
> comments + other docs — e.g. `stats.ts` → §7, `surface.ts` → §8, `layout-bus.ts` → §10), so
> new entries **append**; don't renumber. For triage, read by the topic groups below, not by
> number order.

### Grouped by topic (for triage)
- **Menus & context-menu actions** — §1 "Play Now" scope · §2 Queue menu actions & order ·
  §6 Menu caret affordance (click vs hover) · §9 Per-menu open mode (hover vs click)
- **Playback** — §4 "Previous" reach · §5 Shuffle behavior
- **Queue & layout interaction** — §3 Qcard drag initiation · §10 Queue summon (flip vs no-op)
- **Stats** — §7 Listened-through threshold
- **Window / surface** — §8 Surface switching

---

## 1. "Play Now" scope (right-click menu)

**Behavior.** What the right-click **Play Now** action queues after the selected song.

**Options.**
- **(a) Just this song** — plays only the selected track as a single-song context;
  whatever was queued is replaced. *(current default)*
- **(b) This song, then the rest of the list** — plays the selected track and queues
  the remainder of the current sorted/filtered list from that point (this is what a
  **left-click** on a song does today).

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

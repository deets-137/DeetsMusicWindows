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

## 5. Shuffle behavior (placeholder — fill in when shuffle ships)

**Behavior.** How the shuffle toggle behaves once built — agreed default is a **persistent
toggle mode** (Apple Music/Spotify-style), but the user wants a setting to switch the
behavior "either way."

**To pin down when we build it (P6):** whether un-shuffling **restores** the original
context order (Apple Music) or leaves the shuffled order (Spotify); whether toggling shuffle
on mid-playback reshuffles the live `auto` tail or only affects the *next* context; and
whether `manual` (Play-Next) picks are ever shuffled (planned default: never). Record the
chosen defaults + the toggle here when the feature lands.

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

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

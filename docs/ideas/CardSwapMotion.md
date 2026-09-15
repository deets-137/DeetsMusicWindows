# Card swap motion — idea, not built

Recorded 2026-09-15. Nothing here is designed in detail or scheduled.

## Terms
- **Slot**: a place on a surface that holds one card (`left`, `right`, `c`, `d` in
  `src/layout.ts`). Now Playing and the max Queue card are anchored and never move.
- **Swap**: two visible cards exchange slots.
- **Replace**: a card that is not on screen takes a slot. The old card leaves.
- **Recompose**: a surface flip between compositions (midi/mini ↔ max) rebuilds every
  content slot.

## The problem
Cards change position or content with no motion. The change is instant, so the eye
cannot follow where a card went. Today these events snap:

1. **Swap from the title picker.** Pick a card that is in another slot. `setSlot`
   unmounts both slots and mounts them again (`src/layout.ts`, `setSlot`).
2. **Summon flip.** The Now Playing queue button brings the Queue card to the least
   recently used slot. If the Queue card is visible in the other slot, the two cards swap.
3. **Replace from the title picker.** An unplaced card takes the slot. The old card
   disappears.
4. **Recompose.** midi/mini ↔ max tears down every content slot and mounts the new map.

Motion that already exists and is out of scope: the collection-card push/pop pane slide
inside one card, the queue drag-to-reorder, and the theme/skin switch animation
(NEXT-VERSION §6).

## The idea
Animate each event so the user sees the result:

- **Swap / summon flip**: each card moves from its old slot to its new slot (a FLIP
  move: measure the old rect, mount, measure the new rect, animate the difference).
- **Replace**: the old card fades or slides out. The new card fades or slides in, in the
  same slot.
- **Recompose**: a card that is in both maps moves to its new slot. Other cards fade in.

## Constraints
- **Mechanism.** A swap is destroy + remount, so the old DOM does not survive. The
  motion needs one of these: a snapshot (clone) of the old card that animates over the
  new card, or a change to move the live card nodes between hosts. The clone is cheaper
  to build. Moving live nodes keeps drill state but changes the swap contract (today a
  swap always lands at the card root).
- **Tokens.** Duration and easing come from skin tokens (`--dur-*`, `--ease-*`, or a new
  `--dur-swap`). No hardcoded values in `layout.ts`.
- **Reduced motion.** The OS preference snaps. Decide if the `appearanceMotion` setting
  also controls this, or if it needs its own row.
- **Windowed lists.** A long collection-card list renders only the rows near the
  viewport. A clone must copy only the visible rows. It must not force a full render.
- **Frames.** Log each run through `src/frames.ts` (a new `swap` kind), so the smoothness
  telemetry covers it.
- **Input during motion.** A second pick during the animation must finish or cancel the
  first one cleanly.
- **mini.** The right slot is `display:none`. A summon into it has no visible start rect.

## Open forks (for the design pass)
1. Clone snapshot, or move the live card nodes?
2. Swap path: straight move, or cross-fade in place?
3. Which setting controls it: `appearanceMotion`, a new row, or the OS preference only?
4. Include recompose (surface flip) in the first slice, or swap + replace only?

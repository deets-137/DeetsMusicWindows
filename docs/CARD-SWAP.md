# Card swap motion — designed and built 2026-09-15

Recorded as an idea 2026-09-15; designed and built the same day. Tested and committed
(0617a1e), shipped. Settings › Motion › **Animate card swaps** (`cardSwapMotion`,
default **on** since 2026-09-16, the user's call; it was off before). The OS reduced-motion
preference always snaps.

The chip flight (`src/handoff.ts`, ARTIST-VIEW.md) also follows this setting when it swaps a
card. A flight that swaps no card (the playlist web) passes `ownMotion` and follows reduced
motion only.

## Terms
- **Slot**: a place on a surface that holds one card (`left`, `right`, `c`, `d` in
  `src/layout.ts`). Now Playing and the max Queue card are anchored and never move.
- **Swap**: two visible cards exchange slots (the title picker).
- **Summon**: the Now Playing queue button brings the Queue card to the least recently
  used slot. If the Queue card is in the other slot, this is a swap.
- **Replace**: a card that is not on screen takes a slot. The old card leaves.
- **Recompose**: a surface flip between compositions (midi/mini ↔ max).

## Scope
Swap, summon and replace animate. **Recompose does not** (user's call): the window also
changes size in that flip, so the start positions are not reliable. Out of scope: the
collection-card pane slide, the queue drag, the theme/skin switch animation.

## Decisions (tested against the code)
1. **Animate the new panels, not a clone and not the live nodes.** `setSlot` remounts as
   before. Each card writes `host.innerHTML` and clears it on `destroy()`, and the picker
   and observers bind to the host, so moving live nodes breaks that contract. A clone loses
   the list's scroll position and paints canvases blank. The `.panel` host is a fixed grid
   cell, so the new card's panel plays from the slot its card left.
2. **Travel only, no scale between slots.** Every content slot on a surface is the same
   size (midi: two equal columns; max: a 2×2 grid of equal cells).
3. **The shape is skin tokens** (the `--nav-at-*` pattern): one set of keyframes, each skin
   supplies the values. JS measures only the pixel offset.
4. **Timing aliases the nav tokens**: `--swap-dur: var(--nav-dur)`,
   `--swap-ease: var(--nav-ease)`. A skin can override them.
5. **Replace rises in** with the pop tokens (fade, up by `--pop-shift`, from `--pop-scale`),
   on every skin. The old card's DOM is gone, so it cannot visibly leave.
6. **mini**: the right slot is `display:none`. A card that comes out of it rises in; the
   card that goes into it is not animated.
7. **A pick during a run** snaps every moving panel home, then plays the new moves.
8. **Telemetry**: one `[perf] frames swap <kind> <slots> <skin>` line per run (`frames.begin`).

## Per skin

The user skins are Press, Ocean, Glass and Cyber. Vanilla is hidden from the picker
(UI-ARCHITECTURE.md): its values are the base tokens, which a skin without overrides uses.

| Skin | Its nav motion | Swap | Tokens |
|---|---|---|---|
| Press | a sheet pulled off, the next stamped down | **Stamp in place**, the second slot 0.06 s after the first | travel 0, from `scale(1.03)`, mid `scale(1.01)`, stagger 0.06s |
| Ocean | sinks out, rises from beneath | **Dip and travel** | travel 1, mid `scale(0.94)` |
| Glass | panes fade and scale through | **Straight slide** (the base) | none |
| Cyber | electric snap, skew straightens | **Skew out, then skew in**, in place | out `skewX(-10deg)` + fade 0 over `--nav-dur`; travel 0, from `skewX(10deg)`, mid `skewX(4deg)`, fade 0 |

**Revised at the desk (2026-09-15):** Glass first cross-faded in place; through the frost it
read as a glitch, so Glass takes the base slide. Cyber first had a skewed snap slide;
the user asked for a skew out and a skew in, which added the out step below.

## Tokens (skin.css §card swap, on `[data-skin]`)
| Token | Default | Meaning |
|---|---|---|
| `--swap-dur` | `var(--nav-dur)` | length of one card's run |
| `--swap-ease` | `var(--nav-ease)` | its easing |
| `--swap-out-dur` | `0s` | the out step's length; 0 = no out step |
| `--swap-out-to` | `scale(1)` | the leaving card's shape at the end of the out step |
| `--swap-out-fade` | `1` | the leaving card's opacity at the end of the out step |
| `--swap-travel` | `1` | 1 = start at the old slot and move; 0 = play in place |
| `--swap-from` | `scale(1)` | shape at the start |
| `--swap-mid` | `scale(1)` | shape at the midpoint (same functions as `--swap-from`) |
| `--swap-fade` | `1` | opacity at the start |
| `--swap-stagger` | `0s` | delay of the second card |

## How it runs
- **Out step.** `layout.ts` `setSlot` passes the remount to `playOut(els, run, detail)`. With
  `--swap-out-dur` > 0 the leaving panels get `swap-out`; `run` waits for `card-swap-out` to
  end (a timer at the duration + 100 ms backs it up). Otherwise `run` runs at once.
  `flushSwapOut()` runs a waiting remount now: at the start of every `setSlot`, and before a
  surface recompose or the Rewind rebuild, so the layout they read is current.
- **In step.** `run` remounts, then calls `playSwap(moves, detail)`.
  The first move is the picked slot; it gets `swap-top` and passes over the other card.
- `card-swap.ts` sets `--swap-dx` / `--swap-dy` on the panel (old slot − new slot) and adds
  `swap-in`, or `swap-rise` for a replace.
- `styles.css` §Card swap: `swap-in` runs two animations of the same length. The travel
  animates the `translate` property; the skin's shape animates `transform` with a 50% key.
  Two properties, so the midpoint key never splits the travel's easing into two eases.
- `animationend` of `card-swap-shape` / `card-swap-rise` clears the classes and variables.

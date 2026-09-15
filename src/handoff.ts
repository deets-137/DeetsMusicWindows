// Chip flight (ARTIST-VIEW.md §5) — a shelf tile handed to another card. A copy of the tile
// (the drag chip, row-drag.ts) flies from the tile to the card that opens it.
//
// The flight is synced to the view it opens:
//   1. the chip appears on the tile and the target card is summoned; `prepare` fetches what
//      the view needs (a playlist's songs) while the chip waits there;
//   2. once the card-swap motion has ended and `prepare` is done, the chip flies;
//   3. `open` runs --nav-dur before the landing, so the target's drill slide ends as the chip
//      lands — and the view already holds its songs, so it arrives full.
// Motion off (Animate card swaps off, or the OS reduced-motion preference): no chip, the card
// opens at once and loads as usual. The shape is skin tokens (skin.css §chip flight).

import { setting } from "./settings-store";
import { requestCard, cardHost } from "./layout-bus";
import { makeGhost } from "./row-drag";
import { whenSwapSettled } from "./card-swap";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import type { CardId } from "./cards";

const reduced = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Hand `tile` to the `target` card: fetch with `prepare`, fly the chip, and `open` with the
 *  fetched data (undefined when motion is off or the fetch failed — `open` then loads itself).
 *  `count` (the playlist's songs, when known) rides the chip like a drag's. */
export function handOff<T>(
  tile: HTMLElement,
  target: CardId,
  prepare: () => Promise<T>,
  open: (data: T | undefined) => void,
  count?: number,
): void {
  if (!setting("cardSwapMotion") || reduced() || !tile.isConnected) {
    requestCard(target);
    open(undefined);
    return;
  }
  // Made before the summon: in mini the source card leaves the slot the tile is in.
  const { root, ghost } = makeGhost(tile, count != null ? { source: "", kind: "playlist", count, tracks: () => [] } : undefined);
  requestCard(target);
  const data = prepare().catch((e): undefined => {
    console.warn("[handoff] prepare", e);
    return undefined;
  });
  void Promise.all([whenSwapSettled(), data]).then(([, d]) => {
    const host = cardHost(target);
    if (!host) {
      root.remove();
      open(d);
      return;
    }
    const g = ghost.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    ghost.style.setProperty("--fly-dx", `${Math.round(h.left + h.width / 2 - (g.left + g.width / 2))}px`);
    ghost.style.setProperty("--fly-dy", `${Math.round(h.top + h.height / 2 - (g.top + g.height / 2))}px`);
    const end = frames.begin("handoff", target);
    const fly = tokenMs("--fly-dur");

    // The drill slide (--nav-dur) starts so that it ends with the landing.
    let opened = false;
    const openNow = () => {
      if (opened) return;
      opened = true;
      open(d);
    };
    const openTimer = window.setTimeout(openNow, Math.max(0, fly - tokenMs("--nav-dur")));

    let done = false;
    const land = () => {
      if (done) return;
      done = true;
      window.clearTimeout(openTimer);
      openNow();
      root.remove();
      end();
    };
    ghost.addEventListener("animationend", (e) => {
      if (e.animationName === "handoff-fly-shape") land();
    });
    window.setTimeout(land, fly + 150); // a hidden window sends no animationend
    ghost.classList.add("is-flying");
  });
}

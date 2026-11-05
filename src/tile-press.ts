// A press on a tile (HOME.md §11.3a): one click or two, on Home and on the Pinned shelves. The
// rule is pure in press-read.ts; this is the page's half: the wait setting, the guard for a late
// second press, and the click trail.

import { pressReader } from "./press-read";
import { guardPoint, DOUBLE_CLICK_MS } from "./card-grow";
import { setting } from "./settings-store";
import * as diag from "./diag";

export type TileVerb = "play" | "shuffle" | "open";

const reader = pressReader<TileVerb>({
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id as number),
});

/** Read a press on the tile `key`, and run its click or its double-click verb. A key press or a
 *  scripted click (`detail` 0, or no event) is a click, with no wait. */
export function tilePress(e: MouseEvent | undefined, key: string, click: TileVerb, double: TileVerb, run: (verb: TileVerb) => void): void {
  if (!e || e.detail === 0) return run(click);
  const { clientX: x, clientY: y } = e;
  const at = performance.now();
  // A click that waited must not act from a card that has gone in the wait.
  const host = e.target instanceof Element ? e.target.closest<HTMLElement>(".panel") : null;
  const card = host?.dataset.mounted;
  const wait = setting("tilePressWait");
  const result = reader.press({
    key,
    click,
    double,
    wait,
    openFirst: click === "open",
    run: (verb) => {
      if (host && host.dataset.mounted !== card) return;
      // A slower second press, after the wait, does nothing. It may land on the card that took
      // the tile's place (the Grow edge bar's guard, card-grow.ts).
      guardPoint(x, y, DOUBLE_CLICK_MS - (performance.now() - at), true);
      run(verb);
    },
  });
  // The page opened at once (his call 2026-11-04). A second press lands on it, so the guard catches
  // that press and runs the double-click on this tile. The window is Windows' double-click time,
  // not the wait: nothing is held here, and a press at 300 ms must not do nothing.
  if (result === "eager") {
    guardPoint(x, y, DOUBLE_CLICK_MS, true, {
      until: at + DOUBLE_CLICK_MS,
      run: () => {
        diag.log("ui:press", { result: "double" });
        run(double);
      },
    });
  }
  diag.log("ui:press", { result });
}

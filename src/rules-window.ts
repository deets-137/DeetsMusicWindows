// Rulez's window size facts (docs/features/RULEZ.md §10.1, route 8 step 5; FUTURE-SETTINGS §8).
// The surface stays a deliberate choice; the size is a fact a rule may read ("While the window
// is narrower than 500 px → Keep on top"). Logical px (`innerWidth` / `innerHeight`).
//
// The seam is one ResizeObserver on <html>, published on a 150 ms trailing edge: one recheck
// per settled resize, none per frame. Nothing polls.

import { registerFact } from "./rules";

const SETTLE_MS = 150;

export function initRulesWindow(): void {
  const subs = new Set<() => void>();
  let size = { w: window.innerWidth, h: window.innerHeight };
  let timer = 0;
  new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const now = { w: window.innerWidth, h: window.innerHeight };
      if (now.w === size.w && now.h === size.h) return;
      size = now;
      subs.forEach((cb) => cb());
    }, SETTLE_MS);
  }).observe(document.documentElement);
  const seam = (cb: () => void) => {
    subs.add(cb);
    return () => subs.delete(cb);
  };
  registerFact("windowWidth", () => size.w, { seam });
  registerFact("windowHeight", () => size.h, { seam });
}

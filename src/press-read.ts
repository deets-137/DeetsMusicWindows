// The press reader (HOME.md §11.3a): one click or two on a tile. Pure, so the rule has tests; the
// page's half (the setting, the guard, the log) is tile-press.ts.
//
// When a tile's click and double-click run the same verb there is nothing to tell apart, so the
// click acts at once. When they differ, the click waits `wait` ms: a second press on the same
// tile in that time runs the double-click instead, and the click never runs. A click that only
// opens a page starts no music, so it does not wait (`openFirst`, his call 2026-11-04): it acts at
// once, and the caller catches a second press on what opened.

export interface Press<V> {
  /** The tile. A second press counts only on the same key. */
  key: string;
  click: V;
  double: V;
  /** How long a click waits for a second press, in ms. */
  wait: number;
  /** The click only opens: act at once, and answer "eager". */
  openFirst?: boolean;
  run: (verb: V) => void;
}

export type PressResult = "click" | "double" | "held" | "eager";

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

export interface PressReader<V> {
  press(p: Press<V>): PressResult;
  /** Drop a waiting click, so it never runs. */
  cancel(): void;
}

export function pressReader<V>(timers: Timers): PressReader<V> {
  let held: { key: string; timer: unknown; fire: () => void } | null = null;
  const release = (): (() => void) | null => {
    if (!held) return null;
    const { timer, fire } = held;
    timers.clear(timer);
    held = null;
    return fire;
  };
  return {
    press(p) {
      if (held?.key === p.key) {
        release();
        p.run(p.double);
        return "double";
      }
      // A press on another tile: the waiting click was a click, so it acts now, first.
      release()?.();
      if (p.click === p.double || p.wait <= 0) {
        p.run(p.click);
        return "click";
      }
      if (p.openFirst) {
        p.run(p.click);
        return "eager";
      }
      const fire = (): void => p.run(p.click);
      const timer = timers.set(() => {
        held = null;
        fire();
      }, p.wait);
      held = { key: p.key, timer, fire };
      return "held";
    },
    cancel() {
      release();
    },
  };
}

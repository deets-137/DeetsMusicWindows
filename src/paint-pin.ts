// A moving card holds its window-pinned paint in place (GRAND-OPENING.md §12, 2026-11-02).
//
// Glass's painted frost (skin.css) is a copy of the canvas pinned to the window
// (`background-attachment: fixed`). A transform on a card, even 0.01 px, makes the card the box
// that copy is drawn against: the copy slips by the title bar's height, and the card's top shows a
// dark band (his report: "the title bars are darkening"). The grow shell avoids it by moving by
// opacity alone; the paged card, the launch rise and the card swap keep each skin's slide (his
// call: "I like the slide"), so while a card moves its copy is held here instead.
//
// The hold attaches the copy to the card (`--pin-attach: scroll`), offsets it by where the card
// rests (--pin-x / --pin-y: its padding box in the window) and sizes it to the window (--pin-w /
// --pin-h). At the card's resting place that draws the same pixels as the pinned copy, and during
// the motion the copy moves with the card. The release takes the four off: pinned again. A skin
// opts in with --paint-pinned: 1; for every other skin a hold does nothing.

const PROPS = ["--pin-attach", "--pin-x", "--pin-y", "--pin-w", "--pin-h"] as const;
/** Holds on each card now: two motions on one card (a swap, then a close) release in any order. */
const holds = new WeakMap<HTMLElement, number>();

/** The card's box with no transform on it: where it rests. A card about to rise already carries
 *  the rise's start (the launch's `wait` state), so its transform is set aside for the read. */
function restBox(el: HTMLElement): DOMRect {
  const keep = ["transform", "translate", "transition"].map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)] as const);
  for (const [p] of keep) el.style.setProperty(p, "none", "important");
  const r = el.getBoundingClientRect();
  for (const [p, v, prio] of keep) {
    if (v) el.style.setProperty(p, v, prio);
    else el.style.removeProperty(p);
  }
  return r;
}

/** Hold `el`'s pinned paint in place while it moves; call before the motion starts. Returns the
 *  release (safe to call twice). */
export function holdPaint(el: HTMLElement): () => void {
  if (getComputedStyle(el).getPropertyValue("--paint-pinned").trim() !== "1") return () => {};
  const n = holds.get(el) ?? 0;
  if (n === 0) {
    const r = restBox(el);
    const doc = document.documentElement;
    el.style.setProperty("--pin-attach", "scroll");
    el.style.setProperty("--pin-x", `${r.left + el.clientLeft}px`);
    el.style.setProperty("--pin-y", `${r.top + el.clientTop}px`);
    el.style.setProperty("--pin-w", `${doc.clientWidth}px`);
    el.style.setProperty("--pin-h", `${doc.clientHeight}px`);
  }
  holds.set(el, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holds.get(el) ?? 1) - 1;
    if (left > 0) return void holds.set(el, left);
    holds.delete(el);
    for (const p of PROPS) el.style.removeProperty(p);
  };
}

/** Hold every card in `els`; one release for all. */
export function holdPaints(els: Iterable<HTMLElement>): () => void {
  const releases = [...els].map(holdPaint);
  return () => releases.forEach((r) => r());
}

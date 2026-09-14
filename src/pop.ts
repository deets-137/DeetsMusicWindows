// Pop (styles.css §Pop): rows that slide in one after another — a dropdown panel's rows
// (the "Play on" speakers) and the rows a section fold just opened (Playlists, Radio,
// Settings). Timing is the --pop-in / --pop-stagger / --pop-ease skin tokens.

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Slide `els` in, one after another. Only the first `max` animate: a long section must not
 * keep its last rows invisible behind a long stagger; the rest simply show. A row whose
 * animation is still running starts again. Reduced motion: nothing moves.
 */
export function enterRows(els: Iterable<Element>, max = 12): void {
  if (reduced()) return;
  const rows = [...els].slice(0, max) as HTMLElement[];
  if (!rows.length) return;
  rows.forEach((el) => el.classList.remove("pop-enter"));
  void rows[0].offsetWidth; // restart an animation that was still running
  rows.forEach((el, i) => {
    el.style.setProperty("--pop-i", String(i));
    el.classList.add("pop-enter");
    const done = (e: AnimationEvent) => {
      if (e.target !== el) return; // an animation inside the row (a spinner) is not the row's
      el.classList.remove("pop-enter");
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
  });
}

/** A section header's rows: the elements after it, up to the next `[data-section]` header. */
export function rowsAfter(header: Element | null): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (let el = header?.nextElementSibling; el && !el.hasAttribute("data-section"); el = el.nextElementSibling)
    rows.push(el as HTMLElement);
  return rows;
}

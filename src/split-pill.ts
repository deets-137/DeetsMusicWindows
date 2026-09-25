// The split pill: one header control cut in two (UI-ARCHITECTURE.md §2a, the header-action
// family). One primitive for every "Full | Lib" in the app: the Library's album and artist
// levels (docs/features/FULL-LIB.md) and the Search card's scope (SEARCH-FIELDS.md §6).
//
// The shape is the text header action (`.panel__action--text`): its fill, border, height,
// radius and type. It is cut like the room guest pill (`.room__pill`): equal halves, a 1 px
// divider, the pressed half on `--picked`. The caller owns the state; this draws it and reads
// a press.

import { esc } from "./dom";

export interface SplitHalf {
  key: string;
  label: string;
  /** The hover hint (src/hint.ts reads `title`). */
  title: string;
  /** The hint of a half that cannot be picked now; undefined when it can. */
  off?: string;
}


/** The pill. `label` names the group for a screen reader ("Show", "Search"). */
export function splitPillHTML(halves: SplitHalf[], active: string, label: string): string {
  const parts = halves
    .map((h) => {
      const on = h.key === active;
      const off = on ? undefined : h.off;
      return (
        `<button class="split-pill__half" type="button" data-split="${esc(h.key)}" aria-pressed="${on}"` +
        `${off ? ` aria-disabled="true"` : ""} title="${esc(off ?? h.title)}">${esc(h.label)}</button>`
      );
    })
    .join("");
  return `<div class="split-pill" role="group" aria-label="${esc(label)}">${parts}</div>`;
}

/** The key a press picks: null for a press elsewhere, on the pressed half, or on a half that
 *  cannot be picked. */
export function splitPick(e: Event): string | null {
  const half = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-split]");
  if (!half || half.getAttribute("aria-pressed") === "true" || half.getAttribute("aria-disabled") === "true") return null;
  return half.dataset.split ?? null;
}

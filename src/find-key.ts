// Ctrl+F (MOVABLE-ROWS.md §10.7, fork S3 = 9B) — one key, one meaning, in every card that
// has a search field: Library, Playlists, Radio, Search and Settings.
//
// In a release build the browser accelerator keys are off (DRAG-DROP.md §6), so Ctrl+F does
// nothing at all today. This gives a Windows user the key back.
//
// WHICH card it opens: the one you last pressed in. A row carries no tabindex, so a click
// leaves the focus on <body> and `document.activeElement` almost never names a card — the
// last press inside a card is the honest signal, the same one Ctrl+A already uses
// (collection-card.ts `touched`). With no press yet, a single card with a search field on
// screen takes it; with several, nothing happens rather than the wrong one opening.

interface Finder {
  root: HTMLElement;
  open: () => void;
}

const finders = new Set<Finder>();
let last: Finder | null = null;

const visible = (f: Finder) => f.root.isConnected && !!f.root.offsetParent;

document.addEventListener(
  "pointerdown",
  (e) => {
    const t = e.target as Node;
    for (const f of finders) if (f.root.contains(t)) last = f;
  },
  true,
);

window.addEventListener(
  "keydown",
  (e) => {
    if (!e.ctrlKey || e.altKey || e.key.toLowerCase() !== "f") return;
    // A field already has the key: Ctrl+F inside a text box is the user's own business.
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
    const live = [...finders].filter(visible);
    const pick = last && live.includes(last) ? last : live.length === 1 ? live[0] : null;
    if (!pick) return;
    e.preventDefault();
    pick.open();
  },
  true,
);

/** A card with a search field says how to open it. Called on mount; the returned function
 *  is called on destroy. */
export function registerFinder(root: HTMLElement, open: () => void): () => void {
  const f: Finder = { root, open };
  finders.add(f);
  return () => {
    finders.delete(f);
    if (last === f) last = null;
  };
}

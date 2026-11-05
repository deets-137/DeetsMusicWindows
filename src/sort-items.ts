// The list sort every collection uses (collection-card.ts), pure so a Play outside the card can
// put a playlist in the order its page shows (PLAYLISTS.md §13).
import type { SortDir, SortSpec } from "./collection-card";

// One collator, built once. `a.localeCompare(b, undefined, {…})` builds one per CALL: the
// library's 3,895 rows make ~100,000 of them in a single sort, which measured 204 ms against
// 3.5 ms for the cached collator (2026-09-17). Same locale, same options, same order — this
// is only where the object is made. It is why picking a sort key took ~280 ms to paint.
const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const cmpStr = (a: string, b: string) => collator.compare(a, b);

export function sortItems<T>(items: T[], spec: SortSpec<T>, dir: SortDir, nameOf: (x: T) => string): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => cmpStr(nameOf(a), nameOf(b));
  return [...items].sort((a, b) => {
    const va = spec.get(a);
    const vb = spec.get(b);
    if (va == null && vb == null) return byName(a, b);
    if (va == null) return 1; // missing always last, either direction
    if (vb == null) return -1;
    const c = spec.type === "num" ? (va as number) - (vb as number) : cmpStr(String(va), String(vb));
    return sign * c || byName(a, b);
  });
}

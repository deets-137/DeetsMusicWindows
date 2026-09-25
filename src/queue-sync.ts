// The pure half of `reconcileUpcoming` (player.ts; QUEUE.md §The model is the master): what
// MusicKit's upcoming window should hold, and how far it already agrees. No MusicKit and no
// DOM here, so tests/queue-sync.test.ts can pin the rules (the 2026-09-24 repeated-song bug
// lived in the first function).

/** The model's upcoming ids, in order, capped to the window. **No dedup:** `playLater` keeps
 *  a repeated id, and deduping against the songs MusicKit already held left a re-queued,
 *  already-heard song out of MusicKit entirely (2026-09-24). An entry with no playable id
 *  (`idOf` → null) is skipped. */
export function expectedIds<E>(upcoming: readonly E[], cap: number, idOf: (e: E) => string | null | undefined): string[] {
  const out: string[] = [];
  for (const e of upcoming) {
    if (out.length >= cap) break;
    const id = idOf(e);
    if (id) out.push(id);
  }
  return out;
}

/** How MusicKit's upcoming (`mk`) differs from `expected`: the length of the shared prefix
 *  (`keep`) and how many of MusicKit's items after it must go (`drop`). The divergent suffix
 *  is contiguous, so one splice and one append repair it. null when they already match. */
export function suffixPlan(mk: readonly string[], expected: readonly string[]): { keep: number; drop: number } | null {
  let keep = 0;
  while (keep < mk.length && keep < expected.length && mk[keep] === expected[keep]) keep++;
  if (keep === mk.length && keep === expected.length) return null;
  return { keep, drop: mk.length - keep };
}

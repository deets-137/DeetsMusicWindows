// The pure half of `reconcileUpcoming` (player.ts; QUEUE.md §The model is the master): what
// MusicKit's upcoming window should hold, and how far it already agrees. No MusicKit and no
// DOM here, so tests/queue-sync.test.ts can pin the rules (the 2026-09-24 repeated-song bug
// lived in the first function).

/** The model's upcoming ids, in order, capped to the window. **No dedup:** MusicKit keeps a
 *  repeated id across calls (one call is split at a repeat: `headPart`), and deduping against the songs MusicKit already held left a re-queued,
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

/** The longest start of `ids` with no id twice: what one MusicKit insert call may carry.
 *  One `playLater` / `playNext` call that holds an id twice keeps only its LAST copy, while
 *  separate calls keep every copy (probed 2026-10-01, QUEUE.md §Repeats in one insert). */
export function headPart(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) break;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The longest end of `ids` with no id twice. `playNext` puts each call right after the
 *  current song, so its parts go from the end of the list to the start. */
export function tailPart(ids: readonly string[]): string[] {
  return headPart([...ids].reverse()).reverse();
}

/** `ids` cut into parts with no id twice in a part, in order. A list with no repeat is one
 *  part; the parts are as few as the most repeated id needs. */
export function splitRepeats(ids: readonly string[]): string[][] {
  const parts: string[][] = [];
  for (let at = 0; at < ids.length; ) {
    const part = headPart(ids.slice(at));
    parts.push(part);
    at += part.length;
  }
  return parts;
}

/** How far ahead a difference must be repaired at a song change. A repair cuts MusicKit's
 *  upcoming from the first difference and appends it again, and at a song change that work
 *  meets the next song's own start. Near the play head it cannot wait: MusicKit plays into
 *  those songs next. The same count as the grow at a click (GROW_NOW, player.ts). */
export const REPAIR_NEAR = 8;

/** Repair a difference at `mkPos` of MusicKit's upcoming now, at a song change? A far one
 *  waits for the next window top-up, which repairs from the first difference anyway.
 *  Found 2026-09-28: one song MusicKit would not hold, 155 songs ahead, was cut and appended
 *  again at every song change, and the churn met the next song's start. */
export function repairAtSongChange(mkPos: number): boolean {
  return mkPos < REPAIR_NEAR;
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

// The now mark's rule, pure (docs/features/NOW-MARK.md): which rows carry a mark, in which shape,
// and how the marks get from one plan to the next.

export type MarkShape = "chevron" | "line";

export interface MarkSpot {
  row: number;
  shape: MarkShape;
}

/** The rows of a list that hold the current song. */
export function rowsOfSong<T>(items: readonly T[], ids: (x: T) => readonly (string | undefined)[], song: readonly (string | undefined)[]): number[] {
  const want = new Set(song.filter(Boolean));
  if (!want.size) return [];
  const rows: number[] = [];
  items.forEach((x, i) => {
    if (ids(x).some((id) => id && want.has(id))) rows.push(i);
  });
  return rows;
}

/** The marks for the rows that hold the song. The source list shows one chevron, on the copy
 *  nearest its last place. Any other list shows a line on each copy. */
export function planMarks(hits: readonly number[], source: boolean, last: number | null): MarkSpot[] {
  if (!hits.length) return [];
  if (!source) return hits.map((row) => ({ row, shape: "line" }));
  const near = last == null ? hits[0] : hits.reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a));
  return [{ row: near, shape: "chevron" }];
}

/** How the marks move: nothing to do, a slide (one chevron, a short way), or a swap (the old
 *  marks fade out and the new ones fade in). */
export function markMove(from: readonly MarkSpot[], to: readonly MarkSpot[], reach: number): "none" | "slide" | "swap" {
  const same = from.length === to.length && from.every((m, i) => m.row === to[i].row && m.shape === to[i].shape);
  if (same) return "none";
  if (from.length === 1 && to.length === 1 && from[0].shape === "chevron" && to[0].shape === "chevron" && Math.abs(from[0].row - to[0].row) <= reach) return "slide";
  return "swap";
}

// The reveal's wave (UX-COVERUPS.md §7.2), as a pure rule over boxes, so it has a test
// (tests/reveal-wave.test.ts). reveal.ts reads the boxes from the page and sets the delays.

/** The cards with a wait-or-instant toggle (§7.12). The artist view and a drill follow the
 *  card they open in; the Compass and the playlist web never wait. Here, in the pure file, so
 *  the Settings card and the agent's specs read it without the DOM module. */
export const REVEAL_CARDS = ["library", "playlists", "home", "search", "queue", "history", "rewind", "radio", "diary"] as const;

export interface Box {
  top: number;
  left: number;
  height: number;
}

/**
 * The reading order and each tile's delay: tiles sorted by top, then left; a tile whose top is
 * within half a tile of a line's first tile is on that line. Delay = (line + column) ÷
 * (lines + columns − 2) × span, so the wave runs left to right and top to bottom at once and
 * takes the same `span` for 6 rows or 40 tiles. A single tile: no delay.
 * Returns, per input index, its delay in ms and its place in reading order.
 */
export function waveDelays(boxes: Box[], spanMs: number): { delay: number; order: number }[] {
  const idx = boxes.map((_, i) => i).sort((a, b) => boxes[a].top - boxes[b].top || boxes[a].left - boxes[b].left);
  const lines: number[][] = [];
  for (const i of idx) {
    const line = lines[lines.length - 1];
    const head = line ? boxes[line[0]] : null;
    if (head && boxes[i].top - head.top < Math.max(1, head.height) / 2) line.push(i);
    else lines.push([i]);
  }
  lines.forEach((l) => l.sort((a, b) => boxes[a].left - boxes[b].left));
  const cols = Math.max(0, ...lines.map((l) => l.length));
  const steps = lines.length + cols - 2;
  const out = boxes.map(() => ({ delay: 0, order: 0 }));
  let n = 0;
  lines.forEach((l, li) =>
    l.forEach((i, ci) => {
      out[i] = { delay: steps > 0 ? ((li + ci) / steps) * spanMs : 0, order: n++ };
    }),
  );
  return out;
}

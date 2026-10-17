// The cover-size ladder (UX-COVERUPS.md §7.4 part 5, his call 2026-10-17: 96 · 192 · 480).
// Apple's image server takes any size in a cover's URL, and each size is its own URL, so the
// same album asked at 72 by a row and at 128 by a tile downloaded twice, and a mosaic never
// reused a cover a row already had. Every card and the mosaic worker now ask for one of three
// steps, so most of those are cache hits:
//   - ROW_PX: a list row's cover, a queue or history row, the qnow cover, a small mosaic tile;
//   - TILE_PX: a tile, a shelf tile, an artist photo in a shelf;
//   - HERO_PX: a detail hero, a large mosaic.
// The Now Playing cover, the full player and the Canvas wallpaper keep their own large sizes
// (they are not lists, and their sizes follow the screen).

export const ROW_PX = 96;
export const TILE_PX = 192;
export const HERO_PX = 480;
export const LADDER = [ROW_PX, TILE_PX, HERO_PX] as const;

/** The smallest step that covers `px` device pixels (the largest when none does). */
export function stepFor(px: number): number {
  return LADDER.find((p) => p >= px) ?? HERO_PX;
}

// The zoetrope's drum (--cover-swap: zoetrope; Metal's peek): the perspective for a cover of a
// given width. A fixed perspective tuned on the stage's cover drew a larger cover's side covers
// in a stronger perspective: their inner edges came out taller than the cover (wedges above and
// below it) and their outer edges sank into thin slivers (the full player, metal.md §6.8.2,
// 2026-10-21). So the perspective grows with the cover past the size it was tuned on, and every
// larger cover keeps that shape. Pure, so the CSS's rest poses (metal.ts) and the turn
// (vinyl.ts) use one rule.

/** The drum's perspective in px: `base` (--zoetrope-perspective), or `perCover` ×
 *  the cover's width (--zoetrope-perspective-per-cover) when that is more. 0 keeps `base`. */
export function drumPerspective(base: number, perCover: number, coverW: number): number {
  return Math.max(base, perCover > 0 && coverW > 0 ? perCover * coverW : 0);
}

/** The depth that shows a cover of the drum at `scale` (P − P / scale; 0 at full size). */
export function drumBack(perspective: number, scale: number): number {
  return scale >= 1 ? 0 : perspective - perspective / scale;
}

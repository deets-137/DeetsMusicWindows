// The pure rules behind `loadLayout` and the Cards section (layout.ts; CARD-MEMORY.md,
// HIDE-CARDS.md): is a stored card assignment still good, and which cards may be hidden?
// No DOM, no registry, so tests/layout-rules.test.ts can pin them.

// ── Hide cards (docs/features/HIDE-CARDS.md) ──

/** The cards the Cards section can take out of the picker, in the registry order. Settings,
 *  Now Playing and Queue are never hidden (§2). */
export const HIDEABLE_CARDS = ["home", "library", "playlists", "search", "history", "rewind", "radio", "diary", "rulez"] as const;
/** Rulez opens at Fill and is never a fallback, so it does not count toward the minimum. */
const EVERYDAY = HIDEABLE_CARDS.filter((c) => c !== "rulez");
/** Max fills up to four slots: Settings is always offered, so three everyday cards must stay (§3). */
export const MIN_SHOWN = 3;
/** Why a toggle or the right-click row is locked (his words, 2026-10-10). */
export const HIDE_LOCK_HINT = "Keep three cards in the picker";

/** Can `id` be hidden now? False when the hide would leave fewer than MIN_SHOWN everyday
 *  cards in the picker. A card that is already hidden can always be "hidden" again. */
export function canHide(hidden: readonly string[], id: string): boolean {
  if (hidden.includes(id) || !EVERYDAY.includes(id as (typeof EVERYDAY)[number])) return true;
  return EVERYDAY.filter((c) => !hidden.includes(c)).length > MIN_SHOWN;
}

/** The cards in `after` that were not in `before`: the ones the last change hid. Only these
 *  leave their slots, so a hidden card opened from Compass stays when another card is hidden. */
export function newlyHidden(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((c) => !before.includes(c));
}

/**
 * The stored assignment, repaired against `pool` (2026-10-10): a slot whose card left the
 * pool (hidden, or no longer registered) takes its default, and a default that is out of the
 * pool or already used takes the first unused card of `order`. The other slots keep their
 * cards, so one hidden card no longer resets the whole layout. Null when nothing usable is
 * stored (no text, not JSON, not an object) or no card is left to fill a slot: the caller
 * then repairs its defaults the same way.
 *
 * `keep` is the set of cards a slot may still hold although they are not in the pool: the
 * hidden cards. A card the user opened from Compass stays in its slot across a restart.
 */
export function repairAssignment<S extends string, C extends string>(
  slots: readonly S[],
  raw: string | null,
  pool: ReadonlySet<string>,
  defaults: Partial<Record<S, C>>,
  order: readonly C[],
  keep: ReadonlySet<string> = new Set(),
): Partial<Record<S, C>> | null {
  if (!raw) return null;
  let s: Partial<Record<S, C>>;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || typeof s !== "object") return null;
  return fillSlots(slots, s, pool, defaults, order, keep);
}

/** Fill every slot: its own card when good, else its default, else the first unused card. */
export function fillSlots<S extends string, C extends string>(
  slots: readonly S[],
  want: Partial<Record<S, C>>,
  pool: ReadonlySet<string>,
  defaults: Partial<Record<S, C>>,
  order: readonly C[],
  keep: ReadonlySet<string> = new Set(),
): Partial<Record<S, C>> | null {
  const out: Partial<Record<S, C>> = {};
  const used = new Set<string>();
  const ok = (id: unknown, alsoKept: boolean): id is C =>
    typeof id === "string" && (pool.has(id) || (alsoKept && keep.has(id))) && !used.has(id);
  // First pass: the slots whose own card is good, so a default never takes a card that a
  // later slot already holds.
  for (const slot of slots) if (ok(want[slot], true)) { out[slot] = want[slot]; used.add(want[slot]!); }
  // Second pass: the open slots whose default is good; then the rest take the first unused
  // card, so one hidden default never moves another slot off its own default.
  for (const slot of slots) if (!out[slot] && ok(defaults[slot], false)) { out[slot] = defaults[slot]; used.add(defaults[slot]!); }
  for (const slot of slots) {
    if (out[slot]) continue;
    const pick = order.find((c) => ok(c, false));
    if (!pick) return null;
    out[slot] = pick;
    used.add(pick);
  }
  return out;
}

// ── Max cards (docs/features/MAX-CARDS.md) ──
// Max shows 4, 2 or 1 content cards beside the stage column. The grid is the stage in column
// 1 and the content area in columns 2.. and rows 1..; these tables are the one place that
// knows where each content slot sits, so card grow reads them instead of a fixed 2×2.

/** Settings › Window › Layout for Max (his words, 2026-10-11). */
export type MaxCards = "4" | "2cols" | "2rows" | "1";
export const MAX_CARDS: readonly MaxCards[] = ["4", "2cols", "2rows", "1"];
/** A stored value that is not one of the four reads as today's layout. */
export const maxCardsOf = (v: unknown): MaxCards => (MAX_CARDS.includes(v as MaxCards) ? (v as MaxCards) : "4");

export type MaxSlot = "left" | "right" | "c" | "d";
export type MaxSide = "left" | "right" | "up" | "down";

/** Each content slot's cell: grid column (2 = beside the stage) and row (1 = top). */
export const MAX_CELLS: Record<MaxCards, Partial<Record<MaxSlot, { col: number; row: number }>>> = {
  "4": { left: { col: 2, row: 1 }, right: { col: 3, row: 1 }, c: { col: 2, row: 2 }, d: { col: 3, row: 2 } },
  "2cols": { left: { col: 2, row: 1 }, right: { col: 3, row: 1 } },
  "2rows": { left: { col: 2, row: 1 }, right: { col: 2, row: 2 } },
  "1": { left: { col: 2, row: 1 } },
};

/** The content slots of a layout, in order (the LRU tie-break prefers the later one). */
export const maxSlots = (n: MaxCards): MaxSlot[] => Object.keys(MAX_CELLS[n]) as MaxSlot[];

/** The last content column and row of a layout. */
export function maxExtent(n: MaxCards): { col: number; row: number } {
  const cells = Object.values(MAX_CELLS[n]);
  return { col: Math.max(...cells.map((c) => c!.col)), row: Math.max(...cells.map((c) => c!.row)) };
}

const STEP: Record<MaxSide, { col: number; row: number }> = {
  left: { col: -1, row: 0 }, right: { col: 1, row: 0 }, up: { col: 0, row: -1 }, down: { col: 0, row: 1 },
};

/** Which content slot lies on each side of `slot` in a layout. */
export function maxNeighbors(n: MaxCards, slot: MaxSlot): Partial<Record<MaxSide, MaxSlot>> {
  const me = MAX_CELLS[n][slot];
  if (!me) return {};
  const out: Partial<Record<MaxSide, MaxSlot>> = {};
  for (const side of Object.keys(STEP) as MaxSide[]) {
    const at = { col: me.col + STEP[side].col, row: me.row + STEP[side].row };
    const hit = maxSlots(n).find((s) => MAX_CELLS[n][s]!.col === at.col && MAX_CELLS[n][s]!.row === at.row);
    if (hit) out[side] = hit;
  }
  return out;
}

/** A layout change made from a card on screen keeps that card on screen (his call,
 *  2026-10-11, MAX-CARDS.md §9.3): when the new map does not hold it, it takes the LAST slot
 *  (Library's in two cards, Home's in one). The map in storage is not changed. */
export function keepCard<S extends string, C extends string>(slots: readonly S[], layout: Partial<Record<S, C>>, card: C): Partial<Record<S, C>> {
  if (!slots.length || slots.some((s) => layout[s] === card)) return layout;
  return { ...layout, [slots[slots.length - 1]]: card };
}

/** Fill is its own grow only with four cards: with two, a grow over the other card is the
 *  whole content area already (his call, 2026-10-11), and one card has nothing to cover. */
export const maxCanFill = (n: MaxCards): boolean => n === "4";

/**
 * What lies past `side` of `slot`, at rest or grown by `mode`: another content card, the
 * stage or the top padding ("outer"), or the window edge. The left edge of content column 2
 * is always the gap beside the stage, in every layout (the full player's strip shares it).
 */
export function maxBeyond(n: MaxCards, slot: MaxSlot, side: MaxSide, mode: "wide" | "tall" | "full" | null): "card" | "outer" | "edge" | null {
  const me = MAX_CELLS[n][slot];
  if (!me) return null;
  const end = maxExtent(n);
  const cols = mode === "wide" || mode === "full" ? [2, end.col] : [me.col, me.col];
  const rows = mode === "tall" || mode === "full" ? [1, end.row] : [me.row, me.row];
  switch (side) {
    case "right": return cols[1] < end.col ? "card" : "edge";
    case "left": return cols[0] > 2 ? "card" : "outer";
    case "up": return rows[0] > 1 ? "card" : "outer";
    case "down": return rows[1] < end.row ? "card" : "edge";
  }
}

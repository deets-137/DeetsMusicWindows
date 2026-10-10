// The pure rules behind `loadLayout` and the Cards section (layout.ts; CARD-MEMORY.md,
// HIDE-CARDS.md): is a stored card assignment still good, and which cards may be hidden?
// No DOM, no registry, so tests/layout-rules.test.ts can pin them.

// ── Hide cards (docs/features/HIDE-CARDS.md) ──

/** The cards the Cards section can take out of the picker, in the registry order. Settings,
 *  Now Playing and Queue are never hidden (§2). */
export const HIDEABLE_CARDS = ["home", "library", "playlists", "search", "history", "rewind", "radio", "diary", "rulez"] as const;
/** Rulez opens at Fill and is never a fallback, so it does not count toward the minimum. */
const EVERYDAY = HIDEABLE_CARDS.filter((c) => c !== "rulez");
/** Max fills four slots: Settings is always offered, so three everyday cards must stay (§3). */
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

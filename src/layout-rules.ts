// The pure rule behind `loadLayout` (layout.ts; CARD-MEMORY.md): is a stored card
// assignment still good? No DOM, no registry, so tests/layout-rules.test.ts can pin it.

/**
 * The stored assignment for `slots`, or null when it cannot be used. It is good when every
 * slot holds a card, each card is in `pool` (registered, not anchored, not gated off) and no
 * card sits in two slots. Anything else, including text that is not JSON, is null, and the
 * caller falls back to its defaults. Keys outside `slots` are dropped.
 */
export function storedAssignment<S extends string, C extends string>(
  slots: readonly S[],
  raw: string | null,
  pool: ReadonlySet<string>,
): Partial<Record<S, C>> | null {
  if (!raw) return null;
  let s: Partial<Record<S, C>>;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || typeof s !== "object") return null;
  const picked = slots.map((slot) => s[slot]);
  const valid = picked.every((id) => typeof id === "string" && pool.has(id)) && new Set(picked).size === picked.length;
  if (!valid) return null;
  const out: Partial<Record<S, C>> = {};
  slots.forEach((slot) => (out[slot] = s[slot]));
  return out;
}

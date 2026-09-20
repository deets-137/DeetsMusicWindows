// Row order (MOVABLE-ROWS.md) — the user's own order for a card's sections, for the
// playlists inside a folder, and for the pinned tiles. One `row_order` table in the
// library database (roworder.rs), mirrored here as one in-memory map seeded at boot, so a
// sort never waits on the database.
//
// The one rule every card obeys (§2, fork 3A): a saved order is a RANK LIST OF IDS, never
// a list of positions, because every list here is computed on each render — a Home shelf
// vanishes when it is empty, a Settings section hides when its rows are gated off, a
// folder is made and deleted at any time. An id the rank list does not name is UNRANKED
// and sorts LAST, in the card's own built-in order. So a shelf a later version adds
// appears at the end, never inside the order you set.
//
// A hidden id keeps its rank for free: the rank list holds ids the render does not draw,
// so the Home bucket shelf that hides at 3 a.m. comes back in your place at 8 a.m.

import { invoke } from "@tauri-apps/api/core";
import { setting } from "./settings-store";
import * as diag from "./diag";

/** One ordered list. `playlists.folder:<key>` is per folder or cluster; the rest are one
 *  list each. `pins` is every pinned tile, shared by every shelf that draws them (fork 12:
 *  the hand order wins everywhere, Home included). */
export type OrderScope =
  | "settings.sections"
  | "home.shelves"
  | "radio.sections"
  | "playlists.sections"
  | "pins"
  | `playlists.folder:${string}`;

interface Row {
  scope: string;
  id: string;
  rank: number;
}

/** scope → (id → rank). Empty until `initRowOrder` lands; an empty map is the built-in
 *  order, which is exactly what a card should draw before the read returns. */
const ranks = new Map<string, Map<string, number>>();
let ready = false;

const listeners = new Set<() => void>();
/** A card re-renders when any order changes — its own, or one a Reset cleared. */
export function onRowOrderChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((cb) => cb());

/** Boot: the mirror. One read for every scope (§3). */
export async function initRowOrder(): Promise<void> {
  try {
    const rows = await invoke<Row[]>("row_order_all");
    ranks.clear();
    for (const r of rows) {
      let m = ranks.get(r.scope);
      if (!m) ranks.set(r.scope, (m = new Map()));
      m.set(r.id, r.rank);
    }
  } catch (e) {
    console.error("[row-order] list", e);
  }
  ready = true;
  emit();
}

/** Has the mirror landed? A card that draws before it does is drawing the built-in order,
 *  and the `onRowOrderChange` emit re-renders it. */
export const rowOrderReady = (): boolean => ready;

/** Does this scope hold a user order at all? (The Reset rows are offered only when there
 *  is something to reset.) */
export const hasRowOrder = (scope: OrderScope): boolean => (ranks.get(scope)?.size ?? 0) > 0;

/** Every scope that holds an order — Settings › Reset asks this before it offers. */
export const orderedScopes = (): string[] => [...ranks.keys()].filter((s) => (ranks.get(s)?.size ?? 0) > 0);

const RANK_MAX = Number.MAX_SAFE_INTEGER;
const rankOf = (scope: OrderScope, id: string): number => ranks.get(scope)?.get(id) ?? RANK_MAX;

/**
 * Sort a list into the user's order, STABLY: ranked ids first in their saved order, then
 * every unranked id in the order the caller passed (fork 3A). A stable sort is the whole
 * of rule 3A — the caller's own array IS the built-in order.
 */
export function sortByOrder<T>(scope: OrderScope, list: T[], idOf: (x: T) => string): T[] {
  const m = ranks.get(scope);
  if (!m || !m.size) return list;
  return list
    .map((x, i) => ({ x, i, r: rankOf(scope, idOf(x)) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.x);
}

/** The ids of `list` in the user's order — the same rule, when the caller holds ids. */
export const sortIds = (scope: OrderScope, ids: string[]): string[] => sortByOrder(scope, ids, (s) => s);

/**
 * Move `id` so it lands at index `to` of `visible` (the ids the card draws now, already in
 * the order on screen), and save the result.
 *
 * `visible` is what the user can see and therefore what they aimed at; ids that are ranked
 * but NOT visible keep their place relative to their old neighbours, so a Home bucket
 * shelf that is hidden at this hour is not thrown to the end by a drag it took no part in.
 */
export async function moveTo(scope: OrderScope, visible: string[], id: string, to: number): Promise<void> {
  const from = visible.indexOf(id);
  if (from < 0) return;
  const next = visible.slice();
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  await writeOrder(scope, next, { id, to });
}

/**
 * Save an order over `visible`, keeping every ranked-but-hidden id beside the neighbour it
 * had. The written list is the merge, so the next render of a card with everything showing
 * is the order the user built.
 */
export async function writeOrder(
  scope: OrderScope,
  visible: string[],
  moved?: { id: string; to: number },
): Promise<void> {
  const old = ranks.get(scope);
  const ids = mergeHidden(old, visible);
  const m = new Map<string, number>();
  ids.forEach((x, i) => m.set(x, i));
  ranks.set(scope, m);
  emit(); // paint first: the drop must land at once, not after a round trip
  // What a "my Home is in the wrong order" report needs (LOGGING.md, the read-never-guess
  // rule): the list, what moved, and where it landed.
  diag.log("order:set", {
    scope,
    n: ids.length,
    id: moved?.id ?? null,
    to: moved?.to ?? null,
    after: moved ? (ids[ids.indexOf(moved.id) - 1] ?? "(top)") : null,
  });
  try {
    await invoke("row_order_set", { scope, ids });
  } catch (e) {
    console.error("[row-order] set", e);
  }
}

/** Ranked ids the render did not draw, put back beside the id they used to follow. */
function mergeHidden(old: Map<string, number> | undefined, visible: string[]): string[] {
  if (!old || !old.size) return visible.slice();
  const shown = new Set(visible);
  const hidden = [...old.entries()]
    .filter(([id]) => !shown.has(id))
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  if (!hidden.length) return visible.slice();
  // Walk the OLD order; each hidden id goes back after the last visible id that preceded
  // it there. A hidden id that preceded every visible id goes to the front.
  const oldOrder = [...old.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const after = new Map<string, string[]>(); // visible id → hidden ids that follow it
  const front: string[] = [];
  let prev: string | null = null;
  for (const id of oldOrder) {
    if (shown.has(id)) prev = id;
    else if (prev === null) front.push(id);
    else after.set(prev, [...(after.get(prev) ?? []), id]);
  }
  const out = [...front];
  for (const id of visible) {
    out.push(id);
    const tail = after.get(id);
    if (tail) out.push(...tail);
  }
  return out;
}

/**
 * A drop in a list of ROWS, answered as a place among its SECTIONS.
 *
 * The cards that draw sections draw them as siblings in one flat list of rows (§4.1), so
 * the insertion index the drag gives back counts rows, not sections. Count the headers
 * that end up before it, with the moved header itself taken out: that number is where the
 * section lands.
 */
export function sectionAt(count: number, isHeader: (i: number) => boolean, from: number, to: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (i === from) continue;
    const j = i > from ? i - 1 : i; // this row's index once the moved row is out
    if (j >= to) break;
    if (isHeader(i)) n++;
  }
  return n;
}

// ── the gesture (fork 6, the owner 2026-09-20) ────────────────────────────────

/** Is the press-and-hold gesture on? Off means no section anywhere can be moved — a
 *  pinned tile keeps its grip bar, because that is a press on a control, not a hold. */
export const sectionsMovable = (): boolean => setting("moveSections");

/** How long a header is held before it becomes its own grip. The skin owns the number
 *  (`--hold-ms`), so the swell animation and the timer can never drift apart. */
export function holdMs(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hold-ms"));
  return Number.isFinite(v) && v > 0 ? v : 400;
}

/** The hold, ready to spread over a `DragRow`: nothing at all when the row is off. */
export const holdFor = (on = sectionsMovable()): { hold: number } | undefined => (on ? { hold: holdMs() } : undefined);

// ── Reset (§4.4) ──────────────────────────────────────────────────────────────

/** Every order, for an Undo. */
export type OrderSnapshot = [string, string[]][];
export const snapshotOrders = (): OrderSnapshot =>
  [...ranks.entries()].map(([scope, m]) => [scope, [...m.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)]);

/** Put a snapshot back — the Undo of a Reset. */
export async function restoreOrders(snap: OrderSnapshot): Promise<void> {
  ranks.clear();
  for (const [scope, ids] of snap) ranks.set(scope, new Map(ids.map((id, i) => [id, i])));
  emit();
  diag.log("order:restore", { n: snap.length });
  for (const [scope, ids] of snap) {
    try {
      await invoke("row_order_set", { scope, ids });
    } catch (e) {
      console.error("[row-order] restore", e);
    }
  }
}

/** Forget one scope's order, or all of them (Settings › Reset, §4.4). */
export async function resetOrder(scope?: OrderScope): Promise<void> {
  if (scope) ranks.delete(scope);
  else ranks.clear();
  emit();
  diag.log("order:reset", { scope: scope ?? "all" });
  try {
    await invoke("row_order_reset", { scope: scope ?? null });
  } catch (e) {
    console.error("[row-order] reset", e);
  }
}

/** Forget every `playlists.folder:*` scope — the folders' item orders, as one group. */
export async function resetFolderOrders(): Promise<void> {
  const scopes = [...ranks.keys()].filter((s) => s.startsWith("playlists.folder:"));
  for (const s of scopes) ranks.delete(s);
  emit();
  diag.log("order:reset", { scope: "playlists.folder:*", n: scopes.length });
  for (const s of scopes) {
    try {
      await invoke("row_order_reset", { scope: s });
    } catch (e) {
      console.error("[row-order] reset", e);
    }
  }
}

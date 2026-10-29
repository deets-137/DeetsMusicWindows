// The long list in a room, as pure rules (ROOMS.md §21). room.ts holds the state and the
// socket; this file only says what a list looks like after a packet or an edit, so the
// rules can be tested without a room (tests/room-list.test.ts).
//
// The keeper's app holds the full list L in play order, the first song included. The room
// was given `fed` of it (its window); the rest, L[fed..], is the tail. A member holds the
// part of L it was sent: `items` = L[offset..].

/** One song in the list. Only the id matters to these rules, and `added` to Clear Queue. */
export interface ListEntry {
  entryId: string;
  /** A member added it by hand (Add to Queue, Play Next), not the list that was played. */
  added?: boolean;
}

export interface ListCopy<E extends ListEntry> {
  rev: number;
  offset: number;
  items: E[];
}

/** The room's numbers for the list (the worker's `queue.list`). */
export interface ListNumbers {
  rev: number;
  len: number;
  fed: number;
}

/** The tail this copy can show: L[fed..] when the copy is the room's version. */
export function tailOf<E extends ListEntry>(copy: ListCopy<E>, room: ListNumbers): E[] {
  if (copy.rev !== room.rev || room.len <= room.fed) return [];
  const start = room.fed - copy.offset;
  return start >= 0 ? copy.items.slice(start) : [];
}

/** A whole-list send, gathered part by part. */
export interface Assembly<E extends ListEntry> {
  rev: number;
  offset: number;
  parts: number;
  got: Map<number, E[]>;
}

export interface SetPacket<E extends ListEntry> {
  rev: number;
  part: number;
  parts: number;
  offset: number;
  entries: E[];
}

/**
 * Take one part of a whole-list send. Returns the assembly so far, and the finished copy
 * once every part is in. A part of a newer send starts a new assembly.
 */
export function gather<E extends ListEntry>(
  assembly: Assembly<E> | null,
  p: SetPacket<E>,
): { assembly: Assembly<E> | null; done: ListCopy<E> | null } {
  let a = assembly;
  if (!a || a.rev !== p.rev || a.parts !== p.parts) a = { rev: p.rev, offset: p.offset, parts: p.parts, got: new Map() };
  if (p.part === 0) a.offset = p.offset;
  a.got.set(p.part, p.entries);
  if (a.got.size < a.parts) return { assembly: a, done: null };
  const items: E[] = [];
  for (let i = 0; i < a.parts; i++) items.push(...(a.got.get(i) ?? []));
  return { assembly: null, done: { rev: p.rev, offset: a.offset, items } };
}

export interface ChangePacket<E extends ListEntry> {
  op: "append" | "remove" | "move";
  rev: number;
  base: number;
  entries?: E[];
  entryId?: string;
  /** For a move: the place in the WHOLE list (L), not in this copy. */
  toIndex?: number;
}

/** One change on top of `base`. Null when this copy is not at `base`: ask for the whole list. */
export function applyChange<E extends ListEntry>(copy: ListCopy<E>, p: ChangePacket<E>): ListCopy<E> | null {
  if (p.base !== copy.rev) return null;
  const items = copy.items.slice();
  if (p.op === "append") items.push(...(p.entries ?? []));
  if (p.op === "remove" || p.op === "move") {
    const at = items.findIndex((e) => e.entryId === p.entryId);
    if (at >= 0) {
      const [moved] = items.splice(at, 1);
      if (p.op === "move") {
        const to = Math.max(0, Math.min(items.length, (p.toIndex ?? items.length) - copy.offset));
        items.splice(to, 0, moved);
      }
    }
  }
  return { rev: p.rev, offset: copy.offset, items };
}

/** What the keeper does to the list for a tail edit, and the change to send out. */
export type TailEdit<E extends ListEntry> =
  | { kind: "none" }
  | { kind: "jump"; from: E[] }
  | { kind: "change"; copy: ListCopy<E>; packet: Omit<ChangePacket<E>, "rev" | "base">; top?: E };

/**
 * A tail edit on the keeper's copy. `fed` is the room's; `toIndex` (a move) counts within
 * the tail, as a member's Up Next shows it. An entry no longer in the tail (it moved into
 * the window meanwhile) is left alone.
 */
export function editTail<E extends ListEntry>(
  copy: ListCopy<E>,
  fed: number,
  op: string,
  entryId: string,
  toIndex?: number,
): TailEdit<E> {
  const at = copy.items.findIndex((e) => e.entryId === entryId);
  const fedAt = fed - copy.offset;
  if (at < 0 || at < fedAt) return { kind: "none" };
  if (op === "jump") return { kind: "jump", from: copy.items.slice(at) };
  const items = copy.items.slice();
  const [entry] = items.splice(at, 1);
  const rev = copy.rev + 1;
  if (op === "top") return { kind: "change", copy: { ...copy, rev, items }, packet: { op: "remove", entryId }, top: entry };
  if (op === "move") {
    const to = Math.max(fedAt, Math.min(items.length, fedAt + (toIndex ?? items.length)));
    items.splice(to, 0, entry);
    return { kind: "change", copy: { ...copy, rev, items }, packet: { op: "move", entryId, toIndex: copy.offset + to } };
  }
  if (op === "remove") return { kind: "change", copy: { ...copy, rev, items }, packet: { op: "remove", entryId } };
  return { kind: "none" };
}

/**
 * Clear Queue on the keeper's copy (QUEUE.md § Clear Queue): the tail goes, or only its songs
 * added by hand. The songs the room was fed stay; the worker clears those. Null when nothing
 * changes. The keeper then sends the tail out again as a whole list.
 */
export function clearTail<E extends ListEntry>(copy: ListCopy<E>, fed: number, only: "added" | "all"): ListCopy<E> | null {
  const fedAt = fed - copy.offset;
  if (fedAt < 0) return null;
  const tail = copy.items.slice(fedAt);
  const keep = only === "added" ? tail.filter((e) => !e.added) : [];
  if (keep.length === tail.length) return null;
  return { rev: copy.rev + 1, offset: copy.offset, items: [...copy.items.slice(0, fedAt), ...keep] };
}

/** The keeper's next top-up: the songs that fill the window back up, and the new `fed`. */
export function topUpOf<E extends ListEntry>(
  copy: ListCopy<E>,
  room: ListNumbers,
  windowLen: number,
  maxWindow: number,
  topUpAt: number,
): { entries: E[]; fed: number } | null {
  if (copy.rev !== room.rev || windowLen > topUpAt) return null;
  const start = room.fed - copy.offset;
  if (start < 0) return null;
  const entries = copy.items.slice(start, start + Math.max(0, maxWindow - windowLen));
  return entries.length ? { entries, fed: room.fed + entries.length } : null;
}

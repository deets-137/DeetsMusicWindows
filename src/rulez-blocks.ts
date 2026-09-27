// Conditions as blocks (docs/features/RULEZ.md §6.4): "all of these" / "any of these" / "none of
// these", nested at any depth, the Smart Playlist model. A block is a `Cond` group, so the
// evaluator does not change: all = { all }, any = { any }, none = { not: { any } }. Pure;
// tests/rulez-blocks.test.ts. A path is the member indexes from the root block.

import type { Cond, Leaf, Rule } from "./rules-eval";

export type BlockKind = "all" | "any" | "none";
export interface Block {
  kind: BlockKind;
  members: Cond[];
}

export const isLeaf = (c: Cond): c is Leaf => "fact" in c;

/** A condition as a block, or null for a leaf. A `not` of a leaf is a "none" block of one. */
export function blockOf(c: Cond): Block | null {
  if ("all" in c) return { kind: "all", members: c.all };
  if ("any" in c) return { kind: "any", members: c.any };
  if ("not" in c) {
    const inner = c.not;
    if ("any" in inner) return { kind: "none", members: inner.any };
    if ("all" in inner && inner.all.length === 1) return { kind: "none", members: inner.all };
    return { kind: "none", members: [inner] };
  }
  return null;
}

export function fromBlock(b: Block): Cond {
  if (b.kind === "all") return { all: b.members };
  if (b.kind === "any") return { any: b.members };
  return { not: { any: b.members } };
}

/** The rule's condition as its root block (none, or a lone leaf, is "all of" one or none). */
export function rootBlock(r: Rule): Block {
  const c = r.kind === "state" ? r.while : r.if;
  if (!c) return { kind: "all", members: [] };
  return blockOf(c) ?? { kind: "all", members: [c] };
}

/** The node at `path` (a block's member, at any depth). */
export function nodeAt(root: Block, path: readonly number[]): Cond | Block {
  let b: Block = root;
  let n: Cond | Block = root;
  for (const i of path) {
    n = b.members[i];
    const next = blockOf(n);
    if (next) b = next;
  }
  return n;
}

/** Change the block at `path` (the root for []): `fn` gets a copy and returns the new block. */
export function withBlock(root: Block, path: readonly number[], fn: (b: Block) => Block): Block {
  if (!path.length) return fn({ kind: root.kind, members: [...root.members] });
  const [i, ...rest] = path;
  const child = blockOf(root.members[i]);
  if (!child) return root;
  const members = [...root.members];
  members[i] = fromBlock(withBlock(child, rest, fn));
  return { kind: root.kind, members };
}

/** Drop empty blocks below the root; a block of one stays (a group being built). */
export function tidyBlock(b: Block): Block {
  const members: Cond[] = [];
  for (const m of b.members) {
    const inner = blockOf(m);
    if (!inner) {
      members.push(m);
      continue;
    }
    const t = tidyBlock(inner);
    if (t.members.length) members.push(fromBlock(t));
  }
  return { kind: b.kind, members };
}

/** The condition to store: undefined for an empty root (a When rule with no If). */
export function toCond(b: Block): Cond | undefined {
  const t = tidyBlock(b);
  return t.members.length || t.kind !== "all" ? fromBlock(t) : undefined;
}

/** Remove the group at `path` and put its members in its place (§6.4: *Remove the group* lifts
 *  them up one level). A "none" group's members come up as they are. */
export function liftGroup(root: Block, path: readonly number[]): Block {
  if (!path.length) return root;
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  return withBlock(root, parent, (p) => {
    const g = blockOf(p.members[i]);
    if (!g) return p;
    const members = [...p.members];
    members.splice(i, 1, ...g.members);
    return { kind: p.kind, members };
  });
}

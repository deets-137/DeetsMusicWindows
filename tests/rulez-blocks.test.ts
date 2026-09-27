// rulez-blocks.ts: conditions as "all / any / none of these" blocks (RULEZ.md §6.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockOf, fromBlock, rootBlock, nodeAt, withBlock, tidyBlock, toCond, liftGroup } from "../src/rulez-blocks.ts";
import { evalCond, type Cond, type MomentRule } from "../src/rules-eval.ts";

const jazz = { fact: "genre", is: "jazz" } as const;
const rap = { fact: "genre", is: "rap" } as const;
const late = { fact: "time", gt: 1200 } as const;
const rule = (c?: Cond): MomentRule => ({ id: "r", kind: "moment", source: { user: true }, on: true, when: "song.play", card: "*", if: c, do: { next: true } });

test("none of these is not (any): the evaluator reads it unchanged", () => {
  const none = fromBlock({ kind: "none", members: [jazz, rap] });
  assert.deepEqual(none, { not: { any: [jazz, rap] } });
  assert.equal(evalCond(none, { genre: ["rock"] }), true);
  assert.equal(evalCond(none, { genre: ["rap"] }), false);
  assert.deepEqual(blockOf(none), { kind: "none", members: [jazz, rap] });
  assert.deepEqual(blockOf({ not: jazz }), { kind: "none", members: [jazz] }); // a rule made in the table era
});

test("a lone leaf or no If reads as an all-of root", () => {
  assert.deepEqual(rootBlock(rule()), { kind: "all", members: [] });
  assert.deepEqual(rootBlock(rule(jazz)), { kind: "all", members: [jazz] });
  assert.equal(toCond({ kind: "all", members: [] }), undefined);
});

test("his example as blocks: any of (all of (Jazz, after 8 PM), Rap)", () => {
  let root = { kind: "any" as const, members: [] as Cond[] };
  root = { ...root, members: [{ all: [jazz] }, rap] };
  root = withBlock(root, [0], (b) => ({ ...b, members: [...b.members, late] }));
  const c = toCond(root)!;
  assert.deepEqual(c, { any: [{ all: [jazz, late] }, rap] });
  assert.deepEqual(nodeAt(root, [0, 1]), late);
  assert.equal(evalCond(c, { genre: ["jazz"], time: 1300 }), true);
});

test("an empty group goes; a group of one stays; Remove the group lifts its members", () => {
  assert.deepEqual(tidyBlock({ kind: "all", members: [jazz, { any: [] }] }), { kind: "all", members: [jazz] });
  assert.deepEqual(tidyBlock({ kind: "all", members: [{ any: [rap] }] }), { kind: "all", members: [{ any: [rap] }] });
  assert.deepEqual(liftGroup({ kind: "all", members: [jazz, { any: [rap, late] }] }, [1]), { kind: "all", members: [jazz, rap, late] });
});

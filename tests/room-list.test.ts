// room-list.ts: the long list in a room (ROOMS.md §21, 2026-10-16). The keeper holds L, the
// room holds a window of `fed` songs, and members hold the tail they were sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChange, clearTail, editTail, gather, tailOf, topUpOf, type ListCopy } from "../src/room-list.ts";

const e = (id: string) => ({ entryId: id });
const L = (n: number) => Array.from({ length: n }, (_, i) => e(`s${i}`));
const ids = (xs: { entryId: string }[]) => xs.map((x) => x.entryId);

test("2026-10-16 the tail is L past what the room was given", () => {
  const keeper: ListCopy<{ entryId: string }> = { rev: 3, offset: 0, items: L(10) };
  assert.deepEqual(ids(tailOf(keeper, { rev: 3, len: 10, fed: 4 })), ["s4", "s5", "s6", "s7", "s8", "s9"]);
  // A member holds only what it was sent, from offset 4.
  const member = { rev: 3, offset: 4, items: L(10).slice(4) };
  assert.deepEqual(ids(tailOf(member, { rev: 3, len: 10, fed: 6 })), ["s6", "s7", "s8", "s9"]);
});

test("an older copy, or no tail, shows no tail", () => {
  const copy = { rev: 2, offset: 0, items: L(10) };
  assert.deepEqual(tailOf(copy, { rev: 3, len: 10, fed: 4 }), []);
  assert.deepEqual(tailOf({ ...copy, rev: 3 }, { rev: 3, len: 10, fed: 10 }), []);
  // A member sent from 6 cannot show a tail from 4.
  assert.deepEqual(tailOf({ rev: 3, offset: 6, items: L(10).slice(6) }, { rev: 3, len: 10, fed: 4 }), []);
});

test("a whole-list send is finished only when every part is in, in part order", () => {
  let a = gather(null, { rev: 5, part: 1, parts: 2, offset: 103, entries: [e("b")] });
  assert.equal(a.done, null);
  a = gather(a.assembly, { rev: 5, part: 0, parts: 2, offset: 100, entries: [e("a")] });
  assert.deepEqual(a.done, { rev: 5, offset: 100, items: [e("a"), e("b")] });
  assert.equal(a.assembly, null);
});

test("a part of a newer send drops the older half-finished one", () => {
  let a = gather(null, { rev: 5, part: 0, parts: 2, offset: 100, entries: [e("old")] });
  a = gather(a.assembly, { rev: 6, part: 0, parts: 1, offset: 100, entries: [e("new")] });
  assert.deepEqual(a.done?.items, [e("new")]);
  assert.equal(a.done?.rev, 6);
});

test("a change applies only on its base, else the member asks for the whole list", () => {
  const copy = { rev: 4, offset: 0, items: L(3) };
  assert.equal(applyChange(copy, { op: "append", rev: 6, base: 5, entries: [e("x")] }), null);
  assert.deepEqual(ids(applyChange(copy, { op: "append", rev: 5, base: 4, entries: [e("x")] })!.items), ["s0", "s1", "s2", "x"]);
  assert.deepEqual(ids(applyChange(copy, { op: "remove", rev: 5, base: 4, entryId: "s1" })!.items), ["s0", "s2"]);
});

test("a move names a place in the whole list, so a member with an offset lands it right", () => {
  // Keeper's L = s0..s9; the member holds s4..s9. Move s9 to L index 5.
  const member = { rev: 1, offset: 4, items: L(10).slice(4) };
  const moved = applyChange(member, { op: "move", rev: 2, base: 1, entryId: "s9", toIndex: 5 })!;
  assert.deepEqual(ids(moved.items), ["s4", "s9", "s5", "s6", "s7", "s8"]);
});

test("a tail edit leaves the window alone", () => {
  const copy = { rev: 1, offset: 0, items: L(10) };
  assert.deepEqual(editTail(copy, 4, "remove", "s2"), { kind: "none" }); // s2 is in the window
  assert.deepEqual(editTail(copy, 4, "remove", "nope"), { kind: "none" });
});

test("remove, move and top on the tail; the packet a member applies gives the same list", () => {
  const copy = { rev: 1, offset: 0, items: L(10) };
  const member = { rev: 1, offset: 4, items: L(10).slice(4) };
  for (const [op, toIndex] of [["remove"], ["move", 0], ["move", Number.MAX_SAFE_INTEGER], ["top"]] as const) {
    const edit = editTail(copy, 4, op, "s7", toIndex);
    assert.equal(edit.kind, "change", op);
    if (edit.kind !== "change") continue;
    assert.equal(edit.copy.rev, 2);
    const theirs = applyChange(member, { ...edit.packet, rev: 2, base: 1 })!;
    assert.deepEqual(ids(theirs.items), ids(edit.copy.items.slice(4)), `${op} ${toIndex ?? ""}`);
  }
  const top = editTail(copy, 4, "top", "s7");
  assert.equal(top.kind === "change" && top.top?.entryId, "s7");
  const first = editTail(copy, 4, "move", "s7", 0);
  assert.deepEqual(first.kind === "change" && ids(first.copy.items).slice(4, 6), ["s7", "s4"]);
});

test("play from a tail song: the list from that song on", () => {
  const edit = editTail({ rev: 1, offset: 0, items: L(10) }, 4, "jump", "s8");
  assert.deepEqual(edit.kind === "jump" && ids(edit.from), ["s8", "s9"]);
});

test("2026-10-16 a top-up fills the window back to its size from where the room is", () => {
  const copy = { rev: 2, offset: 0, items: L(250) };
  const room = { rev: 2, len: 250, fed: 100 };
  assert.equal(topUpOf(copy, room, 60, 100, 50), null); // not low yet
  const up = topUpOf(copy, room, 50, 100, 50)!;
  assert.equal(up.entries.length, 50);
  assert.equal(up.entries[0].entryId, "s100");
  assert.equal(up.fed, 150);
  // The end of the list: only what is left.
  assert.equal(topUpOf(copy, { ...room, fed: 240 }, 0, 100, 50)!.entries.length, 10);
  assert.equal(topUpOf(copy, { ...room, fed: 250 }, 0, 100, 50), null);
  // An older copy never feeds the room.
  assert.equal(topUpOf({ ...copy, rev: 1 }, room, 0, 100, 50), null);
});

test("2026-10-29 Clear Queue: the keeper clears the tail, or only its added songs; the fed part stays", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ entryId: id, added: id === "d" }));
  const copy: ListCopy<{ entryId: string; added: boolean }> = { rev: 4, offset: 0, items };
  // fed = 2: a and b went to the room; c, d, e are the tail.
  assert.deepEqual(clearTail(copy, 2, "all")!.items.map((e) => e.entryId), ["a", "b"]);
  const added = clearTail(copy, 2, "added")!;
  assert.deepEqual(added.items.map((e) => e.entryId), ["a", "b", "c", "e"]);
  assert.equal(added.rev, 5);
  // Nothing to take out: no new version.
  assert.equal(clearTail({ ...copy, items: items.filter((e) => !e.added) }, 2, "added"), null);
  assert.equal(clearTail(copy, 5, "all"), null);
});

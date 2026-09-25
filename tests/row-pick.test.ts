// row-pick.ts: Ctrl and Shift row picks (NEXT-VERSION §19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowPick, picksText } from "../src/row-pick.ts";

const click = (mods: { ctrl?: boolean; shift?: boolean } = {}) =>
  ({ ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, preventDefault() {} }) as unknown as MouseEvent;

function host(items: string[], can?: (x: string) => boolean) {
  let changes = 0;
  const pick = rowPick<string>({ id: (x) => x, items: () => items, can, onChange: () => changes++ });
  return { pick, changes: () => changes };
}

test("Ctrl+click toggles one row and says it was a pick", () => {
  const { pick } = host(["a", "b", "c"]);
  assert.equal(pick.click(click({ ctrl: true }), "b"), true);
  assert.deepEqual(pick.picked(), ["b"]);
  pick.click(click({ ctrl: true }), "b");
  assert.equal(pick.size(), 0);
});

test("Shift+click takes the run from the anchor, in view order, and never removes", () => {
  const { pick } = host(["a", "b", "c", "d", "e"]);
  pick.click(click({ ctrl: true }), "d");
  pick.click(click({ shift: true }), "b");
  assert.deepEqual(pick.picked(), ["b", "c", "d"]);
  pick.click(click({ shift: true }), "c");
  assert.deepEqual(pick.picked(), ["b", "c", "d"]);
});

test("a Shift run steps over rows that take no pick", () => {
  const { pick } = host(["a", "hdr", "b", "c"], (x) => x !== "hdr");
  pick.click(click({ ctrl: true }), "a");
  pick.click(click({ shift: true }), "c");
  assert.deepEqual(pick.picked(), ["a", "b", "c"]);
});

test("a plain click clears the picks and plays the row", () => {
  const { pick } = host(["a", "b"]);
  pick.click(click({ ctrl: true }), "a");
  assert.equal(pick.click(click(), "b"), false);
  assert.equal(pick.size(), 0);
});

test("Ctrl+A takes every pickable row", () => {
  const { pick } = host(["a", "hdr", "b"], (x) => x !== "hdr");
  pick.all();
  assert.deepEqual(pick.picked(), ["a", "b"]);
});

test("picksText counts in the singular and the plural", () => {
  assert.equal(picksText(1), "1 song");
  assert.equal(picksText(3), "3 songs");
  assert.equal(picksText(2, "album"), "2 albums");
});

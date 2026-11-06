import { test } from "node:test";
import assert from "node:assert/strict";
import { fillGoals, keptTotal } from "../src/donate-rules.ts";

const TOPS = [200, 100];

test("2026-11-05: the kept total is whole dollars, and anything else reads as 0", () => {
  assert.equal(keptTotal("75"), 75);
  assert.equal(keptTotal("0"), 0);
  for (const bad of [null, "", "-5", "7.5", "abc"]) assert.equal(keptTotal(bad), 0);
});

test("2026-11-04: the first goal fills before the second gets anything", () => {
  assert.deepEqual(fillGoals(TOPS, 75), [75, 0]);
  assert.deepEqual(fillGoals(TOPS, 200), [200, 0]);
});

test("2026-11-04: what is over the first goal goes to the second", () => {
  assert.deepEqual(fillGoals(TOPS, 250), [200, 50]);
});

test("2026-11-04: more than every goal stops at full, and less than nothing is nothing", () => {
  assert.deepEqual(fillGoals(TOPS, 900), [200, 100]);
  assert.deepEqual(fillGoals(TOPS, -5), [0, 0]);
});

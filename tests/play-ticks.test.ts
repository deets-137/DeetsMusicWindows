// play-ticks.ts: which progress ticks the play log drops (stats.ts recordProgress).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleTick, STALE_MS } from "../src/play-ticks.ts";

test("2026-11-01: the last song's tick at 95 %, 3 ms into the next play, is stale (the dev log, song 6810354228)", () => {
  assert.equal(isStaleTick(3, 171), true);
});

test("2026-11-01: a real start, a scrub after the first second, and a late tick are kept", () => {
  assert.equal(isStaleTick(3, 0.2), false, "a new play's own first tick sits near 0");
  assert.equal(isStaleTick(STALE_MS + 200, 230), false, "a scrub by hand comes after the first second");
  assert.equal(isStaleTick(40_000, 41), false, "an ordinary tick mid-song");
});

// drum.ts: the zoetrope's perspective for a cover's width (metal.md §6.8.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { drumPerspective, drumBack } from "../src/drum.ts";

// Where a point of a side cover lands: the CSS transform perspective(P) translateX(run × w)
// translateZ(back) rotateY(turn), around the cover's center. Returns the projected x and the
// scale at that point.
const project = (P: number, w: number, xLocal: number, run = 0.26, turn = 30, scale = 0.86) => {
  const t = (turn * Math.PI) / 180;
  const z = drumBack(P, scale) - xLocal * Math.sin(t);
  const s = P / (P - z);
  return { x: (run * w + xLocal * Math.cos(t)) * s, s };
};

test("2026-10-21 a stage cover keeps the perspective it was tuned on", () => {
  assert.equal(drumPerspective(900, 2.25, 226), 900); // his stage today
  assert.equal(drumPerspective(900, 2.25, 400), 900); // the size it was tuned on
  assert.equal(drumPerspective(900, 0, 1200), 900); // 0: the fixed perspective
});

test("2026-10-21 a larger cover grows the perspective with it", () => {
  assert.equal(drumPerspective(900, 2.25, 673), 2.25 * 673);
});

test("2026-10-21 the full player's side covers: no wedge, the stage's shape at any size", () => {
  // The fault: 900 px on a 673 px cover. The inner edge came out taller than the cover.
  assert.ok(project(900, 673, -673 / 2).s > 1);
  for (const w of [400, 673, 1000]) {
    const P = drumPerspective(900, 2.25, w);
    assert.ok(project(P, w, -w / 2).s < 1, `inner edge shorter than the cover at ${w}`);
    // The outer edge shows the same share of the cover past its edge as at 400 px.
    const share = (project(P, w, w / 2).x - w / 2) / w;
    const at400 = (project(900, 400, 200).x - 200) / 400;
    assert.ok(Math.abs(share - at400) < 1e-9, `the same peek at ${w}`);
  }
  // Measured on his stage (2026-10-21): a 226 px cover, the side covers 14–15 px past it.
  assert.equal(Math.round(project(900, 226, 113).x - 113), 15);
});

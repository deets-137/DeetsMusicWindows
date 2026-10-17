// The page sample names a built chunk's column through its source map (2026-10-17,
// DEBUGGING.md § The page sample). The decoder and the lookup are pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMappings, lookup } from "../src/source-map-lite.ts";

test("source map (2026-10-17): segments carry over between lines, sources and lines are relative", () => {
  // Line 1: col 0 → src 0 line 0; col 2 → src 0 line 0. Line 2: col 0 → src 0 line 1;
  // col 16 (a two-digit VLQ, "gB") → src 1 line 0 (src +1, line −1, "CD").
  const lines = decodeMappings("AAAA,EAAE;AACA,gBCDA");
  assert.deepEqual(lines, [
    [[0, 0, 0], [2, 0, 0]],
    [[0, 0, 1], [16, 1, 0]],
  ]);
});

test("source map (2026-10-17): a column takes the segment at or before it; 1-based in and out", () => {
  const lines = decodeMappings("AAAA,EAAE;AACA,gBCDA");
  assert.deepEqual(lookup(lines, 2, 1), { src: 0, line: 2 });
  assert.deepEqual(lookup(lines, 2, 16), { src: 0, line: 2 });
  assert.deepEqual(lookup(lines, 2, 17), { src: 1, line: 1 });
  assert.deepEqual(lookup(lines, 2, 900), { src: 1, line: 1 });
  assert.equal(lookup(lines, 3, 1), null);
});

test("source map (2026-10-17): an empty line and a segment with no source are left out", () => {
  // ";;" = three empty lines; "C" alone is a column with no source.
  assert.deepEqual(decodeMappings(";;"), [[], [], []]);
  assert.deepEqual(decodeMappings("C,AAAA"), [[[1, 0, 0]]]);
});

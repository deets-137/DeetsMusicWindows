// album-slots.ts: the album as neon, for Ocean's crests and the card edges of Press and Cyber
// (ALBUM-COLOR.md § The album light).
import { test } from "node:test";
import assert from "node:assert/strict";
import { albumNeon, asNeon, fromOKLCH, parseColor, toOKLCH, type RGB } from "../src/album-slots.ts";

const chroma = (hex: string) => toOKLCH(parseColor(hex)!)[1];
const VIVID = "#e0309a";
const TEAL = "#109a90";
const GREY = "#777777";
const DARK_GREY = "#19191a";

test("fromOKLCH (2026-11-05): a color survives the round trip; a wrong green number tinted every grey pink", () => {
  const colors: RGB[] = [[0.5, 0.5, 0.5], [0.9, 0.9, 0.9], [0.2, 0.6, 0.4], [0.7, 0.3, 0.5]];
  for (const c of colors) fromOKLCH(toOKLCH(c)).forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 0.001));
});

test("the neon (2026-11-05): the lightness Ocean's crests were designed for", () => {
  const c: RGB = [0.55, 0.35, 0.4]; // mild enough to stay in sRGB at every lightness below
  assert.ok(Math.abs(toOKLCH(asNeon(c, true).bloom)[0] - 0.72) < 0.01);
  assert.ok(Math.abs(toOKLCH(asNeon(c, true).core)[0] - 0.92) < 0.01);
  assert.ok(Math.abs(toOKLCH(asNeon(c, false).bloom)[0] - 0.62) < 0.01);
  assert.ok(Math.abs(toOKLCH(asNeon(c, false).core)[0] - 0.45) < 0.01);
});

test("the album light (2026-11-05): the most colorful color is the primary, whatever Apple named it", () => {
  const byBg = albumNeon({ bg: VIVID, c1: DARK_GREY, c2: GREY }, true)!;
  const byText = albumNeon({ bg: DARK_GREY, c1: GREY, c2: VIVID }, true)!;
  assert.equal(byBg.bloom, byText.bloom);
  assert.ok(chroma(byBg.bloom) > 0.1);
});

test("the album light (2026-11-05): two real colors give the bolts the second one", () => {
  const n = albumNeon({ bg: VIVID, c1: TEAL, c2: GREY }, true)!;
  assert.notEqual(n.second, n.bloom);
  assert.ok(chroma(n.second) > 0.05);
});

test("the album light (2026-11-05): a grey second color gives the bolts the primary", () => {
  const n = albumNeon({ bg: VIVID, c1: GREY, c2: DARK_GREY }, true)!;
  assert.equal(n.second, n.bloom);
});

test("the album light (2026-11-05): an all-grey cover lights white on a dark ground, with no hue invented", () => {
  const n = albumNeon({ bg: GREY, c1: DARK_GREY, c2: "#aaaaaa" }, true)!;
  assert.ok(toOKLCH(parseColor(n.bloom)!)[0] > 0.9);
  assert.ok(chroma(n.bloom) < 0.02);
  assert.ok(chroma(n.second) < 0.02);
});

test("the album light (2026-11-05): a light ground gets a deeper color, so the line stays seen", () => {
  const dark = albumNeon({ bg: VIVID, c1: TEAL, c2: GREY }, true)!;
  const light = albumNeon({ bg: VIVID, c1: TEAL, c2: GREY }, false)!;
  assert.ok(toOKLCH(parseColor(light.core)!)[0] < toOKLCH(parseColor(dark.core)!)[0]);
});

test("the album light (2026-11-05): an empty palette gives no neon", () => {
  assert.equal(albumNeon({ bg: null, c1: null, c2: null }, true), null);
});

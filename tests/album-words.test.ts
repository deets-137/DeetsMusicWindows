// album-slots.ts: the album's color as words, for Rulez's facts (RULEZ.md §11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLOR_NAMES, albumWords, colorName } from "../src/album-slots.ts";
import { RECIPES } from "../src/rules-recipes.ts";
import { resolveState } from "../src/rules-eval.ts";

test("Live Theming (2026-09-27): every color, light or dark, picks exactly one theme of its own lightness", () => {
  const live = RECIPES.find((r) => r.id === "live")!;
  const LIGHT = ["lilac", "green", "sepia"];
  for (const w of COLOR_NAMES)
    for (const light of [true, false]) {
      const holding = live.rules.filter((r) => resolveState([r], { albumColor: w, albumLight: light }, []).set.has("key:theme"));
      assert.equal(holding.length, 1, `${w} ${light}`);
      const theme = resolveState(live.rules, { albumColor: w, albumLight: light }, []).set.get("key:theme")?.value as string;
      assert.equal(LIGHT.includes(theme), light, `${w} ${light} → ${theme}`);
    }
  assert.equal(resolveState(live.rules, { albumColor: "yellow", albumLight: false }, []).set.get("key:theme")?.value, "black-yellow");
  assert.equal(resolveState(live.rules, { albumColor: "yellow" }, []).set.size, 0); // no lightness yet: nothing holds
  assert.equal(resolveState(live.rules, {}, []).set.size, 0);
});

test("colorName: the pure colors land in their bands (2026-09-27)", () => {
  const cases: [string, string][] = [
    ["#ff0000", "red"], ["#ff8000", "orange"], ["#ffff00", "yellow"], ["#00ff00", "green"],
    ["#00ffff", "teal"], ["#0000ff", "blue"], ["#8000ff", "purple"], ["#ff00ff", "pink"], ["#ff69b4", "pink"],
  ];
  for (const [hex, name] of cases) assert.equal(colorName(hex), name, hex);
});

test("colorName: grey below the chroma floor, brown for a dark orange", () => {
  assert.equal(colorName("#808080"), "grey");
  assert.equal(colorName("#19191a"), "grey");
  assert.equal(colorName("#6b3e1a"), "brown");
  assert.equal(colorName("nope"), undefined);
});

test("albumWords: the most colorful color names it, the main field says light or dark", () => {
  // The lilac cover (ALBUM-COLOR.md): its lilac is bg, its text colors are near grey.
  assert.deepEqual(albumWords({ bg: "#bc92ec", c1: "#19191a", c2: "#24202c" }), { color: "purple", light: true });
  assert.deepEqual(albumWords({ bg: "#101820", c1: "#e04030", c2: "#c0c0c0" }), { color: "red", light: false });
  assert.deepEqual(albumWords(null), { color: undefined, light: undefined });
});

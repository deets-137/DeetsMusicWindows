// Recipes (docs/features/RULEZ.md §4, route 3): rule sets DeetsMusic ships, one switch each.
// His call, 2026-09-27: all four ship, off, so a user who finds them has a starting point.
// Rulez shows a recipe's rules locked under a Recipes divider; Duplicate copies them into your
// own list to change. Pure: rules.ts adds the rules of the recipes you turned on.

import { ALWAYS, SHARING_KEYS, type Rule } from "./rules-eval";

export interface Recipe {
  id: string;
  name: string;
  desc: string;
  rules: Rule[];
}

const src = (id: string) => ({ recipe: id });

export const RECIPES: Recipe[] = [
  {
    id: "night",
    name: "Night listening",
    desc: "From 10 PM to 6 AM: the Late night preset and a quieter volume.",
    rules: [
      {
        id: "recipe:night:0", kind: "state", source: src("night"), on: true, name: "Night listening",
        while: { any: [{ fact: "time", gte: 22 * 60 }, { fact: "time", lt: 6 * 60 }] },
        set: [{ target: { key: "soundEqPreset" }, value: "night" }, { target: { prop: "volume" }, value: 40 }],
        onHand: "next",
      },
    ],
  },
  {
    id: "focus",
    name: "Focus",
    desc: "While it is on: sharing pauses, and an explicit song is skipped.",
    rules: [
      {
        id: "recipe:focus:0", kind: "state", source: src("focus"), on: true, name: "Focus: pause sharing",
        while: ALWAYS, set: SHARING_KEYS.map((k) => ({ target: { key: k }, value: false })), onHand: "next",
      },
      {
        id: "recipe:focus:1", kind: "moment", source: src("focus"), on: true, name: "Focus: skip explicit songs",
        when: "song.play", card: "*", if: { fact: "explicit", is: true }, do: { next: true },
      },
    ],
  },
  {
    id: "headphones",
    name: "Headphones",
    desc: "On headphones: the Warm preset. Speakers keep your own pick.",
    rules: [
      {
        id: "recipe:headphones:0", kind: "state", source: src("headphones"), on: true, name: "Headphones",
        while: { fact: "outputKind", is: ["headphones", "headset"] },
        set: [{ target: { key: "soundEqPreset" }, value: "warm" }], onHand: "next",
      },
    ],
  },
  {
    id: "party",
    name: "Party",
    desc: "The music never stops: when the queue runs out, your Discovery station plays. A grown card stays open.",
    rules: [
      {
        id: "recipe:party:0", kind: "moment", source: src("party"), on: true, name: "Party: keep playing",
        when: "queue.end", card: "*", do: { playStation: { special: "discovery" } as never },
      },
      {
        id: "recipe:party:1", kind: "state", source: src("party"), on: true, name: "Party: grown cards stay",
        while: ALWAYS, set: [{ target: { key: "cardGrowOutside" }, value: false }], onHand: "next",
      },
    ],
  },
  {
    // Route 8 (RULEZ.md §10.1, FUTURE-SETTINGS §22): a recipe, not a row. *Play* resumes the queue
    // the app restored (§22's "Last song"); Duplicate and change the Do for a playlist or a
    // station. A start in the tray never plays (rules-app.ts `emitAppOpen`).
    id: "launch",
    name: "Play on launch",
    desc: "When DeetsMusic opens, the song you left off plays. Not when it starts in the tray.",
    rules: [
      {
        id: "recipe:launch:0", kind: "moment", source: src("launch"), on: true, name: "Play on launch",
        when: "app.open", card: "*", do: { play: true },
      },
    ],
  },
];

/** The rules of the recipes that are on, in the list's order. */
export function recipeRules(on: readonly string[]): Rule[] {
  return RECIPES.filter((r) => on.includes(r.id)).flatMap((r) => r.rules);
}

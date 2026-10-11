// Recipes (docs/features/RULEZ.md §4, route 3): rule sets DeetsMusic ships, one switch each.
// His call, 2026-09-27: all four ship, off, so a user who finds them has a starting point. The
// descriptions are user copy, one sentence each in the Tips voice (2026-10-10).
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
    desc: "From 10 PM to 6 AM: a softer sound and a quieter volume.",
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
    desc: "Pauses sharing and shows only failure notices while it is on.",
    rules: [
      {
        // The two Friends switches ride with the sharing ones (his call, 2026-09-27); the hour's
        // pause (SHARING_KEYS, FRIENDS.md D11) still covers the Sharing section only.
        id: "recipe:focus:0", kind: "state", source: src("focus"), on: true, name: "Focus: pause sharing",
        while: ALWAYS,
        set: ([...SHARING_KEYS, "friendsListenAlong", "friendsRoomInvite"] as const).map((k) => ({ target: { key: k }, value: false })),
        // Each switch holds on its own (his call, 2026-09-29): turning one back on by hand leaves
        // the other four paused. Battery saver keeps its whole-rule hold (his call, 2026-09-27).
        onHand: "next", holdEach: true,
      },
      {
        id: "recipe:focus:2", kind: "state", source: src("focus"), on: true, name: "Focus: failures only",
        while: ALWAYS, set: [{ target: { key: "toasts" }, value: "failures" }], onHand: "next",
      },
    ],
  },
  {
    // Its own recipe since 2026-10-10: a user who wants a quiet work session does not want songs
    // skipped (it sat in Focus before).
    id: "clean",
    name: "Clean",
    desc: "Skips explicit songs as they come up.",
    rules: [
      {
        id: "recipe:clean:0", kind: "moment", source: src("clean"), on: true, name: "Clean",
        when: "song.play", card: "*", if: { fact: "explicit", is: true }, do: { next: true },
      },
    ],
  },
  {
    id: "headphones",
    name: "Headphones",
    desc: "A warmer sound on headphones; speakers keep your own pick.",
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
    // One rule since 2026-10-10: "grown cards stay open" was a window preference with no link to
    // a party (it had a home here for the cancel event's sake).
    desc: "When the queue runs out, your Discovery station keeps the music going.",
    rules: [
      {
        id: "recipe:party:0", kind: "moment", source: src("party"), on: true, name: "Party",
        when: "queue.end", card: "*", do: { playStation: { special: "discovery" } as never },
      },
    ],
  },
  {
    // The rule keys of 2026-09-27 (RULES.md §18): the heavy drawing stops while the PC runs on its
    // battery. Fancy Glass is the largest graphics cost we measured (DEBUGGING.md); Reduced keeps
    // the backgrounds alive; the Fancy scrubber stays yours. A desktop reports charging, so the
    // rule never holds there; a WebView with no battery API has no fact, so it never holds either.
    id: "battery",
    name: "Battery saver",
    desc: "Lighter drawing while the PC runs on its battery.",
    rules: [
      {
        id: "recipe:battery:0", kind: "state", source: src("battery"), on: true, name: "Battery saver",
        while: { fact: "charging", is: false },
        set: [
          { target: { key: "glassFancy" }, value: false },
          { target: { key: "backgroundMotion" }, value: "reduced" },
          { target: { key: "cardSwapMotion" }, value: false },
          { target: { key: "appearanceMotion" }, value: false },
        ],
        onHand: "next",
      },
    ],
  },
  {
    // Route 8 (RULEZ.md §10.1, FUTURE-SETTINGS §22): a recipe, not a row. *Play* resumes the queue
    // the app restored (§22's "Last song"); Duplicate and change the Do for a playlist or a
    // station. A start in the tray never plays (rules-app.ts `emitAppOpen`).
    id: "launch",
    name: "Play on launch",
    desc: "Plays where you left off when DeetsMusic opens, not when it starts in the tray.",
    rules: [
      {
        id: "recipe:launch:0", kind: "moment", source: src("launch"), on: true, name: "Play on launch",
        when: "app.open", card: "*", do: { play: true },
      },
    ],
  },
];

// Live Theming (RULEZ.md §11.1, his ask 2026-09-27): the theme follows the playing song's cover.
// A light cover picks a light theme (Lilac, Green, Sepia), a dark cover a dark one (Moonlight,
// Black & Yellow, Black & Red) — his call the same day — and the cover's color (`albumColor`)
// picks the nearest of the three by the theme's own colors (its flyout hint in index.html).
// With no song or no palette no rule holds, and your theme (or the look schedule's) shows. A
// hand pick holds until the next cover that picks another theme (`onHand: "next"`).
const LIVE_THEMES: [theme: string, light: boolean, words: string[], says: string][] = [
  ["sepia", true, ["red", "orange", "brown", "yellow"], "light warm covers"],
  ["green", true, ["green", "teal"], "light green covers"],
  ["lilac", true, ["blue", "grey", "purple", "pink"], "light cool covers"],
  ["black-red", false, ["red", "pink"], "dark red covers"],
  ["black-yellow", false, ["orange", "brown", "yellow"], "dark warm covers"],
  ["moonlight", false, ["green", "teal", "blue", "grey", "purple"], "dark cool covers"],
];

RECIPES.push({
  id: "live",
  name: "Live Theming",
  desc: "The theme follows the album cover: light or dark, warm or cool.",
  rules: LIVE_THEMES.map(([theme, light, words, says], i): Rule => ({
    id: `recipe:live:${i}`, kind: "state", source: src("live"), on: true, name: `Live Theming: ${says}`,
    while: { all: [{ fact: "albumLight", is: light }, { fact: "albumColor", is: words }] },
    set: [{ target: { key: "theme" }, value: theme }], onHand: "next",
  })),
});

/** The rules of the recipes that are on, in the list's order. */
export function recipeRules(on: readonly string[]): Rule[] {
  return RECIPES.filter((r) => on.includes(r.id)).flatMap((r) => r.rules);
}

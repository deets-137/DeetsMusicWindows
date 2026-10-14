// usage-keys.ts: the usage report's allow-list (USAGE-COUNTS.md §4). Every toggle and choice
// spec in agent-settings.ts is either sent or listed as not sent, so a new setting is never
// sent, or skipped, without a decision. No slider, time or size is ever sent. The worker's
// copy (DeetsSupport src/usage-keys.js) matches the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { REPORTED, NOT_REPORTED, ROOM_GUEST_CONTROLS } from "../src/usage-keys.ts";
import { HIDEABLE_CARDS } from "../src/layout-rules.ts";

const src = readFileSync(new URL("../src/agent-settings.ts", import.meta.url), "utf8");
const specs = src.split("const SPECS")[1].split("const SECTIONS")[0];

/** Every spec key with its kind, read from the source the way docs:check reads it. */
function specKeys(): Map<string, string> {
  const out = new Map<string, string>();
  const kindOf: Record<string, string> = {
    storeChoice: "choice", storeToggle: "toggle", rustToggle: "toggle", storeRange: "range",
  };
  for (const m of specs.matchAll(/(storeChoice|storeToggle|rustToggle|storeRange)\(\s*"[^"]*",\s*"([^"]+)"/g)) out.set(m[2], kindOf[m[1]]);
  for (const m of specs.matchAll(/storeTime\(\s*"([^"]+)"/g)) out.set(m[1], "time");
  for (const m of specs.matchAll(/storeSize\(\s*"([^"]+)"/g)) out.set(m[1], "size");
  for (const m of specs.matchAll(/key: "([^"]+)",[^\n]*kind: "(\w+)"/g)) out.set(m[1], m[2]);
  for (const c of ROOM_GUEST_CONTROLS) out.set(`roomGuests.${c}`, "choice");
  for (const c of HIDEABLE_CARDS) out.set(`hiddenCards.${c}`, "toggle");
  return out;
}

test("the spec reader finds the specs", () => {
  const keys = specKeys();
  assert.ok(keys.size > 100, `found only ${keys.size}`);
  assert.equal(keys.get("skin"), "choice");
  assert.equal(keys.get("lastfmScrobble"), "toggle");
  assert.equal(keys.get("glassTint"), "range");
  assert.equal(keys.get("sotdPostAt"), "time");
});

test("every toggle and choice spec is sent or listed as not sent", () => {
  const sent = new Set(REPORTED);
  const missing = [...specKeys()]
    .filter(([k, kind]) => (kind === "toggle" || kind === "choice") && !sent.has(k) && !(k in NOT_REPORTED))
    .map(([k]) => k);
  assert.deepEqual(missing, [], "add each to REPORTED or NOT_REPORTED in src/usage-keys.ts");
});

test("only toggles and choices are sent, never a slider, a time or a size", () => {
  const keys = specKeys();
  const wrong = REPORTED.filter((k) => !["toggle", "choice"].includes(keys.get(k) ?? "none"));
  assert.deepEqual(wrong, [], "not a toggle or choice spec (or no spec at all)");
});

test("no key is on both lists, and none twice", () => {
  assert.deepEqual(REPORTED.filter((k) => k in NOT_REPORTED), []);
  assert.equal(new Set(REPORTED).size, REPORTED.length);
});

test("the room guest controls match agent-settings.ts", () => {
  const m = /\.\.\.\((\[[^\]]+\]) as const\)\.map\(\(which\)/.exec(specs);
  assert.ok(m, "the roomGuests spec list moved");
  assert.deepEqual(JSON.parse(m[1]), [...ROOM_GUEST_CONTROLS]);
});

test("the worker's copy matches the list", { skip: !existsSync(new URL("../../DeetsSupport/src/usage-keys.js", import.meta.url)) && "no DeetsSupport checkout" }, () => {
  const have = readFileSync(new URL("../../DeetsSupport/src/usage-keys.js", import.meta.url), "utf8");
  const keys = [...have.matchAll(/^ {2}"([^"]+)",$/gm)].map((m) => m[1]);
  assert.deepEqual(keys, [...REPORTED].sort(), "run npm run usage:keys");
});

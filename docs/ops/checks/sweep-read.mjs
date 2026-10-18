// The readability result of one sweep, for one card (QUALITY-SWEEP.md §3a). The full check
// (readability.mjs) reports the whole screen; a sweep needs its own card's failures, and the
// shared ones (a theme role that fails on every card) in one line each, so they go to the
// readability item that is already open instead of to the feature.
//
//   node docs/ops/checks/sweep-read.mjs <shots out dir> <card area>
//   node docs/ops/checks/sweep-read.mjs shots/rewind-sweep/0.29.0 rewind
//
// <card area> is the reading's `where` (the card's name in readability.jsonl). A failure is
// "shared" when its theme role also fails on another card in the same look.
import { readingsOf } from "../../../scripts/readability.mjs";

const [dir, area] = process.argv.slice(2);
if (!dir || !area) {
  console.error("usage: node docs/ops/checks/sweep-read.mjs <shots out dir> <card area>");
  process.exit(1);
}
const readings = readingsOf(dir);
// The roles that fail elsewhere, per look: a failure in one of them is not the card's own.
const elsewhere = new Set();
for (const r of readings) for (const x of r.rows) if (!x.pass && x.where !== area) elsewhere.add(`${r.look}|${x.role}`);

let boxes = 0;
const own = new Map();
const shared = new Map();
const looks = new Set();
for (const r of readings) {
  for (const x of r.rows) {
    if (x.where !== area) continue;
    boxes++;
    if (x.pass) continue;
    looks.add(r.look);
    const part = `${x.sig.split(" > ").at(-1)} (${x.role}, bar ${x.bar})`;
    const into = elsewhere.has(`${r.look}|${x.role}`) ? shared : own;
    const g = into.get(part) ?? { n: 0, min: Infinity, looks: new Set(), eg: [] };
    g.n++;
    g.min = Math.min(g.min, x.ratio);
    g.looks.add(r.look);
    if (g.eg.length < 2) g.eg.push(`${r.look} ${r.label} ${x.ratio.toFixed(2)} "${x.text.slice(0, 24)}"`);
    into.set(part, g);
  }
}
const lookCount = new Set(readings.map((r) => r.look)).size;
const failing = [...own.values(), ...shared.values()].reduce((s, g) => s + g.n, 0);
console.log(`${area}: ${boxes} text boxes read, ${failing} under the bar, in ${looks.size} of ${lookCount} looks`);
const print = (title, m) => {
  console.log(`\n${title}${m.size ? "" : ": none"}`);
  for (const [part, g] of m) {
    console.log(`  ${part} ×${g.n}, lowest ${g.min.toFixed(2)}`);
    console.log(`    looks: ${[...g.looks].join(", ")}`);
    console.log(`    e.g. ${g.eg.join(" | ")}`);
  }
};
print("The card's own (a fault of this sweep)", own);
print("Shared (the role fails on other cards in the same look: the open readability item)", shared);

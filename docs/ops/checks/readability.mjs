// `node docs/ops/checks/readability.mjs` — the readability check (README.md › readability).
//
// Pass 1: every theme × skin, the shots in readability.json (every card, the Settings card page
// by page, the Compass, the quick panel, the toasts, a hover hint).
// Pass 2: the six Glass looks again with Fancy Glass on, at its slider defaults and at both ends
// of each slider (his call, 2026-10-14, fork 2A: any setting a user can reach must read).
// Then the report: <out>/readability.html and <out>/readability-summary.json.
//
//   --report-only   build the report from the last run's readability.jsonl
//   --look a,b      pass 1 on these looks only (pass 2 on their Glass ones)
//   --no-glass      skip pass 2
//   --tag <name>    write to shots/readability/<version>-<name>, so the last run stays to compare
//
// It takes about 80 s a look: ~40 min for pass 1, ~65 min for pass 2. Run it in the background.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readingsOf, BAR } from "../../../scripts/readability.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const oneArg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tag = oneArg("--tag");
const outDir = join(root, "shots", "readability", tag ? `${version}-${tag}` : version);
const list = join(root, "docs", "ops", "checks", "readability.json");

const SLIDERS = ["glassTint", "glassBacklight", "glassCanvasGlow", "glassCanvasDim"];
const GLASS_VS = SLIDERS.flatMap((k) => [`${k}=0`, `${k}=100`]);

function shots(args) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "shots.mjs"), "--list", list, "--out", outDir, "--noise", "95", ...args], { stdio: "inherit" });
  if (r.status !== 0) console.log(`[readability] the shots runner ended with ${r.status}; the report covers what was read`);
}

if (!argv.includes("--report-only")) {
  rmSync(join(outDir, "readability.jsonl"), { force: true });
  const looks = oneArg("--look");
  shots(looks ? ["--look", looks] : []);
  if (!argv.includes("--no-glass")) {
    const themes = (readFileSync(join(root, "src", "look-ids.ts"), "utf8").match(/export type ThemeName = ([^;]+);/)?.[1].match(/"([a-z-]+)"/g) ?? []).map((s) => s.slice(1, -1));
    const glass = themes.map((t) => `${t}-glass`).filter((l) => !looks || looks.split(",").includes(l));
    if (glass.length) shots(["--look", glass.join(","), "--set", "glassFancy=true", ...GLASS_VS.flatMap((v) => ["--vs", v])]);
  }
}

// ── the report ───────────────────────────────────────────────────────────────

if (!existsSync(join(outDir, "readability.jsonl"))) throw new Error(`[readability] no readings in ${outDir}`);
const readings = readingsOf(outDir);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const runOf = (r) => (r.change ? `Fancy Glass, ${r.change}` : r.look.endsWith("-glass") ? "defaults" : "");

/** One failure group: the same kind of text (card, element, role) in one look and run. The
 *  Settings pages and the NP/Queue cards repeat in every shot, so a group counts each place once. */
const groups = new Map();
const looks = new Map();
for (const r of readings) {
  const lk = `${r.look}${r.change ? ` · ${r.change}` : ""}`;
  const L = looks.get(lk) ?? { look: r.look, run: runOf(r), boxes: 0, fails: 0, worst: Infinity, roles: {} };
  looks.set(lk, L);
  for (const x of r.rows) {
    L.boxes++;
    const role = x.role || "other";
    const R = (L.roles[role] ??= { worst: Infinity, n: 0, fails: 0 });
    R.n++;
    R.worst = Math.min(R.worst, x.ratio);
    if (x.pass) continue;
    L.fails++;
    R.fails++;
    L.worst = Math.min(L.worst, x.ratio);
    const k = `${lk}|${x.where}|${x.sig}|${role}`;
    const g = groups.get(k) ?? { look: r.look, run: runOf(r), where: x.where, sig: x.sig, role, size: x.size, large: x.large, worst: Infinity, median: 0, lc: 0, texts: new Set(), places: new Set(), picture: r.picture };
    groups.set(k, g);
    g.places.add(`${Math.round(x.x)},${Math.round(x.y)},${x.text}`);
    if (g.texts.size < 4) g.texts.add(x.text);
    if (x.ratio < g.worst) Object.assign(g, { worst: x.ratio, median: x.median, lc: x.lc, picture: r.picture, rgb: x.rgb, alpha: x.alpha });
  }
}

const list2 = [...groups.values()].map((g) => ({ ...g, texts: [...g.texts], count: g.places.size, places: undefined }));
/** Across looks: the same element and role, so one fix is one row. */
const byElement = new Map();
for (const g of list2) {
  const k = `${g.where}|${g.sig}|${g.role}`;
  const e = byElement.get(k) ?? { where: g.where, sig: g.sig, role: g.role, looks: new Set(), worst: Infinity, worstLook: "", texts: g.texts, count: 0 };
  byElement.set(k, e);
  e.looks.add(g.run ? `${g.look} (${g.run})` : g.look);
  e.count += g.count;
  if (g.worst < e.worst) Object.assign(e, { worst: g.worst, worstLook: g.run ? `${g.look} (${g.run})` : g.look });
}
const elements = [...byElement.values()].map((e) => ({ ...e, looks: [...e.looks] })).sort((a, b) => b.looks.length - a.looks.length || a.worst - b.worst);
const lookRows = [...looks.values()].sort((a, b) => a.look.localeCompare(b.look) || a.run.localeCompare(b.run));

writeFileSync(join(outDir, "readability-summary.json"), JSON.stringify({ version, bar: BAR, looks: lookRows, elements, groups: list2 }, null, 1));

const n = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const cls = (v) => (v < 3 ? "bad" : v < 4.5 ? "warn" : "ok");
const ROLES = ["--title", "--text", "--subtext"];
const html = `<!doctype html><meta charset="utf-8"><title>Readability ${esc(version)}</title>
<style>
body{font:13px/1.45 system-ui,sans-serif;margin:24px;background:#fff;color:#111}
h1{font-size:20px}h2{font-size:16px;margin-top:32px}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:3px 7px;text-align:left;vertical-align:top}
th{background:#f2f2f2}.bad{background:#ffd6dc}.warn{background:#ffefc2}.ok{background:#dcf5dc}
code{font-size:12px}img{max-width:560px;border:1px solid #ccc}
</style>
<h1>Readability check · DeetsMusic ${esc(version)}</h1>
<p>Each text box is scored against the real pixels behind it (WCAG 2 contrast at the worst tenth of its backdrop). The bar: ${BAR.body}:1, or ${BAR.large}:1 for large text. Red: under 3:1. Amber: 3 to 4.5:1. A disabled control never fails.</p>
<h2>1. Each look: the worst score of each text role</h2>
<table><tr><th>Look</th><th>Glass run</th><th>Boxes</th><th>Under the bar</th>${ROLES.map((r) => `<th>${r}</th>`).join("")}<th>Worst of all</th></tr>
${lookRows.map((L) => `<tr><td>${esc(L.look)}</td><td>${esc(L.run)}</td><td>${L.boxes}</td><td>${L.fails} (${Math.round((100 * L.fails) / Math.max(1, L.boxes))}%)</td>${ROLES.map((r) => `<td class="${cls(L.roles[r]?.worst ?? 99)}">${n(L.roles[r]?.worst)}</td>`).join("")}<td class="${cls(L.worst)}">${n(L.worst)}</td></tr>`).join("\n")}
</table>
<h2>2. Each element that fails, across looks (one fix = one row)</h2>
<table><tr><th>Card / place</th><th>Element</th><th>Role</th><th>Looks</th><th>Worst</th><th>Worst in</th><th>Example</th></tr>
${elements.map((e) => `<tr><td>${esc(e.where)}</td><td><code>${esc(e.sig)}</code></td><td>${esc(e.role)}</td><td>${e.looks.length}</td><td class="${cls(e.worst)}">${n(e.worst)}</td><td>${esc(e.worstLook)}</td><td>${esc(e.texts.join(" · "))}</td></tr>`).join("\n")}
</table>
<h2>3. Each look's failures, with the marked picture</h2>
${lookRows.filter((L) => L.fails).map((L) => {
  const gs = list2.filter((g) => g.look === L.look && g.run === L.run).sort((a, b) => a.worst - b.worst);
  return `<h3>${esc(L.look)}${L.run ? ` · ${esc(L.run)}` : ""}</h3><table><tr><th>Card</th><th>Element</th><th>Role</th><th>Places</th><th>Worst</th><th>Median</th><th>APCA Lc</th><th>Example</th><th>Picture</th></tr>
${gs.map((g) => `<tr><td>${esc(g.where)}</td><td><code>${esc(g.sig)}</code></td><td>${esc(g.role)}</td><td>${g.count}</td><td class="${cls(g.worst)}">${n(g.worst)}</td><td>${n(g.median)}</td><td>${Math.round(g.lc)}</td><td>${esc(g.texts.join(" · "))}</td><td>${g.picture ? `<a href="${esc(g.picture)}">open</a>` : ""}</td></tr>`).join("\n")}</table>`;
}).join("\n")}
`;
writeFileSync(join(outDir, "readability.html"), html);
console.log(`[readability] ${readings.length} readings, ${list2.length} failure groups, ${elements.length} elements → ${join(outDir, "readability.html")}`);

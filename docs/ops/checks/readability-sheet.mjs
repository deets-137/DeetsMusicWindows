// `node docs/ops/checks/readability-sheet.mjs <after dir> [<before dir>]` — the review sheet of a
// readability run (README.md § 2b): one grid of theme × skin per view (each Max shot, each Settings
// page, the Compass, the quick panel, the toasts, the hint), from the clean picture of each
// reading. With a before dir, each cell shows the two pictures side by side, or one at a time.
// Writes <after dir>/sheet.html. Click a picture to open it at full size.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const [afterArg, beforeArg] = process.argv.slice(2);
if (!afterArg) throw new Error("usage: readability-sheet.mjs <after dir> [<before dir>]");
const after = resolve(afterArg);
const before = beforeArg ? resolve(beforeArg) : undefined;
const root = resolve(after, "..", "..", "..");

const unionOf = (type) => [...(readFileSync(join(root, "src", "look-ids.ts"), "utf8").match(new RegExp(`export type ${type} = ([^;]+);`))?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
const THEMES = unionOf("ThemeName");
const SKINS = unionOf("SkinName");

/** `<shot>.<theme>-<skin>.<label>.clean.png` → view `<shot> · <label>`. A Glass slider run has a
 *  variant letter after the look; the sheet shows the plain runs only. */
const views = new Map();
const lookRe = new RegExp(`^(read-[a-z-]+)\\.(${THEMES.join("|")})-(${SKINS.join("|")})\\.([a-z0-9-]+)\\.clean\\.png$`);
for (const f of readdirSync(after)) {
  const m = lookRe.exec(f);
  if (!m) continue;
  const [, shot, theme, skin, label] = m;
  const key = `${shot.replace(/^read-/, "")} · ${label}`;
  const v = views.get(key) ?? { key, cells: {} };
  views.set(key, v);
  v.cells[`${theme}-${skin}`] = f;
}
const order = (k) => {
  const [shot, label] = k.split(" · ");
  const n = Number(label.match(/-(\d+)$/)?.[1] ?? 0);
  return [["max-a", "max-b", "max-c", "settings", "compass", "quick", "toasts", "hint"].indexOf(shot), n];
};
const list = [...views.values()].sort((a, b) => {
  const [x1, y1] = order(a.key);
  const [x2, y2] = order(b.key);
  return x1 - x2 || y1 - y2;
});

/** The run's per-look scores (readability-summary.json), so each cell shows its worst subtext / text. */
const score = (dir) => {
  const f = join(dir, "readability-summary.json");
  if (!existsSync(f)) return {};
  const s = JSON.parse(readFileSync(f, "utf8"));
  return Object.fromEntries(s.looks.filter((l) => !l.run || l.run === "defaults").map((l) => [l.look, l]));
};
const scoresAfter = score(after);
const scoresBefore = before ? score(before) : {};
const relBefore = before ? relative(after, before).split("\\").join("/") : "";

const data = {
  themes: THEMES,
  skins: SKINS,
  views: list.map((v) => ({ key: v.key, cells: v.cells })),
  before: relBefore,
  scores: Object.fromEntries(Object.entries(scoresAfter).map(([k, l]) => [k, { a: l.roles, b: scoresBefore[k]?.roles }])),
};

const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Readability review</title>
<style>
:root{--bg:#f6f6f4;--fg:#1d1d1b;--mut:#6b6b66;--line:#d8d8d2;--bad:#c4213a;--warn:#a86a00;--ok:#2b7a3a}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ececea;--mut:#a3a39e;--line:#33332f;--bad:#ff6b80;--warn:#f0b54a;--ok:#71cf82}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px/1.45 system-ui,sans-serif}
header{position:sticky;top:0;background:var(--bg);padding:8px 0 12px;z-index:2;display:flex;flex-wrap:wrap;gap:12px;align-items:center;border-bottom:1px solid var(--line)}
h1{font-size:17px;margin:0 12px 0 0}
select,button{font:inherit;padding:4px 8px}
button[aria-pressed=true]{font-weight:600;outline:2px solid currentColor}
table{border-collapse:collapse;margin-top:12px}
th{font-weight:600;text-align:left;padding:4px 6px;color:var(--mut)}
td{vertical-align:top;padding:6px;border-top:1px solid var(--line)}
.pair{display:flex;gap:4px}
.pair figure{margin:0}
figcaption{font-size:11px;color:var(--mut)}
img{display:block;width:var(--w,260px);height:auto;border:1px solid var(--line);cursor:zoom-in}
.n{font-size:11px;margin-top:3px}.bad{color:var(--bad)}.warn{color:var(--warn)}.ok{color:var(--ok)}
.hide{display:none}
</style>
<header>
<h1>Readability review</h1>
<label>View <select id="view"></select></label>
<span id="modes"><button data-mode="both" aria-pressed="true">Before | after</button> <button data-mode="after">After</button> <button data-mode="before">Before</button></span>
<label>Size <input id="size" type="range" min="160" max="640" step="20" value="260"></label>
<span style="color:var(--mut)">Scores: the worst --text / --subtext of the whole look (all shots), WCAG ratio, bar 4.5.</span>
</header>
<table id="grid"></table>
<script>
const D = ${JSON.stringify(data)};
const view = document.getElementById("view"), grid = document.getElementById("grid");
let mode = D.before ? "both" : "after";
if (!D.before) document.getElementById("modes").classList.add("hide");
for (const v of D.views) view.add(new Option(v.key, v.key));
try { const s = localStorage.getItem("rr.view"); if (s && D.views.some((v) => v.key === s)) view.value = s; } catch {}
const cls = (v) => (v == null ? "" : v < 3 ? "bad" : v < 4.5 ? "warn" : "ok");
const fmt = (r) => (r && Number.isFinite(r.worst) ? r.worst.toFixed(1) : "–");
function draw() {
  const v = D.views.find((x) => x.key === view.value) || D.views[0];
  let h = "<tr><th></th>" + D.skins.map((s) => "<th>" + s + "</th>").join("") + "</tr>";
  for (const t of D.themes) {
    h += "<tr><th>" + t + "</th>";
    for (const s of D.skins) {
      const f = v.cells[t + "-" + s];
      const sc = D.scores[t + "-" + s] || {};
      const pic = (src, cap) => '<figure><a href="' + src + '" target="_blank"><img loading="lazy" src="' + src + '" alt="' + t + " " + s + " " + cap + '"></a><figcaption>' + cap + "</figcaption></figure>";
      let cell = "";
      if (f) {
        const parts = [];
        if (D.before && mode !== "after") parts.push(pic(D.before + "/" + f, "before"));
        if (mode !== "before") parts.push(pic(f, "after"));
        cell = '<div class="pair">' + parts.join("") + "</div>";
        const a = sc.a || {}, b = sc.b || {};
        const role = (k, label) => '<span class="' + cls(a[k]?.worst) + '">' + label + " " + (b[k] ? fmt(b[k]) + " → " : "") + fmt(a[k]) + "</span>";
        cell += '<div class="n">' + role("--text", "text") + " · " + role("--subtext", "subtext") + "</div>";
      } else cell = '<span style="color:var(--mut)">no picture</span>';
      h += "<td>" + cell + "</td>";
    }
    h += "</tr>";
  }
  grid.innerHTML = h;
}
view.onchange = () => { try { localStorage.setItem("rr.view", view.value); } catch {} draw(); };
document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => {
  mode = b.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  draw();
}));
document.getElementById("size").oninput = (e) => document.documentElement.style.setProperty("--w", e.target.value + "px");
draw();
</script>`;
writeFileSync(join(after, "sheet.html"), html);
console.log(`[readability] review sheet: ${list.length} views → ${join(after, "sheet.html")}`);

// `npm run docs:check` — the docs checker (docs/DOCS-ORG.md §8). Deterministic, fast, no model.
//
// Checks built (step 2, 2026-09-21) — all FACTS; a fact fails:
//   1. every link resolves            [x](path) in docs/, CLAUDE.md, README.md, AGENTS.md
//   2. every mention names a real file  "TOASTS.md" in prose or `code`, by basename
//   3. every section pointer resolves   "TOASTS.md §4a" → a heading numbered 4a in TOASTS.md
//   4. front matter present and valid   the fields and values of DOCS-ORG.md §5
//   5. versions agree                   the six version files; every shipped_in is a real,
//                                       published release no newer than the current version
//  11. nothing in ideas/ is above `idea`
// Checks 6-10 (the suspicions) wait for the first report (§11 step 2).
//
//   node scripts/docs-check.mjs          report; exit 1 on any fact
//   node scripts/docs-check.mjs --warn   report; always exit 0
// The release check imports `check()` and only warns until GRACE_END (F5: warn for a week).
//
// Skipped on purpose: fenced code blocks (examples, not claims); files whose name starts with
// "_" (templates). A mention is NOT a fault when:
//  - its path, its paragraph or its section heading names another repo ("DeetsSolutions
//    `docs/support.md`", "the DeetsRadio worker (radio.md …)") — that file lives there;
//  - it sits inside a URL;
//  - it is a retired name kept as a record (VALUES.md → LESSONS.md, LESSONS.md §0);
//  - the file exists but git ignores it (TASTE.md, private);
//  - the doc is a plan (status project, designed or idea): a plan names files not made yet.
// A link to a code line ("../src/room.ts:344") resolves to the file.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GRACE_END = "2026-09-28"; // F5: the release check fails on facts from this date

const STATUS = ["shipped", "built", "designed", "project", "parked", "idea", "foundation", "sop", "guide"];
const KEYS = ["status", "shipped_in", "desk_test", "sources", "updated", "generated"];
// Until release tags exist (DOCS-ORG §14, T2), the withdrawn versions are named here.
const WITHDRAWN = ["0.12.0", "0.12.1"];
// A path that starts with one of these points into another repo, and is not ours to check.
const OTHER_REPO = /^(\.\.\/(?!src|docs|scripts|extension|cli|crates|README|CLAUDE|AGENTS)|Deets[A-Za-z]+\/|DeetsSolutions)/;
// Another repo named in prose: any Deets* name but this app's own, or the website.
const NAMES_REPO = /\bDeets(?!Music\b)[A-Z][A-Za-z]+|\bdeets\.solutions\b|\bdeets-137\//;
const RETIRED = { "VALUES.md": "LESSONS.md" };
const PLANS = ["project", "designed", "idea"];

const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
// Private docs: a docs/*.md line in .gitignore. The file may not exist in this checkout.
const PRIVATE = new Set([...read(".gitignore").matchAll(/^docs\/([\w-]+\.md)\s*$/gm)].map((m) => m[1]));
const tracked = () => execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

/** Text with fenced code blocks blanked (line count kept, so line numbers stay true). */
const unfence = (t) => t.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ""));
const lineOf = (t, i) => t.slice(0, i).split("\n").length;

function frontMatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const fm = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

/** The numbers headings carry: "## 5.1 Part markers" → "5.1"; "### §4a. …" → "4a". */
function headingNumbers(text) {
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+§?\s?([0-9]+[a-z]?(?:\.[0-9]+[a-z]?)*)\.?[\s)—:-]/gm)) out.add(m[1]);
  return out;
}

export function check() {
  const files = tracked();
  const docs = files.filter((f) => /^docs\/.*\.md$/.test(f) && !basename(f).startsWith("_") && !f.startsWith("docs/guide/"));
  const roots = ["CLAUDE.md", "README.md", "AGENTS.md"].filter((f) => existsSync(join(ROOT, f)));
  const byName = new Map();
  for (const f of files.filter((f) => f.endsWith(".md"))) {
    if (!byName.has(basename(f))) byName.set(basename(f), []);
    byName.get(basename(f)).push(f);
  }
  const facts = [];
  const fail = (n, file, line, msg) => facts.push({ n, at: `${file}${line ? `:${line}` : ""}`, msg });
  const texts = new Map([...docs, ...roots].map((f) => [f, read(f)]));

  for (const [file, raw] of texts) {
    const text = unfence(raw);

    // 1. Links.
    for (const m of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      let target = m[1];
      if (/^([a-z]+:|#|\/\/)/i.test(target) || target.startsWith("<")) continue;
      target = decodeURI(target.replace(/[#?].*$/, "")).replace(/(\.\w+):\d+(?::\d+)?$/, "$1");
      if (!target) continue;
      const at = posix.normalize(posix.join(posix.dirname(file), target));
      if (!existsSync(join(ROOT, at))) fail(1, file, lineOf(text, m.index), `link to ${m[1]} — no such file (${at})`);
    }

    // 2. Mentions, and 3. section pointers.
    const plan = PLANS.includes(frontMatter(raw)?.status);
    for (const m of text.matchAll(/((?:\.\.\/|[\w.-]+\/)*)\b([A-Za-z][\w-]*\.md)\b(\s+§\s?([0-9]+[a-z]?(?:\.[0-9]+[a-z]?)*))?/g)) {
      const [, path, name, , sec] = m;
      if (OTHER_REPO.test(path)) continue;
      const before = text.slice(0, m.index);
      if (/https?:\/\/\S*$/.test(before)) continue;
      const line = lineOf(text, m.index);
      const hits = byName.get(name);
      if (!hits) {
        const para = before.slice(before.lastIndexOf("\n\n") + 1) + text.slice(m.index, text.indexOf("\n\n", m.index) >>> 0);
        const heading = [...before.matchAll(/^#{1,6} .*$/gm)].pop()?.[0] ?? "";
        const elsewhere = NAMES_REPO.test(para) || NAMES_REPO.test(heading);
        if (!elsewhere && !plan && !RETIRED[name] && !PRIVATE.has(name)) fail(2, file, line, `mentions ${path}${name} — no such file in the repo`);
        continue;
      }
      if (!sec) continue;
      const target = hits.find((h) => h.startsWith("docs/")) ?? hits[0];
      const nums = headingNumbers(read(target));
      const ok = nums.has(sec) || [...nums].some((n) => n.startsWith(sec + "."));
      if (!ok) fail(3, file, line, `${name} §${sec} — no heading numbered ${sec} in ${target}`);
    }
  }

  // 4. Front matter, and 11. ideas/.
  for (const file of docs) {
    const fm = frontMatter(texts.get(file));
    if (!fm) { fail(4, file, 1, "no front matter"); continue; }
    for (const k of Object.keys(fm)) if (!KEYS.includes(k)) fail(4, file, 1, `unknown key "${k}"`);
    if (!STATUS.includes(fm.status)) fail(4, file, 1, `status "${fm.status ?? ""}" is not one of ${STATUS.join(" ")}`);
    if (fm.status === "shipped" && !fm.shipped_in) fail(4, file, 1, "status shipped needs shipped_in");
    if (fm.shipped_in && fm.status !== "shipped") fail(4, file, 1, `shipped_in with status ${fm.status}`);
    if (!/^(none|open|passed \d{4}-\d{2}-\d{2})$/.test(fm.desk_test ?? "")) fail(4, file, 1, `desk_test "${fm.desk_test ?? ""}" — none, open or passed <date>`);
    if (!fm.generated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated ?? "")) fail(4, file, 1, `updated "${fm.updated ?? ""}" is not a date`);
    const src = /^\[(.*)\]$/.exec(fm.sources ?? "");
    if (!src) fail(4, file, 1, "sources is not a [list]");
    else for (const s of src[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!existsSync(join(ROOT, s))) fail(4, file, 1, `source ${s} does not exist`);
    }
    if (file.startsWith("docs/ideas/") && fm.status !== "idea") fail(11, file, 1, `in ideas/ with status ${fm.status} — move it out of ideas/`);
  }

  // 5. Versions.
  const lock = (p, name) => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(read(p))?.[1];
  const versions = {
    "package.json": JSON.parse(read("package.json")).version,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
    "src-tauri/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1],
    "cli/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(read("cli/Cargo.toml"))?.[1],
    "src-tauri/Cargo.lock": lock("src-tauri/Cargo.lock", "deetsmusic"),
    "cli/Cargo.lock": lock("cli/Cargo.lock", "deetsmusic-cli"),
    "extension/manifest.json": JSON.parse(read("extension/manifest.json")).version,
  };
  const current = versions["package.json"];
  for (const [f, v] of Object.entries(versions)) if (v !== current) fail(5, f, 0, `version ${v ?? "(none)"} — package.json says ${current}`);
  const released = new Set([...read("docs/RELEASE-NOTES.md").matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]));
  const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  for (const file of docs) {
    const v = frontMatter(texts.get(file))?.shipped_in;
    if (!v) continue;
    if (!released.has(v)) fail(5, file, 1, `shipped_in ${v} has no entry in RELEASE-NOTES.md`);
    else if (WITHDRAWN.includes(v)) fail(5, file, 1, `shipped_in ${v} was withdrawn — use the release that replaced it`);
    else if (cmp(v, current) > 0) fail(5, file, 1, `shipped_in ${v} is newer than the current version ${current}`);
  }

  return { facts, docs: docs.length };
}

export function report({ facts, docs }) {
  const lines = [];
  const names = { 1: "links", 2: "mentions", 3: "section pointers", 4: "front matter", 5: "versions", 11: "ideas/" };
  for (const n of Object.keys(names).map(Number)) {
    const mine = facts.filter((f) => f.n === n);
    lines.push(`check ${n} — ${names[n]}: ${mine.length ? `${mine.length} FAIL` : "ok"}`);
    for (const f of mine) lines.push(`    ${f.at}  ${f.msg}`);
  }
  lines.push(`[docs-check] ${docs} docs · ${facts.length} fact${facts.length === 1 ? "" : "s"} failing`);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = check();
  console.log(report(r));
  if (r.facts.length && !process.argv.includes("--warn")) process.exit(1);
}

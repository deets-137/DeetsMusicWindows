// Front matter for every doc (DOCS-ORG.md §5, §11 step 1).
//
//   node scripts/docs-frontmatter.mjs              propose: write docs-frontmatter.json + print a table
//   node scripts/docs-frontmatter.mjs --write F    put the (reviewed) proposal F into the docs
//
// The proposal is a guess to be read by the owner, never written blind:
//  - status / desk_test come from the doc's own header words; the `ideas/` folder is `idea`.
//  - sources are the code paths the doc names most, that exist on disk.
//  - shipped_in is the first PUBLISHED version that holds the commit adding the doc's newest
//    source (a withdrawn version does not count), unless the doc names "shipped in X" itself.
//  - a git-ignored doc (TASTE.md) is private and gets none.
//  - updated is the date of the doc's last commit.
// --write only adds a block to a doc that has none; it never edits one that is there.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = join(ROOT, "docs");
const WITHDRAWN = new Set(["0.12.0", "0.12.1"]);
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }).trim();

// Every doc under docs/ in any folder, relative to docs/ (the guide and templates excluded).
function docList() {
  return git("ls-files", "-co", "--exclude-standard", "docs")
    .split("\n")
    .filter((f) => f.endsWith(".md") && !f.startsWith("docs/guide/") && !f.split("/").pop().startsWith("_"))
    .map((f) => f.slice("docs/".length));
}

// Every commit that changed package.json's version, oldest first: [{ version, commit }].
function releases() {
  const commits = git("log", "--reverse", "--format=%H", "-G", '"version"', "--", "package.json").split("\n");
  const out = [];
  for (const c of commits.filter(Boolean)) {
    const v = JSON.parse(git("show", `${c}:package.json`)).version;
    if (!out.some((r) => r.version === v)) out.push({ version: v, commit: c });
  }
  // 0.4.3 is the first public release (RELEASE.md §6); nothing shipped before it.
  const first = out.findIndex((r) => r.version === "0.4.3");
  return out.slice(Math.max(0, first)).filter((r) => !WITHDRAWN.has(r.version));
}

const PATH = /\b((?:src-tauri\/src|src|scripts|crates|extension|cli\/src)\/[\w./-]+\.(?:ts|rs|mjs|js|css|html|json|toml))\b/g;

function sourcesOf(text) {
  const n = new Map();
  for (const m of text.matchAll(PATH)) {
    const p = m[1];
    if (existsSync(join(ROOT, p))) n.set(p, (n.get(p) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p);
}

function statusOf(doc, head) {
  if (doc.startsWith("ideas/")) return "idea";
  const h = head.toLowerCase();
  if (/\bparked\b/.test(h)) return "parked";
  if (/\b(built|as built|shipped)\b/.test(h.replace(/not built|nothing built|before any .* is built/g, ""))) return "built";
  if (/not built|paper design|nothing built|designed/.test(h)) return "designed";
  return "?";
}

// The latest desk-test verdict the doc names: "passed <date>", "open", or "none".
function deskOf(text) {
  let best = null;
  for (const m of text.matchAll(/desk[- ]test[^\n]{0,80}?\b(passed|not run|pending|awaiting|open)\b[^0-9\n]{0,24}(\d{4}-\d{2}-\d{2})?/gi)) {
    const v = m[1].toLowerCase() === "passed" ? `passed ${m[2] ?? ""}`.trim() : "open";
    const at = m[2] ?? "";
    if (!best || at >= best.at) best = { v, at };
  }
  return best?.v ?? "none";
}

// The first published release that contains the commit adding the doc's NEWEST source file —
// the file most likely made for this feature, not a shared one it also touches.
function firstRelease(sources, rels) {
  let add = null, addDate = "";
  for (const s of sources) {
    const line = git("log", "--diff-filter=A", "--format=%H %aI", "--", s).split("\n").filter(Boolean).pop();
    if (!line) continue;
    const [h, d] = line.split(" ");
    if (d > addDate) { add = h; addDate = d; }
  }
  if (!add) return undefined;
  for (const r of rels) {
    try { git("merge-base", "--is-ancestor", add, r.commit); return r.version; } catch { /* not in it */ }
  }
  return undefined;
}

function propose() {
  const rels = releases();
  const rows = [];
  for (const doc of docList()) {
    try { git("check-ignore", "-q", join("docs", doc)); continue; } catch { /* tracked: go on */ }
    const text = readFileSync(join(DOCS, doc), "utf8");
    if (text.startsWith("---\n") || text.startsWith("---\r\n")) { rows.push({ doc, has: true }); continue; }
    const head = text.split("\n").slice(0, 30).join("\n");
    const sources = sourcesOf(text);
    let status = statusOf(doc, head);
    const named = head.match(/shipped in (\d+\.\d+\.\d+)/i)?.[1];
    let shipped_in = named;
    if (!shipped_in && status === "built" && sources.length) {
      shipped_in = firstRelease(sources, rels);
    }
    if (shipped_in && status === "built") status = "shipped";
    rows.push({
      doc, status, shipped_in: shipped_in ?? null, desk_test: deskOf(text),
      sources, updated: git("log", "-1", "--format=%as", "--", join("docs", doc)) || null,
    });
  }
  const out = join(ROOT, "docs-frontmatter.json");
  writeFileSync(out, JSON.stringify(rows, null, 2) + "\n");
  console.log("| doc | status | shipped_in | desk_test | updated | sources |\n|---|---|---|---|---|---|");
  for (const r of rows) {
    if (r.has) { console.log(`| ${r.doc} | (has front matter) | | | | |`); continue; }
    console.log(`| ${r.doc} | ${r.status} | ${r.shipped_in ?? ""} | ${r.desk_test} | ${r.updated ?? ""} | ${r.sources.length} |`);
  }
  console.log(`\n${rows.length} docs → ${out}`);
}

function write(file) {
  const rows = JSON.parse(readFileSync(file, "utf8"));
  let n = 0;
  for (const r of rows) {
    if (r.has) continue;
    const path = join(DOCS, r.doc);
    const text = readFileSync(path, "utf8");
    if (text.startsWith("---")) continue;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = ["---", `status: ${r.status}`];
    if (r.shipped_in) lines.push(`shipped_in: ${r.shipped_in}`);
    lines.push(`desk_test: ${r.desk_test}`);
    lines.push(`sources: [${r.sources.join(", ")}]`);
    lines.push(`updated: ${r.updated}`, "---", "");
    writeFileSync(path, lines.join(eol) + text);
    n++;
  }
  console.log(`front matter added to ${n} docs`);
}

const i = process.argv.indexOf("--write");
if (i > 0) write(process.argv[i + 1]);
else propose();

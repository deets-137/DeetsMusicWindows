// Move docs and keep every reference true (DOCS-ORG.md §4, §11 step 3).
//
//   node scripts/docs-move.mjs NAME=area [NAME=area …] [--dry]
//     e.g.  node scripts/docs-move.mjs TOASTS=architecture MatterLights=features
//   NAME is a doc's file name without .md, found anywhere under docs/; area is a folder under
//   docs/ ("." = docs/ itself). Nothing else in the tree needs a hand edit afterwards:
//
//   1. every relative markdown link in every tracked .md file, into or out of a moved doc, is
//      re-pointed (anchors and ":line" suffixes kept); links inside fenced code are left alone;
//   2. every path mention "docs/…/NAME.md" in every tracked text file (code comments,
//      scripts, CLAUDE.md, a URL in settings.rs) gets the new path. A path that belongs to
//      another repo ("DeetsSolutions/docs/…") is not touched;
//   3. the files move with `git mv`, so `git log --follow` keeps their history.
// Run `npm run docs:check` after: it proves every link resolves.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" });
const dry = process.argv.includes("--dry");
const TEXT = /\.(md|mjs|cjs|js|ts|rs|toml|json|html|css|ps1|txt|yml|yaml)$|^\.gitignore$/;

const files = git("ls-files").split("\n").filter(Boolean);
const moves = new Map(); // old path → new path
for (const arg of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const [name, area] = arg.split("=");
  const hits = files.filter((f) => f.startsWith("docs/") && posix.basename(f) === `${name}.md`);
  if (hits.length !== 1) throw new Error(`${name}.md: ${hits.length} matches under docs/`);
  const to = posix.normalize(posix.join("docs", area, `${name}.md`));
  if (to === hits[0]) continue;
  if (existsSync(join(ROOT, to))) throw new Error(`${to} exists already`);
  moves.set(hits[0], to);
}
if (!moves.size) { console.log("nothing to move"); process.exit(0); }
const byPath = new Map([...moves].map(([from, to]) => [from, to]));

function relinkMarkdown(file, text) {
  const newFile = moves.get(file) ?? file;
  let n = 0;
  const parts = text.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[^\n]*$)/m);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(\[[^\]\n]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (all, open, target, close) => {
      if (/^([a-z]+:|#|\/\/|<)/i.test(target)) return all;
      const m = /^([^#?]*?)((?::\d+(?::\d+)?)?)([#?].*)?$/.exec(target);
      const [, path, line, tail] = m;
      if (!path) return all;
      const abs = posix.normalize(posix.join(posix.dirname(file), decodeURI(path)));
      const newAbs = byPath.get(abs) ?? abs;
      let rel = posix.relative(posix.dirname(newFile), newAbs) || posix.basename(newAbs);
      if (rel === decodeURI(path)) return all;
      n++;
      return `${open}${encodeURI(rel)}${line}${tail ?? ""}${close}`;
    });
  }
  return [parts.join(""), n];
}

function repath(text) {
  let n = 0;
  for (const [from, to] of moves) {
    // The old path, not preceded by another folder name ("DeetsSolutions/docs/…" is another repo)
    // — except this repo's own GitHub URL, ".../DeetsMusicWindows/blob/main/docs/…".
    const re = new RegExp(`((?<![\\w-]/)(?<![\\w-])|(?<=DeetsMusicWindows/(?:blob|tree|raw)/[\\w.-]+/))${from.replace(/[.]/g, "\\.")}`, "g");
    text = text.replace(re, () => { n++; return to; });
  }
  return [text, n];
}

let links = 0, paths = 0;
const changed = [];
for (const file of files.filter((f) => TEXT.test(posix.basename(f)) || TEXT.test(f))) {
  if (/(^|\/)(package-lock\.json|Cargo\.lock)$/.test(file)) continue;
  const full = join(ROOT, file);
  if (!existsSync(full)) continue;
  const before = readFileSync(full, "utf8");
  let text = before, a = 0, b = 0;
  if (file.endsWith(".md")) [text, a] = relinkMarkdown(file, text);
  [text, b] = repath(text);
  if (text !== before) {
    changed.push(`${file} (${a} links, ${b} paths)`);
    links += a; paths += b;
    if (!dry) writeFileSync(full, text);
  }
}
for (const [from, to] of moves) {
  if (dry) continue;
  mkdirSync(join(ROOT, posix.dirname(to)), { recursive: true });
  git("mv", from, to);
}
console.log(changed.join("\n"));
console.log(`[docs-move] ${moves.size} docs ${dry ? "would move" : "moved"} · ${links} links · ${paths} paths · ${changed.length} files`);

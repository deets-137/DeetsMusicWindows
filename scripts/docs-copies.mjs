// `npm run docs:copies` — writes the generated copies of a doc that belongs in two folders
// (DOCS-ORG.md §11.3a). The first path is the one true copy: edit it, then run this. The
// copy's links are re-pointed for its own folder, its front matter says `generated:`, and a
// line under the title names the original. The docs checker (check 18) fails a stale copy.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

/** [original, copy] — the owner's pick, 2026-09-21: the card system's foundation, beside the card docs. */
export const COPIES = [["docs/architecture/SURFACES-AND-CARDS.md", "docs/cards/SURFACES-AND-CARDS.md"]];

export function render(from, to) {
  const src = read(from);
  const end = src.indexOf("\n---\n", 4);
  const fm = Object.fromEntries(src.slice(4, end).split("\n").map((l) => /^([a-z_]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  let body = src.slice(end + 5);

  // Re-point every relative link outside fenced code from the original's folder to the copy's.
  const parts = body.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[^\n]*$)/m);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/(\[[^\]\n]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (all, open, target, close) => {
      if (/^([a-z]+:|#|\/\/|<)/i.test(target)) return all;
      const [, path, rest] = /^([^#?:]*)(.*)$/.exec(target);
      if (!path) return all;
      const abs = posix.normalize(posix.join(posix.dirname(from), decodeURI(path)));
      return `${open}${encodeURI(posix.relative(posix.dirname(to), abs))}${rest}${close}`;
    });
  }
  body = parts.join("");
  const rel = posix.relative(posix.dirname(to), from);
  body = body.replace(/^(# .*\n)/m, `$1\n> **Generated copy** of [${rel}](${rel}), the one true copy. Edit that file, then run \`npm run docs:copies\`.\n`);

  const head = ["---", `status: ${fm.status}`];
  if (fm.shipped_in) head.push(`shipped_in: ${fm.shipped_in}`);
  head.push("generated: npm run docs:copies", `desk_test: ${fm.desk_test}`, `sources: [${from}]`, "---");
  return head.join("\n") + "\n" + body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [from, to] of COPIES) {
    writeFileSync(join(ROOT, to), render(from, to));
    console.log(`[docs-copies] ${from} → ${to}`);
  }
}

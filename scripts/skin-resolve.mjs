// `node scripts/skin-resolve.mjs [--ref <git ref>] [--list] [--dump <skin>]` — proves a token
// refactor in skin.css changes no value (mods.md §10.1, happy.md §1.9).
//
// For each skin, and for each skin's variant blocks (`[data-skin="press"][data-press-vinyl-plate="off"]`,
// `:root[data-bg-motion="reduced"]`, …), it builds the token set the cascade gives <html> — the
// `[data-skin]` base, then the skin's own blocks, then the variant — and resolves every `var()`
// inside that set. A name the set does not hold (a theme role, a token set by a script) stays
// as `var(--name)`. Then it compares the working copy with the same file at a git ref (default
// HEAD) and prints every token whose resolved value changed. Exit 1 on a change.
//
// The limits: tokens set in other sheets (styles.css, component rules) are not part of the set;
// a refactor that only moves values inside skin.css is fully covered.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "src/styles/skin.css";

/** Every `selector { body }` in the sheet, comments out, @keyframes skipped. */
export function blocks(css) {
  const text = css.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const sel = text.slice(i, open).trim();
    if (sel.startsWith("@")) {
      // skip the at-rule's whole body (keyframes, media) — none sets a skin token today
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      i = j;
      continue;
    }
    const close = text.indexOf("}", open);
    const body = text.slice(open + 1, close);
    const decls = [];
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decls.push([m[1], m[2].trim().replace(/\s+/g, " ")]);
    out.push({ sel: sel.replace(/\s+/g, " "), decls });
    i = close + 1;
  }
  return out;
}

const skinsIn = (sel) => [...sel.matchAll(/data-skin="([a-z-]+)"/g)].map((m) => m[1]);
const PURE = /^(?::root)?\[data-skin="([a-z-]+)"\]$/;

/** The contexts: { name, tokens } for each skin and each variant of it. */
export function contexts(css) {
  const bs = blocks(css);
  const base = new Map();
  for (const b of bs) if (b.sel === "[data-skin]") for (const [k, v] of b.decls) base.set(k, v);
  const skins = [...new Set(bs.flatMap((b) => skinsIn(b.sel)))].sort();
  const out = [];
  for (const skin of skins) {
    const own = new Map(base);
    for (const b of bs) { const m = PURE.exec(b.sel); if (m && m[1] === skin) for (const [k, v] of b.decls) own.set(k, v); }
    out.push({ name: skin, tokens: own });
    for (const b of bs) {
      if (!b.decls.length || PURE.test(b.sel) || b.sel === "[data-skin]") continue;
      const named = skinsIn(b.sel);
      if (named.length && !named.includes(skin)) continue;
      const v = new Map(own);
      for (const [k, val] of b.decls) v.set(k, val);
      out.push({ name: `${skin} ${b.sel}`, tokens: v });
    }
  }
  return out;
}

/** Resolve every var() in a token set; names it lacks stay symbolic. */
export function resolveAll(tokens) {
  const done = new Map();
  const resolve = (name, stack) => {
    if (done.has(name)) return done.get(name);
    if (!tokens.has(name)) return null;
    if (stack.has(name)) return `var(${name})`; // a cycle: leave it named
    stack.add(name);
    const v = sub(tokens.get(name), stack);
    stack.delete(name);
    done.set(name, v);
    return v;
  };
  const sub = (value, stack) => {
    let out = "", i = 0;
    while (i < value.length) {
      const at = value.indexOf("var(", i);
      if (at < 0) { out += value.slice(i); break; }
      out += value.slice(i, at);
      let depth = 1, j = at + 4;
      while (j < value.length && depth) { if (value[j] === "(") depth++; else if (value[j] === ")") depth--; j++; }
      const inner = value.slice(at + 4, j - 1);
      const comma = inner.indexOf(",");
      const ref = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
      const got = resolve(ref, stack);
      out += got ?? (fallback !== null ? sub(fallback, stack) : `var(${ref})`);
      i = j;
    }
    return out.replace(/\s+/g, " ").trim();
  };
  for (const k of tokens.keys()) resolve(k, new Set());
  return done;
}

export function resolved(css) {
  return new Map(contexts(css).map((c) => [c.name, resolveAll(c.tokens)]));
}

function main() {
  const args = process.argv.slice(2);
  const refAt = args.indexOf("--ref");
  const ref = refAt >= 0 ? args[refAt + 1] : "HEAD";
  const now = readFileSync(join(ROOT, FILE), "utf8");
  if (args.includes("--list")) {
    for (const c of contexts(now)) console.log(c.name);
    return;
  }
  const dumpAt = args.indexOf("--dump");
  if (dumpAt >= 0) {
    const r = resolved(now).get(args[dumpAt + 1]);
    for (const [k, v] of r ?? []) console.log(`${k}: ${v}`);
    return;
  }
  const then = execFileSync("git", ["show", `${ref}:${FILE}`], { cwd: ROOT, encoding: "utf8" });
  const a = resolved(then), b = resolved(now);
  let changes = 0;
  for (const [ctx, before] of a) {
    const after = b.get(ctx);
    if (!after) { console.log(`context gone: ${ctx}`); changes++; continue; }
    for (const [k, v] of before) {
      if (!after.has(k)) { console.log(`${ctx} | ${k}: removed (was ${v})`); changes++; }
      else if (after.get(k) !== v) { console.log(`${ctx} | ${k}: ${v}  →  ${after.get(k)}`); changes++; }
    }
  }
  for (const ctx of b.keys()) if (!a.has(ctx)) console.log(`context new: ${ctx}`);
  const n = [...b.values()].reduce((s, m) => s + m.size, 0);
  console.log(changes ? `[skin-resolve] ${changes} value(s) changed against ${ref}` : `[skin-resolve] no value changed against ${ref} (${b.size} contexts, ${n} resolved tokens)`);
  process.exit(changes ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

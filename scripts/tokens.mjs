// `npm run tokens` — writes docs/architecture/TOKENS.md from the three token files, so the catalog can
// never drift from the code: palette.css (the paints), themes.css (the color roles) and the
// `[data-skin]` base block of skin.css (every skin token, its base value, its comment, and
// which skins override it). The release check (release-check.mjs §6) fails when the file on
// disk is not what this script would write. UI-ARCHITECTURE.md §1–§3 stays the map; this is
// the list. Its Motion view also names the files that read each motion token (src/ and
// extension/), so a change to who reads one is a `npm run tokens` too.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

/** The lines of the first `{ … }` block whose opening line matches `open`. */
function block(text, open) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => open.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && !/^\}/.test(lines[i]); i++) out.push(lines[i]);
  return out;
}

// A token line, with an optional trailing comment that may close on this line or a later one.
const TOKEN = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*(?:\/\*\s*(.*?)\s*(?:\*\/)?)?\s*$/;
const SECTION = /^\s*\/\*\s*-+\s*(.+?)\s*-+\s*\*\/\s*$/;

/** Parse one block into sections of tokens, carrying comments. */
function tokensOf(lines) {
  const sections = [];
  let section = { name: "", note: [], tokens: [] };
  let note = [];
  let inComment = false;
  let last = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const s = SECTION.exec(line);
    if (s) {
      if (section.tokens.length || section.name) sections.push(section);
      section = { name: s[1].replace(/\s*-+$/, ""), note: [], tokens: [] };
      note = [];
      continue;
    }
    const t = TOKEN.exec(line);
    if (t && !inComment) {
      last = { name: t[1], value: t[2].trim(), comment: t[3] ?? "", note: note.join(" ") };
      section.tokens.push(last);
      note = [];
      continue;
    }
    // A comment line: a block comment before a token (its note), or the tail of a token's
    // own trailing comment that wrapped to the next line.
    const text = line.replace(/^\s*\/\*\s?/, "").replace(/\s*\*\/\s*$/, "").replace(/^\s*\*?\s?/, "").trim();
    const opens = /\/\*/.test(line);
    const closes = /\*\//.test(line);
    if (inComment && last && !opens) {
      last.comment = `${last.comment} ${text}`.trim();
    } else if (text) {
      note.push(text);
    }
    if (opens && !closes) inComment = /^\s*--/.test(line) ? true : false;
    if (closes) inComment = false;
    if (!opens && !closes && !inComment && last && !section.tokens.length) note.push(text);
  }
  if (section.tokens.length || section.name) sections.push(section);
  // A block comment that opened on a token line and closed later.
  return sections;
}

// A time (`0.2s`, `120ms`) or a timing function. `0s` / `0ms` alone is not motion.
const TIME = /(?<![\w.-])(?:\d*\.\d+|[1-9]\d*)m?s\b/;
const CURVE = /cubic-bezier\(|\blinear\(|\bsteps\(|^(?:ease|ease-in|ease-out|ease-in-out|linear)$/;

/** The base tokens whose value is a time or a curve, or an alias (through var()) of one. */
function motionTokens(base) {
  const all = base.flatMap((s) => s.tokens);
  // A speed is a plain number (px per second), so its name says it.
  const yes = new Set(all.filter((t) => TIME.test(t.value) || CURVE.test(t.value) || /-speed$/.test(t.name)).map((t) => t.name));
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of all) {
      if (yes.has(t.name)) continue;
      const refs = [...t.value.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
      if (refs.some((r) => yes.has(r))) { yes.add(t.name); grew = true; }
    }
  }
  return all.filter((t) => yes.has(t.name));
}

/** For each token, the files (repo-relative) that name it outside its own definition. */
function readersOf(names) {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!["fonts", "node_modules", "icons"].includes(e.name)) walk(p); }
      else if (/\.(css|ts|js|html)$/.test(e.name)) files.push(p);
    }
  };
  walk("src");
  walk("extension");
  const want = new Set(names);
  const out = new Map();
  for (const f of files.sort()) {
    const text = read(f).replace(/^\s*--[a-z0-9-]+\s*:/gm, ""); // a definition is not a read
    const seen = new Set();
    for (const m of text.matchAll(/--[a-z0-9-]+(?![a-z0-9-])/g)) if (want.has(m[0])) seen.add(m[0]);
    const short = f.replace(/^src\//, "");
    for (const n of seen) (out.get(n) ?? out.set(n, []).get(n)).push(short);
  }
  return out;
}

export function render() {
  const skin = read("src/styles/skin.css");
  const themes = read("src/styles/themes.css");
  const palette = read("src/styles/palette.css");

  // ── palette ──
  const paints = [...palette.matchAll(/^\s*(--paint-[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]);

  // ── themes: the roles every theme block maps, and the :root extras ──
  const themeNames = [...themes.matchAll(/^\[data-theme="([a-z-]+)"\]\s*\{/gm)].map((m) => m[1]);
  const perTheme = new Map(themeNames.map((n) => [n, new Map(tokensOf(block(themes, new RegExp(`^\\[data-theme="${n}"\\]\\s*\\{`))).flatMap((s) => s.tokens).map((t) => [t.name, t]))]));
  const rootRoles = tokensOf(block(themes, /^:root\s*\{/)).flatMap((s) => s.tokens);
  const roleNames = [...new Set([...rootRoles.map((t) => t.name), ...[...perTheme.values()].flatMap((m) => [...m.keys()])])];

  // ── skins: the base block and each skin's overrides ──
  const base = tokensOf(block(skin, /^\[data-skin\]\s*\{/));
  const skinNames = [...skin.matchAll(/^\[data-skin="([a-z-]+)"\]\s*\{/gm)].map((m) => m[1]);
  const overrides = new Map(skinNames.map((n) => [n, new Set(tokensOf(block(skin, new RegExp(`^\\[data-skin="${n}"\\]\\s*\\{`))).flatMap((s) => s.tokens.map((t) => t.name)))]));
  const baseNames = new Set(base.flatMap((s) => s.tokens.map((t) => t.name)));
  const orphans = [...overrides].flatMap(([n, set]) => [...set].filter((t) => !baseNames.has(t)).map((t) => `${t} (${n})`));

  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const out = [];
  // Front matter (DOCS-ORG.md §5.2): written here, so the byte-for-byte check still holds.
  // No `updated` date — a generated doc is current whenever this script says so.
  out.push("---", "status: foundation", "generated: npm run tokens", "desk_test: none");
  out.push("sources: [src/styles/palette.css, src/styles/themes.css, src/styles/skin.css]", "---", "");
  out.push("# DeetsMusic — the tokens");
  out.push("");
  out.push("> **Generated by `npm run tokens` from `src/styles/palette.css`, `themes.css` and `skin.css`. Do not edit;**");
  out.push("> **the release check fails when this file is stale.** The map of the tiers is [UI-ARCHITECTURE.md §1–§3](UI-ARCHITECTURE.md).");
  out.push("");
  out.push(`| Tier | File | Count |`);
  out.push(`|---|---|---|`);
  out.push(`| Palette (raw paints) | palette.css | ${paints.length} |`);
  out.push(`| Theme (color roles) | themes.css | ${roleNames.length} roles · ${themeNames.length} themes (${themeNames.join(", ")}) |`);
  out.push(`| Skin (everything else) | skin.css base block | ${baseNames.size} tokens · overrides: ${skinNames.map((n) => `${n} ${overrides.get(n).size}`).join(", ")} |`);
  out.push("");

  out.push("## Theme roles");
  out.push("");
  out.push("The value is the `:root` fallback when a theme does not map the role. *Set by* lists the themes that map it.");
  out.push("");
  out.push("| Role | `:root` | Set by | Meaning |");
  out.push("|---|---|---|---|");
  for (const name of roleNames) {
    const r = rootRoles.find((t) => t.name === name);
    const by = themeNames.filter((n) => perTheme.get(n).has(name));
    const comment = r?.comment || r?.note || ""; // a theme block's own comments describe that theme's pick, not the role
    out.push(`| \`${name}\` | ${r ? `\`${esc(r.value)}\`` : "—"} | ${by.length === themeNames.length ? "every theme" : by.length ? by.join(", ") : "—"} | ${esc(comment)} |`);
  }
  out.push("");

  out.push("## Skin tokens");
  out.push("");
  out.push("The base block is Vanilla. *Overridden by* lists the skins that set their own value.");
  out.push("");
  for (const s of base) {
    if (!s.tokens.length) continue;
    out.push(`### ${s.name || "(top)"}`);
    out.push("");
    out.push("| Token | Base | Overridden by | Note |");
    out.push("|---|---|---|---|");
    for (const t of s.tokens) {
      const by = skinNames.filter((n) => overrides.get(n).has(t.name));
      const note = [t.note, t.comment].filter(Boolean).join(" — ");
      out.push(`| \`${t.name}\` | \`${esc(t.value)}\` | ${by.join(", ") || "—"} | ${esc(note)} |`);
    }
    out.push("");
  }
  // ── motion: every token that is a time or a curve, in one place, with the files that read it ──
  const motion = motionTokens(base);
  const readers = readersOf(motion.map((t) => t.name));
  out.push("## Motion");
  out.push("");
  out.push("Every skin token that is a duration, a delay or a curve, or an alias of one. The same rows are in");
  out.push("*Skin tokens* above, with their notes. *Read by* is every file under `src/` and `extension/`");
  out.push("that names the token (CSS `var()`, or a `tokenMs` / `getPropertyValue` read in TS). A row with no");
  out.push("reader is a token nothing uses.");
  out.push("");
  out.push("| Token | Base | Overridden by | Read by |");
  out.push("|---|---|---|---|");
  for (const t of motion) {
    const by = skinNames.filter((n) => overrides.get(n).has(t.name));
    const files = readers.get(t.name) ?? [];
    out.push(`| \`${t.name}\` | \`${esc(t.value)}\` | ${by.join(", ") || "—"} | ${files.join(", ") || "**none**"} |`);
  }
  out.push("");

  if (orphans.length) {
    out.push("## Overrides with no base token");
    out.push("");
    out.push("A skin sets these, but the base block never declares them — a token that only one skin reads, or a typo.");
    out.push("");
    for (const o of orphans) out.push(`- \`${o}\``);
    out.push("");
  }

  out.push("## Palette");
  out.push("");
  out.push("| Paint | Value |");
  out.push("|---|---|");
  for (const [n, v] of paints) out.push(`| \`${n}\` | \`${esc(v)}\` |`);
  out.push("");
  return out.join("\n");
}

export const TARGET = "docs/architecture/TOKENS.md";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = render();
  writeFileSync(join(root, TARGET), text);
  const n = (text.match(/^\| `--/gm) ?? []).length;
  console.log(`[tokens] wrote ${TARGET} — ${n} rows`);
}

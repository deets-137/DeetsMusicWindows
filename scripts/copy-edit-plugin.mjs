// The copy editor's server half — DEV ONLY (docs/features/COPY-EDIT.md).
//
// vite.config.ts adds this plugin with `apply: "serve"`, so `vite build` never sees it.
// The page half is src/copy-edit.ts. It sends the words it sees on screen; this file
// finds where each one is written in src/**/*.ts and writes an edit back there.
//
// Where a text can live (parsed with the TypeScript compiler, so offsets are exact):
//   - a plain string literal: "Home", 'Off', `Hours`
//   - a template literal with ${…} parts: `${n} songs` shows as "{n} songs"
//   - one text run between tags inside a literal that holds HTML: the "Library" in
//     `<span class="x">Library</span>`
// A text found in exactly one place can be edited. A text found in several places is
// locked, and the reply names each place.
//
// The routes (POST, JSON):
//   /__copy/ping                 → { ok: true }  (the page shows its toggle only on a yes)
//   /__copy/probe { texts }      → { hits: { [text]: Hit | { dups: string[] } } }
//   /__copy/save  { file, start, end, expect, value } → { ok } | { error }
//
// A save writes the file at once but HOLDS Vite's reload (his call 3A): the new words are
// already on screen, and a reload would stop the music. The code takes the edit at the
// next reload. The hold lasts HOLD_MS after the write, so a later edit by hand reloads.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const HOLD_MS = 3000;
/** Files that never hold copy: the dev-only tools, and the tool itself. */
const SKIP = /(^|[\\/])(copy-edit|perf|frames|marks|vite-env\.d)\.ts$/;
/** The files that name a Settings row in the row's own words (his call 2026-10-12): a word
 *  written only in settings-card.ts and these is ONE text, and a save changes every copy. */
const MIRRORS = new Set([
  "settings-card.ts", "agent-settings.ts", "settings-repair.ts", "sound-panel.ts", "quick-panel.ts",
  "look-schedule.ts", "rulez-words.ts", "rulez-card.ts", "rulez-logs.ts",
]);

export function copyEditPlugin() {
  let root = process.cwd();
  /** file (absolute) → { mtime, entries } */
  const cache = new Map();
  /** file (absolute, normalized) → time the hold ends */
  const held = new Map();

  const srcDir = () => path.join(root, "src");

  function listFiles(dir, out = []) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) listFiles(p, out);
      else if (/\.ts$/.test(d.name) && !/\.d\.ts$/.test(d.name) && !SKIP.test(p)) out.push(p);
    }
    return out;
  }

  function collapse(t) {
    return t.replace(/\s+/g, " ").trim();
  }
  const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  function decode(t) {
    return t.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
  }

  /** Every editable text in one file: { kind, display, match (regex source or null), start, end, quote, tokens } */
  function index(file) {
    const stat = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtime === stat.mtimeMs) return hit.entries;
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const entries = [];

    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        // Skip import paths, property keys, and type positions: none of them is copy.
        const p = node.parent;
        const isCopy =
          !ts.isImportDeclaration(p) && !ts.isExportDeclaration(p) && !ts.isLiteralTypeNode(p) &&
          !(ts.isPropertyAssignment(p) && p.name === node) && !ts.isExternalModuleReference(p) &&
          !(ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword);
        if (isCopy) addLiteral(node, text, entries);
      } else if (ts.isTemplateExpression(node)) {
        addTemplate(node, text, entries);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    cache.set(file, { mtime: stat.mtimeMs, entries });
    return entries;
  }

  /** A literal's raw body (between its quotes) with its offsets in the file. */
  function body(node, text) {
    const s = node.getStart();
    return { start: s + 1, end: node.end - 1, raw: text.slice(s + 1, node.end - 1), quote: text[s] };
  }

  function addLiteral(node, text, entries) {
    const value = node.text;
    if (!/\p{L}/u.test(value)) return;
    const b = body(node, text);
    if (/<[a-z][^>]*>/i.test(value)) {
      addRuns(b, entries); // HTML in a string: each text run between tags on its own
      return;
    }
    entries.push({ kind: "lit", display: value, key: collapse(value), start: b.start, end: b.end, quote: b.quote });
  }

  /** The text runs between tags inside raw HTML source, each with its own offsets. */
  function addRuns(b, entries) {
    const re = />([^<>$`\u0000]+)</g;
    const raw = ">" + b.raw + "<"; // so a run at either edge still sits between brackets
    let m;
    while ((m = re.exec(raw))) {
      const run = m[1];
      if (!/\p{L}/u.test(run) || /\\/.test(run)) continue;
      const lead = run.length - run.replace(/^\s+/, "").length;
      const core = run.trim();
      const start = b.start + m.index + lead; // m.index + 1 in `raw`, −1 for the ">" put in front
      entries.push({ kind: "run", display: decode(core), key: collapse(decode(core)), start, end: start + core.length, quote: b.quote });
      re.lastIndex = m.index + m[0].length - 1;
    }
  }

  function addTemplate(node, text, entries) {
    const s = node.getStart();
    const raw = text.slice(s + 1, node.end - 1);
    // An HTML template: index its static text runs; the ${} parts sit in attributes or rows.
    if (/<[a-z][^>]*>/i.test(raw)) {
      // The ${…} parts are masked as tags of the same length, so offsets hold and no run spans one.
      addRuns({ start: s + 1, raw: maskSpans(node, s + 1, raw), quote: "`" }, entries);
      return;
    }
    const parts = [node.head.text];
    const tokens = [];
    for (const span of node.templateSpans) {
      tokens.push("{" + text.slice(span.expression.getStart(), span.expression.end) + "}");
      parts.push(span.literal.text);
    }
    if (!parts.some((p) => /\p{L}/u.test(p))) return; // only ${a}${b}: matches anything, holds no copy
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The page sends collapsed text, so the pattern is collapsed the same way.
    const flat = parts.map((p) => p.replace(/\s+/g, " "));
    flat[0] = flat[0].replace(/^ /, "");
    flat[flat.length - 1] = flat[flat.length - 1].replace(/ $/, "");
    const match = "^" + flat.map(esc).join("(.+?)") + "$";
    let display = parts[0];
    tokens.forEach((t, i) => (display += t + parts[i + 1]));
    const letters = parts.join("").replace(/[^\p{L}]/gu, "").length;
    entries.push({ kind: "tpl", display, key: null, re: new RegExp(match, "s"), letters, start: s + 1, end: node.end - 1, quote: "`", tokens });
  }

  /** The raw template body with each ${…} replaced by NULs of the same length. */
  function maskSpans(node, bodyStart, raw) {
    let out = raw;
    for (const span of node.templateSpans) {
      const a = span.expression.getStart() - 2 - bodyStart; // the "${"
      const z = span.literal.getStart() + 1 - bodyStart; // after the "}"
      out = out.slice(0, a) + "\u0000".repeat(z - a) + out.slice(z);
    }
    return out.replace(/\u0000+/g, (m) => "<" + "\u0000".repeat(m.length - 2) + ">");
  }

  /** Several copies, all plain text, at least one in the Settings card, and every one in it or a mirror. */
  function linked(found) {
    const files = found.map(({ file }) => path.relative(srcDir(), file).replace(/\\/g, "/"));
    return (
      files.includes("settings-card.ts") &&
      files.every((f) => MIRRORS.has(f)) &&
      found.every(({ e }) => e.kind !== "tpl")
    );
  }

  function probe(texts) {
    const files = listFiles(srcDir());
    const exact = new Map();
    const tpls = [];
    for (const f of files) {
      for (const e of index(f)) {
        if (e.kind === "tpl") tpls.push({ file: f, e });
        else exact.set(e.key, [...(exact.get(e.key) || []), { file: f, e }]);
      }
    }
    const rel = (f) => path.relative(root, f).replace(/\\/g, "/");
    const where = (f, e) => {
      const t = fs.readFileSync(f, "utf8");
      return rel(f) + ":" + (t.slice(0, e.start).split("\n").length);
    };
    const hits = {};
    for (const raw of texts) {
      const want = collapse(raw);
      if (!want) continue;
      let found = exact.get(want) || [];
      if (!found.length) {
        // A loose template (`${n} song${s}`) matches a lot. The one with the most fixed
        // letters wins; a tie stays several places.
        found = tpls.filter(({ e }) => e.re.test(want));
        const best = Math.max(...found.map(({ e }) => e.letters));
        found = found.filter(({ e }) => e.letters === best);
      }
      const target = ({ file, e }) => ({ file: rel(file), start: e.start, end: e.end, expect: fs.readFileSync(file, "utf8").slice(e.start, e.end) });
      if (found.length === 1) {
        const { file, e } = found[0];
        hits[raw] = { ...target(found[0]), display: e.display, kind: e.kind, at: where(file, e) };
      } else if (linked(found)) {
        // A Settings row's words and their mirrors (his call 2026-10-12): one save changes
        // every copy, so the agent, Rulez and the notices keep the row's own words.
        const first = found.find(({ file }) => rel(file) === "src/settings-card.ts");
        const rest = found.filter((x) => x !== first);
        hits[raw] = {
          ...target(first), display: first.e.display, kind: first.e.kind,
          at: [where(first.file, first.e), ...rest.map(({ file, e }) => where(file, e))].join(", "),
          copies: rest.map(target),
        };
      } else if (found.length > 1) {
        hits[raw] = { dups: found.slice(0, 6).map(({ file, e }) => where(file, e)) };
      }
    }
    return { hits };
  }

  /** The new raw source for an edit, in the literal's own quote. */
  function encode(value, kind, quote, tokens) {
    if (kind === "run") {
      value = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    if (kind === "tpl") {
      // Each {…} part is code: set it aside before the escaping, put it back after.
      tokens.forEach((t, i) => {
        if (!value.includes(t)) throw new Error(`Keep ${t} in the text: the code fills it in`);
        value = value.split(t).join(`\u0001${i}\u0001`);
      });
    }
    let out = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
    if (quote === "`") {
      out = out.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
      out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => "${" + tokens[+i].slice(1, -1) + "}");
    } else {
      out = out.split(quote).join("\\" + quote);
    }
    return out;
  }

  /** Save one text and its copies (a Settings row's mirrors). Every copy is found first; a
   *  copy that cannot be found stops the whole save, so the copies never disagree. */
  function save({ file, start, end, expect, value, copies = [] }) {
    const targets = [{ file, start, end, expect }, ...copies];
    const plans = targets.map((t) => {
      const abs = path.resolve(root, t.file);
      if (!abs.startsWith(srcDir() + path.sep) || !/\.ts$/.test(abs)) throw new Error("Not a file in src/");
      const src = fs.readFileSync(abs, "utf8");
      // An earlier save in the same file moves every later text: find it again by its source,
      // the nearest one to where it was.
      const e = index(abs)
        .filter((x) => src.slice(x.start, x.end) === t.expect)
        .sort((x, y) => Math.abs(x.start - t.start) - Math.abs(y.start - t.start))[0];
      if (!e) throw new Error(`That text is no longer in ${t.file}. Turn edit mode off and on`);
      return { abs, file: t.file, e, raw: encode(value, e.kind, e.quote, e.tokens || []) };
    });
    // Write each file once, its edits from the end back so the earlier offsets hold.
    const byFile = new Map();
    for (const p of plans) byFile.set(p.abs, [...(byFile.get(p.abs) || []), p]);
    for (const [abs, list] of byFile) {
      let src = fs.readFileSync(abs, "utf8");
      for (const p of [...list].sort((a, b) => b.e.start - a.e.start)) src = src.slice(0, p.e.start) + p.raw + src.slice(p.e.end);
      held.set(path.normalize(abs), Date.now() + HOLD_MS);
      fs.writeFileSync(abs, src);
      cache.delete(abs);
      // Where each edit sits now: moved by the edits before it in the same file.
      let shift = 0;
      for (const p of [...list].sort((a, b) => a.e.start - b.e.start)) {
        p.start = p.e.start + shift;
        shift += p.raw.length - (p.e.end - p.e.start);
      }
    }
    console.log(`copy-edit: ${plans.map((p) => p.file).join(", ")} → ${JSON.stringify(value).slice(0, 60)}`);
    const out = (p) => ({ file: p.file, start: p.start, end: p.start + p.raw.length, expect: p.raw });
    const [main, ...rest] = plans.map(out);
    return { ok: true, ...main, copies: rest };
  }

  const ROUTES = { "/__copy/ping": () => ({ ok: true }), "/__copy/probe": (b) => probe(b.texts || []), "/__copy/save": save };

  return {
    name: "deets-copy-edit",
    apply: "serve",
    enforce: "pre",
    configResolved(c) {
      root = c.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const route = ROUTES[(req.url || "").split("?")[0]];
        if (req.method !== "POST" || !route) return next();
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          let out;
          try {
            out = route(data ? JSON.parse(data) : {});
          } catch (err) {
            out = { error: String(err && err.message ? err.message : err) };
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(out));
        });
      });
    },
    // Hold the reload for a file this plugin just wrote (his call 3A). Vite has already
    // marked the module stale, so the next reload serves the new words.
    handleHotUpdate(ctx) {
      const until = held.get(path.normalize(ctx.file));
      if (until && Date.now() < until) return [];
    },
  };
}

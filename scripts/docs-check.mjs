// `npm run docs:check` — the docs checker (docs/DOCS-ORG.md §8). Deterministic, fast, no model.
//
// Checks built (step 2, 2026-09-21) — all FACTS; a fact fails:
//   1. every link resolves            [x](path) in docs/, CLAUDE.md, README.md, AGENTS.md
//   2. every mention names a real file  "TOASTS.md" in prose or `code`, by basename
//   3. every section pointer resolves   "TOASTS.md §4a" → a heading numbered 4a in TOASTS.md
//   4. front matter present and valid   the fields and values of DOCS-ORG.md §5
//   5. versions agree                   the seven version files; every shipped_in is a real,
//                                       published release no newer than the current version
//  11. nothing in ideas/ is above `idea`
//  18. every generated copy (docs-copies.mjs) matches its original — added with step 3
//  19. every docs path a shipped app opens still exists (SHIPPED_LINKS) — added 2026-09-21
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
import { COPIES, render as renderCopy } from "./docs-copies.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GRACE_END = "2026-09-28"; // F5: the release check fails on facts from this date

const STATUS = ["shipped", "built", "designed", "project", "parked", "idea", "foundation", "sop", "guide"];
const KEYS = ["status", "shipped_in", "desk_test", "sources", "updated", "generated"];
// Until release tags exist (DOCS-ORG §14, T2), the withdrawn versions are named here.
const WITHDRAWN = ["0.12.0", "0.12.1"];
// The first public release (RELEASE.md §6: the first on the update channel). Every version
// before it was built on this PC only, so nothing "shipped" in it.
const FIRST_PUBLIC = "0.4.3";
// A path that starts with one of these points into another repo, and is not ours to check.
const OTHER_REPO = /^(\.\.\/(?!src|docs|scripts|extension|cli|crates|README|CLAUDE|AGENTS)|Deets[A-Za-z]+\/|DeetsSolutions)/;
// Another repo named in prose: any Deets* name but this app's own, or the website.
const NAMES_REPO = /\bDeets(?!Music\b)[A-Z][A-Za-z]+|\bdeets\.solutions\b|\bdeets-137\//;
const RETIRED = { "VALUES.md": "LESSONS.md" };
const PLANS = ["project", "designed", "idea"];
// Check 19: every docs path an installed build opens. Append only; never remove a line.
const SHIPPED_LINKS = [
  "docs/AGENT-SETUP.md", // the Guide button (settings.rs) up to 0.12.2
  "docs/integrations/AGENT-SETUP.md", // the Guide button from 0.13.0
];
// Checks 20–26 (2026-09-27, the consistency survey): the code against its ledgers. Each one
// is a grep the survey ran by hand that evening; five of its seven findings were partly wrong
// because the hand grep read the wrong scope, so the checks live here with the right one.
// Check 25: the modules that place a floating box by hand, each with its reason. A popover
// rides makeDropdown / openContextMenuUnder / openContextMenu (CLAUDE.md checklist 13).
const PLACERS = {
  "src/context-menu.ts": "the menu itself",
  "src/collection-card.ts": "placePop: the Sort / View pop's panel, on makeDropdown",
  "src/settings-card.ts": "the Settings menus' panels, on makeDropdown",
  "src/airplay.ts": "the Play on panel, portaled out of the volume flyout, on makeDropdown",
  "src/web.ts": "the web panel's artist results, on makeDropdown",
  "src/hint.ts": "the hover box (ONBOARDING.md §1a)",
  "src/walk.ts": "the first-run tour's stops (ONBOARDING.md §4)",
  "src/row-drag.ts": "the drag ghost and the insertion line (DRAG-DROP.md §4)",
  "src/layout.ts": "the card-swap copy (CARD-SWAP.md)",
};
// Check 26: the cards whose body is not a list of rows, so list-keys.ts does not apply.
const NO_LIST_CARDS = {
  "src/now-playing-card.ts": "one song, no rows",
  "src/settings-card.ts": "rows of controls; Ctrl+F through find-key.ts, sections by hold",
};

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
      const target = hits.find((h) => h.startsWith("docs/") && !frontMatter(read(h))?.moved_to) ?? hits[0];
      const nums = headingNumbers(read(target));
      const ok = nums.has(sec) || [...nums].some((n) => n.startsWith(sec + "."));
      if (!ok) fail(3, file, line, `${name} §${sec} — no heading numbered ${sec} in ${target}`);
    }
  }

  // 4. Front matter, and 11. ideas/.
  for (const file of docs) {
    const fm = frontMatter(texts.get(file));
    if (!fm) { fail(4, file, 1, "no front matter"); continue; }
    // A stub left at an old path for an old link (an app button, a bookmark): it only points on.
    if (fm.moved_to) {
      if (!existsSync(join(ROOT, posix.dirname(file), fm.moved_to))) fail(4, file, 1, `moved_to ${fm.moved_to} does not exist`);
      continue;
    }
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
  // A DeetsMusic Beta version (0.14.0-beta.1, BETA.md §4.1) cannot go in the extension manifest:
  // Chrome takes numbers and dots only. It stays on the last full version until the full release.
  const beta = /-beta\.\d+$/.test(current);
  if (beta) delete versions["extension/manifest.json"];
  for (const [f, v] of Object.entries(versions)) if (v !== current) fail(5, f, 0, `version ${v ?? "(none)"} — package.json says ${current}`);
  const released = new Set([...read("docs/ops/RELEASE-NOTES.md").matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]));
  // x.y.z only: a pre-release tag (`-beta.1`) is cut off, so a beta compares as its release.
  const cmp = (a, b) => { const x = a.split("-")[0].split(".").map(Number), y = b.split("-")[0].split(".").map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  for (const file of docs) {
    const v = frontMatter(texts.get(file))?.shipped_in;
    if (!v) continue;
    if (!released.has(v)) fail(5, file, 1, `shipped_in ${v} has no entry in RELEASE-NOTES.md`);
    else if (WITHDRAWN.includes(v)) fail(5, file, 1, `shipped_in ${v} was withdrawn — use the release that replaced it`);
    else if (cmp(v, current) > 0) fail(5, file, 1, `shipped_in ${v} is newer than the current version ${current}`);
    else if (cmp(v, FIRST_PUBLIC) < 0) fail(5, file, 1, `shipped_in ${v} is before the first public release ${FIRST_PUBLIC}`);
  }

  // 18. Generated copies are current (docs-copies.mjs).
  for (const [from, to] of COPIES) {
    if (!existsSync(join(ROOT, to)) || read(to) !== renderCopy(from, to)) fail(18, to, 0, `stale copy of ${from} — run npm run docs:copies`);
  }

  // 19. Doc paths a shipped app opens (a button's GitHub link) still exist. An installed build
  //     keeps its link for good, so a move needs a stub at the old path (`moved_to`, check 4).
  //     SHIPPED_LINKS is append-only: a link the code no longer holds is still in old installs.
  const linked = new Map();
  for (const f of files.filter((f) => /^(src|src-tauri\/src|cli\/src|extension)\/.*\.(ts|js|rs|html|json)$/.test(f))) {
    for (const m of read(f).matchAll(/github\.com\/deets-137\/DeetsMusicWindows\/blob\/[\w.-]+\/(docs\/[\w./-]+\.md)/g)) linked.set(m[1], f);
  }
  for (const [p, f] of linked) {
    if (!SHIPPED_LINKS.includes(p)) fail(19, f, 0, `links to ${p} — add it to SHIPPED_LINKS in docs-check.mjs, so a later move keeps a stub`);
  }
  for (const p of SHIPPED_LINKS) {
    if (!existsSync(join(ROOT, p))) fail(19, p, 0, `a shipped app opens ${p} — leave a stub there (moved_to) when you move it`);
  }

  // ── 20–26: the code against its ledgers (2026-09-27) ──
  const srcTs = files.filter((f) => /^src\/[^/]+\.ts$/.test(f));
  const src = new Map(srcTs.map((f) => [f, read(f)]));
  const pages = ["index.html", "tray.html"].filter((f) => existsSync(join(ROOT, f))).map((f) => [f, read(f)]);
  const doc = (p) => texts.get(p) ?? read(p);
  const word = (t, w) => new RegExp(`(^|[^\\w])${w}([^\\w]|$)`).test(t);

  // 20. Every settings key has an agent spec (agent-settings.ts) or a reason in AGENT.md § Which
  //     settings, and a row in SETTINGS.md. SETTINGS.md §5 is the recipe.
  {
    const store = src.get("src/settings-store.ts") ?? "";
    const start = store.indexOf("export interface Settings {");
    const iface = start < 0 ? "" : store.slice(start, store.indexOf("\n}\n", start));
    const agent = src.get("src/agent-settings.ts") ?? "";
    const agentDoc = doc("docs/integrations/AGENT.md");
    const settingsDoc = doc("docs/architecture/SETTINGS.md");
    for (const m of iface.matchAll(/^  (\w+)\??:/gm)) {
      const k = m[1];
      const line = lineOf(store, start + m.index);
      if (!agent.includes(`"${k}"`) && !word(agentDoc, k)) fail(20, "src/settings-store.ts", line, `${k} — no spec in agent-settings.ts and no line in AGENT.md § Which settings`);
      if (!word(settingsDoc, k)) fail(20, "src/settings-store.ts", line, `${k} — not in SETTINGS.md §3 or §3a`);
    }
  }

  // 21. Every module that shows a toast is in TOASTS.md §5, the ledger of call sites.
  {
    const ledger = doc("docs/architecture/TOASTS.md");
    for (const [f, t] of src) {
      if (f === "src/toast.ts" || !/\btoast\(/.test(t)) continue;
      if (!ledger.includes(basename(f))) fail(21, f, lineOf(t, t.search(/\btoast\(/)), `calls toast() and TOASTS.md §5 has no row naming ${basename(f)}`);
    }
  }

  // 22. Every written hover hint (a literal `title`) is in ONBOARDING.md's ledger. A hint built
  //     from a value (a template) is the author's to ledger by shape; only literals are checked.
  {
    const ledger = doc("docs/features/ONBOARDING.md");
    for (const [f, t] of [...src, ...pages]) {
      for (const m of t.matchAll(/(?:\btitle="|\.title = ")([^"$\n]+)"/g)) {
        const hint = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        if (!ledger.includes(hint)) fail(22, f, lineOf(t, m.index), `hint "${hint}" is not in ONBOARDING.md §1`);
      }
    }
  }

  // 23. Every element that scrolls draws the app's bar: its class is in the styles.css `:is()`
  //     list, or a module that names the class also adds `app-scroll` (CLAUDE.md checklist 6a).
  {
    const shared = (src.get("src/styles.css") ?? read("src/styles.css")).match(/:is\(([^)]*)\)::-webkit-scrollbar\b/)?.[1] ?? "";
    const inList = new Set([...shared.matchAll(/\.([\w-]+)/g)].map((m) => m[1]));
    const hosts = [...src, ...pages];
    for (const f of files.filter((f) => /^src\/(styles\/)?[^/]+\.css$/.test(f))) {
      const css = read(f);
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/overflow(?:-[xy])?\s*:\s*(auto|scroll)\b/.test(m[2])) continue;
        for (const sel of m[1].split(",")) {
          const cls = sel.match(/\.([A-Za-z_][\w-]*)/)?.[1];
          if (!cls || cls === "app-scroll" || inList.has(cls)) continue;
          if (hosts.some(([, t]) => t.includes(cls) && t.includes("app-scroll"))) continue;
          fail(23, f, lineOf(css, m.index), `.${cls} scrolls with no app-scroll — it shows the grey OS bar (CLAUDE.md checklist 6a)`);
        }
      }
    }
  }

  // 24. Every right-click listener is in the menus' ledger: CONTEXT-MENUS.md (§5, the rows each
  //     card adds; § Where the listeners are) or ONBOARDING.md §2 (the coverage table).
  {
    const ledgers = doc("docs/architecture/CONTEXT-MENUS.md") + doc("docs/features/ONBOARDING.md");
    for (const [f, t] of src) {
      const at = t.indexOf('addEventListener("contextmenu"');
      if (at < 0 || f === "src/context-menu.ts") continue;
      if (!ledgers.includes(basename(f))) fail(24, f, lineOf(t, at), `opens a right-click menu and neither CONTEXT-MENUS.md nor ONBOARDING.md §2 names ${basename(f)}`);
    }
  }

  // 25. A floating box placed by hand is one of the known placers. A new popover rides one of
  //     the three primitives instead (CLAUDE.md checklist 13; the Sort / View pop was the last
  //     to move, 2026-09-27).
  {
    for (const [f, t] of src) {
      if (!t.includes("getBoundingClientRect") || !/style\.top = `/.test(t)) continue;
      if (f in PLACERS) continue;
      fail(25, f, lineOf(t, t.search(/style\.top = `/)), `places a box by hand — a popover is makeDropdown, openContextMenuUnder or openContextMenu; a real placer is added to PLACERS in docs-check.mjs with its reason`);
    }
  }

  // 26. Every card with rows takes the keyboard: list-keys.ts by hand, or the collection engine
  //     (SURFACES-AND-CARDS.md §5 step 4). Rewind, Diary and Rulez had none until 2026-09-27.
  {
    const cards = src.get("src/cards.ts") ?? "";
    for (const m of cards.matchAll(/^import \{ \w+Card \} from "\.\/([\w-]+)";/gm)) {
      const f = `src/${m[1]}.ts`;
      const t = src.get(f);
      if (!t || f in NO_LIST_CARDS) continue;
      if (!t.includes("wireListKeys(") && !t.includes("initCollectionCard(")) fail(26, f, 0, `a card with rows and no list keys — wireListKeys (list-keys.ts), or NO_LIST_CARDS in docs-check.mjs with the reason`);
    }
  }

  return { facts, docs: docs.length };
}

export function report({ facts, docs }) {
  const lines = [];
  const names = {
    1: "links", 2: "mentions", 3: "section pointers", 4: "front matter", 5: "versions", 11: "ideas/", 18: "generated copies", 19: "shipped links",
    20: "settings keys", 21: "toast sites", 22: "hover hints", 23: "scrollers", 24: "right-click ledger", 25: "popover placers", 26: "list keys",
  };
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

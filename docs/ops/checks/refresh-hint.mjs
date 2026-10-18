// The Library ⟳'s hint on a refused click (ideas/apple-calls.md §4.1, built 2026-10-17). Runs on a
// RUNNING dev app with the Library card on screen, through scripts/webview-eval.mjs. It starts ONE
// full sync (the ⟳'s own click, about 45 Apple calls) and one launch-type pass (1–2 calls); the
// clicks while it spins must start nothing.
//
//   node docs/ops/checks/refresh-hint.mjs            # the first dev app
//   node docs/ops/checks/refresh-hint.mjs --second   # the second dev app
//
// Each check prints ok / FAIL with what it read; the exit code is the number of failures.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const second = process.argv.includes("--second");
const evalJs = (expr) => {
  const out = execFileSync(process.execPath, [join(root, "scripts", "webview-eval.mjs"), ...(second ? ["--second"] : []), expr], { encoding: "utf8" }).trim();
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};
let fails = 0;
const check = (name, ok, seen) => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${seen === undefined ? "" : ` — ${typeof seen === "string" ? seen : JSON.stringify(seen)}`}`);
};

const IDLE = "Reads your library from Apple Music again";
const pre = evalJs(`JSON.stringify((() => { const b = document.querySelector("#library-refresh"); return b ? { hint: b.dataset.hint, busy: b.classList.contains("is-busy") } : null; })())`);
check("the Library card's ⟳ is on screen, idle", pre && !pre.busy && pre.hint === IDLE, pre);
if (!pre || pre.busy) process.exit(fails);

// 1. A full sync from the ⟳, three clicks while it spins, the words sampled until it ends.
const full = evalJs(`(async () => {
  const b = document.querySelector("#library-refresh");
  const box = () => { const h = document.querySelector(".hint"); return h && !h.hidden && h.classList.contains("is-on") ? h.querySelector(".hint__title").textContent : null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ring0 = window.__diag.events().filter((e) => e.tag === "library:refreshBusy").length;
  const words = []; const at = (w) => { if (words[words.length - 1] !== w) words.push(w); };
  b.click();
  await sleep(300);
  b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 }));
  b.click();
  const afterClick = { box: box(), nudged: b.classList.contains("is-nudged") };
  b.click(); b.click();
  for (let i = 0; i < 400 && b.classList.contains("is-busy"); i++) { at(b.dataset.hint); await sleep(100); }
  await sleep(300); at(b.dataset.hint);
  const refused = window.__diag.events().filter((e) => e.tag === "library:refreshBusy").length - ring0;
  return JSON.stringify({ afterClick, boxAtEnd: box(), words, refused, nudgedAtEnd: b.classList.contains("is-nudged") });
})()`);
check("a click while it spins shows the hint at once", full.afterClick?.box?.startsWith("Reading your library"), full.afterClick);
check("and the ⟳ dips", full.afterClick?.nudged === true);
check("each refused click is logged, none goes out", full.refused === 3, full.refused);
check("a full pass counts the songs read", full.words?.some((w) => /^Reading your library… [\d,.]+ of [\d,.]+ songs$/.test(w)), full.words?.slice(0, 3));
check("it finishes up, then reads idle", full.words?.at(-2) === "Finishing up your library…" && full.words?.at(-1) === IDLE, full.words?.slice(-2));
check("the box under the pointer took the new words", full.boxAtEnd === IDLE, full.boxAtEnd);
check("the dip class is gone after its end", full.nudgedAtEnd === false);

// 2. A launch-type pass (Rust picks: usually the incremental one).
const inc = evalJs(`(async () => {
  const b = document.querySelector("#library-refresh");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const words = []; const at = (w) => { if (words[words.length - 1] !== w) words.push(w); };
  const p = window.__TAURI_INTERNALS__.invoke("library_sync", { full: false, signin: false }).catch((e) => "err " + e);
  for (let i = 0; i < 600; i++) { at(b.dataset.hint); if (i > 10 && !b.classList.contains("is-busy")) break; await sleep(10); }
  await sleep(300); at(b.dataset.hint);
  return JSON.stringify({ res: await p, words });
})()`);
check("a launch-type pass never says 'of' the total for new songs", !inc.words?.some((w) => /Checking for new songs… .* of /.test(w)), inc.words);
check("it ends idle", inc.words?.at(-1) === IDLE, inc.words);

process.exit(fails);

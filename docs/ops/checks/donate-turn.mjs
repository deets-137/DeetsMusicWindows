// The Donate button's turn (docs/features/donate.md §5): open, close, a reverse at 200 ms, five
// presses 70 ms apart, Escape. Needs `npm run dev:app` in Max. It ends with the panel shut.
// Pass: every `rest` has anims 0, line opacity 1, thread opacity 0, y 0. `maxGap` stays under 50 ms.
// `maxJump` of about 4.9 on a forward turn is the design: the straight S goes back to its S at the
// last frame, under the same picture.
import { execFileSync } from "node:child_process";

const drive = String.raw`(async () => {
  const b = document.getElementById("donate-open"), p = document.getElementById("donate-panel"), svg = b.querySelector("svg");
  const line = svg.querySelector(".donate__line"), s = svg.querySelector(".donate__s"), th = svg.querySelector(".donate__thread");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const nums = (e) => (getComputedStyle(e).d.match(/-?[\d.]+/g) || []).map(Number);
  const rest = () => ({
    anims: svg.getAnimations({ subtree: true }).length, line: getComputedStyle(line).opacity,
    thread: getComputedStyle(th).opacity, y: new DOMMatrix(getComputedStyle(line).transform).f, hidden: p.hidden,
  });
  const trace = async (ms) => {
    const t0 = performance.now();
    let prev = null, maxJump = 0, maxGap = 0, last = t0;
    while (performance.now() - t0 < ms) {
      await frame();
      const now = performance.now(), v = nums(s);
      if (prev && v.length === prev.length) v.forEach((n, i) => (maxJump = Math.max(maxJump, Math.abs(n - prev[i]))));
      maxGap = Math.max(maxGap, now - last);
      last = now;
      prev = v;
    }
    return { maxJump: +maxJump.toFixed(2), maxGap: +maxGap.toFixed(1) };
  };
  const r = {};
  b.click(); r.open = await trace(850); r.openRest = rest();
  b.click(); r.close = await trace(850); r.closeRest = rest();
  b.click(); await wait(200); b.click(); r.reverse = await trace(600); r.reverseRest = rest();
  for (let i = 0; i < 5; i++) { b.click(); await wait(70); }
  r.rapid = await trace(900); r.rapidRest = rest();
  if (!p.hidden) { b.click(); await wait(800); }
  b.click(); await wait(100);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(850); r.escapeRest = rest();
  if (!p.hidden) { b.click(); await wait(800); }
  return r;
})()`;

console.log(execFileSync("node", ["scripts/webview-eval.mjs", drive], { encoding: "utf8" }));

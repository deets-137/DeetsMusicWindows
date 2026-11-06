// The Donate panel's total (docs/features/donate.md § The total). Needs `npm run dev:app` in Max.
// It ends with the panel shut and the kept amount put back.
// Pass: `realCall` is null or a whole number; `sameAmount` has no running transition; `newAmount`
// has one, ends at the right width, and is kept; `reduced` has none; `pastTheGoals` fills both bars.
import { execFileSync } from "node:child_process";

const drive = String.raw`(async () => {
  const KEY = "deets.donateTotal";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = document.getElementById("donate-open"), p = document.getElementById("donate-panel");
  const fills = [...p.querySelectorAll(".donate__fill")];
  const running = () => fills.flatMap((f) => f.getAnimations()).length;
  const ratio = (i) => +(fills[i].getBoundingClientRect().width / fills[i].parentElement.getBoundingClientRect().width).toFixed(3);
  const kept = localStorage.getItem(KEY), motion = document.documentElement.dataset.motion;
  const out = {};
  out.realCall = await window.__TAURI_INTERNALS__.invoke("donate_total");
  if (p.hidden) b.click();
  await wait(900);
  window.__donate.take(50);
  await wait(50);
  out.newAmount = { sliding: running() };
  await wait(900);
  Object.assign(out.newAmount, { ratio: ratio(0), kept: localStorage.getItem(KEY), after: running() });
  window.__donate.take(50);
  await wait(50);
  out.sameAmount = { sliding: running() };
  document.documentElement.dataset.motion = "reduced";
  window.__donate.take(100);
  await wait(50);
  out.reduced = { sliding: running(), ratio: ratio(0) };
  if (motion === undefined) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = motion;
  window.__donate.take(400);
  await wait(900);
  out.pastTheGoals = [ratio(0), ratio(1)];
  window.__donate.take(0);
  await wait(900);
  if (!p.hidden) b.click();
  if (kept === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, kept);
  return JSON.stringify(out);
})()`;

console.log(execFileSync("node", ["scripts/webview-eval.mjs", drive], { encoding: "utf8" }));

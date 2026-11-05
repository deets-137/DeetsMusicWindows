// The album wave's cases on the running dev app (ALBUM-COLOR.md § The album light). A song must
// be playing. Each case ends with a line: what it asked, what happened. Changes the skin, theme
// and two settings for the run and puts them back. `node docs/ops/checks/album-wave-cases.mjs`
import { execFileSync } from "node:child_process";

const evalJs = (js) => execFileSync("node", ["scripts/webview-eval.mjs", js], { encoding: "utf8" }).trim();
const json = (js) => JSON.parse(evalJs(`JSON.stringify(${js})`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The album colors, set through the page's own store path: a fake album change is a change of the
// watched cover, so these cases drive `play` from the caller. This file only checks page state.
const pageState = () => json(`({
  wave: document.querySelectorAll(".album-wave").length,
  bloom: document.documentElement.style.getPropertyValue("--album-neon-bloom"),
  edge: getComputedStyle(document.querySelector(".bento .panel")).borderTopColor,
  shadow: getComputedStyle(document.querySelector(".bento .panel")).boxShadow.slice(0, 60),
})`);

const start = json(`({ skin: __store.get("skin"), theme: __store.get("theme"), press: __store.get("pressLight"), wave: __store.get("albumWave") })`);
const out = [];
try {
  evalJs(`__store.set("skin","press")`);
  await wait(900);
  evalJs(`__store.set("pressLight",0)`);
  await wait(500);
  out.push(["slider 0: no roles, plain plate", pageState()]);
  evalJs(`__store.set("pressLight",80)`);
  await wait(500);
  out.push(["slider 80: roles back, no wave", pageState()]);
  for (const theme of ["lilac", "sepia", "moonlight"]) {
    evalJs(`__store.set("theme","${theme}")`);
    await wait(900);
    out.push([`theme ${theme}: the color follows the ground`, pageState()]);
  }
  for (const skin of ["vanilla", "glass", "ocean", "metal", "happy"]) {
    evalJs(`__store.set("skin","${skin}")`);
    await wait(900);
    out.push([`${skin}: no roles, its own edge`, pageState()]);
  }
} finally {
  evalJs(`(__store.set("skin",${JSON.stringify(start.skin)}), __store.set("theme",${JSON.stringify(start.theme)}), __store.set("pressLight",${start.press}), __store.set("albumWave",${start.wave}))`);
}
for (const [what, state] of out) console.log(what, JSON.stringify(state));

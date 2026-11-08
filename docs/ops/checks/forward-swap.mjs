// The mouse's forward button across a drill swap (docs/architecture/DRAG-DROP.md §6b, his call F1
// A; DESK-TESTS.md B26 step 4). Needs `npm run dev:app` in Max with Home on screen and the
// Search card NOT on screen (put another card in its slot first), so Go to Album swaps Search
// in. The swap follows only a real press (layout.ts INPUT_FRESH_MS), so this sends real input
// through CDP (`Input.dispatchMouseEvent`), the real back and forward buttons included. It plays
// nothing: the clicks are a right-click on a Home tile and a menu row.
// Pass: every line says ok.
import { readFileSync } from "node:fs";

const gen = JSON.parse(readFileSync("src-tauri/.tauri.dev.gen.json", "utf8"));
const port = /--remote-debugging-port=(\d+)/.exec(gen.app.windows.find((w) => w.label === "main").additionalBrowserArgs)[1];
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
  (t) => t.type === "page" && t.url.startsWith(gen.build.devUrl) && !t.url.includes("tray.html"),
);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  waiting.get(msg.id)?.(msg);
  waiting.delete(msg.id);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const n = ++id;
    waiting.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const press = async (x, y, button) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
};

const state = `(() => {
  const slots = Object.fromEntries([...document.querySelectorAll(".panel[data-slot]")].filter((p) => ["left", "right", "c", "d"].includes(p.dataset.slot)).map((p) => [p.dataset.slot, p.dataset.mounted]));
  const home = document.querySelector(".panel[data-mounted=home]");
  const slot = window.__swapSlot ?? (window.__swapSlot = home?.dataset.slot);
  const p = document.querySelector(".panel[data-slot=" + slot + "]");
  const hero = p?.querySelector(".coll-pane[data-pos=center] .lib-hero__title")?.textContent.trim() ?? null;
  const r = p?.querySelector(".panel__body")?.getBoundingClientRect();
  return { slots, slot, card: p?.dataset.mounted, hero, mid: r ? [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] : null };
})()`;
const out = [];
const say = (name, ok, more) => out.push((ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more)));

await evaluate("delete window.__swapSlot");
const s0 = await evaluate(state);
if (!s0.slot) throw new Error("no Home card on screen");
// A Home tile's Go to Album opens in Search (go-to.ts: Home's menu has no Library way), so
// Search must be off screen for the drill to swap it in.
if (Object.values(s0.slots).includes("search")) throw new Error("Search is on screen: put another card in its slot first");
const tile = await evaluate(`(() => {
  // An album in the library (its key is name + cover link): a catalog album opens in Search.
  const t = [...document.querySelectorAll(".panel[data-mounted=home] .search__tile")].find((x) => /^album:.+ https?:/.test(x.dataset.key ?? ""));
  t.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = t.querySelector(".search__tile-art").getBoundingClientRect();
  return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
})()`);
await press(tile[0], tile[1], "right");
await wait(400);
const row = await evaluate(`(() => {
  const b = [...document.querySelectorAll("button, [role=menuitem]")].filter((x) => x.offsetParent !== null).find((x) => x.textContent.trim() === "Go to Album");
  const r = b.getBoundingClientRect();
  return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
})()`);
await press(row[0], row[1], "left");
await wait(2200);
const s1 = await evaluate(state);
say("Go to Album swaps Search into Home's place", s1.card === "search" && !!s1.hero, { card: s1.card, hero: s1.hero });

await press(s1.mid[0], s1.mid[1], "back");
await wait(1600);
const s2 = await evaluate(state);
say("back: Home comes back", s2.card === "home", { card: s2.card });

await press(s2.mid[0], s2.mid[1], "forward");
await wait(2000);
const s3 = await evaluate(state);
say("forward: Search comes back at the album", s3.card === "search" && s3.hero === s1.hero, { card: s3.card, hero: s3.hero });

await press(s3.mid[0], s3.mid[1], "back");
await wait(1600);
const s4 = await evaluate(state);
say("back again: Home", s4.card === "home", { card: s4.card });

await press(s4.mid[0], s4.mid[1], "forward");
await wait(2000);
const s5 = await evaluate(state);
say("forward again: the album", s5.card === "search" && s5.hero === s1.hero, { card: s5.card, hero: s5.hero });
await press(s5.mid[0], s5.mid[1], "back");
await wait(1600);
const s6 = await evaluate(state);
say("ends on Home", s6.card === "home", { card: s6.card });

const log = await evaluate(`window.__diag.events().filter((e) => ["ui:forward", "ui:back", "drill"].includes(e.tag)).slice(-9).map((e) => e.tag + " " + JSON.stringify(e.data))`);
const playing = await evaluate("window.MusicKit.getInstance().isPlaying");
say("nothing played", playing === false);
console.log(out.join("\n"));
console.log(log.join("\n"));
ws.close();

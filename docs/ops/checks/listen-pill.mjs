// The listen pill (docs/features/LISTENERS.md §10) on the dev app. Needs `npm run dev:app`. It opens
// an album in the Search card and a playlist in the Playlists card, grows the card, moves the
// mouse over a row, flips the setting, and puts the card and the setting back.
// Pass: every line of the report says ok. Argument: a catalog search for an album.
import { readFileSync } from "node:fs";

const TERM = process.argv[2] ?? "Tame Impala Currents";
const gen = JSON.parse(readFileSync("src-tauri/.tauri.dev.gen.json", "utf8"));
const port = /--remote-debugging-port=(\d+)/.exec(gen.app.windows.find((w) => w.label === "main").additionalBrowserArgs)[1];
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith(gen.build.devUrl) && !t.url.includes("tray.html"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const open = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  open.get(d.id)?.(d);
};
const cdp = (method, params = {}) => new Promise((r) => { open.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = async (js) => {
  const d = await cdp("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
  if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description ?? "page error");
  return d.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (name, ok, more) => console.log((ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more)));
const mouse = (x, y) => cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

await run(String.raw`window.__lp = {
  addr: async (importer, re) => (await (await fetch(importer)).text()).match(re)[1],
  panel: () => document.querySelector(".search__levels").closest(".panel"),
  pills: (root) => [...root.querySelectorAll(".listen-pill")].filter((p) => p.checkVisibility()),
  rows(root) {
    const pills = this.pills(root);
    const box = (e) => e.getBoundingClientRect();
    return {
      n: pills.length,
      filled: pills.filter((p) => p.textContent).length,
      shown: (() => { const v = pills[0]?.closest(".lib-view")?.getBoundingClientRect(); const on = pills.filter((p) => { const b = p.getBoundingClientRect(); return v && b.bottom > v.top && b.top < v.bottom; }); return { on: on.length, filled: on.filter((p) => p.textContent).length }; })(),
      texts: pills.slice(0, 5).map((p) => p.textContent),
      widths: [...new Set(pills.map((p) => Math.round(box(p).width * 10) / 10))],
      rights: [...new Set(pills.map((p) => Math.round(box(p).right)))],
      cols: root.querySelectorAll(".lib-row--cols").length,
      head: [...root.querySelectorAll(".lib-cols__cell")].map((c) => c.textContent.trim()),
    };
  },
}; 1`);

// A Search card when one is open; else the Library, with your album with the most songs in Full.
const search = await run(String.raw`(async () => {
  if (document.querySelector(".search__levels")) {
    const s = await import(await __lp.addr("/src/compass.ts", /"(\/src\/search\.ts[^"]*)"/));
    const g = await import(await __lp.addr("/src/compass.ts", /"(\/src\/go-to\.ts[^"]*)"/));
    const hits = await s.searchCatalog(${JSON.stringify(TERM)}, ["albums"]);
    const a = hits.albums[0];
    g.requestAlbumPane({ id: a.catalogId ?? a.id, name: a.title, artistName: a.artistName });
    return a.title;
  }
  __lp.panel = () => [...document.querySelectorAll(".panel[data-slot]")].find((p) => p.querySelector(".panel__title")?.textContent.trim() === "Album" || p.querySelector(".panel__title")?.textContent.trim() === "Library");
  const store = await import(await __lp.addr("/src/library-card.ts", /"(\/src\/track-store\.ts[^"]*)"/));
  const bus = await import(await __lp.addr("/src/library-card.ts", /"(\/src\/layout-bus\.ts[^"]*)"/));
  const by = new Map();
  for (const t of store.tracks()) if (t.albumName && t.catalogId) by.set(t.albumName, [...(by.get(t.albumName) ?? []), t]);
  const best = [...by.values()].sort((a, b) => b.length - a.length)[0];
  bus.requestLibraryDrill({ kind: "album", track: best[0] });
  await new Promise((r) => setTimeout(r, 1500));
  [...__lp.panel().querySelectorAll("[data-coll-views] button")].find((b) => b.textContent.trim() === "Full")?.click();
  return best[0].albumName;
})()`);
await wait(3000);
let r = await run("__lp.rows(__lp.panel())");
say("plain rows draw one pill each, of one width", r.n > 2 && r.widths.length === 1, { album: search, ...r });
say("the pills share one right edge in the Full view", r.rights.length === 1, r.rights);
for (let i = 0; i < 15 && r.shown.filled < r.shown.on - 1; i++) {
  await wait(1000);
  r = await run("__lp.rows(__lp.panel())");
}
say("the counts land on the rows on screen, one may have none", r.shown.filled >= r.shown.on - 1 && r.shown.on > 0, { ...r.shown, texts: r.texts });

const slot = await run("__lp.panel().dataset.slot");
const dirs = await run(`JSON.stringify(__grow.dirs("${slot}"))`);
const dir = JSON.parse(dirs ?? "[]")[0];
await run(`__grow.grow("${slot}", ${JSON.stringify(dir)}, "test")`);
await wait(1500);
r = await run("__lp.rows(__lp.panel())");
say("a grown album has columns and a Stats heading", r.cols > 0 && r.head.at(-1) === "Stats", { dir, cols: r.cols, head: r.head });
say("the Stats pills line up", r.rights.length === 1 && r.n > 0, r.rights);
await run(`__grow.collapse("test")`);
await wait(1500);
say("the card collapsed", !(await run("__grow.state()")));
await wait(1000);

const store = `(await import(await __lp.addr("/src/playlists-card.ts", /"(\\/src\\/settings-store\\.ts[^"]*)"/)))`;
await run(`(async () => (${store}).setSetting("showListeners", false, "app"))()`);
await wait(800);
r = await run("__lp.rows(__lp.panel())");
say("the setting off takes the pills away", r.n === 0, r);
await run(`(async () => (${store}).setSetting("showListeners", true, "app"))()`);
await wait(800);
r = await run("__lp.rows(__lp.panel())");
say("the setting on brings them back at once, filled", r.n > 0 && r.shown.filled >= r.shown.on - 1, r.shown);

// The slide: a playlist's rows, with the mouse on a row.
await run(String.raw`(() => {
  const pl = [...document.querySelectorAll(".panel[data-slot]")].find((p) => p.querySelector(".panel__title")?.textContent.trim() === "Playlists");
  pl?.querySelector(".lib-row[data-idx], .lib-tile[data-idx]")?.click();
})()`);
await wait(6000);
const row = await run(String.raw`(async () => {
  const pl = [...document.querySelectorAll(".panel")].find((p) => p.querySelector(".add-square--row:not(.add-square--mark)"));
  if (!pl) return null;
  const el = [...pl.querySelectorAll(".lib-row")].find((x) => x.querySelector(".listen-pill") && x.querySelector(".add-square:not([hidden])"));
  if (!el) return null;
  el.dataset.lpTest = "1";
  const b = el.getBoundingClientRect();
  const pill = el.querySelector(".listen-pill").getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, rest: pill.right, end: b.right };
})()`);
if (!row) console.log("skip  the slide: no open playlist with a + on a row");
else {
  await mouse(row.x, row.y);
  await wait(500);
  const on = await run(String.raw`(() => {
    const el = document.querySelector("[data-lp-test]");
    const sq = el.querySelector(".add-square").getBoundingClientRect();
    return { pill: el.querySelector(".listen-pill").getBoundingClientRect().right, sq: sq.width, opacity: getComputedStyle(el.querySelector(".add-square")).opacity };
  })()`);
  say("the hover slides the pill left and the + grows in", on.pill < row.rest - 10 && on.sq > 10 && on.opacity === "1", { rest: row.rest, ...on });
  await mouse(1, 1);
  await wait(500);
  const off = await run(`document.querySelector("[data-lp-test]").querySelector(".listen-pill").getBoundingClientRect().right`);
  say("leaving puts the pill back", Math.abs(off - row.rest) < 0.5, { off });

  // Rapid: in and out 12 times faster than the slide, then a stop in the middle of one.
  for (let i = 0; i < 12; i++) {
    await mouse(row.x, row.y);
    await wait(40);
    await mouse(1, 1);
    await wait(40);
  }
  await wait(500);
  const rapid = await run(`document.querySelector("[data-lp-test]").querySelector(".listen-pill").getBoundingClientRect().right`);
  say("twelve fast passes end at rest", Math.abs(rapid - row.rest) < 0.5, { rapid });
  await mouse(row.x, row.y);
  await wait(90);
  const mid = await run(`document.querySelector("[data-lp-test]").querySelector(".listen-pill").getBoundingClientRect().right`);
  await mouse(1, 1);
  await wait(500);
  const back = await run(`document.querySelector("[data-lp-test]").querySelector(".listen-pill").getBoundingClientRect().right`);
  say("a reverse in the middle of the slide goes back", Math.abs(back - row.rest) < 0.5, { mid, back });
}
ws.close();

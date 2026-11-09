// Where Add to Queue puts songs (docs/features/QUEUE.md), on the running dev app.
//
// Usage: node docs/ops/checks/add-to-queue.mjs --port <bridge port> [--cdp 9222]
//
// It pins the playlist "Chill" from its row, then presses the real right-click on the pinned tile
// in the Playlists card (the card must be on screen in Max). MusicKit is muted. It replaces the dev
// app's queue and reloads the page once. Settings, the volume and the pin are put back at the end.
// Pass: every line says ok.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const port = arg("--port");
const cdp = arg("--cdp", "9222");
if (!port) throw new Error("--port <the dev app's bridge port> is required: never drive the installed app");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const exe = join(root, "cli", "target", "debug", "deetsmusic.exe");
const cli = (...a) => execFileSync(exe, ["--port", port, ...a], { encoding: "utf8", timeout: 20000 }).trim();
const token = JSON.parse(readFileSync(join(process.env.APPDATA, "com.deetsmusic.dev", "settings.json"), "utf8")).bridgeToken;
const bridge = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

const PLAYLIST = "Chill";
const LONG = "playlist:p.81ULWR136"; // Favorite Songs, 419: longer than MusicKit's window of 200
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const say = (name, ok, more) => {
  results.push(!!ok);
  console.log((ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more)));
};

const targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
const page = targets.find((t) => t.type === "page" && !/tray|devtools/i.test(t.url));
if (!page) throw new Error("no main page on the CDP port");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, no) => {
  ws.onopen = ok;
  ws.onerror = no;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (!d.id || !pending.has(d.id)) return;
  const p = pending.get(d.id);
  pending.delete(d.id);
  if (d.error) p.no(new Error(d.error.message));
  else p.ok(d.result);
};
const send = (method, params = {}) =>
  new Promise((ok, no) => {
    const id = nextId++;
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result.value;
};

const MK = "MusicKit.getInstance()";
const until = async (expr, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expr).catch(() => false)) return true;
    await wait(200);
  }
  return false;
};
const CARD = `document.querySelector('.panel[data-slot="c"]')`;
const TILE = `[...(${CARD}?.querySelectorAll('[data-shelf-item]') ?? [])].find((e) => e.textContent.includes(${JSON.stringify(PLAYLIST)}))`;
const ROW = `[...(${CARD}?.querySelectorAll('*') ?? [])].find((e) => !e.children.length && e.textContent.trim() === ${JSON.stringify(PLAYLIST)} && !e.closest('[data-shelf-item]'))`;
const rightClick = (el) => `(() => {
  const t = ${el};
  if (!t) return false;
  const r = t.getBoundingClientRect();
  t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 8, clientY: r.y + 8, button: 2 }));
  return true;
})()`;
const pressRow = (label) => `(() => {
  const all = [...document.querySelectorAll(".ctx-menu button, .ctx-menu [role=menuitem]")];
  const name = (e) => (e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || "").trim();
  const b = all.find((e) => name(e) === ${JSON.stringify(label)}) ?? all.find((e) => name(e).startsWith(${JSON.stringify(label)}));
  if (!b) return { pressed: false, rows: all.map(name) };
  b.click();
  return { pressed: true };
})()`;
const menu = async (el, label) => {
  if (!(await evaluate(rightClick(el)))) throw new Error(`nothing to right-click for ${label}`);
  await wait(150);
  const r = await evaluate(pressRow(label));
  if (!r.pressed) throw new Error(`no row ${label}: ${JSON.stringify(r.rows)}`);
};
// The page's own settings store. The bridge's set waits for the user (Agent changes settings = Ask),
// and a bare import of an edited module is a second copy, so take the URL the page loaded.
// Read once: the page keeps only its first 250 resource entries.
const storeUrl = await evaluate('performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/src/settings-store.ts"))');
if (!storeUrl) throw new Error("no settings-store URL: reload the dev page first");
const STORE = 'import(' + JSON.stringify(storeUrl) + ')';
const playerUrl = await evaluate('performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes("/src/player.ts"))');
if (!playerUrl) throw new Error("no player URL: reload the dev page first");
/** Added songs stay on top of every new list, so an earlier run's would move the expected places. */
const clearAdded = () => evaluate(`import(${JSON.stringify(playerUrl)}).then((m) => m.clearQueue("manual")).then(() => true)`);
const get = (key) => evaluate(`${STORE}.then((m) => m.setting(${JSON.stringify(key)}))`);
const set = (key, value) => evaluate(`${STORE}.then((m) => void m.setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)}, "app"))`);
const addPress = () => menu(TILE, "Add to Queue");

const state = () =>
  evaluate(`(() => {
    const q = __player.queue();
    return {
      len: q.model.upcomingLen,
      top: q.model.upcoming.map((x) => x.origin),
      aligned: !!q.aligned.aligned,
      cur: q.nowPlaying.model?.id ?? null,
      playing: ${MK}.isPlaying,
    };
  })()`);
const lastN = () => evaluate(`(__diag.events().at(-1)?.n ?? 0)`);
const events = (since) => evaluate(`__diag.events().filter((e) => e.n > ${since}).map((e) => ({ tag: e.tag, data: e.data }))`);
const of = (evs, tag) => evs.filter((e) => e.tag === tag);
const num = (n) => n.toLocaleString("en-US");
const noticeFor = (at, n) =>
  n === 1 ? `Added 1 song in position #${num(at + 1)}.` : `Added ${num(n)} songs in positions #${num(at + 1)}–${num(at + n)}.`;

/** One press: the place, the notice, the song not disturbed, MusicKit in step. */
const check = async (name, wantAt, wantToast = true) => {
  const before = await state();
  const since = await lastN();
  await addPress();
  await wait(1800);
  const after = await state();
  const evs = await events(since);
  const ins = of(evs, "player:insert")[0]?.data;
  const toasts = of(evs, "toast").map((e) => e.data.text);
  const at = typeof wantAt === "function" ? wantAt(before) : wantAt;
  say(`${name}: one insert at ${at}`, ins && ins.at === at && ins.n > 0, ins);
  if (!ins) return null;
  say(`${name}: Up Next grew by ${ins.n}`, after.len === before.len + ins.n, { before: before.len, after: after.len });
  const want = wantToast ? [noticeFor(at, ins.n)] : [];
  say(`${name}: the notice`, JSON.stringify(toasts) === JSON.stringify(want), toasts);
  say(`${name}: the song did not change`, after.cur === before.cur);
  say(`${name}: still playing, no load`, after.playing && !of(evs, "player:pause").some((e) => e.data.why === "load"));
  say(`${name}: MusicKit in step, no misalign`, after.aligned && !of(evs, "player:misalign").length);
  return { before, after, ins };
};

const saved = {};
for (const k of ["addToQueueAt", "addToQueueToast", "restoreQueue", "clearQueueOnLaunch"])
  saved[k] = await get(k);
const volume = await evaluate(`${MK}.volume`);
console.log("saved", JSON.stringify({ ...saved, volume }));
let pinned = false;

try {
  await evaluate(`void (${MK}.volume = 0)`);
  // Set up: pin the playlist from its row, and play a list longer than MusicKit's window.
  if (!(await evaluate(`!!${TILE}`))) await menu(ROW, "Pin");
  pinned = true;
  if (!(await until(`!!${TILE}`, 4000))) {
    console.log("note  the shelf did not draw the new pin at once; reloading the page");
    await evaluate(`void location.reload()`);
    await wait(3000);
    await until(`!!window.__player && !!window.MusicKit`, 30000);
  }
  say("the tile is on the Playlists card's shelf", await until(`!!${TILE}`, 15000));
  cli("play", LONG);
  await until(`${MK}.isPlaying && __player.queue().model.upcomingLen > 300`);
  await wait(2500);
  await evaluate(`void (${MK}.volume = 0)`);
  await clearAdded();
  await wait(1500);

  // Desk test 1, 2: After added songs.
  await set("addToQueueAt", "afterAdded");
  await set("addToQueueToast", true);
  const one = await check("1 after added, first press", 0);
  const n = one?.ins.n ?? 25;
  say("1 the block is on top, marked added", one && one.after.top.slice(0, 20).every((o) => o === "manual"));
  const two = await check("2 after added, second press", n);
  say("2 the first row below both blocks is the list's", two && (await evaluate(`__player.queue().model.upcomingLen`)) === two.after.len);

  // Desk test 3, 4: End of queue, and the toggle.
  await set("addToQueueAt", "end");
  await check("3 end of queue", (b) => b.len);
  await set("addToQueueToast", false);
  await check("4 toggle off", (b) => b.len, false);
  await set("addToQueueToast", true);

  // Edge: two presses in one moment. Each counts the other.
  await set("addToQueueAt", "afterAdded");
  {
    const since = await lastN();
    await evaluate(rightClick(TILE));
    await wait(120);
    await evaluate(pressRow("Add to Queue"));
    await evaluate(rightClick(TILE));
    await wait(30);
    await evaluate(pressRow("Add to Queue"));
    await wait(1000); // the notices come with the model, before MusicKit is done
    const evs = await events(since);
    const ins = of(evs, "player:insert").map((e) => e.data);
    const toasts = of(evs, "toast").map((e) => e.data.text);
    say("edge rapid: two inserts, one after the other", ins.length === 2 && ins[1].at === ins[0].at + ins[0].n, ins);
    say("edge rapid: two notices, positions apart", toasts.length === 2 && toasts[0] !== toasts[1], toasts);
    await until('__player.queue().aligned.aligned', 15000);
    const s = await state();
    say("edge rapid: MusicKit in step", s.aligned && s.playing);
    await until('__player.queue().aligned.aligned', 15000);
    await wait(1500);
  }

  // Edge: MusicKit refuses the insert. The model has the block (the next top-up retries), and the
  // failure notice shows after the placement notice.
  {
    const since = await lastN();
    await evaluate(`void (${MK}.playLater = () => Promise.reject(new Error("add-to-queue check")))`);
    await addPress();
    await wait(1500);
    await evaluate(`void delete ${MK}.playLater`);
    // A warn is two ring entries under this tag (toast.ts): one notice on screen.
    const toasts = [...new Set(of(await events(since), "toast").map((e) => e.data.text))];
    say("edge MusicKit fails: the block is in Up Next and the failure shows", toasts.length === 2 && toasts[0].startsWith("Added ") && toasts[1] === "Couldn't add to the queue.", toasts);
    await wait(500);
  }

  // Edge: a station is playing. The block joins the model; the station goes on.
  {
    const list = JSON.stringify(await bridge("/stations?group=featured"));
    const id = /"id":"(ra.[^"]+)"/.exec(list)?.[1];
    if (!id) say("edge radio: a station to play", false, list.slice(0, 200));
    else {
      cli("play", "station:" + id);
      await until(`${MK}.isPlaying`, 10000);
      await wait(2500);
      await evaluate(`void (${MK}.volume = 0)`);
      const since = await lastN();
      await addPress();
      await wait(1500);
      const evs = await events(since);
      const ins = of(evs, "player:insert")[0]?.data;
      const toasts = of(evs, "toast").map((e) => e.data.text);
      say("edge radio: the notice gives the place", ins && toasts.length === 1 && toasts[0] === noticeFor(ins.at, ins.n), { ins, toasts });
      say("edge radio: the station goes on", await evaluate(`${MK}.isPlaying`));
    }
  }

  // Desk test 5: nothing in the queue. The block starts, with no notice.
  await set("restoreQueue", "off");
  await set("clearQueueOnLaunch", true);
  await wait(800); // the store writes, and the queue blob saves
  await evaluate(`void location.reload()`);
  await wait(3000);
  const back = await until(`!!window.__player && !!${TILE} && !!window.MusicKit`, 30000);
  say("5 the page came back with the tile", back);
  await wait(1500);
  const empty = await state().catch(() => null);
  say("5 the queue is empty", empty && empty.len === 0 && empty.cur === null, empty);
  await evaluate(`void (${MK}.volume = 0)`);
  {
    const since = await lastN();
    await addPress();
    await until(`${MK}.isPlaying`, 15000);
    await wait(800);
    await evaluate(`void (${MK}.volume = 0)`);
    const evs = await events(since);
    say("5 the block plays", of(evs, "player:playContext").length === 1 && (await evaluate(`${MK}.isPlaying`)));
    say("5 no notice", of(evs, "toast").length === 0, of(evs, "toast").map((e) => e.data.text));
  }
} catch (e) {
  say("the script ran to the end", false, String(e));
} finally {
  if (pinned) await menu(TILE, "Unpin").catch((e) => console.log("could not unpin: " + e));
  for (const [k, v] of Object.entries(saved)) await set(k, v).catch((e) => console.log(`could not restore ${k}: ${e}`));
  await evaluate(`void (${MK}.pause(), ${MK}.volume = ${volume})`).catch(() => {});
  ws.close();
}
console.log(results.every(Boolean) ? `PASS (${results.length} checks)` : `FAILED ${results.filter((x) => !x).length} of ${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);

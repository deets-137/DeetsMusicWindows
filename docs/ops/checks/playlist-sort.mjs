// A playlist keeps its sort (docs/features/PLAYLISTS.md §13). Needs `npm run dev:app`, and a
// library that holds the three playlists named below; change the ids for another library. It
// presses the page's own Sort panel, and it clears every row it made. It plays nothing.
// Pass: every line of the report says ok.
import { execFileSync } from "node:child_process";

const A = "p.ZOAXp26hb0GONV"; // an Apple playlist
const B = "p.PkxVVXQT8YWaNJ"; // a second Apple playlist
const L = "local:22"; // a local playlist

const lib = String.raw`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The address the running page imported, as Vite writes it into an importer (a ?t= after an edit).
  // Any other address is a second copy of the module, with its own state.
  const url = async (importer, re) => (await (await fetch(importer)).text()).match(re)[1];
  const m = await import(await url("/src/playlists-card.ts", /"(\/src\/playlists\.ts[^"]*)"/));
  const home = await import(await url("/src/home-card.ts", /"(\/src\/home\.ts[^"]*)"/));
  const card = () => document.querySelector("[data-mounted=playlists]");
  const titles = () => [...card().querySelectorAll("[data-idx] .lib-row__title")].map((e) => e.textContent);
  const list = await m.playlistsCached();
  const byId = (id) => list.find((p) => p.libraryId === id);
  const rows = () => window.__TAURI_INTERNALS__.invoke("playlist_view_rows");
  const rowOf = async (id) => (await rows()).find((r) => r.key === id) ?? null;
  const open = async (id) => { m.requestOpenPlaylist(id); await wait(1500); };
  const back = async () => { card().querySelector(".panel__back").click(); await wait(700); };
  const pick = async (attr, value) => {
    card().querySelector("[data-pop=sort]").click();
    await wait(150);
    document.querySelector("[" + attr + "=" + value + "]").click();
    await wait(150);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(150);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const out = [];
  const say = (name, ok, more) => out.push((ok ? "ok    " : "FAIL  ") + name + (ok || more === undefined ? "" : "  " + JSON.stringify(more)));
`;

const before = String.raw`(async () => {
  ${lib}
  const [A, B, L] = ${JSON.stringify([A, B, L])};
  for (const r of await rows()) m.savePlaylistSort(r.key, "order", "asc");
  const a = (await m.playlistTracks(byId(A))).map((t) => t.title);
  const b = (await m.playlistTracks(byId(B))).map((t) => t.title);
  const l = (await m.playlistTracks(byId(L))).map((t) => t.title);

  await open(A);
  say("no row opens in authored order", same(titles(), a), titles().slice(0, 3));
  await pick("data-sort-dir", "desc");
  const rev = [...a].reverse();
  say("Descending reverses the page", same(titles(), rev), titles().slice(0, 3));
  await wait(300);
  say("the row is kept", (await rowOf(A))?.sortDir === "desc" && (await rowOf(A))?.sortKey === "order", await rowOf(A));
  await back();
  await open(A);
  say("Back and open keeps the sort", same(titles(), rev), titles().slice(0, 3));
  say("Play outside the page follows it", same((await m.playlistInOrder(byId(A))).map((t) => t.title), rev));
  const tile = home.playlistItem ? await home.playlistItem(byId(A)).tracks() : null;
  say("a Home tile and a pin follow it", !tile || same(tile.map((t) => t.title), rev), tile && tile.slice(0, 2).map((t) => t.title));
  say("an edit still reads the authored order", same((await m.playlistTracks(byId(A))).map((t) => t.title), a));
  await back();

  await open(B);
  say("another playlist keeps its own order", same(titles(), b), titles().slice(0, 3));
  await pick("data-sort-key", "artist");
  await pick("data-sort-key", "az");
  await pick("data-sort-dir", "desc");
  await wait(300);
  const row = await rowOf(B);
  say("rapid changes keep the last one", row?.sortKey === "az" && row?.sortDir === "desc", row);
  await back();

  await open(L);
  await pick("data-sort-key", "az");
  await wait(300);
  say("a local playlist keeps its sort", (await rowOf("local:22"))?.sortKey === "az", await rows());
  await back();
  return { out, rev, b: [...b].sort((x, y) => y.localeCompare(x)), l };
})()`;

const after = (rev) => String.raw`(async () => {
  ${lib}
  const [A, B, L] = ${JSON.stringify([A, B, L])};
  const rev = ${JSON.stringify(rev)};
  await open(A);
  say("a reload keeps the sort", same(titles(), rev), titles().slice(0, 3));
  await pick("data-sort-dir", "asc");
  await wait(300);
  say("the default deletes the row", (await rowOf(A)) === null, await rowOf(A));
  await back();
  await open(A);
  say("the default stays after Back", same(titles(), [...rev].reverse()), titles().slice(0, 3));
  await back();
  for (const r of await rows()) m.savePlaylistSort(r.key, "order", "asc");
  await wait(400);
  say("nothing left behind", (await rows()).length === 0, await rows());
  return { out };
})()`;

const run = (js) => JSON.parse(execFileSync("node", ["scripts/webview-eval.mjs", js], { encoding: "utf8", maxBuffer: 1 << 24 }).trim());

const one = run(before);
run("location.reload(), 1");
await new Promise((r) => setTimeout(r, 8000));
const two = run(after(one.rev));
console.log([...one.out, ...two.out].join("\n"));

// The now mark's motion cases (docs/features/NOW-MARK.md, DESK-TESTS.md §6.6). Needs `npm run
// dev:app` in Max with the Library and Playlists cards on screen, and a playlist of 30 songs or
// more (`LIST`). IT PLAYS MUSIC: it refuses to run unless the app's volume is 0. It ends paused.
// Pass: every line of the report says ok. `worst` is the largest gap between frames, in ms.
import { execFileSync } from "node:child_process";

const LIST = process.argv[2] ?? "p.ZOAXp26hb0GONV";

const drive = String.raw`window.__nowMarkRun = (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const addr = async (importer, re) => (await (await fetch(importer)).text()).match(re)[1];
  const pl = await import(await addr("/src/playlists-card.ts", /"(\/src\/playlists\.ts[^"]*)"/));
  const player = await import(await addr("/src/playlists-card.ts", /"(\/src\/player\.ts[^"]*)"/));
  const queue = await import(await addr("/src/collection-card.ts", /"(\/src\/queue\.ts[^"]*)"/));
  if (player.getVolume() > 0) throw new Error("volume is not 0");
  const id = ${JSON.stringify(LIST)};
  const ctx = "playlist:" + id;
  const card = () => document.querySelector("[data-mounted=playlists]");
  const view = () => card().querySelector("[data-view]");
  const lib = () => document.querySelector("[data-mounted=library] [data-view]");
  const marks = (v) => [...v.querySelectorAll(":scope > .now-mark")];
  const yOf = (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
  const center = (v, i) => { const r = v.querySelector('[data-idx="' + i + '"]'); return r ? r.offsetTop + r.offsetHeight / 2 : null; };
  const rowAt = (v, y) => [...v.querySelectorAll("[data-idx]")].find((r) => Math.abs(r.offsetTop + r.offsetHeight / 2 - y) < 2);
  const out = [];
  const say = (name, ok, more) => { window.__nowMarkStep = name; out.push((ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more))); };

  pl.requestOpenPlaylist(id);
  await wait(1500);
  const tracks = await pl.playlistTracks((await pl.playlistsCached()).find((p) => p.libraryId === id));
  const isSong = (t) => { const c = queue.getCurrent(); return !!c && (c.catalogId === t.catalogId || c.libraryId === t.libraryId); };
  const until = async (t) => { for (let i = 0; i < 300 && !isSong(t); i++) await wait(20); return isSong(t); };

  /** Trace the chevron while fn runs: every frame's place, the largest step and the largest gap. */
  const trace = async (ms, fn) => {
    const ys = [], t0 = performance.now();
    let last = t0, worst = 0, run = true;
    (async () => { while (run) { await frame(); const n = performance.now(); worst = Math.max(worst, n - last); last = n; const m = marks(view())[0]; if (m) ys.push(+yOf(m).toFixed(1)); } })();
    await fn();
    await wait(ms);
    run = false;
    let step = 0;
    for (let i = 1; i < ys.length; i++) step = Math.max(step, Math.abs(ys[i] - ys[i - 1]));
    return { ys, step: +step.toFixed(1), worst: +worst.toFixed(1) };
  };
  // The player drops a press while a song loads, so each press waits for the song to be playing.
  const ready = async () => { for (let i = 0; i < 400 && !player.isPlayingNow(); i++) await wait(20); await wait(150); };
  const settled = (i) => { const m = marks(view()); return m.length === 1 && m[0].classList.contains("now-mark--chevron") && Math.abs(yOf(m[0]) - center(view(), i)) < 1; };

  // cold: the list starts playing
  window.__nowMarkStep = "first play";
  void player.playTracks(tracks, 3, ctx);
  await until(tracks[3]);
  await wait(500);
  say("cold: a chevron on the played row", settled(3), marks(view()).map((m) => m.className));

  // one press
  await ready();
  let t = await trace(700, () => player.nextTrack("test"));
  const pitch = center(view(), 1) - center(view(), 0);
  say("Next slides one row, in steps", settled(4) && t.step < pitch * 0.5, { step: t.step, pitch, worst: t.worst, frames: t.ys.length });
  say("the slide never overshoots", Math.max(...t.ys) <= center(view(), 4) + 0.5, Math.max(...t.ys));

  // reverse
  await ready();
  t = await trace(700, () => player.prevTrack("test"));
  say("Previous slides back", settled(3) && t.step < pitch * 0.5, { step: t.step, worst: t.worst });

  // rapid: four presses 250 ms apart, each lands mid-slide
  await ready();
  t = await trace(1500, async () => { for (let i = 0; i < 4; i++) { void player.nextTrack("test"); await wait(250); } });
  // The player can drop a press while a song loads, so the song, not the count, says where it ends.
  const nowRow = () => tracks.findIndex(isSong);
  say("rapid Next turns with no jump", nowRow() > 3 && settled(nowRow()) && t.step < pitch * 0.6, { row: nowRow(), step: t.step, worst: t.worst });
  let down = true;
  for (let i = 1; i < t.ys.length; i++) if (t.ys[i] < t.ys[i - 1] - 0.5) down = false;
  say("rapid Next never goes backward", down);

  // a long move fades: two marks for a moment, then one
  void player.playTracks(tracks, 25, ctx);
  await until(tracks[25]);
  const during = marks(view()).length;
  await wait(500);
  say("a long move fades, it does not sweep", settled(25), { during });

  // a redraw during a slide leaves the slide running
  void player.playTracks(tracks, 26, ctx);
  await until(tracks[26]);
  await wait(60);
  const el = marks(view())[0];
  const running = el.getAnimations().length;
  await wait(600);
  say("the slide finished on its row", settled(26), { running });

  // the sort moves the row: the mark goes with it, no slide
  const sortPick = async (attr, v) => { card().querySelector("[data-pop=sort]").click(); await wait(150); document.querySelector("[" + attr + "=" + v + "]").click(); await wait(200); document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(250); };
  await sortPick("data-sort-dir", "desc");
  const row = rowAt(view(), yOf(marks(view())[0]));
  say("a sort carries the mark to the song's row", row?.querySelector(".lib-row__title")?.textContent === tracks[26].title, row?.querySelector(".lib-row__title")?.textContent);
  await sortPick("data-sort-dir", "asc");
  say("the sort back carries it back", settled(26));

  // another list: the song plays from here, so the Library shows a line if it holds the song
  const inLib = marks(lib());
  say("another list shows lines only", inLib.every((m) => m.classList.contains("now-mark--line")), inLib.length);

  // a pane rebuilt by Back: it was drawn before it was in the page
  const back = async () => { card().querySelector(".panel__back").click(); await wait(800); };
  await back();
  pl.requestOpenPlaylist(id);
  await wait(1500);
  say("Back and open: the chevron is on its row", settled(tracks.findIndex(isSong)), marks(view()).map((m) => yOf(m)));

  // a slide cut short by a long move leaves no second mark
  void player.playTracks(tracks, tracks.findIndex(isSong) - 1, ctx);
  await wait(120);
  void player.playTracks(tracks, 2, ctx);
  await until(tracks[2]);
  await wait(600);
  say("a slide cut by a long move leaves one mark", settled(2), marks(view()).length);

  // Play Next from this list: the song does not play from the list, so it wears the line
  await ready();
  await player.queueTracksNext(tracks.slice(20, 21), ctx);
  await wait(1000);
  void player.nextTrack("test");
  await until(tracks[20]);
  await wait(500);
  const added = marks(view());
  say("a song added by hand shows the line", added.length === 1 && added[0].classList.contains("now-mark--line") && Math.abs(yOf(added[0]) - center(view(), 20)) < 1, added.map((m) => m.className));

  // reduced motion: no slide
  const motion = document.documentElement.dataset.motion;
  document.documentElement.dataset.motion = "reduced";
  void player.playTracks(tracks, 5, ctx);
  await until(tracks[5]);
  await ready();
  const from = nowRow();
  void player.nextTrack("test");
  await until(tracks[from + 1]);
  await wait(40);
  const none = marks(view())[0]?.getAnimations().length;
  say("reduced motion: no slide", nowRow() === from + 1 && settled(nowRow()) && none === 0, { from, row: nowRow(), none });
  if (motion === undefined) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = motion;

  await wait(1200);

  // a windowed list: the row is not drawn when the pane is rebuilt
  const big = "p.81ULWR136";
  pl.requestOpenPlaylist(big);
  await wait(2500);
  const v = view();
  v.scrollTop = 300 * (center(v, 1) - center(v, 0));
  await wait(400);
  const pick = [...v.querySelectorAll("[data-idx]")].find((r) => r.getBoundingClientRect().top > v.getBoundingClientRect().top + 120);
  const idx = Number(pick.dataset.idx);
  pick.querySelector(".lib-row__title").click();
  await wait(1200);
  const onRow = () => { const m = marks(view()); const r = view().querySelector('[data-idx="' + idx + '"]'); return { n: m.length, d: m[0] && r ? +(yOf(m[0]) - (r.offsetTop + r.offsetHeight / 2)).toFixed(1) : null, cls: m[0]?.className }; };
  say("a press in a windowed list marks the row", onRow().n === 1 && Math.abs(onRow().d) < 1, onRow());
  await back();
  pl.requestOpenPlaylist(big);
  await wait(2000);
  const far = marks(view());
  say("Back in a windowed list keeps the mark", far.length === 1, far.length);
  const vv = view();
  if (far[0]) vv.scrollTop = yOf(far[0]) - vv.clientHeight / 2;
  await wait(500);
  say("the far mark lands on its row", onRow().n === 1 && Math.abs(onRow().d) < 1, onRow());

  await back();
  pl.requestOpenPlaylist(id);
  await wait(800);
  if (player.isPlayingNow()) await player.playPause("test");
  await wait(300);
  return out;
})().then((r) => (window.__nowMarkOut = r), (e) => (window.__nowMarkOut = ["FAIL  " + e.message]));
1`;

const eval_ = (js) => execFileSync("node", ["scripts/webview-eval.mjs", js], { encoding: "utf8", maxBuffer: 1 << 24 }).trim();
// webview-eval gives up after 20 s, so the run starts in the page and the answer is read after it.
eval_("delete window.__nowMarkOut, 1");
eval_(drive);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const out = eval_("JSON.stringify(window.__nowMarkOut ?? null)");
  const lines = JSON.parse(out);
  if (typeof lines === "string" ? JSON.parse(lines) : lines) {
    console.log((typeof lines === "string" ? JSON.parse(lines) : lines).join("\n"));
    process.exit(0);
  }
}
console.log("FAIL  no answer in 60 s, last step: " + eval_("String(window.__nowMarkStep)"));

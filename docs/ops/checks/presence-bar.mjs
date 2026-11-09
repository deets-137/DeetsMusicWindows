// The Discord card's bar (docs/integrations/FRIENDS.md §8.9a), on the running dev app.
//
// Usage: node docs/ops/checks/presence-bar.mjs --port <bridge port> [--cdp 9222]
//
// Nothing reaches Discord. The script reloads the page and wraps `window.fetch`, which Tauri's IPC
// calls, so every presence_* call is answered "sent" in the page and no pipe opens. A harmless
// presence_close proves the wrap holds BEFORE sharing goes on; if it is not caught the script stops.
// (CDP's Fetch domain is not safe for this: on 2026-11-09 its reply broke the custom protocol, Tauri
// moved to postMessage, and real cards reached Discord for about a minute.)
// It mutes MusicKit, turns sharing on, plays four songs for less than half their length (no
// scrobble), and puts the volume, Repeat and the sharing switch back at the end. It replaces the
// dev app's queue. Pass: every line says ok.
import { execFileSync } from "node:child_process";
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

const SONGS = { a: "song:1441164589", b: "song:1594430653", c: "song:1671826829", d: "song:1647271351" };
const TOL = 3.5; // seconds: the app's own 3 s, and the time a card takes to arrive here
const FLOOR_MS = 3900; // the 4-second floor, less timer slack

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const say = (name, ok, more) => {
  const line = (ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more));
  results.push(ok);
  console.log(line);
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
const cards = [];
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
const clock = () => evaluate(`({ pos: ${MK}.currentPlaybackTime, len: ${MK}.currentPlaybackDuration, title: ${MK}.nowPlayingItem?.title })`);
const mute = () => evaluate(`void (${MK}.volume = 0)`);

const WRAP = `(() => {
  const orig = window.fetch;
  const s = (window.__presenceBar = { orig, cards: [], other: 0 });
  window.fetch = function (url, init) {
    const m = /^http:\\/\\/ipc\\.localhost\\/(presence_[a-z]+)/.exec(String(url));
    if (!m) return orig.apply(this, arguments);
    if (m[1] === "presence_set") {
      const act = JSON.parse(init.body).activity;
      const k = ${MK};
      s.cards.push({ at: Date.now(), song: act.details, start: act.timestamps?.start, end: act.timestamps?.end,
        pos: k.currentPlaybackTime, len: k.currentPlaybackDuration, title: k.nowPlayingItem?.title });
    } else s.other++;
    const body = m[1] === "presence_set" ? '"sent"' : "null";
    return Promise.resolve(new Response(body, { headers: { "Tauri-Response": "ok", "Content-Type": "application/json" } }));
  };
})()`;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    const { ok, no } = pending.get(d.id);
    pending.delete(d.id);
    return d.error ? no(new Error(d.error.message)) : ok(d.result);
  }
};

const until = async (test, ms, step = 150) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await test();
    if (v) return v;
    await wait(step);
  }
  return null;
};
const nextCard = (from, ms = 9000, song) => until(() => cards.slice(from).find((c) => !song || c.song === song), ms);
const shown = (c) => (c.at - c.start) / 1000;
const length = (c) => (c.end - c.start) / 1000;
const brief = (c) => c && { song: c.song, shown: +shown(c).toFixed(1), length: +length(c).toFixed(1), truth: +(c.pos ?? 0).toFixed(1), songLength: Math.round(c.len ?? 0) };

// A clean page: an earlier failed reply can leave Tauri on postMessage, which no wrap can see.
await send("Page.reload");
await wait(1500);
const ready = await until(() => evaluate(`!!(window.MusicKit?.getInstance?.()?.isAuthorized && window.__player)`).catch(() => false), 30000, 300);
if (!ready) throw new Error("the page did not come back");
await wait(1500);
await evaluate(WRAP);
await evaluate(`window.__TAURI_INTERNALS__.invoke("presence_close")`);
if ((await evaluate(`window.__presenceBar.other`)) !== 1) throw new Error("the wrap did not catch presence_close: stopping before sharing goes on");
setInterval(() => {
  evaluate(`window.__presenceBar.cards.slice(${cards.length})`)
    .then((more) => {
      for (const c of more ?? []) if (!cards.some((x) => x.at === c.at && x.song === c.song)) cards.push(c);
    })
    .catch(() => {});
}, 100);
const before = await evaluate(`(async () => {
  const s = await import("/src/settings-store.ts");
  return { share: s.setting("shareActivityDiscord"), volume: ${MK}.volume };
})()`);
const npJson = JSON.parse(cli("np", "--json"));
const repeatWas = npJson.repeat ?? "off";

try {
  await mute();
  await evaluate(`import("/src/settings-store.ts").then((s) => s.setSetting("shareActivityDiscord", true, "app"))`);
  cli("repeat", "off");
  cli("play", SONGS.a);
  await mute();

  const first = await nextCard(0, 12000);
  say("a card goes out when a song starts", !!first?.start, brief(first));
  say("  it starts near 0:00", !!first && Math.abs(shown(first)) < TOL, brief(first));
  await until(async () => (await clock()).pos > 3, 12000);
  await wait(1000);

  let from = cards.length;
  await wait(9000);
  say("steady play sends nothing", cards.length === from, { sent: cards.length - from });

  from = cards.length;
  await evaluate(`${MK}.pause()`);
  await wait(1200);
  await evaluate(`${MK}.play()`);
  await wait(6000);
  say("a pause of about a second sends nothing", cards.length === from, { sent: cards.length - from });

  from = cards.length;
  await evaluate(`${MK}.pause()`);
  await wait(9000);
  await evaluate(`${MK}.play()`);
  let c = await nextCard(from);
  say("a resume after 9 s corrects the bar", !!c && Math.abs(shown(c) - c.pos) < TOL, brief(c));

  await wait(4500);
  from = cards.length;
  cli("seek", "100");
  c = await nextCard(from);
  say("a seek corrects the bar", !!c && Math.abs(shown(c) - 100) < TOL + 2, brief(c));

  await wait(4500);
  from = cards.length;
  await evaluate(`(async () => { for (const t of [20, 60, 90, 30]) { await ${MK}.seekToTime(t); await new Promise((r) => setTimeout(r, 450)); } })()`);
  await wait(9000);
  const burst = cards.slice(from);
  const gaps = burst.slice(1).map((x, i) => x.at - burst[i].at);
  say("four quick seeks keep the 4-second floor", burst.length >= 1 && burst.length <= 3 && gaps.every((g) => g >= FLOOR_MS), { sent: burst.length, gaps });
  const end = burst.at(-1);
  const nowClock = await clock();
  const drift = Math.abs((Date.now() - end.start) / 1000 - nowClock.pos);
  say("  and the bar ends up true", drift < TOL, { drift: +drift.toFixed(1) });

  // The ticket: a song runs out into the next one.
  await wait(4500);
  cli("queue", SONGS.b);
  await wait(1200);
  const old = await clock();
  from = cards.length;
  await evaluate(`${MK}.seekToTime(${Math.floor(old.len - 2)})`);
  const nameB = await until(async () => {
    const t = await clock();
    return t.title && t.title !== old.title ? t.title : null;
  }, 15000);
  await mute();
  say("a song runs out into the next one", !!nameB, { from: old.title, to: nameB });
  c = nameB ? await nextCard(from, 12000, nameB) : null;
  const realLen = (await clock()).len;
  say("a natural song change: a card for the new song", !!c, brief(c));
  say("  it does not show the old song's position (the ticket)", !!c && Math.abs(shown(c)) < TOL + 1, { shown: c && +shown(c).toFixed(1), oldSongWasAt: Math.round(old.len) });
  say("  it has the new song's length (the ticket)", !!c && Math.abs(length(c) - realLen) < TOL, { card: c && +length(c).toFixed(1), real: +realLen.toFixed(1), oldLen: +old.len.toFixed(1) });

  await wait(4500);
  cli("repeat", "one");
  await wait(300);
  const len = (await clock()).len;
  from = cards.length;
  await evaluate(`${MK}.seekToTime(${Math.floor(len - 2)})`);
  // The seek itself corrects the bar first; the loop is the card after it.
  const loop = await until(() => cards.slice(from).find((x) => x.song === nameB && Math.abs(shown(x)) < TOL + 3), 20000);
  say("a Repeat One loop corrects the bar", !!loop, brief(loop));
  cli("repeat", "off");
  await wait(600);
  const mode = await evaluate(`${MK}.repeatMode`);
  say("Repeat off reaches MusicKit", mode === 0, { repeatMode: mode });

  // After Repeat One is off, a song still runs out into the next one.
  await wait(4500);
  cli("queue", SONGS.d);
  await wait(1200);
  const held = await clock();
  await evaluate(`${MK}.seekToTime(${Math.floor(held.len - 2)})`);
  const after = await until(async () => {
    const t = await clock();
    return t.title && t.title !== held.title ? t.title : null;
  }, 15000);
  await mute();
  say("after Repeat One, a song runs out into the next one", !!after, { from: held.title, to: after });

  // A click on another song, a minute into this one.
  await wait(4500);
  await evaluate(`${MK}.seekToTime(60)`);
  await wait(4500);
  from = cards.length;
  cli("play", SONGS.c);
  await mute();
  const nameC = await until(async () => {
    const t = await clock();
    return t.title && t.title !== after ? t.title : null;
  }, 15000);
  await nextCard(from, 12000, nameC);
  await wait(6000); // a card sent in the moment between songs has no bar; the next report adds it
  const jump = cards.slice(from).filter((x) => x.song === nameC);
  say("a jump from a minute in: no card shows the old position", jump.length > 0 && jump.every((x) => !x.start || Math.abs(shown(x)) < TOL + 6), jump.map(brief));
  const jumped = jump.at(-1);
  const jumpNow = await clock();
  const jumpOff = jumped?.start ? Math.abs((Date.now() - jumped.start) / 1000 - jumpNow.pos) : null;
  say("  and the bar is true within the floor", jumpOff !== null && jumpOff < TOL, { off: jumpOff && +jumpOff.toFixed(1) });

  // A run of skips.
  await wait(4500);
  cli("queue", SONGS.d);
  cli("queue", SONGS.b);
  cli("queue", SONGS.a);
  await wait(800);
  from = cards.length;
  cli("next");
  cli("next");
  await mute();
  await wait(10000);
  const skips = cards.slice(from);
  const skipGaps = skips.slice(1).map((x, i) => x.at - skips[i].at);
  say("skipping keeps the 4-second floor", skips.length >= 1 && skipGaps.every((g) => g >= FLOOR_MS), { sent: skips.length, gaps: skipGaps });
  const tail = skips.at(-1);
  const now = await clock();
  const off = Math.abs((Date.now() - tail.start) / 1000 - now.pos);
  say("  and the last card is the song on now, and true", tail.song === now.title && off < TOL, { card: tail.song, now: now.title, off: +off.toFixed(1) });

  console.log("\nthe app's own lines:");
  console.log(
    cli("diag")
      .split("\n")
      .filter((l) => l.includes("presence:"))
      .slice(-30)
      .map((l) => l.slice(0, 150))
      .join("\n"),
  );
} finally {
  await evaluate(`${MK}.pause()`).catch(() => {});
  await evaluate(`import("/src/settings-store.ts").then((s) => s.setSetting("shareActivityDiscord", ${!!before.share}, "app"))`).catch(() => {});
  await wait(800);
  try {
    cli("repeat", String(repeatWas));
  } catch {}
  await evaluate(`void (${MK}.volume = ${before.volume ?? 1})`).catch(() => {});
  await evaluate(`void (window.fetch = window.__presenceBar.orig)`).catch(() => {});
  ws.close();
}
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} ok, ${bad} failed`);
process.exit(bad ? 1 : 0);

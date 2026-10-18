// The Press record's Spin FPS row (VINYL.md §12, built 2026-10-17). Runs on the RUNNING first dev
// app (`npm run dev:app`: `dev:built` cannot play, Apple refuses its license), through
// scripts/webview-eval.mjs and the `deetsmusic` CLI. It sets Press with Record player on Spin,
// plays one song (volume as it is), steps the row through its four choices and the speed through
// 78, reads the disc's easing and angle, and puts the look, the rows and the pause back.
//
//   node docs/ops/checks/spin-fps.mjs                 # the dev app on port 47826
//   node docs/ops/checks/spin-fps.mjs --port 47825    # if the dev app started first
//
// Each check prints ok / FAIL with what it read; the exit code is the number of failures.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const portAt = process.argv.indexOf("--port");
const port = portAt > 0 ? process.argv[portAt + 1] : "47826";
const SONG = "song:1535799403"; // Hurt, Arlo Parks: in his library
const evalJs = (expr) => {
  const out = execFileSync(process.execPath, [join(root, "scripts", "webview-eval.mjs"), expr], { encoding: "utf8" }).trim();
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};
const cliDir = join(process.env.LOCALAPPDATA ?? "", "DeetsMusic", "current", "cli");
const cliExe = existsSync(cliDir) ? readdirSync(cliDir).find((f) => f.endsWith(".exe")) : null;
const cliRaw = (...args) => execFileSync(join(cliDir, cliExe), ["--port", port, ...args], { encoding: "utf8" }).trim();
// A dev app HE started (the only kind that plays since 2026-10-16, DEBUGGING.md § Sign-in) keeps
// its bridge details in the real %APPDATA%, which a shell inside the Claude package does not
// see: then play and pause go through the page's MusicKit instead.
const cli = (verb, id) => {
  try {
    return cliRaw(...[verb, id].filter(Boolean));
  } catch {
    return evalJs(verb === "play"
      ? `(MusicKit.getInstance().setQueue({ song: ${JSON.stringify(id.replace(/^song:/, ""))}, startPlaying: true }), "played by page")`
      : `(MusicKit.getInstance().pause(), "paused by page")`);
  }
};
let fails = 0;
const check = (name, ok, seen) => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${seen === undefined ? "" : ` — ${typeof seen === "string" ? seen : JSON.stringify(seen)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The disc: its easing, its turn in ms, its angle in degrees, its play state.
const DISC = `JSON.stringify((() => {
  const el = document.querySelector(".np__art .vinyl:not(.vinyl--out) .vinyl__spin");
  const a = el?.getAnimations().find((x) => String(x.effect.getKeyframes()[1]?.transform).includes("rotate"));
  if (!a) return null;
  const t = a.effect.getTiming();
  return { easing: t.easing, turn: Math.round(t.duration), deg: Math.round(((a.currentTime % t.duration) / t.duration) * 360), state: a.playState };
})())`;

const KEYS = ["skin", "lookSchedule", "pressVinyl", "pressVinylFps", "pressVinylSpeed"];
const pre = evalJs(`JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, window.__store?.get(k)])))`);
check("the dev store answers (a dev:app build)", pre && typeof pre === "object" && pre.skin !== undefined, pre);
if (!pre?.skin) process.exit(fails);
const set = (k, v) => evalJs(`(window.__store.set(${JSON.stringify(k)}, ${JSON.stringify(v)}), "set")`);

try {
  // The look for the test (put back below): Press, the schedule held off, the record on Spin.
  set("lookSchedule", "off");
  set("skin", "press");
  set("pressVinyl", "spin");
  await sleep(1500);
  set("pressVinylSpeed", "16");
  set("pressVinylFps", "120");
  cli("play", SONG);
  await sleep(2500);
  const d0 = evalJs(DISC);
  // No sound (on 2026-10-17 the dev app's every play failed with mediaPlaybackError): the disc
  // holds still, rightly, and a hand-run animation is paused again by the row's own sync. Then
  // the angle checks read a still disc: it must not move at all.
  const playing = d0?.state === "running";
  if (!playing) console.log("note: the song did not play; the angle checks read a still disc");
  check("16⅔ rpm and 120 FPS on 240 Hz: 432 steps a turn", /^steps\(4\d\d/.test(d0?.easing ?? ""), d0);

  for (const [fps, want] of [["60", /^steps\(2\d\d/], ["144", /^steps\(4\d\d/], ["240", /^linear$/], ["120", /^steps\(4\d\d/]]) {
    const before = evalJs(DISC);
    set("pressVinylFps", fps);
    await sleep(150);
    const after = evalJs(DISC);
    // 150 ms at 16⅔ rpm is 15°; a jump would be far more than that.
    const turned = ((after?.deg ?? 0) - (before?.deg ?? 0) + 360) % 360;
    const steady = playing ? turned > 0 && turned < 40 && after?.state === "running" : turned === 0;
    check(`Spin FPS ${fps} on 240 Hz → ${want.source}, the disc does not jump`, want.test(after?.easing ?? "") && steady, { easing: after?.easing, turned, state: after?.state });
  }

  set("pressVinylSpeed", "78");
  await sleep(400);
  const d78 = evalJs(DISC);
  check("speed 78 at 120 FPS: the steps follow the shorter turn (about 92)", /^steps\((8\d|9\d|10\d)\)/.test(d78?.easing ?? ""), d78);
} finally {
  for (const k of [...KEYS].reverse()) if (pre[k] !== undefined) set(k, pre[k]);
  try {
    cli("pause");
  } catch {
    /* already paused */
  }
}
process.exit(fails);

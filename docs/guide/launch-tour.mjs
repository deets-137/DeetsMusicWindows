// The launch tour, end to end (his ask, 2026-10-21; SHOTS.md §5k): load the songs into the dev
// app, record docs/guide/launch-tour.json on it, and cut the take into the MP4 and GIF.
//
//   node docs/guide/launch-tour.mjs [--edit-only] [--keep-dark]
//
// The songs are launch-tour-songs.json; after a change there, launch-tour-rules.cjs rewrites the
// shot's rules and steps (this script runs it first).
//
// Before it: the dev app is up (npm run dev:app), on screen, and no other session drives it or
// saves under src/ or src-tauri/ (SHOTS.md §5i › One driver). The shot sets its own look, layout,
// rules and settings and puts each back after.
//
// The cut: from 1 s before the first click; the Midi part (to the step that picks Max) centered
// on the Max canvas; the near-black frames of each look change's launch cover removed (the cover
// fade stays, the opaque hold goes: features/fullscreen-player.md §15); the end 5 s after Start a
// Web. --keep-dark keeps the hold. --edit-only cuts the last take again without recording.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const MIDI = { w: 496, h: 670 }; // the Midi window (shots.mjs SIZES: 495 × 670), padded even
const SETTLE = Number(opt("--settle") ?? 0.6);

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed (${r.status})`);
};

if (!args.includes("--edit-only")) {
  run(process.execPath, [join(root, "docs/guide/launch-tour-rules.cjs")]);
  run(process.execPath, [join(root, "docs/guide/launch-tour-queue.mjs")]);
  run(process.execPath, [join(root, "scripts/shots.mjs"), "--list", "docs/guide/launch-tour.json"]);
}

// The take: the newest version folder that has it.
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const dir = join(root, "shots", "launch-tour", version);
const base = join(dir, "launch-tour.black-yellow-press");
if (!existsSync(`${base}.mp4`)) throw new Error(`no take at ${base}.mp4`);
const marks = JSON.parse(readFileSync(`${base}.frames.json`, "utf8")).marks;
const at = (pred) => {
  const m = marks.find(pred);
  if (!m) throw new Error("a step the cut needs is missing from the take");
  return m.t / 1000;
};
const start = Math.max(0, at((m) => m.step === "click") - 1.0);
const midiEnd = at((m) => m.step === "eval" && /__surface\.set\('max'\)/.test(m.what));
const maxStart = midiEnd + 0.35; // the window's resize frames
const end = at((m) => m.step === "click" && /data-shot/.test(m.what)) + 5.0;

// The opaque hold of each look change: near-black spans (only the guide's sprites on them).
let dark = [];
if (!args.includes("--keep-dark")) {
  const log = spawnSync("ffmpeg", ["-v", "info", "-ss", String(maxStart), "-to", String(end), "-i", `${base}.mp4`, "-vf", "blackdetect=d=0.05:pix_th=0.10", "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  dark = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [maxStart + Number(m[1]), maxStart + Number(m[2])]);
  // A look change right after a press: cut from just after the press. Between the two, the new
  // song's cover shows in the OLD skin and the layout snaps (take 6, 2026-10-21: La Source in
  // Glass with half-empty cards), then the cover fades in.
  const clicks = marks.filter((m) => m.step === "click").map((m) => m.t / 1000);
  dark = dark.map(([a, b]) => {
    const press = clicks.filter((t) => t < a && a - t < 1.5).at(-1);
    // and land on the new look once its cards have risen, not on the dim half-built lift
    // (review 1, 2026-10-21: Ocean was dim for ~1.3 s after the cut). --settle <s>, default 0.6.
    return [press !== undefined ? press + 0.2 : a, b + SETTLE];
  });
}
const parts = [];
let from = maxStart;
for (const [a, b] of dark) {
  if (a > from) parts.push([from, a]);
  from = Math.max(from, b);
}
if (end > from) parts.push([from, end]);

// The right-click menu zoomed 2× (review 1: "Start a Web" could not be read at feed size): from
// just before the right-click to just after the menu's press, a 540 × 475 box on the menu.
const rc = marks.find((m) => m.step === "rightclick" && m.region);
const zoom = rc ? { a: rc.t / 1000 - 0.3, b: at((m) => m.step === "click" && /data-shot/.test(m.what)) + 0.6 } : null;
const segs = []; // [from, to, zoomed]
for (const [a, b] of parts) {
  if (!zoom || zoom.b <= a || zoom.a >= b) { segs.push([a, b, false]); continue; }
  if (zoom.a > a) segs.push([a, zoom.a, false]);
  segs.push([Math.max(a, zoom.a), Math.min(b, zoom.b), true]);
  if (zoom.b < b) segs.push([zoom.b, b, false]);
}
// The menu opens beside the pointer, which pressed the card's song meta; the box sits so the
// meta is in its left third and the menu's rows fall inside it.
const r = rc?.region;
const zx = r ? Math.round(Math.max(0, Math.min(1080 - 540, r.x + r.w * 0.5 - 180))) : 0;
const zy = r ? Math.round(Math.max(0, Math.min(950 - 475, r.y + r.h * 0.45 - 140))) : 0;

const padX = Math.round((1080 - MIDI.w) / 2), padY = Math.round((950 - MIDI.h) / 2);
let graph = `[0:v]trim=${start}:${midiEnd},setpts=PTS-STARTPTS,crop=${MIDI.w}:${MIDI.h}:0:0,pad=1080:950:${padX}:${padY}:color=0x16161a[m];`;
segs.forEach(([a, b, z], i) => (graph += `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS${z ? `,crop=540:475:${zx}:${zy},scale=1080:950:flags=lanczos` : ""}[p${i}];`));
graph += `[m]${segs.map((_, i) => `[p${i}]`).join("")}concat=n=${segs.length + 1}:v=1:a=0,fps=30[v]`;

const out = join(dir, "launch-tour");
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `${base}.mp4`, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${out}.mp4`]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `${out}.mp4`, "-vf", "fps=15,scale=720:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=192:stats_mode=diff[p];[y][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle", `${out}.gif`]);
copyFileSync(`${base}.mp4`, join(dir, `take-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.mp4`));
console.log(`[launch-tour] cut ${parts.length + 1} parts, ${dark.length} dark holds removed → ${out}.mp4 and .gif`);

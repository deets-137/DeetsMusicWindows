// `npm run errors:where -- <version> <place>` — the source line behind an error fingerprint's place
// (USAGE-COUNTS.md §16). The admin page's Health tab › Error kinds shows a place in a minified
// chunk, `main.js:2:4439`; this reads it through that version's hidden source map, which the
// release build left in installers/maps/<version>/ (vite.config.ts releaseMapsPlugin).
//
//   npm run errors:where -- 1.2.2 main.js:2:4439
//   npm run errors:where -- 1.2.2 "main.js:2:4439 ← musickit.js:28:6351"   (the part before ← is read)
//
// A place in musickit.js is Apple's code: there is no map for it, and the line says so.
//
// A weekly report goes out under the version running when it is sent, but its counts can come from
// the version before an update that week. A place that lands on no error line: try that version.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decodeMappings, lookup } from "../src/source-map-lite.ts";

const [version, ...rest] = process.argv.slice(2);
const place = rest.join(" ").split("←")[0].split("<")[0].trim();
const m = /^(.+?)\.(m?js):(\d+):(\d+)$/.exec(place);
if (!version || !m) {
  console.error("usage: npm run errors:where -- <version> <file.js:line:col>");
  process.exit(2);
}
const [, name, ext, line, col] = m;
if (name === "musickit") {
  console.log(`${place} is in MusicKit (Apple's script): no source map. Look at our frame before it.`);
  process.exit(0);
}
const dir = join(import.meta.dirname, "..", "installers", "maps", version, "assets");
if (!existsSync(dir)) {
  console.error(`No maps for ${version} in ${dir}. A release built before 2026-10-30 kept none.`);
  process.exit(1);
}
// The fingerprint drops the build hash, so `main.js` is `main-<hash>.js.map`.
const hit = readdirSync(dir).filter((f) => f === `${name}.${ext}.map` || (f.startsWith(`${name}-`) && f.endsWith(`.${ext}.map`) && f.length === name.length + 1 + 8 + ext.length + 5));
if (!hit.length) {
  console.error(`No map for ${name}.${ext} in ${dir}`);
  process.exit(1);
}
// Every `vite build` while package.json holds this version adds a map (1.4.1 had five, 1.3.1
// twenty-three). The one that shipped is the last one built before the installer was made.
let shipped = hit;
if (hit.length > 1) {
  const installer = join(import.meta.dirname, "..", "installers", `DeetsMusic_${version}_x64-setup.exe`);
  if (!existsSync(installer)) {
    console.error(`${hit.length} maps for ${name}.${ext} and no ${installer} to choose by: ${hit.join(", ")}`);
    process.exit(1);
  }
  const made = statSync(installer).mtimeMs;
  const before = hit.map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs })).filter((m) => m.at <= made);
  if (!before.length) {
    console.error(`None of the ${hit.length} maps for ${name}.${ext} is older than the installer: ${hit.join(", ")}`);
    process.exit(1);
  }
  shipped = [before.sort((a, b) => b.at - a.at)[0].f];
  console.log(`(${shipped[0]}: the last of ${hit.length} builds before the installer)`);
}
const map = JSON.parse(readFileSync(join(dir, shipped[0]), "utf8"));
const at = lookup(decodeMappings(map.mappings), Number(line), Number(col));
if (!at) {
  console.error(`${place}: no source at that place in ${hit[0]}`);
  process.exit(1);
}
const src = String(map.sources[at.src] ?? "?").replace(/^(\.\.\/)+/, "");
console.log(`${place} (v${version}) → ${src}:${at.line}`);
const text = map.sourcesContent?.[at.src]?.split("\n");
if (text) {
  for (let k = Math.max(1, at.line - 2); k <= Math.min(text.length, at.line + 2); k++) {
    console.log(`${k === at.line ? ">" : " "} ${String(k).padStart(5)}  ${text[k - 1]}`);
  }
}

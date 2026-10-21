// `npm run happy:art` — copies the Happy skin's drawings into the bundle (docs/features/happy.md §5).
//
// The drawing workspace is art-template/happy/ (blank strips, guides, drafts). The app bundles
// src/assets/skins/happy/. This copies every strip (not the `.guide.png` and `.preview.png`
// helpers) from the workspace, plus the two poses that already ship for the first-run walk
// (Happy's walk and Deets standing), so the skin's folder holds all of its own art, as a mod's
// would. Run it after a strip is redrawn. It prints what changed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FROM = join(ROOT, "art-template/happy");
const TO = join(ROOT, "src/assets/skins/happy");
const EXTRA = [
  ["src/assets/sprites/happy/walk_side.png", "happy/walk_side.png"],
  ["src/assets/sprites/deets/idle_down.png", "deets/idle_down.png"],
];

let changed = 0;
const copy = (src, rel) => {
  const dst = join(TO, rel);
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst) && readFileSync(dst).equals(readFileSync(src))) return;
  copyFileSync(src, dst);
  console.log(`[happy-art] ${rel}`);
  changed++;
};
for (const dir of ["happy", "deets", "scene"]) {
  for (const f of readdirSync(join(FROM, dir))) {
    if (!f.endsWith(".png") || f.endsWith(".guide.png") || f.endsWith(".preview.png")) continue;
    copy(join(FROM, dir, f), `${dir}/${f}`);
  }
}
for (const [src, rel] of EXTRA) copy(join(ROOT, src), rel);
console.log(changed ? `[happy-art] ${changed} file(s) copied` : "[happy-art] up to date");

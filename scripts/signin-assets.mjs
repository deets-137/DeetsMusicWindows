// `npm run signin:assets` — copy the app's look into the DeetsSupport Worker, for the
// hosted sign-in page (docs/DATA-ARCHITECTURE.md §2a fork 2). The page at
// music-api.deets.solutions/signin links the same token sheets and fonts the app uses,
// so it matches the app pixel for pixel — but only as of the last copy. Run this before
// every Worker deploy that follows a theme, skin, palette or font change (RELEASE.md §1).
//
// Source → ../DeetsSupport/src/signin/:
//   src/styles/{palette,themes,skin,fonts}.css   →  <same names>
//   src/styles/fonts/*                            →  fonts/*   (the faces + NOTICE.txt)
//   app-icon.png                                  →  icon.png  (Apple's Access Request icon)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "..", "DeetsSupport");
const dest = join(worker, "src", "signin");
if (!existsSync(join(worker, "wrangler.jsonc"))) {
  console.error(`[signin-assets] ../DeetsSupport not found next to this repo (${worker}); nothing copied`);
  process.exit(1);
}
mkdirSync(join(dest, "fonts"), { recursive: true });

let changed = 0;
let kept = 0;
const same = (a, b) => existsSync(b) && statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
const copy = (from, to) => {
  if (same(from, to)) return kept++;
  copyFileSync(from, to);
  changed++;
};

for (const name of ["palette.css", "themes.css", "skin.css", "fonts.css"]) copy(join(root, "src", "styles", name), join(dest, name));
for (const name of readdirSync(join(root, "src", "styles", "fonts"))) copy(join(root, "src", "styles", "fonts", name), join(dest, "fonts", name));
copy(join(root, "app-icon.png"), join(dest, "icon.png"));
writeFileSync(
  join(dest, "GENERATED.txt"),
  "Copied from DeetsMusic by scripts/signin-assets.mjs (npm run signin:assets). Do not edit here.\n",
);
console.log(`[signin-assets] ${changed} file(s) updated, ${kept} unchanged → ${dest}`);

// `node scripts/release-check.mjs` — the release gate (docs/RELEASE.md §1a, "Stranger
// parity"). Runs inside `npm run release`, after `tauri build` and before the archive step,
// and FAILS the release when the built exe could behave differently on the machine that
// built it than on a stranger's PC.
//
// Why (2026-09-13): the installed app on the dev PC read the repo's MusicKit key through a
// compile-time source path, skipped the Worker and its 401 heal, and broke on a key
// rotation — a path no user runs. The fix compiles such paths out of release builds; this
// check makes sure they stay out.
//
// Checks:
//  1. The release exe contains no absolute path into this repo. Build output under
//     `src-tauri\target\` is allowed: generated code carries those paths in panic
//     locations, and they never point at secrets or sources.
//  2. The four version files agree (the archive step checks two; this checks all four).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

// ── 1. No repo paths in the exe ─────────────────────────────────────────────────────
const exe = join(root, "src-tauri", "target", "release", "DeetsMusic.exe");
if (!existsSync(exe)) {
  failures.push(`no release exe at ${exe} (run tauri build first)`);
} else {
  const hay = readFileSync(exe).toString("latin1").toLowerCase();
  const roots = [root, root.replaceAll("\\", "/")].map((s) => s.toLowerCase());
  const hits = new Map();
  for (const r of roots) {
    let at = hay.indexOf(r);
    while (at !== -1) {
      const rest = hay.slice(at + r.length, at + r.length + 120);
      // Allowed: build output (`\src-tauri\target\…`, either slash).
      if (!/^[\\/]src-tauri[\\/]target[\\/]/.test(rest)) {
        const shown = (r + rest).split(/[\x00-\x1f"]/)[0];
        hits.set(shown, (hits.get(shown) ?? 0) + 1);
      }
      at = hay.indexOf(r, at + r.length);
    }
  }
  if (hits.size) {
    failures.push(
      "the release exe contains paths into the repo (a release build must not read the source tree):\n" +
        [...hits].map(([p, n]) => `      ${p}  ×${n}`).join("\n"),
    );
  }
}

// ── 2. Version files agree ──────────────────────────────────────────────────────────
const versions = {
  "package.json": JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  "src-tauri/tauri.conf.json": JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version,
  "src-tauri/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"))?.[1],
  "cli/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, "cli", "Cargo.toml"), "utf8"))?.[1],
};
if (new Set(Object.values(versions)).size !== 1) {
  failures.push("version files disagree:\n" + Object.entries(versions).map(([f, v]) => `      ${f}: ${v}`).join("\n"));
}

if (failures.length) {
  console.error(`[release-check] FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[release-check] ok — no repo paths in the exe; version ${versions["package.json"]} in all four files`);

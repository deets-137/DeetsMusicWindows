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
//  3. The pin and the updater: the product name, exe name and per-user install are unchanged
//     (a pinned taskbar button points at them), the updater public key is set, and the
//     installer has its signature.
//  4. Authenticode: a valid, timestamped publisher signature.
//  5. No dev telemetry in the shipped JS (a stray VITE_PERF would ship a rAF loop).
//  6. docs/TOKENS.md is current.
//  7. The Last.fm API key is built in (LASTFM.md §2).
//  8. The build key is built in (RELEASE.md §7a).
//  9. No synchronous `#[tauri::command]` blocks the UI thread (FRIENDS.md §8.11). Added
//     2026-09-20 after 0.12.0 froze on live: a sync command runs on the thread that paints,
//     and `presence_set` waited on a named pipe there. Checked against that exact file — it
//     names `presence_set` through three levels of helpers.
// 10. The docs checker (DOCS-ORG.md §8): links, mentions, section pointers, front matter,
//     versions, ideas/. Added 2026-09-21. It WARNS until docs-check.mjs GRACE_END (a week,
//     F5), then a failing fact fails the release.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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

// ── 3. The pin and the updater (RELEASE.md §6.8) ──────────────────────────────────────
// A pinned taskbar button points at %LOCALAPPDATA%\DeetsMusic\DeetsMusic.exe. An update keeps
// the pin only while the product name, the exe name and the per-user install stay the same.
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const installMode = conf.bundle?.windows?.nsis?.installMode;
if (conf.productName !== "DeetsMusic" || conf.mainBinaryName !== "DeetsMusic" || installMode !== "currentUser") {
  failures.push(
    `productName / mainBinaryName / installMode changed (${conf.productName} / ${conf.mainBinaryName} / ${installMode}): ` +
      "every pinned taskbar button would break on the update",
  );
}
if (!conf.plugins?.updater?.pubkey) failures.push("plugins.updater.pubkey is empty: no install could verify an update");
const setup = join(root, "src-tauri", "target", "release", "bundle", "nsis", `DeetsMusic_${versions["package.json"]}_x64-setup.exe`);
if (existsSync(setup) && !existsSync(`${setup}.sig`)) {
  failures.push("the installer has no .sig next to it (build with npm run release, which signs it)");
}

// ── 4. Authenticode (RELEASE.md §6.9) ─────────────────────────────────────────────────
// A valid, timestamped signature from the publisher on the files we can read here. The name must
// match bundle.publisher, which the installer shows in Installed apps.
// Not target\release\DeetsMusic.exe: tauri build signs a patched copy for the installer, then
// puts the unsigned original back (seen 2026-09-15, the exe rewritten after the setup exe). The
// installed exe is checked after an install instead (RELEASE.md §6.9).
const signed = [join(root, "cli", "dist", "deetsmusic.exe"), setup].filter((f) => existsSync(f));
if (signed.length) {
  const ps = `$ErrorActionPreference='Stop'; @(${signed.map((f) => `'${f.replaceAll("'", "''")}'`).join(",")}) | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{ file = $_; status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject; stamped = [bool]$s.TimeStamperCertificate } } | ConvertTo-Json -Compress`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" });
  for (const s of [JSON.parse(out)].flat()) {
    const cn = /CN=([^,]+)/.exec(s.subject)?.[1];
    if (s.status !== "Valid" || cn !== conf.bundle.publisher || !s.stamped) {
      failures.push(`${s.file} is not signed by ${conf.bundle.publisher} (status ${s.status}, CN ${cn ?? "none"}, timestamp ${s.stamped})`);
    }
  }
}

// ── 5. No dev telemetry in the shipped bundle ────────────────────────────────
// The dev telemetry (frames.ts, perf.ts, vinyl.ts) must never ship. It is gated on
// `TELEMETRY` (src/telemetry-on.ts), which a VITE_PERF=1 build turns ON so a release-shaped
// bundle can be measured — so a stray VITE_PERF in the release environment would quietly put
// a rAF loop and a log-writing observer into the installed app. Catch it at the bundle.
{
  const assets = join(root, "dist", "assets");
  const js = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith(".js")) : [];
  const leaked = js.filter((f) => readFileSync(join(assets, f), "utf8").includes("[perf] frames"));
  if (!js.length) failures.push("dist/assets has no JS — build before release-check");
  else if (leaked.length) failures.push(`dev telemetry shipped in ${leaked.join(", ")} — VITE_PERF was set for this build`);
}

// ── 6. The token catalog is current ─────────────────────────────────────────
// docs/TOKENS.md is generated from the three token files (scripts/tokens.mjs). A stale copy
// is the kind of doc drift the catalog exists to end, so the gate refuses it.
{
  const { render, TARGET } = await import("./tokens.mjs");
  const want = render();
  const have = existsSync(join(root, TARGET)) ? readFileSync(join(root, TARGET), "utf8").replace(/\r\n/g, "\n") : "";
  if (have !== want) failures.push(`${TARGET} is stale — run npm run tokens and commit it`);
}

// ── 7. Last.fm is in the build (docs/LASTFM.md §2) ───────────────────────────────
// build.rs builds the key in from Deets' Secrets; with no key the build still succeeds and the
// Account row says "Not in this build". The gate refuses to ship that. The key is not printed.
{
  const file = process.env.DEETSMUSIC_LASTFM || join(homedir(), "Documents", "Deets' Secrets", "lastfm.json");
  let key = "";
  try {
    key = String(JSON.parse(readFileSync(file, "utf8")).apiKey ?? "").trim();
  } catch {
    /* reported below */
  }
  if (!key || key.startsWith("PASTE_")) failures.push(`no Last.fm API key in ${file} — fill it in and rebuild (LASTFM.md §2)`);
  else if (existsSync(exe) && !readFileSync(exe).includes(Buffer.from(key))) failures.push("the release exe has no Last.fm API key — rebuild after filling in lastfm.json (LASTFM.md §2)");
}

// ── 8. The build key is in the build (docs/RELEASE.md §7a) ──────────────────────
// build.rs builds it in from Deets' Secrets; without it the app still runs on a local .p8, but a
// public install would be refused by the mint once the worker's check is on. The key is not printed.
{
  const file = process.env.DEETSMUSIC_BUILD_KEY || join(homedir(), "Documents", "Deets' Secrets", "deetsmusic-build-key.txt");
  let key = "";
  try {
    key = readFileSync(file, "utf8").trim();
  } catch {
    /* reported below */
  }
  if (!key) failures.push(`no build key at ${file} — see RELEASE.md §7a`);
  else if (existsSync(exe) && !readFileSync(exe).includes(Buffer.from(key))) failures.push("the release exe has no build key — rebuild with deetsmusic-build-key.txt in place (RELEASE.md §7a)");
}

// ── 9. No synchronous command may block the UI thread (docs/FRIENDS.md §8.11) ────
// A synchronous `#[tauri::command]` runs on the UI thread, because WebView2 delivers the IPC
// message there. Anything in it that waits — a process, a socket, a pipe, a channel, a sleep
// — is a wait the window cannot paint through. That is how 0.12.0 froze: `presence_set` was
// `pub fn`, so its blocking named-pipe write ran on the thread that paints, and Windows
// reported AppHangB1. An `async fn` + `spawn_blocking` is the fix, and the rule was already
// written down in media.rs and airplay.rs — nothing enforced it.
//
// The walk follows calls INSIDE the same file, up to three deep, because the wait is usually
// a helper away (`autostart_get` → `autostart_enabled` → `reg` → Command::new). Bodies handed
// to `spawn`/`spawn_blocking` are skipped: that is precisely the "not on this thread" move.
{
  const srcDir = join(root, "src-tauri", "src");
  // Blank comments and string contents, keeping length so offsets still line up with the raw
  // text. Structure is read from the blanked copy; the patterns are matched on the raw one.
  const blankOut = (s) => {
    const out = s.split("");
    const pad = (a, b) => { for (let i = a; i < b && i < out.length; i++) if (out[i] !== "\n") out[i] = " "; };
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "/" && s[i + 1] === "/") { const e = s.indexOf("\n", i); pad(i, e < 0 ? s.length : e); i = e < 0 ? s.length : e; }
      else if (s[i] === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i); pad(i, e < 0 ? s.length : e + 2); i = e < 0 ? s.length : e + 1; }
      else if (s[i] === '"') { let j = i + 1; while (j < s.length && !(s[j] === '"' && s[j - 1] !== "\\")) j++; pad(i, j + 1); i = j; }
      else if (s[i] === "#" && /r#*"/.test(s.slice(i - 1, i + 3))) { const e = s.indexOf('"#', i); pad(i, e < 0 ? s.length : e + 2); i = e < 0 ? s.length : e + 1; }
    }
    return out.join("");
  };
  const balanced = (s, i, open, close) => {
    let d = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === open) d++;
      else if (s[j] === close && --d === 0) return j;
    }
    return -1;
  };
  const BLOCKERS = [
    [/\bCommand::new\b/, "spawns a process and waits for it"],
    [/\breqwest::blocking\b/, "makes a blocking HTTP call"],
    [/\bthread::sleep\b/, "sleeps"],
    [/\.recv\(\)/, "waits on a channel with no timeout"],
    [/\bTcpStream::connect\b/, "opens a socket"],
    [/\\\\\.\\pipe/, "opens a named pipe"],
    [/\bblock_on\b/, "blocks on a future"],
    [/\bWaitForSingleObject\b/, "waits on a Windows handle"],
    [/\.join\(\)/, "waits for a thread to end"],
  ];
  // Anything listed here is a sync command we have decided is safe. Give the reason: the next
  // reader has to be able to check it. An empty list is the healthy state.
  const ALLOW = new Map();
  const blocking = [];
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".rs"))) {
    const raw = readFileSync(join(srcDir, file), "utf8");
    const code = blankOut(raw);
    const fns = new Map();
    for (const m of code.matchAll(/\bfn\s+([A-Za-z_]\w*)/g)) {
      const p = code.indexOf("(", m.index);
      if (p < 0) continue;
      const pe = balanced(code, p, "(", ")");
      const b = pe < 0 ? -1 : code.indexOf("{", pe);
      const be = b < 0 ? -1 : balanced(code, b, "{", "}");
      if (be > 0) fns.set(m[1], [b, be]);
    }
    // Ranges handed to spawn/spawn_blocking run on another thread — skip them.
    const offThread = [];
    for (const m of code.matchAll(/\bspawn(_blocking)?\s*\(/g)) {
      const e = balanced(code, code.indexOf("(", m.index), "(", ")");
      if (e > 0) offThread.push([m.index, e]);
    }
    const onThisThread = (i) => !offThread.some(([a, b]) => i >= a && i <= b);
    const scan = (name, seen, depth) => {
      const at = fns.get(name);
      if (!at || seen.has(name) || depth > 3) return null;
      seen.add(name);
      const [b, e] = at;
      for (const [re, why] of BLOCKERS) {
        for (const hit of raw.slice(b, e).matchAll(new RegExp(re, "g"))) {
          if (onThisThread(b + hit.index)) return { name, why };
        }
      }
      for (const call of code.slice(b, e).matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
        if (!onThisThread(b + call.index)) continue;
        const deeper = scan(call[1], seen, depth + 1);
        if (deeper) return deeper;
      }
      return null;
    };
    for (const m of code.matchAll(/#\[tauri::command\]/g)) {
      const fnAt = code.indexOf("fn ", m.index);
      if (fnAt < 0) continue;
      if (/\basync\b/.test(code.slice(m.index, fnAt))) continue; // its body is off this thread
      const name = /fn\s+(\w+)/.exec(code.slice(fnAt))?.[1];
      if (!name || ALLOW.has(`${file}:${name}`)) continue;
      const hit = scan(name, new Set(), 0);
      if (hit) blocking.push(`${file}: the sync command \`${name}\` ${hit.name === name ? "" : `reaches \`${hit.name}\`, which `}${hit.why} — make it \`async fn\` + \`tauri::async_runtime::spawn_blocking\` (FRIENDS.md §8.11)`);
    }
  }
  for (const b of blocking) failures.push(b);
}

// ── 10. The docs checker ───────────────────────────────────────────────────────────
let docsNote = "docs check clean";
{
  const { check, report, GRACE_END } = await import("./docs-check.mjs");
  const r = check();
  if (r.facts.length) {
    docsNote = `docs check WARNED (${r.facts.length} facts)`;
    const today = new Date().toISOString().slice(0, 10);
    if (today >= GRACE_END) failures.push(`docs: ${r.facts.length} failing — run npm run docs:check\n${report(r)}`);
    else console.warn(`[release-check] WARNING (fails from ${GRACE_END}): docs have ${r.facts.length} failing facts\n${report(r)}`);
  }
}

if (failures.length) {
  console.error(`[release-check] FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[release-check] ok — no repo paths in the exe; no dev telemetry in the bundle; version ${versions["package.json"]} in all four files; TOKENS.md current; Last.fm key built in; build key built in; no sync command blocks the UI thread; ${docsNote}`);

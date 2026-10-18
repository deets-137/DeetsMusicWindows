// `node scripts/release-check.mjs` — the release gate (docs/ops/RELEASE.md §1a, "Stranger
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
//  2. The four version files agree (the archive step checks two; this checks all four), and
//     the extension manifest matches them (a beta build skips it). Added 2026-09-26.
//  3. The pin and the updater: the product name, exe name and per-user install are unchanged
//     (a pinned taskbar button points at them), the updater public key is set, and the
//     installer has its signature.
//  4. Authenticode: a valid, timestamped publisher signature.
//  5. No dev telemetry in the shipped JS (a stray VITE_PERF would ship a rAF loop).
//  6. docs/architecture/TOKENS.md is current.
//  7. The Last.fm API key is built in (LASTFM.md §2).
//  8. The build key is built in (RELEASE.md §7a).
//  9. No synchronous `#[tauri::command]` blocks the UI thread (FRIENDS.md §8.11). Added
//     2026-09-20 after 0.12.0 froze on live: a sync command runs on the thread that paints,
//     and `presence_set` waited on a named pipe there. Checked against that exact file — it
//     names `presence_set` through three levels of helpers.
// 10. The docs checker (DOCS-ORG.md §8): links, mentions, section pointers, front matter,
//     versions, ideas/. Added 2026-09-21. It WARNS until docs-check.mjs GRACE_END (a week,
//     F5), then a failing fact fails the release.
// 11. The app stops processes by PATH inside its own folder, never by name (RELEASE.md §4a).
//     Added 2026-09-23: Tauri's NSIS close matched `DeetsMusic.exe` without case, so it also
//     closed the dev build and every `deetsmusic` CLI, the MCP servers of open AI apps included.
//     Since Velopack (2026-10-15) the stop is velo.rs's `stop_clis`.
// 12. Package identity (IDENTITY.md): the package's publisher is the signing subject, its logos
//     and resources.pri ship, the exe carries the <msix> element. Added 2026-10-16.
// Checks 3, 4 and 11 read Velopack's output since 2026-10-15 (docs/ops/VELOPACK.md).
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
// `--beta` checks DeetsMusic Beta's build (docs/ops/BETA.md): its own exe, installer, CLI and names.
const BETA = process.argv.includes("--beta");
const betaConf = BETA ? JSON.parse(readFileSync(join(root, "src-tauri", "tauri.beta.conf.json"), "utf8")) : {};
const EXE_NAME = BETA ? betaConf.mainBinaryName : "DeetsMusic";
const PRODUCT = BETA ? betaConf.productName : "DeetsMusic";

// ── 1. No repo paths in the exe ─────────────────────────────────────────────────────
const exe = join(root, "src-tauri", "target", "release", `${EXE_NAME}.exe`);
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
// The browser extension reports its manifest's version (0.11.0 shipped it stale, on 0.10.1).
// Checked here as a hard fail, not only by the docs checker's check 5, which warns until its
// grace ends. A beta version (0.14.0-beta.1) cannot go in a manifest (Chrome takes numbers and
// dots only), so a beta build leaves it on the last full version and skips it.
const manifestVersion = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8")).version;
if (!/-beta\.\d+$/.test(versions["package.json"]) && manifestVersion !== versions["package.json"]) {
  failures.push(`extension/manifest.json is version ${manifestVersion} — package.json says ${versions["package.json"]}`);
}
if (new Set(Object.values(versions)).size !== 1) {
  failures.push("version files disagree:\n" + Object.entries(versions).map(([f, v]) => `      ${f}: ${v}`).join("\n"));
}

// ── 3. The pin and the updater (VELOPACK.md §3, §4) ───────────────────────────────────
// A pinned taskbar button points at %LOCALAPPDATA%\<packId>\current\<exe>. An update keeps the
// pin only while the product name (the packId comes from it) and the exe name stay the same.
// The beta's are fixed the same way ("DeetsMusic Beta" / DeetsMusicBeta, BETA.md §3).
// The feed must be signed, and the app must carry the key that checks it.
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const product = BETA ? betaConf.productName : conf.productName;
const binary = BETA ? betaConf.mainBinaryName : conf.mainBinaryName;
const [wantProduct, wantBinary] = BETA ? ["DeetsMusic Beta", "DeetsMusicBeta"] : ["DeetsMusic", "DeetsMusic"];
if (product !== wantProduct || binary !== wantBinary) {
  failures.push(`productName / mainBinaryName changed (${product} / ${binary}): every pinned taskbar button would break on the update`);
}
const velo = readFileSync(join(root, "src-tauri", "src", "velo.rs"), "utf8");
if (!/pub const PUBKEY: &str = "[A-Za-z0-9+/=]{40,}";/.test(velo)) failures.push("velo.rs has no PUBKEY: no install could verify an update");
const CHANNEL = BETA ? "deetsmusic-test" : process.env.DEETSMUSIC_UPDATE_CHANNEL || "deetsmusic";
const PACK = PRODUCT.replace(/\s+/g, "");
const vpOut = join(root, "installers", "velopack", `${PACK}-${CHANNEL}`);
const setup = join(vpOut, `${PACK}-${CHANNEL}-Setup.exe`);
const feedFile = join(vpOut, `releases.${CHANNEL}.json`);
if (!existsSync(setup)) failures.push(`no Setup.exe at ${setup} (vpk pack did not run)`);
if (!existsSync(feedFile) || !existsSync(`${feedFile}.sig`)) {
  failures.push(`the feed or its .sig is missing in ${vpOut} (build with npm run release, which signs it)`);
} else {
  const assets = JSON.parse(readFileSync(feedFile, "utf8")).Assets ?? [];
  if (!assets.some((a) => a.Version === versions["package.json"] && a.Type === "Full")) {
    failures.push(`the feed has no full package for ${versions["package.json"]}`);
  }
  if (assets.some((a) => !a.SHA256)) failures.push("a feed entry has no SHA-256: every install would refuse the feed (velo.rs check_feed)");
}

// ── 4. Authenticode (RELEASE.md §6.9) ─────────────────────────────────────────────────
// A valid, timestamped signature from the publisher on the files we can read here. The name must
// match bundle.publisher, which Velopack shows in Installed apps (--packAuthors). vpk signs COPIES,
// not the stage folder (found 2026-10-15), so the app exe and Squirrel.exe (installed as
// Update.exe) are read out of this version's full package.
const fullPkg = join(vpOut, `${PACK}-${versions["package.json"]}-${CHANNEL}-full.nupkg`);
// The identity package rides in the same check (check 12 reads its subject).
const pkgExes = existsSync(fullPkg) ? [`lib/app/${EXE_NAME}.exe`, "lib/app/Squirrel.exe", "lib/app/DeetsMusic.identity.msix"] : [];
const signers = {};
const signed = [join(root, "cli", "dist", BETA ? "deetsmusic-beta.exe" : "deetsmusic.exe"), setup].filter((f) => existsSync(f));
if (signed.length) {
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const fromPkg = pkgExes.length
    ? `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead(${q(fullPkg)}); $files = @(); foreach ($n in @(${pkgExes.map(q).join(",")})) { $e = $z.Entries | Where-Object { $_.FullName -eq $n }; if (-not $e) { throw "the package has no $n" }; $t = Join-Path $env:TEMP ('release-check-' + [IO.Path]::GetFileName($n)); [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $true); $files += $t }; $z.Dispose(); `
    : "$files = @(); ";
  const ps = `$ErrorActionPreference='Stop'; ${fromPkg}@(${signed.map(q).join(",")}) + $files | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{ file = $_; status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject; stamped = [bool]$s.TimeStamperCertificate } } | ConvertTo-Json -Compress`;
  if (!pkgExes.length) failures.push(`no full package at ${fullPkg}: the app exe inside it is not checked`);
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" });
  for (const s of [JSON.parse(out)].flat()) {
    signers[s.file.split(/[\\/]/).pop().replace(/^release-check-/, "")] = s.subject;
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
  // `__marks`: the shots runner's timeline marks (src/marks.ts), on the same gate.
  // `page:sample`: the page sample and its timer wrapper (src/page-sample.ts, 2026-10-17).
  // `__ipcTiming`: the command recorder (src/ipc-timing.ts, guide/LOADING-SET.md §3.1, 2026-10-17).
  const leaked = js.filter((f) => /\[perf\] frames|__marks|page:sample|__ipcTiming/.test(readFileSync(join(assets, f), "utf8")));
  if (!js.length) failures.push("dist/assets has no JS — build before release-check");
  else if (leaked.length) failures.push(`dev telemetry shipped in ${leaked.join(", ")} — VITE_PERF was set for this build`);
}

// ── 6. The token catalog is current ─────────────────────────────────────────
// docs/architecture/TOKENS.md is generated from the three token files (scripts/tokens.mjs). A stale copy
// is the kind of doc drift the catalog exists to end, so the gate refuses it.
{
  const { render, TARGET } = await import("./tokens.mjs");
  const want = render();
  const have = existsSync(join(root, TARGET)) ? readFileSync(join(root, TARGET), "utf8").replace(/\r\n/g, "\n") : "";
  if (have !== want) failures.push(`${TARGET} is stale — run npm run tokens and commit it`);
}

// ── 7. Last.fm is in the build (docs/integrations/LASTFM.md §2) ───────────────────────────────
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

// ── 8. The build key is in the build (docs/ops/RELEASE.md §7a) ──────────────────────
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

// ── 9. No synchronous command may block the UI thread (docs/integrations/FRIENDS.md §8.11) ────
// A synchronous `#[tauri::command]` runs on the UI thread, because WebView2 delivers the IPC
// message there. Anything in it that waits — a process, a socket, a pipe, a channel, a sleep
// — is a wait the window cannot paint through. That is how 0.12.0 froze: `presence_set` was
// `pub fn`, so its blocking named-pipe write ran on the thread that paints, and Windows
// reported AppHangB1. An `async fn` + `spawn_blocking` is the fix, and the rule was already
// written down in media.rs and airplay.rs — nothing enforced it.
//
// The walk follows calls up to three deep, into other modules too, because the wait is usually
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
    // The library sync and the playlist refresh hold this lock for whole write batches, so a
    // click that needs it waits for them (added 2026-09-25, the consistency read). The fix is
    // not `spawn_blocking` but `crate::db_thread::run`, which keeps the calls in order.
    [/\bdb\.lock\(\)/, "takes the database lock, which a sync can hold for seconds (use `crate::db_thread::run`)"],
    // A file write or delete waits on the disk and on antivirus (added 2026-10-11: sixteen
    // setters wrote settings.json on the UI thread, settings.rs; twelve friends, report and
    // outlet commands the same day).
    [/\bfs::(write|remove_file|rename|copy)\b|\bwrite_atomic\b|\bFile::create\b/, "writes or deletes a file"],
    // A send on the AirPlay session waits on the speaker, and on a lost speaker for its
    // timeouts (added 2026-10-13: `np_publish` froze the window 6 s in a LAN drop).
    [/\.session\.(set_metadata|set_progress|set_artwork|set_volume|disconnect)\s*\(/, "sends to the AirPlay speaker over the network"],
  ];
  // Anything listed here is a sync command we have decided is safe. Give the reason: the next
  // reader has to be able to check it. An empty list is the healthy state.
  const ALLOW = new Map([
    // The log appends to a handle that is already open (a rename only once per rotation), and
    // its lines must keep their order: an async command could land them out of order, and
    // diag_flush runs on `beforeunload`, where an async call may never finish (2026-10-11).
    ["log.rs:log_event", "appends to the open log file; order matters"],
    ["log.rs:diag_flush", "appends to the open log file; runs on beforeunload"],
    // The helper every `crate::log::*` line goes through, reached once the walk crossed files
    // (2026-10-13). The same append as log_event; it renames only once per rotation.
    ["log.rs:append", "appends to the open log file; every log line goes through it"],
  ]);
  const blocking = [];
  const soft = [];
  // Every file first, so a call can be followed into another module (added 2026-10-13:
  // `bridge::np_publish` reached `crate::airplay::on_np_state`, and the walk stopped at the
  // file edge). Recursive: the commands in src/sotd/ went unread until 2026-09-29.
  const files = new Map(); // "sotd/mod.rs" → { raw, code, fns, onThisThread }
  const modules = new Map(); // "sotd" / "sotd::x" → file
  for (const f of readdirSync(srcDir, { recursive: true }).filter((f) => String(f).endsWith(".rs"))) {
    const file = String(f).replaceAll("\\", "/");
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
    files.set(file, { raw, code, fns, onThisThread });
    modules.set(file.replace(/\.rs$/, "").replace(/\/mod$/, "").replaceAll("/", "::"), file);
  }
  // `crate::airplay::x(` and `airplay::x(` go to airplay.rs; a path that names no module of
  // ours (`Settings::get(`, `Command::new(`) is looked up in the same file, as before.
  const resolve = (file, path) => {
    const segs = path.split("::").filter((s) => s && s !== "crate" && s !== "self");
    if (!segs.length) return file;
    return modules.get(segs.join("::")) ?? modules.get(segs[segs.length - 1]) ?? file;
  };
  const scan = (file, name, seen, depth) => {
    const f = files.get(file);
    const at = f?.fns.get(name);
    const key = `${file}:${name}`;
    if (!at || seen.has(key) || ALLOW.has(key) || depth > 3) return null;
    seen.add(key);
    const [b, e] = at;
    // A hard hit wins over a soft one, so a warning never hides a failure.
    let softHit = null;
    for (const [re, why, opts] of BLOCKERS) {
      for (const hit of f.raw.slice(b, e).matchAll(new RegExp(re, "g"))) {
        if (!f.onThisThread(b + hit.index)) continue;
        if (!opts?.soft) return { name: key, why, soft: false };
        softHit ??= { name: key, why, soft: true };
      }
    }
    for (const call of f.code.slice(b, e).matchAll(/\b((?:\w+::)*)([A-Za-z_]\w*)\s*\(/g)) {
      if (!f.onThisThread(b + call.index)) continue;
      const deeper = scan(resolve(file, call[1]), call[2], seen, depth + 1);
      if (deeper && !deeper.soft) return deeper;
      softHit ??= deeper;
    }
    return softHit;
  };
  for (const [file, { code }] of files) {
    for (const m of code.matchAll(/#\[tauri::command\]/g)) {
      const fnAt = code.indexOf("fn ", m.index);
      if (fnAt < 0) continue;
      if (/\basync\b/.test(code.slice(m.index, fnAt))) continue; // its body is off this thread
      const name = /fn\s+(\w+)/.exec(code.slice(fnAt))?.[1];
      if (!name || ALLOW.has(`${file}:${name}`)) continue;
      const hit = scan(file, name, new Set(), 0);
      if (!hit) continue;
      const line = `${file}: the sync command \`${name}\` ${hit.name === `${file}:${name}` ? "" : `reaches \`${hit.name}\`, which `}${hit.why} — make it \`async fn\` + \`tauri::async_runtime::spawn_blocking\` (FRIENDS.md §8.11)`;
      (hit.soft ? soft : blocking).push(line);
    }
  }
  for (const b of blocking) failures.push(b);
  if (soft.length) console.warn(`[release-check] WARNING: ${soft.length} sync commands wait on the UI thread — the database lock or a file write (check 9, soft):\n  ${soft.join("\n  ")}`);
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

// ── 11. The app stops processes by PATH only (RELEASE.md §4a) ─────────────────────────
// velo.rs's `stop_clis` (before an update and an uninstall) matches the full exe path under the
// install's own cli\ folder. A match by name would also close the dev build and the other app's
// CLI, the MCP servers of open AI apps included (the 2026-09-23 NSIS bug).
{
  const body = /pub fn stop_clis\(\)[\s\S]*?\n}\n/.exec(velo)?.[0] ?? "";
  if (!body) failures.push("velo.rs has no stop_clis: the CLIs would hold the files an update replaces");
  else if (!/starts_with\(&prefix\)/.test(body) || /file_name|szExeFile|taskkill/i.test(body)) {
    failures.push("velo.rs stop_clis no longer matches by the full path under cli\\ (RELEASE.md §4a)");
  }
}

// ── 12. Package identity (docs/ops/IDENTITY.md §3.1, §3.8) ──────────────────────────────
// The identity package's Publisher must equal the signing subject EXACTLY: a different one is a
// different package family, so a different app ID, so every pin and the Start entry split again.
// The package must ship its logos and resources.pri at the root of current\ (without the index
// the shell draws a plated icon), and the exe must carry the <msix> element that ties it to them.
{
  const id = JSON.parse(readFileSync(join(root, "src-tauri", "identity", "identity.json"), "utf8"));
  const flavor = id.flavors[BETA ? "beta" : "live"];
  const subject = signers["DeetsMusic.identity.msix"];
  if (!subject) failures.push("the package has no signed DeetsMusic.identity.msix (scripts/identity-pack.mjs)");
  else if (subject !== id.publisher) failures.push(`identity.json publisher "${id.publisher}" is not the signing subject "${subject}" (IDENTITY.md §5)`);
  if (existsSync(fullPkg)) {
    const names = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${fullPkg.replaceAll("'", "''")}'); $z.Entries.FullName; $z.Dispose()`],
      { encoding: "utf8" },
    ).split(/\r?\n/);
    for (const want of ["lib/app/resources.pri", "lib/app/Assets/Square44x44Logo.targetsize-24_altform-unplated.png"]) {
      if (!names.includes(want)) failures.push(`the package has no ${want} (scripts/identity-pack.mjs)`);
    }
  }
  const exeText = existsSync(exe) ? readFileSync(exe).toString("latin1") : "";
  if (!exeText.includes("urn:schemas-microsoft-com:msix.v1") || !exeText.includes(`packageName="${flavor.name}"`)) {
    failures.push(`${EXE_NAME}.exe has no <msix> element for ${flavor.name} (build.rs identity_manifest)`);
  }
}

if (failures.length) {
  console.error(`[release-check] FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[release-check] ok — no repo paths in the exe; no dev telemetry in the bundle; version ${versions["package.json"]} in all four files and the extension; TOKENS.md current; Last.fm key built in; build key built in; no sync command blocks the UI thread; the feed is signed; the app stops processes by path only; the identity package matches its signer; ${docsNote}`);

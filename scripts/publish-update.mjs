// `npm run release:publish` — put the packed version on an update channel
// (docs/ops/RELEASE.md §6.7, docs/ops/VELOPACK.md §5.4). Publishing is what makes installs update:
// run it only after the installed build passed its checks.
//
//   npm run release:publish                              package.json's version → "deetsmusic"
//   npm run release:publish -- --channel deetsmusic-test  a test build (§6.8)
//   npm run release:publish -- --beta                    DeetsMusic Beta (BETA.md §4) → deetsmusic-test
//   npm run release:publish -- --replace                 overwrite an entry already in the index
//   npm run release:publish -- --withdraw 0.5.1          hide a release; the Worker stops offering it
//   npm run release:publish -- --withdraw 0.5.1 --reason "…"   …and say why, on the website
//   npm run release:publish -- --notes-only 0.5.1        refresh one row's notes, no re-upload
//   npm run release:publish -- --history                 notes-only rows for versions the index lacks
//
// The website lists every row (DeetsSupport /update/<channel>/releases, RELEASE.md §6.2):
// withdrawn releases keep their notes, and `history` rows (versions from before the updater,
// with no installer or .sig) carry notes and a date only. The updater never sees either.
//
// Velopack (since 0.28, VELOPACK.md §5.4). From installers/velopack/<Id>-<channel>/ to R2
// (deetsmusic-releases/<channel>/vp/), in this order, so an install never reads a feed that
// names a package not yet uploaded:
//   1. the version's full package and its delta (when there is one);
//   2. Setup.exe as <Id>-<version>-Setup.exe (the website's download for that version);
//   3. rollback/<version>/releases.<channel>.json + .sig: a feed with only this version's full
//      package, the target of a rollback to it (§6.5);
//   4. releases.<channel>.json + .sig: the feed every install reads, without withdrawn versions.
// Every feed is signed here with the updater key (the password from Credential Manager,
// DeetsMusicUpdaterKey); every install checks it (velo.rs). Then <channel>/index.json gets
// { version, group, notes, pub_date, size, file, setup, setup_size, velopack: true } for the website and the
// rollback list. `group` is package.json `deetsmusic.updateGroup` (§6.5); `notes` is the version's
// entry in docs/ops/RELEASE-NOTES.md, up to its first subsection. Wrangler runs from
// ../DeetsSupport, whose account owns the bucket. The rows before 0.28 (NSIS installers) stay as
// they are, for the website's history.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPORT = join(root, "..", "DeetsSupport");
const BUCKET = "deetsmusic-releases";
const CHANNELS = new Set(["deetsmusic", "deetsmusic-test"]);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? "");
};
const BETA = argv.includes("--beta");
if (BETA && flag("--channel") && flag("--channel") !== "deetsmusic-test") die("--beta publishes to deetsmusic-test only");
const channel = BETA ? "deetsmusic-test" : flag("--channel") ?? "deetsmusic";
const withdraw = flag("--withdraw");
const reason = flag("--reason");
const notesOnly = flag("--notes-only");
const history = argv.includes("--history");
const replace = argv.includes("--replace");

function die(msg) {
  console.error(`[publish] ${msg}`);
  process.exit(1);
}
if (!CHANNELS.has(channel)) die(`unknown channel "${channel}" (${[...CHANNELS].join(", ")})`);
if (!existsSync(join(SUPPORT, "wrangler.jsonc"))) die(`no DeetsSupport checkout at ${SUPPORT}`);

const quote = (s) => (/[\s"'&()^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
function wrangler(args, capture = false) {
  return spawnSync(`npx wrangler ${args.map(quote).join(" ")}`, {
    cwd: SUPPORT,
    shell: true,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function readIndex() {
  const r = wrangler(["r2", "object", "get", `${BUCKET}/${channel}/index.json`, "--remote", "--pipe"], true);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status === 0) {
    try {
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
      return { releases: Array.isArray(j.releases) ? j.releases : [] };
    } catch {
      die(`${channel}/index.json is not JSON; fix it by hand before publishing`);
    }
  }
  if (/not.?found|does not exist|NoSuchKey|10007/i.test(out)) return { releases: [] };
  die(`could not read ${channel}/index.json:\n${out}`);
}

function writeIndex(index) {
  const tmp = join(tmpdir(), `deetsmusic-index-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify(index, null, 2));
  try {
    const r = wrangler(["r2", "object", "put", `${BUCKET}/${channel}/index.json`, "--file", tmp, "--content-type", "application/json", "--remote"]);
    if (r.status !== 0) die("index upload failed");
  } finally {
    unlinkSync(tmp);
  }
}

function releaseNotes(version) {
  const md = readFileSync(join(root, "docs", "ops", "RELEASE-NOTES.md"), "utf8").replace(/\r\n/g, "\n");
  const start = md.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
  if (start === -1) return "";
  const body = md.slice(start).split("\n").slice(1).join("\n");
  const end = body.search(/^#{2,3} /m); // the next version, or "### Installing"
  return (end === -1 ? body : body.slice(0, end)).trim();
}

// ── Velopack (VELOPACK.md §5.4) ──
const PACK = BETA ? "DeetsMusicBeta" : "DeetsMusic";
const OUT = join(root, "installers", "velopack", `${PACK}-${channel}`);
const FEED = `releases.${channel}.json`;

function put(key, file, type) {
  const r = wrangler(["r2", "object", "put", `${BUCKET}/${channel}/vp/${key}`, "--file", file, "--content-type", type, "--remote"]);
  if (r.status !== 0) die(`upload of ${key} failed`);
}

let signEnv = null;
/** Sign a file with the updater key (writes <file>.sig), as release.mjs does. */
function sign(file) {
  if (!signEnv) {
    const keyFile = process.env.DEETSMUSIC_UPDATER_KEY || join(homedir(), "Documents", "Deets' Secrets", "deetsmusic-updater.key");
    if (!existsSync(keyFile)) die(`no updater key at ${keyFile} (RELEASE.md §6.6)`);
    const password = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "cred-read.ps1"), "-Target", "DeetsMusicUpdaterKey"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    signEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyFile, "utf8").trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
  }
  rmSync(`${file}.sig`, { force: true });
  const r = spawnSync(`npx tauri signer sign "${file}"`, { cwd: root, shell: true, stdio: ["ignore", "ignore", "inherit"], env: signEnv });
  if (r.status !== 0 || !existsSync(`${file}.sig`)) die(`could not sign ${file}`);
}

/** Write, sign and upload a feed of `assets` under `key` (the feed first, then its .sig). */
function putFeed(key, assets) {
  const tmp = join(tmpdir(), `deetsmusic-${process.pid}-${FEED}`);
  writeFileSync(tmp, JSON.stringify({ Assets: assets }));
  try {
    sign(tmp);
    put(key, tmp, "application/json");
    put(`${key}.sig`, `${tmp}.sig`, "text/plain");
  } finally {
    rmSync(tmp, { force: true });
    rmSync(`${tmp}.sig`, { force: true });
  }
}

/** The local feed (vpk keeps every version packed in OUT) minus the withdrawn versions. */
function liveAssets(index) {
  const local = join(OUT, FEED);
  if (!existsSync(local)) die(`no ${local} (run npm run release${BETA ? " -- --beta" : ""} first)`);
  const gone = new Set(index.releases.filter((r) => r.withdrawn).map((r) => r.version));
  return (JSON.parse(readFileSync(local, "utf8")).Assets ?? []).filter((a) => !gone.has(a.Version));
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const index = readIndex();

if (reason !== null && withdraw === null) die("--reason goes with --withdraw <version>");

if (withdraw !== null) {
  const entry = index.releases.find((r) => r.version === withdraw);
  if (!entry) die(`${withdraw} is not in ${channel}/index.json`);
  entry.withdrawn = true;
  if (reason) entry.withdrawn_reason = reason;
  // A Velopack version leaves the signed feed too: the Worker cannot change a signed file.
  if (entry.velopack) putFeed(FEED, liveAssets(index));
  writeIndex(index);
  console.log(`[publish] ${withdraw} withdrawn from ${channel}${reason ? " (with a reason)" : ""}`);
  process.exit(0);
}

if (notesOnly !== null) {
  const entry = index.releases.find((r) => r.version === notesOnly);
  if (!entry) die(`${notesOnly} is not in ${channel}/index.json`);
  const notes = releaseNotes(notesOnly);
  if (!notes) die(`no "## ${notesOnly}" entry in docs/ops/RELEASE-NOTES.md`);
  entry.notes = notes;
  writeIndex(index);
  console.log(`[publish] ${notesOnly} notes refreshed on ${channel}`);
  process.exit(0);
}

if (history) {
  // Every "## <version> — <date>" heading the index lacks, except the version being built:
  // that one is published for real, with its installer.
  const md = readFileSync(join(root, "docs", "ops", "RELEASE-NOTES.md"), "utf8");
  const heads = [...md.matchAll(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+\S+\s+(\d{4}-\d{2}-\d{2})\s*$/gm)];
  const added = [];
  for (const [, v, date] of heads) {
    if (v === pkg.version || index.releases.some((r) => r.version === v)) continue;
    index.releases.push({ version: v, notes: releaseNotes(v), pub_date: `${date}T00:00:00.000Z`, history: true });
    added.push(v);
  }
  if (!added.length) {
    console.log(`[publish] no history rows to add on ${channel}`);
    process.exit(0);
  }
  writeIndex(index);
  console.log(`[publish] history rows added on ${channel}: ${added.join(", ")}`);
  process.exit(0);
}

const version = pkg.version;
const group = pkg.deetsmusic?.updateGroup;
if (!Number.isInteger(group)) die("package.json deetsmusic.updateGroup must be an integer (RELEASE.md §6.5)");
// A beta is always a -beta.N version, and a -beta.N version is always a beta: the real channel
// never takes one, and --beta never takes anything else.
const betaVersion = /-beta\.\d+$/.test(version);
if (BETA !== betaVersion) die(BETA ? `--beta needs a beta version like 0.14.0-beta.1 (package.json has ${version})` : `${version} is a beta version: publish it with --beta`);
// A missing entry used to publish `notes: ""`, and 0.6.3 and 0.7.0 went live with a blank row
// on the website and in the update offer. The test channel's spike builds carry no notes.
if (channel === "deetsmusic" && !releaseNotes(version)) {
  die(`no "## ${version} — <date>" entry in docs/ops/RELEASE-NOTES.md; write it before publishing (RELEASE.md §0 step 1)`);
}
if (index.releases.some((r) => r.version === version && !r.history) && !replace) {
  die(`${version} is already in ${channel}/index.json (pass --replace to overwrite)`);
}

const local = JSON.parse(readFileSync(join(OUT, FEED), "utf8")).Assets ?? [];
const mine = local.filter((a) => a.Version === version);
const full = mine.find((a) => a.Type === "Full");
if (!full) die(`the local feed has no full package for ${version} (run npm run release${BETA ? " -- --beta" : ""})`);
const setupLocal = join(OUT, `${PACK}-${channel}-Setup.exe`);
const setup = `${PACK}-${version}-Setup.exe`;
if (!existsSync(setupLocal)) die(`no ${setupLocal}`);

for (const a of mine) put(a.FileName, join(OUT, a.FileName), "application/octet-stream"); // 1
put(setup, setupLocal, "application/octet-stream"); // 2
putFeed(`rollback/${version}/${FEED}`, [full]); // 3

const entry = {
  version,
  group,
  notes: releaseNotes(version),
  pub_date: new Date().toISOString(),
  size: full.Size,
  file: full.FileName,
  setup,
  // The website's "MB installer" line: Setup.exe carries the stub and the update tool, so it is
  // ~7 MB larger than the package `size` names (0.28.0: 22.8 MB against 15.3 MB).
  setup_size: statSync(setupLocal).size,
  velopack: true,
};
putFeed(FEED, liveAssets({ releases: [...index.releases.filter((r) => r.version !== version), entry] })); // 4
index.releases = [...index.releases.filter((r) => r.version !== version), entry];
writeIndex(index);
console.log(`[publish] ${version} (group ${group}, ${(entry.size / 1024 / 1024).toFixed(1)} MB) is live on ${channel}`);

// The web demo follows each live release (WEB-DEMO.md §9.8): build it, copy it into
// ../DeetsSolutions, commit it on master and push, which deploys deets.solutions. A failure
// here never undoes the publish.
if (channel === "deetsmusic") {
  const demo = spawnSync(process.execPath, [join(root, "scripts", "demo-publish.mjs"), "--push"], { cwd: root, stdio: "inherit" });
  if (demo.status !== 0) console.warn("[publish] the web demo did not go out (npm run demo:publish -- --push to retry)");
}

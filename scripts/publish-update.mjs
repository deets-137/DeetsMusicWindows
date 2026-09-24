// `npm run release:publish` — put the archived installer on an update channel
// (docs/ops/RELEASE.md §6.7). Publishing is what makes installs update: run it only after the
// installed build passed its checks.
//
//   npm run release:publish                              package.json's version → "deetsmusic"
//   npm run release:publish -- --channel deetsmusic-test  a test build (§6.8)
//   npm run release:publish -- --beta                    DeetsMusic Beta (BETA.md §4): installers/beta → deetsmusic-test
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
// Uploads installers/DeetsMusic_<v>_x64-setup.exe to R2 (deetsmusic-releases/<channel>/), then
// rewrites <channel>/index.json with { version, group, notes, pub_date, size, signature, file }.
// `group` is package.json `deetsmusic.updateGroup` (§6.5); `notes` is the version's entry in
// docs/ops/RELEASE-NOTES.md, up to its first subsection. Wrangler runs from ../DeetsSupport, whose
// account owns the bucket.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const index = readIndex();

if (reason !== null && withdraw === null) die("--reason goes with --withdraw <version>");

if (withdraw !== null) {
  const entry = index.releases.find((r) => r.version === withdraw);
  if (!entry) die(`${withdraw} is not in ${channel}/index.json`);
  entry.withdrawn = true;
  if (reason) entry.withdrawn_reason = reason;
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
const file = `DeetsMusic_${version}_x64-setup.exe`;
// archive-installer.mjs's rule. A beta is always a -beta.N version, and a -beta.N version is
// always a beta: the real channel never takes one, and --beta never takes anything else.
const betaVersion = /-beta\.\d+$/.test(version);
if (BETA !== betaVersion) die(BETA ? `--beta needs a beta version like 0.14.0-beta.1 (package.json has ${version})` : `${version} is a beta version: publish it with --beta`);
const sub = BETA ? "installers/beta" : version.includes("-") ? "installers/dev" : "installers";
const exe = join(root, sub, file);
if (!existsSync(exe) || !existsSync(`${exe}.sig`)) die(`need ${sub}/${file} and its .sig (run npm run release first)`);
// A missing entry used to publish `notes: ""`, and 0.6.3 and 0.7.0 went live with a blank row
// on the website and in the update offer. The test channel's spike builds carry no notes.
if (channel === "deetsmusic" && !releaseNotes(version)) {
  die(`no "## ${version} — <date>" entry in docs/ops/RELEASE-NOTES.md; write it before publishing (RELEASE.md §0 step 1)`);
}
if (index.releases.some((r) => r.version === version && !r.history) && !replace) {
  die(`${version} is already in ${channel}/index.json (pass --replace to overwrite)`);
}

const up = wrangler(["r2", "object", "put", `${BUCKET}/${channel}/${file}`, "--file", exe, "--content-type", "application/octet-stream", "--remote"]);
if (up.status !== 0) die("installer upload failed");

const entry = {
  version,
  group,
  notes: releaseNotes(version),
  pub_date: new Date().toISOString(),
  size: statSync(exe).size,
  signature: readFileSync(`${exe}.sig`, "utf8").trim(),
  file,
};
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

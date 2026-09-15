// `node scripts/sign.mjs <file>...` — Authenticode-sign files with Azure Artifact Signing
// (docs/RELEASE.md §6.9). Called by release.mjs for the CLI and, through the tauri build's
// signCommand, for DeetsMusic.exe and the installer.
//
// signtool (Windows SDK, x64) loads Microsoft's Artifact Signing dlib
// (NuGet Microsoft.ArtifactSigning.Client, bin\x64, needs the .NET 8 runtime), which signs in
// with DefaultAzureCredential's environment credential: AZURE_TENANT_ID, AZURE_CLIENT_ID and
// AZURE_CLIENT_SECRET, set by release.mjs. metadata.json names the endpoint, account and
// profile and excludes every other credential, so it never falls back to a browser.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TOOLS = process.env.DEETS_SIGNING_TOOLS || join(process.env.LOCALAPPDATA ?? "", "DeetsTools", "artifact-signing");
const DLIB = join(TOOLS, "1.0.128", "Azure.CodeSigning.Dlib.dll");
const METADATA = join(TOOLS, "metadata.json");

function die(msg) {
  console.error(`[sign] ${msg}`);
  process.exit(1);
}

// The newest Windows 10/11 SDK's x64 signtool; the dlib is x64 too.
function signtool() {
  const bin = join(process.env["ProgramFiles(x86)"] ?? "", "Windows Kits", "10", "bin");
  const versions = existsSync(bin) ? readdirSync(bin).filter((d) => /^10\./.test(d)).sort().reverse() : [];
  for (const v of versions) {
    const p = join(bin, v, "x64", "signtool.exe");
    if (existsSync(p)) return p;
  }
  die(`no x64 signtool.exe under ${bin} (install the Windows SDK)`);
}

const files = process.argv.slice(2);
if (!files.length) die("usage: node scripts/sign.mjs <file>...");
if (!existsSync(DLIB)) die(`no Artifact Signing dlib at ${DLIB} (RELEASE.md §6.9)`);
if (!existsSync(METADATA)) die(`no ${METADATA} (RELEASE.md §6.9)`);
for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"]) {
  if (!process.env[k]) die(`${k} is not set (run through npm run release)`);
}

const tool = signtool();
for (const file of files) {
  if (!existsSync(file)) die(`no file ${file}`);
  const r = spawnSync(
    tool,
    ["sign", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256", "/d", "DeetsMusic", "/dlib", DLIB, "/dmdf", METADATA, file],
    { stdio: "inherit" },
  );
  if (r.status !== 0) die(`signtool failed on ${file}`);
  console.log(`[sign] signed ${file}`);
}

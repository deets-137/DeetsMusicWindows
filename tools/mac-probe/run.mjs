#!/usr/bin/env node
// The Mac playback probe (README.md beside this file). Run from the repo root:
//
//   node tools/mac-probe/run.mjs                 # play one song, print the verdict
//   node tools/mac-probe/run.mjs --song "term"   # search for a different song
//   node tools/mac-probe/run.mjs --signin        # forget the saved user token, sign in again
//   node tools/mac-probe/run.mjs --keep          # leave the window open after the verdict
//
// 1. The developer token: signed here from a local .p8 (src-tauri/secrets/apple.json, the
//    app's dev seam), else fetched from the mint with the build key (RELEASE.md §0).
// 2. The Music User Token: saved in tools/mac-probe/.probe/ (gitignored) after one sign-in.
//    The sign-in is the app's own loopback flow: a page on 127.0.0.1:47831 in your browser.
// 3. `cargo build` the probe window, start it, and print its [probe] lines.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createPrivateKey, sign, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STATE = join(HERE, ".probe");
const MUT_FILE = join(STATE, "user-token.txt");
const CRATE = join(HERE, "src-tauri");
const BIN = join(CRATE, "target", "debug", "deets-mac-probe");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

if (process.platform !== "darwin") {
  console.error("This probe tests WKWebView. Run it on a Mac.");
  process.exit(1);
}

// ── 0. The glass test needs no token ───────────────────────────────────────
if (flag("--glass")) {
  console.log("build: cargo build…");
  const gb = spawnSync("cargo", ["build"], { cwd: CRATE, stdio: "inherit" });
  if (gb.status !== 0) process.exit(gb.status ?? 1);
  console.log("run: the glass test opens now. It runs its scenes (~30 s); close the window to end.\n");
  const g = spawn(BIN, [], {
    env: { ...process.env, PROBE_MODE: "glass",
      PROBE_WALLPAPER: join(REPO, "store-art", "box-1x1-1080.png") },
    stdio: ["ignore", "inherit", "inherit"],
  });
  g.on("exit", (code) => process.exit(code ?? 0));
} else {
  await playbackProbe();
}

async function playbackProbe() {
// ── 1. Developer token ─────────────────────────────────────────────────────
const b64url = (b) => Buffer.from(b).toString("base64url");

function localToken() {
  const dir = join(REPO, "src-tauri", "secrets");
  const cfgPath = join(dir, "apple.json");
  if (!existsSync(cfgPath)) return null;
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const pem = readFileSync(join(dir, cfg.privateKeyFile), "utf8");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: cfg.teamId, iat: now, exp: now + 24 * 3600 }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), {
    key: createPrivateKey(pem), dsaEncoding: "ieee-p1363",
  });
  console.log("token: signed here from the local .p8 (src-tauri/secrets)");
  return `${head}.${body}.${b64url(sig)}`;
}

async function mintToken() {
  const keyPath = process.env.DEETSMUSIC_BUILD_KEY ||
    join(homedir(), "Documents", "Deets' Secrets", "deetsmusic-build-key.txt");
  if (!existsSync(keyPath)) return null;
  const key = readFileSync(keyPath, "utf8").trim();
  const r = await fetch("https://music-api.deets.solutions/token", { headers: { "X-Deets-Build": key } });
  if (!r.ok) throw new Error(`the mint answered ${r.status}: ${await r.text()}`);
  console.log("token: from the mint, with the build key");
  return (await r.json()).token;
}

async function developerToken() {
  const t = localToken() || (await mintToken());
  if (t) return t;
  console.error(`No developer token. Give the probe one of these (both are on the Windows PC):
  - the build key: copy Documents\\Deets' Secrets\\deetsmusic-build-key.txt to
    ~/Documents/Deets' Secrets/deetsmusic-build-key.txt (or set DEETSMUSIC_BUILD_KEY to its path)
  - a MusicKit key: apple.json + the AuthKey .p8 into src-tauri/secrets/ (gitignored)`);
  process.exit(1);
}

// ── 2. Music User Token: the loopback sign-in ───────────────────────────────
function signInPage(devToken, nonce) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Probe sign-in</title>
<script>try{localStorage.clear();sessionStorage.clear();}catch(e){}</script>
<script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" async></script>
<style>body{font:15px -apple-system,system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px}
button{font:inherit;padding:8px 16px}</style></head><body>
<h2>Mac probe: sign in to Apple Music</h2>
<p>The probe needs your Music User Token to play a full song. It is saved on this Mac only,
in tools/mac-probe/.probe/ (gitignored).</p>
<button id="go">Sign in to Apple Music</button><p id="s"></p>
<script>
const s=document.getElementById("s");
document.getElementById("go").onclick=async()=>{
  try{
    if(!window.MusicKit) await new Promise(r=>document.addEventListener("musickitloaded",r,{once:true}));
    await MusicKit.configure({developerToken:${JSON.stringify(devToken)},app:{name:"DeetsMusic Mac probe",build:"0.1.0"}});
    const mut=await MusicKit.getInstance().authorize();
    const r=await fetch("/callback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:${JSON.stringify(nonce)},mut})});
    s.textContent=r.ok?"Done. You can close this tab.":"The probe did not take the token.";
  }catch(e){ s.textContent="Sign-in did not finish: "+(e&&(e.errorCode||e.message)||e); }
};
</script></body></html>`;
}

function userToken(devToken) {
  if (flag("--signin")) rmSync(MUT_FILE, { force: true });
  if (existsSync(MUT_FILE)) {
    console.log("user token: saved from an earlier sign-in (--signin to redo it)");
    return Promise.resolve(readFileSync(MUT_FILE, "utf8").trim());
  }
  const nonce = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(signInPage(devToken, nonce));
      } else if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const { state, mut } = JSON.parse(body);
            if (state !== nonce || !mut) throw new Error("bad callback");
            mkdirSync(STATE, { recursive: true });
            writeFileSync(MUT_FILE, mut, { mode: 0o600 });
            res.writeHead(200).end("ok");
            server.close();
            console.log("user token: signed in and saved");
            resolve(mut);
          } catch (e) { res.writeHead(400).end("no"); }
        });
      } else res.writeHead(404).end();
    });
    server.on("error", reject);
    // 47831 is the app's first sign-in port: a token with an origin claim lists it.
    server.listen(47831, "127.0.0.1", () => {
      const url = "http://127.0.0.1:47831/";
      console.log(`sign-in: opening ${url} in your browser. Sign in there.`);
      spawn("open", [url], { stdio: "ignore" });
    });
  });
}

// ── 3. Build and run the window ─────────────────────────────────────────────
const devToken = await developerToken();
const mut = await userToken(devToken);

console.log("build: cargo build (the first build takes a few minutes)…");
const b = spawnSync("cargo", ["build"], { cwd: CRATE, stdio: "inherit" });
if (b.status !== 0) process.exit(b.status ?? 1);

console.log("run: the probe window opens now. The verdict comes within ~80 s.\n");
const child = spawn(BIN, [], {
  env: { ...process.env, PROBE_DEV_TOKEN: devToken, PROBE_MUT: mut, PROBE_SONG: opt("--song") || "" },
  stdio: ["ignore", "pipe", "inherit"],
});
let verdictLine = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  for (const line of chunk.split("\n").filter(Boolean)) {
    console.log(line);
    if (line.includes("VERDICT:")) {
      verdictLine = line;
      // On a PASS the Web Audio check runs next (~5 s); on a FAIL there is nothing more.
      if (!flag("--keep") && !line.includes("PASS")) setTimeout(() => child.kill(), 3000);
    }
    if (line.includes("WEBAUDIO:")) {
      verdictLine += "\n" + line;
      if (!flag("--keep")) setTimeout(() => child.kill(), 2000);
    }
  }
});
child.on("exit", () => {
  console.log("\n" + (verdictLine || "No verdict: the window closed before the probe finished."));
  process.exit(verdictLine.includes("PASS") ? 0 : 1);
});
}

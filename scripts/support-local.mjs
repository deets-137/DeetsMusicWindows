// A local DeetsSupport for the dev app (`npm run dev:app -- --support-local`;
// DEBUGGING.md § A local support worker). It runs the REAL worker (../DeetsSupport, on
// Miniflare through `wrangler dev`) with a local D1, and the site's own dev server
// (../DeetsSolutions `scripts/dev.js`) for the thread page a report's Open shows. A fake
// worker written here would drift from the real one, so there is none.
//
//   1. bring the local D1 to the live shape: ../DeetsSupport/schema.sql, then each migration
//      (d1LocalSchema; a second run changes nothing);
//   2. start the worker on a free port from 8790 up (the site takes 8787 / 8788), with
//      ALLOWED_ORIGINS set to the site's local origin;
//   3. start the site on a free port from 8787 up;
//   4. hand back the env the app reads: DEETS_SUPPORT_URL and DEETS_SUPPORT_PAGE (report.rs,
//      debug builds only) and VITE_SUPPORT_LOCAL (report-replies.ts checks every 15 s).
//
// The local data lives in ../DeetsSupport/.wrangler/state (gitignored); delete that folder for
// an empty forum. `npm run support:reply` writes Aditya's reply into the same database.
// Wrangler is the site's own devDependency (wrangler 4), run with node directly: no npx, no
// shell, so the space in this user folder cannot split an argument.
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(repo, "..");
/** The running local worker: its address, the site's origin and this run's secret. */
export const RUN_FILE = join(repo, "node_modules", ".support-local.json");
const LOCAL_OWNER = "local-owner";

/** A ds_sess cookie the local worker reads as Aditya's: DeetsAccounts' shape, {u, iat} in
 *  base64url, a dot, then HMAC-SHA256 over that payload (DeetsSupport `sessionUid`). */
export function ownerCookie(secret) {
  const payload = Buffer.from(JSON.stringify({ u: LOCAL_OWNER, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `ds_sess=${encodeURIComponent(`${payload}.${sig}`)}`;
}
export const SUPPORT_DIR = join(docs, "DeetsSupport");
const SITE_DIR = join(docs, "DeetsSolutions");
export const WRANGLER = join(SITE_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
const QUIET = { ...process.env, WRANGLER_SEND_METRICS: "false" };

/** Run one `wrangler d1 execute deets-support --local` with a SQL file. */
export function d1Local(file, { quiet = false } = {}) {
  execFileSync(process.execPath, [WRANGLER, "d1", "execute", "deets-support", "--local", `--file=${file}`], {
    cwd: SUPPORT_DIR,
    stdio: ["ignore", "ignore", quiet ? "ignore" : "inherit"],
    env: QUIET,
  });
}

/** The local D1 at the live shape. schema.sql makes the missing tables, but a local database
 *  made before a migration lacks its columns (`read_at` did, 2026-10-30), so each migration is
 *  applied too, oldest first. On a new database the old ones fail on a column schema.sql
 *  already made, and that failure is the expected answer, so it is not shown. */
export function d1LocalSchema() {
  d1Local("schema.sql");
  const dir = join(SUPPORT_DIR, "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    try {
      d1Local(join("migrations", f), { quiet: true });
    } catch {
      /* already applied */
    }
  }
}

/** `free(port)` is dev-app.mjs's probe (both address families). */
export async function startSupportLocal(free) {
  for (const [dir, what] of [[SUPPORT_DIR, "../DeetsSupport"], [SITE_DIR, "../DeetsSolutions"], [WRANGLER, "wrangler in ../DeetsSolutions (npm install there)"]]) {
    if (!existsSync(dir)) {
      console.error(`[dev:app] --support-local needs ${what}.`);
      process.exit(2);
    }
  }
  d1LocalSchema();
  let site = 8787;
  while (!(await free(site))) site += 1;
  let api = 8790;
  while (api === site || !(await free(api))) api += 1;
  const origin = `http://localhost:${site}`;
  // A session secret made for this run only, so `support:reply` can sign a local owner cookie
  // and call the real owner routes. It never leaves this PC and dies with the run.
  const secret = randomBytes(32).toString("hex");
  const worker = spawn(
    process.execPath,
    [
      WRANGLER, "dev", "--port", String(api), "--show-interactive-dev-session=false",
      "--var", `ALLOWED_ORIGINS:${origin}`, "--var", `SESSION_SECRET:${secret}`, "--var", `OWNER_UID:${LOCAL_OWNER}`,
    ],
    { cwd: SUPPORT_DIR, stdio: ["ignore", "inherit", "inherit"], env: QUIET },
  );
  const base = `http://localhost:${api}`;
  // The site reads this worker and signs in as the local owner (DeetsSolutions scripts/dev.js,
  // `/__support/`), with this run's secret: the live sign-in is never needed.
  const page = spawn(process.execPath, [join(SITE_DIR, "scripts", "dev.js"), String(site)], {
    cwd: SITE_DIR,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...QUIET, DEETS_SUPPORT_URL: base, DEETS_SUPPORT_SECRET: secret },
  });
  writeFileSync(RUN_FILE, JSON.stringify({ base, origin, secret }));
  console.log(`[dev:app] --support-local: the DeetsSupport worker on ${base} · the site on ${origin}`);
  return {
    env: {
      DEETS_SUPPORT_URL: base,
      DEETS_SUPPORT_PAGE: `${origin}/deetsmusic/#t=`,
      VITE_SUPPORT_LOCAL: "1",
    },
    stop() {
      worker.kill();
      page.kill();
      rmSync(RUN_FILE, { force: true });
    },
  };
}

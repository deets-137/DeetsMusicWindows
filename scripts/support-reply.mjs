// `npm run support:reply -- [code] "text" [--state fixed] [--delete]` — Aditya answers a
// report on the LOCAL DeetsSupport worker (`npm run dev:app -- --support-local`;
// DEBUGGING.md § A local support worker), through the same owner routes the admin page uses:
//   "text"         POST  /admin/posts/<code>/replies   (a reply as Aditya)
//   --state <s>    PATCH /admin/posts/<code> {state}    (new · open · planned · fixed · wontfix · closed)
//   --delete       DELETE /admin/posts/<code>           (into the archive, as the admin page's Delete)
// It signs a local owner cookie with the secret of the running local worker
// (node_modules/.support-local.json), so it cannot reach the live worker: that file only ever
// names localhost, and the live worker does not know the secret.
//
// With no code, it answers the newest report in either dev profile's local list
// (%APPDATA%\com.deetsmusic.dev or com.deetsmusic.second.dev, reports-local.json).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ownerCookie, RUN_FILE } from "./support-local.mjs";

const STATES = new Set(["new", "open", "planned", "fixed", "wontfix", "closed"]);
const args = process.argv.slice(2);
const take = (flag, withValue) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  return withValue ? args.splice(i, 2)[1] : (args.splice(i, 1), true);
};
const state = take("--state", true);
const del = take("--delete", false);
if (state && !STATES.has(state)) {
  console.error(`[support:reply] --state takes one of: ${[...STATES].join(", ")}`);
  process.exit(2);
}
const CODE = /^[A-Za-z0-9_-]{8,32}$/;
let code = args.length && CODE.test(args[0]) && (args.length > 1 || state || del) ? args.shift() : null;
const text = args.join(" ").trim();
if (!text && !state && !del) {
  console.error('[support:reply] usage: npm run support:reply -- [code] "text" [--state fixed] [--delete]');
  process.exit(2);
}
if (!existsSync(RUN_FILE)) {
  console.error("[support:reply] no local worker is running. Start it with: npm run dev:app -- --support-local");
  process.exit(2);
}
const run = JSON.parse(readFileSync(RUN_FILE, "utf8"));
if (!/^http:\/\/localhost:\d+$/.test(run.base)) {
  console.error(`[support:reply] ${RUN_FILE} names ${run.base}, not a local worker. Nothing was sent.`);
  process.exit(2);
}
if (!code) {
  // Both dev profiles (`--second` is com.deetsmusic.second.dev): the newest report of either.
  let best = null;
  for (const id of ["com.deetsmusic.dev", "com.deetsmusic.second.dev"]) {
    try {
      const top = JSON.parse(readFileSync(join(process.env.APPDATA, id, "reports-local.json"), "utf8"))[0];
      if (top?.code && (!best || (top.at ?? 0) > (best.at ?? 0))) best = top;
    } catch {
      /* no list in this profile */
    }
  }
  code = best?.code ?? null;
  if (!code) {
    console.error("[support:reply] no code given, and no dev profile has a local report. Send one from the dev app first.");
    process.exit(2);
  }
}

const headers = { Cookie: ownerCookie(run.secret), Origin: run.origin, "Content-Type": "application/json" };
async function call(method, path, body) {
  const r = await fetch(`${run.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    console.error(`[support:reply] ${method} ${path.replace(code, `${code.slice(0, 4)}…`)} answered ${r.status} ${await r.text()}`);
    process.exit(1);
  }
}
const short = `${code.slice(0, 4)}…`;
if (text) await call("POST", `/admin/posts/${code}/replies`, { body: text });
if (state) await call("PATCH", `/admin/posts/${code}`, { state });
if (del) await call("DELETE", `/admin/posts/${code}`);
console.log(
  `[support:reply] ${[text && "replied", state && `status ${state}`, del && "deleted (archived)"].filter(Boolean).join(", ")} on ${short}`,
);

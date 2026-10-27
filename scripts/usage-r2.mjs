// `npm run usage:r2 [-- --days N]`: the cross-check of the download counts (USAGE-COUNTS.md
// §12.7 call 2). Per UTC day, three sources side by side, so a gap between them shows a fault:
//   R2      Cloudflare's own R2 analytics: GetObject on each Setup.exe and update package
//           (every fetch, people and machines alike, finished or not)
//   zone    the deets.solutions HTTP analytics for *Setup.exe answered 200 (a 404 or 429 never
//           reaches R2), by the same User-Agent rules as
//           the worker's setupSource (store · check · bot · other; the free plan gives no
//           query string, so `site` and `direct` are one column here)
//   worker  the worker's own counts (setup.start / setup.done by source, update.downloaded,
//           update.applied, install.first) from D1, read-only
// Reads with the wrangler login (the OAuth token in wrangler's config; `npx wrangler login`
// when it has expired). Cloudflare answers at most 4 weeks and 4 days per query: --days caps
// at 31. Prints only counts; nothing is written anywhere.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const support = join(root, "..", "DeetsSupport");
const BUCKET = "deetsmusic-releases";
const ZONE = "deets.solutions";
const API = "https://api.cloudflare.com/client/v4";
// The worker's rules (DeetsSupport src/usage.js setupSource), by User-Agent only.
const CHECK_AGENT = "Mozilla/5.0 (Windows NT 6.2; WOW64; rv:19.0) Gecko/20100101 Firefox/19.0";
const BOT_AGENT = /bot|spider|crawl|curl|wget|python|go-http|headless|java\/|okhttp|libwww|httpclient/i;
const sourceOf = (ua) =>
  ua.startsWith("Microsoft-Delivery-Optimization/") ? "store" : ua === CHECK_AGENT ? "check" : !ua || BOT_AGENT.test(ua) ? "bot" : "other";

const arg = process.argv.indexOf("--days");
const days = Math.min(31, Math.max(1, Number(arg > 0 ? process.argv[arg + 1] : 14) || 14));
const since = new Date(Date.now() - (days - 1) * 86400000);
const sinceDay = since.toISOString().slice(0, 10);

function token() {
  // Refresh first: whoami renews an expired OAuth token and writes it back.
  try { execSync("npx wrangler whoami", { cwd: support, stdio: "ignore" }); } catch { /* read what is there */ }
  const file = join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml");
  const m = /^oauth_token = "([^"]+)"/m.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`no wrangler login in ${file}: run npx wrangler login`);
  return m[1];
}

async function cf(tok, path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (j.errors?.length) throw new Error(`${path}: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j;
}

const gql = (tok, query) => cf(tok, "/graphql", { query: `{ viewer ${query} }` }).then((j) => j.data.viewer);

/** The worker's counts, through D1's HTTP API (a SELECT; the database id from wrangler.jsonc). */
async function workerCounts(tok, account) {
  const conf = readFileSync(join(support, "wrangler.jsonc"), "utf8");
  const db = /"database_id":\s*"([^"]+)"/.exec(conf)?.[1];
  if (!db) return [];
  const sql = `SELECT period, metric, bucket, SUM(n) AS n FROM usage_counts
    WHERE length(period) = 10 AND period >= ?1 AND channel = 'live'
      AND (metric LIKE 'setup.%' OR metric LIKE 'update.%' OR metric = 'install.first')
    GROUP BY period, metric, bucket`;
  try {
    const j = await cf(tok, `/accounts/${account}/d1/database/${db}/query`, { sql, params: [sinceDay] });
    return j.result[0].results;
  } catch (e) {
    console.error(`worker counts not read: ${String(e.message).split("\n")[0]}`);
    return [];
  }
}

const tok = token();
const account = (await cf(tok, "/accounts")).result[0].id;
const zone = (await cf(tok, `/zones?name=${ZONE}`)).result[0].id;
const from = `${sinceDay}T00:00:00Z`;

const r2 = (await gql(tok, `{ accounts(filter:{accountTag:"${account}"}) { r2OperationsAdaptiveGroups(limit:5000,
  filter:{datetime_geq:"${from}", bucketName:"${BUCKET}", actionType:"GetObject"}) { sum { requests } dimensions { date objectName } } } }`))
  .accounts[0].r2OperationsAdaptiveGroups;
const http = (await gql(tok, `{ zones(filter:{zoneTag:"${zone}"}) { httpRequestsAdaptiveGroups(limit:5000,
  filter:{datetime_geq:"${from}", clientRequestPath_like:"%Setup.exe", clientRequestHTTPMethodName:"GET", edgeResponseStatus:200}) { count dimensions { date userAgent } } } }`))
  .zones[0].httpRequestsAdaptiveGroups;
const worker = await workerCounts(tok, account);

const rows = {};
const row = (d) => (rows[d] ??= {});
const add = (d, k, n) => { row(d)[k] = (row(d)[k] ?? 0) + n; };
for (const g of r2) {
  const name = g.dimensions.objectName;
  if (!name.startsWith("deetsmusic/vp/")) continue; // live only; Beta is deetsmusic-test/
  if (/-Setup\.exe$/.test(name)) add(g.dimensions.date, "r2.setup", g.sum.requests);
  else if (/\.nupkg$/.test(name)) add(g.dimensions.date, "r2.pkg", g.sum.requests);
}
for (const g of http) add(g.dimensions.date, `zone.${sourceOf(g.dimensions.userAgent)}`, g.count);
for (const w of worker) add(w.period, `${w.metric}${w.bucket ? "." + w.bucket : ""}`, w.n);

const COLS = [
  ["r2.setup", "R2 setup"], ["zone.other", "zone people"], ["zone.store", "zone store"], ["zone.check", "zone check"], ["zone.bot", "zone bot"],
  ["setup.done.site", "w site"], ["setup.done.store", "w store"], ["setup.done.direct", "w direct"], ["setup.start.check", "w check"],
  ["setup.start.bot", "w bot"], ["install.first", "w first"], ["r2.pkg", "R2 pkgs"], ["update.downloaded", "w dl"], ["update.applied", "w applied"],
];
const W = 13;
console.log(`Downloads, live channel, the last ${days} UTC days (R2 = Cloudflare's R2 analytics; zone = HTTP analytics; w = the worker's counts)`);
console.log("day".padEnd(12) + COLS.map(([, h]) => h.padStart(W)).join(""));
for (let i = 0; i < days; i++) {
  const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  const r = rows[d] ?? {};
  console.log(d.padEnd(12) + COLS.map(([k]) => String(r[k] ?? 0).padStart(W)).join(""));
}
console.log("\nA gap to read: R2 setup should equal the zone's columns summed (every fetch goes through the worker);");
console.log("the worker's started counts should match the zone's by source from the day the worker counts.");

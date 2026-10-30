// The worker half of the USAGE-COUNTS.md §12 desk test, against a LOCAL worker only.
//   cd ../DeetsSupport
//   npx wrangler@4 d1 execute deets-support --local --file=schema.sql
//   npx wrangler@4 dev --port 8791 --test-scheduled
//   node docs/ops/checks/usage-worker.mjs [--base http://localhost:8791]
// Every probe has an expect; the run prints PASS / FAIL per case and exits 1 on a failure.
// It wipes the local `dev` and `owner` channels, the local usage_seen table and the 9.9.9 rows
// first, so it can run again. It never talks to the live worker: the base must be localhost.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const i = process.argv.indexOf("--base");
const BASE = i > 0 ? process.argv[i + 1] : "http://localhost:8791";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error("a local worker only");
const support = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "DeetsSupport");
/** wrangler 4: the worker's own, else the newest one `npx wrangler@4` has cached. */
function findWrangler() {
  const own = join(support, "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(own)) return own;
  const cache = join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx");
  const found = (existsSync(cache) ? readdirSync(cache) : [])
    .map((d) => join(cache, d, "node_modules", "wrangler"))
    .filter((d) => existsSync(join(d, "bin", "wrangler.js")))
    .map((d) => ({ d, v: JSON.parse(readFileSync(join(d, "package.json"), "utf8")).version }))
    .filter((x) => x.v.startsWith("4."))
    .sort((a, b) => b.v.localeCompare(a.v, undefined, { numeric: true }))[0];
  if (!found) throw new Error("no wrangler 4: run npx wrangler@4 --version once");
  return join(found.d, "bin", "wrangler.js");
}
const wrangler = findWrangler();
const UA = "DeetsMusic/1.2.0";
const key = () => randomBytes(16).toString("base64url");
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const now = new Date();
const today = dayOf(now);
const month = today.slice(0, 7);
let failed = 0;

function sql(command) {
  const out = execFileSync(process.execPath, [wrangler, "d1", "execute", "deets-support", "--local", "--json", "--command", command],
    { cwd: support, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}
const n = (where) => sql(`SELECT COALESCE(SUM(n), 0) AS n FROM usage_counts WHERE ${where}`)[0].n;
const post = (kind, body) => fetch(`${BASE}/usage/${kind}`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 400)); // the writes ride waitUntil
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}
/** The rate limit is 20 a minute per address; local dev counts every request as "anon". */
let sent = 0;
async function send(kind, body) {
  if (++sent % 15 === 0) await new Promise((r) => setTimeout(r, 61_000));
  const res = await post(kind, body);
  await settle();
  return res.status;
}

sql("DELETE FROM usage_counts WHERE channel IN ('dev', 'owner') OR v = '9.9.9'");
sql("DELETE FROM usage_seen");
sql("DELETE FROM usage_settings WHERE channel IN ('dev', 'owner')");
const active = (ch, v, period) => n(`channel = '${ch}' AND v = '${v}' AND metric = 'active' AND period = '${period}'`);

// 1. A day count with the app's day and a key; the first ever.
const k1 = key();
expect("day count answers 204", await send("day", { v: "1.1.2", channel: "dev", week: true, month: true, new: true, day: today, key: k1 }), 204);
const weekOf = sql(`SELECT period FROM usage_counts WHERE channel = 'dev' AND length(period) = 8 LIMIT 1`)[0]?.period;
expect("the day, week and month count once", [active("dev", "1.1.2", today), active("dev", "1.1.2", weekOf), active("dev", "1.1.2", month)], [1, 1, 1]);
expect("a first count ever: install.first", n(`channel = 'dev' AND metric = 'install.first' AND period = '${today}'`), 1);
expect("the key is stored alone", sql("SELECT COUNT(*) AS n FROM usage_seen")[0].n, 1);

// 2. The same report again (a retry after a lost answer): nothing more.
await send("day", { v: "1.1.2", channel: "dev", week: true, month: true, new: true, day: today, key: k1 });
expect("a retry with the same key writes nothing", [active("dev", "1.1.2", today), n(`channel = 'dev' AND metric = 'install.first'`)], [1, 1]);

// 3. A new key is a new report.
await send("day", { v: "1.1.2", channel: "dev", week: false, month: false, day: today, key: key() });
expect("a new key counts", active("dev", "1.1.2", today), 2);

// 4. The app's day: within one day of the worker's, else dropped; a bad key is dropped.
const far = dayOf(new Date(now.getTime() - 3 * 86400000));
await send("day", { v: "1.1.2", channel: "dev", week: false, month: false, day: far, key: key() });
expect("a day 3 days off is dropped", n(`channel = 'dev' AND period = '${far}'`), 0);
await send("day", { v: "1.1.2", channel: "dev", week: false, month: false, day: "2026-02-30", key: key() });
expect("an impossible day is dropped", n(`channel = 'dev' AND period = '2026-02-30'`), 0);
await send("day", { v: "1.1.2", channel: "dev", week: false, month: false, day: today, key: "short" });
expect("a malformed key drops the report", active("dev", "1.1.2", today), 2);
const yesterday = dayOf(new Date(now.getTime() - 86400000));
await send("day", { v: "1.1.2", channel: "dev", week: false, month: false, day: yesterday, key: key() });
expect("yesterday (a send across midnight) is filed under yesterday", active("dev", "1.1.2", yesterday), 1);

// 5. The owner channel, then an applied update that moves its counts.
await send("day", { v: "1.1.2", channel: "owner", week: true, month: true, day: today, key: key() });
expect("owner: the channel is taken", [active("owner", "1.1.2", today), active("owner", "1.1.2", weekOf), active("owner", "1.1.2", month)], [1, 1, 1]);
const applied = { event: "applied", channel: "owner", from: "1.1.2", to: "1.2.0", moves: { day: "1.1.2", week: "1.1.2", month: "1.1.2" }, rollback: false, day: today };
await send("update", { ...applied, key: key() });
expect("applied: the counts move to 1.2.0", [active("owner", "1.1.2", today), active("owner", "1.1.2", weekOf), active("owner", "1.1.2", month),
  active("owner", "1.2.0", today), active("owner", "1.2.0", weekOf), active("owner", "1.2.0", month)], [0, 0, 0, 1, 1, 1]);
expect("applied: update.applied counts once", n(`channel = 'owner' AND v = '1.2.0' AND metric = 'update.applied'`), 1);
await send("update", { ...applied, key: key() });
expect("a second move with nothing left under 1.1.2 makes no count", [active("owner", "1.2.0", today), active("owner", "1.1.2", today)], [1, 0]);
await send("update", { ...applied, from: "0.1.0", moves: { day: "0.1.0", week: "0.1.0", month: "0.1.0" }, to: "1.2.1", key: key() });
expect("a forged move from a version with no count makes nothing", active("owner", "1.2.1", today), 0);
await send("update", { event: "downloaded", channel: "owner", from: "1.2.0", to: "1.2.1", rollback: false, day: today, key: key() });
expect("downloaded: one count under the new version", n(`channel = 'owner' AND v = '1.2.1' AND metric = 'update.downloaded'`), 1);
await send("update", { event: "applied", channel: "owner", from: "1.2.0", to: "1.1.2", moves: { day: "1.2.0" }, rollback: true, day: today, key: key() });
expect("a rollback moves back and is bucketed", [active("owner", "1.1.2", today), active("owner", "1.2.0", today), n(`channel = 'owner' AND metric = 'update.applied' AND bucket = 'rollback'`)], [1, 0, 1]);

// 6. The settings and health reports with a day and a key.
const ks = key();
await send("settings", { channel: "dev", settings: { skin: "glass" }, day: today, key: ks });
await send("settings", { channel: "dev", settings: { skin: "glass" }, day: today, key: ks });
expect("settings: a retry with the same key stores one row", sql("SELECT COUNT(*) AS n FROM usage_settings WHERE channel = 'dev'")[0].n, 1);
await send("health", { v: "1.2.0", channel: "dev", week: weekOf, panics: 2, day: today, key: key() });
expect("health: filed under the week it covers", n(`channel = 'dev' AND period = '${weekOf}' AND metric = 'reports'`), 1);

// 7. The Setup.exe count. A local R2 object of 40 MB (bigger than the socket buffers, so a cut
// download is cut before the worker has handed every byte on), then every source.
const dir = mkdtempSync(join(tmpdir(), "usage-r2-"));
const file = join(dir, "setup.bin");
writeFileSync(file, randomBytes(40 * 1024 * 1024));
execFileSync(process.execPath, [wrangler, "r2", "object", "put", "deetsmusic-releases/deetsmusic/vp/DeetsMusic-9.9.9-Setup.exe", "--local", "--file", file],
  { cwd: support, stdio: "ignore" });
const setup = `${BASE}/update/deetsmusic/vp/DeetsMusic-9.9.9-Setup.exe`;
const get = async (url, agent, cut = false) => {
  const res = await fetch(url, { headers: agent === null ? {} : { "User-Agent": agent } });
  if (cut) {
    const r = res.body.getReader();
    await r.read();
    await r.cancel();
  } else await res.arrayBuffer();
  await new Promise((r) => setTimeout(r, 800));
  return res.status;
};
const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0";
expect("the site link downloads", await get(`${setup}?from=site`, edge), 200);
await get(setup, "Microsoft-Delivery-Optimization/10.1");
await get(setup, "Mozilla/5.0 (Windows NT 6.2; WOW64; rv:19.0) Gecko/20100101 Firefox/19.0");
await get(setup, "curl/8.18.0");
await get(setup, edge, true);
await fetch(setup, { method: "HEAD", headers: { "User-Agent": edge } });
await new Promise((r) => setTimeout(r, 800));
const setupRow = (step, src) => n(`v = '9.9.9' AND metric = 'setup.${step}' AND bucket = '${src}' AND period = '${today}'`);
expect("site: started and finished", [setupRow("start", "site"), setupRow("done", "site")], [1, 1]);
expect("store: Delivery Optimization", [setupRow("start", "store"), setupRow("done", "store")], [1, 1]);
expect("check: the Firefox 19 caller", setupRow("start", "check"), 1);
expect("bot: curl", setupRow("start", "bot"), 1);
expect("a cut download starts and never finishes", [setupRow("start", "direct"), setupRow("done", "direct")], [1, 0]);
expect("a HEAD is never counted: five GETs, five starts", n(`v = '9.9.9' AND metric = 'setup.start'`), 5);

// 7b. Byte ranges (§14): the right bytes, 206 / 416, and a resume or a download in parts counts
// once. Each case reads the change in [start, done] for its source.
const whole = readFileSync(file);
const SIZE = whole.length;
const MB = 1024 * 1024;
const pause = () => new Promise((r) => setTimeout(r, 800));
const pair = (src) => [setupRow("start", src), setupRow("done", src)];
async function changed(src, run) {
  const a = pair(src);
  const out = await run();
  await pause();
  const b = pair(src);
  return { out, delta: [b[0] - a[0], b[1] - a[1]] };
}
async function part(range, agent = edge, extra = {}, cut = false) {
  const res = await fetch(setup, { headers: { "User-Agent": agent, Range: range, ...extra } });
  const got = { status: res.status, range: res.headers.get("Content-Range"), length: res.headers.get("Content-Length") };
  if (cut) {
    const r = res.body.getReader();
    await r.read();
    await r.cancel();
    return got;
  }
  return { ...got, buf: Buffer.from(await res.arrayBuffer()) };
}
const same = (buf, from) => buf.equals(whole.subarray(from, from + buf.length));
const headRes = await fetch(setup, { method: "HEAD", headers: { "User-Agent": edge } });
expect("a HEAD names Accept-Ranges", headRes.headers.get("Accept-Ranges"), "bytes");
const etag = headRes.headers.get("ETag");

let c = await changed("direct", async () => [await part(`bytes=0-${MB - 1}`), await part(`bytes=${MB}-`)]);
expect("a resume: two 206 parts", c.out.map((p) => [p.status, p.range]), [[206, `bytes 0-${MB - 1}/${SIZE}`], [206, `bytes ${MB}-${SIZE - 1}/${SIZE}`]]);
expect("a resume: the parts join into the file", Buffer.concat(c.out.map((p) => p.buf)).equals(whole), true);
expect("a resume counts one start and one finish", c.delta, [1, 1]);

const cuts = [0, 10 * MB, 20 * MB, 30 * MB];
c = await changed("store", () => Promise.all(cuts.map((at, k) =>
  part(k < cuts.length - 1 ? `bytes=${at}-${cuts[k + 1] - 1}` : `bytes=${at}-`, "Microsoft-Delivery-Optimization/10.1"))));
expect("Delivery Optimization in 4 parts at once: all 206", c.out.map((p) => p.status), [206, 206, 206, 206]);
expect("the 4 parts join into the file", Buffer.concat(c.out.map((p) => p.buf)).equals(whole), true);
expect("4 parts count one start and one finish", c.delta, [1, 1]);

c = await changed("direct", () => part("bytes=100-199"));
expect("a middle part: 206, its 100 bytes, no count", [c.out.status, c.out.buf.length, same(c.out.buf, 100), c.delta], [206, 100, true, [0, 0]]);
c = await changed("direct", () => part("bytes=-1000"));
expect("the last 1000 bytes: 206, the file's tail, a finish only", [c.out.status, c.out.range, same(c.out.buf, SIZE - 1000), c.delta],
  [206, `bytes ${SIZE - 1000}-${SIZE - 1}/${SIZE}`, true, [0, 1]]);
c = await changed("direct", () => part(`bytes=0-${SIZE + 5000}`));
expect("an end past the file is cut to the file", [c.out.status, c.out.buf.length, c.delta], [206, SIZE, [1, 1]]);
c = await changed("direct", () => part(`bytes=${SIZE}-`));
expect("a start past the end: 416, no count", [c.out.status, c.out.range, c.delta], [416, `bytes */${SIZE}`, [0, 0]]);
c = await changed("direct", () => part(`bytes=${10 * MB}-`, edge, {}, true));
expect("a cut last part never finishes", c.delta, [0, 0]);
c = await changed("direct", () => part("bytes=0-99", edge, { "If-Range": '"an-older-file"' }));
expect("If-Range with another ETag: the whole file, 200", [c.out.status, c.out.buf.length, c.delta], [200, SIZE, [1, 1]]);
c = await changed("direct", () => part("bytes=0-99", edge, { "If-Range": etag }));
expect("If-Range with this ETag: the part, 206", [c.out.status, c.out.buf.length, c.delta], [206, 100, [1, 0]]);
c = await changed("direct", () => part("bytes=0-1,5-6"));
expect("several ranges: the whole file, 200", [c.out.status, c.out.buf.length, c.delta], [200, SIZE, [1, 1]]);
c = await changed("direct", () => part("bytes=500-100"));
expect("a backwards range: the whole file, 200", [c.out.status, c.out.buf.length], [200, SIZE]);

const pkgFile = join(dir, "pkg.bin");
writeFileSync(pkgFile, randomBytes(4096));
execFileSync(process.execPath, [wrangler, "r2", "object", "put", "deetsmusic-releases/deetsmusic/vp/DeetsMusic-9.9.9-deetsmusic-full.nupkg", "--local", "--file", pkgFile],
  { cwd: support, stdio: "ignore" });
const startsBefore = n(`v = '9.9.9' AND metric LIKE 'setup.%'`);
const pkg = await fetch(`${BASE}/update/deetsmusic/vp/DeetsMusic-9.9.9-deetsmusic-full.nupkg`, { headers: { "User-Agent": UA, Range: "bytes=10-19" } });
const pkgBuf = Buffer.from(await pkg.arrayBuffer());
await pause();
expect("a package takes a range and is never counted", [pkg.status, pkgBuf.equals(readFileSync(pkgFile).subarray(10, 20)), n(`v = '9.9.9' AND metric LIKE 'setup.%'`) - startsBefore], [206, true, 0]);

// 8. The cron: a key older than 2 days goes, today's stays (the run at 00:01 UTC).
sql(`INSERT INTO usage_seen (key, day) VALUES ('${key()}', '2020-01-01')`);
const before = sql("SELECT COUNT(*) AS n FROM usage_seen")[0].n;
const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 1);
// The Local Explorer's scheduled call takes the time (`/__scheduled?time=` does not).
await fetch(`${BASE}/cdn-cgi/local/explorer/api/local/scheduled?worker=deets-support`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cron: "*/5 * * * *", scheduled_time: at }),
});
await new Promise((r) => setTimeout(r, 2000));
expect("cron: the old key goes, the recent keys stay", sql("SELECT COUNT(*) AS n FROM usage_seen")[0].n, before - 1);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

// `npm run support:pull` — copy the LIVE forum into the local DeetsSupport database
// (`npm run dev:app -- --support-local`; DEBUGGING.md § A local support worker). His ask,
// 2026-10-30: test on real posts without his live sign-in on localhost.
//
// It READS live (`wrangler d1 export --remote`, data only) and writes only the local D1, so
// nothing done on the local site or app can reach the live forum. Every local row of the
// tables in the copy is replaced, test posts included. The copy holds what the live database
// holds (post codes, member ids): it stays in ../DeetsSupport/.wrangler (gitignored) and in a
// temp file deleted at the end. It needs his Cloudflare login (`wrangler login`), which a
// deploy already uses.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d1Local, d1LocalSchema, SUPPORT_DIR, WRANGLER } from "./support-local.mjs";

const live = join(tmpdir(), `deets-support-live-${process.pid}.sql`);
const local = join(tmpdir(), `deets-support-load-${process.pid}.sql`);
try {
  console.log("[support:pull] reading the live forum (wrangler d1 export --remote, data only)…");
  execFileSync(process.execPath, [WRANGLER, "d1", "export", "deets-support", "--remote", "--no-schema", `--output=${live}`], {
    cwd: SUPPORT_DIR,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  const data = readFileSync(live, "utf8");
  // The tables in the copy, emptied first, so the local rows become the live rows exactly.
  const tables = [...new Set([...data.matchAll(/^INSERT INTO "?([A-Za-z_][\w]*)"?/gm)].map((m) => m[1]))]
    .filter((t) => !t.startsWith("_cf_") && !t.startsWith("sqlite_"));
  d1LocalSchema(); // the local shape matches live before the rows go in
  writeFileSync(
    local,
    ["PRAGMA defer_foreign_keys = true;", ...tables.map((t) => `DELETE FROM "${t}";`), data].join("\n"),
  );
  d1Local(local);
  const posts = (data.match(/^INSERT INTO "?posts"? /gm) || []).length;
  const archived = (data.match(/^INSERT INTO "?archived_posts"? /gm) || []).length;
  console.log(`[support:pull] the local forum now holds the live one: ${posts} posts, ${archived} archived, ${tables.length} tables.`);
  console.log("[support:pull] reports sent from the dev app before this read as gone (their rows were replaced).");
} finally {
  rmSync(live, { force: true });
  rmSync(local, { force: true });
}

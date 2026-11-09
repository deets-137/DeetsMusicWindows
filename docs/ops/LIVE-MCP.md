---
status: designed
desk_test: none
sources: [../DeetsMusicAdminMCP/src/index.ts, ../DeetsMusicAdminMCP/cloudflare.config.ts, ../DeetsSupport/schema.sql, ../DeetsSupport/src/usage.js, ../DeetsSupport/src/index.js, ../DeetsSolutions/deetsmusic/admin/admin.js, scripts/errors-where.mjs, scripts/usage-r2.mjs]
updated: 2026-11-07
---
# Live MCP — read the live support data from any Claude

> Designed 2026-11-01 (his ask: "better ways to query the live database rather than directly
> through the D1", then "MCP from the jump", then "the remote route so I can check on my
> phone"). Revised 2026-11-04 after a real read of the forum (L5 to L9). §1 is why. §3
> is the design. §4 holds his calls. §5 is what to check at build time. §8 is as built: the
> sign-in test worker, live 2026-11-07, with no tools on the D1 yet.

## 0. Terms

- **The live D1:** the `deets-support` D1 database behind DeetsSupport. It holds the forum
  (`posts`, `replies`) and the anonymous counts (`usage_counts`, `usage_listen`,
  `usage_settings`). Schema: `../DeetsSupport/schema.sql`.
- **The admin page:** DeetsSolutions `deetsmusic/admin/`. It reads the worker's `/admin/*`
  routes with his Google sign-in cookie (`ds_sess`).
- **A flag:** one line of *Needs a look* on the admin page, from a threshold in `FLAG`
  (`admin.js`).
- **Cloudflare Access:** Cloudflare's sign-in gate in front of an address. It lets in only the
  emails on its policy.
- **A remote MCP:** an MCP server at an `https` address. claude.ai, the Claude mobile app,
  Claude Code and cloud routines connect to it as a custom connector.

## 1. Why (read 2026-11-01)

Claude answered "any new errors on live?" with `npx wrangler d1 execute --remote`. Three faults:

1. **No read-only guard.** The command that reads can also write to live. A live write is his
   call (LESSONS.md stop rule 2).
2. **Windows quoting.** `npx` runs through `cmd`, so a `>` in the SQL became a redirect (a stray
   file in `../DeetsSupport`, deleted) and `%` is at risk.
3. **Noise.** `--json` prints one object per row, about 8 lines each.

It also worked only on his PC, from a Claude Code session.

**A second read, 2026-11-04.** He asked which suggestions wait on him. Claude used the Cloudflare
D1 connector, with three more faults:

1. **No single call.** The waiting rule lives only in `isWaiting` (`admin.js`), so Claude wrote it
   again by hand in SQL, then ran a second query for one thread.
2. **Nothing forces the limits.** The connector takes any SQL, a write too, and could return `code`
   or `uid`. Claude ran SELECTs and left those columns out, but that was care, not a guard.
3. **It is going away.** Cloudflare has deprecated that connector server.

## 2. What he gets

- "Anything on live?" is one tool call, from his phone, claude.ai or a Claude Code session. It
  returns only what is flagged or new since his last look.
- A daily email when a flag is up, and nothing on a quiet day. It runs when his PC is off.
- Narrow tools for the follow-up question. The check combines sources (an error spike in the
  same week as Apple 5xx reads as Apple, not us).

## 3. The design

### 3.1 Where it lives

A remote MCP in **its own worker on the same D1** (L5), at `/mcp`, behind Cloudflare Access. It
reads the live D1 through its own `DB` binding. **No API token exists for it, on any PC.** It runs
only the named queries in §3.2: the SQL is fixed in the worker, and no tool takes SQL.

A second worker keeps a fault in the MCP away from the mint, sign-in and the forum, and it needs
no change or deploy of DeetsSupport (his rule since 1.0.0: avoid worker changes on live). Its own
deploy touches nothing live. Each deploy is still his go.

**Read-only (L8).** The MCP reads. Replying, changing a post's state or hiding a reply stay on the
admin page. Its one write is the last look (§3.6).

### 3.2 The tools

| Tool | Returns |
|---|---|
| `live_check` | The combined check: flags first, then what is new since the last look. |
| `live_errors` | Error and warning counts by area and version for one week, **as a share of that week's health reports**. From 1.3.0, each fingerprint as a file and line (§3.4). |
| `live_reports` | New posts and replies since a time; which posts wait on his reply, and for how many days, by the one waiting rule (§3.5). |
| `live_thread` | One post by `pid`: its title, body, state, votes and visible replies, in order, each with who wrote it. |
| `live_installs` | Active installs, the version mix, updates applied and rolled back, the Setup.exe funnel, the minutes listened. |
| `live_apple` | Apple call results by endpoint and status for one week, as a share of reports. |
| `live_logs` | Workers Logs lines by name (e.g. `installer_health_fail`), if the worker can read its own logs (§5). |

A question no tool answers is a new named query, added to the worker. There is no raw SQL
over the internet (L9).

### 3.3 What the check compares (his call, 2026-11-01)

**No week-over-week comparison yet.** The app has been on live too short a time for a trend
to mean anything. The check reads each period on its own:

- A share against an absolute threshold (17 of 21 health reports on 1.2.1 with an `fe` error).
- A version against the version before it, in the same week (the page's `healthRatio`).
- An error area or fingerprint **never seen before** on live. This is a first sighting, not a
  trend.
- Posts waiting on him longer than `waitDays`.

The admin page's `drop` flag (7 days against the 7 before) stays out of the check until he
turns week-over-week on.

### 3.4 Fingerprints to a file and line

`npm run errors:where` reads the source maps in `installers/maps/<version>/` on his PC. The
worker cannot see that folder. At build time the release step uploads each version's maps (or
a small fingerprint → file:line table made from them) to R2 beside the release, and the worker
reads it there. The maps are of the public repo's code, so they hold nothing secret.

### 3.5 One set of rules (L7)

The check and the admin page must never disagree about what needs a look. Two rules are shared:
the thresholds (`FLAG` in `admin.js`) and the waiting rule (`isWaiting` in `admin.js`).

- **The waiting rule, as it stands:** a post that is not done (`fixed`, `wontfix`, `closed`) waits
  when he has not replied, or when its poster wrote after his last reply. A member's comment and a
  hidden reply count for nothing.
- **One source file.** Both rules move into one small plain-JS file. A build step copies it to the
  admin page and to the new worker, as `npm run usage:keys` copies the usage keys. Neither copy is
  edited by hand, and a check fails when they differ. DeetsSupport does not change.

### 3.6 The last look

The worker keeps the time of his last look (one row in the live D1). `live_check` moves it
forward when it answers; the daily email does not move it.

### 3.7 The daily email (his call, 2026-11-01)

A cron on the worker runs the same check once a day. When a flag is up, it emails him. A quiet
day sends nothing. Cloudflare Email Routing's `send_email` binding sends to a verified address
only, which is the address it needs.

### 3.8 Who can use it

- **The people on the Access policy.** Today only his Google account. A friend who helps with
  dev is one more email on the policy, and the friend needs no part of the Cloudflare account.
  Removing the email ends their access.
- **Everyone else** gets the Access sign-in page and nothing from the worker. The address is
  public, so the Access policy is the security. The worker also checks the Access token
  (`Cf-Access-Jwt-Assertion`) itself, so a route that slips out of the Access app still answers
  no one.
- **What the tools hide.** A post's `code` is the reporter's credential (it reads and replies
  as them), and `uid` is a DeetsAccounts id. The tools return `pid` and never `code`, `uid` or
  `meta`, because a tool result is kept in the Claude transcript.
- **A record.** One log line per call: the email from the Access token and the tool name.
- **His own installed app is not in scope:** the local `deetsmusic` MCP's `diag` and `query`
  already read it.

## 4. His calls

| # | Call | Date |
|---|---|---|
| L1 | An MCP server from the start, not a script first. | 2026-11-01 |
| L2 | A daily run that tells him on a flag, plus on demand. | 2026-11-01 |
| L3 | No week-over-week comparison until the app has more history (§3.3). | 2026-11-01 |
| L4 | The remote route: on the worker, so he can use it from his phone, claude.ai or the mobile app, and a worker runs the daily check and emails it. | 2026-11-01 |
| L5 | A second worker on the same D1, not a route in DeetsSupport (§3.1). | 2026-11-04 |
| L6 | A `live_thread` tool to read one thread (§3.2). | 2026-11-04 |
| L7 | The thresholds and the waiting rule in one shared source (§3.5). | 2026-11-04 |
| L8 | Read-only, except the last look (§3.1). | 2026-11-04 |
| L9 | No raw SQL: a new question is a new named query (§3.2). | 2026-11-04 |
| L10 | The name DeetsMusicAdminMCP; Claude picks the address (`musicadmin.deets.solutions`, beside `musicfriends`). Access set up from the CLI. | 2026-11-07 |

## 5. Check at build time

- **claude.ai and the mobile app sign in to a custom connector with OAuth.** Cloudflare's docs now
  show Access as the OAuth provider for a remote MCP on a Worker (read 2026-11-04: Secure MCP
  servers, through an Access for SaaS app; the demo is `remote-mcp-cf-access`). This is the first
  build step, because it is not tested: connect from claude.ai and the mobile app, and check that
  his account has a Zero Trust organization. If it fails, the MCP needs its own OAuth step (the
  Cloudflare `workers-oauth-provider` library) with Access or DeetsAccounts behind it.
- **Where the last look lives.** §3.6 keeps it as one row in the live D1, which needs a new table
  on live (his go). A KV key in the new worker would keep live's schema as it is, and the worker
  would hold no D1 write at all. Bring him this at build time.
- **Workers Logs from inside a worker.** `live_logs` needs the worker to query its own logs
  (the Workers observability API, with a token stored as a worker secret). If that needs more
  than a read-only token, `live_logs` waits.
- **The D1 Read token probe is no longer needed.** With L4 no token reads the D1. What was
  learned: Cloudflare's API reference lists **D1 Read** or **D1 Write** as accepted on
  `POST /accounts/{id}/d1/database/{id}/query`; whether a Read token refuses a write was never
  tested.

## 6. The fork it closed (L4)

| | A. Local only | B. A remote MCP on a worker, behind Cloudflare Access (chosen) |
|---|---|---|
| Who can use it | Programs on a PC that holds a token. A friend needs a token as a member of the Cloudflare account. | The emails on the Access policy. No token on any PC. |
| From where | That PC only. | Any Claude: claude.ai, the phone, cloud sessions and routines. |
| What it can read | Any SELECT, with a raw SQL tool. | The named queries only. |
| Record | None. | One log line per call. |
| The daily run | A task on his PC (off when the PC is off). | A cron on the worker. |
| Cost | Nothing to deploy. Each token reads every D1 in the account. | A route or worker and a deploy (his go), an Access app. |

## 7. Desk test (to write at build time)

## 8. As built

> **Part:** built · 2026-11-07

Where this disagrees with §3, this is the code. Version 0.2.0 (deployed 2026-11-07, his go): `ping`
and six of the seven tools of §3.2. Not built yet: `live_logs`, the fingerprint file and line
(§3.4) and the daily email (§3.7); §8.6.

### 8.1 The parts

- **The worker:** `../DeetsMusicAdminMCP` (made with `cf init`; `cf deploy`), worker
  `deetsmusicadminmcp`, on the custom domain `musicadmin.deets.solutions`. `workersDev: false`, so
  no address sits outside Access (checked: the workers.dev name answers 404).
- **Zero Trust:** turned on 2026-11-07 from the CLI. Team `deetssolutions.cloudflareaccess.com`
  (`deets` was taken). Sign-in: **Email code** (one-time PIN), the only identity provider.
- **The Access app:** `DeetsMusicAdminMCP`, self-hosted, on the whole hostname. Policy *Owner only*:
  his email. **Managed OAuth** on: Access runs the OAuth sign-in itself, so the worker holds no
  OAuth code, client secret or OAuth KV. This replaces the Access-for-SaaS plan in §5 (that one
  needs `workers-oauth-provider` in the worker). Dynamic client registration allows localhost,
  loopback and the claude.ai / claude.com callback. Access token 15 minutes, refresh 2 weeks.
- **The worker's own check (§3.8):** every request must carry a `Cf-Access-Jwt-Assertion` that
  `jose` verifies against the team's keys, issuer and the app's `aud`; else 403. The email from it
  goes to the tools (`getMcpAuthContext`) and to one log line per call.
- **The MCP:** `createMcpHandler` from `agents/mcp/server` (stateless, SDK v2
  `@modelcontextprotocol/server`), at `/mcp` only.

### 8.2 What was checked (2026-11-07)

- `POST /mcp` with no sign-in: 401, with a `WWW-Authenticate` that points to Access's
  protected-resource data.
- `/.well-known/oauth-authorization-server`: Access's endpoints, with dynamic registration and
  S256.

### 8.3 Desk test (his, open)

1. claude.ai › Settings › Connectors › Add custom connector, URL
   `https://musicadmin.deets.solutions/mcp`. Sign in with the email code. Ask Claude to run `ping`.
   Pass: `ok · signed in as <his email>`.
2. The same connector on the Claude mobile app. Ask for `ping`.
3. Claude Code: `claude mcp add --transport http deetsmusic-admin https://musicadmin.deets.solutions/mcp`,
   then `ping`.

**2026-11-07: passed from a Claude Code session.** He connected and signed in; this session's
`ping` returned `ok · signed in as <his email> · deetsmusic-admin 0.1.0` (the token reached the
worker and its JWT check passed). The tool came in as a claude.ai-style connector id, so the
claude.ai sign-in path likely works too; the phone is not tried yet.

A fail at step 1 or 2 means claude.ai does not take Access's Managed OAuth; then §5's fallback
(`workers-oauth-provider` in the worker) comes back to him as a fork.

### 8.4 The tools (0.2.0)

All read the `live` channel and the `deetsmusic` app. The SQL is in `src/queries.ts`; every query
passes a guard that refuses anything but one SELECT. The answers are plain text (`src/tools.ts`).

| Tool | Input | Returns |
|---|---|---|
| `live_check` | none | The "Needs a look" flags (the page's rules and words), then new posts and new replies from others on older posts since the last look (first look: 7 days). Moves the last look to now. |
| `live_reports` | `since`: a date, an ISO time or `last_look` (default 7 days) | The same new posts and replies, then every post waiting on his reply with its days. |
| `live_thread` | `pid` | The post (kind, state, public, votes, source, version, body) and its shown replies in order: you, poster, or member with their name. |
| `live_errors` | `week` (default the newest with reports) | Reports by version and by week; panics, freezes and log classes; error kinds with how, type and place, NEW when not seen before. Each as installs and a share of that version's reports. |
| `live_apple` | `week` | `apple.<group>.<class>` by group: installs, share of reports, and the least call count from the ranges. |
| `live_installs` | none | Active per day (15 days) and the 7-day means, yesterday's version mix, updates per version, the Setup.exe funnel by source, first starts, the minutes listened. |

- **Never returned:** a post's `code`, any `uid`, `meta` (only its version, as the admin list
  reads it). `code` is read to join a thread and stays in the worker.
- **The last look:** KV `deetsmusicadminmcp-state`, key `last_look` (unix seconds). Live's schema
  does not change and the worker has no D1 write.
- **The record:** `observability` on; one `tool_call` log line per call with the tool and the email.

### 8.5 One set of rules (§3.5, built)

- **The source:** `DeetsSolutions/deetsmusic/admin/flags.js` (plain ES5, `DeetsFlags`): `FLAG`, the
  waiting rule, the week and day helpers, and `compute()`, which returns each flag as a kind and
  raw numbers. The admin page loads it before `admin.js` and words each flag with `strings.js`;
  `admin.js` keeps thin wrappers (`isWaiting`, `waitSince`, `healthStats`, `seenBefore`, …).
- **The copy:** `npm run flags` in the worker writes `src/flags.gen.js`; `npm run check` (and so
  `npm run deploy`) fails when it differs. Types are in `src/flags.gen.d.ts`, by hand.
- **Pushed:** the admin page change is DeetsSolutions 3cedf63 (2026-11-08, at his word).
- **The worker's repo:** `deets-137/DeetsMusicAdminMCP`, private, like the other workers.

### 8.5a The first run (2026-11-07, 0.2.0, from a Claude Code session)

Every tool answered with live data. `live_check` (the first look, so 7 days): 3 flags (v1.2.1
freezes on 17% of W44 reports; v1.4.1 29% of installs at 0 minutes; "Microsoft Store" waiting 9
days), 12 new posts. `live_reports` since 2026-11-05: 4 posts, 3 poster replies, 2 posts waiting.
`live_thread` on "Microsoft Store": the post and its 3 replies. `live_errors` and `live_apple`: W44
(W45 has no reports yet), 38 reports. `live_installs`: 47 a day over the last 7 days, 79% on 1.4.1.

Read from the run: health reads the newest week **with reports** (W44, the 1.2.1 week), as the
page does, so the freezes flag is about an old version. The "Microsoft Store" wait is the poster's
"Great! Thanks!" after his last reply: the waiting rule counts any poster word.

Fixed in 0.2.1 (deployed 2026-11-08; checked with `live_reports`): a new post now lists its replies (`live_check` showed "0 new
replies" while a new post had them); "1 installs" / "1 votes".

### 8.6 Not built yet

- `live_logs`: needs the worker to read Workers Logs with a read-only token (§5).
- The fingerprint's file and line (§3.4): the release step must upload the maps to R2 first.
- The daily email on a flag (§3.7): a cron and Email Routing's `send_email` to his address.

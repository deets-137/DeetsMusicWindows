---
status: designed
desk_test: none
sources: [../DeetsSupport/schema.sql, ../DeetsSupport/src/usage.js, ../DeetsSupport/src/index.js, ../DeetsSolutions/deetsmusic/admin/admin.js, scripts/errors-where.mjs, scripts/usage-r2.mjs]
updated: 2026-11-04
---
# Live MCP — read the live support data from any Claude

> Designed 2026-11-01 (his ask: "better ways to query the live database rather than directly
> through the D1", then "MCP from the jump", then "the remote route so I can check on my
> phone"). Revised 2026-11-04 after a real read of the forum (L5 to L9). Not built. §1 is why. §3
> is the design. §4 holds his calls. §5 is what to check at build time.

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

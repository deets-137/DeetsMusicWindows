---
status: shipped
shipped_in: 0.27.0
desk_test: passed 2026-10-13
sources: [src/usage.ts, src/usage-rules.ts, src/usage-keys.ts, src-tauri/src/usage.rs, scripts/usage-keys.mjs, scripts/usage-r2.mjs, docs/ops/checks/usage-worker.mjs, src/settings-store.ts, src/agent-settings.ts, src/settings-card.ts, src/updater.ts, src-tauri/src/apple_calls.rs, src-tauri/src/log.rs, src-tauri/src/watchdog.rs, src-tauri/src/dbhealth.rs, src-tauri/src/apple.rs, README.md]
updated: 2026-10-30
---
# DeetsMusic — Usage counts: how many people use the app, and how

**The owner can see how many installs are active, which versions they run, which settings they
pick, and how healthy the app is on their PCs. No one can find out who any of those people
are.** Privacy is the first rule of this feature. Where privacy and a more useful number
disagree, privacy wins (his words, 2026-09-29: "keep privacy extremely highly prioritized
through it all").

**The terms.**
- *Install:* one copy of DeetsMusic on one PC.
- *Report:* one request from the app to DeetsSupport with usage data in it. There are three
  kinds (§3): the day count, the settings report and the health report.
- *DeetsSupport:* the owner's Cloudflare worker (`../DeetsSupport`). It already serves the token
  mint, the updater and the bug-report intake.
- *Linkable:* two pieces of data are linkable when the server, or anyone who reads its database,
  can tell that they came from the same install.

## 1. His calls (2026-09-29)

1. **On by default, with a clear off switch.** A row in Settings › About, a line on the Hop in
   screen ([HOP-IN.md](HOP-IN.md)), and a new Privacy paragraph in the README.
   **2026-10-23 (his calls):** off by default for an hour, then on again, with the switch on the
   grand opening's page 4 ([GRAND-OPENING.md](GRAND-OPENING.md) §10) and the hint "Anonymous
   counts, once a day and once a week. Nothing about you or your Apple ID: no ID, no songs, no
   place." Page 4 is the telling (`markUsageTold` in usage.ts writes the told key when it
   shows); so is turning the switch on by hand. **Later the same day (his call, for a pulse on
   how many people use the app):** closing the grand opening also opens the gate, page 4 seen
   or not, so a user who skips ahead sends with the switch on. This changes rule 10 (§2) for a
   new install: it is told by the switch on page 4 and in Settings › About, not before the first
   report. The README's Privacy paragraph says so.
2. **Scope:** active installs per day, week and month; the version mix; the on/off and choice
   settings once a week. **Added the same day:** error counts from the log and Apple call counts
   (the health report, §3.3).
3. **Settings storage: one row per weekly report, with no ID.** The owner can cross-check
   settings ("of the Glass users, how many use Mini?"). This is the one place a row per install
   exists, so §2 puts the most guards on it.
4. **No country.** Nothing about location is sent or stored.

**Closed 2026-10-13** (the old §9 forks; the forks 3, 4, 5, 7 and 8 had one option left under
the fork test, and he did not object):
5. **No small-group limit: real numbers (his call).** His words: "No worries about friends, we
   can use real numbers. Will be posting it to reddit first." The first users are strangers from
   Reddit, not people he knows, so a count of 1 does not point to a person he can name. §2
   rule 6 changed.
6. **The owner's view is the admin page (§6), built with the feature.** No wrangler-queries
   stage.
7. **Beta sends to its own `beta` bucket. Dev sends only to a local worker, never to
   production.** A `dev` bucket would fill with desk tests and with builds from the public repo;
   sending nothing would leave nothing to desk-test (§2 rule 11).
8. **Health storage: counters with buckets** (§3.3). No row per install.
9. **Expiry: 13 months for everything (his call).** A settings row and a counter both live 13
   months (§2 rule 7), so the cross-check covers a year. Was, earlier the same day: rows 4 weeks,
   then folded into share counters; he chose 13 months ("make it 13 months, same as the
   counters"), so there is no fold.
10. **The update notice gates the first send** (§7).
11. **Send the skin rows too (his call, 2026-10-21).** His words: "we should send metal as well,
    its not privacy invading or identifiable." Metal's four choice rows (`metalMaterial`,
    `metalGrain`, `metalCoverChange`, `metalPeek`) and Happy's Sky (`happySky`) move from
    NOT_REPORTED to REPORTED in `src/usage-keys.ts`. **Done 2026-10-23 (his go):** the list moved,
    `npm run usage:keys` copied it (DeetsSupport `6866b62`), and the worker was deployed first
    (version `ef8980c0`), so it takes the five keys before any app sends them. The app sends
    them from the next release.

## 2. The privacy rules

These rules are the design. Every later choice is tested against them. A change that breaks one
of them is a new fork for the owner, never a build detail.

1. **No ID of any kind.** No install ID, no random ID, no rotating ID, no hash of anything on
   the PC, no Apple or DeetsAccounts ID, no friend code. The app itself makes sure it counts once
   per day (§3.1), so the server needs no ID to count. **Added 2026-10-27 (his call, §12.9
   A4):** a report may carry a random key made for that one report, so the worker can drop a
   retry it already has. It lives 2 days on the server, is stored alone, and is never traced
   (the rules are in §12.9 A4).
2. **No IP address is stored.** Cloudflare must see the IP to deliver the request. The worker
   never reads it, never writes it, and never logs the request. No `cf.country`, no city, no
   ASN, no user agent, no request time finer than the UTC day or the ISO week.
3. **An allow-list, never a block-list.** A setting is sent only when its spec says
   `report: true` (§4). A new setting is not sent until someone decides it may be. Free text,
   paths, names, IDs, times, and slider values are never on the list.
4. **The three reports cannot be linked to each other.** They go in three separate requests, at
   three separate random moments (§3.4). Each is stored in its own table. No table shares a
   column that could join it to another. The settings row carries no version; the health report
   carries no settings.
5. **No row order.** A row carries no timestamp and no auto-increment number that shows the order
   of arrival. The settings table's key is a random value made by the server (§5), so two
   rows written one after the other cannot be told apart by their keys.
6. **Real numbers, no small-group limit (his call, 2026-10-13, §1.5).** The owner's view shows
   every count as it is, 1 included. Was: counts below 5 hidden. The limit guarded against the
   owner naming a friend from a rare setup; the first users come from Reddit.
7. **Data expires.** Rows and counters older than 13 months are deleted by the worker's
   existing 5-minute cron (§1.9). There is no archive.
8. **The user sees exactly what is sent.** The Settings row has a *Show what is sent* button. It
   shows the real JSON of the last report of each kind, and the next one. This is the same idea as
   the bug-report form, which shows the exact text before it sends (LOGGING.md §The report form).
9. **Off means off, at once.** With the row off, the app sends nothing: not the day count, not
   the settings, not the health. A report already waiting for its random moment is dropped.
10. **Nothing is sent before the user was told** (§7). **Changed 2026-10-23 (his call):** a
    new install sends once the grand opening has closed, whether or not page 4 was seen (§1, call 1). The text
    below is the rule as first written. A new install is told on the Hop in
    screen. An install that updates to the first version with this feature is told by a
    notice, and sends nothing until that notice has been shown.
11. **Only the release bundles send to production.** The live app sends `channel: "live"`, the
    Beta app `channel: "beta"` (§1.7). A dev build sends only to a local worker (`wrangler dev`),
    so a desk test can see a real send. The owner's own dev app, and a build from the public
    repo, are never counted.
12. **No new trust.** The request uses no cookie and no auth header. It is sent from Rust
    (`reqwest`), not from the page, so no browser header or cookie can ride along. The only
    fixed value in it is the existing build key header (`X-Deets-Build`), which names the
    official build and says nothing about the user (README › Privacy).

## 3. The three reports

### 3.1 The day count — active installs and the version mix

Once per UTC day, at most. The app keeps the date of its last day count in its own settings
(`usageLastDay`, never sent). On the first launch or the first hour of use on a new UTC day, it
sends:

```json
{ "v": "0.26.0", "channel": "live", "week": true, "month": false }
```

- `v` — the app version.
- `week` — true when this is the first day count of this ISO week for this install.
- `month` — true when this is the first day count of this calendar month.

The app works out `week` and `month` from its own stored date. The server only adds 1 to three
counters: `(day, v)`, and, when the flags say so, `(week, v)` and `(month, v)`. So:
- **Daily active installs** = the day's counters summed.
- **Weekly active installs** = the week's counters, counted once per install by the app's own
  flag.
- **Monthly active installs** = the same, per month.
- **The version mix** = the counters split by `v`.

No row per install exists for this report. It is counters only.

### 3.2 The settings report — once per ISO week

```json
{ "channel": "live", "settings": { "skin": "glass", "theme": "dusk", "surface": "max",
  "glassFancy": true, "backgroundMotion": "reduced", "sleepTimer": false, "…": "…" } }
```

- Only keys whose spec says `report: true` (§4).
- Only choice and on/off values. A value outside the key's known options is sent as `"other"`,
  never as the value itself. This catches a value that a bug or an agent wrote.
- No version, no date, no counts, no card sizes, no times.
- The server writes one row: a random key, the ISO week, the channel, and the settings as
  JSON (§5).

### 3.3 The health report — once per ISO week

Counts only, summed over the week on the PC. It never carries a message, a path, a URL, an ID or
a song.

```json
{ "v": "0.26.0", "channel": "live",
  "log": { "error": { "apple": 3, "db": 0, "player": 1, "other": 0 },
           "warn":  { "apple": 12, "player": 4, "other": 2 } },
  "panics": 0, "freezes": 1, "dbWriteFails": 0,
  "apple": { "library": { "2xx": 820, "429": 0, "5xx": 2, "net": 5 },
             "catalog": { "2xx": 1403, "404": 3 }, "search": { "2xx": 61 }, "…": "…" },
  "backoffArms": 0 }
```

- **Error counts.** `log.rs` counts each ERROR and WARN line by its area: the word before the
  first `:` in the message (`apple:`, `player:` …). Only areas on a fixed list in the code are
  sent by name. Any other area is added to `other`. The text of a line never leaves the PC.
  A Content Security Policy block is one WARN line in its own area per directive
  (`csp-connect-src`, …), so the report counts blocks per directive and never their host
  (his call C1, 2026-10-21, `architecture/CSP.md` §9, §12.2). The worker takes these names as they are.
- **Panics, freezes, database write failures.** The panic hook, the freeze watchdog
  (`watchdog.rs`) and the database canary (`dbhealth.rs`) each add to a count.
- **Apple calls.** The totals from `apple_calls.rs` (its 6 groups × 8 status classes), and the
  number of times the 429 back-off armed. Today `total` resets at each launch, so the week's sum
  is kept in a small file beside the log and added to at each hourly line and at quit.
- **Storage: counters, not rows (§1.8).** The server adds each number into a
  counter per `(week, v, metric, bucket)`. A bucket is a range (0, 1–9, 10–99, 100–999,
  1,000+). So the owner sees "12 installs on 0.26.0 had 1–9 Apple errors this week", and the
  spread, with no row per install at all.

### 3.4 When the reports leave

- The day count: at a random moment in the first hour the app is open on a new UTC day.
- The settings report and the health report: each at its own random moment during the week,
  on a day the app is open, never in the same minute as each other or as the day count.
- A report that fails is tried once more at the next launch, then dropped. It is never queued
  for more than its own day or week.
- Every send and every skip writes one `diag.log` line (`usage:send`, `usage:skip`, `usage:off`)
  with the kind, never the content.

## 4. The allow-list

The settings report reads the same spec list the agent already uses (`SPECS` in
`src/agent-settings.ts`, about 110 entries on 2026-10-13). A new field, `report: true`, marks a key that may be
sent. Rules for the list:

- **May be on the list:** `toggle` and `choice` keys; the theme, skin and surface.
- **Never on the list:** `range` (sliders), `time`, `size`, anything with free text, a path, a
  name, an account, a friend or room code, a Last.fm name, a picture, and every consent gate's
  history (only its current on/off may be sent).
- **Rules and recipes:** the count of rules and which built-in recipes are on may be sent. The
  words of a custom rule never are.
- A key that is not in `SPECS` today (not every Settings row has an agent spec) needs a spec
  before it can be reported. That keeps one list, not two.

**The first list (his call, 2026-10-13).** Every `toggle` and `choice` spec gets `report: true`,
the account and sharing toggles included: `lastfmScrobble`, `lastfmNowPlaying`,
`shareActivityDiscord`, `shareActivityApp`, `discordRoomInvite`, `friendsListenAlong`,
`friendsRoomInvite`, `agentControl`, `agentSettings`, `agentHistory`, `agentDiary`, `sotd`. His
words: "this data is only available to me and is not truly PII. Imagine there are thousands of
users." Each sends its current on/off only, never an account name or code.
- **Not sent:** every `range` (the Ocean and Glass sliders, `webSkipSeedAt`), every `time`
  (`sotdPostAt`, the look times), every `size`, and `sunShift` (minutes, close to a time).
- **Sent as a built-in name or `"custom"`:** `soundEqPreset`. A custom preset's ID points to a
  preset the user named.
- A new spec added later is NOT sent until someone sets `report: true` on it (§2 rule 3).

## 5. DeetsSupport: routes and tables

Three routes on the `support.` host, all `POST`, all answer `204` with no body, whatever
happens. They never touch `/token`, and `/token` never waits on them.

```
POST /usage/day        the day count        → counters
POST /usage/settings   the settings report  → one row
POST /usage/health     the health report    → counters
```

- A new switch `KILL_USAGE` in `wrangler.jsonc` turns all three off (still `204`, so the app
  sees no change).
- A rate limit per the existing binding pattern (`limited(env, req)`), so a script cannot fill
  the tables. The IP is used only by Cloudflare's rate-limit binding, in memory, and is never
  stored.
- The route rejects any key it does not know, and any value longer than 32 characters. So even a
  broken or modified app cannot store free text.
- Writes run after the response (`ctx.waitUntil`), like the mint counter.

```sql
CREATE TABLE usage_counts (       -- the day count and the health report
  period   TEXT NOT NULL,         -- '2026-09-29', '2026-W40' or '2026-09'
  channel  TEXT NOT NULL,         -- 'live' | 'beta' | 'dev'
  v        TEXT NOT NULL,
  metric   TEXT NOT NULL,         -- 'active' | 'log.error.apple' | 'apple.library.429' | …
  bucket   TEXT NOT NULL,         -- '' for 'active'; '0' | '1-9' | '10-99' | … for health
  n        INTEGER NOT NULL,
  PRIMARY KEY (period, channel, v, metric, bucket)
) WITHOUT ROWID;

CREATE TABLE usage_settings (     -- one row per weekly settings report
  id       TEXT PRIMARY KEY,      -- random, made by the worker; no order, no meaning
  week     TEXT NOT NULL,         -- '2026-W40'
  channel  TEXT NOT NULL,
  settings TEXT NOT NULL          -- JSON, allow-listed keys only
) WITHOUT ROWID;
```

`WITHOUT ROWID` with a random key removes the hidden row number that shows the order of arrival
(§2 rule 5).

## 6. The owner's view

An owner-only page at `support.deets.solutions/admin/usage`, behind the existing owner check
(`/admin/me`, `OWNER_UID`). It shows:
- active installs per day, week and month, and the version mix, on the live channel;
- each reported setting as a share ("Glass 41 %");
- a cross-check: pick two settings, see the table;
- the health spread per version.

Every number shows as it is (§2 rule 6). The cross-check is computed in the worker over the
stored rows (up to 13 months), and the page never gets the raw rows. The page is built with the feature (§1.6).

> **Part:** LIVE · 2026-10-14 (the worker, its D1 tables and the page). Where it disagrees with the lines above, this is the code.

**As built.** Not a page on the worker: its own owner page, deets.solutions/deetsmusic/admin/
(his calls, 2026-10-14: build it on his owner pages, then a separate admin page; moderation stays
inline on the boards). Owner mode on the DeetsMusic page links to it. The worker answers
`GET /admin/usage` JSON and the page draws it (DeetsSolutions `docs/support.md`, "The admin
page"). Pickers for channel and week; the four headline counts; 60 days of daily installs;
the week's version mix; one setting's shares; the cross-check of two settings over the chosen
week (one row per install); and **every** health metric (his call, 2026-10-14), per version or
all. His strings (approved 2026-10-14). `?mock` shows it with made-up counts.

## 7. How the user is told

- **A new install:** one line on the Hop in screen, under the Cruisin / Pro pick, with the
  switch next to it. Nothing is sent before the user leaves the Hop in screen. Until Hop in is
  built, a new install gets the same notice as an update.
- **An install that updates into this feature:** a sticky notice (TOASTS.md) with three
  buttons: *Show what is sent*, *Turn off*, *OK*. Nothing is sent until that notice has been
  shown. Closing it counts as *OK*. **Retired 2026-10-23 (his call):** no install updates into
  this feature before the grand opening. Its key (`deets-usage-notice`) is still the told gate,
  so an install that answered it keeps sending. The grand opening's page 4 writes it now, and so
  does turning the row on.
- **The release notes** of that version name the feature in its own line, first.
- **The README › Privacy** section loses "No analytics" and gains a *Usage counts* paragraph:
  what is sent, what is never sent, the off switch, and the 13-month expiry.
- **Settings › About** gets the row, with the *Show what is sent* button (§2 rule 8).

## 8. Where it lives in the app

- `src/usage.ts` — builds the settings report from `SPECS`, decides the random moments, holds
  the off switch, the notice gate and *Show what is sent*.
- `src-tauri/src/usage.rs` — the week's health counts (fed by `log.rs`, `apple_calls.rs`,
  `watchdog.rs`, `dbhealth.rs`), the stored week file, and the one `async` send command
  (`spawn_blocking` for the file read; never a sync command, CLAUDE.md › Conventions).
- A new settings key `usageReports` (default on, with the why), its agent spec (an agent may turn
  it off, never on, like the other consent gates), a line in AGENT.md, a `NEW_MARKS` line, a
  hover hint in the ONBOARDING.md §1 ledger, and a row in TOASTS.md §5 for the notice.

## 9. Still open

1. **The words.** The Settings row, its hint, the Hop in line, the update notice, and the
   README paragraph. Built with the draft (his call, 2026-10-13: "build out steps 1 to 4 with
   the draft"); he edits them on screen (Alt+E, COPY-EDIT.md).

The allow-list closed on 2026-10-13 (§4, the first list). The forks 3 to 8 closed on 2026-10-13
(§1.5–§1.10).

## 10. Desk test

> **Part:** desk test passed · 2026-10-13 (step 8 half: the in-window delete not seen in a cron run)

The dev app sends only to a local worker, so the whole chain runs on this PC.

**Setup.**
1. In `../DeetsSupport`: `npx wrangler@4 d1 execute deets-support --local --file=schema.sql`,
   then `npx wrangler@4 dev --port <free port> --test-scheduled`.
2. Start the dev app with `DEETS_USAGE_BASE=http://localhost:<port>` in its environment
   (`npm run dev:app`). Without it, the dev app sends nothing and logs one `usage:` line per try.
3. Read what the worker stored: `npx wrangler@4 d1 execute deets-support --local --command
   "SELECT * FROM usage_counts"` (and `usage_settings`).

**The steps.**
1. **The notice gates the first send.** A profile that never saw it: 20 s after launch the
   notice shows. Before a button is pressed, the diag ring has no `usage:send` and the
   worker's tables stay empty. Press *Got it*: within 30 s, `usage:plan` lines show for each
   due kind.
2. **The day count.** `__usage.send("day")` in DevTools sends it now. The worker holds one
   `active` row for today, one for this week (`week: true` the first time) and one for the
   month. A second `__usage.send("day")` the same UTC day logs `usage:skip … sent today`.
3. **The settings report.** `__usage.send("settings")`: one `usage_settings` row, this week,
   channel `dev`, the allow-listed keys only, each as an option value. No slider, no time, no
   size. An EQ preset you named shows as `"user"`.
4. **Show what is sent.** Settings › About › What is sent › *Show*: the panel shows each kind's
   next report, and the last one with its day. The JSON matches what the worker stored.
5. **Off means off.** Turn *Send usage counts* off: `usage:off` with the dropped kinds. A
   `__usage.send("day")` after that logs `usage:skip … off` and the worker stores nothing.
6. **The health report.** It sends the LAST finished week, so the first one needs a week to
   pass. To try it now: quit the app, edit `usage-week.json` in the dev data folder so `week`
   is last week's, launch, then `__usage.send("health")`. The worker holds a `reports` row and
   one row per counted metric under last week; `usage-week.json` loses its `pending`.
7. **Health counts.** A forced 429 (`apple_force_429`, DEBUGGING.md) raises `backoffArms` and
   `apple.<group>.429` in *Show what is sent* (this week so far) after the next fold (hourly,
   at quit, or on opening the panel).
8. **The cron.** `curl "http://localhost:<port>/__scheduled?cron=*/5+*+*+*+*"` between 00:00 and
   00:04 UTC deletes rows older than 13 months; at other times it leaves them.

**Results (2026-10-13, late; the dev app hidden, a local worker on 8791):**

| Step | Result | Seen |
|---|---|---|
| 1 The notice | pass (his eye) | He saw the toast. On the next launch, with the notice answered, `usage:plan` showed the day count (20 min) and the settings report (70 min), and no health report (no finished week yet) |
| 2 The day count | pass (Claude) | Three `active` rows: the day, `2026-W42`, `2026-10`, channel `dev`. The second send: `usage:skip … sent today` |
| 3 The settings report | pass (Claude) | One row, `2026-W42`, 128 keys, every value a token. No slider, time, size, `sunShift` or `usageReports`. The 9 keys not in it are the Adaptive sound rows, whose specs do not exist while that feature is hidden (SOUND.md §11a). The `"user"` preset value is covered by the unit test only |
| 4 Show what is sent | pass (his eye) | He saw the panel |
| 5 Off means off | pass (Claude) | A click on the row: `usage:off` dropped `day` and `settings`. Sends while off: `usage:skip … off`; the worker's row counts did not change. On again: nothing new planned |
| 6 The health report | pass (Claude) | With the week file set to `2026-W41`, the send stored nine rows under `2026-W41` (ranges plus `reports`); the file then held `2026-W42` and no pending week |
| 7 Health counts | pass (Claude) | `apple_force_429` and one search: `search.429: 1`, `backoffArms: 1`, `warn.apple: 1` in this week's counts |
| 8 The cron | half (Claude) | Off the window (06:55 UTC) a 2024 row stayed. The in-window delete was not seen in a cron run; its SQL ran on the local database on 2026-10-13 |

## 11. As built (2026-10-13)

> **Part:** built · 2026-10-13 (steps 1–4 of the scope: the worker, the Rust side, the pure
> rules, the front end. The admin page (DeetsSolutions, §6) and the README / release-note lines
> followed on 2026-10-14.)

Where this record and the design above disagree, this record is the code.

**The worker** (`../DeetsSupport`, not deployed; the deploy and the D1 migration are his call):
- `src/usage.js`: the three `POST /usage/*` routes (always 204), `GET /admin/usage` behind the
  owner check, and `expireUsage` in the 5-minute cron, which acts only in the run between 00:00
  and 00:04 UTC. `migrations/2026-10-13-usage.sql` adds the two tables (also in `schema.sql`),
  plus an index on `usage_settings (channel, week)`.
- **One statement per report.** Each report is one `INSERT … SELECT … FROM json_each(?)`
  upsert, because D1 counts every statement of a batch against the per-request limit.
- **The health report is stored under the week it covers** (`week` in the body, accepted only
  for this ISO week or the one before), not the week it arrives in.
- **Only counts above 0 are written**, plus a `reports` row per health report. The `0` bucket
  is `reports` minus the rest.
- **The settings keys come from a generated list** (`src/usage-keys.js`), written by
  `npm run usage:keys` from the app's `src/usage-keys.ts`. The design said a `report: true` field
  on each spec; a list file instead, because the worker needs the same list. A key the worker
  does not know is dropped, not the whole report, so a new key waits for a worker deploy.
- A value must match `^[A-Za-z0-9._:+-]{1,32}$` (no space, so no sentence). A log area must
  match `^[a-z][a-z-]{0,15}$`, 40 areas at most. The Apple groups and classes are fixed lists.
- `USAGE_RL` (20 per 60 s per IP) and `KILL_USAGE` in `wrangler.jsonc`.
- Checked on `wrangler dev` with real requests: the unknown key, the value with spaces, the bad
  area, the unknown Apple group, the old week and a non-DeetsMusic client were each dropped;
  the admin queries and the cross-check ran on the stored rows.

**The app:**
- `src/usage-keys.ts`: `REPORTED` (137 keys with the card and room lists expanded) and
  `NOT_REPORTED` (`sunShift`, `usageReports`). `tests/usage-keys.test.ts` fails while a toggle
  or choice spec is on neither list, when a slider, time or size is on `REPORTED`, and when the
  worker's copy differs.
- `src/usage-rules.ts` (tested): the UTC day, the ISO week, the day count's flags, the weekly
  due rule, two tries per period, `settingValue`, the random moment and the one-minute gap.
- `src/usage.ts`: `initUsage` (a late boot part). The notice 20 s after launch, once
  (`onceKey`); nothing is planned until one of its buttons is pressed. Then each due report
  at a random moment: the day count in 3–60 min, the weekly reports in 3–90 min, re-checked
  hourly. Diag lines: `usage:plan`, `usage:send`, `usage:skip`, `usage:off`, `usage:fail`,
  `usage:notice`. The state (`deets-usage`) and the last sent bodies (`deets-usage-last`) are in
  localStorage. `__usage.send(kind)` in DevTools (dev only).
- `reportedSettings` in `agent-settings.ts`: reads each allow-listed spec's value through its
  own `get`.
- `src-tauri/src/usage.rs`: the counts (hooks in `log.rs` `write`, `apple_calls.rs` `count` and
  `on_429`, `watchdog.rs`, `dbhealth.rs` `note_fail`; a panic is the hook's `panic:` line); the
  fold into `usage-week.json` on the hourly Apple calls line and at quit (no new thread);
  `usage_health` and `usage_send` (both async, file work in `spawn_blocking`). Rust sets
  `channel` from the build (`cfg!(debug_assertions)` → dev, which covers `dev:built`) and `v`.
- Settings › About: *Send usage counts* (toggle, `usageReports`, New badge) and *What is sent*
  › *Show*, a panel on the menu halves' shell with the report form's preview box per report
  (`wireUsagePanel`). The privacy line under About names the usage counts.
- **Inside his choices, decided in the build** (for his review): the notice button is the
  primitive's *Got it*, not *OK*; *Show what is sent* sits on its own row under the switch, not
  in the switch's row (the switch row stays a plain toggle the Compass can reach); the panel is
  a dropdown under *Show*; the timings above (20 s, 3–60 min, 3–90 min, hourly); Reset never
  turns the switch back on (no Reset group holds it).
- **Not sent yet:** the count of rules and the built-in recipes that are on (§4 allows them;
  his call named the toggle and choice specs only).

## 12. Updates and first-install downloads

> **Part:** designed · 2026-10-27 (his ask: an exact version split, a ping when an update
> downloads and when it applies, and a count of first-install downloads). Not built. §12.7 his
> calls. His words the same day: "I want stats to be as accurate as possible on the admin
> dashboard including pre-existing ones", so §12.9 is the accuracy audit of the counts that
> exist today. Every fork is closed (A4 his call, the same day).

**The terms.**
- *Downloaded:* the app has a new version on disk, checked against the signed feed
  (`update_download` reached `ready`, VELOPACK.md §4).
- *Applied:* the first start of the app on a version that is different from the version of its
  last day count.
- *Setup download:* one `GET` of `DeetsMusic-<v>-Setup.exe` from the update route. This is a
  first install from the website, before any app exists on the PC.

### 12.1 What is wrong today, and what R2 shows now

**The version split lags.** The day count carries `v`, but the app state (`deets-usage`) keeps
only the day, week and month of the last count, not its version (`usage-rules.ts` `dayCount`).
So:
- An update during the day shows on the next day's count.
- The `(week, v)` and `(month, v)` counters go up only on the first count of that week or month.
  An install that starts the week on 1.1.2 and updates on Wednesday stays on 1.1.2 for the whole
  week, and for the whole month in the month view. Weekly and monthly adoption shows too slowly.

**R2's own numbers (read 2026-10-27).** Cloudflare's GraphQL Analytics
(`r2OperationsAdaptiveGroups` on the bucket `deetsmusic-releases`, by `objectName`,
`actionType: GetObject`) already counts every Setup.exe and package fetch per day, with no
change to the code. The wrangler login token can read it. It goes back 4 weeks and 4 days at
most per query. What it showed:

| Object | GETs | Days |
|---|---|---|
| `DeetsMusic-1.0.0-Setup.exe` | 43 | 2026-10-24 to 10-26, at uneven hours (people, most likely) |
| `DeetsMusic-1.1.2-Setup.exe` | 135 | 2026-10-26 21:00 UTC to 10-27 20:00 UTC |
| 1.1.2 delta + full packages (updates) | 18 | 2026-10-26 to 10-27 |

**The 1.1.2 Setup.exe count is almost all a timer.** From 2026-10-26 22:00 UTC, the file is
fetched exactly 6 times each hour (every 10 minutes), each a full 23 MB. It is not DeetsSupport's
own cron: the installer health probe uses `HEAD` (`installerHealth`), and those show as
`HeadObject`. No script in `Documents` fetches it.

**The caller (investigated 2026-10-27, the zone's HTTP analytics, `httpRequestsAdaptiveGroups`
filtered to `*Setup.exe`; the free plan gives the User-Agent and country, not the ASN, query or
referer):**
- 123 of the 130 Setup.exe requests on 2026-10-27 carry one User-Agent: `Mozilla/5.0 (Windows
  NT 6.2; WOW64; rv:19.0) Gecko/20100101 Firefox/19.0`, a browser from 2013 on Windows 8, from
  the US. No person runs it. It is a fixed string that a program sends.
- That User-Agent asks for nothing else on deets.solutions: never the release list
  (`/update/deetsmusic/releases`), never the site. So it got the file's address from somewhere
  outside our hosts.
- It first came on 2026-10-26: 2 fetches of the 1.0.0 Setup.exe, then 3 of the 1.1.2 one, then
  the 10-minute rhythm.
- The same day, the session "Velopack and Microsoft Store compatibility" chose to submit the
  Velopack Setup.exe to the Microsoft Store as a Win32 app, with its versioned URL as the
  Partner Center *Package URL*. `store-art/` (the Store's 1:1 box art and 2:3 poster) was made
  that evening.
- 6 more requests on 2026-10-27 carry `Microsoft-Delivery-Optimization/10.1`: Windows' own
  download service, which the Store uses to fetch a Win32 app's installer.

**Conclusion: most likely Microsoft's Store pipeline** (certification, then a watch that the
binary at the Package URL does not change; Microsoft requires that it never changes after
submission). Not proven: Microsoft does not document the check's rhythm. Partner Center's
status for the submission confirms or rules it out. It costs nothing that matters (R2 egress is
free; ~4,300 reads a month against 10 million free). **Do not block it**: a Store check that
fails can fail the listing. The `Microsoft-Delivery-Optimization` requests are most likely real
installs from the Store, so they are first-install downloads (§12.3 counts them as `store`).

This is the reason R2's count alone cannot be the measure: it cannot tell a person from a
machine, and it cannot tell a finished download from a broken one.

**The live D1 numbers show the version lag (read 2026-10-27, `usage_counts`, channel live).**
On 2026-10-27, 11 installs counted on 1.0.0 and 3 on 1.1.2. The week 2026-W44 shows 16 on 1.0.0
and 1 on 1.1.2, and October shows 0.27.0 and 0.28.0 for two installs that have since updated. R2
shows 18 update packages for 1.1.2 fetched in the same day. So most installs on 1.1.2 still show
under 1.0.0. The settings rows match the weekly active counts (W42 2, W43 13, W44 17), so no
duplicate settings report shows in the data so far.

### 12.2 The two app reports

One new route, `POST /usage/update`, beside the three in §5. It is sent from Rust (`usage_send`
gets the kind `update`), at a random moment, and it follows every rule in §2: no ID, the switch,
the told gate, not in the same minute as another report.

**Downloaded.** When an update reaches `ready` (`download()` in `updater.ts`, or a check that
finds it already `ready`), the app plans:

```json
{ "event": "downloaded", "channel": "live", "from": "1.1.2", "to": "1.2.0", "rollback": false }
```

- Once per install per version: the state keeps `downloaded: "1.2.0"` after a send that
  reached the worker. A second download of the same version (after *Skip this version* is
  cleared, or a failed apply) is not sent again.
- It leaves 3–60 minutes after `ready`, like the day count. If the app restarts first, the
  report is sent on the next launch, before the applied report (the state still holds the
  download).
- The worker adds 1 to `(day, channel, to, 'update.downloaded', bucket)`, where the bucket is
  `''` or `'rollback'`.

**Applied (the move).** The app state gains `v`: the version of the last day count that reached
the worker. On a launch where the running version is not `state.v`:

```json
{ "event": "applied", "channel": "live", "from": "1.1.2", "to": "1.2.0",
  "day": true, "week": true, "month": true, "rollback": false }
```

- `day`, `week` and `month` are true for each period in which this install already counted
  under `from` (its stored day, week or month equals the current one).
- The worker, for each true flag: subtracts 1 from `(period, channel, from, 'active')` (never
  below 0) and adds 1 to `(period, channel, to, 'active')`. The totals do not change. The
  install moves from one version to the other in that period. The worker also adds 1 to
  `(day, channel, to, 'update.applied', bucket)`.
- When no flag is true (the first launch on a new day, week and month), the normal day count
  sends `to` and no move is needed. The `update.applied` counter still goes up.
- After a send that reached the worker, `state.v` becomes the running version. If it fails, the
  next launch sees the same difference and sends again. So the report repairs itself and counts
  once.
- A rollback (Settings › Updates › Roll back) is the same move with `rollback: true` and the
  bucket `'rollback'`.

**What the counters then mean.**
- `active` per day, week and month: installs whose **latest** version in that period is `v`.
- `update.downloaded` and `update.applied` per day and version: the adoption of each release.
- `downloaded − applied` for a version: installs that hold the update and have not restarted.
  An update applies at the next start (VELOPACK.md F1 A), so this is how long people keep the
  app open.

### 12.3 Setup downloads, counted by the worker

No app exists yet, so no switch applies. The worker counts in `serveVp` (`update.js`), on a
`GET` of a name that matches `VP_SETUP`:

- **Started:** 1 into `(day, channel, v, 'setup.start', source)` when the response starts.
- **Finished:** the R2 body goes through a `TransformStream` that counts the bytes. When the
  stream ends with every byte sent, 1 goes into `(day, channel, v, 'setup.done', source)`
  (through `ctx.waitUntil`, so `handleUpdate` needs the `ctx`). A download that the browser
  cancels never reaches the end, so it is not counted as finished.
- **The source** (the bucket), the first rule that matches:
  - `store`: the User-Agent starts with `Microsoft-Delivery-Optimization/`: a Microsoft Store
    install (§12.1).
  - `site`: the link from the website. `listReleases` adds `?from=site` to `row.url`, so the
    install box on deets.solutions carries it with no change in DeetsSolutions.
  - `check`: the exact User-Agent of the 10-minute caller in §12.1. It is one string in the
    worker, named for what it is, so a change of that caller's string shows as a jump in
    `direct`, never as new users.
  - `bot`: a request whose User-Agent is empty or names a script or crawler (`bot`, `spider`,
    `crawl`, `curl`, `wget`, `python`, `go-http`, `headless`; a short fixed list). It is read
    in memory to choose the bucket and never stored, like the `DeetsMusic/` check on the usage
    routes.
  - `direct`: every other request (a link shared on Reddit that names the file, a download
    manager).
- The channel maps `deetsmusic` → `live` and `deetsmusic-test` → `beta`. `v` comes from the file
  name.
- `HEAD` requests (the health probe) are never counted.
- A `KILL_USAGE` switch stops this count too, and the download still works.

`setup.done` from `site` plus `store` is the first-install download number. The timer in §12.1
lands in `check`, so it is visible but kept apart.

### 12.4 The admin page

On deets.solutions/deetsmusic/admin/ (§6), two new parts. Their layout and words are his to
approve, like the page's other strings:
- **Updates:** one row per version: downloaded, applied, waiting (the difference), rollbacks;
  the day each count started.
- **Setup downloads:** per day and version: finished from the site, finished direct, bots,
  and started but not finished.

`GET /admin/usage` returns the new metrics with the others. The page reads them by name.

### 12.5 The privacy check (§2)

| Rule | Holds? |
|---|---|
| 1 No ID | Yes. `from` and `to` are versions that thousands of installs share. |
| 2 No IP | Yes. The setup count reads the User-Agent in memory only, and stores nothing per request. |
| 4 Not linkable | Yes. The update report is a counter. The settings row has no version, so `from` / `to` cannot join it. |
| 5 No order | Yes. Counters only, no rows. |
| 9 Off means off | Yes for the app reports. The setup count has no app and no switch: it counts a web request, like the R2 analytics Cloudflare already keeps. |
| 10 Told first | Yes. The same gate as the day count. |

The README's Privacy paragraph gains one sentence: "When an update downloads and when it
applies, the app sends the two version numbers, as a count."

### 12.6 What can still be wrong

- A forged `applied` report can move counts from one version to another (it subtracts). The
  `USAGE_RL` limit bounds it, as it bounds a forged day count (the faults in the answer of
  2026-10-27: no ID means the worker cannot tell a real report from a script).
- Cleared localStorage loses `state.v`. The next day count is then a new count, and no move is
  sent. This is the same fault as in §3.1.
- The setup count's `bot` list catches only callers that name themselves. A script that copies
  a browser's User-Agent counts as `direct`.

### 12.7 His calls (2026-10-27)

1. **Count a new install's first start: yes.** The day count gains `new: true` when the app has
   no usage state at all, and the worker adds 1 to `(day, channel, v, 'install.first')`. With
   §12.3 this gives the full path: download → first start → active. An uninstall keeps the user
   data unless *Delete app data* is on (RELEASE.md), so a reinstall is not counted as new; with
   that box on, it is a new install, and it counts as one.
2. **Keep the R2 analytics read as a check: yes.** `npm run usage:r2` prints, per day, R2's
   Setup.exe and package GETs, the zone's Setup.exe requests by source (the same rules as §12.3,
   from the User-Agent), and the worker's own counts beside them, so a gap between them shows a
   fault. It uses the wrangler login token, and reads 4 weeks at most per query.

### 12.8 The build, in order

1. The worker: `POST /usage/update`, the setup count in `serveVp`, `?from=site` in
   `listReleases`, the new metrics in `GET /admin/usage`. No new table (`usage_counts` holds it
   all). **The deploy is his call, and it comes first**, so the worker takes the report before
   any app sends it.
2. The app: `v` and `downloaded` in the usage state (`usage-rules.ts`, with tests: the flags of
   a move, a failed send repeated, a rollback), the plan in `usage.ts`, the kind `update` in
   `usage.rs`. *Show what is sent* shows the next update report.
3. The admin page in DeetsSolutions (§12.4).
4. The README sentence (§12.5). No release-note line: 1.2.0's draft paragraph was taken out
   (his call, 2026-10-27: users do not care, and the *Send usage counts* row did not change).
5. The desk test: the dev app against a local worker (§10's setup). A forced update to a local
   feed gives `downloaded`; a restart gives `applied` with the moved counts; a curl of a local
   Setup.exe, complete and cut short, gives `setup.start` and `setup.done`.
6. The accuracy fixes in §12.9 (A1, A3, A4, A5, A6) go in the same worker
   deploy and the same app release as steps 1–2.

### 12.9 The accuracy audit of the counts that exist today

His ask: every number on the admin page as accurate as possible, the old ones too. Each fault
below was checked against the code (`usage.ts`, `usage-rules.ts`, DeetsSupport `usage.js`) on
2026-10-27.

**A1. A short session never counts (an undercount, and a bias).** The day count leaves at a
random moment 3–60 minutes after launch (`DAY_WINDOW`, `FIRST`), and the moment is drawn again
at each launch. A user who opens the app for 10 minutes a day is counted on about 1 day in 8. The
weekly reports wait 3–90 minutes, so the settings shares and health counts come mostly from
installs that stay open: a bias toward long sessions in every share. (These timings were
Claude's, for his review, §11.)
*Fix:* the random moment is measured in **open time**, and it is kept across launches. The app
draws the moment once per period (day count: 20 s to 5 min of open time that UTC day; weekly
reports: 1 to 30 min of open time that week), adds the time the app is open (a minute tick, saved
in the usage state), and sends when the sum passes the moment. The moments stay random and at
least a minute apart, so §2 rule 4 holds, and every install that is open long enough in the
period counts.

**A2. The version split lags.** §12.1's numbers. *Fix:* §12.2's move report. The weeks and
months before the release with the fix keep the lag: there is no record to correct them from.
The admin page marks those periods "version mix lags (before 1.x)" so they are not read as exact.

**A3. Two clocks decide the day.** The app decides "a new UTC day" by the PC clock; the worker
files the count under its own day (`periods(new Date())`). A count planned at 23:59 that
arrives at 00:01 is filed under the new day, and the app sends again that day: one install
counted twice in one day and zero times in the other. A PC clock that is wrong does the same at
any hour. *Fix:* the day count and the move report carry the app's `day` (`2026-10-27`). The
worker files them under that day, its week and its month, and accepts it only within one day of
its own date (else it drops the report). One clock, the app's, decides every period of one
install.

**A4. A lost answer counts twice.** The worker writes after it answers (`ctx.waitUntil`). If the
answer does not reach the app, the app sends again at the next launch and the worker stores it
again. *Fix (a rule question):* each report carries a key made once for that report: random, a
new one for every report, the same one only on its retry. The worker keeps the key 2 days in its
own table (`usage_seen`, the key alone) and drops a report whose key it has seen. Two reports of
one install have two unrelated keys, so nothing links them, and the key is gone in 2 days. §2
rule 1 (2026-09-29) says "no random ID". It was written against an ID that follows an install;
this key does not.

**His call (2026-10-27): yes**, "as long as there's no way for us server-side to trace the key".
So the key follows these rules:
- **Made by the app, from nothing.** 16 bytes from the OS random source (Rust `getrandom`),
  never derived from a time, a version, a counter or anything on the PC. A new key for every
  report; the same key only on that report's retry.
- **Gone from the app when the report lands.** The app holds the key only inside the pending
  report in the usage state. When the worker has the report, the app deletes it. No list of
  sent keys exists, so the app cannot show one, and an agent or a support request cannot ask
  for one.
- **In the body only.** Never in the URL or a header, so Cloudflare's request analytics and
  Workers Logs never see it. The worker never logs it (the same rule as the token and the IP,
  index.js "Never log a token or a client IP").
- **Stored alone.** `usage_seen (key TEXT PRIMARY KEY, day TEXT) WITHOUT ROWID`: the key and
  the UTC day it arrived, nothing else. No channel, version, period or metric, so no column
  joins it to `usage_counts` or `usage_settings`. The random primary key and `WITHOUT ROWID`
  keep no order of arrival (§2 rule 5).
- **Deleted after 2 days** by the 5-minute cron, in its 00:00–00:04 UTC run.
- **Never read out.** No admin route returns it; the worker only asks "seen?" and drops the
  report if so.

With these, a key names one report for 2 days, and nothing on the server points from it to an
install, a person, or another report. **The difference from a suggestion's `code`** (DeetsSupport
`src/index.js`, `randomCode()` and the header note on a post's two ids): that code is meant to be traced: the worker makes it, stores it with the post for as
long as the post lives, and it is the reporter's way back to the thread (`/t/<code>`). The usage
key is the opposite: the app makes it, it points to nothing, and it is gone in 2 days.

**A5. Two tries, then the period is lost.** `mayTry` allows two tries per day or week. An
install offline at two launches loses that week's settings and health reports. *Fix:* try again
at each launch and each hourly check until the period ends. With A4, a retry cannot count twice.

**A6. His own installs are in `live`.** From 2026-10-15 to 10-23 the daily live count was 1–2,
which was his own app. At today's ~14 a day, that is up to 1 in 7. A test install in a sandbox
also counts as a new install. *Fix:* an `owner` channel, like `beta`: a DevTools command on his
PC (`__usage.owner(true)`) writes a flag in the usage state, and Rust sends `channel: "owner"`.
His installs then leave `live`, his desk tests still reach the admin page under *owner*, and
nothing about him is sent that is not sent today. The worker accepts `owner` (`CHANNELS`).

**A7. Checked and not a fault:**
- *A reinstall.* An uninstall keeps the user data (unless *Delete app data* is on), and with it
  the usage state, so a reinstall counts once.
- *Nothing in the app clears its localStorage.* The one `localStorage.clear()` (apple.rs) is on
  the sign-in page in the browser, a different origin.
- *The settings rows against the weekly count:* equal every week so far (§12.1).
- *The current day is partial.* The admin page labels today "so far".

## 13. As built (2026-10-27)

> **Part:** built · 2026-10-27 (all of §12, on `onepointtwo`, 1b6ebaa). **The worker side LIVE
> 2026-10-27 (his go):** `usage_seen` created on the live D1, DeetsSupport deployed (version
> `dec25899`; before it `89f4a98e`), the admin page published (DeetsSolutions d9f81cf). The app
> side ships with 1.2.0. Where this record and §12 disagree, this record is the code.
>
> **The live check after the deploy:** the release list's link carries `?from=site`; the health
> probe and the signed feed answer 200; a full download of the 1.1.2 Setup.exe arrived at
> 23,154,488 bytes with a valid signature, and the worker counted it (`setup.start` and
> `setup.done`, bucket `bot`, from the check's `curl` User-Agent). That one bot download on
> 2026-10-27 is the check, not a user. The migration ran as one `--command`: `--file` goes
> through D1's import API, which the wrangler login may not use (an authentication error).

**The worker** (`../DeetsSupport`):
- `src/usage.js`: `POST /usage/update`; every route takes the app's `day` (±1 day of the
  worker's, else the report is dropped; a report without one is filed under the worker's day,
  so 1.1.2 and older keep working) and a `key` (22 characters, base64url of 16 bytes). The key's
  `INSERT INTO usage_seen` goes FIRST in the report's batch: a key already seen fails it, and D1
  rolls the whole batch back. No SELECT, so two copies arriving together cannot both land.
- **The applied report carries `moves`, not one `from`** (§12.2 said one `from` and three
  flags). One install's day, week and month counts can sit under three different versions (a
  week counted on 1.0.0, today on 1.1.2), so each period names its own old version:
  `moves: {day: "1.1.2", week: "1.0.0"}`. Each move is `MOVE_IN` (+1 under `to` only while the
  old version holds a count above 0) then `MOVE_OUT` (−1, never below 0). A forged move from a
  version with no count makes nothing.
- The day count's `new: true` adds `install.first`.
- `owner` is a channel. `KEY_DAYS = 2`: the daily cron run deletes older keys.
- `src/update.js`: the Setup.exe count (`countedSetup`): `setup.start` at once, and the body
  piped through a native `FixedLengthStream`; `setup.done` when the pipe ends, never when the
  client goes away. `handleUpdate` takes `ctx`. `listReleases` adds `?from=site`.
  `setupSource` and `countSetup` live in `usage.js`. **Limit found in the desk test:** `done`
  means the worker handed the last byte to the network. A download cut in its last few MB
  (what the socket buffers hold) can count as done. With a 3 MB test file, a cut download
  counted as done; with 40 MB it did not.
- `migrations/2026-10-27-usage-seen.sql` and `schema.sql`: the `usage_seen` table. The README
  and the `USAGE_RL` note are updated.

**The app:**
- `src/usage-rules.ts` (pure, tested): the state gains `vDay` / `vWeek` / `vMonth` (the
  version each count sits under), `runV`, `dl` / `downloaded`, `keys`, `open`. `dayCount` gives
  `new`; `afterDay(state, now, v)`; `movesFor`, `appliedReport`, `afterApplied`,
  `onDownloaded`, `reportId`, `clockFor`, `tickClock`, `keyFor`, `waited`. `mayTry`, `afterTry`
  and `apart` are gone, and so is the stored `tries`.
- `src/usage.ts`: one 15-second tick moves each due report's open-time clock (a tick adds at
  most 2 minutes, so a sleep does not count) and sends at most one report whose moment has come,
  never within a minute of the last. The windows: day count, applied and downloaded 20 s to
  5 min of open time; the weekly reports 1 to 30 min. A failure waits an hour or the next launch
  (`failedAt`, in memory). `onUpdateStatus` (updater.ts) records a download when an update
  reaches `ready`, only while the switch is on. Off drops every clock and a waiting download.
  The key comes from `crypto.getRandomValues` (the OS random source; the design said Rust
  `getrandom`: the same source, and the key then lives where the report waits).
- `src-tauri/src/usage.rs`: the kinds `downloaded` and `applied` go to `/usage/update` with
  `event` set; Rust writes `from` (a download) or `to` (an applied update) from its own
  version. The health report takes the front end's `day` and `key` and nothing else of its body.
  **`owner` is the user environment variable `DEETS_USAGE_OWNER=1`** (the design said a
  DevTools command: DevTools do not open in a release build, and an environment variable also
  covers every test install on his PC). Set it once from his own terminal:
  `setx DEETS_USAGE_OWNER 1` (not from a Claude shell: its registry writes are not real, CLAUDE.md).
- *Show what is sent* shows the update reports when one waits or was sent, and the key as
  "(a random key for this one report; not kept)": the last bodies kept for the panel never hold
  the real key.

**The admin page** (DeetsSolutions, not published): the Owner channel; "Today so far"; the
lag note under the version mix (a week holding a version before 1.2.0); **Updates** and
**Downloads and first starts**, from `events`. The new strings are drafts for his edit
(`strings.js`, under "Updates, first starts and Setup.exe downloads"). `?mock` shows them.

**The check script:** `npm run usage:r2 [-- --days N]` (§12.7 call 2). The zone counts only
200 answers (a 404 or 429 never reaches R2). Read on 2026-10-27: the zone and R2 can still
differ on a small day (Oct 25: 26 against 17), and the 26 sent 286 MB, about 12 full copies of
the 23 MB file. That is why the worker's own `done` count is the measure.

**Decided in the build, for his review:** the open-time windows above; the tick (15 s) and its
cap (2 min); the retry wait (1 hour); the admin page's two tables and their column names; 14
days in the Downloads table; the lag note's rule (any version before 1.2.0 in the week); the
README paragraph and the 1.2.0 release-note paragraph (both drafts); `install.first` counts
an install's first count ever, so an install that turned the switch on months after it
installed counts as first then.

**Not changed, his words:** the Settings row's hint "Anonymous counts, once a day and once a
week" (his, 2026-10-23) does not name the update reports. A draft for him: "Anonymous counts,
once a day, once a week and on each update."

### 13.1 Desk test (2026-10-27, run by Claude)

> **Part:** desk test passed · 2026-10-27 (run by Claude: a local worker and a hidden second
> dev app; the owner channel in a real install and the admin page's look are open)

**The worker half:** `node docs/ops/checks/usage-worker.mjs` against `wrangler dev` on 8791
(the setup is in the script's head). 27 cases, all pass: the day count with its day, key and
`new`; a retry with the same key writes nothing; a new key counts; a day 3 days off, an
impossible day and a malformed key are dropped; yesterday's day is filed under yesterday; the
owner channel; an applied update moves the day, week and month counts; a second move and a
forged move make nothing; a download; a rollback moves back, bucketed; a settings retry stores
one row; health under the week it covers; the Setup.exe sources (site, store, check, bot); a
cut 40 MB download starts and never finishes; a HEAD is never counted; the cron (through the
Local Explorer's scheduled call at 00:01 UTC) deletes a key older than 2 days and keeps
today's. The first run failed three: a cut 3 MB download counted as done (the limit in §13),
the HEAD case's expected total was wrong in the script, and `/__scheduled?time=` does not set
the time.

**The app half:** `npm run dev:app -- --second --hidden` with
`DEETS_USAGE_BASE=http://localhost:8791`, driven by `scripts/webview-eval.mjs --second`:

| Case | Result | Seen |
|---|---|---|
| The day count leaves early | pass | Planned at 2 min of open time, sent 2 min after launch: `usage: day sent (dev)`; the body held `day`, `new: true` and the key's stand-in |
| The applied move, by the clock | pass | The state set to `runV`/`vDay`/`vWeek`/`vMonth` 1.1.0 over a seeded 1.1.0 count: planned at 96 s of open time, sent on its own (`usage: applied sent`). On the worker: 1.1.0 at 0 for the day, week and month, 1.1.2 one higher each, `update.applied` 1. The state then held 1.1.2 for all four, and no key |
| Open time across a reload | pass | The settings clock held its 120 s of open time across `location.reload()` and went on from there |
| The download report | pass | A waiting `dl` of 1.2.0 planned at 257 s; sent with `__usage.send`: `update.downloaded` 1 under 1.2.0; the state `downloaded: "1.2.0"`, no `dl`, no key |
| A retry through Rust | pass | `usage_send` twice with the same key: both answered, one settings row stored |
| No real key kept | pass | Every stored body in `deets-usage-last` shows the stand-in, never a 22-character key |
| Off means off | pass | *Send usage counts* off: every clock dropped at once; a send then did nothing (`settingsWeek` unchanged); on again |
| The owner channel | not run in an app | The worker takes `owner` (worker case); the app's side is one `std::env::var` read. On his PC: `setx DEETS_USAGE_OWNER 1`, restart the installed app, then *Show what is sent* names `owner` |
| `onUpdateStatus` records a real download | not run | A dev build does not update (`update: check: A dev build doesn't update.`); the rule is `onDownloaded`, unit-tested. The first real update to the release with this code shows it |
| The admin page | not run | His eye on `?mock` (the two new tables, the Owner channel, the lag note) before the publish |

## 14. Byte ranges on the Velopack folder (2026-10-30)

> **Part:** built · 2026-10-30 (DeetsSupport `src/update.js`, uncommitted, NOT deployed; the
> worker check passed, §14.4). The deploy is his call (§14.5).

**Why.** On 2026-10-30 the admin page's flag said 26–28 % of the site and Store Setup.exe
downloads in 7 days did not finish (38 starts, 28 finishes). The zone's request log (bytes per
request, by browser; no IP) showed that every person got the whole file. The 10 extra starts
were extra connections:

| Day | Who | Requests | Bytes | What happened |
|---|---|---|---|---|
| Oct 28 | One Store install (US) | 5 | 26.8 MB | One whole copy (23.2 MB) and 4 short connections, one of them a 499 |
| Oct 28 | One Chrome user (BD) | 3 | 25.3 MB | One whole copy and 2 short connections |
| Oct 30 | One Firefox user (VN) | 4 | 32.4 MB | One whole copy and 3 short connections |
| Oct 30 | One Chrome user (JM) | 2 | 2.4, then 23.2 MB | The first try stopped at 2.4 MB; a new try 2 hours later got the whole file |

The cause: the worker ignored `Range`. Every request got the whole file from byte 0, so Delivery
Optimization's parts and a browser's resume each counted as a start that never finished. The
same fault made a broken download start again from zero (the JM user).

### 14.1 What the worker does now

- A package (`.nupkg`) or the Setup.exe takes **one** byte range: `bytes=a-b`, `bytes=a-` or
  `bytes=-n`. The answer is 206 with `Content-Range` and the part's `Content-Length`. The R2
  read is a `head` (for the size), then a `get` with the range; the head runs only when a
  `Range` line is there.
- Every answer for those files carries `Accept-Ranges: bytes`, so a browser knows it can resume.
- Several ranges, another unit, a bad form or a backwards range: the whole file, 200 (RFC 9110
  lets a server ignore a range).
- A start at or past the end: 416 with `Content-Range: bytes */<size>`.
- `If-Range` that is not this file's ETag (an older copy, or a date): the whole file, 200, so a
  resume never joins two different files.
- The feeds (`releases.<channel>.json[.sig]`, the rollback feeds) are always whole.
- The old NSIS route (`/update/<channel>/file/`) is not changed: only installs from before 0.28
  use it, and those move to Velopack by hand.

### 14.2 The count rule

- `setup.start` when the part holds the file's **first** byte (or there is no range).
- `setup.done` when the part holds the file's **last** byte and goes out in full (the same
  `FixedLengthStream` as §13, sized to the part).
- A part that holds neither is not counted.
- So a download in parts counts one start and one finish, and so does a resume. A new try from
  zero is a second start, which is true. The parts of one download are never joined: that would
  need an ID or the IP (§2 rules 1 and 2).
- The §13 limit still holds: a download cut in its last few MB can count as finished.

### 14.3 The rate limit

The Velopack folder moved from `TOKEN_RL` (the mint, 30 a minute per IP) to its own `FILE_RL`
(namespace 3005, 300 a minute per IP). A download in many parts must never meet a 429, and 300 a
minute still holds a runaway loop. The mint keeps its strict limit. 300 is Claude's draft value,
for his review.

### 14.4 The worker check (2026-10-30, run by Claude)

`node docs/ops/checks/usage-worker.mjs` against `wrangler dev` on 8791: **44 cases, all pass**
(the 27 of §13.1 and 17 new, section 7b). The new cases: a HEAD names `Accept-Ranges`; a resume
in two parts (206, the bytes join into the file, one start and one finish); Delivery
Optimization in 4 parts at once (all 206, the bytes join, one start and one finish); a middle
part (no count); the last 1000 bytes (a finish only); an end past the file (cut to the file); a
start past the end (416, no count); a cut last part (no finish); `If-Range` with another ETag
(200, whole) and with this ETag (206); several ranges (200, whole); a backwards range (200,
whole); a package range (206, the right bytes, never counted).

### 14.5 Still open

- ~~**The deploy (his call).**~~ **DEPLOYED 2026-10-30** with the archive, as he chose (wait for
  the archive): DeetsSupport `f08916b` on `master`, worker version `0dfc4b0d`.
- **After the deploy — checked the same day, by Claude:** a middle byte range (`bytes=100-199`,
  which counts neither a start nor a finish) answers 206 with `Accept-Ranges: bytes` and
  `Content-Range` on the 0.28.0 package and Setup.exe; the 1.2.1 package downloads whole (200,
  15,605,803 bytes); a stale `If-Range` answers the whole file (200). **Still open:** `npm run
  usage:r2` on 2026-10-31 shows the worker's starts equal to the people in the zone log.

### 14.6 The correction of the live counts (his call, 2026-10-30: "Correct them")

One D1 update on the live `usage_counts`, channel `live`, from the zone log above:
- 2026-10-28, 1.2.0, `setup.start`, `site`: 4 → 2 (the BD user's 2 short connections).
- 2026-10-28, 1.2.0, `setup.start`, `store`: 5 → 1 (the Store install's 4 short connections).
- 2026-10-30, 1.2.1, `setup.start`, `site`: 25 → 21 (the VN user's 3 short connections and the
  JM user's first try). The JM user's second try may have been a resume that the worker could
  not answer; the log cannot tell. It is taken out as a resume, so the count says what Range
  support would have counted.

After it: 30 starts and 30 finishes in the 7 days, so the flag clears. Until the deploy, a new
download in parts can add a false start again.

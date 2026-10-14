---
status: built
desk_test: passed 2026-10-13
sources: [src/usage.ts, src/usage-rules.ts, src/usage-keys.ts, src-tauri/src/usage.rs, scripts/usage-keys.mjs, src/settings-store.ts, src/agent-settings.ts, src/settings-card.ts, src/updater.ts, src-tauri/src/apple_calls.rs, src-tauri/src/log.rs, src-tauri/src/watchdog.rs, src-tauri/src/dbhealth.rs, src-tauri/src/apple.rs, README.md]
updated: 2026-10-13
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

## 2. The privacy rules

These rules are the design. Every later choice is tested against them. A change that breaks one
of them is a new fork for the owner, never a build detail.

1. **No ID of any kind.** No install ID, no random ID, no rotating ID, no hash of anything on
   the PC, no Apple or DeetsAccounts ID, no friend code. The app itself makes sure it counts once
   per day (§3.1), so the server needs no ID to count.
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
10. **Nothing is sent before the user was told** (§7). A new install is told on the Hop in
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

## 7. How the user is told

- **A new install:** one line on the Hop in screen, under the Cruisin / Pro pick, with the
  switch next to it. Nothing is sent before the user leaves the Hop in screen. Until Hop in is
  built, a new install gets the same notice as an update.
- **An install that updates into this feature:** a sticky notice (TOASTS.md) with three
  buttons: *Show what is sent*, *Turn off*, *OK*. Nothing is sent until that notice has been
  shown. Closing it counts as *OK*.
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
> rules, the front end. The admin page (DeetsSolutions) and the README / release-note lines are
> not built.)

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

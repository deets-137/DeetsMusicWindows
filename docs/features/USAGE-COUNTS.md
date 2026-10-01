---
status: designed
desk_test: none
sources: [src/settings-store.ts, src/agent-settings.ts, src/settings-card.ts, src/updater.ts, src-tauri/src/apple_calls.rs, src-tauri/src/log.rs, src-tauri/src/watchdog.rs, src-tauri/src/dbhealth.rs, src-tauri/src/apple.rs, README.md]
updated: 2026-09-29
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
6. **Small groups stay hidden.** The owner's view never shows a count below 5 (§6). A settings
   combination that fewer than 5 installs share is shown as "fewer than 5". This stops a rare
   setup from standing out as one person, even to the owner.
7. **Data expires.** Rows and counters older than 13 months are deleted by the worker's
   existing 5-minute cron. There is no archive.
8. **The user sees exactly what is sent.** The Settings row has a *Show what is sent* button. It
   shows the real JSON of the last report of each kind, and the next one. This is the same idea as
   the bug-report form, which shows the exact text before it sends (LOGGING.md §The report form).
9. **Off means off, at once.** With the row off, the app sends nothing: not the day count, not
   the settings, not the health. A report already waiting for its random moment is dropped.
10. **Nothing is sent before the user was told** (§7). A new install is told on the Hop in
    screen. An install that updates to the first version with this feature is told by a
    notice, and sends nothing until that notice has been shown.
11. **The release bundle is the only sender.** A dev build and the Beta app send to their own
    bucket (`channel: "dev"` / `"beta"`) or not at all (§9, fork 4). The owner's own dev app is
    never counted as a live user.
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
- **Storage: counters, not rows (§9, fork 5, recommended).** The server adds each number into a
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
`src/agent-settings.ts`, 23 entries today). A new field, `report: true`, marks a key that may be
sent. Rules for the list:

- **May be on the list:** `toggle` and `choice` keys; the theme, skin and surface.
- **Never on the list:** `range` (sliders), `time`, `size`, anything with free text, a path, a
  name, an account, a friend or room code, a Last.fm name, a picture, and every consent gate's
  history (only its current on/off may be sent).
- **Rules and recipes:** the count of rules and which built-in recipes are on may be sent. The
  words of a custom rule never are.
- A key that is not in `SPECS` today (not every Settings row has an agent spec) needs a spec
  before it can be reported. That keeps one list, not two.

The first list is fork 2 (§9). The owner picks it key by key.

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

Every number below 5 shows as "< 5" (§2 rule 6). The cross-check is computed in the worker, and
the page never gets the raw rows. Until the page is built, `wrangler d1 execute` queries work
(fork 3).

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
   README paragraph.
2. **The allow-list.** Which keys get `report: true` (§4).
3. **The owner's view.** The admin page (§6) now, or wrangler queries first.
4. **Dev and Beta.** Send to their own `channel` bucket (recommended: the owner can see the Beta
   numbers, and they never mix with live), or send nothing at all.
5. **Health storage.** Counters with buckets (recommended, §3.3), or one row per report like the
   settings.
6. **The small-group limit.** 5 (recommended), or another number.
7. **Expiry.** 13 months (recommended: one year of week-on-week comparison), or shorter.
8. **The update notice.** A sticky notice that gates the first send (recommended, §7), or only
   the release notes and the Settings row.

## 10. Desk test

Written when the forks close.

---
status: project
desk_test: none
sources: [scripts/publish-update.mjs, src/toast.ts, src-tauri/src/playlists.rs, src/settings-card.ts, scripts/webview-eval.mjs]
updated: 2026-09-21
---
# DeetsMusic — Docs organization

> **Status (2026-09-21): STEPS 1, 2 AND 3 DONE on branch `dockin` — every doc has front matter
> (§11.1a), `npm run docs:check` passes with 0 facts (§11.2a; the release check warns until
> 2026-09-28), and the docs are in their area folders (§11.3a — read it for the tree as built;
> §4 below is the plan that led there).** Every number in §1 was measured against the tree on
> 2026-09-20, before the move. **Five decisions are closed (§3, the owner, 2026-09-20).** Six forks were
> open (§10); F1–F5 are decided, F6 is open. Build order is §11. **§12 (added after 0.12.1) is a second piece of docs
> work that rides this re-org: release notes, where a hotfix outranks the feature release
> it repairs. Four more forks, all open. §13 (2026-09-21) is the user guide on
> deets.solutions: all nine of its forks closed (U1–U9). §14 (2026-09-21) = release tags
> and a derived SQLite tasks index, forks T1–T4 and X1–X4 open.**

**What you asked for.** Three things:
1. A high-level overview that a new reader meets first.
2. The docs sorted — ideas, techniques, and by feature set.
3. A skill that brings every doc up to date, flags staleness and version mismatches,
   and fixes them.

Siblings: [HANDOFF.md](HANDOFF.md) · [LESSONS.md](LESSONS.md) · [RELEASE.md](ops/RELEASE.md)
(the release check is where §8 runs).

---

## 0. Terms

Define these once. The rest of the doc uses them exactly.

- A **doc** is one `.md` file under `docs/`.
- A **link** is a markdown link to another doc: `[TOASTS.md](architecture/TOASTS.md)`. There are 476.
  A link carries a path, so a move breaks it.
- A **mention** is a doc named in prose with no link: `TOASTS.md §5`. There are about
  1,000. A mention carries no path, so a move does **not** break it.
- A **section pointer** is a mention with a section number: `TOASTS.md §4a`. There are 178
  unique ones.
- **Front matter** is a YAML block at the top of a doc, between two `---` lines. Every doc
  has one since 2026-09-21 (§11.1a).
- The **checker** is a script (§8). The **sweep** is the skill that reads the checker's
  report (§9).

---

## 1. What is there now (measured 2026-09-20)

| | |
|---|---|
| Docs in `docs/` | 60 files, 27,243 lines |
| Docs in `docs/ideas/` | 6 files, 1,496 lines |
| Links between docs | 476, every one flat |
| Mentions in prose | about 1,000 |
| Unique section pointers | 178 |
| Broken links today | **2** |
| `CLAUDE.md` | 28,970 bytes; about 70% is the doc index |
| `HANDOFF.md` | 1,443 lines; "Next up" is lines 113–1021 |
| Largest docs | ROOMS 1,388 · DeetsOTD 1,300 · DEBUGGING 1,227 · FUTURE-SETTINGS 1,177 |

The two broken links are `docs/ideas/README.md → DeetsOTD.md` and
`docs/features/STATIONS.md → ideas/DeetsOTD.md`. Both were made by one move: `DeetsOTD.md` left
`ideas/` when it was built. Nothing caught them for two days. This is the whole argument of
§4.1 in one example.

---

## 2. The three problems

Folders are the smallest of the three. All three are named, because a folder change alone
fixes none of them.

### 2.1 `CLAUDE.md` holds the index and the status board

Its doc list does not only say what a doc covers. It carries state: "BUILT 2026-09-18",
"desk test PASSED 2026-09-19", "nine forks open, not built". The same state lives in
`HANDOFF.md` and in each doc's own header block. Three copies of one truth drift apart.

This copy is the most expensive. It loads into **every** session, whether or not that
session touches Rooms, Pins or Friends.

### 2.2 No doc carries machine-readable state

Status lives in prose, in different words per doc. "BUILT", "as built", "shipped in 0.9.0",
"designed, not built", "PARKED". A script cannot read any of it. That is why nothing caught
the stale `ideas/README.md` entry.

### 2.3 `HANDOFF.md` is two documents under one name

Lines 28–112 and 1021–1443 are cold-start reference: Run it, Ship it, State of play, Known
gotchas, File map. Lines 113–1021 are a work log: 900 lines of desk-test scripts for two
features built on 2026-09-20.

Both are worth keeping. They have different lifetimes. The reference is corrected in place.
The log is appended and never corrected. One file cannot have two lifetimes.

---

## 3. Decisions (the owner, 2026-09-20)

**D1 — Area folders, and a script rewrites all 476 links in one pass.**
Not flat, not `features/` only.

**D2 — `CLAUDE.md` keeps one line per doc. All state moves out.**
Mission, working style, run commands and conventions stay. "BUILT / PASSED / forks open"
moves to front matter (§5) and to `HANDOFF.md`.

**D3 — Split `HANDOFF.md` into `HANDOFF.md` + `WORKLOG.md`.**

**D4 — No subagent fan-out for the sweep.** The owner's reason, in his words: it is often
much more tokens than it is worth. The checker narrows 60 docs to a handful, and the reading
happens in the main context. This keeps `CLAUDE.md`'s no-subagent rule whole. The rule is
not bent for this skill.

**D5 — Document first, move nothing.** This doc is the deliverable of 2026-09-20.

---

## 4. The tree

```
docs/
  README.md            the generated index (§6.2)
  HANDOFF.md           cold start: run, ship, state of play, gotchas, file map
  WORKLOG.md           the rolling log, newest first (§7)
  LESSONS.md  TASTE.md  DESIGN.md
  NEXT-VERSION.md  FUTURE-SETTINGS.md        the two backlogs (fork F3)
  architecture/        15 docs — the machine, not one feature
  features/            23 docs — one surface or one user-facing feature
  integrations/        11 docs — anything that talks outside the app
  ops/                  5 docs — build, ship, diagnose
  ideas/                6 docs — unchanged
```

### 4.1 Why area, and not status

Your first instinct was ideas / techniques / feature set. Two of those three are areas.
"Ideas" is a status.

A status folder makes a doc **move** when it is built. A move breaks links. That is not a
prediction. It is the only move this repo has made, and it broke two links and left a stale
README for two days (§1).

An area does not change when a feature ships. Rooms is an integration before it is built and
after. So: **area decides the folder, front matter decides the status.**

`ideas/` stays, because a doc there makes a promise to a reader — "the app cannot do this"
— and that promise is worth a folder. Its README stops being hand-written (§6.2).

### 4.2 The full mapping

Every one of the 60 docs. 23 + 15 + 11 + 5 + 6 = 60, and `WORKLOG.md` is new.

**`architecture/` (15)** — cross-cutting. This is your "techniques" bucket.
`UI-ARCHITECTURE` · `DATA-ARCHITECTURE` · `SURFACES-AND-CARDS` · `TOKENS` · `SETTINGS` ·
`SETTINGS-INVENTORY` · `TOASTS` · `ONBOARDING` · `DRAG-DROP` · `CARD-MEMORY` · `CARD-GROW` ·
`CARD-SWAP` · `STAGE-COLUMN` · `UX-COVERUPS` · `LIBRARY-VIRTUALIZATION`

**`features/` (23)** — one surface or one feature.
`PLAYLISTS` · `PLAYLIST-WEB` · `PLAYLIST-REFRESH` · `HOME` · `QUEUE` · `SEARCH` ·
`SECOND-SEARCH` · `STATIONS` · `FAVORITES` · `PINS` · `ARTIST-VIEW` · `CREDITS` · `SOUND` ·
`AUDIO-QUALITY` · `VINYL` · `DEETS-REWIND` · `LOOK-SCHEDULE` · `COMPASS` · `COMPASS-TERMS` ·
`TRAY` · `SUGGEST-LESS` · `ALBUM-COLOR` · `MOVABLE-ROWS`

**`integrations/` (11)** — talks to something outside the app.
`AGENT` · `AGENT-SETUP` · `MCP-INSTALL` · `EXTENSION` · `LASTFM` · `AIRPLAY` · `ROOMS` ·
`FRIENDS` · `DeetsOTD` · `PROVIDERS` · `LOCAL-DATA`

**`ops/` (5)** — build, ship, diagnose.
`RELEASE` · `RELEASE-NOTES` · `DEBUGGING` · `LOGGING` · `DB-HEALTH`

**Root (6, plus the new `WORKLOG.md`)** — `HANDOFF` · `LESSONS` · `TASTE` · `DESIGN` ·
`NEXT-VERSION` · `FUTURE-SETTINGS`. The last two are backlogs, not area docs; fork F3.

**`ideas/` (6)** — unchanged.

### 4.3 What a move costs, exactly

- **476 links** are rewritten by script. `TOASTS.md` inside `features/PINS.md` becomes
  `../architecture/TOASTS.md`. The checker (§8) proves every one resolves after the pass.
- **About 1,000 mentions** need no change. `TOASTS.md §5` in prose still reads correctly.
- **`../src/...` links** inside docs gain one more `../`. Several docs carry them, and the
  same pass handles them.
- **`CLAUDE.md`, `README.md`, `AGENTS.md`** all name docs. All three are in the pass.
- **Git history follows.** `git log --follow docs/features/PINS.md` still works.
- **`.obsidian/`** is in the repo. Obsidian resolves wiki-links by name, not by path, so a
  folder move does not break its graph.

---

## 5. Front matter

Every doc gets this block, first thing in the file, above the `#` title.

```yaml
---
status: shipped | built | designed | project | parked | idea | foundation | sop | guide
shipped_in: 0.11.0          # omit unless status is shipped
desk_test: passed 2026-09-19 | open | none
sources: [src/toast.ts, src-tauri/src/playlists.rs]
updated: 2026-09-20
---
```

The values of `status`, defined once (S1 and S2 added the last four, the owner, 2026-09-21):

| value | meaning |
|---|---|
| `shipped` | in a published installer, and in someone's hands |
| `built` | in the tree, not yet in a published installer |
| `designed` | every fork closed, no code |
| `project` | started, not complete: forks still open, or a build begun and not finished (MCP-INSTALL, DOCS-ORG) |
| `parked` | designed and deliberately stopped; kept as a record (PROVIDERS) |
| `idea` | not designed. Everything in `ideas/` |
| `foundation` | the engine the features run on (§5.2) |
| `sop` | a standard operating procedure: how the work is done (§5.2) |
| `guide` | written for the user (§5.2, §13) |

### 5.1 Part markers — a doc with more than one state (S3, the owner, 2026-09-21)

Some docs hold a built part and an unbuilt part: CREDITS (the producer web, §5), DeetsOTD
(§9, more webhooks), ROOMS (§19, §20). Front matter gives the state of **the part that works
today**. Every other part carries a **part marker**: one line, directly under its `##` or
`###` heading, in one fixed shape a script can scan for:

```
## 5. The producer web
> **Part:** designed · 2026-09-17
```

- The shape is `> **Part:** <status> · <date>`, with the same status values as the table.
  An optional third field names the open forks: `> **Part:** project · 2026-09-18 · forks §9.6`.
- A heading with no marker has the doc's own status.
- The checker reads every marker (check 17): a marker with a value not in the table fails;
  a marker that says `designed` on a part whose code exists is a suspicion, like check 6.
- The tasks index (§14.2) takes every marker as one row, so "what is half-built" is one query.

### 5.2 S1 — the docs that are not one feature (the owner, 2026-09-21: three values)

The owner calls them foundational or SOP docs. **Three status values, one per group** —
`guide` has its own because the user guide (§13) already exists as a plan:

| value | meaning | stale when |
|---|---|---|
| `foundation` | the engine the features run on | its `sources` change (check 8) |
| `sop` | how the work is done | the process changes; the sweep asks, a script cannot tell |
| `guide` | written for the user, not for us | a doc it covers changes (check 13) |

A generated doc (`TOKENS.md`) carries `generated: npm run tokens` and no `updated`: its
generator writes the front matter itself, so the release check's byte-for-byte compare still
holds, and check 10's rule (regenerate, never hand-edit) covers it.

The groups, as read on 2026-09-21:

- **Foundation** (the engine the features run on): UI-ARCHITECTURE · DATA-ARCHITECTURE ·
  SURFACES-AND-CARDS · QUEUE · TOKENS · SETTINGS · DESIGN
- **SOP** (how the work is done): HANDOFF · LESSONS · RELEASE · RELEASE-NOTES · DEBUGGING ·
  NEXT-VERSION · FUTURE-SETTINGS · UX-COVERUPS · AUDIO-QUALITY
- **User-facing** (they already read like the guide, §13): AGENT-SETUP · COMPASS-TERMS ·
  SETTINGS-INVENTORY

`sources` is the load-bearing field. It is what lets the checker compare a doc's date
against the git history of the code that doc describes (§8, check 8). Without it, "is this
doc stale" is a guess.

The human-readable `> **Status …**` block that every doc already has **stays**. Front matter
is for the script. The block is for the reader. Check 9 makes sure the two agree, so there
is no third copy of the truth — there is one truth in two shapes, and a test.

---

## 6. `CLAUDE.md` after the change

### 6.1 What stays, what goes

| stays | goes |
|---|---|
| The one-paragraph "what this is" | Every "BUILT / PASSED / forks open / shipped in" clause |
| Start here | The long per-doc paragraphs |
| How to verify your work | — |
| Working style, the whole section | — |
| How to explain things to me | — |
| Run, Conventions | — |
| A one-line pointer per doc | — |

A pointer line is the name, the area and one clause of what the doc covers. Nothing about
state:

```
- features/PINS.md — a playlist, station, album, artist or song kept in view.
```

Estimate: about 29,000 bytes down to about 9,000. That saving is paid on every session.

### 6.2 `docs/README.md` is generated

One script writes it from the front matter of all 66 docs: grouped by folder, and inside a
folder, the status and the shipped version in a column. `docs/ideas/README.md` is generated
the same way and stops being hand-written. That is exactly the file that went stale.

Generated, not hand-written, so it cannot drift. `npm run docs:index`, and the checker fails
when it is stale — the same pattern `npm run tokens` already uses for `TOKENS.md`.

---

## 7. `HANDOFF.md` and `WORKLOG.md`

**`HANDOFF.md`** keeps: Run it · Ship it · State of play · Measuring graphics · Known
gotchas · Key decisions · File map. It gains one line at the top: *the open desk tests are
at the top of WORKLOG.md*. Target: under 600 lines, and it stops growing.

**`WORKLOG.md`** takes "Next up" and every desk-test script. Newest first. One `##` per
sitting, dated. It can grow without limit, because nothing reads it end to end.

The rule that makes the split hold: **a fact that is still true belongs in HANDOFF; a record
of a day belongs in WORKLOG.** A desk test is a record of a day. A gotcha is still true.

---

## 8. The checker — `npm run docs:check`

Deterministic, fast, free. No model runs. It joins the release check
([RELEASE.md](ops/RELEASE.md)) next to the stale-`TOKENS.md` gate.

| # | check | what it catches today |
|---|---|---|
| 1 | every link resolves | the 2 broken now, and every one the folder move could break |
| 2 | every mention names a real file | a doc renamed, its ~1,000 prose mentions left behind |
| 3 | every section pointer resolves to a real heading | 178 of them; a renumbered §4a that points nowhere |
| 4 | front matter present and valid | a new doc with no status |
| 5 | version strings match the six version files | the release trap already in the memory index |
| 6 | `status: designed` but a file in `sources` exists | a doc that says NOT BUILT after the code landed |
| 7 | settings keys named in docs exist in `settings-store.ts` | a renamed key, documented under the old name |
| 8 | a file in `sources` is newer than `updated` | the doc describes code that changed after it was written |
| 9 | front matter disagrees with the `> **Status …**` block | the two shapes of the truth drifting apart |
| 10 | `docs/README.md` is stale against the front matter | the generated index not regenerated |
| 11 | a doc in `ideas/` with a status above `idea` | the exact DeetsOTD failure, caught in one second |
| 17 | a part marker (§5.1) with a status not in the table; or `designed` on a part whose code exists | a half-built doc whose other half landed unseen (the first half is a fact, the second a suspicion) |

Checks 1, 2, 3, 5, 7 and 11 are **facts**. They fail the build.
Checks 6, 8, 9 and 10 are **suspicions**. They print and do not fail, because a doc can be
correct and older than its code. Check 8 will be noisy on the first run. That noise is the
sweep's input, not an error.

Written once, in `scripts/docs-check.mjs`, beside the other scripts. It runs no model, so it
costs nothing on every release.

---

## 9. The sweep — the skill

**How it runs (D4): in the main context. No subagents.** The fan-out is off because of cost,
and the checker is what makes the fan-out unnecessary. It turns "read 27,243 lines" into
"read four flagged docs".

The loop, per sitting:

1. Run `npm run docs:check`. Read the report. It is a list, not prose.
2. Fix every **fact** failure first. These are mechanical: a path, a section number, a
   version string. No judgment, and no reading of the whole doc.
3. Take the **suspicions** one doc at a time. Open that doc, open the files in its
   `sources`, and read `git log` for those files since the doc's `updated` date. Decide
   whether the prose is still true.
4. Repair the prose, and set `updated`.
5. Stop and ask when the fix is a **decision, not a fact**. A doc that says a fork is open,
   when the code shows a choice was made, is a question for the owner, never a silent edit.
6. Report: what the checker caught, what was repaired, what was asked.

Step 5 is the rule that keeps the skill honest. By the working style in `CLAUDE.md` and by
[LESSONS.md](LESSONS.md), a sweep never closes a fork.

**Budget.** One sitting, one report, as many docs as the checker flagged. If the first run
flags thirty docs, the skill does the fact failures for all thirty, then the suspicions for
as many as fit, then names the rest. It does not try to do 60 docs in one pass.

**Where it lives.** `.claude/skills/docs-sweep/SKILL.md` in this repo, so it travels with the
tree. The repo has a `.claude/` already, with only `settings.local.json` in it.

---

## 10. Open forks

| # | fork | recommendation |
|---|---|---|
| **F1** | Folder names: `architecture/` or `techniques/` | **DECIDED 2026-09-21: `architecture/`** |
| **F2** | Do the card docs (`CARD-GROW`, `CARD-SWAP`, `CARD-MEMORY`, `STAGE-COLUMN`) sit in `architecture/`, or in their own `cards/`? | **DECIDED 2026-09-21: their own `cards/`**, plus a generated copy of `SURFACES-AND-CARDS.md` (the owner: "for ease of dev"; the `architecture/` one is the one true copy) |
| **F3** | `NEXT-VERSION.md` and `FUTURE-SETTINGS.md` — root, or a `backlog/` folder? | **DECIDED 2026-09-21: root** |
| **F4** | `ONBOARDING.md` — `architecture/` (it is the hint ledger, and every `title` in the app is a row in it) or `features/` (it is the first-run walk)? | **DECIDED 2026-09-21: `features/`** (the owner: "onboarding can go to shipped") |
| **F5** | Does the checker fail the release check on day one, or warn for a week first? | **DECIDED (the owner, 2026-09-21): warn for a week** — `GRACE_END = 2026-09-28` in `docs-check.mjs` |
| **F6** | Does `docs/README.md` replace the `CLAUDE.md` pointer list, or do both exist? | Both. The `CLAUDE.md` list is what a session has without opening a file. `docs/README.md` is what a human browses |

---

## 11. Build order

Each step is its own sitting and its own commit. Steps 1 and 2 are mechanical and reversible.
Nothing here is started.

1. **Front matter on all 66 docs.** No moves. This step makes every later step checkable,
   and it is the only step that touches every file. **DONE 2026-09-21 (§11.1a).**
2. **The checker**, `scripts/docs-check.mjs`, with checks 1–5 and 11 only. Run it. Read the
   first report before writing checks 6–10 — the report says which suspicions are worth the
   code. **DONE 2026-09-21 (§11.2a).**
3. **The move**, plus the link rewrite, plus `docs:index`. One commit. The checker proves it.
   **DONE 2026-09-21 (§11.3a), without `docs:index`** — the generated README is its own step
   (§6.2), after F6.
4. **`CLAUDE.md`** rewritten to one line per doc.
5. **The `HANDOFF` / `WORKLOG` split.**
6. **The sweep skill**, last, because it is worth nothing until the checker exists.
7. **Release-note grouping (§12).** Independent of steps 1–6: it touches
   `scripts/publish-update.mjs`, the update Worker and `../DeetsSolutions`, and only one
   line of `docs/`. It can go first, or between any two steps. It wants its own release to
   ride on, because the Worker change is only visible on the next update offer.

8. **The user guide (§13).** Needs steps 1 and 2 (front matter and the checker). It does
   not need the move. §13.8 has its own order.

Step 1 collides with no feature work. Step 3 collides with any branch that edits a doc, so it
wants a quiet tree. Branch `twelve` has 11 modified docs uncommitted today.

### 11.1a Step 1 as built (2026-09-21)

- **Where:** branch `dockin`, cut from `thirteen` at `86d144f`, in its own worktree
  (`../DeetsMusic-dockin`) so a session working on `thirteen` is not switched under. It
  merges back into `thirteen` once the owner has felt out the effects.
- **How:** `scripts/docs-frontmatter.mjs` proposed a block per doc from the doc's own header
  words, the code paths it names most (up to six, the ones that exist) and its last commit
  date; `shipped_in` came from the first published version commit that holds the doc's newest
  source (0.12.0 and 0.12.1 withdrawn, so skipped). Every row was then corrected by hand
  against the doc's header, and the owner decided S1–S3 (§5, §5.1, §5.2). `--write` adds a
  block only to a doc that has none.
- **Count:** 66 docs + `TOKENS.md`. shipped 36 · built 1 (Quick Settings) · designed 2 ·
  project 2 · parked 1 · idea 6 · foundation 7 · sop 9 · guide 3. Open desk tests: Friends,
  Sound, Quick Settings.
- **Left out:** `TASTE.md` (git-ignored, private) and `ideas/MatterLights.md` (another
  session's new file on `thirteen`; it gets its block when it lands).
- **`TOKENS.md`** gets its block from `scripts/tokens.mjs`, with `generated:` in place of
  `updated:`, so the release check's byte-for-byte compare still passes (checked).
- **Checked unchanged:** `publish-update.mjs` still finds every `## <version>` entry in
  `RELEASE-NOTES.md`. No app code reads a doc; the Agent card opens `AGENT-SETUP.md` on
  GitHub, which shows front matter as a small table above the title.
- **Not done here:** part markers (§5.1) on CREDITS, DeetsOTD and ROOMS — the sweep adds them
  when the checker exists. `sources` is rough; the sweep sharpens it.

### 11.2a Step 2 as built (2026-09-21)

- **`scripts/docs-check.mjs`**, `npm run docs:check`. Checks 1–5 and 11, all facts. Exit 1 on a
  fact; `--warn` always exits 0. It exports `check()` and `report()`.
- **In the release check** as its check 10. Until `GRACE_END` (2026-09-28, F5) a failing fact
  prints a WARNING and the release goes on; from that date it fails the release. The line
  at the end says `docs check clean` or `docs check WARNED (n facts)`.
- **What it reads:** every tracked `docs/**/*.md` (not `docs/guide/`, not a `_` file), plus
  `CLAUDE.md`, `README.md`, `AGENTS.md` for checks 1–3. Fenced code blocks are skipped.
- **Check 5 reads SEVEN version files**, not four: the four the release check knows, both
  `Cargo.lock` files and `extension/manifest.json` (the memory note's "six" + the manifest).
  Every `shipped_in` must have a `## x.y.z` entry in RELEASE-NOTES.md, must not be withdrawn
  (named in the script until tags exist, §14 T2) and must not be newer than package.json.
- **When a mention is not a fault** (each rule came from the first report, not from a guess):
  the path, paragraph or section heading names another repo (DeetsSolutions, DeetsAirplay,
  the DeetsRadio worker); it sits in a URL; it is a retired name kept as a record
  (`VALUES.md`, and a pointer into it is not checked either); it is a private doc listed in
  `.gitignore` (`TASTE.md` — the `dockin` worktree has no copy, so the list comes from
  `.gitignore`, not the disk); or the doc is a plan (`project`, `designed`, `idea`), which
  names files not made yet. The other-repo rule applies ONLY to a name this repo does not
  have: a paragraph that names DeetsRadio still has its pointer into ROOMS checked (FRIENDS' stale "§0" was found that way).
- **A link to a code line** (`../src/room.ts:344`) resolves to the file.
- **Section pointers** match a heading's leading number (`## 5.`, `### 5.1`, `## 4a.`), or a
  deeper heading under it (`§4` is fine when only `4.1` exists).

**The first report and what was fixed.** 72 facts on the first run; 58 were the checker's own
faults (the rules above). The 14 real ones, fixed in the docs in the same commit:
- the two DeetsOTD links of §1 (STATIONS.md now links `DeetsOTD.md`; ideas/README.md drops
  the entry — it is built);
- two DeetsSolutions docs named bare (`support.md`, `radio.md`), now qualified;
- five stale section pointers: FRIENDS → DeetsOTD §4 item 6 (was §6) and ROOMS' opening note
  (was §0); NEXT-VERSION → ARTIST-VIEW §1 (was §2.2); SOUND → AIRPLAY §10 item 4 (was §10.4);
  TOASTS → FRIENDS §7 item 1 (was §7.1);
- five `shipped_in: 0.1.1` → `0.1.3`, the first version with release notes (0.1.1 was never
  given an entry).

**For checks 6–10 (next).** The first report says nothing about them yet — they are
suspicions and need their own first run. Checks 6 and 8 need `sources`, which step 1 left
rough; build check 8 first and read its noise before trusting check 6.

### 11.3a Step 3 as built (2026-09-21) — the tree

```
docs/
  HANDOFF.md  LESSONS.md  DESIGN.md  DOCS-ORG.md       entry points and SOP
  NEXT-VERSION.md  FUTURE-SETTINGS.md                  the two backlogs (F3)
  AGENT-SETUP.md                                       a stub: moved_to integrations/ (below)
  TASTE.md                                             private, git-ignored
  architecture/  10  UI-ARCHITECTURE · DATA-ARCHITECTURE · SURFACES-AND-CARDS · TOKENS ·
                     SETTINGS · SETTINGS-INVENTORY · TOASTS · DRAG-DROP · UX-COVERUPS ·
                     LIBRARY-VIRTUALIZATION
  cards/          5  CARD-GROW · CARD-SWAP · CARD-MEMORY · STAGE-COLUMN ·
                     SURFACES-AND-CARDS (generated copy)
  features/      25  PLAYLISTS · PLAYLIST-WEB · PLAYLIST-REFRESH · HOME · QUEUE · SEARCH ·
                     SECOND-SEARCH · STATIONS · FAVORITES · PINS · ARTIST-VIEW · CREDITS ·
                     SOUND · AUDIO-QUALITY · VINYL · DEETS-REWIND · LOOK-SCHEDULE · COMPASS ·
                     COMPASS-TERMS · TRAY · SUGGEST-LESS · ALBUM-COLOR · MOVABLE-ROWS ·
                     ONBOARDING · QUICK-SETTINGS
  integrations/  11  AGENT · AGENT-SETUP · MCP-INSTALL · EXTENSION · LASTFM · AIRPLAY ·
                     ROOMS · FRIENDS · DeetsOTD · PROVIDERS · LOCAL-DATA
  ops/            5  RELEASE · RELEASE-NOTES · DEBUGGING · LOGGING · DB-HEALTH
  ideas/          7  unchanged (MatterLights added)
  guide/             the user guide (§13): the template only
  assets/            images
```

- **`scripts/docs-move.mjs NAME=area …`** did it, and stays as the tool for every later move
  (an idea that gets built moves out of `ideas/` with one command). It moved 55 docs with
  `git mv`, re-pointed 447 relative links in every tracked `.md`, and rewrote 218
  `docs/NAME.md` paths in 133 files — code comments, scripts (`tokens.mjs` TARGET,
  `publish-update.mjs`, the checker), `CLAUDE.md`, `AGENTS.md`, `README.md`, `.toml`
  descriptions. A path after another folder name is another repo's and is left alone; this
  repo's own GitHub URL (`…/DeetsMusicWindows/blob/main/docs/…`) is rewritten.
- **The one live URL.** The Agent card's **Guide** button opens
  `…/blob/main/docs/AGENT-SETUP.md` on GitHub (`settings.rs` `agent_open_guide`). It now opens
  `docs/integrations/AGENT-SETUP.md` from the next release. **`docs/AGENT-SETUP.md` stays as a
  stub** (the owner, 2026-09-21) with `moved_to:` in its front matter, so installs up to 0.12.2
  still land on a page that points on. The checker checks a stub only for its target, and
  never resolves a section pointer into a stub.
- **The card copy (F2).** `scripts/docs-copies.mjs` (`npm run docs:copies`) writes
  `cards/SURFACES-AND-CARDS.md` from `architecture/SURFACES-AND-CARDS.md`: links re-pointed for
  `cards/`, `generated:` in its front matter, a line under the title naming the original.
  **Check 18** fails a stale copy (tested: one changed byte in the original fails it).
- **Decided inside the owner's picks:** `QUICK-SETTINGS` (newer than §4.2's list) went to
  `features/`; `DOCS-ORG` stays at the root beside HANDOFF; `docs-frontmatter.mjs` now walks
  every folder and never proposes a version before 0.4.3.
- **Not checked here:** `npx tsc` cannot run in the `dockin` worktree (no `node_modules`). Every
  changed line under `src/` is inside a comment; `settings.rs` changed one string and one
  comment. Other repos that name a DeetsMusic doc path (DeetsSolutions `docs/support.md`) were
  not touched — a bare doc name there still reads right; a path does not.

---

## 12. Release notes: hotfixes must hang off their feature release

> Added 2026-09-20, after 0.12.1. **Paper design. Nothing built. Four forks open (§12.5).**
> This is docs work, so it rides this re-org; but it touches `scripts/publish-update.mjs`,
> the update Worker and the website, not only `docs/`. `RELEASE.md` §6.2 and §6.7 are the
> siblings.

### 12.1 The problem, in one sentence

A hotfix is a peer of the feature release it repairs, everywhere the notes are read — so
**0.12.1, three bug fixes, sits above 0.12.0, which shipped Friends**, and Friends is what
scrolls away.

Two readers lose, in different ways:

- **The website** (`deets.solutions/deetsmusic/`) prints the rows of `index.json` newest
  first, flat. After a few hotfixes, a feature release is below the fold. A reader who lands
  there today meets three bug fixes and no Friends.
- **The update offer in the app** is worse, and it is the one that matters. The offer shows
  the notes of the **target version only**. An install on 0.11.1 that updates straight to
  0.12.1 is told about a fold click, a grey glow and the sea. It is never told that it is
  also getting Friends, Listen Along and the Sharing switch. **The bigger the jump, the less
  the user is told.**

### 12.2 What the code does today (read 2026-09-20, not guessed)

- `scripts/publish-update.mjs` `releaseNotes()` finds `^## <version>` in
  `docs/ops/RELEASE-NOTES.md` and takes the body **up to the first `##` or `###` that follows**.
  So the file is a flat list of `## <version> — <date>` headings by contract, and a `###`
  ends an entry. `### Installing` is the intended terminator.
- The same file is parsed a second way by `--history`:
  `^## (\d+\.\d+\.\d+…)\s+\S+\s+(\d{4}-\d{2}-\d{2})$`. Any heading that stops matching that
  shape stops being a release.
- A missing entry used to publish `notes: ""` (0.6.3 and 0.7.0 went live blank), so the
  script now refuses to publish without one. Whatever we change must keep that refusal.
- `index.json` rows carry `{ version, group, notes, pub_date, size, signature, file }` —
  **no field says which release line a version belongs to.** Nothing downstream can group.

**The consequence for any design: nesting hotfixes under a feature release *inside the file*
with `###` breaks both parsers at once.** The grouping cannot be Markdown depth.

### 12.3 What we want

1. A reader of the website sees **0.12** as one thing: what it added, and what was fixed
   after it.
2. An update offer tells the user **everything they are getting**, not only the last patch.
3. The writing burden does not grow. One entry per published version, as today.
4. The refusal to publish blank notes survives.

### 12.4 The shape that fits (recommendation)

**The line is derived, not written.** `0.12.1` belongs to line `0.12`. No new heading, no
new file layout, no parser change: `publish-update.mjs` computes `line: "0.12"` and writes it
on every `index.json` row. One field carries the whole idea.

Then each reader uses it:

- **Website**: group rows by `line`, newest line first. The line's **feature release is the
  heading and the body**; its hotfixes are a short, collapsed *Fixed after release* list
  under it. A line with no hotfixes looks exactly as it does now.
- **Update offer**: the Worker already knows the caller's version (`?v=`). It returns the
  notes of **every row newer than the caller**, newest first, joined — so 0.11.1 → 0.12.1
  reads the 0.12.1 fixes *and* the Friends entry. An install that is one version behind sees
  one entry, as today, so the common case does not change.
- **`RELEASE-NOTES.md`**: unchanged in shape. A hotfix entry gains one optional first line
  naming its line, for the human reading the file on GitHub.

### 12.5 Forks (open — the owner decides)

| # | fork | recommendation |
|---|---|---|
| **R1** | Where does grouping live: a derived `line` field, or a written one (a `line:` line in each entry)? | **Derived.** A written field is a seventh place to forget a version number ([[deetsmusic-version-four-files]] is already six) |
| **R2** | Does the update offer join every missed version's notes, or only name them ("also includes 0.12.0 — Friends")? | **Join them.** The notes are already written; a name with no body sells nothing. Cap the join at, say, five entries |
| **R3** | Is a hotfix's own entry allowed to be short (three sentences, as 0.12.1), or does it repeat the line's headline feature? | **Short.** The join in R2 is what carries the feature; repeating it ages badly |
| **R4** | Does `docs:check` (§8) gain a rule — "a patch version has an entry, and a line has exactly one feature release"? | **Yes, as a warning.** It catches the 0.6.3 blank-notes failure class one step earlier than the publish refusal |

### 12.6 Cost

`publish-update.mjs`: one derived field, a few lines. The Worker: one filter and a join, plus
a re-read of the index shape. The website (`../DeetsSolutions`): the grouping, which is the
real work. `RELEASE-NOTES.md` itself: nothing today, one line per future hotfix. **No existing
row needs a rewrite** — `line` is derivable for every version already in `index.json`, so one
`--notes-only`-style pass backfills them all.

---

## 13. The user guide on deets.solutions

> Added 2026-09-21. **Paper design. Nothing built. Every fork closed** — U1–U6 (§13.2) and
> U7–U9 (§13.9), the owner, 2026-09-21. This replaces the `USER-GUIDE.md` plan of the 2026-09-14
> public-docs audit: same content, a different home.

### 13.1 What is there today (read 2026-09-21)

- The site's `deetsmusic/` page has five boxes: Install, Status, Release notes,
  Suggestions, Known issues. **There is no user guide.** The release notes are the only
  feature text a stranger can read.
- The release notes already travel the **publish pipe**: `RELEASE-NOTES.md` →
  `scripts/publish-update.mjs` → `index.json` in R2 → `music-api.deets.solutions/update/deetsmusic/releases`
  → `deetsmusic/deetsmusic.js`. The site stores none of it. The guide uses the same pipe.
- The site has no build step and no dependencies. A site string without a `[ph]` prefix is
  the owner's own words (`DeetsSolutions/CLAUDE.md`).
- The site's header nav is **hand-copied into every page** (12 pages link `/deetsmusic/`).
  DeetsMusic is a plain link today; Blog, Games, Utilities and About Me are `nav-group`
  dropdowns. So the dropdown (U4) is an existing control family, and adding it is an edit
  to all 12 navs.
- The Settings rows exist only at run time: `settingsRows()` (`src/settings-card.ts`) mounts
  the Settings card into a detached `div` and reads its rows. There are about 120 row hints.
  A Node script cannot read them without the app. §13.5 says how the reference gets them.

### 13.2 Decisions (the owner, 2026-09-21)

| # | fork | decided |
|---|---|---|
| **U1** | Where the source lives | **In this repo**, `docs/guide/`, a sixth area |
| **U2** | When the site changes | **On each publish.** The guide always describes the version the Download button gives |
| **U3** | Who writes it | **Claude keeps the outline; the owner writes every word.** Claude lists what needs documenting, page by page. The owner writes the prose |
| **U4** | Where it sits on the site | **Its own page**, `deetsmusic/guide/`, reached from a **dropdown on the DeetsMusic tab** in the header |
| **U5** | The Settings reference | **Generated**, to be thorough — every row, every hint |
| **U6** | A shipped feature with no guide page | **Publish warns**, and does not refuse |

### 13.3 The shape

```
docs/guide/
  README.md            generated: the guide's page list, with each page's state (§13.4)
  get-started.md       install, sign in, the first-run walk, the window sizes
  play.md              play, queue, shuffle, repeat, the Compass, the keys
  library.md           Library, Playlists, Pins, Home, Search, History
  look.md              themes, skins, the look schedule, the record player
  share.md             Friends, Rooms, Discord, Song of the Day
  connect.md           Last.fm, AI apps (MCP), the browser extension
  sound.md             EQ, adaptive sound, AirPlay
  fix.md               troubleshooting, the Bugs form, uninstall
  settings.json        generated: the Settings reference (§13.5)
```

Pages are **tasks a user has**, not our feature names. One page covers several internal
docs, so this list is a starting point for the owner, not a decision (U9 in §13.9).

### 13.4 How the outline and the prose share one file (U3)

Every guide page has front matter, like every other doc (§5), with two more fields:

```yaml
---
state: outline | written
covers: [features/PINS.md, features/HOME.md]   # the internal docs this page explains
updated: 2026-09-21
---
```

- **Claude writes the outline.** It is a block at the top of the page, between
  `<!-- outline -->` and `<!-- /outline -->`. It lists, for each shipped feature the page
  covers: what the user can do, the exact gesture or control, the Settings path, and what
  changed in which version. It is a to-do list, not prose.
- **The owner writes the prose** under the block. Claude never edits the prose. This is the
  `[ph]` rule of the site, carried into this repo: no word reaches a stranger that the owner
  did not write.
- **The build strips the outline block.** A stranger never sees it.
- **`state: written`** is set by the owner. Only `written` pages publish (U8).

**How it stays current.** `covers` is to the guide what `sources` is to an internal doc
(§5). When a covered doc's `updated` is newer than the guide page's `updated`, the checker
flags the page. The sweep (§9) then **adds a line to that page's outline** ("0.13.0: Pins
gained On Click — right-click a pinned tile") and stops. The owner writes the sentence.
The sweep never closes the gap in his words.

### 13.5 The generated Settings reference (U5)

- A dev-only export, `__settings.dump()` beside `settingsRows()`, returns every section,
  every row label, its hint, its choices, and its `only` condition ("Ocean only").
  `scripts/webview-eval.mjs` calls it on the running dev app and writes
  `docs/guide/settings.json`. `npm run guide:settings`. It is committed.
- The words are the app's own: the labels and the hover hints already shipped. No new
  wording, so U3 is kept.
- The checker warns when `settings-card.ts` or `settings-store.ts` is newer than
  `settings.json`. It cannot refuse: it needs the dev app running, and the checker runs
  without it.
- The same file automates what the 2026-09-14 audit did by hand (it fixed stale Settings
  paths): every
  `Settings › Section › Row` path written in a guide page must be a real row in
  `settings.json`. That check is a **fact** and fails the build.

### 13.6 The pipe (U1, U2)

1. `npm run guide:build` turns each `state: written` page into a simple HTML fragment:
   headings, paragraphs, lists, links, `kbd`, images, and a `> **Tip:**` quote — exactly
   what `docs/guide/_template.md` uses, and nothing more. The outline block is stripped.
   Images point at `docs/assets/`; how they reach the site is fork **U10** (open). The HTML
   uses the site's existing `.prose` class and no inline style, so it takes every theme
   and skin on the site.
2. `publish-update.mjs` writes `guide.json` (`{ version, pages: [{ slug, title, html }],
   settings }`) next to `index.json`, **in the same publish**. So the guide and the
   Download button change at one moment.
3. The music Worker serves it: `GET /update/deetsmusic/guide`. One new route, read from R2,
   the same shape as `/releases`.
4. `DeetsSolutions/deetsmusic/guide/index.html` fetches it and shows it: a page list on the
   left, the chosen page on the right, and the Settings reference as its own page with a
   filter field. No build step and no dependency on the site side.
5. `--notes-only` gains a `--guide-only` twin: fix a typo in the guide without a new
   installer.

### 13.7 The checks this adds to §8

| # | check | kind |
|---|---|---|
| 12 | a doc with `status: shipped` is in no guide page's `covers` | **suspicion** — this is U6, the warn |
| 13 | a guide page's `covers` doc is newer than the page | suspicion — the sweep's input |
| 14 | a `Settings › …` path in a guide page is not in `settings.json` | **fact** |
| 15 | `settings.json` is older than `settings-card.ts` | suspicion |
| 16 | a `written` page still has an outline line marked new since its `updated` | suspicion |

`publish-update.mjs` prints checks 12 and 16 before it publishes (U6: warn, never refuse).
The existing refusal for blank release notes is untouched.

### 13.8 Build order

1. **Steps 1 and 2 of §11 first** (front matter, the checker). §13 needs both.
2. `__settings.dump()` + `guide:settings`. The owner reads `settings.json` once: it is the
   first honest list of everything the app can be told.
3. `docs/guide/` with every page at `state: outline` and a full outline. **This is the
   hand-over: the owner writes from here.** Checks 12–16.
4. `guide:build`, `guide.json` in the publish, the Worker route. Rides a release.
5. The site: `deetsmusic/guide/`, and the DeetsMusic tab becomes a dropdown (App · Guide,
   the label a link, §13.9 U7) in all 12 navs and the phone menu.
6. The sweep skill (§9) learns step 3a: after an internal doc is repaired, add the change
   to the outline of every guide page that `covers` it.

Steps 2 and 3 collide with nothing. Step 5 is a DeetsSolutions commit.

### 13.9 The small forks (the owner, 2026-09-21)

**U7 — The DeetsMusic tab is a dropdown like Games, and its label is a link.** The menu has
two items, **App** (today's `deetsmusic/` page) and **Guide**, as Games lists DeetsCities
and DeetsMahjong. A click on the word *DeetsMusic* itself opens the app page.
- The other groups' labels are `<button>`s. This one is an `<a>` with the
  `nav-group__label` look. That works because a `nav-group` opens on `:hover` and
  `:focus-within` (`styles/chrome.css:460`), not on a click, so the click is free to
  navigate.
- On a touch screen there is no hover: a tap on the label opens the app page at once. So
  the app page also links to the Guide itself (a link in its page bar), and the phone menu
  (`.nav-menu`) lists App and Guide as two plain items.
- `aria-current="page"` goes on App or Guide, so the group label lights on both pages
  (`chrome.css:430` already does this).

**U8 — Hidden until the owner verifies it.** A page publishes only when he sets
`state: written`. Nothing on the site says a page is missing.

**U9 — Start from the eight pages in §13.3.** The owner merges or splits them. A page may
also become a **subsection** of another page when it is too thin to stand alone. So the
build treats `##` headings inside a page as its sub-entries in the guide's page list, and a
page that becomes a subsection keeps its `covers` list (it moves with the text), so the
staleness check still finds it.

**U10 — OPEN (2026-09-21): how guide images reach the site.** **A** `publish-update.mjs`
uploads each image a written page uses to R2 beside `guide.json`, and the build rewrites the
path — version-locked like the text. **B** the page links the image on GitHub `main` — no
upload, but a picture can show a newer app than the Download button. Recommendation: **A**.

---

## 14. Release tags and the tasks index

> Added 2026-09-21, from the owner's questions during step 1. **Paper design. Nothing built.
> Forks T1–T4 and X1–X4 open (§14.3).**

### 14.1 Release tags

The repo has **no git tags**. Step 1 had to find each release by the commits that changed
`package.json`'s version (29 of them), and then ask git whether a feature's first commit
sits before one. That works, but it is a guess about which commit was built.

A git tag names **one commit**, not a file. `v0.12.2` on the 0.12.2 commit marks the whole
tree as it was at that release. That is exactly what `shipped_in` needs:

- `git tag --contains <commit>` answers "which releases hold this feature" in one call.
- `git diff v0.12.2 -- docs/` answers "which docs changed since the last release" — the
  sweep's best input.
- Check 5 (versions) compares against the newest tag instead of six files.

Two parts:
1. **Backfill.** Tag the 29 past version commits. A withdrawn version (0.12.0, 0.12.1) gets a
   tag too, **annotated** "withdrawn: <reason>", because it is history. The checker reads the
   annotation and never counts it as shipped.
2. **From now on.** `publish-update.mjs` makes the tag when it publishes, so *published* and
   *tagged* are the same event. `--withdraw` rewrites the annotation.

### 14.2 The tasks index — a SQLite file nobody writes by hand

**What it is.** One SQLite file, **derived** from the docs and git and **rebuilt from scratch**
every time. It is never edited. It is never the truth: the docs are. It answers "what is open"
in one query instead of reading 60 docs, or `CLAUDE.md`'s status paragraphs.

**Tables.**

| table | one row per | from |
|---|---|---|
| `docs` | doc | front matter (§5) |
| `parts` | part marker | §5.1 markers |
| `desk_tests` | desk test named open | front matter + part markers |
| `forks` | open fork | a part marker's `forks §…` field (not table scraping: fork tables have no shared shape) |
| `releases` | tag | `git tag` + annotations |
| `guide` | guide page | `docs/guide/` front matter (§13.4) |

**Built with** `node:sqlite` (in Node 24, checked 2026-09-21). No new dependency.

**Passively maintained** means nobody runs it on purpose:
- a **post-commit hook** rebuilds it after every commit (a tracked `.githooks/` folder and
  `core.hooksPath`, so the hook travels with the repo);
- `npm run docs:check` rebuilds it too;
- a Claude Code **SessionStart hook** prints a ten-line summary from it (open desk tests,
  `project` docs, `built`-not-shipped). This is what replaces the state paragraphs that
  D2 takes out of `CLAUDE.md`: the same facts, generated, and never stale.

**Reading it.** `npm run tasks` prints the open list. `npm run tasks -- "<SQL>"` runs a
read-only query. The file is git-ignored.

### 14.3 Open forks

| # | fork | recommendation |
|---|---|---|
| **T1** | Tag names | **`v0.12.2`** — the common shape, and what GitHub Releases expect |
| **T2** | Backfill all 29, withdrawn ones included (annotated)? | **Yes** |
| **T3** | Push the tags to GitHub (public, and hard to take back)? | **Yes**, after you read the list once |
| **T4** | `publish-update.mjs` tags on publish from now on? | **Yes** |
| **X1** | The tables in §14.2 — right set? | **Yes**, and `forks` only from markers |
| **X2** | Rebuild by post-commit hook + `docs:check`? | **Yes** |
| **X3** | Where the file lives | **`.claude/tasks.db`**, git-ignored — beside the session settings that read it |
| **X4** | A SessionStart summary from it? | **Yes**, capped at ten lines |

---

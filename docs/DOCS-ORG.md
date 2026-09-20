# DeetsMusic — Docs organization

> **Status (2026-09-20): PAPER DESIGN. NOTHING MOVED.** No file is renamed, no link is
> rewritten, no script exists yet. Every number in §1 was measured against the tree on
> 2026-09-20. **Five decisions are closed (§3, the owner, 2026-09-20).** Six forks are
> open (§10). Build order is §11.

**What you asked for.** Three things:
1. A high-level overview that a new reader meets first.
2. The docs sorted — ideas, techniques, and by feature set.
3. A skill that brings every doc up to date, flags staleness and version mismatches,
   and fixes them.

Siblings: [HANDOFF.md](HANDOFF.md) · [LESSONS.md](LESSONS.md) · [RELEASE.md](RELEASE.md)
(the release check is where §8 runs).

---

## 0. Terms

Define these once. The rest of the doc uses them exactly.

- A **doc** is one `.md` file under `docs/`.
- A **link** is a markdown link to another doc: `[TOASTS.md](TOASTS.md)`. There are 476.
  A link carries a path, so a move breaks it.
- A **mention** is a doc named in prose with no link: `TOASTS.md §5`. There are about
  1,000. A mention carries no path, so a move does **not** break it.
- A **section pointer** is a mention with a section number: `TOASTS.md §4a`. There are 178
  unique ones.
- **Front matter** is a YAML block at the top of a doc, between two `---` lines. No doc has
  one today.
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
`docs/STATIONS.md → ideas/DeetsOTD.md`. Both were made by one move: `DeetsOTD.md` left
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
status: shipped | built | designed | parked | idea
shipped_in: 0.11.0          # omit unless status is shipped
desk_test: passed 2026-09-19 | open | none
sources: [src/toast.ts, src-tauri/src/playlists.rs]
updated: 2026-09-20
---
```

The five values of `status`, defined once:

| value | meaning |
|---|---|
| `shipped` | in a published installer, and in someone's hands |
| `built` | in the tree, not yet in a published installer |
| `designed` | every fork closed, no code |
| `parked` | designed and deliberately stopped; kept as a record (PROVIDERS) |
| `idea` | not designed. Everything in `ideas/` |

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
([RELEASE.md](RELEASE.md)) next to the stale-`TOKENS.md` gate.

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
| **F1** | Folder names: `architecture/` or `techniques/` | `architecture/` — the folder holds `DATA-ARCHITECTURE.md` and the token system, which are not techniques |
| **F2** | Do the card docs (`CARD-GROW`, `CARD-SWAP`, `CARD-MEMORY`, `STAGE-COLUMN`) sit in `architecture/`, or in their own `cards/`? | `architecture/`. Four docs is not a folder. Ask again at seven |
| **F3** | `NEXT-VERSION.md` and `FUTURE-SETTINGS.md` — root, or a `backlog/` folder? | Root. 45 links point at the two of them, and they are entry points, not area docs |
| **F4** | `ONBOARDING.md` — `architecture/` (it is the hint ledger, and every `title` in the app is a row in it) or `features/` (it is the first-run walk)? | `architecture/`. The ledger is the load-bearing half |
| **F5** | Does the checker fail the release check on day one, or warn for a week first? | Warn first. The first run will be loud, and release day is the wrong day to meet a loud new gate |
| **F6** | Does `docs/README.md` replace the `CLAUDE.md` pointer list, or do both exist? | Both. The `CLAUDE.md` list is what a session has without opening a file. `docs/README.md` is what a human browses |

---

## 11. Build order

Each step is its own sitting and its own commit. Steps 1 and 2 are mechanical and reversible.
Nothing here is started.

1. **Front matter on all 66 docs.** No moves. This step makes every later step checkable,
   and it is the only step that touches every file.
2. **The checker**, `scripts/docs-check.mjs`, with checks 1–5 and 11 only. Run it. Read the
   first report before writing checks 6–10 — the report says which suspicions are worth the
   code.
3. **The move**, plus the link rewrite, plus `docs:index`. One commit. The checker proves it.
4. **`CLAUDE.md`** rewritten to one line per doc.
5. **The `HANDOFF` / `WORKLOG` split.**
6. **The sweep skill**, last, because it is worth nothing until the checker exists.

Step 1 collides with no feature work. Step 3 collides with any branch that edits a doc, so it
wants a quiet tree. Branch `twelve` has 11 modified docs uncommitted today.

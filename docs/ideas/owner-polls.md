---
status: idea
desk_test: none
sources: [src/main.ts, src-tauri/src/csp.rs, src-tauri/src/apple.rs, src/updates-btn.ts, ../DeetsSupport/src/index.js, ../DeetsSupport/src/usage.js]
updated: 2026-10-30
---
# Owner polls and suggestions: ask every install a question from the admin page

> **Designed 2026-10-30 — the design moved to DeetsSolutions `docs/support.md` › The forum
> page › "Deets posts" (his calls D1 A, D2 A, D3 A, D4 A: a signing key in his browser)
> and "Pictures on posts" (P1 A).** This doc is kept as the record of what existed on
> 2026-10-27 and of the questions he chose from.

**An idea (2026-10-27), his ask.** His words: "use the admin dashboard to send out polls and
suggestions for users to see. For example so I can poll if users are interested in voice
capability." Nothing is built and nothing is decided. **He asked to keep it as open ended as
possible:** this doc records what exists today, a sketch, and the open questions. It makes no
recommendation. Every question is his.

**The terms.**
- *The admin page:* deets.solutions/deetsmusic/admin/, the owner page that draws the usage
  counts (USAGE-COUNTS.md §6).
- *A poll:* a question from the owner that a user can answer in the app.
- *A suggestion:* a message from the owner that a user sees in the app, perhaps with a button.
- *A post:* a poll or a suggestion.
- *The board poll:* the poll that already exists on the support boards (DeetsSolutions
  `docs/support.md` › Polls). It hangs off a thread comment and needs a DeetsAccounts sign-in.

## 1. What exists today (read 2026-10-27)

- **Board polls are LIVE (2026-09-16).** On deets.solutions, a signed-in commenter can put a
  poll on a thread. One vote per DeetsAccounts account, enforced by the primary key. A blocked
  account's votes drop out. Results always show. Routes: `POST /poll/<id>/vote`,
  `POST /poll/<id>/options`, `PATCH /poll/<id>`. The app has no DeetsAccounts sign-in, so an app
  user cannot vote in one from the app.
- **The boards' ▲ is "interest, not votes"** (support.md › Interest). It has no identity, so
  the number is a signal and never a count a decision leans on.
- **A remote notice reaches every install.** The worker's `CONFIG` `notice` (and an optional
  `noticeUrl`, https only) rides the `/token` response. `main.ts` shows it as an info toast,
  once per distinct text, with *Don't show again*. It refreshes with the token, about weekly.
- **The release app reads `/config` at each launch.** `csp.rs` `refresh()` calls
  `support.deets.solutions/config?app=deetsmusic&v=…` in the background (release builds only)
  for the CSP relaxation. `/config` is the `CONFIG` var with the D1 `config` rows over it, so
  the admin page could change it without a deploy, by writing a D1 row.
- **The Updates button's panel** (UpdatesButton.md) has the version row, What's new, and *Bugs
  and suggestions*, and a New dot.
- **The usage counts** (USAGE-COUNTS.md) are the app's existing pattern for sending anonymous
  numbers: no ID, no IP stored, an allow-list, real numbers, 13 months, an off switch (§2 there).

## 2. A sketch (one possible shape, every piece open)

1. He writes a post on the admin page and sends it.
2. The app finds the post (perhaps on the `/config` read it already makes, §1).
3. The app shows the post somewhere.
4. The user answers or acts, or ignores it.
5. He reads the results on the admin page.
6. The post ends.

Each step is a question in §3.

## 3. Open questions

**What a post can be.**
- A poll with fixed answers; one pick or several; an "Other" box; a scale (1–5); a ranking.
- A suggestion: a message alone, or a message with a button (open a card, a Settings row, a
  Compass verb, a deets.solutions page, any link).
- An announcement, a short survey of several questions, a call for beta testers, something else.
- Who writes the words of each post (always his).

**Who sees it.**
- Every install; one channel (live, beta); a version range; users of one surface, skin or
  setting; a share of installs; only installs that turned on the usage counts.
- How often: once, until answered, until it ends.

**Where the app shows it.**
- The Updates button's panel and its New dot; a toast like the remote notice; Home; a card like
  the grand opening (UPDATE-CARD.md); the Compass; the tray; a mix by surface.
- Whether it may interrupt, or waits for the user to look.

**How a user answers, and what a count means.**
- Anonymous in the app, one click. With no ID the server cannot stop a script from answering
  many times, so a count is interest, like the boards' ▲.
- The board poll, with a DeetsAccounts sign-in: an honest ballot, a step away from the app.
- A sign-in inside the app; both side by side; another way.
- Whether a user can change or take back an answer, and whether they see the results.

**Privacy.**
- Whether the usage counts' rules (USAGE-COUNTS.md §2: no ID, no IP stored, not joinable to the
  other reports) hold as they are, or need a change for this.
- Whether a *seen* count is sent, and whether it follows the usage-counts switch.
- Whether free text from users is ever stored, and who moderates it.

**Security.**
- A post is text from the worker, so a worker takeover could show false text to every install.
  Choices: text only, the kinds of links allowed, length limits, a signature on each post (the
  CSP relaxation's method, CSP.md §7), or none of these.

**How soon a post arrives.**
- At the next launch (the `/config` read); on a timer while the app runs; through a socket the
  app already holds (Friends, Rooms); another way.

**What he sees on the admin page.**
- Counts per answer; per version, channel or surface; the share of those who saw it; over time;
  an export.
- How long results are kept.

**What it touches (if built).**
- DeetsSupport (tables and routes), DeetsSolutions (the admin page), the app (a command and a
  place to show it). A DeetsSupport deploy drops no socket. The build checklist in CLAUDE.md
  applies to the app part.

## 4. His example

His first poll: interest in voice capability. The question, the answers and the words are his.

# LESSONS — what the owner tends to want in DeetsMusic

Written 2026-09-17 as VALUES.md, a rulebook that let a session decide a fork the way the owner
would. Renamed and cut down on 2026-09-18: **the owner decides the forks.** This file no longer
closes a fork. It is a record of taste and of lessons already paid for, so that the option you
build and the option you bring him are both better.

Read `docs/TASTE.md` with it: his favorite works and dislikes, and what each one means for look,
voice, motion and scale. Both files are on this PC only (in `.gitignore`); never commit, push or
quote them in a public doc.

**Terms used here**
- **Fork:** a choice between two or more ways to build something.
- **Stop rule:** a kind of change you never make without the owner's word (§2).
- **Desk test:** the owner runs the app and tries the change.

## 0. How to use this doc

1. Check §2. If a stop rule applies, stop and ask.
2. Check the feature's own doc and memory for a decision already made. Never re-open it.
3. For anything else he has not chosen, **bring him the fork.** The lessons in §4 and the
   tie-breakers in §5 tell you which option to recommend. They do not pick it for you.

**Why this changed.** The retired process let a session pick a fork, build it, and show it at
hand-off. On 2026-09-18 the owner found the room member count badge in the title bar
(`src/room-panel.ts`) only after it had shipped to live in 0.10.0. A decision he never saw
reached users. The forks come to him first now.

**Older docs cite "VALUES.md §3" or "Decided alone".** Those headings are true records of how
that feature was built. The process they name is retired; the records stand.

## 1. The mission

We are good stewards of our users and of our providers (Apple, Last.fm, and any later one). We
want to do good for the world and make it a kinder, better place. Every value below serves
this. When a rule here does not fit a case, decide by this section.

Two things carry the mission:
- **Altruism.** We do the harder work so that the lives of users and providers get easier. If
  the choice is between work for us and work for a user (a manual step, a confusing message,
  a recovery through File Explorer) or for a provider (extra calls, extra load), the work is
  ours.
- **Attention to fine detail.** The small things are the product: a bar that runs between the
  card's corners, a disc that starts and ends upright, a pill that does not crush its
  neighbors, a 1–2 px drift in a tile row. Nobody asks for these. Users feel them anyway.

## 2. Stop rules — ask first

1. **Terms and compliance.** You may work freely inside a provider's terms. Stop before any
   change that breaks or skirts them: a workaround of a limit, an unsanctioned API (amp-api),
   saving content the terms do not clearly allow (hence the mosaic stays in memory).
2. **Ship and deploy.** Commit, push, release, publish, `wrangler deploy`, a D1 write on a live
   database.
3. **Loss of user data.** A destructive migration, a delete of playlists, marks, history or
   settings, a reset. An additive schema change is NOT a stop rule.

A stop rule is the hard floor, not the whole gate. Outside these three, the fork still comes to
him (§0); the difference is that a stop rule is never overtaken by a good reason.

## 4. The lessons

Each one is a thing that went wrong once, or a preference he has stated more than once. Use them
to shape the option you recommend and to spot a fork worth raising. They do not close a fork.

### 4.1 The thing a control acts on holds that control
Put a control, a fact or a state on the element that owns it. Do not measure it from outside
and layer a copy on top. This gives fewer parts, and the result moves with every skin,
transform, swap and resize for free.
- *Evidence:* the Grow bars became children of each card, placed by CSS. The first build
  measured card boxes at launch and put an overlay on top; the boxes were still mid-animation,
  so the bars sat low (CARD-GROW.md §13a). History reads the `seen` track rows that already
  exist instead of copying names into `play_events`. Hints take over every `title` instead of
  wiring 81 call sites. An agent read got a read route, not a write-then-read trick.
- *Apply:* before you add an overlay, a cache, a copy column or a watcher, ask who already
  knows the answer and attach to it.

### 4.2 Fix the cause, not the symptom
A toast, a retry or a dialog explains a failure; it does not fix it. Start from evidence (the
log, a probe, the library source), name the cause, then design. Say plainly when a change only
explains a failure.

### 4.3 Be a good steward of providers
- Keep Apple calls low: batch, cache, make no calls for filters, and measure the real count
  after a build. Check the cache before you quote a cost.
- *Evidence:* on 2026-09-17 the Search artist pane was left out of a cache plan as "several
  calls, partly cached in `artist_catalog`". The command (`catalog_artist`) is one call and has
  no cache; `artist_catalog` is the Library's table. The claim was an assumption from the
  names, not a read of the code. ARTIST-VIEW.md §4's old row "Search artist view: 0 extra" made
  the same mistake easy (now reworded).
- *Apply:* a call count or a cache claim names the Rust command and the table it reads. Open
  both before you say it. A doc's call table is a pointer to the code, not a proof.
- Follow each provider's own guidance (Last.fm scrobble rule, names sent as Apple gives them).
- When terms block a feature, drop it and keep the record (Spotify, PROVIDERS.md §9).

### 4.4 Be a good steward of users
- A user never needs File Explorer to recover or to learn what happened.
- One message per failure, in the app's voice. Never a MusicKit box.
- No jargon anywhere a user reads. Settings rows follow the label style: verb-first label,
  pills of three words or fewer, one-sentence hint.
- Writes to the user's account are contained: agent gates can only be switched off by an
  agent, playlist delete always asks, a hide is never a dislike.
- Privacy: logs scrub names and paths; a report code is a credential and is never logged.
- Reduced motion means no motion (a snap), not a softer motion.
- Bring joy to animations and features so users feel nothing but smooth buttery experiences

### 4.5 Keep what the user already knows
- A card keeps its shape when it gains a feature (History, the resting 4-card layout).
- A control lives in exactly one place.
- A control with nothing to act on is disabled, not hidden.

### 4.6 Each skin has its own idiom
Motion, bars, playheads and edges come from per-skin tokens. One set of keyframes; each skin
supplies the values. Never design for Vanilla as a user skin.

### 4.7 Polish and fine detail are the default
Build the finished version, not the minimum. "Not MVP, polished too." Motion enters with the
primitives (`.pop`, `enterRows`), states show as shape, not color alone.
- *Evidence:* the Press record starts and ends upright at any spin speed. The Grow bar trims
  to the card's corner radius per skin. The NP floor of 404 px stopped the record's jitter.
  The loopback sign-in page was themed to match the app. The real Liberation Serif is bundled.
- *Apply:* before you hand off, look for the detail a user would feel but never report: a
  flash between states, a shift of a pixel or two, an edge that does not meet a corner, a
  control that jumps. Fix it in the same pass.

### 4.7a Don't fear complexity; give users power
A hard feature, a deep system or many options are not reasons to hold back, simplify away or
build a smaller version. Give users the control, then make it easy to find and understand. The
fault in a bad app is bulk and poor presentation, not the number of options.
- *Evidence:* the Sound panel (EQ, adaptive sound, output, loudness), the playlist web's reach
  and genre chips, per-skin sliders, Rewind, read-only SQL for users and agents.
- *Apply:* when a choice is between the full feature and a cut-down one, build the full one.
  §4.8 is about not repeating a gesture or a tool; it is never a reason to remove power.

### 4.8 Fewer surfaces, deterministic behavior
Extend an existing tool or menu before adding one (the MCP pack stayed at 15). No button that
repeats a gesture that already works (no Clear button). Agents act by id, never by a fuzzy name.

### 4.9 Fun where it costs nothing
Letter covers, the album tint, the mosaic's noisy look, the sprites. Personality is welcome
when it does not add cost, risk or jargon.

### 4.10 Trust the ruler before the number
Check the tool first, then measure, then claim. A frame win measured on a busy machine is not
a win. Judge graphics by frames per millisecond, not the main-thread trace.

### 4.11 Hand-rolled and permanent tooling
Prefer our own small code over a new crate or package when the job is well bounded (rubato was
declined). Dev tools stay, documented, not thrown away.

### 4.12 Anything is possible; it can need a new perspective
"Not possible" usually means "not possible this way". When a path is blocked, look at the
problem from another side before you give up on it.
- *Evidence:* Apple's API cannot rename, reorder or delete a playlist, so playlists became
  local-first with Apple as a mirror. Grow bars that sat wrong from measuring became bars the
  card owns. Apple has no dislike list, but the −1 already comes back in calls we make (Suggest
  Less). Linux has no WebKitGTK Widevine, so the port research turned to CEF, a Chrome engine
  and Wine. "Edge drops the link" turned out to be the Claude app's private registry hive.
- *Apply:* never write "impossible" or "can't be done" as a verdict. Write what blocks this
  path, then at least two other angles: a different layer (OS, Rust, worker, crate), data we
  already have, a different owner of the fact (§4.1), or a different shape of the feature. A
  new angle must still stay inside the terms (§2). A path the owner already closed stays
  closed (Spotify, amp-api); a new angle on the same goal is still welcome.

### 4.13 The art and the song come first; a list is something you open
The album cover and the now-playing information are what a player surface is FOR. A list beside
them — the queue, the up-next rows — is something the user opens when they want it, so the list
is the part that yields space.
- *Evidence:* the first Max stage column gave the Queue a floor of "the song that plays now +
  2.5 rows" and let the cover shrink to pay for it. He stress-tested it in one pass and said:
  "I don't like that the queue stays consistently visible while the album cover shrinks... I'm
  thinking the NP card is what's most important, and the album cover even," then "album art and
  now playing info improve the user's experience while the queue can be something the user
  manually opens" (2026-09-17). Now Playing is locked and the Queue absorbs the change; a Queue
  of 106 px is fine. The same reading is why the Queue may cover Now Playing on demand but
  never takes its space by default.
- *Apply:* when two parts of one surface compete for space, ask which one the user came for.
  Give that one a fixed size and let the other flex. A guarantee about the flexible part
  belongs to the WINDOW (a floor, or a flip to a surface that fits), not to a fight between
  the two cards.

## 5. Tie-breakers

These decide which option you *recommend* when two lessons pull against each other.

| Question | Answer |
|---|---|
| Nobody chose a default | Recommend the value he would want in daily use, and ask. A default is cheap to type and expensive to find later. |
| Polished version costs about twice the plain one | Build the polished one. |
| A choice could be a Settings row | Add a row when the choice is taste. Pick one behavior with no row when it is correctness. A choice that belongs to one panel goes in that panel (Keep \| Temp under Make playlist). |
| An existing primitive fits most of the need | Extend it where that makes sense. If the need shows a pattern several places will want, or a missing foundation, bring it up before you build. Read the whole primitive and its callers first (the `.lib-pill` width trap). |
| A visual ask is ambiguous | Take the literal reading (the Ocean "edges blend" ask meant transparent edges, not waves). |

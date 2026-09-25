---
status: shipped
shipped_in: 0.4.3
desk_test: passed 2026-09-20
sources: [src/toast.ts, src/styles/toast.css]
updated: 2026-09-20
---
# DeetsMusic — Toasts

> Built 2026-09-13 (branch `claude/deetsmusic-toast-impl-rfw6ch`). **The sticky queue's desk
> test (§4a.7) PASSED 2026-09-20** — the owner ran it with the three other features of that
> day and confirmed all of them. The 2026-09-13 primitive's own first desk test — the test script is [DEBUGGING.md §Toasts](../ops/DEBUGGING.md#toasts). Code:
> `src/toast.ts` (the primitive), `src/styles/toast.css` (the host + strip), the `toasts`
> key in `settings-store.ts`, the "Show notices" row in `settings-card.ts`. Design
> history and the candidate ledger: [FUTURE-SETTINGS §18](../FUTURE-SETTINGS.md).
> Reference build: the Deets.Solutions toast (`DeetsSolutions/js/toast.js`,
> `docs/ui.md` §Toasts) — same API, same token model; the differences are §3.

**Terms.** A *toast* is one transient message strip. The *host* is the fixed container
that holds the stack. A *kind* is the severity: `info` · `success` · `warn` · `error`. A
*tier* is the user setting that decides which kinds show. A *notice* is a one-time toast
with a "Don't show again" button.

## 1. The API

```ts
import { toast } from "./toast";
const h = toast({ kind, text, sticky, timeout, actions, dismissKey, priority });
h.dismiss(); h.update("new text"); h.shown; h.queued;
```

| Field | Meaning |
|---|---|
| `kind` | Color + ARIA role only (`error` → `role="alert"`, the rest `role="status"`). Default `info`. |
| `text` | The message. **Callers own their copy**; the module ships none. |
| `sticky` | No timer; stays until a button is pressed. **Default: `true` for `error`, `false` otherwise.** A sticky toast always ends with a Dismiss button. |
| `timeout` | ms for timed toasts. Default 3200. Hover pauses the bar and the timer together. |
| `actions` | `[{ label, run? }]`. Any press runs `run`, then dismisses. |
| `dismissKey` | Makes a **notice**: sticky, admitted under the `failures` tier whatever its kind, a "Don't show again" button writes `"off"` to that localStorage key, and the call is inert once that is written. `noticeOff(key)` reads the flag. |
| `priority` | `"ask"` \| `"offer"` — the **queue** rank (§4a), and how long this toast may wait when the stack is full. **Default: `"ask"` when a sticky toast carries the caller's own actions, `"offer"` otherwise**, so no call site says it unless it wants the other answer. An ask jumps ahead of offers in the queue and is dropped after 30 s rather than shown late; an offer waits as long as it must. Inert on a timed toast, which never queues. |
| `onceKey` | Makes a **once-notice** (2026-09-14): sticky, shows under every tier, ends with **Got it** instead of Dismiss, and **any** button press writes `"off"` to the key — it has been seen. Used where the notice also points to Settings (a **[Settings]** action → `requestSetting`). |

`queued` is `true` while the toast waits for a slot: admitted, but not on screen yet (§4a).

`shown` is `false` when the tier or a silenced notice swallowed the call. The call site's
console/diag logging is untouched either way — **diag stays the source of truth** (every
call logs `toast` or `toast:muted` with the reason).

## 2. The sticky rule (decided 2026-09-13)

The kind is severity; sticky-or-timed is *what the user must do*:

- **`error` = sticky.** Something the user must know or act on, and the moment may have
  passed (a 5-minute sign-in timed out while the flyout was closed; no token at launch).
- **`warn` = timed.** A routine failure with nothing to do: the click did nothing, here is
  why. Lives 3.2 s (6–8 s when it names songs or explains a cause).
- **`success` / `info` = timed.** Confirmations and unlocks. `info` with a `dismissKey` is
  a notice and sticky.

A caller may override `sticky` either way; none does today.

## 3. Where it differs from the site

| | Deets.Solutions | DeetsMusic |
|---|---|---|
| Position | top-right column under the header | **top-right, newest on top**, on every surface. **mini/midi:** under the Now Playing card, so the song stays readable (`--toast-top`, the card's bottom edge measured by `toast.ts`) · **max:** under the titlebar, since the stage is on the left. Changed 2026-09-13 from bottom-centred in mini/midi. |
| Fly-in | from the right | from the right (`--toast-shift`) |
| Cap | 4 | **3** — the oldest *timed* toast yields first; sticky ones only when nothing timed is left, **which destroys them with their actions unrun — see §4a** |
| Setting | none | `toasts`: `all` (default, 2026-09-13) · `failures` — Settings › Look and feel › **Show notices** (no `off` since 2026-09-14, §4) |
| Notices | none | `dismissKey` + `noticeOff()` |
| Sticky default | caller's choice | `error` sticky by default (§2) |
| z-index | 50, above menus | **90, below** the context menu / pickers (100): an open menu is live intent, a toast waits |
| Buttons | the `tb-pill` kit | `.toast__btn`, the context-menu row idiom |

Everything else is a straight port: menu material (`--menu-surface` + `--menu-backdrop`,
so Glass frosts it), `--radius-panel`, `--shadow-panel`, `--border`; the kind stripe from
the theme's traffic lights (`--go` / `--pause` / `--stop`, info `--panel-border`) so the
monochrome themes express severity in-family; `--dur-med` / `--ease-ui`; reduced motion
snaps. Skin tokens added: `--toast-w` (304px), `--toast-stripe`, `--toast-bar`,
`--toast-shift`. The **duration is a module constant**, not a skin token: a skin reshapes
the app, it does not decide how long a message stays.

## 4. The tiers

| Tier | Shows |
|---|---|
| `all` (default) | every kind — confirmations (`success`) and unlocks (`info`) too |
| `failures` | `warn` + `error` + every notice |

**No `off` (removed 2026-09-14).** A failure must always reach the user; a saved `"off"`
migrates to `failures` (`settings-store.ts`). **A question always shows:** a sticky toast
with the caller's own `actions` is admitted under every tier, because a muted question would
stop the action it gates (the export confirm, PLAYLISTS.md §6). A question is not a failure:
it writes only its `toast` diag line, never the `warn`/`error` line (2026-09-14, for the red
delete confirm). A question with its own **Cancel** button gets no extra Dismiss.
**An Undo always shows too (2026-09-15):** a toast with an action labelled *Undo* is admitted
under every tier, timed or sticky, because a muted one would lose the undo (Settings › Reset).

## 4a. The sticky queue (designed 2026-09-19, **BUILT 2026-09-20**)

> Asked for by the owner on 2026-09-19: *"can we set up queues for sticky toasts so they can
> appear after space opens up?"* Every fork is closed (§4a.5). **§4a.8 is as built.**

### 4a.1 The hole it closes

This is not only a missing feature. Today, past the cap, the loser is **destroyed**:

```ts
while (live().length >= CAP) {
  const victim = kids.find((k) => k.querySelector(".toast__bar")) ?? kids[0];
  victim.remove();            // ← gone, with its buttons and their closures
}
```

`.toast__bar` is the timer bar, so a **timed** toast is preferred as the victim — which is
right. But when all three live toasts are **sticky**, `kids[0]` is taken: the oldest sticky is
removed **with its actions unrun**. A sticky toast is the app's only way to ask a question, so
what can be destroyed this way includes:

- an **Undo** (Settings › Reset) — the only way back from a reset,
- the **export question** (PLAYLISTS.md §6) — the gate before an Apple write,
- a **one-time notice**, silently spent without being read,
- the planned **[Get them]** offer ([PLAYLIST-REFRESH.md](../features/PLAYLIST-REFRESH.md) §7.2).

§4 says *"a question always shows"* and *"an Undo always shows too"*. **The cap can break both
promises today.** A queue is what makes them true.

### 4a.2 The rule

**Only sticky toasts queue.** A timed toast's information is momentary — *Link copied.*
arriving eight seconds late is worse than not arriving — so timed toasts keep exactly today's
behaviour.

Admission, in order:

1. Room under the cap → show it.
2. Full, and at least one live toast is **timed** → evict the oldest timed one, as today. A
   sticky outranks a timed toast; a timed toast outranks nothing.
3. Full, and every live toast is **sticky** → **the new one queues** (FIFO). Nothing is
   destroyed.

A slot frees (a dismiss, a press, a timer) → the head of the queue shows at once, with the
normal arrival motion.

**This inverts the priority only in case 3**, and only there is the inversion right: an older
sticky is one the user may be reading, with a live action under the pointer.

### 4a.3 What the handle must do

`toast()` returns its handle **synchronously**, and callers hold it (`apple-health.ts`'s
reconnecting line, `settings-card.ts`). A queued toast has no element yet, so:

| | Behaviour while queued |
|---|---|
| `dismiss()` | **Removes it from the queue.** It never appears. This is the `"Reconnecting…"` case: the cause cleared while it waited |
| `update(text)` | Rewrites the **pending** text, so what finally shows is current |
| `shown` | Stays **`true`** — existing call sites branch on it, and the toast *will* show. A new `queued: true` flag says the rest |

**A notice re-checks its key at dequeue.** A `dismissKey` / `onceKey` toast that waited while
another instance was silenced must **not** appear. `noticeOff(key)` is re-read on the way out
of the queue.

### 4a.4 Bounds

Failures arrive without bound, and §Recovery bounds says every layer caps itself.

- **Identical text does not queue twice.** The repeating-failure case is the real overflow
  risk, and one line saying it once is the whole of its information.
- **Queue cap 10.** Past it the **newest** is dropped: a user already holding three notices
  plus ten waiting learns nothing from a fourteenth.
- Every queue, dequeue and drop writes a `diag` line (`toast:queued`, `toast:dequeued`,
  `toast:dropped`), because the queue acts on its own — CLAUDE.md checklist item 6. A dropped
  sticky **must** be traceable, or this feature hides the very thing it set out to fix.

### 4a.5 The forks, closed 2026-09-20

| # | Question | His answer |
|---|---|---|
| Q1 | Does a queued sticky go stale? | **A named `priority`, with the default derived.** The owner rejected a raw `maxWait` in ms while it was being built: a number at twenty call sites says nothing about what it means. `priority: "ask" \| "offer"` instead, defaulting to `"ask"` when a sticky toast carries the caller's own actions — so **no call site had to change**. An ask waits 30 s, an offer waits for ever. |
| Q2 | Is a waiting notice visible? | **Q2a — nothing.** The queue drains as fast as you dismiss, and a counter is a new control with its own family rules. |
| Q3 | Does the queue survive a surface switch? | **Yes.** The live toasts already move with the surface (one host, CSS places it); the queue is module state and survives with them. A queued question is still a question you owe an answer to. |
| Order | FIFO, or does rank decide? | **An ask jumps the line** — behind the asks already waiting, ahead of every offer. What gates an action is never stuck behind two harmless offers. |

**A fact found in the call sites while building, which changes what Q1 was about.** Every
**Undo** toast in the app is **timed**, not sticky — Settings › Reset, Home › Hide, the sleep
timer, Song of the Day, playlist expiry. A timed toast never queues, so *"an Undo surfaces two
minutes late"* — the hazard Q1 was written around — **cannot happen**. The sticky call sites are
really three classes: questions that act on a stale intent (the two playlist delete confirms, the
Reset ask, the two agent-write consents), offers that are harmless late (the update offer, the
export retries, the planned `[Get them]`), and status notices. The derived default sorts them
without a single call site being edited.

### 4a.5a The original fork sheet (kept as the record)

**Q1 — does a queued sticky ever go stale?** An Undo that surfaces two minutes after the reset
is a hazard: the user has moved on and may press it without the context. A `[Get them]` offer
two minutes late is harmless.
- **Q1a** No expiry — sticky means sticky. Simplest, and the Undo hazard is real.
- **Q1b** A new `maxWait` option, default none; the Undo and question call sites pass a short
  one (say 30 s) and are dropped rather than shown late. *Recommendation* — it is the only
  option that distinguishes the two cases, and it is one field.
- **Q1c** A blanket expiry for every queued sticky.

**Q2 — is a waiting notice visible?** Three shown plus ten waiting is invisible today.
- **Q2a** Nothing. *Recommendation* for a first build — the queue drains as fast as the user
  dismisses, and a counter on the stack is a new control with its own family rules.
- **Q2b** A `+N` mark on the stack's edge.

**Q3 — does the queue survive a surface switch?** The host moves between mini/midi and max
(§3). The live toasts move with it; a queue is module state and would too. Confirm that is
wanted, since a queued notice then crosses a surface change it was not raised in.

### 4a.6 The checklist

1. **Motion.** A dequeued toast uses the normal arrival — no new animation.
2. **Tokens.** None, unless Q2b wins.
3. **Hints.** None (no new hoverable control), unless Q2b wins.
4. **Toasts.** No new call sites. **§5's table gains nothing**; what changes is that the rows
   promising "shows under every tier" become true.
5. **Settings keys.** None.
6. **Log lines.** §4a.4.
7. **Telemetry.** None.
8. **Check.** `npx tsc --noEmit`, `npx vite build`, then `__toast.demo()` plus the desk test
   below.
9. **Compass.** Nothing.

### 4a.7 The desk test — **PASSED 2026-09-20**

1. `__toast.queue(4)` in the console. Three show; the fourth waits (`__toast.waiting()` lists
   it). Dismiss one — the fourth appears. **Before this build the FIRST one was destroyed
   instead**, with its buttons unrun: that is the before/after.
2. Push three stickies, then a timed one: the timed one shows and a sticky is **not** evicted
   (rule 2 only sacrifices timed toasts). Verify against today's behaviour.
3. Push three timed, then a sticky: the oldest timed yields, exactly as today.
4. Queue a sticky, then call `dismiss()` on its handle before a slot frees → it never appears.
5. Queue a sticky, `update()` it, free a slot → the **new** text shows.
6. Queue a `dismissKey` notice, silence the same key from another instance, free a slot → it
   does not appear.
7. Push the same text twenty times → **three show** (they fill the stack as any three
   stickies do), none queue behind them, and the `diag` ring shows `toast:dupe`, not
   seventeen drops. *This line said "one shows" while it was a paper design. The dedupe is a
   **queue** bound (§4a.4): making it a live-stack bound would change how every duplicate
   toast in the app behaves, which is well outside "a queue for sticky toasts". Say the word
   if you want the stricter rule.*
8. Push twenty different stickies → three show, ten queue, seven log `toast:dropped`.
9. Switch surface (mini → max) with a full stack and a queue → the queue survives (Q3), and
   the waiting toasts still appear as slots free.
10. Reduced motion on → a dequeued toast still arrives, without the slide.
11. **The line-jump.** `__toast.queue(3)` to fill the stack, then `__toast.queue(2)` (two
    offers), then `__toast.queue(1, "ask")`. `__toast.waiting()` shows the ask **first**.
    Free a slot: the ask appears before the two offers.
12. **The expiry.** Fill the stack, push one ask, wait 30 s without freeing a slot →
    `toast:dropped` `{ why: "stale" }`, and freeing a slot then shows nothing. Repeat with an
    offer → it is still waiting after a minute, and it appears when a slot frees.

### 4a.8 As built (2026-09-20)

One file, `src/toast.ts`. No schema, no token, no setting, no new Compass row, no new call
site — and **no existing call site changed**, because the priority default is derived from
what a toast already declares.

| Piece | What it does |
|---|---|
| `priority?: "ask" \| "offer"` | The one new option. Default derived from `asks`, which the module already computed for the tier gate. |
| `handle.queued` | True while it waits. `shown` stays `true` (§4a.3): it is admitted, and it will show. |
| `place()` | The old eviction loop, with one change: it evicts **only** a timed toast now. `?? kids[0]` — the line that destroyed a question — is gone. |
| The queue | Module state: `Queued[]`, cap 10, ask-before-offer insertion, `unqueue()` and `drain()`. |
| `drain(h)` | Called at the end of every `dismiss()`, the moment a slot frees. A queued notice re-reads `noticeOff` on the way out and is dropped if it was silenced while it waited. |
| `dismiss()` while queued | Leaves the queue and returns. The element is never inserted, so it never appears. |
| `update()` while queued | Rewrites the pending text through a live getter, so what finally shows is current — and the dedupe compares the current text, not the original. |
| `__toast.queue(n, priority?)` · `__toast.waiting()` | Console handles for the desk test above. |
| `toast:queued` · `toast:dequeued` · `toast:dropped` · `toast:dupe` | The diag lines. Every drop names its reason: `stale`, `dismissed`, `notice-off`, `queue-full`. |

**Decided inside his choice**, none of it a fork he saw:

1. **A timed arrival with nothing timed to evict goes one over the cap** for its few seconds,
   rather than take a sticky toast's place. §4a.7 step 2 asked for exactly this ("the timed one
   shows and a sticky is **not** evicted"), and it is the only reading where rule 2's *"a sticky
   outranks a timed toast"* survives contact with a full sticky stack.
2. **The dedupe is a queue bound, not a stack bound** — see step 7 above.
3. **The queue cap drops the incoming toast, ask or not.** Ten waiting is already past the
   point where a fourteenth teaches anything, and an ask that evicts a queued offer would be a
   second eviction rule to explain.
4. **`strip()` is now a module helper**, so a queued toast's log copy drops “quoted” names on
   the way out of the queue exactly as it does on the way in (LOGGING.md §Ids).

---

## 5. The call sites (all built 2026-09-13)

| Where | Kind | Text | Notes |
|---|---|---|---|
| `playlist-refresh.ts` — a mirror changed, one | success | *“New Music Mix” has 12 new songs.* | The day-change check, or the open (PLAYLIST-REFRESH.md §7.1). Due, refetched and nothing changed is SILENT |
| `playlist-refresh.ts` — several mirrors changed | success | *3 playlists updated.* | One toast for the check, never one per playlist |
| `playlist-refresh.ts` — a refetch failed | warn | *Couldn't re-read “New Music Mix” from Apple Music.* | The old cache and the old stamp both stay, so the next trigger tries again. Only the OPEN path says it: a background failure is a `diag` line, not a notice |
| `playlist-refresh.ts` — an exported local playlist has new songs | info, **sticky**, `[Get them]` | *“Road Trip” has 3 new songs on Apple Music.* / *“Road Trip” (3) and “Gym” (1) have new songs…* / *4 playlists have new songs on Apple Music.* | The offer (D9). A question, so it shows under every tier and WAITS in the queue (§4a) rather than being destroyed. Dismiss writes nothing and moves no stamp, so the next check offers again |
| `playlist-refresh.ts` — the offer was taken | success / warn | *Added 3 songs.* / *Couldn't add the songs to one playlist.* | The write is local and needs no second Apple read (§5.1) |
| `start-station.ts` — seed with no station | warn | Apple Music has no station for this song / artist. | The motivating case (2026-07-03). Artist tiles: "Couldn't find *Name* on Apple Music." when the artist id doesn't resolve. A throw in the seed or artist lookup: "Couldn't start the station." A failed play is `playStation`'s toast (next row), so it never shows twice. |
| `player.ts` `playStation` — any station play fails | warn | Couldn't start *Station name*. | Radio, Search, Start Station, the agent, and the launch-time station resume. |
| `copy-link.ts` — clipboard | success / warn | Link copied. / Couldn't copy the link. | Success is `all`-tier: the clipboard shows nothing otherwise. A library album with no catalog page: "This album has no Apple Music page to link." A Library artist whose id does not resolve: "This artist has no Apple Music page to link." (2026-09-23) |
| `web.ts` `startWebItem` — the right-click **Start a Web** (2026-09-23) | info, sticky, then dismissed / warn | *Starting a web…* → *Reading the web of Name…* → *Making the playlist…* / *Apple Music has nothing to start a web from here.* · *The web had no songs to pick.* · *Couldn't make the web.* | [CONTEXT-MENUS.md](CONTEXT-MENUS.md) §4. The progress line is `all`-tier: under a quieter tier the flight to the Playlists card is the only sign. It is dismissed when the playlist opens or the build fails |
| `compass.ts` `mathRow` — the calculator copies (2026-09-18) | success / warn | Copied *2*. / Couldn't copy the answer. | [COMPASS.md](../features/COMPASS.md) §2d. Enter on the Answer row. Success is `all`-tier, like Copy Link: the clipboard shows nothing otherwise. The toast names the grouped answer; the clipboard gets the plain digits. |
| `sotd.ts` `mark` — no outlet on, or At a set time (2026-09-18) | success | Today's Song of the Day: *"Song"*. **[Undo]** / Posts at *8:00 PM*. **[Undo]** | [DeetsOTD.md](../integrations/DeetsOTD.md) §8.5. Undo unmarks and deletes whatever went out. *Right away* and *Ask each time* say nothing here — their own toasts follow. |
| `sotd.ts` `sotd-ask` event — Ask each time (2026-09-18) | info, sticky | Post *"Song"* to Discord? **[Post] [Not now]** | Rust raises it, so a mark from an agent asks in the window exactly as a right-click does. Not now marks the post `skipped`; the tile then offers Post Now. Asked again at the next start while it is still that day. |
| `sotd.ts` `sotd-posted` event (2026-09-18) | success / warn | Posted *"Song"* to Discord. **[Undo]** / Discord did not take the post: *the webhook no longer exists*. | The real outcome, after the send — never a claim made at mark time. The warn carries Discord's own reason; it never carries the webhook link. |
| `sotd.ts` `withdrawAsking` (2026-09-18) | info, sticky | Take the Discord post for *"Song"* down? Your pick stays. **[Withdraw] [Keep]** | [DeetsOTD.md](../integrations/DeetsOTD.md) §10.6. Asks because a delete cannot be undone: the same message can never be reposted. On success, a `success` toast — "Withdrawn from Discord. The pick is still yours." — and a `warn` if the outlet refused. |
| `sotd.ts` `unmarkAsking` · a replaced pick (2026-09-18) | info, sticky | Also delete the Discord post? **[Delete] [Keep]** / Also delete the posts of the pick you replaced? **[Delete] [Keep]** | 9d: Delete is the first button. Only shown when a post really went out. |
| `sotd.ts` `initSotd` — a set time missed while the app was closed (2026-09-18) | info, sticky | Post *"Song"* now? It will count for today, not *Tue, Sep 16*. **[Post] [Skip]** | §8.5. The day rule is why it must ask: Discord dates a post by when it arrives. |
| `sotd.ts` `mark` — the song is already today's (2026-09-18) | info | That is already today's Song of the Day. | Marking it twice is not a second pick. |
| `agent-writes.ts` `picks` — an agent's first mark (2026-09-18) | info, sticky | Let an agent mark *"Song"* as today's Song of the Day? It will ask no more after this. **[Allow] [Not now]** | G2. `deets.notice.sotdAgentMark`. Later agent marks show the quiet `all`-tier line "An agent marked *"Song"* as today's Song of the Day." |
| `library-add.ts` — the write | warn | Couldn't add the song/album to your library. | Every add path (menus, the NP square, the Search row square, the tray "+" via `addTrackToLibrary`). |
| `library-add.ts` — first add ever | once-notice `info` | Added. DeetsMusic can't remove it; use the Music app. Turn this off in Settings › Apple Music. **[Settings] [Got it]** | `deets.notice.addOneWay` (`onceKey`; a key already silenced stays silenced). [Settings] opens the Add to Library and ♥ row. Later adds: a `success` "Added to your library." (`all`). Revised 2026-09-14: was once per session until Don't show again. |
| `player.ts` `noteDeadSongs` — ids first found dead | warn, 6 s | Skipped "Title" — Apple Music no longer offers it. / Skipped N songs …: "A", "B" and N more. | Trigger: `dead_ids_mark`'s `fresh`. Names collect for 1 s (a feed rejection, its retry and `healDeadNext` can each mark within a second) and raise once. Names **songs, not ids**, and only handles with no play target left (`playId` undefined) — a dead catalog id whose library id still plays is not skipped, so it is not named. Known-dead ids skip silently. |
| `player.ts` `onPlaybackError` — the first non-dead-song playback error after a sign-in, before any audio has played | warn, 8 s | Playback failed after sign-in. DeetsMusic needs an Apple Music subscription on this Apple ID. | `noteSignedIn()` from `main.ts` arms it once. MusicKit reports a missing subscription only as a playback error, never at sign-in — this is the one moment the cause is likely. **Unverified against a real no-subscription account**; the log's `player:playbackError` msg will say what MusicKit actually sent. |
| `main.ts` — boot | error (sticky) | Can't reach the token service. Check your connection and restart DeetsMusic. | `apple_developer_token` rejects when `ensure_developer_token()` failed at setup (offline first run, or the mint's `KILL` — RELEASE.md §7). Zero-cost: it reads the static. |
| `main.ts` — Account sign-in (`signInFailed`) | error / warn, each with **Try again** | Sign-in didn't finish in time. / Apple Music didn't accept the sign-in. Try again in a few minutes. / Another sign-in page is still open. Close it, then try again. / Sign-in didn't finish. Try again. · sign-out: Couldn't sign out. Try again. | Revised 2026-09-13. `connect()` now polls `apple_auth_status`, so a failure the browser page reports (Apple's "Unauthorized", a closed Apple window) arrives at once as a `SignInError` code instead of after the 5-min timeout. `unavailable` / `offline` (the pre-check in `apple_begin_auth`) hand over to Apple health below. The raw reason stays in the console and the log; the row shows "Sign-in didn't finish". Revised again that evening (hosted page, DATA-ARCHITECTURE §2a): the timeout toast adds **Use local sign-in** (a link that never comes back — not followed, or a scheme that is not really registered, DATA-ARCHITECTURE §2a "RESOLVED" — ends in a timeout); the user's own cancel (a second click on the Account button) shows NO toast; the local page's own close arrives as `page closed` → the "didn't finish" toast. |
| `main.ts` — Account sign-in succeeds | success | Sign-in complete! Enjoy! | Added 2026-09-13 on the user's request. `all` tier (the user's choice): the user is usually still in the browser, but the Account row shows Connected, so the `failures` tier stays quiet per §6 (the default is `all` since 2026-09-13, so it shows by default). Only the newest sign-in toasts (`signInSeq`). |
| `lastfm.ts` — Last.fm connect succeeds | success | Last.fm connected. Songs you hear now go to *name*. | 2026-09-16, [LASTFM.md](../integrations/LASTFM.md) §4. `all` tier, like the Apple sign-in toast. Only the newest connect toasts (`seq`). |
| `lastfm.ts` — Last.fm connect fails | error / warn, each with **Try again** | Last.fm connect didn't finish in time. / Can't reach Last.fm. Check your connection, then try again. / Last.fm connect didn't finish. Try again. · disconnect: Couldn't disconnect Last.fm. Try again. | 2026-09-16. Timeout (5 min, no Allow) / offline at `auth.getToken` / any other reason (an expired token, a refused call). The user's own cancel (a second click) shows no toast. |
| `sound.ts` — the review is due (SOUND.md §7) | info, **Keep** / **Turn off** | You have used Sound effects for a while. Keep them? | 2026-09-16. Once (`onceKey` per first-on time), `soundReviewDays` after an effect was first turned on; Keep sets `soundReviewed`, Turn off sets the equalizer and adaptive sound off. The panel shows the same question until answered. |
| `sound.ts` — the audio context will not resume | error, sticky | Sound effects stopped the audio. Restart DeetsMusic to hear music again. | 2026-09-16. Once per session. A routed element is heard only through the graph, so this is silence, said plainly (`sound:resumeFailed` in the log). |
| `lastfm.ts` — Last.fm refuses the saved session (error 9) | warn, sticky, **Connect** | Last.fm stopped accepting DeetsMusic. Connect again to send your plays. They wait until then. | 2026-09-16, LASTFM.md §5. Once per session (`lastfm-reconnect` from Rust). The scrobbles stay queued; a new connect sends them. |
| `apple-health.ts` — **Apple health** (one toast per cause, sticky) | error | Apple Music isn't responding to DeetsMusic right now. Your account is fine. DeetsMusic keeps trying. **[Try now]** | The developer token is refused even after the bounded heal (`apple_check` app=`rejected`/`missing`). Not the user's to fix, so the copy says so. Rechecks every 5 min while it lasts; on recovery the toast goes and "Apple Music is working again." shows (`all` tier). Account row: "Connected · Apple Music isn't responding". |
| `apple-health.ts` | warn | DeetsMusic can't reach Apple Music. Check your internet connection. **[Try again]** | app=`unreachable`. Same 5-min recheck. Row: "Connected · Offline". **Resume (2026-09-14):** when a playback error found this cause (a network drop kills MusicKit's audio player with `loadSegmentError`), the song and last heard position are held; the next check that finds Apple healthy reloads that song and seeks back — once, queue mode only, skipped if anything played or the song changed (`player:resumeArmed` / `resumeAfterReconnect` / `resumeSkip` in the log). |
| `apple-health.ts` | error | Apple Music signed you out. Sign in again to keep listening. **[Sign in]** | The Music User Token is refused (`/v1/me/storefront` 401/403). The Account row reads signed out ("Sign-in expired") and its button signs in. **Sign in** starts the browser sign-in directly (`deets:sign-in`). |
| `player.ts` `requireSignIn` → `apple-health.ts` | warn | Sign in to Apple Music to play songs. **[Sign in]** | Any play with no sign-in (a list click, Up Next jump, a station, the play button) — before MusicKit is touched, so its "Unable to prepare for playback." dialog never appears. No Apple call. |
| `player.ts` `onMusicKitTrouble` | warn | Playback stopped. Try the song again. | MusicKit's own dialog (`index.html` now routes EVERY non-benign `alert()` to player.ts, never a native dialog) or a non-dead playback error, when the health check finds no cause. One recovery per 30 s however many dialogs arrive. **MusicKit's in-page error box** (`#musickit-dialog`, `MKDialog.presentError` on every playback error — it showed "loadSegmentError" on a network drop, 2026-09-13) is off since 2026-09-14: `suppressErrorDialog: true` in both `MusicKit.configure` calls. |
| `main.ts` — boot, remote notice | notice `info` | The Worker's `CONFIG.deetsmusic.notice` text **[Open]** | Rides `/token` (refreshes with the token, about weekly). `dismissKey` is `deets.notice.remote.<hash of the text>`, so a new text shows even after "Don't show again" on an old one. **Open** only when `CONFIG.deetsmusic.noticeUrl` is an https link (2026-09-14) — the lost-updater-key runbook (RELEASE.md §6.6). |
| `main.ts` — the database stopped saving | notice `error` | DeetsMusic can't save right now. Plays, playlists and settings won't be kept until this is fixed. Check the disk has free space, then restart the app. | 2026-09-17, DB-HEALTH.md §4. Rust sends `db-unwritable` once a session, on the first failed write of any kind (a `watch` site, or the 10-minute canary). `dismissKey` `dbUnwritable`. Silence was the worst outcome: the app looks fine and remembers nothing. |
| `updater.ts` — Ask mode, a newer version | sticky info **question** | DeetsMusic X is available. **[Download] [Later] [Skip this version]** | RELEASE.md §6.3. One offer on screen at a time. Later = until the next launch; Skip = `updateSkip` until a newer version. |
| `updater.ts` — an update or rollback is downloaded | sticky info **question** | DeetsMusic X is ready. Restart to update. / …Restart to roll back. / This version of DeetsMusic is no longer supported. Restart to update to X. **[Restart now] [Later] [Skip this version]** | Automatic mode lands here directly. No Skip for a rollback or a required version (under `minVersion`). "Later" counts as the close, so no Dismiss (toast.ts). |
| `updater.ts` — download or install fails | warn | Couldn't download the update. DeetsMusic will try again later. / Couldn't download that version. Try again later. / Couldn't get DeetsMusic X. Try again later. / Couldn't start the installer. Try again. / A dev build doesn't install updates. | A failed scheduled **check** has no toast: the log and the Settings › Updates status line carry it. |

**Recovery bounds (2026-09-13).** Failures arrive without bound, so every layer caps itself:
Rust `refetch_after_401` fetches from the mint at most once per 10 min and never when the
rejected token is no longer the live one; `apple_check` answers from a 60 s cache (forced checks
≥ 10 s apart); `recoverFromFailure` coalesces concurrent failures into one check and allows one
retry per 30 s; `onMusicKitTrouble` starts one recovery per 30 s. A play click that fails runs
the check, re-configures MusicKit if the token was swapped (`syncDeveloperToken`, once per new
token), and retries once; a named cause suppresses "Couldn't play".

**Sign-in routes closed the same day.** A `/v1/me` 403 in Rust emits `apple-signin-rejected`
(once a minute) → `apple-health` runs the cached check → "Apple Music signed you out", and the
library sync's own toast stays quiet whenever the check names a cause. A token the sign-in page
delivers is checked before it is saved (403 twice → "Apple Music didn't accept the sign-in";
the page clears its storage first, so a retry really signs in). The authorization restore
re-injects only when the check says the sign-in works. Sign-out clears MusicKit's in-memory
token without MusicKit's logout call.
| `diary-card.ts` `changeScale` — the scale changed on an entry with scores, Rescale scores = Ask (2026-09-24) | info, sticky **question** | *“OPIA” is now out of 5. Rescale its 6 scores too? 7/10 becomes 3.5/5.* **[Rescale] [Keep numbers]** | His call 7B: a typed number never changes without telling you. The scale has already changed when it shows, so Keep numbers (or Dismiss) leaves it as is. DIARY.md §5 |
| `diary-card.ts` `askDelete` — Delete entry (2026-09-24) | warn, sticky **question** | *Delete your Diary entry for “OPIA”? Its notes and scores go with it.* **[Delete] [Keep]** | No Undo, so it asks first. DIARY.md §6 |
| `diary.ts` `copyDiaryExport` — Export (a tile, the hero, Ctrl+Enter on a Compass Diary row), and every finish (the check, Mark as done, a drag into Completed: the `onDiaryDone` listener, DIARY.md §7) (2026-09-24) | success / warn | *Diary entry copied.* / *Couldn't copy the Diary entry.* | success shows under the Everything tier, like *Link copied.*: the clipboard shows nothing else. DIARY.md §10 |
| `diary-card.ts` — a Diary write or open fails | warn | *Couldn't save that to your Diary.* / *Couldn't open “Title” in your Diary.* / *A scale's top is a number above 0.* / *Couldn't make the folder.* | The last is the scale menu's own field refusing its text |
| `search-card.ts` — a click on an unreleased row · `player.ts` `playTracks` — a play whose songs are all unreleased (2026-09-24) | warn | *“Title” is not out yet. Coming 09/25.* / *These songs are not out yet. Coming 09/25.* (past the date: *…is not on Apple Music yet.*) | His call 2B. warn, because the click did nothing and this is why (§2). The row click never reaches the player; the player's line covers the agent and every other card. SEARCH.md §Unreleased songs |
| `player.ts` `playTracks` — a play click fails | warn | Couldn't play “Title”. / Apple Music no longer offers “Title”. (or "these songs") | Every card and the agent go through it; the callers only log. Raised 1.4 s after the failure, and skipped when the dead-song toast has named the same song (desk-forced 2026-09-13: a dead id used to show both). The second text is for a play whose songs are all **already known dead**: `playContext` now refuses it before the model changes (`nothing to play: …`, a 400 for the agent). Before, it returned quietly, left the dead song as Now, and reported success. |
| `player.ts` `queueTracksNext` / `Later` | warn | Couldn't add to the queue. | |
| `favorites.ts` `setLoved` — the Apple write fails | warn | Couldn't update Favorites for “Title”. | The ♥ has already flipped back; the toast says why. |
| `track-store.ts` — a sync `error` event | warn, 6 s | Library sync stopped at N of M songs. Try Refresh in Library. / Couldn't sync your library. Check your connection. | One listener for every sync (startup and the Library ⟳). The spinner alone just stops. |
| `playlists.ts` Add to Playlist ▸ | warn | Couldn't add to the playlist. / Couldn't create the playlist. | The shared menu entry, including its "New Playlist…" field. |
| `web.ts` Make playlist | warn | Couldn't make the web playlist. | The create or the add failed. A failed build or search says so in the panel's status line, not a toast. |
| `playlist-expiry.ts` check (2026-09-17) | info | Deleted the expired web playlist “X Web”. / Deleted N expired web playlists. **[Undo]** | PLAYLIST-WEB.md §10.6: one toast per check for every temporary web playlist past its date. The user may not see it (the user's call). |
| `playlist-expiry.ts` Undo | warn | Couldn't bring back one web playlist. / Couldn't bring back N web playlists. | `playlist_restore` failed. |
| `playlists-card.ts` Keep Playlist | warn | Couldn't keep “X”. | `playlist_keep` failed; the date stays. |
| `wallpaper.ts` `setWallpaperFromFile` — Glass › Canvas › Picture: Choose, or a file dropped on the row (2026-09-24) | warn | “file” is not an image DeetsMusic can read. / Couldn't save the picture. | The playlist cover's words for the same failure. A good choice shows no toast: the canvas changes. COVER-WALLPAPER.md §8 |
| `playlists-card.ts` — cover, create, edit | warn | “file” is not an image DeetsMusic can read. / Couldn't save the cover. / Couldn't create the playlist. / Couldn't create the folder. / Couldn't rename “X”. / Couldn't move the song in “X”. / Couldn't delete “X”. | The file picker and a file dropped on the hero cover share the path. A failed move puts the stored order back. |
| `playlists-card.ts` — Delete Playlist with songs | sticky error **question** | Delete “X” and its N songs? This can't be undone. (+ Its copy on Apple Music stays and will show in your list.) **[Delete] [Cancel]** | PLAYLISTS.md §10.3. An empty playlist is deleted with no question. The second sentence only when the playlist has a live Apple copy. |
| `playlists-card.ts` — Delete N playlists (the picked set) | sticky error **question** | Delete N playlists and their M songs? This can't be undone. (+ N copies on Apple Music stay and will show in your list.) (+ N playlists you picked are on Apple Music, and stay.  — is/stays in the singular) **[Delete All] [Cancel]** | PLAYLISTS.md §10.3 bulk delete. Always asks, even for empty playlists. Added 2026-09-17. |
| `playlists-card.ts` — Delete N playlists, the result | success / warn | Deleted N playlists. / Couldn't delete N playlists. | One toast for the whole run. The warn names only the ones that failed; the rest are deleted. Added 2026-09-17. |
| `sleep.ts` — the sleep timer (NEXT-VERSION §17) | info | Sleep in 1 minute. **[+15 min]** / Sleep timer off. **[Undo]** | The first once per arm, only while music plays; +15 min sets a fresh 15-minute countdown. The second when a hand on the volume (the pill, the stage row, the tray, the agent) lands during the wind-down; Undo re-arms the same mark or chip. Added 2026-09-15. |
| `playlist-export.ts` — Export to Apple Music / Make a New Copy | once-notice `info` → `success` / warn | Made “X” on Apple Music. DeetsMusic can't rename, reorder, or delete it there; use the Music app. Turn this off in Settings › Apple Music. **[Settings] [Got it]** / Made a new “X” on Apple Music. The old copy is still there. / Couldn't export “X” to Apple Music. | `deets.notice.exportOneWay` (`onceKey`) the first time; [Settings] opens the Export playlists row. Skipped uploads are named (" 2 songs skipped: “A” and “B” aren't in the Apple Music catalog.", §10.5) and, like a partial append failure, turn it into a `warn`. PLAYLISTS.md §6. |
| `playlist-export.ts` — Send New Songs | success / sticky warn **question** | Added N songs to “X” on Apple Music. / The Apple copy of “X” is up to date. / Apple Music can't copy every change to “X”. DeetsMusic can add N songs (…) at the end, but it can't remove “A” and “B” or change the order. **[Add N songs] [Make a New Copy]** / The Apple copy of “X” is gone. **[Make a New Copy]** | Was "Add New Songs to Apple Copy". The question comes BEFORE any write and shows under every tier (§4). |
| `playlist-export.ts` — Get New Songs | success / warn | Added N songs from Apple Music to “X”. / “X” already has every song from its Apple copy. / Couldn't read the Apple copy of “X”. / The Apple copy of “X” is gone. **[Make a New Copy]** | PLAYLISTS.md §10.4. No question: nothing local is lost. |
| `playlists.ts` — Add to Playlist ▸ an Apple playlist | sticky info **question** (first add only) / success / warn | Add to “X” on Apple Music? DeetsMusic can't remove songs from it afterwards. **[Add] [Cancel]** / Added N songs to “X” on Apple Music. / …Couldn't add N songs. / (the named-skips line) / Couldn't add to “X” on Apple Music. | PLAYLISTS.md §10.9. [Add] writes `off` to `deets.notice.appleAdd`; after that the add goes at once. |
| `playlists-card.ts` — Import to Edit | success / warn | Imported “X”. You can edit it here. Apple Music ▸ Send New Songs adds its new songs to the original. / Imported “X” as a copy you can edit. The copy doesn't change when Apple Music changes the original. / Couldn't import “X”. | PLAYLISTS.md §10.9. The Send New Songs sentence shows only while Export playlists is on. |
| `drop-actions.ts` — a drop on the Queue card | success / warn | Added “Song” to Up Next. / Added N songs to Up Next. / Couldn't add to the queue. | DRAG-DROP.md §3. No success when nothing was playing (the songs start). The warn covers a failed Search fetch; `queueTracksAt` raises its own. |
| `drop-actions.ts` — a drop on a local playlist | success / warn | Added “Song” to “X”. / Added N songs to “X”. / Couldn't add to the playlist. | A drop on an editable Apple playlist rides the Add to Playlist ▸ Apple row above (its question, its texts). |
| `drop-actions.ts` — a drop on the Library card | info | Those songs are already in your library. | Only when nothing was left to add. The add itself uses the `library-add.ts` rows above. |
| `drop-actions.ts` — a drop on Now Playing | — | (none) | The song starting is the feedback; a failed play is `playTracks`'s toast. |
| `replay.ts` — the weekly make | success | Replay updated: N songs from this week. | `all` tier. |
| `settings-card.ts` — Settings › Bugs › Send | sticky success **with an action** | Bug sent. Copy the link to find it again. / Suggestion sent. Copy the link to find it again. **[Copy link] [Dismiss]** | Added 2026-09-15 (LOGGING.md §The report form). Sticky with its own action, so it shows under every tier and never times out: the link is the only way back to the post. **The link is never in the text** — toast text reaches the diag ring and the log, and the code is a credential. [Copy link] uses `copy-link.ts` ("Link copied."). The report also appears under My reports. |
| `settings-card.ts` — Reset › **Row order** | info (sticky) → success (6 s) | Put every row and section back in its built-in order? [Confirm] [Cancel] → Row order reset to the built-in order. [Undo] | Added 2026-09-20 ([MOVABLE-ROWS.md](../features/MOVABLE-ROWS.md) §13.5). Not a settings key, so it does not ride `RESET_GROUPS`: Confirm clears the `row_order` table, Undo writes the whole snapshot back. Offered only when there IS an order; with none, the button flashes *Default*. **A move itself has no toast** — the screen already shows the result. |
| `settings-card.ts` — Reset › any row | info (sticky) → success (6 s) | Reset {group} to the defaults? [Confirm] [Cancel] → {group} reset to the defaults. [Undo] | Added 2026-09-15. Confirm takes the snapshot, then writes `DEFAULTS` (and the first-launch theme and skin); Undo writes the snapshot back. The Undo toast shows under every tier (§4). |
| `settings-card.ts` — My reports › Refresh / Close | warn | Couldn't reach the support server. Check the connection and try again. / Too many requests in a short time. Wait a minute and try again. / Reports are switched off for now. Try again later. / The support server didn't close the report. Try again later. | Added 2026-09-15. The text is `report.rs`'s error. Refresh warns only when no report could be checked; a partial failure keeps the last known tags. |
| `room.ts` — a room command the host keeps | info | The host keeps that control in this room. | Added 2026-09-17 (ROOMS.md §8). The worker answers `denied`; the app greys the control too, so this is the rare race. |
| `room.ts` — Play while the host keeps Play/pause | info | The host starts the music in this room. | Added 2026-09-17 (ROOMS.md §12.3). Pause is never refused: it stops this app instead. |
| `room.ts` — removed by the host | info | The host removed you from the room. | Added 2026-09-17 (ROOMS.md §7). |
| `room.ts` — the room ended | info | The room ended. | Added 2026-09-17. Both reasons (the host left, the host ended it) read the same: the member does not care which. |
| `room.ts` — an app below `minV` | warn (sticky) | Update DeetsMusic to join this room. | Added 2026-09-17 (ROOMS.md §5.1). Sticky: it is the whole answer to "why can't I join?". |
| `room.ts` — the room is full | warn | That room is full. | Added 2026-09-17 (32 members, ROOMS.md §11). |
| `room.ts` — a bad code typed | warn | That is not a room code. A code is 8 letters and numbers. | Added 2026-09-17 (ROOMS.md §6). |
| `room.ts` — start / join failed | warn | Couldn't start a room. {why} / Couldn't join that room. {why} | Added 2026-09-17. `{why}` is the server's own words — the address may simply not be deployed yet. **Narrowed 2026-09-20:** a server STATUS no longer reaches this line; it goes to `busy.ts` below, so "answered 429" is not shown to anyone. |
| `busy.ts` — a social service is busy | warn | {Friends\|DeetsRooms} is busy right now — it will come back on its own. Your music is not affected. | Added 2026-09-20 (FRIENDS.md §5.2). **At most once per service per 10 minutes**, never in the first 20 s after launch, and never within 3 s of a song starting. Never per retry: the reconnect has its own backoff. |
| `busy.ts` — the kill switch | warn | {Friends\|DeetsRooms} is switched off right now. Your music is not affected. | Added 2026-09-20. A 429 is temporary and a 503 is not, so this one does not promise it comes back. |
| `friends.ts` — asking to listen along | info | Asking to listen along… | Added 2026-09-20 (FRIENDS.md §16.2). |
| `friends.ts` — somebody is listening along | info | {Name} is listening along. | Added 2026-09-20. The host is TOLD, never asked — the setting already answered (FRIENDS.md §16.2). |
| `friends.ts` — they are not offering it | info | {Name} is not letting people listen along right now. / {Name} is in somebody else's room, so there is nothing to join yet. | Added 2026-09-20. Two reasons, because "nothing happened" is not an answer. |
| `friends.ts` — a friend invites you by name | info **(sticky, with actions)** | {Name} asked you to listen along. **[Join] [Not now]** | Added 2026-09-20 (FRIENDS.md §7, item 1). An INVITE was not asked for, so it asks — the rule the `deetsmusic://room?code=…` link follows. |
| `friends.ts` — they are offline | info | They are not online right now. | Added 2026-09-20. |
| `friends.ts` — added / removed a friend | info | {Name} will appear here once they add you back. / {Name} is off your list. **[Undo]** | Added 2026-09-20 (FRIENDS.md §3, mutual add). The Undo is timed, so it never queues (§4a). |
| `friends.ts` — an app below `minV` | warn (sticky) | Update DeetsMusic to use Friends. | Added 2026-09-20. |
| `friends-panel.ts` — Copy my key | warn (sticky) | Your key is copied. It IS you — anybody who has it can be you to your friends. Paste it only into DeetsMusic on your own PC. **[Got it]** | Added 2026-09-20 (FRIENDS.md §2a). Sticky and `warn`: it is a credential leaving the app. |
| `friends-panel.ts` — Paste a key | warn **(sticky, with actions)** | Use the key on the clipboard? This PC stops being its current friend code, and friends who added the old one will not see you. **[Use it] [Cancel]** | Added 2026-09-20. A question, so it jumps the sticky queue (§4a). |
| `room.ts` — library-only songs dropped | info | Those songs are only in your library, so the room cannot play them. / N of those songs are only in your library, so the room left them out. | Added 2026-09-17 (ROOMS.md §5.3). |
| `room.ts` — a station in a room | info **with an action** | A station cannot play in a room. Leave the room first. **[Leave room]** | Added 2026-09-17 (ROOMS.md §10). |
| `room-panel.ts` — Copy code / Copy invite link | info | Room code copied. / Invite link copied. / Couldn't copy that. | Added 2026-09-17. |
| `main.ts` — an invite link arrived | info (sticky) **with actions** | Join listening room K7QM-4XHT? **[Join] [Not now]** | Added 2026-09-17 (ROOMS.md §1). Any page can open a `deetsmusic://` link, so nothing joins on its own. |
| `main.ts` — an invite while already in a room | info | Leave the room you are in before you join another. | Added 2026-09-17. |
| `stats.ts` — Rewind unlock at 50 starts | info | Rewind unlocked: your listening, ranked. Pick it from any slot's title. | `all` tier (the card also just appears in the pickers, as before). |

**Investigated, not built — a library playlist Apple no longer has** (FUTURE-SETTINGS §18
candidate 3). The mirror sync `DELETE`s and re-inserts `apple_playlists` from Apple's own
list, so a playlist Apple has dropped never survives a sync; and the count backfill already
persists a tracks-endpoint 404 as `track_count = 0` (Apple's empty-playlist quirk,
`provider.rs`), so it never re-asks. The 404 that repeats per launch is an *empty* playlist
being opened, not a gone one. Nothing to toast; if a real "gone" case shows up in the log,
it needs one extra `GET /v1/me/library/playlists/{id}` to tell the two apart first.

**Still waiting on its own feature:** the AirPlay firewall preface (AIRPLAY.md §9 item 5).
The planned playlist-cover notice (`deets.notice.coverLocal`) is dropped (2026-09-14): a
custom cover never reaches Apple, and PLAYLISTS.md §6 says so. Add it to the export notice
text if desk testing shows users expect the cover on the Apple copy.

**The mint's remote config (built).** Rust keeps the config from the token response
(`remote_config()`, `apple_remote_config`). `main.ts` shows its `notice` (row above, with
`noticeUrl` as an Open button), and `updater.ts` reads `minVersion` to make an update required
(the updater rows above, 2026-09-14).

## 6. Rules for new call sites

- Keep the console/diag line. The toast is the user's copy; the log is ours.
- A failure the user can do nothing about is a `warn`. Reserve `error` for "act or know".
- Silent success stays the doctrine (FAVORITES.md); a `success` toast is for actions with
  **no other visible result** (a clipboard write) and rides the `all` tier.
- Name things, never ids. Resolve through `trackById` / the playlist name before calling.
- **Put every name in curly quotes** (`“${p.name}”`). `toast.ts` logs the text with each
  quoted span replaced by `“…”`, because a bug report sends the log (LOGGING.md §The report
  form, privacy pass). An unquoted name reaches the log. Never put a link or a code in the text.
- Main window only. The tray panel and the extension popup keep the console.
- No copy in `toast.ts`. If a string will be reused, it lives with its caller.
- Write the text so an agent can act on it too. Every `warn` / `error` raised during an
  agent request goes back in its reply as `notices`, under any tier (`onToast` observer,
  `np-bus.ts`; AGENT.md §3). Say what failed and name the song.

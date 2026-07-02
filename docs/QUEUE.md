# DeetsMusic — Queue model & playback windowing

> How a click becomes playback, and why the queue model is shaped the way it is.
> Code: [`src/queue.ts`](../src/queue.ts) (the model) + [`src/player.ts`](../src/player.ts)
> (MusicKit feeding). Read this before touching either — the interplay is subtle and has
> bitten us. Diagnostics: [DEBUGGING.md](DEBUGGING.md) (`__diag`, `__player.snap()`).

---

## The two layers

**The queue model is the source of truth** for what plays; it's decoupled from MusicKit.
The player feeds MusicKit only a *bounded window* of the model, for cheap `setQueue` and
native gapless playback, then mirrors MusicKit's live position back onto the model
("model-follow").

```
            queue model (full plan, lightweight id handles)
   history[]            →   current   →   upcoming[]
   (heard + lookback)       (now)         (the plan)
                     │
                     │  player.ts feeds a window:
                     ▼
   [ …WINDOW_BACK behind │ current │ WINDOW_FWD ahead… ]  → MusicKit.setQueue
```

Entries are lightweight `TrackHandle`s (`catalogId`/`libraryId` + `origin` + `played`),
never full `Track`s — a queue over a 10k-song library stays a few hundred KB of strings.
Metadata for display/playback is resolved through the shared track store.

---

## `history` holds two different things

This is the crux of the whole design. `history[]` mixes two kinds of entry, and they
must be treated differently:

| | flag | lifetime | purpose |
|---|---|---|---|
| **Heard trail** | `played: true` | **durable** — survives across contexts (capped at `HISTORY_CAP`) | what you actually listened to; powers Previous + recently-played across album/library/playlist hops |
| **Parked lookback** | `played: false` | **ephemeral** — belongs to the current context, rebuilt on each new play | the songs *before* the one you clicked, so Previous can walk back into them even though you jumped into the middle of a list |

`getRecentlyPlayed()` filters on `played`, so the lookback stays hidden until you actually
hear it. An entry "graduates" from lookback → heard automatically: `setCurrent()` flips
`played: true` the moment it becomes current.

### Layout after `setContext`

```
history = [ lookback…(played:false) , heard…(played:true) ]   current   upcoming = [ manual… , auto-tail… ]
```

So **Previous pops the most recently *heard* song first**, then descends into the
lookback. `upcoming` keeps the user's `manual` play-next picks stacked on top of the
fresh auto-tail.

---

## `setContext` — the rule that keeps it correct

When you click a song, `setContext(handles, startIndex)`:

1. **Keep** `manual` play-next picks from the old `upcoming`.
2. Build the **heard trail**: prior `played` entries + the song that was playing (it
   counts as heard) — **minus** any copy of the song you're about to play.
3. **Rebuild** (never append) the **lookback** from `handles[0..startIndex-1]`, skipping
   any id already in the heard trail or the clicked song itself.
4. `history = [lookback…, heard…]`, capped; set `current`; `upcoming = manual + autoTail`.

The load-bearing word is **rebuild**. The lookback is replaced every call, so it can't
accumulate. The heard trail is the only thing that grows, and it's bounded + deduped.

### Worked example

Library sorted A–Z: `AAAHH MEN!`(0) · `Aasa Kooda`(1) · `Abq`(2) · `Acapella`(3) ·
`Add Up My Love`(4) · `Adderall`(5).

- **Click `Abq` (idx 2):** lookback `[AAAHH MEN!, Aasa Kooda]`, current `Abq`,
  upcoming `[Acapella, Add Up My Love, Adderall, …]`. Window `pos = 2`. ✅
- **Then click `Adderall` (idx 5):** heard trail `[Abq]` (it played); lookback rebuilt
  as idx 0–4 minus the heard `Abq` → `[AAAHH MEN!, Aasa Kooda, Acapella, Add Up My Love]`.
  `history = [AAAHH MEN!, Aasa Kooda, Acapella, Add Up My Love, Abq]` — **no duplicates** —
  current `Adderall`. Previous walks `Abq` → `Add Up My Love` → `Acapella` → … ✅

Starting a brand-new context **drops the previous context's unheard lookback** (it was
never heard, so it's disposable). Anything you *did* hear stays in the trail.

---

## Windowing — `loadFromModel`

`WINDOW_BACK = 50` behind + `current` + `WINDOW_FWD = 200` ahead are fed to MusicKit.
The full plan stays in the model; the window gives native gapless + Previous-into-backlog
around the click. Jumps/seeks that land *outside* the live window force a fresh `setQueue`
and **buffer** (the documented latency; `isLoading`/`PlayerState.loading` is the cover-up
hook — see [UX-COVERUPS.md](UX-COVERUPS.md)).

**The window is deduped (belt-and-suspenders).** MusicKit's `setQueue` collapses repeated
song ids, which makes its real queue shorter than ours and desyncs the index
`changeToMediaAtIndex` jumps to — landing on the wrong song. `loadFromModel` builds a
duplicate-free id list (first id wins) and inserts `current` first-class so its index
`pos` is always exact. `setContext` already avoids most dupes; this catches the remaining
case where a *heard* song reappears later in the forward context.

Sequence (order matters — learned the hard way, see gotchas):
**pause → `setQueue` → `changeToMediaAtIndex(pos)` → `play()`**. `changeToMediaAtIndex`
already starts playback, so `play()` is guarded by `!isPlaying` (only really needed on the
`pos === 0` path); calling `play()` while playing throws *"play() without a previous
stop()/pause()"*.

**`pos === 0` skips `changeToMediaAtIndex` — deliberately.** `setQueue` already leaves the
queue at index 0, and calling `changeToMediaAtIndex(0)` anyway makes MusicKit race *itself*:
its internal event handler fires a second `play()` on top of the in-flight one → an uncaught
*"play() without a previous stop()/pause()"* rejection in the console (observed 2026-07-02,
queueing an album from idle). Plain `play()` is sufficient at 0. (This guard was briefly
removed chasing a "fresh context at the top doesn't start" symptom whose real cause was the
dead-id NOT_FOUND rejection below — don't remove it again.)

---

## Idempotent re-click

Clicking the song that's **already current** does **not** rebuild the queue. `playContext`
detects `playId(target) === playId(current)` and just `seekToTime(0)` (+ `play()` if
paused) — what people expect from re-clicking, and it avoids a needless buffer. Logged as
`player:reclick`.

---

## Model-follow

MusicKit owns transport *within* its fed window (native prev/next). `windowPos` is the
MusicKit index the model's `current` is aligned to. On `nowPlayingItemDidChange`,
`syncModelToMusicKit()` replays `advance()`/`previous()` to walk the model to MusicKit's
`nowPlayingItemIndex` (NOT `queue.position` — empty in this build). Suppressed by
`loadingContext` while we're (re)building the queue, so our own `setQueue`/`change…`
churn doesn't drive the model. `player:desync` logs if the model's `current` ever stops
matching MusicKit's now-playing item.

---

## Manual queueing — Play Next / Add to Queue

Inserting into the queue is **gapless** and never rebuilds: `enqueueNext` / `enqueueLater`
(`player.ts`) use MusicKit's documented `playNext` / `playLater` ops, which mutate the
**upcoming** queue in place — no `setQueue`, no buffer. We keep the model in lockstep:

- **Model side** (`queue.ts`): `playNextMany` unshifts the block onto `upcoming` (order
  preserved); `addToQueueMany` pushes it on the end. Both tag entries `origin: "manual"`,
  so a later `setContext` (new play) keeps them (the stacking rule). The singles
  `playNext`/`addToQueue` just delegate to the batch versions.
- **Why model-follow doesn't break:** the insert is **after** `current`, so `current`'s
  index never moves — `windowPos` stays valid and `nowPlayingItemIndex` is unchanged. The
  new items simply appear at `windowPos+1…` in *both* MusicKit and the model. (Contrast a
  `setQueue` rebuild, which re-buffers `current`.)
- **Bootstrap:** with nothing playing there's no `current` to insert after, so both ops
  fall back to `playContext(block, 0)` — start the block fresh.

`queueTracksNext` / `queueTracksLater` are the `Track[]` wrappers the Library uses (a song
is a 1-track list; an album is its tracks in disc/track order). The right-click **menu**
lives in the collection-card engine (`menu()` grouping accessor → `src/context-menu.ts`);
see [UI-ARCHITECTURE §4a](UI-ARCHITECTURE.md).

> **One thing to confirm on real runs (logged as `player:enqueue` `libOnly`):** whether
> `playNext`/`playLater` accept **library-only** ids (`l.xxxx`, no catalog id) in the
> `{ songs: [...] }` descriptor, the same fallback `setQueue` rides. If a library-only
> song silently doesn't enqueue, that's the place to look.

### Editing Up Next — Remove / Move to Top / Move to Bottom

The Qcard's right-click menu edits **upcoming** entries (`removeFromQueue` / `moveInQueue`
in `player.ts`). Because the edits only touch items *after* `current`, `current`'s index
never moves — `windowPos` and model-follow stay valid.

- **Remove** uses `music.queue.splice(mkIndex, 1)` — a **gapless live mutation** (current
  keeps playing, only `queueItemsDidChange` fires, *not* `nowPlayingItemDidChange`, so
  model-follow isn't disturbed). No `setQueue`, no buffer. (`splice` is MusicKit JS v3's
  supported queue mutator; the old `queue.remove(i)` was deprecated and just forwarded to
  `splice(i, 1)`.)
- **Move to Top / Bottom** compose a `splice`-out + the documented `playNext` / `playLater`
  inserts — all gapless.
- **Index translation:** an upcoming entry at model index `k` sits at MusicKit index
  `nowPlayingItemIndex + 1 + k` (`items` = `[history…, current, upcoming…]`). `mkUpcomingIndex`
  computes that, **id-verifies** it, and falls back to a forward id-search if `setQueue`'s
  dedup drifted things; `-1` (not in the window) → the edit is model-only and reconciles on
  the next re-window.
- **Order:** model first (instant Qcard re-render), then MusicKit. The menu captures the
  **entry**, not the index, and re-resolves the live index per action — so an edit stays
  correct even if playback advances while the menu is open.

> **Edge:** "Move to Bottom" appends at the end of MusicKit's *window* via `playLater`;
> if the model's `upcoming` is longer than the window, that's not the model's true bottom
> (it reconciles on re-window). Fine for typical queues.

### Arbitrary reorder — `reconcileUpcoming` (drag-and-drop)

Top/Bottom hit fixed positions, so they compose from `playNext`/`playLater`. An **arbitrary**
reorder (drag-drop to any slot) has no documented MusicKit op — so instead of the undocumented
`splice`, we **reflect the model into MusicKit by rebuilding only the divergent suffix**:

1. Reorder the model (`queue.move(from, to)`) — it's the source of truth.
2. `reconcileUpcoming()`: compute the model's expected upcoming (deduped against what MusicKit
   holds up to `current`, capped to `WINDOW_FWD`), find the **first index `d`** where MusicKit's
   live upcoming diverges, `splice` out MusicKit's upcoming `[d..end]` (one contiguous removal),
   then `playLater` the model's `[d..end]`.

`splice` + `playLater` both leave `current` untouched → **gapless, no `setQueue`, no buffer**.
The divergent suffix is contiguous, so it's one `splice(np+1+d, count)` (a single
`queueItemsDidChange`) + one batched `playLater`, regardless of how far the drop reached. This
is the **general sync primitive**: drag-reorder uses it now, and re-windowing
(roadmap #3) will lean on it too. The `player:misalign` canary validates every reconcile.

The drag UI itself lives in `qcard.ts` (whole-row press-and-drag, insertion-line feedback,
render suspended mid-drag so a queue/track change can't yank the row — see
[UI-ARCHITECTURE §4b](UI-ARCHITECTURE.md)).

---

## Dead ids — NOT_FOUND self-healing (2026-07-02)

**The failure.** A library's cached `catalogId`s go stale (region pulls, catalog
takedowns). Every MusicKit feed op — `setQueue`, `playNext`, `playLater` — is
**all-or-nothing**: one unresolvable id in the batch rejects the *whole* call with
`NOT_FOUND: One or more items could not be resolved: <ids>`, and nothing plays/inserts.
Whole-library windows (idle shuffle, the play-button bootstrap) made this near-certain;
any 200-song window could hit it.

**The healing (player.ts).** The rejection *names* the offenders, so:

1. **`deadIds`** — a session-scoped denylist. Every id MusicKit reports unresolvable is
   banked (logged as `player:deadIds`).
2. **`playId` is deadIds-aware** — the fallback chain per handle is now
   **catalog id → library id → skip**. A dead catalog id makes the handle ride its
   library id (the user's owned copy usually still plays); a handle with no live id
   left is skipped by every window/insert builder.
3. **Retry, rebuilt** — `doLoadFromModel`'s `setQueue` and `insertWithRetry` (wrapping
   `playNext`/`playLater` in `enqueue`, `moveInQueue`, and `reconcileUpcoming`'s tail)
   catch NOT_FOUND, bank, **rebuild their id list**, and retry (≤3 attempts). Non-resolve
   errors and persistent failures still throw.

**Net behavior:** invisible to the user — first contact with a dead id costs one extra
round-trip, then the session denylist makes every later window/insert skip it up front.
The queue **model** never drops entries: a fully-dead song still shows in the Qcard but
is silently absent from what MusicKit is fed (it reconciles as model-only, same as any
beyond-window entry — the alignment invariant treats MK as a subsequence, so no
`player:misalign`).

**Future work:** persist the denylist (SQLite) so it survives restarts, and let catalog
hydrate repair or clear stale `catalogId`s at the source.

---

## The session play log — the History card's source

`history[]` serves **Previous** — it's deduped and mutated (setContext rebuilds, `previous()`
pops), so it can't honestly answer "what did I listen to?". For that, `queue.ts` keeps a
separate **append-only play log** (`getPlayLog()`, capped at `PLAY_LOG_CAP = 200`,
session-scoped): an entry is logged (as a copy) the moment a song **stops being current**
— in `pushHistory` (advance/jump) and in `setContext` (the outgoing song). Repeats are
real: a song heard three times appears three times, and re-queueing a song from History
never removes its earlier rows — the window dedup in `loadFromModel` handles playback
correctness; the log is display-only.

The **History card** (`history-card.ts`) renders it newest-first: hero block (most recent,
mirrors the Qcard's Now Playing) + "Previously" list. Read-only rows; right-click →
Play Now / Play Next / Add to Queue via the handle-level ops (`playContext` /
`enqueueNext` / `enqueueLater`), stamped `context: "history"`. Row markup/resolution is
shared with the Qcard via `queue-rows.ts`.

---

## The bug this design fixed (so we don't regress)

**Symptom:** clicking the same song repeatedly (or re-playing any row from a list you'd
already played from) played a *different* song after the first click.

**Cause:** the old `setContext` was **append-only** — it pushed the old current *and*
re-seeded the entire pre-click lookback into `history` on every call. Re-clicking stacked
duplicate ids into the fed window; MusicKit collapsed them on `setQueue`, so
`changeToMediaAtIndex(pos)` (with an ever-growing `pos`) landed on the wrong slot. The
`__diag` `player:loadWindow` log showed `pos` climbing `2 → 5 → 8 → 11 …` on identical
clicks — the tell.

**Fix:** ephemeral-rebuild lookback in `setContext` (no accumulation) + window dedup in
`loadFromModel` (exact index regardless) + idempotent re-click guard (no rebuild at all
for the already-playing song).

---

## Quick reference

| Want to… | Look at |
|---|---|
| change Previous / lookback semantics | `setContext` in [queue.ts](../src/queue.ts) |
| change window size / dedup / load sequence | `loadFromModel` in [player.ts](../src/player.ts) |
| change re-click behaviour | `playContext` in [player.ts](../src/player.ts) |
| change Play Next / Add to Queue | `enqueueNext`/`enqueueLater` in [player.ts](../src/player.ts), `*Many` in [queue.ts](../src/queue.ts) |
| change Up Next Remove / Move | `removeFromQueue`/`moveInQueue` (+ `mkUpcomingIndex`) in [player.ts](../src/player.ts) |
| change drag-reorder sync / re-windowing | `reconcileUpcoming` in [player.ts](../src/player.ts) |
| change the drag interaction (Qcard) | the drag block in [qcard.ts](../src/qcard.ts) |
| change the History card / play log | [history-card.ts](../src/history-card.ts) / `getPlayLog`+`logPlay` in [queue.ts](../src/queue.ts) |
| change queue-row markup (Qcard + History) | [queue-rows.ts](../src/queue-rows.ts) |
| change the right-click menu items | `menu()` in [library-card.ts](../src/library-card.ts) (library) / the `contextmenu` handler in [qcard.ts](../src/qcard.ts) (queue); popover in [context-menu.ts](../src/context-menu.ts) |
| debug a wrong-song / frozen-queue issue | `__diag.dump()`; watch `player:loadWindow` `pos`, `player:desync`, `player:reclick`, `player:enqueue` |

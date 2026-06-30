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
| debug a wrong-song / frozen-queue issue | `__diag.dump()`; watch `player:loadWindow` `pos`, `player:desync`, `player:reclick` |

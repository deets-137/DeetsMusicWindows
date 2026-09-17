# A second Search card — compare two albums side by side

Designed 2026-09-17 (the owner's model). **Not built.** Build it on a clean tree, after the
card-memory / §15 batch is committed and used for a while: it touches the same four places.

Related: [SEARCH.md](SEARCH.md) (the card), [CARD-GROW.md](CARD-GROW.md) §15 (drill in place and
the return chain), [CARD-MEMORY.md](CARD-MEMORY.md) (where a card comes back).

## 0. Why

You cannot hold two catalog things on screen at once. An album against another album, a playlist
against a playlist: today the second one replaces the first, and the only way back is Back.
Every card is limited to one instance (§1), and Search is the only card that shows catalog
detail, so "two of them" is the whole feature.

## 1. What stops it today

`layout.ts` keeps one instance of each card, in three places:

- `loadLayout` accepts a saved layout only when every slot holds a **distinct** card; a duplicate
  falls back to the composition's defaults — the whole layout, not just the copy.
- `setSlot` **exchanges** the two slots when you pick a card that is already placed, so a pick can
  never make a second copy.
- Anchored cards (Now Playing, Queue in Max) are out of the picker pool entirely.

And three things assume "one instance" outside the layout:

- `cardHost(id)` / `visibleSlotOf(id)` answer with ONE host (the chip flight, the Compass, drops).
- The request buses broadcast to every mounted card: two Search cards would both take the same
  "Go to Album" intent and both open a pane.
- Card memory is keyed by card id, so two instances would overwrite each other's place.

## 2. The model (the owner's call, 2026-09-17)

- **The first Search card is the one drills use.** A drill from a playlist to an album opens in
  it, on the spot, following §15 (it takes the slot you are reading, unless a Search card is
  already there and "Bring a card already open" is Off).
- **A second Search card is an ordinary card you place yourself**, with the card picker, in
  whatever slot you pick. It is never moved by a drill and never takes a drill's intent. You
  search in it, drill in it, and use its own Back, exactly as with one card.
- So: no new verb, no landing rule, no "which one gets it" question at the moment of the drill.

**The primary** is the Search instance that has been mounted longest (a mount counter per
instance). The other one is the secondary. If the primary is unmounted (you pick another card in
its slot), the secondary becomes the primary — there is only one left.

## 3. The rules

| Case | What happens |
|---|---|
| The picker offers Search while one is placed | It is offered a second time, once. With two up it is disabled in every other slot (cap 2). |
| A drill (Go to Album / Artist, a catalog playlist pane, a Compass term) | Goes to the **primary** only. §15 decides the slot as it does now. |
| The secondary | Never moves, never takes a request, never joins a §15 return chain. |
| A card pick in the secondary's slot | The second instance ends. Nothing else changes. |
| Midi and mini | Midi has two content slots: a second Search is allowed and takes one of them. Mini shows one card; the composition change drops the secondary. |
| Max | Four content slots, so two Search cards and two other cards. |
| A restart | The second instance is **session-only**. `loadLayout` drops the duplicate (see §4) and you are back to one. |
| The agent and the CLI | Address the primary, as today. No new id. |

## 4. The work, file by file

1. **`cards.ts`** — `CardDef` gains `maxInstances?: 2` (absent = 1). Only Search sets it.
2. **`layout.ts`**
   - `loadLayout`: a duplicate no longer resets the layout. Keep the first copy, and give the
     other slot an unplaced card (or the composition default for that slot). This is a **bug fix
     in its own right**: today one bad stored layout throws away every slot the user set.
   - `setSlot`: exchange only when the picked card is at its instance cap; otherwise place a
     second copy and leave the other one alone.
   - `makePicker`: offer Search while the cap allows it; disable it when the cap is met.
   - `visibleSlotOf` becomes `visibleSlotsOf` (a list). `cardHost(id)` answers with the
     **primary's** host, which is what the chip flight and the Compass want.
   - A mount counter per instance, so "the primary" is defined.
   - §15: the chain and `drillSlot` use the primary only.
3. **The three Search-bound buses** (`go-to.ts` drill intent, `go-to.ts` playlist pane,
   `layout-bus.ts` search term): each carries the instance it is for, and a Search card takes a
   request only when it is the primary. The Playlists, Library and Settings buses are untouched,
   because those cards stay single.
4. **`card-memory.ts`** — the key becomes the card id for the primary and `search@<slot>` for the
   secondary. A session-only instance never reaches the disk map.
5. **`search-card.ts`** — takes its instance id from `MountOpts`, and ignores a request that is
   not for it. Everything else already works per instance (its pane stack, its picks, its drag).
6. **Docs** — SEARCH.md gains a section, ONBOARDING.md a row for the picker's second entry, and
   this file becomes "as built".

Rough size: 150–250 lines across six files, plus docs. Half a session.

## 5. Open questions for the build

- **Does the secondary show it is not the drill target?** A quiet mark in its header would say
  "drills land in the other one". Probably not needed: you placed it, so you know.
- **Two Search cards and one term:** they are independent. The recents ring, the pinned terms and
  the category filter are shared (one user preference), which is right.
- **The cap.** Two, because the reason is comparison. A third has no story, and Max would be all
  Search.

## 6. Desk test (when built)

1. Max: pick Search in a second slot. Both exist. The picker no longer offers Search anywhere.
2. Drill from a playlist to an album: the FIRST Search card opens it, on the spot. The second one
   does not change at all.
3. Search something in the second card, drill into an album there, and press its Back: it behaves
   exactly like a single card.
4. Pick another card in the first Search's slot. The remaining one becomes the drill target.
5. Pick another card in the second Search's slot: nothing else moves.
6. Midi: a second Search takes the other slot. Switch to mini and back: one Search remains.
7. Restart: one Search card, and the rest of your layout is exactly as you left it (the
   `loadLayout` fix).
8. A chip flight from an artist view lands in the primary, and its pane fills.

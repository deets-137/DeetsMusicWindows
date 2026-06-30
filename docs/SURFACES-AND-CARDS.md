# DeetsMusic — Surfaces & the Card System

> How the midi-player composes **swappable cards**, and how one webview will serve three
> **surfaces** (mini / midi / max). Read this before touching `src/main.ts` boot, the bento
> markup in `index.html`, or any card's mount path. Siblings:
> [UI-ARCHITECTURE](UI-ARCHITECTURE.md) (tokens + collection-card engine),
> [HANDOFF](HANDOFF.md) (state / roadmap).

---

## Why

The home bento hardcodes one card per slot: Now Playing (top, wide), Library (left), and
the **Queue card borrowing the Playlists slot** (right). We're making the **content slots
host any card** — the user's choice, persisted — so "put Playlists where the Queue is" is a
pick, not a rebuild. The same effort lays the **seam** for serving mini / midi / max from a
single webview.

This doc specs **the system**, not the cards that ride it. The first riders (Playlists, then
Search) come **later**, once the system is in.

---

## Three systems

1. **Card abstraction** — every card is a self-contained *mountable module* in a registry.
2. **Swappable slots** (midi) — a fixed slot grid; each content slot picks which card it
   hosts; the choice persists.
3. **Surface system** — `data-surface="mini|midi|max"` on `<html>`, derived from window
   size/aspect, **one webview**.

(1) is the foundation (2) and (3) build on.

---

## 1. The Card abstraction

Today each card initialises **once**, against fixed DOM: `initLibraryCard()` queries
`[data-card="library"]`, `initQcard()` queries `[data-card="playlists"]`, and Now Playing is
wired inline in `main.ts`. To be swappable a card must instead **mount into a host element**
and **tear itself down** cleanly.

```ts
type CardId = "now-playing" | "library" | "queue" | "playlists" | "search";

interface CardInstance {
  destroy(): void;                       // drop every listener, detach DOM
  // Cards that drill (collection-card) report header state so the slot can show the picker
  // only at root and mirror the live title. Non-drilling cards omit it (always "at root").
  onHeaderChange?(cb: (h: { title: string; atRoot: boolean }) => void): void;
}

interface CardDef {
  id: CardId;
  title: string;                         // default header label (picker + slot chrome)
  mount(host: HTMLElement): CardInstance; // build markup + wire state into host
}

const registry: Record<CardId, CardDef> = { /* now-playing, library, queue, … */ };
```

**Refactor per card:** `initLibraryCard` / `initQcard` → `mount(host)`; Now Playing's inline
wiring in `main.ts` is **extracted to a card module** (it owns its transport markup, today
living in `index.html`). Each returns a `destroy()`.

### The load-bearing gotcha: listener lifetime

Cards subscribe to global state. On unmount we **must** unsubscribe or every swap leaks a
listener. Current state of the subscription APIs:

| API | Returns unsubscribe? |
|---|---|
| `onQueueChange` (queue.ts) | ✅ |
| `onTracksChange` (track-store) | ✅ |
| `onSyncEvent` (library.ts) | verify |
| **`onPlayerState` / `onPlayerProgress`** (player.ts) | ❌ — **must add** |

So part of the foundation is making `onPlayerState` / `onPlayerProgress` return an
unsubscriber (mirror `onQueueChange`). **Canary:** swap a slot ~20× and assert the listener
sets don't grow.

---

## 2. Slots & layout (midi)

The midi bento = **1 anchored transport slot (top, wide) + 2 swappable content slots
(left, right)**. Your examples ("swap Library↔Playlists, Queue↔Library") are the two
columns; Now Playing stays on top.

- **Card pool** for the content slots: `{ library, queue }` today; `{ …, playlists, search }`
  as those land. The 2 slots always hold **2 distinct** cards; any others are *unplaced*
  (not shown, reachable via a picker).
- **One instance per card** — a card can **never occupy both slots**. Picking the card
  that's in the *other* slot **swaps** the two slots; picking an *unplaced* card **replaces**
  this slot's card (the displaced one goes unplaced).
- **Now Playing is anchored.** It's a registry card (so max/mini can reuse it), but in midi
  it lives in the top slot and the content pickers never offer it — you can't end up with no
  transport on screen. ("Swappable but essentially anchored," with the no-transport risk
  designed out.)
- **Persistence:** `localStorage` `deets.layout.midi = { left: CardId, right: CardId }`,
  re-applied on launch like the theme/skin. Default `{ left: "library", right: "queue" }` —
  byte-for-byte today's arrangement.

The layout manager is written **surface-keyed** (it reads `data-surface` and applies the
midi map when midi); max/mini fall back to the midi map until their own compositions land.

---

## 3. The picker = the card's title (a header menu)

The slot header's **title is the menu trigger**, opening a flyout of the content cards.

- **Active only at a card's root.** When a drilling card (Library) is drilled in — inside an
  album, say, where the header shows a **back chevron + the album title** — the title is the
  *context* title, **not** a picker. The picker returns when you pop back to root. A card
  reports this via `onHeaderChange`'s `atRoot`; non-drilling cards (Queue) are always at root,
  so their title is always a picker.
- **Hover or click**, following the existing **Hover-Menu** setting (`deets.menuMode`) — it
  reuses `makeDropdown` (dropdown.ts), exactly like the settings menu and volume flyout, and
  registers with the same `applyMenuMode` fan-out so all menus switch together.
- The flyout lists the content cards; choosing one applies the swap/replace rule above. The
  current card is marked (the same dot/selected indicator the theme flyout uses).

This keeps the affordance discoverable (the title visibly behaves like the settings title)
without adding a separate control to the panel header.

---

## 4. Surface system (seam only, this build)

- `src/surface.ts`: a `ResizeObserver` on the app root computes `mini|midi|max` from
  width/height/aspect thresholds and sets `data-surface` on `<html>`. **The same lever as
  `data-theme` / `data-skin`** — CSS gates layout off the attribute; container queries handle
  finer reflow.
- **midi is fully implemented.** **max** and **mini** are **seam only**: the attribute flips
  and the registry/cards are ready, but their compositions **fall back to the midi layout**.
  Mini's "shrink-in-place + always-on-top" minimize behaviour, and the max full-window
  composition, are **deferred to a later session** (we'll discuss the switch technicals then).

---

## Out of scope (this build)

Playlists & Search cards · accent-palette plumbing · shuffle · the max/mini compositions ·
free-form drag/resize layout · playlist editing. All ride the foundation later.

---

## Build order

Each phase **compiles and is independently testable**; behaviour only changes when intended.

1. **Foundation refactor — zero behaviour change.** Add the registry + `CardDef`/`CardInstance`.
   Refactor Library and Queue from `init*()` to `mount(host)`. Extract Now Playing from
   `main.ts` into a card module. Add unsubscribe to `onPlayerState` / `onPlayerProgress`.
   `main.ts` boot mounts the same three cards into the same fixed positions — **the app looks
   identical.** (De-risks the big refactor before any feature rides it.)
2. **Swappable slots.** Generic slots in `index.html`; `src/layout.ts` (assignment, swap/
   replace rule, persistence); the **title-as-menu picker** (§3). Now the two content cards
   swap and the layout persists.
3. **Surface seam.** `src/surface.ts` sets `data-surface` from size; midi gating in CSS;
   max/mini fall back to midi. Visually ~no-op for midi — it establishes the attribute the
   later redesigns hang off.

*(Later, on this foundation: Playlists card → Search card → accent-palette plumbing →
shuffle → max & mini compositions.)*

---

## Risks / verify

- **Listener leaks on remount** (the unsub gap, §1) — the main correctness risk; canary it.
- **Collection-card must be instance-scoped** — once Playlists exists, Library + Playlists run
  two engine instances at once. Verify `collection-card.ts` holds no module-level state before
  a second instance ships (not needed this build, but the refactor shouldn't assume a single
  instance).
- **Anchored Now Playing** — the content pickers must never offer it, so midi can't lose its
  transport.
- **Markup ownership** — each card's markup moves out of `index.html` into its module; the
  loopback auth page (`apple.rs`) is independent, so there's no overlap.

---

## Decisions (closed)

One webview, size/aspect-gated · fixed slots, swap contents (no free-form) · a card can't be
in both slots (swap on conflict) · Now Playing anchored in midi but registered · picker = the
card title, hover/click per `deets.menuMode`, **root-level only** · max/mini = seam only this
build · Playlists/Search built later as the first riders.

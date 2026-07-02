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
type CardId = "now-playing" | "library" | "queue" | "playlists" | "search" | "history";

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

### Programmatic summon (2026-07-02)

Cards can ask the layout to bring another card on-screen: `src/layout-bus.ts` exposes
`requestCard(id)` / `onCardRequest(cb)` (a tiny message module — a direct `layout.ts`
import from a card would close the cycle layout → cards → card). First consumer: the NP
card's **queue button**.

- **Target slot = least-recently-touched.** `layout.ts` tracks per-slot recency via a
  capture-phase `pointerdown` on each slot host (any interaction counts) plus "a card was
  swapped in". Session-only; on the launch tie the LRU is the **right** slot (queue's
  default home). A summon lands in the LRU slot — the column you care about least.
- **Already visible?** `setSlot`'s existing exchange branch means summoning a card that's
  in the *other* slot **flips the two** ([FUTURE-SETTINGS §10](FUTURE-SETTINGS.md) records
  the no-op alternative). Already in the LRU slot → no-op.
- **No drill guard, deliberately:** a summon destroy+remounts the target slot, so a
  drilled card there returns to root. Recency makes this rare (a slot you drilled is a
  slot you touched); if it ever stings, "prefer the slot at root" is a small retrofit —
  layout already receives per-card `atRoot` via `onHeaderChange`.

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

### What each surface is *for* (the thesis, not just the size)
The three surfaces are an **engagement ladder** — each has a distinct job, which is what should
drive its composition when max/mini are built:

- **mini — *listening*.** For when music is **already playing / the queue is already set**.
  Playback-first and minimal: glanceable now-playing + transport, nothing to curate. You're not
  building anything here, you're listening.
- **midi — *queueing*.** The way you **build what plays, however you listen** — the swappable
  content cards (library / queue / playlists / search / stations) feeding the queue. The current
  surface; its whole point is getting music *into* the queue in whatever way suits you.
- **max — *exploring / organizing*.** Full-screen, where you **browse, manage, and interact**
  with the music at depth — sidebar + main with many slots. The surface for library organization,
  discovery, and everything that isn't just "queue it and go."

This ladder (listen → queue → explore) is why mini is the smallest/most-locked-down composition
and max is the richest — and why the *same* cards can appear across surfaces but with different
prominence (e.g. Now Playing is the *whole* of mini, a strip in midi, and one panel among many in
max).

- `src/surface.ts`: sets `data-surface="mini|midi|max"` on `<html>` — **the same lever as
  `data-theme` / `data-skin`** (CSS gates layout off the attribute; container queries handle
  finer reflow). It owns a `ResizeObserver`, but surface is **not** a pure function of size —
  see the switching model below.
- **Switching model (decided):** surface is a **deliberate user choice** with a **resize
  allowance**. The user picks the surface; each surface remembers its own window size. Within
  a surface you may resize freely inside that surface's **band**, and only **crossing the
  band's threshold flips** to the adjacent surface (with a small hysteresis so the boundary
  doesn't oscillate). The bands, the auto-flip on/off, and the hysteresis are a **setting to
  build** — specced in [FUTURE-SETTINGS §8](FUTURE-SETTINGS.md).
- **midi is fully implemented.** **max** and **mini** are **seam only**: the attribute flips
  and the registry/cards are ready, but their compositions **fall back to the midi layout**.
  Their intended shapes:
  - **max — full-screen.** A **sidebar + main** layout (a bento with **many more slots** than
    midi's two): persistent nav/library rail on the side, a wide main area composing several
    cards at once. Wants its own, larger per-surface slot set (not midi's `{np, left, right}`).
  - **mini — compact floating.** "Shrink-in-place + always-on-top" on minimize; a single
    condensed transport (cover + title/artist + play/prev/next + scrub), no content slots.
  The max composition and mini's minimize/always-on-top switch technicals are **deferred to a
  later session** (design each when we build it).

---

## Out of scope (this build)

Playlists & Search cards · accent-palette plumbing · shuffle · the max/mini compositions ·
free-form drag/resize layout · playlist editing. All ride the foundation later.

---

## Build order

Each phase **compiles and is independently testable**; behaviour only changes when intended.

1. ✅ **Foundation refactor — zero behaviour change.** Registry + `CardDef`/`CardInstance`;
   Library/Queue refactored from `init*()` to `mount(host)`; Now Playing extracted to
   `now-playing-card.ts`; `onPlayerState`/`onPlayerProgress` + the collection-card engine
   gained unsubscribe/`destroy`. Cards own their markup (the `index.html` panels are empty
   hosts). Committed `34829f0`.
2. ✅ **Swappable slots.** Generic `data-slot` slots; `src/layout.ts` (assignment, swap/
   replace, validation, persistence via `deets.layout.midi`); the **title-as-menu picker**
   (§3); **menu mode folded into the dropdown primitive** (`setDropdownMode` + a live registry
   + `makeDropdown.destroy()`); a **Playlists stub** card so the picker exercises 3 cards / 2
   slots. Also fixed here: the Library card's startup re-sync moved to `initTrackStore` (once
   per session) so a slot swap no longer re-triggers a full Apple sync.
3. ✅ **Surface seam + sizing/switching — built (2026-07-01).** How it works:
   - **`src/surface.ts`** — a `ResizeObserver` on the app root; the per-surface **size band**
     table (mini ≤ 380px · midi 380–820px · max > 820px wide, **40px hysteresis**); the active
     surface = the **persisted deliberate choice** (`deets.surface`) *plus* the window size,
     flipping only when a band threshold is crossed past the hysteresis; sets `data-surface` on
     `<html>` (the same lever as `data-theme`/`data-skin`). Programmatic resizes (restoring a
     surface's remembered size) are guarded so they can't trigger a spurious flip.
   - **Selection** — a **Surface** settings-menu row (mirrors Theme/Skin) offering
     **Mini · Midi · Max**, each label rendered at the skin's own type scale as a size preview
     (`--fs-subtext` / `--fs-text` / `--fs-title`; all rows share the tallest line box).
     Selecting a surface restores its remembered window size (needs the
     `core:window:allow-set-size` capability — granted in `capabilities/default.json`).
   - **CSS** — the `.bento` base block *is* the midi map; max/mini inherit it (commented override
     stubs mark where their compositions land later).
   - **Persistence** — `deets.surface` + `deets.surface.size.{mini,midi,max}` (saved debounced on
     resize, restored on selection and launch) — the FUTURE-SETTINGS §8 keys.
   - **Still deferred:** the max & mini compositions, mini's minimize-entry / shrink-in-place /
     always-on-top behaviour, and the band-editor setting. Picking Mini today = a small window
     with the midi bento inside (functional, squished — by design until mini's composition lands).
   - **Guiding thesis** for later compositions — the *listen → queue → explore* ladder in §4 (mini
     = listening, midi = queueing, max = exploring/organizing).

*(Later, on this foundation: real Playlists context → Search card → accent-palette plumbing →
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
card title, hover/click per `deets.menuMode`, **root-level only**, **no caret** (a click-mode
caret affordance is deferred — see [FUTURE-SETTINGS §6](FUTURE-SETTINGS.md)) · menu mode lives
in the dropdown primitive (`setDropdownMode`) · max/mini = seam only this
build · Playlists/Search built later as the first riders.

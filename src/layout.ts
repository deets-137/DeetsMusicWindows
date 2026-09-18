// Layout manager — composes the bento per SURFACE (SURFACES-AND-CARDS.md §2/§4).
//
// Now Playing is mounted once into the anchored top slot and never swapped; the CSS
// composition for each surface restyles it in place. Every other slot comes from the
// active surface's Composition: which content slots it has, which cards are anchored
// (never offered by the pickers), the default assignment, and the localStorage key it
// persists to. mini rides midi's map (CSS hides the right slot); max has its own four
// content slots plus the Queue card anchored under the stage.
//
// Swap mechanism is destroy + remount. The picker is root-only (a card can only be picked
// while it shows its base title), so a pick never strands a drill. A summon, a surface flip
// and the drill swap DO remount a drilled card — card memory (CARD-MEMORY.md) carries its
// open levels and scroll place across, so the card comes back where it was.

import { registry, type CardDef, type CardId, type CardInstance, type MountOpts } from "./cards";
import { setting, onSettingsChange } from "./settings-store";
import { makeDropdown } from "./dropdown";
import { onCardRequest, setCardHostLookup, setDrillSwapCheck, type RequestHow } from "./layout-bus";
import { initCardMemory, cardMemory, rememberCard, setLiveSnapshots } from "./card-memory";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import * as diag from "./diag";
import { applySurface, currentSurface, isPlayerView, onSurfaceChange, type SurfaceName } from "./surface";
import { playSwap, playOut, flushSwapOut, onScreen, type SwapMove } from "./card-swap";
import { initCardGrow, attachGrowButton, isCovered, collapseGrow, grownState, onGrowChange, refreshGrowZones, type Slot, type GrowButton } from "./card-grow";

type Assignment = Partial<Record<Slot, CardId>>;

interface Composition {
  /** localStorage key for the persisted assignment. */
  key: string;
  /** Content slots, in order. The LRU tie-break prefers the LATER slot (midi: right). */
  slots: Slot[];
  /** Cards the pickers never offer (they're on-screen by construction). */
  anchored: CardId[];
  defaults: Assignment;
  /** Mount the Queue card into the dedicated [data-slot="queue"] host (max). */
  queueSlot: boolean;
}

const MIDI: Composition = {
  key: "deets.layout.midi",
  slots: ["left", "right"],
  anchored: ["now-playing"],
  // Home first, Library beside it (owner's call 2026-09-18). A stranger has nothing in the
  // Queue for a while, and Home is the card that fills first — so the Queue is not a default.
  defaults: { left: "home", right: "library" },
  queueSlot: false,
};
// max (2026-09-09, option A): stage + anchored queue on the left, a 2×2 bento on the right.
const MAX: Composition = {
  key: "deets.layout.max",
  slots: ["left", "right", "c", "d"],
  anchored: ["now-playing", "queue"],
  // The same first row as midi, then Playlists | Search (owner's call 2026-09-18). Max's
  // Queue is anchored in its own column, so nothing is lost by dropping it from the bento;
  // History is the card that steps aside.
  defaults: { left: "home", right: "library", c: "playlists", d: "search" },
  queueSlot: true,
};

/** mini shares midi's map — its composition only hides the right slot (CSS). */
const compositionFor = (s: SurfaceName): Composition => (s === "max" ? MAX : MIDI);

/** Cards selectable in a content slot under a composition — everything not anchored,
 *  minus Rewind while its setting is off (the 50-start gate, SETTINGS.md). */
const poolFor = (comp: Composition): CardDef[] =>
  (Object.values(registry).filter(Boolean) as CardDef[]).filter(
    (c) => !comp.anchored.includes(c.id) && (c.id !== "rewind" || setting("rewindCard")),
  );

function loadLayout(comp: Composition): Assignment {
  try {
    const raw = localStorage.getItem(comp.key);
    if (raw) {
      const s = JSON.parse(raw) as Assignment;
      const ids = new Set(poolFor(comp).map((c) => c.id));
      const picked = comp.slots.map((slot) => s[slot]);
      // Every slot filled with a distinct, still-registered, non-anchored card — else default.
      const valid =
        picked.every((id) => id && ids.has(id)) && new Set(picked).size === picked.length;
      if (valid) {
        const out: Assignment = {};
        comp.slots.forEach((slot) => (out[slot] = s[slot]));
        return out;
      }
    }
  } catch {
    /* corrupt prefs → default */
  }
  return { ...comp.defaults };
}

function saveLayout(comp: Composition, l: Assignment): void {
  try {
    localStorage.setItem(comp.key, JSON.stringify(l));
  } catch {
    /* storage disabled — still applies for the session */
  }
}

interface SlotPicker {
  destroy(): void;
}

/** Turn a mounted content card's title into a card-picker menu — live only at the card's root. */
function makePicker(
  slot: Slot,
  host: HTMLElement,
  currentId: CardId,
  inst: CardInstance,
  pool: CardDef[],
  onPick: (slot: Slot, id: CardId) => void,
): SlotPicker {
  const head = host.querySelector<HTMLElement>(".panel__head");
  const title = host.querySelector<HTMLElement>(".panel__title");
  if (!head || !title) return { destroy() {} };

  const menu = document.createElement("div");
  menu.className = "slot-picker__menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = pool
    .map(
      (c) =>
        `<button class="flyout__item" type="button" role="menuitemradio" data-card-id="${c.id}" aria-checked="${
          c.id === currentId
        }">${c.title}</button>`,
    )
    .join("");
  head.appendChild(menu);

  // The title is the trigger — plain text, no caret (like the DeetsMusic settings title).
  title.setAttribute("aria-haspopup", "true");

  let atRoot = true;
  const setActive = (on: boolean) => {
    title.classList.toggle("is-pickable", on);
    if (on) title.setAttribute("tabindex", "0");
    else title.removeAttribute("tabindex");
  };
  setActive(true);

  // Fit the menu to the window on every open (the window may have changed size since): a list
  // taller than the room under the title goes to two columns; if even that doesn't fit (a
  // very short window) it scrolls; a menu past the right edge shifts left.
  const FIT_PAD = 6; // px kept clear of the window edge, as the context menu keeps
  const fit = () => {
    menu.classList.remove("slot-picker__menu--cols");
    menu.style.maxHeight = "";
    menu.style.left = "";
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const room = () => vh - menu.getBoundingClientRect().top - FIT_PAD;
    if (menu.offsetHeight > room()) menu.classList.add("slot-picker__menu--cols");
    if (menu.offsetHeight > room()) menu.style.maxHeight = `${Math.max(0, room())}px`;
    const over = menu.getBoundingClientRect().right - (vw - FIT_PAD);
    if (over > 0) menu.style.left = `${-over}px`;
  };

  const dd = makeDropdown({ root: head, trigger: title, panel: menu, disabled: () => !atRoot, onOpen: fit });

  // Drilling cards report root/title state; off-root the picker goes inert and the title
  // reverts to the drilled context title (with the back chevron). Non-drilling cards never
  // call back, so they stay at root (always pickable).
  const unsubHeader = inst.onHeaderChange?.((h) => {
    atRoot = h.atRoot;
    setActive(atRoot);
    if (!atRoot) dd.close();
  });

  const onMenuClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
    if (!btn) return;
    e.stopPropagation();
    dd.close();
    onPick(slot, btn.dataset.cardId as CardId);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!atRoot) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dd.isOpen ? dd.close() : dd.open();
    }
  };
  menu.addEventListener("click", onMenuClick);
  title.addEventListener("keydown", onKey);

  return {
    destroy() {
      unsubHeader?.();
      dd.destroy(); // menu + title listeners drop with the host on the card's own teardown
    },
  };
}

export function initLayout(): void {
  initCardMemory(); // the saved places, before the first card mounts (CARD-MEMORY.md §3)
  const npHost = document.querySelector<HTMLElement>('[data-slot="np"]');
  const npDef = registry["now-playing"];
  if (npHost && npDef) npDef.mount(npHost); // anchored in every surface; never swapped

  const queueHost = document.querySelector<HTMLElement>('[data-slot="queue"]');
  // The four content slots, plus max's two anchored hosts: card grow needs them so the Queue
  // can grow up over Now Playing (docs/STAGE-COLUMN.md §7). They are NOT in comp.slots, so
  // nothing else here treats them as content slots.
  const hosts: Record<Slot, HTMLElement | null> = {
    left: document.querySelector<HTMLElement>('[data-slot="left"]'),
    right: document.querySelector<HTMLElement>('[data-slot="right"]'),
    c: document.querySelector<HTMLElement>('[data-slot="c"]'),
    d: document.querySelector<HTMLElement>('[data-slot="d"]'),
    np: npHost,
    queue: queueHost,
  };

  let comp: Composition = compositionFor(currentSurface());
  let layout: Assignment = loadLayout(comp);
  const mounted: Partial<Record<Slot, { inst: CardInstance; picker: SlotPicker; grow: GrowButton }>> = {};
  let queueInst: CardInstance | null = null;
  let queueGrow: GrowButton | null = null;

  // Card grow (CARD-GROW.md): the zones, the header button, the covered-card rules. Wired
  // before this module's own surface listener, so a grow ends before the slots remount.
  const bento = document.querySelector<HTMLElement>(".bento");
  const body = document.querySelector<HTMLElement>(".app-body");
  if (bento && body)
    initCardGrow({
      hosts,
      bento,
      body,
      slots: () => comp.slots,
      titleOf: (s) => {
        if (s === "np") return registry["now-playing"]?.title ?? "Now Playing";
        if (s === "queue") return registry.queue?.title ?? "Queue";
        return layout[s] ? registry[layout[s]!]?.title ?? "" : "";
      },
      slotOf: (name) => {
        const n = name.trim().toLowerCase();
        // The anchored hosts answer to their own names in max (the agent's `/grow` route).
        if (comp.queueSlot && (n === "queue" || n === "up next")) return "queue";
        if (comp.queueSlot && (n === "np" || n === "now playing" || n === "now-playing")) return "np";
        if (comp.slots.includes(n as Slot)) return n as Slot;
        return comp.slots.find((s) => {
          const id = layout[s];
          return !!id && (id === n || (registry[id]?.title ?? "").toLowerCase() === n);
        }) ?? null;
      },
    });
  // A slot that shows its card: on screen and not under a grown card.
  const shown = (s: Slot): boolean => onScreen(hosts[s]) && !isCovered(s);

  // ── Slot recency — which content slot the user interacted with least recently.
  // Any pointerdown inside a slot counts (capture phase, so drills/scrolls/menus all
  // register), as does a card being swapped in. Session-only; on the launch tie the
  // LRU is the LAST slot of the composition (midi: right — queue's default home, so a
  // fresh-launch summon lands where you'd expect).
  const lastTouch: Record<Slot, number> = { left: 0, right: 0, c: 0, d: 0, np: 0, queue: 0 };
  const touch = (slot: Slot) => { lastTouch[slot] = Date.now(); };
  (Object.keys(hosts) as Slot[]).forEach((slot) => {
    hosts[slot]?.addEventListener("pointerdown", () => touch(slot), { capture: true });
  });
  // A covered slot is never the landing place: the grown slot is the freshest, so the LRU
  // would be a card nobody can see (CARD-GROW.md §14.5). Null = every other slot is covered.
  const lruSlot = (): Slot | null => {
    const open = comp.slots.filter((s) => !isCovered(s));
    if (!open.length) return null;
    let best = open[0];
    for (const s of open) if (lastTouch[s] <= lastTouch[best]) best = s; // ties → later slot
    return best;
  };

  // The slot whose card the user acted in last (CARD-GROW.md §14.2). A press in a portaled
  // overlay (a context menu, a dropdown, the hint box) keeps the answer, so "Go to Album" in a
  // row's menu still counts as that card; a press anywhere else in the app clears it.
  let lastInput: { slot: Slot | null; at: number } = { slot: null, at: 0 };
  const OVERLAY = ".ctx-menu, .lib-pop, .slot-picker__menu, .flyout, .hint, .toast, .pop";
  const noteInput = (e: Event) => {
    const t = e.target as HTMLElement | null;
    if (!t || (t.closest && t.closest(OVERLAY))) {
      if (lastInput.slot) lastInput = { slot: lastInput.slot, at: Date.now() };
      return;
    }
    const slot = comp.slots.find((s) => hosts[s]?.contains(t)) ?? null;
    lastInput = { slot, at: Date.now() };
  };
  document.addEventListener("pointerdown", noteInput, true);
  document.addEventListener("keydown", noteInput, true);

  const mountSlot = (slot: Slot, mountOpts?: MountOpts) => {
    const host = hosts[slot];
    const id = layout[slot];
    const def = id ? registry[id] : undefined;
    if (!host || !id || !def) return;
    // Card memory (CARD-MEMORY.md §4): the card takes back the place it left, unless it is
    // mounting to take a held request — the card itself decides that.
    const inst = def.mount(host, { memory: cardMemory(id), ...mountOpts });
    const picker = makePicker(slot, host, id, inst, poolFor(comp), setSlot);
    const grow = attachGrowButton(slot, host);
    mounted[slot] = { inst, picker, grow };
  };

  const unmountSlot = (slot: Slot) => {
    const m = mounted[slot];
    if (!m) return;
    const id = layout[slot];
    if (id) rememberCard(id, m.inst.snapshot?.()); // where this card was (CARD-MEMORY.md §4)
    m.grow.destroy();
    m.picker.destroy();
    m.inst.destroy();
    delete mounted[slot];
  };

  function setSlot(slot: Slot, id: CardId): void {
    flushSwapOut(); // a remount still waiting on its out step lands first, so `layout` is current
    if (!comp.slots.includes(slot) || layout[slot] === id) return; // not in this composition / already here
    const other = comp.slots.find((s) => layout[s] === id);
    wipeChain(slot); // a pick in this slot ends its way back (CARD-GROW.md §15.3)
    // A pick that touches a grown card (CARD-GROW.md §7, fork 6): "Keep" swaps the cards and
    // the span stays on the slot; "Collapse" ends the grow first, then the pick runs.
    const g = grownState();
    if (g && setting("cardGrowPick") === "collapse" && (slot === g.slot || other === g.slot || isCovered(slot) || (other !== undefined && isCovered(other)))) {
      void collapseGrow("pick").then(() => setSlot(slot, id));
      return;
    }
    // Motion (card-swap.ts): a skin with an out step plays the leaving cards out before the
    // remount; then each new card plays from the slot it left. A slot off screen (mini's
    // right) or under a grown card has no start: the card coming out of it rises in, the one
    // going into it is unseen.
    const a = shown(slot) ? hosts[slot] : null;
    const b = other && shown(other) ? hosts[other] : null;
    const detail = other ? `swap ${slot}↔${other}` : `replace ${slot}`;
    playOut([a, b].filter(onScreen), () => {
      if (other) {
        // chosen card is in another slot → exchange the two
        const prev = layout[slot];
        unmountSlot(slot);
        unmountSlot(other);
        layout = { ...layout, [slot]: id, [other]: prev };
        mountSlot(slot);
        mountSlot(other);
        const moves: SwapMove[] = [];
        if (onScreen(a)) moves.push({ el: a, from: onScreen(b) ? b : undefined });
        if (onScreen(b)) moves.push({ el: b, from: onScreen(a) ? a : undefined });
        playSwap(moves, detail);
      } else {
        // bring an unplaced card into this slot (the displaced card goes unplaced)
        unmountSlot(slot);
        layout = { ...layout, [slot]: id };
        mountSlot(slot);
        playSwap(onScreen(a) ? [{ el: a }] : [], detail);
      }
      saveLayout(comp, layout);
      touch(slot); // acting on a slot (picker or summon) makes it the freshest
      refreshGrowZones(); // the zones' hints name the cards
    }, detail);
  }

  // ── the drill swap (CARD-GROW.md §14) ──
  // A drill from the grown card: the card it opens takes the grown card's place, at the same
  // size, and Back brings the first card back. Card memory carries both cards across.
  const INPUT_FRESH_MS = 1500; // an agent's request follows no press of ours, so it never swaps
  const CHAIN_CAP = 20; // a runaway guard, not a rule (CARD-GROW.md §15.3): ~1 KB an entry
  /** The way back per slot: the card that was there, with ITS OWN place (card memory holds only
   *  one place per card id, and a chain can hold the same card at two places). */
  const chains: Partial<Record<Slot, { card: CardId; snap: unknown }[]>> = {};
  const wipeChain = (slot: Slot) => { delete chains[slot]; };

  /** The slot a drill for `id` should open in: the one the user is reading. Null = summon it. */
  const drillSlot = (id: CardId): Slot | null => {
    if (setting("cardDrill") !== "inplace") return null;
    const s = lastInput.slot;
    if (!s || Date.now() - lastInput.at >= INPUT_FRESH_MS) return null; // no press of ours (an agent)
    if (!comp.slots.includes(s) || isCovered(s)) return null; // you cannot be reading a covered card
    if (layout[s] === id || comp.anchored.includes(id)) return null;
    // The card is already on screen (CARD-GROW.md §15.2): bringing it here costs TWO cards moving
    // — it takes this slot, and the card here takes its old one. Off by default: it opens where
    // it sits instead, and nothing moves.
    if (!setting("cardDrillBring") && visibleSlotOf(id)) return null;
    return s;
  };
  setDrillSwapCheck((id) => drillSlot(id) !== null);
  // A grow that ends takes its slot's way back with it (CARD-GROW.md §15.3).
  onGrowChange((s) => { if (!s) (Object.keys(hosts) as Slot[]).forEach(wipeChain); });
  // Dev handle: why a drill opened where it did (DEBUGGING.md, CARD-GROW.md §15.2).
  if (import.meta.env.DEV) {
    (window as unknown as { __drill: unknown }).__drill = {
      state: () => ({
        lastInput,
        grown: grownState(),
        setting: setting("cardDrill"),
        layout,
        chains: Object.fromEntries((Object.keys(chains) as Slot[]).map((s) => [s, (chains[s] ?? []).map((e) => e.card)])),
      }),
      slotFor: (id: CardId) => drillSlot(id),
    };
  }

  /** A still copy of a card's body, over its host, for the slide (§14.6). */
  const SCROLLERS = ".lib-view, .spane__scroll, .qcard__list, .panel__body, .search__scroller";
  const bodyCopy = (host: HTMLElement): HTMLElement | null => {
    const body = host.querySelector<HTMLElement>(":scope > .panel__body, :scope > .coll-body");
    if (!body) return null;
    const copy = body.cloneNode(true) as HTMLElement;
    copy.classList.add("drill-swap__ghost");
    copy.inert = true;
    copy.setAttribute("aria-hidden", "true");
    // The copy stands exactly where the body is, and keeps every scroll place it showed.
    copy.style.top = `${body.offsetTop}px`;
    copy.style.left = `${body.offsetLeft}px`;
    copy.style.width = `${body.offsetWidth}px`;
    copy.style.height = `${body.offsetHeight}px`;
    const from = [body, ...body.querySelectorAll<HTMLElement>(SCROLLERS)];
    const to = [copy, ...copy.querySelectorAll<HTMLElement>(SCROLLERS)];
    from.forEach((el, i) => {
      const t = to[i];
      if (!t) return;
      t.dataset.drillScroll = String(el.scrollTop);
      t.dataset.drillScrollX = String(el.scrollLeft);
    });
    return copy;
  };

  /** The drill slide between two cards in one slot: the old body out, the new one in. */
  const slideBodies = (host: HTMLElement, ghost: HTMLElement | null, way: "in" | "back") => {
    const body = host.querySelector<HTMLElement>(":scope > .panel__body, :scope > .coll-body");
    const dur = tokenMs("--nav-dur");
    if (!body || !ghost || dur <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ghost?.remove();
      return;
    }
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--nav-ease").trim() || "ease";
    const from = way === "in" ? "100%" : "-100%";
    const to = way === "in" ? "-100%" : "100%";
    host.classList.add("is-drill-swap");
    host.appendChild(ghost);
    [ghost, ...ghost.querySelectorAll<HTMLElement>(SCROLLERS)].forEach((el) => {
      if (el.dataset.drillScroll) el.scrollTop = Number(el.dataset.drillScroll);
      if (el.dataset.drillScrollX) el.scrollLeft = Number(el.dataset.drillScrollX);
    });
    const end = frames.begin("grow-drill", way);
    const a = body.animate([{ transform: `translateX(${from})` }, { transform: "translateX(0)" }], { duration: dur, easing: ease });
    const b = ghost.animate([{ transform: "translateX(0)" }, { transform: `translateX(${to})` }], { duration: dur, easing: ease });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      a.cancel();
      b.cancel();
      ghost.remove();
      host.classList.remove("is-drill-swap");
      end();
    };
    b.onfinish = finish;
    b.oncancel = finish;
    window.setTimeout(finish, dur + 150); // a hidden panel sends no finish
  };

  /** Put `id` in `slot`, the card that was there going where `id` came from (or off screen).
   *  `memory` is the place the returning card left; `armReturn` says the chain goes deeper. */
  const drillSwap = (
    slot: Slot,
    id: CardId,
    way: "in" | "back",
    memory?: unknown,
    armReturn = false,
    returnTitle?: string,
  ): boolean => {
    if (!comp.slots.includes(slot)) return false;
    const source = layout[slot];
    if (!source || source === id) return false;
    flushSwapOut();
    const host = hosts[slot];
    if (!host) return false;
    const ghost = bodyCopy(host);
    const other = comp.slots.find((s) => layout[s] === id);
    const opts: MountOpts = { memory, onReturn: armReturn ? () => returnFrom(slot) : undefined, returnTitle };
    unmountSlot(slot);
    if (other) unmountSlot(other);
    layout = { ...layout, [slot]: id, ...(other ? { [other]: source } : {}) };
    mountSlot(slot, opts);
    if (other) mountSlot(other);
    saveLayout(comp, layout);
    touch(slot);
    refreshGrowZones();
    slideBodies(host, ghost, way);
    diag.log("drill", { slot, from: source, to: id, way, exchanged: other ?? "", chain: chains[slot]?.length ?? 0 });
    return true;
  };

  /** A drill: the target takes the slot you are reading, and the card that was there is pushed
   *  onto that slot's way back, with its own place (CARD-GROW.md §15.3). */
  const drillInPlace = (slot: Slot, id: CardId): boolean => {
    const source = layout[slot];
    if (!source) return false;
    const snap = mounted[slot]?.inst.snapshot?.();
    if (!drillSwap(slot, id, "in", undefined, true, registry[source]?.title)) return false;
    const stack = (chains[slot] ??= []);
    stack.push({ card: source, snap });
    if (stack.length > CHAIN_CAP) stack.shift();
    return true;
  };

  /** Back on a level a drill opened: the card before it comes back, where it was. False when
   *  the chain is gone (a pick, a surface change, a collapse), so the card does a plain Back. */
  function returnFrom(slot: Slot): boolean {
    const stack = chains[slot];
    if (!stack?.length || !comp.slots.includes(slot)) return false;
    const entry = stack[stack.length - 1];
    if (layout[slot] === entry.card) return false; // nothing to swap back to
    stack.pop();
    const deeper = stack.length > 0;
    const ok = drillSwap(slot, entry.card, "back", entry.snap, deeper, deeper ? registry[stack[stack.length - 1].card]?.title : undefined);
    if (!ok) stack.push(entry); // put it back: the swap did not run
    else if (!deeper) wipeChain(slot); // back at the resting state: the chain goes
    return ok;
  }

  const compose = () => {
    comp.slots.forEach((s) => mountSlot(s));
    if (comp.queueSlot && queueHost && registry.queue) {
      queueInst = registry.queue.mount(queueHost);
      // The anchored Queue takes the Grow button and its edge strips too — one of them acts:
      // the top one, up over Now Playing (docs/STAGE-COLUMN.md §7).
      queueGrow = attachGrowButton("queue", queueHost);
    }
    refreshGrowZones(); // the zones' hints name the mounted cards
  };
  const decompose = () => {
    (Object.keys(hosts) as Slot[]).forEach(wipeChain); // a new composition has no way back
    (Object.keys(mounted) as Slot[]).forEach(unmountSlot);
    queueGrow?.destroy();
    queueGrow = null;
    queueInst?.destroy();
    queueInst = null;
  };

  compose();

  // A surface flip between compositions (midi/mini ↔ max) remounts the content slots
  // from the new map; mini ↔ midi share a map, so nothing remounts (CSS does the work).
  onSurfaceChange((s) => {
    const next = compositionFor(s);
    if (next === comp) return;
    flushSwapOut(); // a pick still in its out step lands in the old map before it is torn down
    decompose();
    comp = next;
    layout = loadLayout(comp);
    compose();
  });

  // ── Summon requests (e.g. the NP card's queue button) — bring the card into the
  // LRU slot. setSlot already covers every case: unplaced card → mounts there;
  // visible in another slot → the two exchange ("flip"); already in the LRU slot →
  // no-op. A drilled card in the target slot remounts at root — deliberate, no guard
  // (recency means a drilled slot is rarely the LRU one).
  // In mini only the LEFT slot is on-screen (the right one is display:none), so a
  // summon must land there or it lands nowhere visible. An anchored card (max's
  // queue) is already on-screen by construction → no-op.
  // The player has no visible slot: a request first switches mini to its card view
  // (synchronous — the slot is on-screen before setSlot mounts into it).
  // A slot of this composition that shows `id` on screen (mini's hidden right slot doesn't count).
  const visibleSlotOf = (id: CardId): Slot | undefined => comp.slots.find((s) => layout[s] === id && shown(s));
  onCardRequest((id, how: RequestHow) => {
    if (comp.anchored.includes(id)) {
      // An anchored card is on screen by construction — unless a grow covers it. In max the
      // Queue can cover Now Playing (STAGE-COLUMN.md §7), so a request for it ends the grow.
      const anchored: Slot | null = id === "now-playing" ? "np" : id === "queue" && comp.queueSlot ? "queue" : null;
      if (anchored && isCovered(anchored)) void collapseGrow("request");
      return;
    }
    if (isPlayerView()) void applySurface("mini", "cards");
    // A drill (CARD-GROW.md §15): the card it opens takes the place of the card you are reading,
    // and Back walks the chain back. A grown slot keeps its span.
    const inPlace = how === "drill" ? drillSlot(id) : null;
    if (inPlace && drillInPlace(inPlace, id)) return;
    // Under a grown card (CARD-GROW.md §7, fork 5): the grow collapses, and the card is on screen.
    if (comp.slots.some((s) => layout[s] === id && isCovered(s))) {
      void collapseGrow("request");
      return;
    }
    // Already on screen: leave the layout as it is. It used to exchange the two slots
    // whenever the least-recently-touched slot was the other one (ARTIST-VIEW.md §6).
    if (visibleSlotOf(id)) return;
    if (currentSurface() === "mini") {
      setSlot("left", id);
      return;
    }
    const slot = lruSlot();
    // Every other slot is under the grown card (Midi, or a filled card in Max): the grow ends
    // first, so the card lands where it can be seen (CARD-GROW.md §14.5).
    if (slot) setSlot(slot, id);
    else void collapseGrow("request").then(() => setSlot(lruSlot() ?? comp.slots[0], id));
  });
  setCardHostLookup((id) => {
    const s = visibleSlotOf(id);
    if (s) return hosts[s];
    // max's anchored Queue is on screen but has no content slot: Compass's "grow queue" and
    // the handoff need its host (docs/STAGE-COLUMN.md §7).
    if (id === "queue" && comp.queueSlot) return queueHost;
    return null;
  });
  // A quit saves the places of the cards on screen too, not only of destroyed ones.
  setLiveSnapshots(() =>
    comp.slots
      .map((s) => [layout[s], mounted[s]?.inst.snapshot?.()] as [CardId | undefined, unknown])
      .filter((e): e is [CardId, unknown] => !!e[0] && e[1] != null),
  );

  // The Rewind gate flipped: pickers re-read the pool, and a slot that was showing
  // Rewind while it went off falls back to an unplaced card (or the slot's default).
  onSettingsChange((k) => {
    if (k !== "rewindCard") return;
    flushSwapOut();
    void collapseGrow("recompose", false);
    if (!setting("rewindCard")) {
      const slot = comp.slots.find((s) => layout[s] === "rewind");
      if (slot) {
        const used = new Set(comp.slots.map((s) => layout[s]));
        const fallback = poolFor(comp).find((c) => !used.has(c.id))?.id ?? comp.defaults[slot];
        if (fallback) layout = { ...layout, [slot]: fallback };
        saveLayout(comp, layout);
      }
    }
    decompose();
    compose();
  });
}

// Layout manager — composes the bento per SURFACE (SURFACES-AND-CARDS.md §2/§4).
//
// Now Playing is mounted once into the anchored top slot and never swapped; the CSS
// composition for each surface restyles it in place. Every other slot comes from the
// active surface's Composition: which content slots it has, which cards are anchored
// (never offered by the pickers), the default assignment, and the localStorage key it
// persists to. mini rides midi's map (CSS hides the right slot); max has its own four
// content slots plus the Queue card anchored under the stage.
//
// Swap mechanism is destroy + remount. That's safe because the picker is root-only (a
// card can only be swapped while showing its base title), so a swap never strands a
// drill — it only discards scroll position, which is negligible. A surface flip between
// compositions tears every content slot down and remounts from the new map.

import { registry, type CardDef, type CardId, type CardInstance } from "./cards";
import { setting, onSettingsChange } from "./settings-store";
import { makeDropdown } from "./dropdown";
import { onCardRequest } from "./layout-bus";
import { currentSurface, onSurfaceChange, type SurfaceName } from "./surface";

type Slot = "left" | "right" | "c" | "d";
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
  defaults: { left: "library", right: "queue" },
  queueSlot: false,
};
// max (2026-09-09, option A): stage + anchored queue on the left, a 2×2 bento on the right.
const MAX: Composition = {
  key: "deets.layout.max",
  slots: ["left", "right", "c", "d"],
  anchored: ["now-playing", "queue"],
  defaults: { left: "library", right: "search", c: "playlists", d: "history" },
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
  const npHost = document.querySelector<HTMLElement>('[data-slot="np"]');
  const npDef = registry["now-playing"];
  if (npHost && npDef) npDef.mount(npHost); // anchored in every surface; never swapped

  const hosts: Record<Slot, HTMLElement | null> = {
    left: document.querySelector<HTMLElement>('[data-slot="left"]'),
    right: document.querySelector<HTMLElement>('[data-slot="right"]'),
    c: document.querySelector<HTMLElement>('[data-slot="c"]'),
    d: document.querySelector<HTMLElement>('[data-slot="d"]'),
  };
  const queueHost = document.querySelector<HTMLElement>('[data-slot="queue"]');

  let comp: Composition = compositionFor(currentSurface());
  let layout: Assignment = loadLayout(comp);
  const mounted: Partial<Record<Slot, { inst: CardInstance; picker: SlotPicker }>> = {};
  let queueInst: CardInstance | null = null;

  // ── Slot recency — which content slot the user interacted with least recently.
  // Any pointerdown inside a slot counts (capture phase, so drills/scrolls/menus all
  // register), as does a card being swapped in. Session-only; on the launch tie the
  // LRU is the LAST slot of the composition (midi: right — queue's default home, so a
  // fresh-launch summon lands where you'd expect).
  const lastTouch: Record<Slot, number> = { left: 0, right: 0, c: 0, d: 0 };
  const touch = (slot: Slot) => { lastTouch[slot] = Date.now(); };
  (Object.keys(hosts) as Slot[]).forEach((slot) => {
    hosts[slot]?.addEventListener("pointerdown", () => touch(slot), { capture: true });
  });
  const lruSlot = (): Slot => {
    let best = comp.slots[0];
    for (const s of comp.slots) if (lastTouch[s] <= lastTouch[best]) best = s; // ties → later slot
    return best;
  };

  const mountSlot = (slot: Slot) => {
    const host = hosts[slot];
    const id = layout[slot];
    const def = id ? registry[id] : undefined;
    if (!host || !id || !def) return;
    const inst = def.mount(host);
    const picker = makePicker(slot, host, id, inst, poolFor(comp), setSlot);
    mounted[slot] = { inst, picker };
  };

  const unmountSlot = (slot: Slot) => {
    const m = mounted[slot];
    if (!m) return;
    m.picker.destroy();
    m.inst.destroy();
    delete mounted[slot];
  };

  function setSlot(slot: Slot, id: CardId): void {
    if (!comp.slots.includes(slot) || layout[slot] === id) return; // not in this composition / already here
    const other = comp.slots.find((s) => layout[s] === id);
    if (other) {
      // chosen card is in another slot → exchange the two
      const prev = layout[slot];
      unmountSlot(slot);
      unmountSlot(other);
      layout = { ...layout, [slot]: id, [other]: prev };
      mountSlot(slot);
      mountSlot(other);
    } else {
      // bring an unplaced card into this slot (the displaced card goes unplaced)
      unmountSlot(slot);
      layout = { ...layout, [slot]: id };
      mountSlot(slot);
    }
    saveLayout(comp, layout);
    touch(slot); // acting on a slot (picker or summon) makes it the freshest
  }

  const compose = () => {
    comp.slots.forEach(mountSlot);
    if (comp.queueSlot && queueHost && registry.queue) queueInst = registry.queue.mount(queueHost);
  };
  const decompose = () => {
    (Object.keys(mounted) as Slot[]).forEach(unmountSlot);
    queueInst?.destroy();
    queueInst = null;
  };

  compose();

  // A surface flip between compositions (midi/mini ↔ max) remounts the content slots
  // from the new map; mini ↔ midi share a map, so nothing remounts (CSS does the work).
  onSurfaceChange((s) => {
    const next = compositionFor(s);
    if (next === comp) return;
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
  onCardRequest((id) => {
    if (comp.anchored.includes(id)) return;
    setSlot(currentSurface() === "mini" ? "left" : lruSlot(), id);
  });

  // The Rewind gate flipped: pickers re-read the pool, and a slot that was showing
  // Rewind while it went off falls back to an unplaced card (or the slot's default).
  onSettingsChange((k) => {
    if (k !== "rewindCard") return;
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

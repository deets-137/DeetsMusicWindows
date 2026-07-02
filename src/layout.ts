// Layout manager (midi surface) — mounts Now Playing into the anchored top slot and the two
// swappable content cards into the left/right slots from a persisted assignment, and wires
// each content slot's title-as-menu picker. See docs/SURFACES-AND-CARDS.md.
//
// Swap mechanism is destroy + remount. That's safe because the picker is root-only (a card
// can only be swapped while showing its base title), so a swap never strands a drill — it
// only discards scroll position, which is negligible.

import { registry, type CardDef, type CardId, type CardInstance } from "./cards";
import { makeDropdown } from "./dropdown";
import { onCardRequest } from "./layout-bus";

type Slot = "left" | "right";
interface MidiLayout {
  left: CardId;
  right: CardId;
}

const LAYOUT_KEY = "deets.layout.midi";
const DEFAULT_LAYOUT: MidiLayout = { left: "library", right: "queue" };

/** Cards selectable in a content slot — everything except the anchored Now Playing. */
const contentCards = (): CardDef[] =>
  (Object.values(registry).filter(Boolean) as CardDef[]).filter((c) => c.id !== "now-playing");

function loadLayout(): MidiLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<MidiLayout>;
      const ids = new Set(contentCards().map((c) => c.id));
      // Must be two distinct, still-registered content cards, else fall back to default.
      if (s.left && s.right && ids.has(s.left) && ids.has(s.right) && s.left !== s.right) {
        return { left: s.left, right: s.right };
      }
    }
  } catch {
    /* corrupt prefs → default */
  }
  return { ...DEFAULT_LAYOUT };
}

function saveLayout(l: MidiLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
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
  onPick: (slot: Slot, id: CardId) => void,
): SlotPicker {
  const head = host.querySelector<HTMLElement>(".panel__head");
  const title = host.querySelector<HTMLElement>(".panel__title");
  if (!head || !title) return { destroy() {} };

  const menu = document.createElement("div");
  menu.className = "slot-picker__menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = contentCards()
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

  const dd = makeDropdown({ root: head, trigger: title, panel: menu, disabled: () => !atRoot });

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
  if (npHost && npDef) npDef.mount(npHost); // anchored; never swapped

  const hosts: Record<Slot, HTMLElement | null> = {
    left: document.querySelector<HTMLElement>('[data-slot="left"]'),
    right: document.querySelector<HTMLElement>('[data-slot="right"]'),
  };
  let layout = loadLayout();
  const mounted: Record<Slot, { inst: CardInstance; picker: SlotPicker } | null> = { left: null, right: null };

  // ── Slot recency — which content slot the user interacted with least recently.
  // Any pointerdown inside a slot counts (capture phase, so drills/scrolls/menus all
  // register), as does a card being swapped in. Session-only; on the launch tie the
  // LRU is the RIGHT slot (queue's default home, so a fresh-launch summon lands
  // where you'd expect).
  const lastTouch: Record<Slot, number> = { left: 0, right: 0 };
  const touch = (slot: Slot) => { lastTouch[slot] = Date.now(); };
  (["left", "right"] as const).forEach((slot) => {
    hosts[slot]?.addEventListener("pointerdown", () => touch(slot), { capture: true });
  });
  const lruSlot = (): Slot => (lastTouch.right <= lastTouch.left ? "right" : "left");

  const mountSlot = (slot: Slot) => {
    const host = hosts[slot];
    const def = registry[layout[slot]];
    if (!host || !def) return;
    const inst = def.mount(host);
    const picker = makePicker(slot, host, layout[slot], inst, setSlot);
    mounted[slot] = { inst, picker };
  };

  const unmountSlot = (slot: Slot) => {
    const m = mounted[slot];
    if (!m) return;
    m.picker.destroy();
    m.inst.destroy();
    mounted[slot] = null;
  };

  function setSlot(slot: Slot, id: CardId): void {
    if (layout[slot] === id) return; // already here
    const other: Slot = slot === "left" ? "right" : "left";
    if (layout[other] === id) {
      // chosen card is in the other slot → exchange the two
      const prev = layout[slot];
      unmountSlot("left");
      unmountSlot("right");
      layout = slot === "left" ? { left: id, right: prev } : { left: prev, right: id };
      mountSlot("left");
      mountSlot("right");
    } else {
      // bring an unplaced card into this slot (the displaced card goes unplaced)
      unmountSlot(slot);
      layout = slot === "left" ? { left: id, right: layout.right } : { left: layout.left, right: id };
      mountSlot(slot);
    }
    saveLayout(layout);
    touch(slot); // acting on a slot (picker or summon) makes it the freshest
  }

  mountSlot("left");
  mountSlot("right");

  // ── Summon requests (e.g. the NP card's queue button) — bring the card into the
  // LRU slot. setSlot already covers every case: unplaced card → mounts there;
  // visible in the other slot → the two exchange ("flip"); already in the LRU slot →
  // no-op. A drilled card in the target slot remounts at root — deliberate, no guard
  // (recency means a drilled slot is rarely the LRU one).
  onCardRequest((id) => {
    if (id === "now-playing") return; // anchored, never a content-slot occupant
    setSlot(lruSlot(), id);
  });
}

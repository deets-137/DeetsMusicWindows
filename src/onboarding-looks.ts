// Page 2 of the grand opening (docs/features/GRAND-OPENING.md §7): how the app is laid out.
// "Layout-Maxxing Time" (Looks- until his rename, 2026-10-22), then three columns:
//   1. The three surfaces (Mini, Midi, Max), each drawn as a small window at its open size's
//      shape with a box where each card goes. A pick switches the surface now, as the title
//      menu's Surface row does.
//   2. Layout for Max (4 cards, 2 columns, 2 rows, 1 card), drawn the same way. A pick sets
//      `maxCards`, as Settings › Window › Layout for Max does.
//   3. The cards, each with its On / Off switch in a column of its own (Settings › Cards: off =
//      out of the card picker, `hiddenCards`).
// The boxes take the skin's corners (`--ob-thumb-radius`, a share of `--panel-radius`), so
// Press draws square cards and Happy round ones. Every pick writes the setting the app reads;
// nothing here keeps a value of its own.

import { invoke } from "@tauri-apps/api/core";
import type { CardInstance } from "./cards";
import { applySurface, currentSurface, onSurfaceChange, parseSize, SIZE_KEYS, type SurfaceName } from "./surface";
import { setting, setSetting, ownSetting, effective, onSettingsChange } from "./settings-store";
import { CARD_ROWS } from "./settings-card";
import { HIDEABLE_CARDS, HIDE_LOCK_HINT, canHide, maxCardsOf, type MaxCards } from "./layout-rules";
import { startSet, setStartCards, onStartChange, type StartSet } from "./layout";
import { rowDrag } from "./row-drag";
import type { CardId } from "./cards";
import { openContextMenuUnder, MENU_CHOSEN } from "./context-menu";
import { tokenMs } from "./boot-cover";
import { motionReduced } from "./motion";
import * as diag from "./diag";

/** The words on the page (his, 2026-10-22). The title's middle word follows the size picked:
 *  Layout-Maxxing, Layout-Midiing, Layout-Miniing (§7). */
const COPY = {
  title: ["Layout-", " Time"],
  sub: "Pick out how you'd like DeetsMusic to be laid out for ya",
};
const TITLE_WORD: Record<SurfaceName, string> = { max: "Maxxing", midi: "Midiing", mini: "Miniing" };

/** The cards a place can hold that Settings › Cards does not list: they are never out of the
 *  card picker, so their Show switch stays On. Without them a place holding Settings had no row,
 *  and Start with showed 3 of Max's 4 numbers (his test, 2026-10-22). */
const ALWAYS_SHOWN: Partial<Record<CardId, { label: string; hint: string }>> = {
  queue: { label: "Queue", hint: "What plays next" },
  settings: { label: "Settings", hint: "Every setting, and the Tips" },
};
const ALWAYS_HINT = "Always in the card picker";
type Hideable = (typeof HIDEABLE_CARDS)[number];
/** Every card a place can hold, in Settings › Cards' order, then the two always shown. */
const LISTED: CardId[] = [...HIDEABLE_CARDS, ...(Object.keys(ALWAYS_SHOWN) as CardId[])];
const cardLabel = (id: CardId): string => ALWAYS_SHOWN[id]?.label ?? CARD_ROWS[id as Hideable]?.label ?? id;

const SURFACES: { id: SurfaceName; label: string; hint: string }[] = [
  { id: "mini", label: "Mini", hint: "A small window: Now Playing and one card" },
  { id: "midi", label: "Midi", hint: "The tall window: Now Playing and two cards" },
  { id: "max", label: "Max", hint: "The wide window: Now Playing, the Queue and up to four cards" },
];
/** The Settings row's own options (settings-card.ts › Layout for Max). */
const MAX_LAYOUTS: { id: MaxCards; label: string; hint: string }[] = [
  { id: "4", label: "4 cards", hint: "Max shows four cards beside Now Playing and the Queue" },
  { id: "2cols", label: "2 columns", hint: "Max shows two cards side by side" },
  { id: "2rows", label: "2 rows", hint: "Max shows two cards, one above the other" },
  { id: "1", label: "1 card", hint: "Max shows one large card" },
];

/** The boxes of one drawing: Now Playing (with its cover), the Queue, and the card cells. The
 *  grid places them by the drawing's `data-shape` (onboarding.css). `numbered`: each card box
 *  carries its place's number, the one the Start with column picks. */
function drawing(shape: string, cards: number, queue: boolean, numbered = false): string {
  const cells = ["a", "b", "c", "d"]
    .slice(0, cards)
    .map((c, i) => `<i class="onboarding__cell" data-cell="${c}">${numbered ? `<b class="onboarding__cellnum">${i + 1}</b>` : ""}</i>`)
    .join("");
  return (
    `<span class="onboarding__thumb" data-shape="${shape}" aria-hidden="true">` +
    // Now Playing: its cover and two lines of text, placed as the surface places them
    // (onboarding.css): Max's stage puts the square cover across the top; Midi's and Mini's
    // row put it on the left. Max's stage is a column of its own (Now Playing as tall as its
    // cover, the Queue under it), as the real stage is (STAGE-COLUMN.md): its rows are not
    // the cards' rows.
    (queue ? `<i class="onboarding__stage">` : "") +
    `<i class="onboarding__cell onboarding__cell--np" data-cell="np"><i class="onboarding__cover"></i><i class="onboarding__lines"></i></i>` +
    (queue ? `<i class="onboarding__cell" data-cell="q"></i></i>` : "") +
    cells +
    `</span>`
  );
}

/** The drawing's shape: the open size of that surface (Settings › Window), as an aspect ratio. */
function sizeRatio(s: SurfaceName): string {
  const size = parseSize(setting(SIZE_KEYS[s]));
  return size ? `${size.w} / ${size.h}` : "1 / 1";
}

const maxNow = (): MaxCards => maxCardsOf(effective("maxCards"));
const CARD_COUNT: Record<MaxCards, number> = { "4": 4, "2cols": 2, "2rows": 2, "1": 1 };

export function mountLooks(host: HTMLElement): CardInstance {
  host.innerHTML =
    `<div class="onboarding__sheet app-scroll">` +
    `<header class="onboarding__hello"><h1 class="onboarding__hi"><span></span><span class="onboarding__hi-word"></span><span></span></h1><p class="onboarding__sub"></p></header>` +
    `<div class="onboarding__cols">` +
    `<section class="onboarding__col" data-col="surface"><h2 class="panel__title">Size</h2><div class="onboarding__picks" data-picks="surface"></div></section>` +
    `<section class="onboarding__col" data-col="maxcards"><h2 class="panel__title">Layout</h2><div class="onboarding__picks" data-picks="maxcards"></div></section>` +
    `<section class="onboarding__col" data-col="cards"><h2 class="panel__title">Cards</h2><div class="onboarding__cardlist" role="list"></div></section>` +
    `</div></div>`;
  const [pre, word, post] = host.querySelectorAll<HTMLElement>(".onboarding__hi > span");
  pre.textContent = COPY.title[0];
  post.textContent = COPY.title[1];
  word.textContent = TITLE_WORD[currentSurface()];
  host.querySelector(".onboarding__sub")!.textContent = COPY.sub;

  /** The title's word for a new size: the old word fades out, the new one fades in, over
   *  1.5 × --nav-dur (half out, half in). Reduced motion: it changes at once. A change mid-fade
   *  starts from where the fade is. */
  let wordAnim: Animation | null = null;
  const setWord = (s: SurfaceName) => {
    const next = TITLE_WORD[s];
    if (word.textContent === next && !wordAnim) return;
    const half = (tokenMs("--nav-dur") * 1.5) / 2; // the in-card nav motion, a little slower: a gentle change
    wordAnim?.cancel();
    wordAnim = null;
    if (half <= 0 || motionReduced()) return void (word.textContent = next);
    const out = word.animate([{ opacity: Number(getComputedStyle(word).opacity) || 1 }, { opacity: 0 }], { duration: half, easing: "ease-in", fill: "forwards" });
    wordAnim = out;
    out.onfinish = () => {
      word.textContent = next;
      const back = word.animate([{ opacity: 0 }, { opacity: 1 }], { duration: half, easing: "ease-out" });
      wordAnim = back;
      out.cancel();
      back.onfinish = () => { if (wordAnim === back) wordAnim = null; };
    };
  };

  const surfaceBox = host.querySelector<HTMLElement>('[data-picks="surface"]')!;
  const maxBox = host.querySelector<HTMLElement>('[data-picks="maxcards"]')!;
  const cardList = host.querySelector<HTMLElement>(".onboarding__cardlist")!;

  const pick = (attr: string, id: string, label: string, hint: string, art: string, ratio: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "onboarding__pick";
    b.setAttribute(attr, id);
    b.setAttribute("aria-pressed", "false");
    b.title = hint;
    b.innerHTML = `${art}<span class="onboarding__pick-label"></span>`;
    b.querySelector(".onboarding__pick-label")!.textContent = label;
    b.querySelector<HTMLElement>(".onboarding__thumb")!.style.setProperty("--ob-ar", ratio);
    return b;
  };

  // 1. The surfaces. Max's drawing follows the Max layout picked in column 2.
  const paintSurfaces = () => {
    surfaceBox.replaceChildren(
      ...SURFACES.map((s) => {
        const n = maxNow();
        const art = s.id === "max" ? drawing(`max-${n}`, CARD_COUNT[n], true) : drawing(s.id, s.id === "mini" ? 1 : 2, false);
        return pick("data-surface-pick", s.id, s.label, s.hint, art, sizeRatio(s.id));
      }),
    );
    for (const b of surfaceBox.querySelectorAll<HTMLElement>("[data-surface-pick]"))
      b.setAttribute("aria-pressed", String(b.dataset.surfacePick === currentSurface()));
  };
  surfaceBox.addEventListener("click", (e) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>("[data-surface-pick]")?.dataset.surfacePick as SurfaceName | undefined;
    if (!s) return;
    diag.log("onboarding:surface", { surface: s });
    if (s !== currentSurface()) carryOrder(s, maxNow());
    // The title menu's Surface pick (main.ts), step for step: Mini opens on its cards (the Mini
    // half), and a deliberate pick pins a window the tray popped (TRAY.md). The agent's
    // `settings set surface` runs the same two calls under its own cover.
    void applySurface(s, s === "mini" ? "cards" : undefined).catch((err) => diag.warn("onboarding:surface", { e: String(err) }));
    invoke("tray_pin_main").catch(() => {});
  });

  // 2. The layout of the size picked in column 1 (his call, 2026-10-22): Max offers its four;
  //    Mini and Midi have one each, shown pressed. Each card box carries its place's number.
  const paintMax = () => {
    const s = currentSurface();
    if (s !== "max") {
      const one = s === "mini"
        ? pick("data-max-pick", "mini", "1 card", "Mini shows Now Playing and one card", drawing("mini", 1, false, true), sizeRatio("mini"))
        : pick("data-max-pick", "midi", "2 cards", "Midi shows Now Playing and two cards", drawing("midi", 2, false, true), sizeRatio("midi"));
      one.setAttribute("aria-pressed", "true");
      maxBox.replaceChildren(one);
      return;
    }
    maxBox.replaceChildren(...MAX_LAYOUTS.map((m) => pick("data-max-pick", m.id, m.label, m.hint, drawing(`max-${m.id}`, CARD_COUNT[m.id], true, true), sizeRatio("max"))));
    for (const b of maxBox.querySelectorAll<HTMLElement>("[data-max-pick]"))
      b.setAttribute("aria-pressed", String(b.dataset.maxPick === ownSetting("maxCards")));
  };
  maxBox.addEventListener("click", (e) => {
    const v = (e.target as HTMLElement).closest<HTMLElement>("[data-max-pick]")?.dataset.maxPick as MaxCards | undefined;
    if (!v || currentSurface() !== "max") return; // Mini's and Midi's one layout is not a choice
    diag.log("onboarding:maxCards", { v });
    carryOrder("max", v);
    setSetting("maxCards", v, "onboarding");
  });

  // 3. The cards: the name, the switch (its own column), then Start with — the place the card
  //    opens in, in the size and layout picked above (his calls, 2026-10-22). The count of
  //    places follows columns 1 and 2: Mini 1, Midi 2, Max 4 / 2 / 1.
  //    The list runs in place order (his call, 2026-10-22): the cards in places 1..N first, so
  //    the top rows ARE the opening set, then the rest in Settings › Cards' order. A row moved
  //    into the top N — by its Start with menu or by a drag — takes that place, and the cards
  //    under it move down a place; the one pushed past N leaves the set. The rows slide to
  //    their new places. In Max the Queue has no row: it is always beside Now Playing.
  const startNow = () => startSet(currentSurface(), maxNow());
  const placeOf = (set: StartSet, id: CardId): number => set.slots.findIndex((s) => set.cards[s] === id) + 1; // 0 = none
  const listed = (): CardId[] => LISTED.filter((id) => !(id === "queue" && currentSurface() === "max"));
  const isShown = (id: CardId) => id in ALWAYS_SHOWN || !setting("hiddenCards").includes(id);
  /** The rows' order: the placed cards in place order, then the rest. */
  const order = (set: StartSet): CardId[] => {
    const rows = listed();
    const placed = set.slots.map((s) => set.cards[s]).filter((id): id is CardId => !!id && rows.includes(id));
    return [...placed, ...rows.filter((id) => !placed.includes(id))];
  };
  /** Move `card` to row `to` (0-based) and give the places to the first N cards that can hold one. */
  const moveCard = (card: CardId, to: number) => {
    const s = currentSurface();
    const n = maxNow();
    const set = startSet(s, n);
    const rows = order(set).filter((id) => id !== card);
    rows.splice(Math.max(0, Math.min(to, rows.length)), 0, card);
    const next = rows.filter((id) => set.allowed.includes(id) && isShown(id)).slice(0, set.slots.length);
    diag.log("onboarding:start", { card, to, cards: next.join(",") });
    setStartCards(s, n, next);
  };

  /** One order on this page (his call, 2026-10-22): a size or layout picked here opens with the
   *  top rows of the list as it stands — 4 cards Home, Library, Playlists, Search, then 1 card
   *  gives Home. Written before the switch, so the new layout mounts with them (its stored map,
   *  or `setAll` when 2 columns ↔ 2 rows share one map). Elsewhere each layout keeps its own
   *  cards (MAX-CARDS.md, his call 2026-10-11). */
  const carryOrder = (s: SurfaceName, n: MaxCards) => {
    const ranking = order(startNow()).filter(isShown);
    setStartCards(s, n, ranking);
  };

  let painted = false;
  const paintCards = () => {
    const hidden = setting("hiddenCards");
    const set = startNow();
    // Where each row was, for the slide (FLIP): after the repaint each row moves from there.
    const before = new Map<string, number>();
    for (const r of cardList.querySelectorAll<HTMLElement>("[data-card]")) before.set(r.dataset.card!, r.getBoundingClientRect().top);
    const head = document.createElement("div");
    head.className = "onboarding__cardrow onboarding__cardrow--head";
    head.innerHTML =
      `<span class="onboarding__cardname"></span>` +
      `<span class="onboarding__switch onboarding__colhead">Show</span>` +
      `<span class="onboarding__start onboarding__colhead">Start with</span>`;
    cardList.replaceChildren(
      head,
      ...order(set).map((id, idx) => {
        const always = id in ALWAYS_SHOWN;
        const shown = always || !hidden.includes(id);
        const locked = always || (shown && !canHide(hidden, id));
        const place = placeOf(set, id);
        const allowed = set.allowed.includes(id);
        const row = document.createElement("div");
        row.className = "onboarding__cardrow";
        row.dataset.card = id;
        row.dataset.idx = String(idx);
        row.classList.toggle("is-placed", place > 0);
        row.classList.toggle("is-last-placed", place === set.slots.length);
        row.setAttribute("role", "listitem");
        row.innerHTML =
          `<span class="onboarding__cardname"><span class="onboarding__cardlabel"></span><span class="onboarding__cardhint"></span></span>` +
          `<span class="set__split onboarding__switch"><button class="set__half set__half--toggle" type="button" role="switch" data-card-switch="${id}" aria-checked="${shown}">${shown ? "On" : "Off"}</button></span>` +
          `<span class="set__split onboarding__start"><button class="set__half" type="button" data-card-start="${id}" aria-haspopup="menu" aria-pressed="${place > 0}">${place || "—"}</button></span>`;
        row.querySelector(".onboarding__cardlabel")!.textContent = cardLabel(id);
        row.querySelector(".onboarding__cardhint")!.textContent = ALWAYS_SHOWN[id]?.hint ?? CARD_ROWS[id as Hideable].hint();
        const sw = row.querySelector<HTMLButtonElement>("[data-card-switch]")!;
        sw.title = always ? ALWAYS_HINT : locked ? HIDE_LOCK_HINT : shown ? "Takes this card out of the card picker" : "Puts this card back in the card picker";
        sw.setAttribute("aria-disabled", String(locked));
        const st = row.querySelector<HTMLButtonElement>("[data-card-start]")!;
        const can = allowed && shown;
        st.disabled = !can;
        st.title = !allowed
          ? id === "queue" ? "Max keeps the Queue beside Now Playing" : "Max only"
          : !shown ? "Turn this card on first" : place ? `Opens in place ${place}. Pick another place` : "Picks the place this card opens in";
        return row;
      }),
    );
    // The slide: each row that moved starts where it was and travels to its new place, on the
    // in-card nav motion. The first paint and reduced motion place them at once.
    const dur = tokenMs("--nav-dur");
    if (painted && dur > 0 && !motionReduced()) {
      const ease = getComputedStyle(cardList).getPropertyValue("--nav-ease").trim() || "ease";
      for (const r of cardList.querySelectorAll<HTMLElement>("[data-card]")) {
        const was = before.get(r.dataset.card!);
        if (was === undefined) continue;
        const dy = was - r.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: dur, easing: ease });
      }
    }
    painted = true;
  };

  // A drag on a row's name moves it (the same primitive as Up Next and a playlist's rows,
  // DRAG-DROP.md §4): the insertion line shows where it lands. Only a card that can hold a
  // place moves; the switches and the Start with pill keep their clicks.
  const drag = rowDrag({
    root: cardList,
    label: "onboarding-cards",
    rowAt: (target) => {
      if (target.closest("button")) return null;
      const row = target.closest<HTMLElement>("[data-card]");
      if (!row) return null;
      const id = row.dataset.card as CardId;
      if (!startNow().allowed.includes(id) || !isShown(id)) return null;
      return { row, index: Number(row.dataset.idx), list: cardList, count: cardList.querySelectorAll("[data-card]").length, measure: true, sel: "[data-card]" };
    },
    onEnd: (from, to) => {
      if (to === null) return;
      const id = cardList.querySelector<HTMLElement>(`[data-card][data-idx="${from}"]`)?.dataset.card as CardId | undefined;
      if (id) moveCard(id, to);
    },
  });

  cardList.addEventListener("click", (e) => {
    if (drag.consumeClick()) return;
    const startBtn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-card-start]");
    if (startBtn && !startBtn.disabled) {
      const card = startBtn.dataset.cardStart as CardId;
      const set = startNow();
      const at = placeOf(set, card);
      // Places 1..N, each with the card there now under it; this card's place is ticked. A pick
      // moves the card to that row: the cards from there down move one place down.
      openContextMenuUnder(
        startBtn,
        set.slots.map((slot, i) => ({
          label: `Place ${i + 1}`,
          note: set.cards[slot] && set.cards[slot] !== card ? cardLabel(set.cards[slot]!) : undefined,
          badge: at === i + 1 ? MENU_CHOSEN : undefined,
          run: () => moveCard(card, i),
        })),
      );
      return;
    }
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-card-switch]")?.dataset.cardSwitch;
    if (!id || id in ALWAYS_SHOWN) return; // Settings and the Queue never leave the picker
    const hidden = setting("hiddenCards");
    const on = hidden.includes(id);
    if (!on && !canHide(hidden, id)) return; // the last three stay (HIDE-CARDS.md)
    diag.log("onboarding:card", { card: id, on });
    setSetting("hiddenCards", on ? hidden.filter((c) => c !== id) : [...hidden, id], "onboarding");
  });

  paintSurfaces();
  paintMax();
  paintCards();
  const offSurface = onSurfaceChange((s) => { setWord(s); paintSurfaces(); paintMax(); paintCards(); });
  const offStart = onStartChange(() => paintCards());
  const offSettings = onSettingsChange((k) => {
    if (k === "maxCards") { paintMax(); paintSurfaces(); paintCards(); }
    else if (k === "hiddenCards" || k === "rewindAutoShown") paintCards();
    else if (k === SIZE_KEYS.mini || k === SIZE_KEYS.midi || k === SIZE_KEYS.max) { paintSurfaces(); paintMax(); }
  });

  return {
    destroy() {
      wordAnim?.cancel();
      offSurface();
      offStart();
      offSettings();
      drag.destroy();
      host.replaceChildren();
    },
  };
}

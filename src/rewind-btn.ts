// The Rewind button (docs/features/listening-time.md): the Max title bar button right of the
// updates button, and its panel. His hourglass, to be redrawn by him.
//   - Today: the minutes listened since local midnight, the panel's first row. Always minutes
//     ("Today: 134 mins"); Settings › Rewind › Today's time in shows hours and minutes.
//   - Top Listens (left) and SOTD (right): each opens its list below, the panel's height
//     following it; one list at a time, and a second press closes it.
//   - Top Listens: three boxes over its list (his layout, 2026-10-21; listening-time.md §10).
//     Left: Songs · Albums · Artists. Middle: Played · Listened, a divider, and ↑ ↓ for the
//     order (the Library's Sort pop). Right: the time, Today to All time (All time first).
//     Each box remembers its last choice.
//   - SOTD: every Song of the Day pick, newest first. Hidden while Song of the Day is off.
// The rows are the Rewind card's: a plain click does nothing, the right-click carries the verbs.
// Local only: no Apple call. The numbers come from the play log (rewind.ts).

import "./styles/qcard.css";
import "./styles/rewind-top.css";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { keepRightInWindow } from "./quick-panel";
import { currentSurface } from "./surface";
import { tokenMs } from "./boot-cover";
import { setting, onSettingsChange } from "./settings-store";
import { onPlayEvent } from "./stats";
import { listenedToday, topSince, albumKey, fmtPlays, fmtListen, type RewindRow } from "./rewind";
import { fmtToday, spanBounds, rankTop, type TopSpan, type TopRank } from "./rewind-window";
import { sotdOn, allPicks, dayLabel, pickMenu, onSotdChange } from "./sotd";
import { tracks as libraryTracks } from "./track-store";
import { albumOrder, artistOrder, libAlbum } from "./library-card";
import { creditIndex } from "./artist-credit";
import { songMenu, albumMenu, artistMenu } from "./media-menu";
import { openContextMenu, type MenuItem } from "./context-menu";
import { wireListKeys } from "./list-keys";
import { artURL } from "./queue-rows";
import { ROW_PX } from "./art-size";
import * as frames from "./frames";
import * as diag from "./diag";
import type { Track } from "./library";
import { motionReduced } from "./motion";

type Part = "top" | "sotd";
type View = "songs" | "albums" | "artists";
type Dir = "desc" | "asc";

/** How many rows a list shows. The list scrolls past `--rewind-top-list-max-h`. */
const LIST_CAP = 50;
/** SOTD shows every pick, but draws them this many at a time: the first page at the press, the
 *  next as the list is scrolled near its end. 199 picks with a cover each drawn in the press
 *  held the first frame ~70 ms and the panel sat empty (title-panels-motion.json, 2026-10-19). */
const PAGE = LIST_CAP;
/** A list this close to its end (px) draws its next page. */
const PAGE_AHEAD_PX = 240;
/** The covers loaded ahead when the pointer rests on SOTD, so the first rows arrive with them. */
const WARM_COVERS = 8;
/** The Today number re-reads this often while the panel is open: the play log saves an open
 *  play's minutes every 30 s (stats.ts `checkpoint`), so the number moves while music plays. */
const TODAY_EVERY_MS = 30_000;
/** The three boxes of Top Listens. Not a setting: a per-install memory, like the card's pills. */
const STORE_KEY = "deets.rewindTop";

const VIEW_LABELS: Record<View, string> = { songs: "Songs", albums: "Albums", artists: "Artists" };
const RANK_LABELS: Record<TopRank, string> = { played: "Played", listened: "Listened" };
/** His words (2026-10-21), shortest span first. */
const SPAN_LABELS: Record<TopSpan, string> = {
  today: "Today", yesterday: "Yesterday", week: "Last week", month: "Last month", year: "Last year", all: "All time",
};
/** The empty list's line: "Nothing played <this>." */
const SPAN_EMPTY: Record<TopSpan, string> = {
  today: "today", yesterday: "yesterday", week: "in the last week", month: "in the last month", year: "in the last year", all: "yet",
};

interface Pick { view: View; by: TopRank; dir: Dir; span: TopSpan }

const reduced = () => motionReduced();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Each value on its own: one unreadable value takes its default, not the whole pick. A pick
 *  saved before the three boxes (view and order only) keeps them, ranks by plays over all time. */
const loadPick = (): Pick => {
  const pick: Pick = { view: "songs", by: "played", dir: "desc", span: "all" };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "");
    if (raw.view in VIEW_LABELS) pick.view = raw.view;
    if (raw.by in RANK_LABELS) pick.by = raw.by;
    if (raw.dir === "asc" || raw.dir === "desc") pick.dir = raw.dir;
    if (raw.span in SPAN_LABELS) pick.span = raw.span;
  } catch { /* first run, or storage unavailable */ }
  return pick;
};
const savePick = (p: Pick) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch { /* storage unavailable: the pick lasts the session */ }
};

type Box = "view" | "rank" | "span";
const BOX_GROUP: Record<Box, string> = { view: "Rank", rank: "Rank by", span: "Time" };
const DIR_PATH: Record<Dir, string> = { desc: '<path d="M6 2v8M3 7l3 3 3-3" />', asc: '<path d="M6 10V2M3 5l3-3 3 3" />' };
const dirHint = (by: TopRank, d: Dir) => `${d === "desc" ? "Most" : "Least"} ${by === "played" ? "played" : "listened"} first`;

/** One box: a panel chip with the dropdown caret, and its pop. The span box's pop hangs from its
 *  right edge, so it stays inside the panel. */
const boxHTML = (box: Box, hint: string) => `
        <div class="rewind-top__view${box === "span" ? " rewind-top__view--end" : ""}" data-rt-box="${box}">
          <button class="sound__pill rewind-top__pill" type="button" aria-haspopup="true" aria-expanded="false" title="${hint}">
            <span class="rewind-top__label" data-rt-label></span>
            <svg class="rewind-top__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
          </button>
          <div class="rewind-top__pop pop" data-frames="rewind-top-${box}" hidden></div>
        </div>`;

let dropdown: DropdownHandle | null = null;

/** Open the panel (the Compass row). In Mini and Midi the button is hidden; the Rewind card
 *  is there. */
export function openRewindPanel(): boolean {
  if (currentSurface() !== "max" || !dropdown) return false;
  dropdown.open();
  return true;
}

export function initRewindButton(): void {
  const root = document.getElementById("rewind-top");
  const btn = document.getElementById("rewind-open");
  const panel = document.getElementById("rewind-panel");
  if (!root || !btn || !panel) return;

  let pick = loadPick();
  let part: Part | null = null; // the list open now, kept across a close of the panel
  let rows: RewindRow[] = []; // the rows drawn last: the right-click resolves data-idx here
  let seq = 0; // only the latest read may draw

  panel.innerHTML = `
    <div class="rewind-top__head">Rewind</div>
    <div class="rewind-top__today" data-rt-today>Today: …</div>
    <div class="rewind-top__chips">
      <button class="sound__pill rewind-top__chip" type="button" data-rt-part="top" aria-pressed="false" title="Your most played songs, albums or artists">Top Listens</button>
      <button class="sound__pill rewind-top__chip" type="button" data-rt-part="sotd" aria-pressed="false" title="Your Songs of the Day, newest first">SOTD</button>
    </div>
    <div class="rewind-top__part" data-rt-body hidden>
      <div class="rewind-top__bar" data-rt-bar>
        ${boxHTML("view", "What Top Listens ranks")}
        ${boxHTML("rank", "Rank by plays or by minutes listened, and the order")}
        ${boxHTML("span", "The time Top Listens counts")}
      </div>
      <ol class="rewind-top__list app-scroll" data-rt-list></ol>
    </div>`;
  const todayEl = panel.querySelector<HTMLElement>("[data-rt-today]")!;
  const body = panel.querySelector<HTMLElement>("[data-rt-body]")!;
  const bar = panel.querySelector<HTMLElement>("[data-rt-bar]")!;
  const list = panel.querySelector<HTMLElement>("[data-rt-list]")!;
  const chipOf = (p: Part) => panel.querySelector<HTMLElement>(`[data-rt-part="${p}"]`)!;

  // ── the height follows the content (updates-btn.ts's shape) ──
  let grow: Animation | null = null;
  const animateHeight = (from: number) => {
    grow?.cancel();
    grow = null;
    panel.classList.remove("is-growing");
    if (panel.hidden || !from || reduced()) return;
    const to = panel.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    panel.classList.add("is-growing");
    frames.during("fold", 250, to > from ? "open" : "close");
    const a = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: tokenMs("--pop-grow"),
      easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease",
    });
    grow = a;
    a.onfinish = () => {
      if (grow !== a) return;
      grow = null;
      panel.classList.remove("is-growing");
    };
  };

  // ── Today ──
  let todayMs: number | null = null;
  const paintToday = () => {
    todayEl.textContent = `Today: ${todayMs === null ? "…" : fmtToday(todayMs, setting("rewindToday"))}`;
  };
  const readToday = () =>
    listenedToday()
      .then((ms) => { todayMs = ms; paintToday(); })
      .catch((e) => console.error("[rewind-top] today", e));

  // ── the lists ──
  const rowHTML = (r: RewindRow, i: number, meta: string) => {
    const c = artURL(r.track, ROW_PX);
    const art = c
      ? `<img class="qrow__art" src="${esc(c)}" alt="" loading="lazy" />`
      : `<div class="qrow__art qrow__art--empty" aria-hidden="true">♪</div>`;
    return (
      `<li class="qrow" data-idx="${i}">${art}<div class="qrow__text"><span class="qrow__title">${esc(r.title)}</span>` +
      `${r.subtitle ? `<span class="qrow__artist">${esc(r.subtitle)}</span>` : ""}</div>` +
      `<span class="qrow__meta">${esc(meta)}</span></li>`
    );
  };
  const topRows = async (): Promise<RewindRow[]> => {
    // The span is read at each draw, so an open panel's Today moves on at midnight.
    const { since, until } = spanBounds(pick.span);
    // A row with no song the app can still find ("Unknown") is dropped (his call, 2026-10-21):
    // least first, they filled the top of the list. The Rewind card keeps them.
    const known = (await topSince(pick.view, since, until)).filter((r) => r.track);
    return rankTop(known, pick.by, pick.dir).slice(0, LIST_CAP);
  };
  const sotdRows = (): RewindRow[] =>
    [...allPicks()]
      .sort((a, b) => b.day.localeCompare(a.day) || b.markedAt - a.markedAt)
      .map((p) => ({
        key: `pick:${p.id}`, title: p.meta.title, subtitle: p.meta.artistName,
        ms: 0, plays: 0, track: p.meta, tracks: [p.meta],
        meta: `${dayLabel(p.day)}${p.note ? ` · ${p.note}` : ""}`, pickId: p.id,
      }));

  /** The scrollbar's gutter (the Room panel's method, `measureGutters` in room-panel.ts): a list
   *  that scrolls reserves the gutter and reaches into the panel's right padding by the bar's
   *  width, so its rows keep their width whether the bar shows or not. Read right after a draw,
   *  before the paint, so no frame shows the rows move. */
  const measureGutter = () => {
    const scrolls = list.scrollHeight > list.clientHeight + 1;
    if (scrolls !== list.hasAttribute("data-scrolls")) list.toggleAttribute("data-scrolls", scrolls);
  };

  // ── the pages: a list draws `PAGE` rows, then the next as it nears its end ──
  let shown = 0;
  // The number follows the middle box: plays, or the minutes listened.
  const metaOf = (r: RewindRow) => (part !== "top" ? r.meta ?? "" : pick.by === "played" ? fmtPlays(r.plays) : fmtListen(r.ms));
  const rowsHTML = (from: number, to: number) => rows.slice(from, to).map((r, i) => rowHTML(r, from + i, metaOf(r))).join("");
  list.addEventListener("scroll", () => {
    if (shown >= rows.length || list.scrollTop + list.clientHeight < list.scrollHeight - PAGE_AHEAD_PX) return;
    const from = shown;
    shown = Math.min(rows.length, shown + PAGE);
    list.insertAdjacentHTML("beforeend", rowsHTML(from, shown));
  }, { passive: true });

  // The first SOTD covers start loading when the pointer rests on the button (or it takes the
  // focus), so the rows that slide in at the press have them. The webview keeps each one.
  const warmed = new Set<string>();
  const warming = new Set<HTMLImageElement>();
  const warmSotd = () => {
    if (part === "sotd") return;
    for (const r of sotdRows().slice(0, WARM_COVERS)) {
      const u = artURL(r.track, ROW_PX);
      if (!u || warmed.has(u)) continue;
      warmed.add(u);
      // Held until it lands: an Image nothing holds can be dropped before its download ends.
      const img = new Image();
      warming.add(img);
      img.onload = img.onerror = () => warming.delete(img);
      img.src = u;
    }
  };
  chipOf("sotd").addEventListener("pointerenter", warmSotd);
  chipOf("sotd").addEventListener("focus", warmSotd);

  /** A swap from one list to the other (his ask, 2026-10-19: no empty panel between them): a
   *  fade-through. A copy of the old part's rows in view stays over the list and fades out in
   *  the first half of `--pop-in`; then `done` lets the new rows enter. A see-through panel
   *  (Glass) showed old and new rows printed over each other when both moved at once. Only the
   *  rows in view are copied: a copy of all 50 held the press ~25 ms. */
  let ghost: HTMLElement | null = null;
  /** The copy goes, and the list it hid shows: on a newer press, a close of the part, a close
   *  of the panel. Its `done` does not run then, so this is the one way back. */
  const dropGhost = () => {
    ghost?.remove();
    ghost = null;
    body.style.visibility = "";
  };
  const fadeOld = (done: () => void): boolean => {
    dropGhost();
    if (body.hidden || reduced()) return false;
    const g = document.createElement("div");
    g.className = "rewind-top__ghost";
    g.setAttribute("aria-hidden", "true");
    g.style.top = `${body.offsetTop}px`;
    g.style.left = `${body.offsetLeft}px`;
    g.style.width = `${body.offsetWidth}px`;
    g.style.height = `${body.offsetHeight}px`;
    const top = body.getBoundingClientRect().top;
    const view = list.getBoundingClientRect();
    for (const el of [bar, ...list.children] as HTMLElement[]) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= view.top && el !== bar) continue;
      if (r.top >= view.bottom) break;
      const c = el.cloneNode(true) as HTMLElement;
      c.classList.remove("pop-enter");
      c.style.position = "absolute";
      c.style.top = `${r.top - top}px`;
      c.style.width = `${r.width}px`;
      g.appendChild(c);
    }
    panel.appendChild(g);
    ghost = g;
    const a = g.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: tokenMs("--pop-in") / 2,
      easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease",
    });
    a.onfinish = () => {
      g.remove();
      if (ghost !== g) return;
      ghost = null;
      done();
    };
    return true;
  };

  /** Draw the open part's list. `slide`: the part just opened or changed, so its rows enter;
   *  `swap`: it replaced the other part's list, which fades out over it. */
  const drawList = async (slide: boolean, swap = false) => {
    const now = part;
    const n = ++seq;
    if (!now) return;
    let next: RewindRow[];
    try {
      next = now === "top" ? await topRows() : sotdRows();
    } catch (e) {
      console.error("[rewind-top] list", e);
      next = [];
    }
    if (n !== seq || part !== now) return; // a newer press or read took over
    const from = panel.offsetHeight;
    const enter = () => { if (slide) enterRows([...(now === "top" ? [bar] : []), ...list.children]); };
    // A swap: the new rows wait, unseen, while the copy of the old ones fades out over them.
    const through = swap && fadeOld(() => {
      body.style.visibility = "";
      if (n === seq && part === now) enter();
    });
    if (through) body.style.visibility = "hidden";
    body.hidden = false;
    rows = next;
    bar.hidden = now !== "top";
    paintLabels();
    list.classList.toggle("rewind-top__round", now === "top" && pick.view === "artists");
    shown = Math.min(rows.length, PAGE);
    list.innerHTML = rows.length
      ? rowsHTML(0, shown)
      : `<li class="rewind-top__empty">${now === "top" ? `Nothing played ${SPAN_EMPTY[pick.span]}.` : "No Songs of the Day yet."}</li>`;
    measureGutter();
    if (!through) enter();
    animateHeight(from);
  };

  /** A part's close (his ask, 2026-10-19: the list slides out): the list fades while the panel's
   *  height closes over it, both on `--pop-grow` and `--pop-ease`, and it is hidden at the end.
   *  It was hidden at once, and the empty panel then shrank. Both hold their last frame
   *  (`fill: forwards`) until the hide, so no frame shows the full list at the end. */
  let leaving: Animation[] = [];
  const stopLeaving = (hide: boolean) => {
    if (!leaving.length) return;
    if (hide) body.hidden = true;
    for (const a of leaving) a.cancel();
    leaving = [];
    panel.classList.remove("is-growing");
  };
  const slideOut = (from: number) => {
    grow?.cancel();
    grow = null;
    stopLeaving(false);
    if (panel.hidden || reduced()) {
      body.hidden = true;
      return;
    }
    body.hidden = true;
    const to = panel.offsetHeight;
    body.hidden = false;
    if (Math.abs(to - from) < 1) {
      body.hidden = true;
      return;
    }
    panel.classList.add("is-growing");
    frames.during("fold", 250, "close");
    const opts: KeyframeAnimationOptions = {
      duration: tokenMs("--pop-grow"),
      easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease",
      fill: "forwards",
    };
    const h = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], opts);
    const o = body.animate([{ opacity: 1 }, { opacity: 0 }], opts);
    leaving = [h, o];
    h.onfinish = () => { if (leaving.includes(h)) stopLeaving(true); };
  };

  /** Open a part, or close it when it is the open one (a second press). */
  const togglePart = (p: Part) => {
    const from = panel.offsetHeight;
    const swap = part !== null && part !== p;
    part = part === p ? null : p;
    for (const q of ["top", "sotd"] as Part[]) chipOf(q).setAttribute("aria-pressed", String(part === q));
    diag.log("rewindTop:part", { part });
    if (!part) {
      seq++;
      closeBoxes();
      dropGhost();
      slideOut(from);
      return;
    }
    stopLeaving(false); // a press during the slide-out keeps the list
    // The part shows in drawList, with its rows: shown here, Top Listens' bar painted empty while
    // its rows were read, then blinked out as its entry began (2026-10-19).
    void drawList(true, swap);
  };
  panel.addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest<HTMLElement>("[data-rt-part]")?.dataset.rtPart as Part | undefined;
    if (p) togglePart(p);
  });

  // ── the three boxes (each the Library's Sort pop: choices; the middle one adds a divider and ↑ ↓) ──
  const optsHTML = <K extends string>(box: Box, labels: Record<K, string>, now: K) =>
    `<div class="lib-pop__col" role="group" aria-label="${BOX_GROUP[box]}">${(Object.keys(labels) as K[])
      .map((k) => `<button class="lib-pop__opt${k === now ? " is-active" : ""}" type="button" data-rt-${box}="${k}">${labels[k]}</button>`)
      .join("")}</div>`;
  const popHTML = (box: Box) => {
    if (box === "view") return `<div class="lib-pop__cols">${optsHTML(box, VIEW_LABELS, pick.view)}</div>`;
    if (box === "span") return `<div class="lib-pop__cols">${optsHTML(box, SPAN_LABELS, pick.span)}</div>`;
    const dirs = (["desc", "asc"] as Dir[])
      .map((d) => {
        const hint = dirHint(pick.by, d);
        return `<button class="lib-pop__dir${d === pick.dir ? " is-active" : ""}" type="button" data-rt-dir="${d}" aria-label="${hint}" title="${hint}"><svg viewBox="0 0 12 12" aria-hidden="true">${DIR_PATH[d]}</svg></button>`;
      })
      .join("");
    return `<div class="lib-pop__cols">${optsHTML(box, RANK_LABELS, pick.by)}<div class="lib-pop__col lib-pop__col--dir" role="group" aria-label="Order">${dirs}</div></div>`;
  };
  const boxes = (["view", "rank", "span"] as Box[]).map((box) => {
    const wrap = panel.querySelector<HTMLElement>(`[data-rt-box="${box}"]`)!;
    const pop = wrap.querySelector<HTMLElement>(".rewind-top__pop")!;
    const drop = makeDropdown({
      root: wrap,
      trigger: wrap.querySelector<HTMLElement>(".rewind-top__pill")!,
      panel: pop,
      onOpen: () => {
        pop.innerHTML = popHTML(box);
        enterRows(pop.querySelectorAll(".lib-pop__opt, .lib-pop__dir"));
      },
    });
    pop.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!t) return;
      const d = t.dataset;
      const next: Pick = {
        view: (d.rtView as View | undefined) ?? pick.view,
        by: (d.rtRank as TopRank | undefined) ?? pick.by,
        dir: (d.rtDir as Dir | undefined) ?? pick.dir,
        span: (d.rtSpan as TopSpan | undefined) ?? pick.span,
      };
      e.stopPropagation(); // a choice keeps the pop open, as the Library's Sort pop does
      if (next.view === pick.view && next.by === pick.by && next.dir === pick.dir && next.span === pick.span) return;
      pick = next;
      savePick(pick);
      pop.innerHTML = popHTML(box);
      diag.log("rewindTop:view", { ...pick });
      void drawList(true);
    });
    return { box, drop, wrap };
  });
  const closeBoxes = () => { for (const b of boxes) b.drop.close(); };
  /** The pills read the pick: the view, the rank with its arrow, the span. */
  function paintLabels() {
    for (const { box, wrap } of boxes) {
      const label = wrap.querySelector<HTMLElement>("[data-rt-label]")!;
      if (box === "view") label.textContent = VIEW_LABELS[pick.view];
      else if (box === "span") label.textContent = SPAN_LABELS[pick.span];
      else label.innerHTML = `${RANK_LABELS[pick.by]}<svg class="rewind-top__dir" viewBox="0 0 12 12" aria-label="${dirHint(pick.by, pick.dir)}">${DIR_PATH[pick.dir]}</svg>`;
    }
  }

  // ── right-click: the Rewind card's menus ──
  const albumTracksOf = (r: RewindRow): Track[] => {
    const lib = libraryTracks().filter((t) => albumKey(t) === r.key);
    return albumOrder(lib.length ? lib : r.tracks);
  };
  const menuFor = (r: RewindRow): MenuItem[] | null => {
    if (part === "sotd") {
      const p = r.pickId ? allPicks().find((x) => x.id === r.pickId) : undefined;
      return r.tracks[0] ? songMenu(r.tracks[0], { context: p ? "picks" : "rewind", own: p ? pickMenu(p) : [] }) : null;
    }
    if (pick.view === "songs") return r.tracks[0] ? songMenu(r.tracks[0], { context: "rewind" }) : null;
    if (pick.view === "albums") return r.tracks.length ? albumMenu(libAlbum(albumTracksOf(r), `album:${r.key}`), { context: `album:${r.key}` }) : null;
    const songs = artistOrder(creditIndex(libraryTracks()).tracksFor(r.title));
    return artistMenu(
      { name: r.title, songs: songs.length ? songs : r.tracks, inLibrary: songs.length > 0, artwork: songs[0]?.artwork },
      { context: `artist:${r.title}` },
    );
  };
  list.addEventListener("contextmenu", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    const r = el ? rows[Number(el.dataset.idx)] : undefined;
    const items = r ? menuFor(r) : null;
    if (!el || !items?.length) return; // an "Unknown" row: nothing to play
    e.preventDefault();
    el.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => el.classList.remove("is-context"));
  });
  // Arrows, Home / End and the Menu key (list-keys.ts). A plain click does nothing, as on the
  // Rewind card, so Enter does nothing too.
  wireListKeys(list, { rows: "[data-idx]", activate: false });

  // ── follow the log, the setting and the picks ──
  let tick = 0;
  onPlayEvent(() => {
    if (panel.hidden) return;
    void readToday();
    if (part === "top") void drawList(false);
  });
  onSettingsChange((key) => { if (key === "rewindToday") paintToday(); });
  const paintSotd = () => {
    const on = sotdOn();
    chipOf("sotd").hidden = !on;
    if (!on && part === "sotd") togglePart("sotd");
    else if (part === "sotd" && !panel.hidden) void drawList(false);
  };
  onSotdChange(paintSotd);
  paintSotd();
  paintToday();
  // Read once at start, so the first open shows the minutes, not "Today: …" for a frame or two
  // (2026-10-19). Each open reads again; the panel shows the last number until then.
  void readToday();

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    // The right-click menu is portaled to <body>.
    alsoInside: () => [...document.querySelectorAll(".ctx-menu")],
    onOpen: () => {
      keepRightInWindow(root, panel);
      void readToday();
      if (sotdOn()) warmSotd(); // the first SOTD covers, before a press can ask for them
      if (part) void drawList(false);
      enterRows([...panel.children].filter((el) => !(el as HTMLElement).hidden));
      window.clearInterval(tick);
      tick = window.setInterval(() => {
        if (panel.hidden) return window.clearInterval(tick);
        void readToday();
      }, TODAY_EVERY_MS);
      diag.log("rewindTop:open", { part });
    },
  });
  // The panel's close closes the boxes' pops with it.
  new MutationObserver(() => {
    if (!panel.hidden) return;
    closeBoxes();
    dropGhost(); // a swap's fading copy goes with the panel
    stopLeaving(true); // and a slide-out ends where it was going
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  // The hourglass turns a half turn at each open and each close, by any path (his ask,
  // 2026-10-19), always the same way, so it keeps flipping as a real one would. The angle only
  // grows; the CSS transition on --rewind-top-angle does the motion. A close of a panel that
  // was already shut sets `hidden` again, so only a real change turns it.
  let angle = 0;
  let shut = panel.hidden;
  new MutationObserver(() => {
    if (panel.hidden === shut) return;
    shut = panel.hidden;
    angle += 180;
    btn.style.setProperty("--rewind-top-angle", `${angle}deg`);
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", () => { if (!panel.hidden) keepRightInWindow(root, panel); });
}

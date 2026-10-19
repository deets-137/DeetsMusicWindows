// The Rewind button (docs/features/listening-time.md): the Max title bar button right of the
// updates button, and its panel. His hourglass, to be redrawn by him.
//   - Today: the minutes listened since local midnight, the panel's first row. Always minutes
//     ("Today: 134 mins"); Settings › Rewind › Today's time in shows hours and minutes.
//   - Top Listens (left) and SOTD (right): each opens its list below, the panel's height
//     following it; one list at a time, and a second press closes it.
//   - Top Listens: the whole play log, most played first. Its view dropdown is the Library's
//     Sort pop: Songs · Albums · Artists, a divider, and ↑ ↓ for the order.
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
import { listenedToday, topSince, albumKey, fmtPlays, type RewindRow } from "./rewind";
import { fmtToday } from "./rewind-window";
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

type Part = "top" | "sotd";
type View = "songs" | "albums" | "artists";
type Dir = "desc" | "asc";

/** How many rows a list shows. The list scrolls past `--rewind-top-list-max-h`. */
const LIST_CAP = 50;
/** The Today number re-reads this often while the panel is open: the play log saves an open
 *  play's minutes every 30 s (stats.ts `checkpoint`), so the number moves while music plays. */
const TODAY_EVERY_MS = 30_000;
/** The view and order of Top Listens. Not a setting: a per-install memory, like the card's pills. */
const STORE_KEY = "deets.rewindTop";

const VIEW_LABELS: Record<View, string> = { songs: "Songs", albums: "Albums", artists: "Artists" };

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const loadPick = (): { view: View; dir: Dir } => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "");
    if (raw.view in VIEW_LABELS && (raw.dir === "asc" || raw.dir === "desc")) return raw;
  } catch { /* first run, or storage unavailable */ }
  return { view: "songs", dir: "desc" };
};
const savePick = (p: { view: View; dir: Dir }) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch { /* storage unavailable: the pick lasts the session */ }
};

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
      <button class="rewind-top__chip" type="button" data-rt-part="top" aria-pressed="false" title="Your most played songs, albums or artists">Top Listens</button>
      <button class="rewind-top__chip" type="button" data-rt-part="sotd" aria-pressed="false" title="Your Songs of the Day, newest first">SOTD</button>
    </div>
    <div class="rewind-top__part" data-rt-body hidden>
      <div class="rewind-top__bar" data-rt-bar>
        <div class="rewind-top__view">
          <button class="lib-pill rewind-top__pill" type="button" aria-haspopup="true" aria-expanded="false" title="What Top Listens ranks, and its order">
            <span class="lib-pill__label" data-rt-label></span>
            <svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
          </button>
          <div class="rewind-top__pop pop" data-rt-pop data-frames="rewind-top-view" hidden></div>
        </div>
        <span class="rewind-top__what" data-rt-what></span>
      </div>
      <ol class="rewind-top__list app-scroll" data-rt-list></ol>
    </div>`;
  const todayEl = panel.querySelector<HTMLElement>("[data-rt-today]")!;
  const body = panel.querySelector<HTMLElement>("[data-rt-body]")!;
  const bar = panel.querySelector<HTMLElement>("[data-rt-bar]")!;
  const list = panel.querySelector<HTMLElement>("[data-rt-list]")!;
  const label = panel.querySelector<HTMLElement>("[data-rt-label]")!;
  const what = panel.querySelector<HTMLElement>("[data-rt-what]")!;
  const viewWrap = panel.querySelector<HTMLElement>(".rewind-top__view")!;
  const pill = panel.querySelector<HTMLElement>(".rewind-top__pill")!;
  const pop = panel.querySelector<HTMLElement>("[data-rt-pop]")!;
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
    const all = await topSince(pick.view, 0);
    // Most played: plays first, then minutes (his words, 2026-10-19). ↑ turns the whole order.
    all.sort((a, b) => b.plays - a.plays || b.ms - a.ms || a.title.localeCompare(b.title));
    if (pick.dir === "asc") all.reverse();
    return all.slice(0, LIST_CAP);
  };
  const sotdRows = (): RewindRow[] =>
    [...allPicks()]
      .sort((a, b) => b.day.localeCompare(a.day) || b.markedAt - a.markedAt)
      .map((p) => ({
        key: `pick:${p.id}`, title: p.meta.title, subtitle: p.meta.artistName,
        ms: 0, plays: 0, track: p.meta, tracks: [p.meta],
        meta: `${dayLabel(p.day)}${p.note ? ` · ${p.note}` : ""}`, pickId: p.id,
      }));

  /** Draw the open part's list. `slide`: the part just opened or changed, so its rows enter. */
  const drawList = async (slide: boolean) => {
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
    rows = next;
    bar.hidden = now !== "top";
    label.textContent = VIEW_LABELS[pick.view];
    what.textContent = pick.dir === "desc" ? "Most played" : "Least played";
    list.classList.toggle("rewind-top__round", now === "top" && pick.view === "artists");
    list.innerHTML = rows.length
      ? rows.map((r, i) => rowHTML(r, i, now === "top" ? fmtPlays(r.plays) : r.meta ?? "")).join("")
      : `<li class="rewind-top__empty">${now === "top" ? "Nothing played yet." : "No Songs of the Day yet."}</li>`;
    if (slide) enterRows([...(now === "top" ? [bar] : []), ...list.children]);
    animateHeight(from);
  };

  /** Open a part, or close it when it is the open one (a second press). */
  const togglePart = (p: Part) => {
    const from = panel.offsetHeight;
    part = part === p ? null : p;
    for (const q of ["top", "sotd"] as Part[]) chipOf(q).setAttribute("aria-pressed", String(part === q));
    diag.log("rewindTop:part", { part });
    if (!part) {
      seq++;
      viewDrop.close();
      body.hidden = true;
      animateHeight(from);
      return;
    }
    body.hidden = false;
    void drawList(true);
  };
  panel.addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest<HTMLElement>("[data-rt-part]")?.dataset.rtPart as Part | undefined;
    if (p) togglePart(p);
  });

  // ── the view dropdown (the Library's Sort pop: choices, a divider, ↑ ↓) ──
  const popHTML = () => {
    const opts = (Object.keys(VIEW_LABELS) as View[])
      .map((v) => `<button class="lib-pop__opt${v === pick.view ? " is-active" : ""}" type="button" data-rt-view="${v}">${VIEW_LABELS[v]}</button>`)
      .join("");
    const dirs = (["desc", "asc"] as Dir[])
      .map(
        (d) =>
          `<button class="lib-pop__dir${d === pick.dir ? " is-active" : ""}" type="button" data-rt-dir="${d}" aria-label="${
            d === "desc" ? "Most played first" : "Least played first"
          }" title="${d === "desc" ? "Most played first" : "Least played first"}"><svg viewBox="0 0 12 12" aria-hidden="true">${
            d === "desc" ? '<path d="M6 2v8M3 7l3 3 3-3" />' : '<path d="M6 10V2M3 5l3-3 3 3" />'
          }</svg></button>`,
      )
      .join("");
    return `<div class="lib-pop__cols"><div class="lib-pop__col" role="group" aria-label="Rank">${opts}</div><div class="lib-pop__col lib-pop__col--dir" role="group" aria-label="Order">${dirs}</div></div>`;
  };
  const viewDrop = makeDropdown({
    root: viewWrap,
    trigger: pill,
    panel: pop,
    onOpen: () => {
      pop.innerHTML = popHTML();
      enterRows(pop.querySelectorAll(".lib-pop__opt, .lib-pop__dir"));
    },
  });
  pop.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLElement>("[data-rt-view]")?.dataset.rtView as View | undefined;
    const d = t.closest<HTMLElement>("[data-rt-dir]")?.dataset.rtDir as Dir | undefined;
    if (!v && !d) return;
    e.stopPropagation(); // a choice keeps the pop open, as the Library's Sort pop does
    pick = { view: v ?? pick.view, dir: d ?? pick.dir };
    savePick(pick);
    pop.innerHTML = popHTML();
    diag.log("rewindTop:view", pick);
    void drawList(true);
  });

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

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    // The right-click menu is portaled to <body>.
    alsoInside: () => [...document.querySelectorAll(".ctx-menu")],
    onOpen: () => {
      keepRightInWindow(root, panel);
      void readToday();
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
  // The panel's close closes the view pop with it.
  new MutationObserver(() => { if (panel.hidden) viewDrop.close(); }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", () => { if (!panel.hidden) keepRightInWindow(root, panel); });
}

// Diary card (docs/features/DIARY.md) — an album journal. Pick an album, listen, and keep a
// note and a score for each song and for the album.
//
// Two views, the card's own (not the collection engine: the entry keeps a note panel fixed
// at its foot, fork 6B, and the engine scrolls the whole pane):
//  • Root (fork 4A): the + cover, which opens the album picker in place (5A), and a shelf of
//    past entries under it, the newest touched first.
//  • Entry: the hero, the album's score, scale and review date, the album note, Play /
//    Shuffle, the songs — and the foot panel for ONE song: the song that plays, or the row
//    you click (6B).
// Three ways in: the picker (5A), an album dropped on the card (5B), Add to Diary on any
// album's menu (5C, layout-bus `requestDiaryAlbum`).
//
// A score is the number the user typed (7B). A scale change never rescales by itself:
// Settings › Diary › Rescale scores decides — Ask (a toast), Always, Never.

import "./styles/qcard.css";
import "./styles/diary.css";
import type { CardDef, CardInstance, MountOpts } from "./cards";
import type { Track } from "./library";
import type { Album } from "./search";
import { searchCatalog, collectionTracks, materializeTrack } from "./search";
import { tracks as storeTracks, addTransientTracks } from "./track-store";
import { albumKey } from "./rewind";
import { albumOrder, heroCover } from "./library-card";
import { esc, actionsRowHTML, runListAction } from "./collection-card";
import { openContextMenu, openContextMenuUnder, MENU_CHOSEN, type MenuItem, type ActionItem } from "./context-menu";
import { albumMenu, songMenu } from "./media-menu";
import { growCardTaller, isGrownCard, collapseGrow } from "./card-grow";
import { playTracks } from "./player";
import * as queue from "./queue";
import { registerDropTarget, rowDrag, type DragPayload } from "./row-drag";
import { takeDiaryAlbum, onDiaryAlbum, takeDiaryEntry, onDiaryEntry, type DiaryRequest } from "./layout-bus";
import { enterRows } from "./pop";
import { toast } from "./toast";
import { setting } from "./settings-store";
import { unreleasedHint, unreleasedToast } from "./release";
import * as diag from "./diag";
import {
  diaryList, diaryGet, diaryOpen, diaryUpdate, diarySongSet, diaryRescale, diaryDelete, onDiaryChange,
  songKeyOf, parseScore, fmtNum, fmtScore, fmtDay, today,
  diarySetDone, diaryFolders, diaryFolderCreate, diaryFolderRename, diaryFolderDelete, diaryFile,
  copyDiaryExport, onDiaryOutside, withAlbumId,
  type DiaryEntry, type DiarySummary, type DiarySong, type DiaryFolder,
} from "./diary";
import { sortByOrder, moveTo, writeOrder, onRowOrderChange, sectionsMovable, holdFor } from "./row-order";

const COLLAPSE_KEY = "deets.diary.collapsed";
/** The rows the user folded shut (a view preference, as the Playlists folds are). */
function loadCollapsed(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

const TILE_PX = 240;
const ROW_PX = 72;
const PICK_DEBOUNCE_MS = 300;
const PICK_LIB_CAP = 8;
const PICK_CAT_CAP = 10;
const NOTE_SAVE_MS = 600;
/** The scale presets (fork 7). Any other top is typed into the menu's field. */
const SCALES = [5, 10, 100];

const art = (tmpl: string | undefined, px: number): string | null =>
  tmpl ? tmpl.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;
const coverHTML = (url: string | null, cls: string): string =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`
    : `<div class="${cls} ${cls}--empty" aria-hidden="true">♪</div>`;

const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>';
const ICON_PLAY ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
const ICON_NOTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10M3 6.5h10M3 10h6" /></svg>';
const ICON_SEARCH = '<svg class="search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>';
const ICON_CLEAR =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CARET = '<svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>';

/** What a pick, a drop or a menu hands the card before the songs are known. */
interface AlbumIn {
  album: Album;
  tracks: () => Track[] | Promise<Track[]>;
}

/** The Album shape diary.rs stores (genres is required there). */
const albumOf = (a: DiaryRequest["album"]): Album => ({
  title: a.title,
  artistName: a.artistName,
  artwork: a.artwork,
  catalogId: a.catalogId,
  libraryId: a.libraryId,
  releaseDate: a.releaseDate,
  genres: [],
});

/** The user's library albums (the Library card's album rule: name + cover), for the picker. */
function libraryAlbums(): { album: Album; tracks: Track[] }[] {
  const groups = new Map<string, Track[]>();
  for (const t of storeTracks()) {
    if (!t.libraryId) continue; // a catalog song the app only saw played is not "your library"
    const k = albumKey(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  return [...groups.values()].map((ts) => {
    const t0 = ts[0];
    return {
      album: { title: t0.albumName ?? "Unknown Album", artistName: t0.artistName, artwork: t0.artwork, genres: [], releaseDate: t0.releaseDate },
      tracks: albumOrder(ts),
    };
  });
}

export const diaryCard: CardDef = {
  id: "diary",
  title: "Diary",
  mount: (host, opts) => mountDiary(host, opts),
};

function mountDiary(host: HTMLElement, opts?: MountOpts): CardInstance {
  host.innerHTML = `
    <header class="panel__head">
      <button class="panel__back" id="diary-back" type="button" aria-label="Back" title="Goes back one step" hidden>${ICON_BACK}</button>
      <h2 class="panel__title">Diary</h2>
      <button class="panel__action" id="diary-add" type="button" aria-label="New" aria-haspopup="true" title="Starts a new entry or makes a new folder">${ICON_PLUS}</button>
      <button class="panel__action" id="diary-done" type="button" aria-pressed="false" hidden>${ICON_CHECK}</button>
    </header>
    <div class="panel__body diary"></div>`;
  const backEl = host.querySelector<HTMLButtonElement>("#diary-back")!;
  const addBtn = host.querySelector<HTMLButtonElement>("#diary-add")!;
  const doneBtn = host.querySelector<HTMLButtonElement>("#diary-done")!;
  const titleEl = host.querySelector<HTMLElement>(".panel__title")!;
  const body = host.querySelector<HTMLElement>(".diary")!;

  let entry: DiaryEntry | null = null;
  let list: DiarySummary[] = [];
  let picking = false;
  let pickTerm = "";
  let pickSeq = 0; // stale-search guard: only the latest Apple search may draw
  let rootSeq = 0; // stale-list guard for the root
  /** The song the foot panel shows (6B), by song key. */
  let selKey: string | null = null;
  /** A song change that waits while the user is typing in the foot. */
  let pendingSel: string | null = null;
  let destroyed = false;
  /** The open entry grew the card itself (Grow on open), so Back may collapse it. */
  let grewForEntry = false;
  const headerSubs = new Set<(h: { title: string; atRoot: boolean }) => void>();

  const setHeader = () => {
    const atRoot = !entry;
    // His call (2026-09-24): "Diary: <album name>" while an entry is open. The title's own
    // ellipsis cuts a long name, so the header never wraps.
    titleEl.textContent = atRoot || !entry ? "Diary" : `Diary: ${entry.album.title}`;
    titleEl.title = atRoot ? "" : titleEl.textContent;
    backEl.hidden = atRoot;
    // The + is the home page's (new entry, new folder); the check is the entry's (Done).
    addBtn.hidden = !atRoot;
    doneBtn.hidden = atRoot;
    paintDone();
    headerSubs.forEach((cb) => cb({ title: titleEl.textContent ?? "Diary", atRoot }));
  };

  // ── the root: the + cover (or the picker), then the rows (DIARY.md §9) ─────────
  // Two built-in rows drawn from Done — In progress, Completed — then the user's folders,
  // oldest first. His calls (2026-09-24): the two status rows always show EVERY entry, and a
  // folder is an extra group (an entry filed in one shows there too). Every row header moves
  // by hold; a new folder starts at the end. Tiles move inside a row, and into another row.
  let folders: DiaryFolder[] = [];
  interface Row { key: string; label: string; folderId?: number; items: DiarySummary[]; empty: string }
  let rows: Row[] = [];
  const collapsed = loadCollapsed();
  const rowScope = (key: string) => `diary.row:${key}` as const;

  const buildRows = (): Row[] => {
    const byRow = (key: string, xs: DiarySummary[]) => sortByOrder(rowScope(key), xs, (s) => String(s.id));
    const built: Row[] = [
      { key: "progress", label: "In progress", items: byRow("progress", list.filter((s) => !s.doneAt)), empty: "Nothing in progress. Add an album to start" },
      { key: "done", label: "Completed", items: byRow("done", list.filter((s) => s.doneAt)), empty: "Press the check on an entry when you finish it" },
      ...folders.map((f) => ({
        key: `folder:${f.id}`,
        label: f.name,
        folderId: f.id,
        items: byRow(`folder:${f.id}`, list.filter((s) => s.folderId === f.id)),
        empty: "Drag an entry here, or right-click one › Move to Folder",
      })),
    ];
    return sortByOrder("diary.sections", built, (r) => r.key);
  };

  const tileHTML = (s: DiarySummary, i: number, row: Row): string => {
    const score = fmtScore(s.score, s.scaleMax);
    const done = s.songCount ? `${s.songsDone} of ${s.songCount} songs` : "";
    const sub = [score, done].filter(Boolean).join(" · ") || s.album.artistName;
    // In a folder row, a finished entry wears a check (the status rows say it already).
    const badge = row.folderId != null && s.doneAt ? `<span class="search__tile-badge diary__tile-done" aria-label="Completed">${ICON_CHECK}</span>` : "";
    return `<div class="search__tile" data-entry="${s.id}" data-tile data-tile-idx="${i}" role="button" tabindex="0" title="${esc(`${s.album.title} — ${s.album.artistName}`)}">
      ${coverHTML(art(s.album.artwork?.urlTemplate, TILE_PX), "search__tile-art")}${badge}
      <span class="search__tile-name">${esc(s.album.title)}</span><span class="search__tile-sub">${esc(sub)}</span>
    </div>`;
  };
  const rowHTML = (r: Row, i: number): string => {
    const shut = collapsed.has(r.key);
    const hint = sectionsMovable() ? "Click to open or close. Hold to move this row. New folders appear at the end" : "Click to open or close";
    const head =
      `<div class="lib-shelf lib-shelf--toggle${shut ? " is-collapsed" : ""}" data-sec-head title="${esc(hint)}">` +
      `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
      `<span>${esc(r.label)}</span><span class="lib-shelf__count">${r.items.length}</span></div>`;
    const body = shut
      ? ""
      : r.items.length
        ? `<div class="search__scroller diary__shelf" data-shelf-key="${esc(r.key)}">${r.items.map((s, j) => tileHTML(s, j, r)).join("")}</div>`
        : `<div class="diary__shelf diary__shelf--empty" data-shelf-key="${esc(r.key)}"><p class="qcard__empty">${esc(r.empty)}</p></div>`;
    return `<section class="diary__sec" data-sec="${esc(r.key)}" data-sec-idx="${i}">${head}${body}</section>`;
  };
  const newHTML = () =>
    `<button class="diary__new" type="button" data-new title="Pick an album to write about">
      <span class="diary__new-art">${ICON_PLUS}</span><span class="diary__new-label">Add an album</span>
    </button>`;
  const pickerHTML = () =>
    `<div class="diary__pick">
      <div class="search__field">
        ${ICON_SEARCH}
        <input class="search__input" type="search" placeholder="Find an album or an artist" spellcheck="false" data-pick-input value="${esc(pickTerm)}" />
        <button class="search__clear" type="button" data-pick-close aria-label="Close" title="Closes the album search">${ICON_CLEAR}</button>
      </div>
      <div class="diary__results" data-pick-results><p class="qcard__empty">Type an album or an artist. Your library shows first, then Apple Music.</p></div>
    </div>`;

  const renderRoot = () => {
    const seq = ++rootSeq;
    Promise.all([diaryList(), diaryFolders()])
      .then(([l, fs]) => {
        if (destroyed || entry || seq !== rootSeq) return;
        list = l;
        folders = fs;
        rows = buildRows();
        const keepScroll = body.querySelector<HTMLElement>(".diary__root")?.scrollTop ?? 0;
        const lead = l.length ? "" : `<p class="qcard__empty">Pick an album, listen, and write about each song.</p>`;
        body.innerHTML =
          `<div class="diary__root app-scroll">${picking ? pickerHTML() : newHTML()}${lead}` +
          `<div class="diary__secs" data-secs>${rows.map(rowHTML).join("")}</div></div>`;
        const rootEl = body.querySelector<HTMLElement>(".diary__root");
        if (rootEl) rootEl.scrollTop = keepScroll;
        if (picking) {
          const input = body.querySelector<HTMLInputElement>("[data-pick-input]")!;
          input.focus();
          if (pickTerm) runPick(pickTerm);
        }
      })
      .catch((e) => {
        console.error("[diary] list", e);
        body.innerHTML = `<p class="qcard__empty">Couldn't read your Diary.</p>`;
      });
  };

  // The picker (5A): the library first (zero Apple calls), then Apple Music (one search).
  let pickTimer = 0;
  let pickFound: AlbumIn[] = [];
  const pickRow = (a: Album, i: number, sub: string) =>
    `<div class="search__row" data-pick="${i}" role="button" tabindex="0">
      ${coverHTML(art(a.artwork?.urlTemplate, ROW_PX), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(a.title)}</span><span class="search__song-artist">${esc(sub)}</span></div>
    </div>`;
  // One finder for both searches (the home page's field and the + menu's New entry): your
  // library first, at zero Apple calls, then one catalog search.
  const libMatches = (q: string) =>
    libraryAlbums()
      .filter((x) => x.album.title.toLowerCase().includes(q) || x.album.artistName.toLowerCase().includes(q))
      .slice(0, PICK_LIB_CAP);
  const catMatches = (term: string): Promise<Album[]> =>
    searchCatalog(term.trim(), ["albums"]).then((r) => r.albums.filter((a) => a.catalogId).slice(0, PICK_CAT_CAP));
  const catIn1 = (a: Album): AlbumIn => ({ album: { ...a, genres: [] }, tracks: () => collectionTracks("albums", a.catalogId ?? "") });

  /** The + menu's New entry field (his ask, 2026-09-24): the Playlists + look — a labelled
   *  field — and it searches as you type; the menu grows downward with the answers. Enter
   *  opens the first answer. */
  let menuFirst: AlbumIn | null = null;
  const menuSearch = (v: string, show: (rows: ActionItem[] | string) => void) => {
    const q = v.toLowerCase();
    const row = (a: AlbumIn, note: string): ActionItem => ({
      label: a.album.title,
      note,
      art: art(a.album.artwork?.urlTemplate, ROW_PX) ?? undefined,
      run: () => openAlbum(a, "menu-search"),
    });
    const lib = libMatches(q).map((x) => ({ album: x.album, tracks: () => x.tracks }) as AlbumIn);
    const libRows = lib.map((a) => row(a, `${a.album.artistName} · In your library`));
    menuFirst = lib[0] ?? null;
    show(libRows.length ? libRows : "Searching Apple Music…");
    catMatches(v)
      .then((cat) => {
        const catRows = cat.map((a) => row(catIn1(a), [a.artistName, a.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")));
        menuFirst ??= cat[0] ? catIn1(cat[0]) : null;
        const all = [...libRows, ...catRows];
        show(all.length ? all : "No album found.");
      })
      .catch((e) => {
        console.warn("[diary] menu search", e);
        if (!libRows.length) show("Couldn't search Apple Music.");
      });
  };

  const runPick = (term: string) => {
    const results = body.querySelector<HTMLElement>("[data-pick-results]");
    if (!results) return;
    const q = term.trim().toLowerCase();
    if (!q) {
      results.innerHTML = `<p class="qcard__empty">Type an album or an artist. Your library shows first, then Apple Music.</p>`;
      return;
    }
    const lib = libMatches(q);
    pickFound = lib.map((x) => ({ album: x.album, tracks: () => x.tracks }));
    const draw = (cat: Album[] | null) => {
      if (!body.contains(results)) return;
      const catIn: AlbumIn[] = (cat ?? []).map(catIn1);
      pickFound = [...lib.map((x) => ({ album: x.album, tracks: () => x.tracks })), ...catIn];
      const libHTML = lib.length
        ? `<div class="qcard__label">In your library</div>${lib.map((x, i) => pickRow(x.album, i, x.album.artistName)).join("")}`
        : "";
      const catHTML =
        cat === null
          ? `<p class="qcard__empty">Searching Apple Music…</p>`
          : cat.length
            ? `<div class="qcard__label">Apple Music</div>${cat.map((a, i) => pickRow(a, lib.length + i, [a.artistName, a.releaseDate?.slice(0, 4)].filter(Boolean).join(" · "))).join("")}`
            : lib.length
              ? ""
              : `<p class="qcard__empty">No album found.</p>`;
      results.innerHTML = libHTML + catHTML;
      if (cat !== null) enterRows(results.querySelectorAll(".search__row"));
    };
    draw(null);
    const seq = ++pickSeq;
    catMatches(term)
      .then((cat) => {
        if (seq === pickSeq && !destroyed) draw(cat);
      })
      .catch((e) => {
        console.warn("[diary] search", e);
        if (seq === pickSeq && !destroyed) draw([]);
      });
  };
  // ── the morph (his ask, 2026-09-24): the empty cover's square becomes the search bar ──
  // A stand-in box on <body> (fixed, so a grown card's clip cannot cut it) takes the start
  // shape — its place, size, corner and fill — and animates to the end shape, while the
  // real control waits invisible under it and fades in as the box lands. The skin's own
  // navigation motion (`--diary-morph-dur` / `--diary-morph-ease`). Reduced motion: it snaps.
  // A motion token read through a REAL property: a custom property keeps `calc()` as text
  // ("calc(0.26s * 1.4)"), which parseFloat reads as nothing — the morph ran in 0 ms and was
  // never seen (2026-09-24). `transition-*` on the element computes it.
  const tokenMotion = (el: HTMLElement, dur: string, ease: string): { ms: number; easing: string } => {
    el.style.transitionDuration = `var(${dur})`;
    el.style.transitionTimingFunction = `var(${ease})`;
    const cs = getComputedStyle(el);
    const raw = cs.transitionDuration.split(",")[0].trim(); // "0.364s"
    const ms = (parseFloat(raw) || 0) * (raw.endsWith("ms") ? 1 : 1000);
    // One value, whole: a comma split would cut "cubic-bezier(0.4, 0, 0.2, 1)" in half.
    const easing = cs.transitionTimingFunction.trim() || "ease";
    el.style.transitionDuration = "";
    el.style.transitionTimingFunction = "";
    return { ms, easing };
  };
  const morph = (from: HTMLElement, swap: () => HTMLElement | null, done?: () => void) => {
    const a = from.getBoundingClientRect();
    const sa = getComputedStyle(from);
    const start = { radius: sa.borderRadius, bg: sa.backgroundColor, border: sa.borderColor };
    const to = swap();
    if (!to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done?.();
    const b = to.getBoundingClientRect();
    const sb = getComputedStyle(to);
    const box = document.createElement("div");
    box.className = "diary__morph";
    box.setAttribute("aria-hidden", "true");
    document.body.appendChild(box);
    const { ms: dur, easing } = tokenMotion(box, "--diary-morph-dur", "--diary-morph-ease");
    to.style.opacity = "0";
    const frame = (r: DOMRect, radius: string, bg: string, border: string) => ({
      left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      borderRadius: radius, backgroundColor: bg, borderColor: border,
    });
    const anim = box.animate(
      [frame(a, start.radius, start.bg, start.border), frame(b, sb.borderRadius, sb.backgroundColor, sb.borderColor)],
      { duration: dur, easing, fill: "forwards" },
    );
    const land = () => {
      box.remove();
      to.style.opacity = "";
      to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur / 2, easing });
      done?.();
    };
    anim.finished.then(land, land);
  };
  const openPicker = () => {
    const cover = body.querySelector<HTMLElement>(".diary__new-art");
    const btn = body.querySelector<HTMLElement>("[data-new]");
    picking = true;
    diag.log("ui:act", { at: "diary", do: "pick-open" });
    if (!cover || !btn) return renderRoot();
    morph(
      cover,
      () => {
        btn.outerHTML = pickerHTML();
        return body.querySelector<HTMLElement>(".diary__pick .search__field");
      },
      () => body.querySelector<HTMLInputElement>("[data-pick-input]")?.focus(),
    );
    body.querySelector<HTMLInputElement>("[data-pick-input]")?.focus();
  };
  const closePicker = () => {
    const field = body.querySelector<HTMLElement>(".diary__pick .search__field");
    const pick = body.querySelector<HTMLElement>(".diary__pick");
    picking = false;
    pickTerm = "";
    ++pickSeq; // an Apple search still on its way must not draw into the bar that left
    if (!field || !pick) return renderRoot();
    morph(field, () => {
      pick.outerHTML = newHTML();
      return body.querySelector<HTMLElement>(".diary__new-art");
    });
  };

  // ── opening an album (all three ways in land here) ─────────────────────────────
  const openAlbum = (a: AlbumIn, how: string) => {
    picking = false;
    pickTerm = "";
    body.innerHTML = `<p class="qcard__empty">Opening ${esc(a.album.title)}…</p>`;
    diag.log("ui:act", { at: "diary", do: "open", how });
    // A library album finds its catalog id first (one memoized hop), so the entry is keyed by
    // it and the export ends with the album's link (DIARY.md §10).
    Promise.resolve(a.tracks())
      .then(async (ts) => diaryOpen(await withAlbumId(a.album, ts), ts))
      .then((e) => showEntry(e))
      .catch((e) => {
        console.error("[diary] open", e);
        toast({ kind: "warn", text: `Couldn't open “${a.album.title}” in your Diary.` });
        entry = null;
        setHeader();
        renderRoot();
      });
  };
  const openEntry = (id: number) =>
    diaryGet(id)
      .then(showEntry)
      .catch((e) => {
        console.warn("[diary] entry gone", id, e);
        entry = null;
        setHeader();
        renderRoot();
      });

  // ── the entry ──────────────────────────────────────────────────────────────────
  const songOf = (key: string | null): Track | undefined => (entry && key ? entry.tracks.find((t) => songKeyOf(t) === key) : undefined);
  const noteOf = (key: string): DiarySong | undefined => entry?.songs.find((s) => s.songKey === key);

  /** The playing song, when it is on this album (6B: the foot follows it). */
  const playingKey = (): string | null => {
    const cur = queue.getCurrent();
    if (!entry || !cur) return null;
    const t = entry.tracks.find(
      (x) => (cur.catalogId && x.catalogId === cur.catalogId) || (cur.libraryId && x.libraryId === cur.libraryId),
    );
    return t ? songKeyOf(t) : null;
  };

  // A score is a split pill (his call, 2026-09-24): the number you type on the left, the
  // scale on the right. On the album's pill the right half is the scale's menu; a song's
  // pill shows the same scale as text (one scale per entry, set on the album).
  const scoreFieldHTML = (which: "album" | "song", value: number | undefined, max: number, label: string) => {
    const over = value != null && value > max;
    const max$ = esc(fmtNum(max));
    const right =
      which === "album"
        ? `<button class="diary__score-max diary__scale" type="button" data-scale aria-haspopup="true" title="The scale for this album: its songs and the album use it">/ ${max$}${CARET}</button>`
        : `<span class="diary__score-max">/ ${max$}</span>`;
    return `<div class="diary__score${over ? " is-over" : ""}">
      <input class="diary__score-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
        data-score="${which}" value="${value == null ? "" : esc(fmtNum(value))}" placeholder="–" aria-label="${esc(label)}"
        title="${esc(over ? `Above this scale's top of ${fmtNum(max)}. Type a new score, or rescale` : `${label}: any number from 0 to ${fmtNum(max)}`)}" />
      ${right}
    </div>`;
  };
  const dateHTML = (which: "album" | "song", day: string | undefined, hint: string) =>
    `<button class="lib-pill diary__date" type="button" data-date="${which}" aria-haspopup="true" title="${esc(hint)}">
      <span class="lib-pill__label">${esc(day ? fmtDay(day) : "No date")}</span>${CARET}
    </button>`;

  const songRowHTML = (t: Track, i: number): string => {
    const key = songKeyOf(t);
    const n = noteOf(key);
    const sel = key === selKey;
    const playing = key === playingKey();
    const cls = ["search__row", "diary__song", sel ? "is-sel" : "", playing ? "is-playing" : "", t.unreleased ? "is-unreleased" : ""].filter(Boolean).join(" ");
    const hint = t.unreleased ? unreleasedHint(t) : "Shows this song's note below. Double-click plays the album from here";
    const artist = entry && t.artistName !== entry.album.artistName ? `<span class="search__song-artist">${esc(t.artistName)}</span>` : "";
    return `<li class="${cls}" data-song-i="${i}" role="button" tabindex="0" title="${esc(hint)}"${sel ? ' aria-current="true"' : ""}>
      <span class="diary__num">${t.trackNumber ?? i + 1}</span>
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}</span>${artist}</div>
      ${n?.note ? `<span class="diary__mark" aria-label="Has a note">${ICON_NOTE}</span>` : ""}
      <span class="diary__row-score${n?.score != null && entry && n.score > entry.scaleMax ? " is-over" : ""}">${n?.score != null ? esc(fmtNum(n.score)) : ""}</span>
    </li>`;
  };

  const footHTML = (): string => {
    const t = songOf(selKey);
    if (!entry || !t || !selKey) return "";
    const n = noteOf(selKey);
    const follow = selKey === playingKey();
    return `<div class="diary__foot" data-foot>
      <div class="diary__foot-head">
        <button class="panel__action diary__foot-play" type="button" data-foot-play aria-label="Play from this song" title="Plays the album from this song">${ICON_PLAY}</button>
        <span class="diary__foot-title" title="${esc(follow ? "The song that plays. The panel follows it" : "The row you picked")}">${esc(`${t.trackNumber ?? ""}${t.trackNumber ? " · " : ""}${t.title}`)}</span>
        ${dateHTML("song", n?.noteDate, "The day of this note. It is set when you first write one")}
        ${scoreFieldHTML("song", n?.score, entry.scaleMax, `Score for ${t.title}`)}
      </div>
      <textarea class="diary__note app-scroll" data-note="song" rows="3" placeholder="What you hear in this song" spellcheck="true">${esc(n?.note ?? "")}</textarea>
    </div>`;
  };

  const entryHTML = (e: DiaryEntry): string => {
    const written = e.songs.filter((s) => s.note || s.score != null).length;
    const meta = [`${e.tracks.length} song${e.tracks.length === 1 ? "" : "s"}`, written ? `${written} written` : ""].filter(Boolean).join(" · ");
    const hero = `<div class="lib-hero">${heroCover(e.album.artwork, e.album.title)}<span class="lib-hero__title">${esc(e.album.title)}</span>
      <span class="lib-hero__sub">${esc(e.album.artistName)}</span><span class="lib-hero__meta">${esc(meta)}</span></div>`;
    const album = `<div class="diary__album">
      <div class="diary__line">
        ${scoreFieldHTML("album", e.score, e.scaleMax, "Score for the album")}
        ${dateHTML("album", e.reviewDate, "The day of this review")}
      </div>
      <textarea class="diary__note app-scroll" data-note="album" rows="3" placeholder="What you think of the album" spellcheck="true">${esc(e.note)}</textarea>
    </div>`;
    const playable = e.tracks.some((t) => !t.unreleased);
    return `<div class="diary__entry">
      <div class="diary__scroll app-scroll">
        ${hero}${album}
        ${actionsRowHTML({ play: "Play the album in order", shuffle: "Shuffle the album" }, !playable)}
        <ol class="diary__songs">${e.tracks.map(songRowHTML).join("")}</ol>
      </div>
      ${footHTML()}
    </div>`;
  };

  /** Redraw the entry, keeping the list's scroll. */
  const renderEntry = (enter = false) => {
    if (!entry) return;
    const sc = body.querySelector<HTMLElement>(".diary__scroll");
    const top = sc?.scrollTop ?? 0;
    body.innerHTML = entryHTML(entry);
    const next = body.querySelector<HTMLElement>(".diary__scroll");
    if (next) next.scrollTop = top;
    if (enter) enterRows(body.querySelectorAll(".diary__song"));
  };

  /** Redraw only the rows and the foot (a note saved, the song changed) — never the field in focus. */
  const renderRows = () => {
    if (!entry) return;
    const ol = body.querySelector<HTMLElement>(".diary__songs");
    if (ol) ol.innerHTML = entry.tracks.map(songRowHTML).join("");
  };
  const renderFoot = () => {
    const old = body.querySelector<HTMLElement>("[data-foot]");
    const html = footHTML();
    if (old) {
      if (html) old.outerHTML = html;
      else old.remove();
    } else if (html) {
      // The foot arrives with the first pick: it slides in as a part that appears later does.
      body.querySelector(".diary__entry")?.insertAdjacentHTML("beforeend", html);
      const foot = body.querySelector<HTMLElement>("[data-foot]");
      if (foot) enterRows([foot]);
    }
  };

  const select = (key: string | null) => {
    if (key === selKey) return;
    const foot = body.querySelector<HTMLElement>("[data-foot]");
    if (foot?.contains(document.activeElement)) {
      pendingSel = key; // never swap the song under a note being typed
      return;
    }
    selKey = key;
    paintSel();
    renderFoot();
  };
  /** Move the selected mark WITHOUT rebuilding the rows: a rebuild between the two clicks of a
   *  double-click puts the second click on a new element, and the browser then sends no dblclick. */
  const paintSel = () => {
    if (!entry) return;
    body.querySelectorAll<HTMLElement>("[data-song-i]").forEach((el) => {
      const t = entry!.tracks[Number(el.dataset.songI)];
      const on = !!t && songKeyOf(t) === selKey;
      el.classList.toggle("is-sel", on);
      if (on) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    });
  };

  const showEntry = (e: DiaryEntry) => {
    if (destroyed) return;
    const first = entry?.id !== e.id;
    entry = e;
    if (first) {
      // The foot waits for a song (his call, 2026-09-24): a new entry starts on its first song,
      // because the card grows for it and has room; a reopened one on the song that plays, if
      // it is on this album, else on none.
      selKey = e.created && e.tracks[0] ? songKeyOf(e.tracks[0]) : playingKey();
      const grow = setting("diaryGrow");
      if (grow === "every" || (grow === "new" && e.created)) {
        void growCardTaller("diary", "diary-open").then((grew) => {
          if (grew && entry?.id === e.id) grewForEntry = true;
          diag.log("ui:act", { at: "diary", do: "grow", grew, why: e.created ? "new" : "every" });
        });
      }
    }
    setHeader();
    renderEntry(first);
    // A pre-release album: ask Apple once for the songs that came out since (release.ts).
    const cid = e.album.catalogId;
    if (first && cid && e.tracks.some((t) => t.unreleased)) {
      collectionTracks("albums", cid)
        .then((ts) => {
          const was = e.tracks.filter((t) => t.unreleased).length;
          const now = ts.filter((t) => t.unreleased).length;
          if (entry?.id === e.id && ts.length && now !== was) return diaryOpen(e.album, ts).then(showEntry);
        })
        .catch((err) => console.warn("[diary] refresh", err));
    }
  };

  // ── saving ─────────────────────────────────────────────────────────────────────
  const setScore = (input: HTMLInputElement) => {
    if (!entry) return;
    const e = entry;
    const which = input.dataset.score;
    const v = parseScore(input.value);
    const label = input.closest<HTMLElement>(".diary__score");
    const bad = (msg: string) => {
      label?.setAttribute("data-bad", "");
      input.title = msg;
    };
    if (v !== null && (Number.isNaN(v) || v > e.scaleMax)) {
      bad(`Type a number from 0 to ${fmtNum(e.scaleMax)}`);
      return;
    }
    label?.removeAttribute("data-bad");
    label?.classList.remove("is-over");
    if (which === "album") {
      if (v === (e.score ?? null)) return;
      e.score = v ?? undefined;
      void diaryUpdate(e.id, { score: v }).catch(saveFailed);
    } else if (selKey) {
      const key = selKey;
      const n = noteOf(key);
      if (v === (n?.score ?? null)) return;
      upsertSong(key, { score: v ?? undefined });
      renderRows();
      void diarySongSet(e.id, key, { score: v }).catch(saveFailed);
    }
    input.value = v == null ? "" : fmtNum(v);
  };

  /** Keep the local copy in step with what was written, so a redraw shows it at once. */
  const upsertSong = (key: string, patch: Partial<DiarySong>) => {
    if (!entry) return;
    const i = entry.songs.findIndex((s) => s.songKey === key);
    const next: DiarySong = { songKey: key, note: "", updatedAt: Date.now(), ...(i >= 0 ? entry.songs[i] : {}), ...patch };
    if ("score" in patch && patch.score === undefined) delete next.score;
    if ("noteDate" in patch && patch.noteDate === undefined) delete next.noteDate;
    if (i >= 0) entry.songs[i] = next;
    else entry.songs.push(next);
  };

  let noteTimer = 0;
  let noteTarget: HTMLTextAreaElement | null = null;
  const flushNote = () => {
    window.clearTimeout(noteTimer);
    const ta = noteTarget;
    noteTarget = null;
    if (!ta || !entry) return;
    const e = entry;
    const text = ta.value;
    if (ta.dataset.note === "album") {
      if (text === e.note) return;
      e.note = text;
      void diaryUpdate(e.id, { note: text }).catch(saveFailed);
      return;
    }
    const key = ta.dataset.songKey;
    if (!key) return;
    const n = noteOf(key);
    if (text === (n?.note ?? "")) return;
    // The note's day is set when the first word goes in (8B); you can change or clear it.
    const stamp = text && !n?.note && !n?.noteDate ? today() : undefined;
    upsertSong(key, stamp ? { note: text, noteDate: stamp } : { note: text });
    renderRows();
    if (stamp) {
      const pill = body.querySelector<HTMLElement>('[data-date="song"] .lib-pill__label');
      if (pill && key === selKey) pill.textContent = fmtDay(stamp);
    }
    void diarySongSet(e.id, key, stamp ? { note: text, noteDate: stamp } : { note: text }).catch(saveFailed);
  };
  function saveFailed(e: unknown) {
    console.error("[diary] save", e);
    toast({ kind: "warn", text: "Couldn't save that to your Diary." });
  }

  // ── the scale (fork 7B) ────────────────────────────────────────────────────────
  const scoreCount = (e: DiaryEntry) => (e.score != null ? 1 : 0) + e.songs.filter((s) => s.score != null).length;
  const changeScale = (to: number) => {
    if (!entry || !(to > 0) || !Number.isFinite(to)) return;
    const e = entry;
    const from = e.scaleMax;
    if (to === from) return;
    const n = scoreCount(e);
    const mode = setting("diaryRescale");
    diag.log("ui:act", { at: "diary", do: "scale", n, mode });
    const rescaleLocal = () => {
      const k = to / from;
      if (e.score != null) e.score *= k;
      e.songs.forEach((s) => {
        if (s.score != null) s.score *= k;
      });
    };
    if (n && mode === "always") {
      rescaleLocal();
      e.scaleMax = to;
      renderEntry();
      void diaryRescale(e.id, from, to).catch(saveFailed);
      return;
    }
    // Ask or Never: the scale changes, the numbers stay as typed. A score above the new top is marked.
    e.scaleMax = to;
    renderEntry();
    void diaryUpdate(e.id, { scaleMax: to }).catch(saveFailed);
    if (!n || mode === "never") return;
    toast({
      kind: "info",
      sticky: true,
      text: `“${e.album.title}” is now out of ${fmtNum(to)}. Rescale its ${n} score${n === 1 ? "" : "s"} too? ${fmtNum(from * 0.7)}/${fmtNum(from)} becomes ${fmtNum(to * 0.7)}/${fmtNum(to)}.`,
      actions: [
        {
          label: "Rescale",
          run: () => {
            diag.log("ui:act", { at: "diary", do: "rescale" });
            void diaryRescale(e.id, from, to)
              .then(() => (entry?.id === e.id ? diaryGet(e.id).then(showEntry) : undefined))
              .catch(saveFailed);
          },
        },
        { label: "Keep numbers" },
      ],
    });
  };

  const scaleMenu = (): MenuItem[] => {
    const cur = entry?.scaleMax;
    // His call (2026-09-24): the rows are 5, 10, 100 and a field — nothing else.
    return [
      ...SCALES.map((m) => ({ label: String(m), badge: cur === m ? MENU_CHOSEN : undefined, run: () => changeScale(m) })),
      {
        input: {
          placeholder: "Another top",
          value: cur != null && !SCALES.includes(cur) ? fmtNum(cur) : "",
          onSubmit: (raw: string) => {
            const v = parseScore(raw);
            if (v == null || Number.isNaN(v) || v <= 0) {
              toast({ kind: "warn", text: "A scale's top is a number above 0." });
              return;
            }
            changeScale(v);
          },
        },
      },
    ];
  };

  // ── dates (8B): the review's day, and each song note's day ─────────────────────
  const setDay = (which: "album" | "song", day: string | null) => {
    if (!entry) return;
    const e = entry;
    if (which === "album") {
      e.reviewDate = day ?? undefined;
      void diaryUpdate(e.id, { reviewDate: day }).catch(saveFailed);
    } else if (selKey) {
      upsertSong(selKey, { noteDate: day ?? undefined });
      void diarySongSet(e.id, selKey, { noteDate: day }).catch(saveFailed);
    }
    const pill = body.querySelector<HTMLElement>(`[data-date="${which}"] .lib-pill__label`);
    if (pill) pill.textContent = day ? fmtDay(day) : "No date";
  };
  /** The system date picker, from a field that is never seen. */
  const pickDay = (which: "album" | "song", anchor: HTMLElement) => {
    const input = document.createElement("input");
    input.type = "date";
    input.className = "diary__date-input";
    input.value = (which === "album" ? entry?.reviewDate : selKey ? noteOf(selKey)?.noteDate : undefined) ?? today();
    anchor.appendChild(input);
    input.addEventListener("change", () => {
      if (input.value) setDay(which, input.value);
      input.remove();
    });
    input.addEventListener("blur", () => window.setTimeout(() => input.remove(), 0));
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };
  const dateMenu = (which: "album" | "song", anchor: HTMLElement): MenuItem[] => [
    { label: "Today", run: () => setDay(which, today()) },
    { label: "Pick a date…", run: () => pickDay(which, anchor) },
    { label: "No date", run: () => setDay(which, null) },
  ];

  // ── playing ────────────────────────────────────────────────────────────────────
  const playFrom = (e: DiaryEntry, list: Track[], i: number) => {
    const ts = list.filter((t) => !t.unreleased);
    addTransientTracks(ts);
    ts.forEach(materializeTrack);
    playTracks(list, i, `diary:${e.id}`).catch((err) => console.error("[diary] play", err));
  };

  // ── delete (a sticky ask: it is the user's own writing) ────────────────────────
  const askDelete = (id: number, title: string) =>
    toast({
      kind: "warn",
      sticky: true,
      text: `Delete your Diary entry for “${title}”? Its notes and scores go with it.`,
      actions: [
        {
          label: "Delete",
          run: () =>
            void diaryDelete(id)
              .then(() => {
                if (entry?.id === id) {
                  entry = null;
                  setHeader();
                  renderRoot();
                }
              })
              .catch(saveFailed),
        },
        { label: "Keep" },
      ],
    });

  /** Move to Folder ▸ (the Playlists row's submenu): a new folder, each other folder, and
   *  Remove from Folder when it is filed. One folder per entry. */
  const folderSub = (id: number, filed: number | undefined): MenuItem[] => [
    { input: { placeholder: "New folder…", onSubmit: (name) => newFolder(name, (fid) => void diaryFile(id, fid).catch(saveFailed)) } },
    ...folders.filter((f) => f.id !== filed).map((f) => ({ label: f.name, run: () => void diaryFile(id, f.id).catch(saveFailed) })),
    ...(filed != null ? [{ label: "Remove from Folder", run: () => void diaryFile(id, null).catch(saveFailed) }] : []),
  ];
  const entryMenu = (s: { id: number; album: Album; doneAt?: number; folderId?: number; tracks: () => Track[] | Promise<Track[]> }): MenuItem[] =>
    albumMenu(
      { title: s.album.title, artistName: s.album.artistName, artwork: s.album.artwork, catalogId: s.album.catalogId, known: [], whole: () => Promise.resolve(s.tracks()), catalog: !!s.album.catalogId, pinKey: null },
      {
        context: `diary:${s.id}`,
        inDiary: true,
        own: [
          // Export (his ask, 2026-09-24): the entry as text on the clipboard (diary.rs `export_text`).
          { label: "Export", run: () => void copyDiaryExport(s.id) },
          { label: s.doneAt ? "Mark in progress" : "Mark as done", run: () => void setDone(s.id, !s.doneAt) },
          { label: "Move to Folder", sub: () => folderSub(s.id, s.folderId) },
        ],
        away: [{ label: "Delete entry", run: () => askDelete(s.id, s.album.title) }],
      },
    );
  /** A folder row's header: rename it, delete it (its entries stay, in In progress or Completed). */
  const folderMenu = (f: DiaryFolder): MenuItem[] => [
    { input: { placeholder: "Rename folder…", value: f.name, onSubmit: (name) => void diaryFolderRename(f.id, name).catch(saveFailed) } },
    { label: "Delete Folder", run: () => void diaryFolderDelete(f.id).catch(saveFailed) },
  ];

  // ── events ─────────────────────────────────────────────────────────────────────
  // ── Done (the check, his call 2026-09-24: it toggles) ─────────────────────────
  function paintDone() {
    const on = !!entry?.doneAt;
    doneBtn.classList.toggle("is-active", on);
    doneBtn.setAttribute("aria-pressed", String(on));
    doneBtn.setAttribute("aria-label", on ? "Mark in progress" : "Mark as done");
    doneBtn.title = on ? "Done. Press again to put it back in progress" : "Marks this entry done. It moves to Completed";
  }
  const setDone = (id: number, done: boolean) => {
    diag.log("ui:act", { at: "diary", do: done ? "done" : "undone" });
    if (entry?.id === id) {
      entry.doneAt = done ? Date.now() : undefined;
      paintDone();
    }
    return diarySetDone(id, done)
      .then((at) => {
        if (entry?.id === id) {
          entry.doneAt = at ?? undefined;
          paintDone();
        }
      })
      .catch(saveFailed);
  };
  doneBtn.addEventListener("click", () => {
    if (entry) void setDone(entry.id, !entry.doneAt);
  });

  // ── the + (home page): a new entry, or a new folder ───────────────────────────
  const newFolder = (name: string, then?: (id: number) => void) =>
    void diaryFolderCreate(name)
      .then((id) => then?.(id))
      .catch((e) => {
        console.error("[diary] new folder", e);
        toast({ kind: "warn", text: "Couldn't make the folder." });
      });
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    addBtn.setAttribute("aria-expanded", "true");
    openContextMenuUnder(
      addBtn,
      [
        {
          input: {
            label: "Entry",
            placeholder: "Find an album or an artist",
            onInput: menuSearch,
            onSubmit: () => {
              if (menuFirst) openAlbum(menuFirst, "menu-enter");
            },
          },
        },
        { input: { label: "Folder", placeholder: "Folder name", onSubmit: (name) => newFolder(name) } },
      ],
      () => addBtn.setAttribute("aria-expanded", "false"),
    );
  });

  backEl.addEventListener("click", () => {
    flushNote();
    // A grow the entry made ends with the entry; a grow the user made stays.
    if (grewForEntry && isGrownCard("diary")) void collapseGrow("diary-back");
    grewForEntry = false;
    entry = null;
    selKey = null;
    setHeader();
    renderRoot();
  });

  body.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    if (!entry) {
      const head = target.closest<HTMLElement>("[data-sec-head]");
      if (head) {
        const key = head.closest<HTMLElement>("[data-sec]")?.dataset.sec;
        if (!key) return;
        const opening = collapsed.has(key);
        if (opening) collapsed.delete(key);
        else collapsed.add(key);
        try {
          localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
        } catch { /* a fold that does not persist is still a fold */ }
        const sec = head.closest<HTMLElement>("[data-sec]")!;
        const r = rows.find((x) => x.key === key);
        if (r) sec.outerHTML = rowHTML(r, Number(sec.dataset.secIdx));
        if (opening) enterRows(body.querySelectorAll(`[data-sec="${CSS.escape(key)}"] [data-tile]`));
        return;
      }
      if (target.closest("[data-new]")) {
        openPicker();
        return;
      }
      if (target.closest("[data-pick-close]")) {
        closePicker();
        return;
      }
      const pick = target.closest<HTMLElement>("[data-pick]");
      if (pick) {
        const a = pickFound[Number(pick.dataset.pick)];
        if (a) openAlbum(a, "pick");
        return;
      }
      const tile = target.closest<HTMLElement>("[data-entry]");
      if (tile) void openEntry(Number(tile.dataset.entry));
      return;
    }
    const e = entry;
    const act = target.closest<HTMLElement>("[data-act]");
    if (act) {
      diag.log("ui:act", { at: "diary", do: act.dataset.act ?? "", n: e.tracks.length });
      runListAction(act.dataset.act ?? "", e.tracks.filter((t) => !t.unreleased), (l) => playFrom(e, l, 0));
      return;
    }
    if (target.closest("[data-foot-play]")) {
      const i = e.tracks.findIndex((t) => songKeyOf(t) === selKey);
      if (i >= 0) playFrom(e, e.tracks, i);
      return;
    }
    const scale = target.closest<HTMLElement>("[data-scale]");
    if (scale) {
      ev.stopPropagation();
      scale.setAttribute("aria-expanded", "true");
      openContextMenuUnder(scale, scaleMenu(), () => scale.setAttribute("aria-expanded", "false"));
      return;
    }
    const date = target.closest<HTMLElement>("[data-date]");
    if (date) {
      ev.stopPropagation();
      const which = date.dataset.date as "album" | "song";
      date.setAttribute("aria-expanded", "true");
      openContextMenuUnder(date, dateMenu(which, date), () => date.setAttribute("aria-expanded", "false"));
      return;
    }
    const row = target.closest<HTMLElement>("[data-song-i]");
    if (row) {
      const t = e.tracks[Number(row.dataset.songI)];
      if (t) select(songKeyOf(t));
    }
  });

  body.addEventListener("dblclick", (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-song-i]");
    if (!row || !entry) return;
    const i = Number(row.dataset.songI);
    const t = entry.tracks[i];
    if (!t) return;
    // A song that is not out: say when, as the Search album page does (release.ts).
    if (t.unreleased) {
      toast({ kind: "warn", text: unreleasedToast(t) });
      return;
    }
    diag.log("ui:act", { at: "diary", do: "row", i, n: entry.tracks.length });
    playFrom(entry, entry.tracks, i);
  });

  body.addEventListener("input", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-pick-input]")) {
      pickTerm = (target as HTMLInputElement).value;
      window.clearTimeout(pickTimer);
      pickTimer = window.setTimeout(() => runPick(pickTerm), PICK_DEBOUNCE_MS);
      return;
    }
    if (target.matches("[data-note]")) {
      const ta = target as HTMLTextAreaElement;
      if (noteTarget && noteTarget !== ta) flushNote();
      if (ta.dataset.note === "song" && !ta.dataset.songKey) ta.dataset.songKey = selKey ?? "";
      noteTarget = ta;
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(flushNote, NOTE_SAVE_MS);
      return;
    }
    if (target.matches("[data-score]")) target.closest(".diary__score")?.removeAttribute("data-bad");
  });

  body.addEventListener("focusin", (ev) => {
    const ta = (ev.target as HTMLElement).closest<HTMLTextAreaElement>('[data-note="song"]');
    if (ta) ta.dataset.songKey = selKey ?? ""; // the key the typing belongs to, fixed at focus
  });

  body.addEventListener("focusout", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-note]")) flushNote();
    if (target.matches("[data-score]")) setScore(target as HTMLInputElement);
    // The song changed while the foot had the focus: follow it once the focus leaves the foot.
    const foot = body.querySelector<HTMLElement>("[data-foot]");
    const to = (ev as FocusEvent).relatedTarget as Node | null;
    if (pendingSel !== null && foot && !(to && foot.contains(to))) {
      const k = pendingSel;
      pendingSel = null;
      window.setTimeout(() => select(k), 0);
    }
  });

  body.addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-score]") && ev.key === "Enter") {
      ev.preventDefault();
      setScore(target as HTMLInputElement);
      return;
    }
    if (target.matches("[data-pick-input]") && ev.key === "Escape") {
      ev.preventDefault();
      closePicker();
      return;
    }
    if (ev.key === "Enter" && !target.matches("input, textarea")) {
      const tile = target.closest<HTMLElement>("[data-entry], [data-pick], [data-song-i]");
      if (tile) {
        ev.preventDefault();
        tile.click();
      }
    }
  });

  body.addEventListener("contextmenu", (ev) => {
    const target = ev.target as HTMLElement;
    const tile = target.closest<HTMLElement>("[data-entry]");
    if (tile && !entry) {
      const s = list.find((x) => x.id === Number(tile.dataset.entry));
      if (!s) return;
      ev.preventDefault();
      tile.classList.add("is-context");
      openContextMenu(
        ev.clientX,
        ev.clientY,
        entryMenu({ ...s, tracks: () => diaryGet(s.id).then((e) => e.tracks) }),
        () => tile.classList.remove("is-context"),
      );
      return;
    }
    const head = target.closest<HTMLElement>("[data-sec-head]");
    if (head && !entry) {
      const key = head.closest<HTMLElement>("[data-sec]")?.dataset.sec ?? "";
      const f = folders.find((x) => `folder:${x.id}` === key);
      if (!f) return; // In progress and Completed are not yours to rename or delete
      ev.preventDefault();
      openContextMenu(ev.clientX, ev.clientY, folderMenu(f));
      return;
    }
    // A song row: the song menu (his ask, 2026-09-24). Play Now plays the album from it when
    // Settings says so (listFrom); an unreleased song gets Go to Artist only (media-menu.ts).
    const row = target.closest<HTMLElement>("[data-song-i]");
    if (entry && row) {
      const e = entry;
      const i = Number(row.dataset.songI);
      const t = e.tracks[i];
      if (!t) return;
      ev.preventDefault();
      row.classList.add("is-context");
      openContextMenu(
        ev.clientX,
        ev.clientY,
        songMenu(t, { context: `diary:${e.id}`, listFrom: { items: e.tracks.filter((x) => !x.unreleased), idx: Math.max(0, e.tracks.filter((x, j) => j < i && !x.unreleased).length) }, catalog: !t.libraryId }),
        () => row.classList.remove("is-context"),
      );
      return;
    }
    if (entry && target.closest(".lib-hero")) {
      const e = entry;
      ev.preventDefault();
      openContextMenu(ev.clientX, ev.clientY, entryMenu({ id: e.id, album: e.album, tracks: () => e.tracks }));
    }
  });

  // ── the three ways in: a held request (5C), a drop (5B) ────────────────────────
  const takeRequest = () => {
    const r = takeDiaryAlbum();
    if (r) {
      flushNote();
      openAlbum({ album: albumOf(r.album), tracks: r.tracks }, "menu");
    }
  };
  const unsubRequest = onDiaryAlbum(takeRequest);
  // The Compass's Diary rows open an entry by id (DIARY.md §10).
  const takeEntry = () => {
    const id = takeDiaryEntry();
    if (id == null) return;
    flushNote();
    picking = false;
    void openEntry(id);
  };
  const unsubEntry = onDiaryEntry(takeEntry);
  // An agent wrote (DIARY.md §10): an open entry reads itself again — unless you are typing
  // in it, when your own words win and the next open shows theirs.
  const unsubOutside = onDiaryOutside(() => {
    if (!entry || body.contains(document.activeElement)) return;
    const id = entry.id;
    void diaryGet(id)
      .then((e) => {
        if (entry?.id === id) showEntry(e);
      })
      .catch((err) => console.warn("[diary] outside refresh", err));
  });

  /** A dropped album's own facts come from its first song: a drag carries songs, not the album. */
  const openDrop = (p: DragPayload) => {
    flushNote();
    Promise.resolve(p.tracks())
      .then((ts) => {
        const t0 = ts[0];
        if (!t0) return;
        openAlbum(
          { album: { title: t0.albumName ?? "Unknown Album", artistName: t0.artistName, artwork: t0.artwork, catalogId: p.albumId, genres: [], releaseDate: t0.releaseDate }, tracks: () => ts },
          "drop",
        );
      })
      .catch((e) => console.error("[diary] drop", e));
  };
  const unregisterDrop = registerDropTarget({
    el: host,
    over: (_under, _x, _y, p) => (p.kind === "album" && p.source !== "diary" ? { highlight: host, drop: () => openDrop(p) } : null),
  });

  // ── arranging the home page (the Playlists idioms, DIARY.md §9) ────────────────
  // A row header: hold, then move — the whole row moves among the rows (row order scope
  // `diary.sections`). A tile: a plain drag. Inside its own row it moves along the row;
  // over another Diary row it lands there (his call: menu AND drag); over another card it is
  // the album, as any album tile is (Now Playing plays it, a playlist takes its songs).
  const tilePayload = (s: DiarySummary, rowKey: string): DragPayload => ({
    source: "diary",
    kind: "album",
    count: s.songCount,
    tracks: () => diaryGet(s.id).then((e) => e.tracks.filter((t) => !t.unreleased)),
    context: `diary:${s.id}`,
    diaryId: s.id,
    diaryRow: rowKey,
  });
  const drag = rowDrag({
    root: body,
    label: "diary",
    rowAt: (target) => {
      if (entry) return null;
      const secs = body.querySelector<HTMLElement>("[data-secs]");
      const head = target.closest<HTMLElement>("[data-sec-head]");
      if (head && secs) {
        const hold = holdFor();
        const sec = head.closest<HTMLElement>("[data-sec]");
        if (!hold || !sec) return null;
        const ids = rows.map((r) => r.key);
        const key = sec.dataset.sec ?? "";
        return {
          row: sec,
          index: Number(sec.dataset.secIdx),
          list: secs,
          count: ids.length,
          measure: true,
          sel: "[data-sec]",
          ...hold,
          done: (to) => {
            if (to != null) void moveTo("diary.sections", ids, key, to);
          },
        };
      }
      const tile = target.closest<HTMLElement>("[data-tile]");
      const shelf = tile?.closest<HTMLElement>("[data-shelf-key]");
      if (!tile || !shelf) return null;
      const rowKey = shelf.dataset.shelfKey ?? "";
      const r = rows.find((x) => x.key === rowKey);
      const s = r?.items[Number(tile.dataset.tileIdx)];
      if (!r || !s) return null;
      const ids = r.items.map((x) => String(x.id));
      return {
        row: tile,
        index: Number(tile.dataset.tileIdx),
        list: shelf,
        count: ids.length,
        axis: "x",
        measure: true,
        sel: "[data-tile]",
        payload: tilePayload(s, rowKey),
        done: (to) => {
          if (to != null) void moveTo(rowScope(rowKey), ids, String(s.id), to);
        },
      };
    },
  });

  /** Where a tile dropped at `x` lands among a row's tiles (the near side of each middle). */
  const insAt = (shelf: HTMLElement | null, x: number): number => {
    const tiles = shelf ? [...shelf.querySelectorAll<HTMLElement>("[data-tile]")] : [];
    const i = tiles.findIndex((t) => {
      const b = t.getBoundingClientRect();
      return x < b.left + b.width / 2;
    });
    return i < 0 ? tiles.length : i;
  };
  /** A tile dropped into another row: the row says what that means. Completed marks it done,
   *  In progress marks it in progress, a folder files it there (and out of its old folder).
   *  Then it takes its place in that row's order. */
  const dropInto = (rowKey: string, id: number, at: number) => {
    const s = list.find((x) => x.id === id);
    const r = rows.find((x) => x.key === rowKey);
    if (!s || !r) return;
    diag.log("ui:act", { at: "diary", do: "drop-row", row: rowKey.startsWith("folder:") ? "folder" : rowKey });
    const ids = r.items.map((x) => String(x.id)).filter((x) => x !== String(id));
    ids.splice(Math.min(at, ids.length), 0, String(id));
    const act =
      rowKey === "done" ? (s.doneAt ? Promise.resolve() : setDone(id, true))
      : rowKey === "progress" ? (s.doneAt ? setDone(id, false) : Promise.resolve())
      : r.folderId != null && s.folderId !== r.folderId ? diaryFile(id, r.folderId)
      : Promise.resolve();
    void Promise.resolve(act)
      .then(() => writeOrder(rowScope(rowKey), ids, { id: String(id), to: at }))
      .catch(saveFailed);
  };
  const unregisterRows = registerDropTarget({
    el: body,
    over: (under, x, _y, p) => {
      if (entry || p.diaryId == null) return null;
      const sec = under.closest<HTMLElement>("[data-sec]");
      const rowKey = sec?.dataset.sec;
      if (!sec || !rowKey || p.diaryRow === rowKey) return null; // its own row: a move, not a drop
      const id = p.diaryId;
      return { highlight: sec, drop: () => dropInto(rowKey, id, insAt(sec.querySelector("[data-shelf-key]"), x)) };
    },
  });
  const unsubOrder = onRowOrderChange(() => {
    if (!entry && !picking) renderRoot();
  });

  // ── live updates ───────────────────────────────────────────────────────────────
  // The song that plays moves the foot (6B) and the row mark.
  const unsubQueue = queue.onQueueChange(() => {
    if (!entry) return;
    const k = playingKey();
    if (k && k !== selKey) select(k);
    else renderRows();
  });
  // Another card's write (Add to Diary on an album already open, a delete) — the shelf redraws.
  const unsubDiary = onDiaryChange(() => {
    if (!entry && !picking) renderRoot();
  });

  // Card memory (CARD-MEMORY.md): the open entry, by id. A held request wins over it.
  const mem = opts?.memory as { entry?: number } | undefined;
  setHeader();
  if (mem?.entry) void openEntry(mem.entry);
  else renderRoot();
  takeRequest();
  takeEntry();

  return {
    destroy() {
      flushNote();
      destroyed = true;
      window.clearTimeout(pickTimer);
      unsubRequest();
      unsubEntry();
      unsubOutside();
      unsubQueue();
      unsubDiary();
      unregisterDrop();
      unregisterRows();
      unsubOrder();
      drag.destroy();
      headerSubs.clear();
      host.innerHTML = "";
    },
    onHeaderChange(cb) {
      headerSubs.add(cb);
      cb({ title: titleEl.textContent ?? "Diary", atRoot: !entry });
      return () => headerSubs.delete(cb);
    },
    snapshot: () => (entry ? { entry: entry.id } : undefined),
  };
}

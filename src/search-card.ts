// Search card (SEARCH.md) — a STANDALONE card, the "searches" screen archetype
// (collections = the engine, queues = the Qcard, searches = this). Blended sectioned
// results: Artists → Songs → Albums → Playlists → Stations, each a horizontal scroller, divided
// by bars; an always-on debounced search bar with a category-filter popover; recents
// as the empty state; drill-in panes riding the same --nav-* motion tokens as the
// engine (shared idiom, not shared code).

import { playTracks, queueTracksNext, queueTracksLater, playStation, queueStationAfter } from "./player";
import { addTransientTracks } from "./track-store";
import { addToPlaylistItem, requestOpenPlaylist, playlistTracks } from "./playlists";
import * as frames from "./frames";
import { addSongToLibraryItem, addAlbumToLibraryItem } from "./library-add";
import { addSquareHTML, isAddSquare } from "./add-square";
import { startStationItem } from "./start-station";
import { favoriteItem, reconcile } from "./favorites";
import { openContextMenu, type MenuItem } from "./context-menu";
import { copySongLinkItem, copyAlbumLinkItem, copyStationLinkItem } from "./copy-link";
import { makeDropdown } from "./dropdown";
import { onDrillRequest, onPlaylistPaneRequest, onSongPaneRequest, songCreditsItem, takeDrillRequest, takePlaylistPaneRequest, takeSongPaneRequest, type DrillIntent, type PlaylistPaneIntent, type SongPaneIntent } from "./go-to";
import {
  creditsFor, primeCredits, songsByWriter, fetchCredits, searchAppleForWriter,
  CREDITS_LABEL, CREDITS_NONE, CREDITS_READING, CREDITS_READ_FAILED,
  WRITER_REACH, WRITER_SEARCH_NOTE, WRITER_EMPTY, type WriterSong,
} from "./credits";
import { onSearchTerm, takeSearchTerm } from "./layout-bus";
import { wireListKeys } from "./list-keys";
import { esc, formatTotal, actionsRowHTML, picksRowHTML, runListAction } from "./collection-card";
import { explicitBadge, heroCover } from "./library-card";
import {
  searchCatalog, collectionTracks, artistDetail, materializeTrack, catalogRelated,
  ALL_TYPES, type SearchType, type SearchResults, type Artist,
} from "./search";
import type { Track, Artwork } from "./library";
import type { CardDef, CardInstance, MountOpts } from "./cards";
import { rowDrag } from "./row-drag";
import { rowPick, picksText } from "./row-pick";
import {
  yourPlaylistsFor, checkPlaylists, artistShelvesHTML, playlistShelfMenu, type YourPlaylists, type CheckProgress,
} from "./artist-view";
import { handOff } from "./handoff";

const TYPES_KEY = "deets.search.types";
const RECENTS_KEY = "deets.search.recents";
const PINS_KEY = "deets.search.pins"; // NEXT-VERSION §1: { term, types }[] — term + category filter
import { ICON_PIN, pinArtistItem } from "./pins"; // one pin glyph for the app (PINS.md)
const RECENTS_CAP = 8;
const DEBOUNCE_MS = 300;
const MIN_CHARS = 1;

const SECTION_LABEL: Record<SearchType, string> = {
  artists: "Artists", songs: "Songs", albums: "Albums", playlists: "Playlists", stations: "Stations",
};
const SECTION_ORDER: SearchType[] = ["artists", "songs", "albums", "playlists", "stations"];

const art = (tmpl: string | undefined, px: number): string | null =>
  tmpl ? tmpl.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;

const coverHTML = (url: string | null, cls: string): string =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" data-art />`
    : `<div class="${cls} ${cls}--empty" aria-hidden="true">♪</div>`;

// ── persisted bits ──
function loadTypes(): SearchType[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TYPES_KEY) ?? "[]") as string[];
    const valid = raw.filter((t): t is SearchType => (ALL_TYPES as string[]).includes(t));
    if (valid.length) return valid;
  } catch { /* fall through */ }
  return [...ALL_TYPES];
}
function loadRecents(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function pushRecent(term: string): void {
  const r = [term, ...loadRecents().filter((t) => t !== term)].slice(0, RECENTS_CAP);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(r)); } catch { /* session-only */ }
}
interface Pin { term: string; types: SearchType[] }
function loadPins(): Pin[] {
  try {
    const r = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
    if (!Array.isArray(r)) return [];
    return r
      .filter((x): x is Pin => !!x && typeof x.term === "string" && Array.isArray(x.types))
      .map((x) => ({ term: x.term, types: x.types.filter((t: string): t is SearchType => (ALL_TYPES as string[]).includes(t)) }));
  } catch { return []; }
}
function savePins(pins: Pin[]): void {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch { /* session-only */ }
}

/** Card memory (CARD-MEMORY.md §5a): what one pane shows. Search has its own pane stack, so
 *  it keeps its own shape rather than the engine's levels. */
type PaneOpen =
  | { kind: "album" | "playlist"; id: string; meta: CollectionMeta }
  | { kind: "artist"; id: string }
  | { kind: "related"; srcKind: "songs" | "albums"; srcId: string; rel: "artists" | "albums"; name: string }
  // The song pane carries the whole Track: the caller already held it, so a restore
  // needs no id hop and costs no Apple call (CREDITS.md §7).
  | { kind: "song"; track: Track }
  | { kind: "writer"; name: string };
interface SearchSnapshot {
  v: 1;
  term: string;
  scroll: number;
  panes: { open: PaneOpen; scroll: number }[];
}
const isSearchSnapshot = (s: unknown): s is SearchSnapshot =>
  !!s && typeof s === "object" && (s as SearchSnapshot).v === 1 && Array.isArray((s as SearchSnapshot).panes);

/** What a pane's hero knows before its songs land (a drill-in has only a name). */
interface CollectionMeta { title: string; artwork?: Artwork; artistName?: string; releaseDate?: string; curatorName?: string }

export const searchCard: CardDef = {
  id: "search",
  title: "Search",
  mount: (host, opts) => mountSearch(host, opts),
};

function mountSearch(host: HTMLElement, mountOpts?: MountOpts): CardInstance {
  host.innerHTML = `
    <header class="panel__head">
      <button class="panel__back" type="button" aria-label="Back" title="Goes back one step" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h2 class="panel__title">Search</h2>
    </header>
    <div class="panel__body search">
      <div class="search__bar">
        <div class="search__field">
          <svg class="search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
          <input class="search__input" type="search" placeholder="Search Apple Music" spellcheck="false" />
          <span class="search__busy" aria-hidden="true"></span>
          <button class="search__clear" type="button" aria-label="Clear search" title="Clears the search" hidden>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="search__filter-wrap">
          <button class="search__filter" type="button" aria-label="Filter categories" aria-haspopup="true" aria-expanded="false" title="Picks which kinds of results show: songs, albums, artists, playlists, stations">
            <svg class="search__filter-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h12M4 8h8M6 11h4"/></svg>
          </button>
          <div class="search__filter-pop" role="menu" aria-label="Filter categories" hidden></div>
        </div>
      </div>
      <div class="search__panes"><div class="spane" data-pos="center"><div class="spane__scroll search__root"></div></div></div>
    </div>`;

  const backEl = host.querySelector<HTMLButtonElement>(".panel__back")!;
  const titleEl = host.querySelector<HTMLElement>(".panel__title")!;
  const input = host.querySelector<HTMLInputElement>(".search__input")!;
  const clearBtn = host.querySelector<HTMLButtonElement>(".search__clear")!;
  const filterWrap = host.querySelector<HTMLElement>(".search__filter-wrap")!;
  const filterBtn = host.querySelector<HTMLElement>(".search__filter")!;
  const filterPop = host.querySelector<HTMLElement>(".search__filter-pop")!;
  const bar = host.querySelector<HTMLElement>(".search__bar")!;
  const panes = host.querySelector<HTMLElement>(".search__panes")!;
  const root = host.querySelector<HTMLElement>(".search__root")!;

  let types = loadTypes();
  let results: SearchResults | null = null;
  let lastTerm = "";
  let queryToken = 0;
  let debounceTimer: number | undefined;
  const headerCbs = new Set<(h: { title: string; atRoot: boolean }) => void>();
  const paneStack: HTMLElement[] = []; // drill panes above root
  // Card memory (CARD-MEMORY.md §5a) + the drill swap (CARD-GROW.md §14.4): what each pane
  // shows, and — on the pane a grown card's drill opened — the way back to that card.
  const paneOpen = new WeakMap<HTMLElement, PaneOpen>();
  const paneReturn = new WeakMap<HTMLElement, () => boolean>();
  const RETURN_TTL_MS = 5000;
  let pendingReturn: { cb: () => boolean; at: number } | null = mountOpts?.onReturn ? { cb: mountOpts.onReturn, at: Date.now() } : null;
  // The card header IS the drill header (1A, 2026-09-17): the level's kind while a pane is
  // open — the hero under it carries the name — and the base title at the root. The search
  // field stays live under it (2A), so typing still drops the panes and searches again.
  const paneLabel = new WeakMap<HTMLElement, string>();
  const headerTitle = (): string => {
    const top = paneStack[paneStack.length - 1];
    return top ? paneLabel.get(top) ?? "Search" : "Search";
  };
  const syncHeader = () => {
    const top = paneStack[paneStack.length - 1];
    titleEl.textContent = headerTitle();
    backEl.hidden = !top;
    backEl.title = top && paneReturn.has(top) && mountOpts?.returnTitle ? `Goes back to ${mountOpts.returnTitle}` : "Goes back one step";
  };
  const notifyHeader = () => {
    syncHeader();
    headerCbs.forEach((cb) => cb({ title: headerTitle(), atRoot: paneStack.length === 0 }));
  };

  // Track lookup for delegated handlers: keyed maps refreshed per render.
  let songsById = new Map<string, Track>();
  // A drill pane's track list and its queue-origin tag, for a drag from one of its rows.
  const paneTracks = new WeakMap<HTMLElement, { tracks: Track[]; context: string }>();

  // Multi-select (row-pick.ts, NEXT-VERSION §19). This card has TWO song surfaces — the
  // root's Songs results and a drill pane's track list — so the store reads whichever one
  // is on top. Keyed by the song, since neither list can hold the same song twice.
  // Songs only: an album, playlist or station tile is a drill or a play, not a pick.
  let activeList: () => Track[] = () => [];
  const picks = rowPick<Track>({
    id: (t) => t.catalogId ?? `${t.title} ${t.artistName}`,
    items: () => activeList(),
    onChange: () => paintPicks(),
  });
  // A pane's own Play / Shuffle row, kept so the count row can give it back.
  const paneActions = new WeakMap<HTMLElement, string>();
  let lastPicks = 0; // picks at the last paint — tells a first pick from a later one

  /** The surface the picks belong to: the top drill pane, else the root results. */
  const pickScope = (): HTMLElement => paneStack[paneStack.length - 1] ?? root;

  /**
   * Re-mark the rows and re-draw the count, WITHOUT rebuilding a pane (a rebuild would
   * refetch the collection). The root has no Play / Shuffle row, so its Songs section
   * title carries the count; a pane swaps its row for the count row and back.
   */
  const paintPicks = () => {
    const scope = pickScope();
    picks.mark(scope, "[data-song]", (el) => songsById.get(el.dataset.song ?? ""));
    picks.mark(scope, "[data-row]", (el) => {
      const sc = el.closest<HTMLElement>(".spane__scroll");
      const l = sc ? paneTracks.get(sc) : undefined;
      return l?.tracks[Number(el.dataset.row)];
    });
    const n = picks.size();
    const entering = n > 0 && lastPicks === 0;
    lastPicks = n;
    const scroll = scope === root ? null : scope.querySelector<HTMLElement>(".spane__scroll");
    if (scroll) {
      const bar = scroll.querySelector<HTMLElement>(".lib-actions");
      const own = paneActions.get(scroll);
      if (bar && own) bar.outerHTML = n ? picksRowHTML(n, entering) : own;
      return;
    }
    // The root: the Songs section title says how many are picked.
    const title = root.querySelector<HTMLElement>(".search__scroller--songs")?.previousElementSibling;
    if (title) title.textContent = n ? `Songs · ${picksText(n)}` : "Songs";
  };

  /** The menu for a picked set of songs (§19). */
  const picksMenu = (ts: Track[], context: string): MenuItem[] =>
    [
      { label: `Play ${picksText(ts.length)}`, run: () => enqueue(ts, "now", context) },
      { label: "Play Next", run: () => enqueue(ts, "next", context) },
      { label: "Add to Queue", run: () => enqueue(ts, "later", context) },
      addToPlaylistItem(() => ts),
    ] as MenuItem[];

  // A right-clicked row or tile wears `is-context` (the outline) while its menu is open, as
  // in the Library, Queue and History cards.
  const menuAt = (e: MouseEvent, items: MenuItem[]) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".search__song, .search__row, .search__tile, .search__artist");
    el?.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => el?.classList.remove("is-context"));
  };
  // The Add-to-Library square on song rows (root Songs grid + drill-pane track lists):
  // add-square.ts draws it with its state and hears its press.
  const addBtnHTML = (t: Track): string => addSquareHTML(t, "search__add");

  // ── root rendering ──
  // Empty state: a Pinned block above Recent (NEXT-VERSION §1). Each row is one pill
  // cut in two — the term (re-runs it) | a pin glyph (pins or unpins). A pinned term
  // leaves the recents ring; unpinning puts it back on top.
  const pillHTML = (term: string, pinned: boolean) =>
    `<div class="search__recent${pinned ? " is-pinned" : ""}">` +
    `<button class="search__recent-term" type="button" data-recent="${esc(term)}">${esc(term)}</button>` +
    `<button class="search__recent-pin" type="button" data-pin="${esc(term)}" aria-pressed="${pinned}" aria-label="${pinned ? "Unpin" : "Pin"}" title="${pinned ? "Unpin" : "Pin"}">${ICON_PIN}</button>` +
    `</div>`;
  const renderEmpty = () => {
    const pins = loadPins();
    const recents = loadRecents().filter((t) => !pins.some((p) => p.term === t));
    const pinned = pins.map((p) => pillHTML(p.term, true)).join("");
    const recent = recents.map((t) => pillHTML(t, false)).join("");
    root.innerHTML =
      (pinned ? `<div class="search__label">Pinned</div><div class="search__recents">${pinned}</div>` : "") +
      (recent ? `<div class="search__label">Recent</div><div class="search__recents">${recent}</div>` : "");
  };
  const togglePin = (term: string) => {
    const pins = loadPins();
    const i = pins.findIndex((p) => p.term === term);
    if (i >= 0) {
      pins.splice(i, 1);
      pushRecent(term); // back to the top of the ring
    } else {
      pins.unshift({ term, types: [...types] }); // the filter as it is right now
    }
    savePins(pins);
    renderEmpty();
  };

  const songCell = (t: Track): string => {
    const id = t.catalogId ?? "";
    return `<div class="search__song" data-song="${esc(id)}"${id ? ` data-cid="${esc(id)}"` : ""} role="button" tabindex="0">
      ${coverHTML(art(t.artwork?.urlTemplate, 72), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}${explicitBadge(t)}</span><span class="search__song-artist">${esc(t.artistName)}</span></div>
      ${addBtnHTML(t)}
    </div>`;
  };

  const tileCell = (kind: "album" | "playlist" | "station", id: string, name: string, sub: string, cover: string | null): string =>
    `<div class="search__tile" data-${kind}="${esc(id)}" role="button" tabindex="0">
      ${coverHTML(cover, "search__tile-art")}
      <span class="search__tile-name">${esc(name)}</span>${sub ? `<span class="search__tile-sub">${esc(sub)}</span>` : ""}
    </div>`;

  const artistCell = (a: Artist): string =>
    `<div class="search__artist" data-artist="${esc(a.catalogId ?? "")}" role="button" tabindex="0">
      ${coverHTML(art(a.artwork?.urlTemplate, 96), "search__artist-art")}
      <span class="search__artist-name">${esc(a.name)}</span>
    </div>`;

  const renderResults = () => {
    if (!results) return renderEmpty();
    songsById = new Map(results.songs.filter((t) => t.catalogId).map((t) => [t.catalogId!, t]));
    activeList = () => results?.songs ?? [];
    const sections: string[] = [];
    const bodies: Record<SearchType, () => string> = {
      artists: () => results!.artists.map(artistCell).join(""),
      songs: () => results!.songs.map(songCell).join(""),
      albums: () =>
        results!.albums
          .map((a) => tileCell("album", a.catalogId ?? "", a.title, a.artistName, art(a.artwork?.urlTemplate, 128)))
          .join(""),
      playlists: () =>
        results!.playlists
          .map((p) => tileCell("playlist", p.catalogId ?? "", p.name, p.curatorName ?? "", art(p.artwork?.urlTemplate, 128)))
          .join(""),
      // A station tile plays on tap (radio mode) — no drill, no queue (STATIONS.md §1).
      stations: () =>
        results!.stations
          .map((s) => tileCell("station", s.id, s.name, s.isLive ? "Live" : s.tagline ?? "", art(s.artwork?.urlTemplate, 128)))
          .join(""),
    };
    for (const sec of SECTION_ORDER) {
      if (!types.includes(sec)) continue;
      const count = results[sec].length;
      if (!count) continue;
      sections.push(`<section class="search__sec">
        <h3 class="search__sec-title">${SECTION_LABEL[sec]}</h3>
        <div class="search__scroller search__scroller--${sec}">${bodies[sec]()}</div>
      </section>`);
    }
    root.innerHTML = sections.length
      ? sections.join("")
      : `<p class="search__prompt">No results for “${esc(lastTerm)}”.</p>`;
    if (!paneStack.length) paintPicks(); // re-mark what is still picked after a redraw
  };

  // ── querying ──
  const runSearch = (term: string) => {
    const token = ++queryToken;
    bar.classList.add("search__bar--busy");
    searchCatalog(term, types)
      .then((r) => {
        if (token !== queryToken) return; // stale — a newer term is in flight
        picks.clear();
        results = r;
        lastTerm = term;
        if (!loadPins().some((p) => p.term === term)) pushRecent(term); // pins stay out of the ring
        reconcile(r.songs); // ♥ state for hits the mirror has never seen (batched, once)
        renderResults();
      })
      .catch((e) => {
        if (token !== queryToken) return;
        root.innerHTML = `<p class="search__prompt">Search failed: ${esc(String(e))}</p>`;
      })
      .finally(() => {
        if (token === queryToken) bar.classList.remove("search__bar--busy");
      });
  };

  const onInput = () => {
    window.clearTimeout(debounceTimer);
    clearBtn.hidden = !input.value;
    // The search bar owns the card: any keystroke (or a clear, or a recents tap)
    // returns to the root results. Otherwise a drill pane stays on top and hides
    // the new results rendered into `root` below it.
    resetToRoot();
    const term = input.value.trim();
    if (term.length < MIN_CHARS) {
      queryToken++; // cancel any in-flight response
      bar.classList.remove("search__bar--busy");
      results = null;
      renderEmpty();
      return;
    }
    debounceTimer = window.setTimeout(() => runSearch(term), DEBOUNCE_MS);
  };
  input.addEventListener("input", onInput);
  // A term from outside (the Compass, COMPASS.md §2): typed into the field, the search runs.
  const takeTerm = () => {
    const term = takeSearchTerm();
    if (term === null) return;
    input.value = term;
    onInput();
    input.focus();
  };
  const unsubTerm = onSearchTerm(takeTerm);
  // Enter / Space on a row that is a button (`role="button"`, COMPASS.md §5): what a click does.
  // A real <button> and a text field keep their own keys.
  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target as HTMLElement | null;
    if (!t || t.closest("input, textarea, button") || t.getAttribute("role") !== "button") return;
    e.preventDefault();
    t.click();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    onInput(); // hides the clear button, cancels in-flight, resets to the empty state
    input.focus();
  });

  // ── filter popover (which categories to search) ──
  const renderFilter = () => {
    filterPop.innerHTML = ALL_TYPES.map(
      (t) => `<label class="search__filter-row"><input type="checkbox" data-type="${t}" ${
        types.includes(t) ? "checked" : ""
      }/> ${SECTION_LABEL[t]}</label>`,
    ).join("");
  };
  renderFilter();
  // Ride the shared dropdown primitive so the filter follows the global click/hover
  // menu mode (the Hover-Menu setting), matching every other DeetsMusic menu. The
  // hover region is the tight button+popover wrap, not the whole bar — so hovering
  // the text input never pops the filter. Escape + click-away are handled for us.
  const filterDropdown = makeDropdown({ root: filterWrap, trigger: filterBtn, panel: filterPop });
  filterPop.addEventListener("change", () => {
    const checked = [...filterPop.querySelectorAll<HTMLInputElement>("input:checked")]
      .map((el) => el.dataset.type as SearchType);
    types = checked.length ? checked : [...ALL_TYPES]; // never zero categories
    try { localStorage.setItem(TYPES_KEY, JSON.stringify(types)); } catch { /* ok */ }
    if (lastTerm && results) runSearch(lastTerm); // re-query with the narrower/wider set
  });

  // ── drill panes (push/pop on the shared --nav-* tokens) ──
  const pushPane = (
    title: string,
    fill: (body: HTMLElement, setTitle: (t: string) => void) => void | Promise<unknown>,
    open?: PaneOpen,
    memory?: { instant?: boolean; scroll?: number },
  ) => {
    const pane = document.createElement("div");
    pane.className = "spane";
    pane.dataset.pos = "right";
    pane.innerHTML = `<div class="spane__scroll"></div>`;
    paneLabel.set(pane, title);
    panes.appendChild(pane);
    // setTitle lets a drill-in relabel the pane once the target resolves (fallback
    // name shown while the id hop is in flight, real name swapped in on arrival).
    const scroller = pane.querySelector<HTMLElement>(".spane__scroll")!;
    const filled = fill(scroller, (t) => {
      paneLabel.set(pane, t);
      if (paneStack[paneStack.length - 1] === pane) syncHeader();
    });
    const below = paneStack[paneStack.length - 1] ?? panes.querySelector<HTMLElement>('.spane[data-pos="center"]');
    void pane.offsetWidth; // commit the off-screen position before sliding in
    if (memory?.instant) {
      // A restore puts the pane straight in its place — no slide (CARD-MEMORY.md §4 rule 2).
      pane.style.transition = "none";
      if (below) below.style.transition = "none";
      requestAnimationFrame(() => {
        pane.style.transition = "";
        if (below) below.style.transition = "";
      });
    } else {
      frames.during("slide", 450, "search-push");
    }
    pane.dataset.pos = "center";
    if (below) below.dataset.pos = "left";
    paneStack.push(pane);
    if (open) paneOpen.set(pane, open);
    if (pendingReturn && Date.now() - pendingReturn.at < RETURN_TTL_MS) paneReturn.set(pane, pendingReturn.cb);
    pendingReturn = null;
    if (memory?.scroll) void Promise.resolve(filled).then(() => { scroller.scrollTop = memory.scroll!; });
    notifyHeader(); // the header takes this level's kind, and shows its Back button
  };

  /** The Back button: the pane a grown card's drill opened hands the Back to the layout, which
   *  brings the first card back (CARD-GROW.md §14.4). Everything else is a plain pop. */
  const backPane = () => {
    const top = paneStack[paneStack.length - 1];
    const ret = top ? paneReturn.get(top) : undefined;
    if (top && ret) {
      paneReturn.delete(top);
      paneStack.pop(); // out of the snapshot the destroy that follows takes
      if (ret()) return;
      paneStack.push(top);
    }
    popPane();
  };
  const popPane = () => {
    const pane = paneStack.pop();
    if (!pane) return;
    // Back out: the picks belonged to the pane that is leaving, and the surface below
    // becomes the one they read (§19).
    picks.clear();
    const under = paneStack[paneStack.length - 1];
    const sc = under?.querySelector<HTMLElement>(".spane__scroll");
    const list = sc ? paneTracks.get(sc) : undefined;
    activeList = list ? () => list.tracks : () => results?.songs ?? [];
    const below = paneStack[paneStack.length - 1] ?? panes.querySelector<HTMLElement>(".spane:first-child");
    frames.during("slide", 450, "search-pop");
    pane.dataset.pos = "right";
    if (below) below.dataset.pos = "center";
    window.setTimeout(() => pane.remove(), 400); // past --nav-dur; cheap cleanup
    notifyHeader();
  };
  /** Drop every drill pane at once, so `root` is the visible pane again. */
  const resetToRoot = () => { while (paneStack.length) popPane(); };

  // Escape drops the picks; Ctrl+A takes the surface on top. Gated on the last press
  // inside this card — a row carries no tabindex, so the focus never leaves <body>.
  let touched = false;
  panes.addEventListener("pointerdown", () => {
    touched = true;
  });
  const onDocDown = (e: PointerEvent) => {
    if (!panes.contains(e.target as Node)) touched = false;
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable]")) return; // the search field keeps its own
    if (e.key === "Escape") {
      picks.clear();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && touched) {
      e.preventDefault();
      picks.all();
    }
  };
  document.addEventListener("pointerdown", onDocDown);
  document.addEventListener("keydown", onKey);

  const listRow = (t: Track, i: number): string =>
    `<div class="search__row" data-row="${i}"${t.catalogId ? ` data-cid="${esc(t.catalogId)}"` : ""} role="button" tabindex="0">
      ${coverHTML(art(t.artwork?.urlTemplate, 72), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}${explicitBadge(t)}</span><span class="search__song-artist">${esc(t.artistName)}</span></div>
      ${addBtnHTML(t)}
    </div>`;

  /** A detail pane's track list: tap plays the list from that row (Library semantics). */
  const wireTrackList = (body: HTMLElement, tracks: Track[], context: string) => {
    paneTracks.set(body, { tracks, context });
    // This pane is now the surface the picks read, and its own Play / Shuffle row is kept
    // so the count row can hand it back (§19).
    const ownBar = body.querySelector<HTMLElement>(".lib-actions");
    if (ownBar) paneActions.set(body, ownBar.outerHTML);
    activeList = () => tracks;
    picks.clear();
    const start = (list: Track[], idx: number) => {
      addTransientTracks(list);
      list.forEach(materializeTrack);
      playTracks(list, idx, context).catch((err) => console.error("[search] play", err));
    };
    body.addEventListener("click", (e) => {
      // The Play / Shuffle row (NEXT-VERSION §13): this pane's list from the top.
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (act) {
        e.stopPropagation();
        // While rows are picked the row is the count row: Play / Shuffle act on them (§19).
        const list = picks.size() ? picks.picked() : tracks;
        runListAction(act.dataset.act ?? "", list, (l) => start(l, 0));
        return;
      }
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
      if (!row) return;
      const picked = tracks[Number(row.dataset.row)];
      if (picked && picks.click(e, picked)) return; // Ctrl / Shift → a pick, not a play
      start(tracks, Number(row.dataset.row));
    });
    body.addEventListener("contextmenu", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
      if (!row) return;
      e.preventDefault();
      const t = tracks[Number(row.dataset.row)];
      if (t && picks.size() && picks.isPicked(t)) {
        menuAt(e, picksMenu(picks.picked(), context));
        return;
      }
      if (t) trackMenu(e, t);
    });
  };

  // Body fillers, split from the open* wrappers so the drill-ins can reuse them:
  // a drill opens the pane on the FALLBACK name, then fills once the id resolves.
  // What the hero knows before the tracks land: the result tile's own facts. Anything
  // missing (a drill-in only has a name) falls back to the first track (CollectionMeta,
  // at module scope so a pane record can hold it).
  const heroHTML = (kind: "albums" | "playlists", m: CollectionMeta, tracks: Track[]): string => {
    const t0 = tracks[0];
    const cover = heroCover(m.artwork ?? t0?.artwork, m.title);
    const total = formatTotal(tracks.reduce((n, t) => n + (t.durationMs ?? 0), 0));
    const count = `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;
    if (kind === "albums") {
      const artist = m.artistName ?? t0?.artistName ?? "";
      const year = (m.releaseDate ?? t0?.releaseDate)?.slice(0, 4);
      const sub = artist
        ? `<button class="lib-hero__sub lib-hero__sub--link" type="button" data-hero-artist="${esc(artist)}">${esc(artist)}<span class="lib-hero__chev" aria-hidden="true">›</span></button>`
        : "";
      return `<div class="lib-hero">${cover}<span class="lib-hero__title">${esc(m.title)}</span>${sub}<span class="lib-hero__meta">${esc([year, count, total].filter(Boolean).join(" · "))}</span></div>`;
    }
    const meta = [count, total, m.curatorName ?? "Apple Music"].filter(Boolean).join(" · ");
    return `<div class="lib-hero">${cover}<span class="lib-hero__title">${esc(m.title)}</span><span class="lib-hero__meta">${esc(meta)}</span></div>`;
  };
  // `preloaded`: songs a chip flight fetched already (ARTIST-VIEW.md §5) — no second fetch.
  const fillCollection = (body: HTMLElement, kind: "albums" | "playlists", id: string, meta: CollectionMeta, preloaded?: Track[]) => {
    body.innerHTML = `<p class="search__prompt">Loading…</p>`;
    return (preloaded ? Promise.resolve(preloaded) : collectionTracks(kind, id))
      .then((tracks) => {
        const what = kind === "albums" ? "the album" : "the playlist";
        const actions = tracks.length
          ? actionsRowHTML({ play: `Play ${what} in order`, shuffle: `Shuffle ${what}` })
          : "";
        body.innerHTML = heroHTML(kind, meta, tracks) + actions + (tracks.map(listRow).join("") || `<p class="search__prompt">No songs.</p>`);
        wireTrackList(body, tracks, `search-${kind}:${id}`);
        // The album hero's artist subtitle → the artist pane, via the album's own relationship.
        body.querySelector<HTMLElement>("[data-hero-artist]")?.addEventListener("click", (e) => {
          e.stopPropagation();
          goToArtist("albums", id, (e.currentTarget as HTMLElement).dataset.heroArtist ?? "Artist");
        });
      })
      .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
  };
  // The pane header shows the kind; the hero owns the name.
  const openCollection = (kind: "albums" | "playlists", id: string, meta: CollectionMeta, preloaded?: Track[], memory?: { instant?: boolean; scroll?: number }) =>
    pushPane(
      kind === "albums" ? "Album" : "Playlist",
      (body) => fillCollection(body, kind, id, meta, preloaded),
      { kind: kind === "albums" ? "album" : "playlist", id, meta },
      memory,
    );

  // The artist pane (ARTIST-VIEW.md): a round hero, Albums, Featured Playlists, Your Playlists,
  // Top Songs. Your Playlists lands after the pane (zero Apple calls; "Check N more" fetches
  // each unopened Apple playlist once).
  const fillArtist = (body: HTMLElement, id: string) => {
      body.innerHTML = `<p class="search__prompt">Loading…</p>`;
      return artistDetail(id)
        .then((d) => {
          let yours: YourPlaylists | undefined;
          let checking: CheckProgress | null = null;
          const albums = d.albums
            .map((a) => tileCell("album", a.catalogId ?? "", a.title, a.releaseDate?.slice(0, 4) ?? "", art(a.artwork?.urlTemplate, 128)))
            .join("");
          const genre = d.artist.genres?.[0];
          body.innerHTML = `
            <div class="lib-hero">${heroCover(d.artist.artwork, d.artist.name, undefined, undefined, true)}<span class="lib-hero__title">${esc(d.artist.name)}</span>${genre ? `<span class="lib-hero__meta">${esc(genre)}</span>` : ""}</div>
            ${d.topSongs.length ? actionsRowHTML({ play: `Play ${d.artist.name}'s Top Songs from Apple Music, in order`, shuffle: `Shuffle ${d.artist.name}'s Top Songs from Apple Music` }) : ""}
            ${albums ? `<div class="search__label">Albums</div><div class="search__scroller search__scroller--albums">${albums}</div>` : ""}
            <div data-shelves>${artistShelvesHTML(d.featuredPlaylists, yours, checking)}</div>
            <div class="search__label">Top Songs</div>
            ${d.topSongs.map(listRow).join("") || `<p class="search__prompt">No songs.</p>`}`;
          const shelves = body.querySelector<HTMLElement>("[data-shelves]")!;
          const paintShelves = () => { shelves.innerHTML = artistShelvesHTML(d.featuredPlaylists, yours, checking); };
          const loadYours = () =>
            yourPlaylistsFor(d.artist.name)
              .then((y) => { yours = y; paintShelves(); })
              .catch((err) => console.error("[search] your playlists", err));
          void loadYours();
          wireTrackList(body, d.topSongs, `search-artist:${id}`);
          body.addEventListener("click", (e) => {
            const t = e.target as HTMLElement;
            const shelf = t.closest<HTMLElement>("[data-shelf-item]");
            if (shelf) {
              const i = Number(shelf.dataset.shelfIdx);
              const kind = shelf.dataset.shelfItem;
              if (kind === "featured") {
                const p = d.featuredPlaylists[i];
                if (p?.catalogId) openCollection("playlists", p.catalogId, { title: p.name, artwork: p.artwork, curatorName: p.curatorName });
              } else if (kind === "yours") {
                const p = yours?.hits[i]?.p;
                const lid = p?.libraryId;
                if (p && lid) handOff(shelf, "playlists", () => playlistTracks(p), (ts) => requestOpenPlaylist(lid, ts), p.trackCount);
              } else if (kind === "check" && yours && !checking) {
                checking = { done: 0, total: yours.unchecked.length };
                paintShelves();
                void checkPlaylists(yours.unchecked, (pr) => { checking = pr; paintShelves(); })
                  .then(loadYours)
                  .finally(() => { checking = null; paintShelves(); });
              }
              return;
            }
            const tile = t.closest<HTMLElement>("[data-album]");
            if (!tile) return;
            const al = d.albums.find((a) => a.catalogId === tile.dataset.album);
            if (al?.catalogId) openCollection("albums", al.catalogId, { title: al.title, artwork: al.artwork, artistName: d.artist.name, releaseDate: al.releaseDate });
          });
          // Tiles in a pane live outside `root`, so the root's delegated right-click doesn't
          // reach them — wire the same menus here (else the native menu shows).
          body.addEventListener("contextmenu", (e) => {
            const t = e.target as HTMLElement;
            // The hero (PINS.md): pin the artist, or start their station.
            if (t.closest(".lib-hero")) {
              e.preventDefault();
              menuAt(e, [pinArtistItem(d.artist), startStationItem("artists", id)].filter(Boolean) as MenuItem[]);
              return;
            }
            const shelf = t.closest<HTMLElement>("[data-shelf-item]");
            if (shelf) {
              const i = Number(shelf.dataset.shelfIdx);
              if (shelf.dataset.shelfItem === "featured") {
                const cid = d.featuredPlaylists[i]?.catalogId;
                if (cid) { e.preventDefault(); collectionMenu(e, "playlists", cid, `search-playlists:${cid}`); }
              } else if (shelf.dataset.shelfItem === "yours") {
                const p = yours?.hits[i]?.p;
                if (p) { e.preventDefault(); menuAt(e, playlistShelfMenu(() => playlistTracks(p), `playlist:${p.libraryId}`, false)); }
              }
              return;
            }
            const tile = t.closest<HTMLElement>("[data-album]");
            if (!tile?.dataset.album) return;
            e.preventDefault();
            collectionMenu(e, "albums", tile.dataset.album, `search-albums:${tile.dataset.album}`);
          });
        })
        .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
  };
  // The pane header shows the kind; the hero owns the name (as album panes do).
  const openArtist = (id: string, _name: string, memory?: { instant?: boolean; scroll?: number }) =>
    pushPane("Artist", (body) => fillArtist(body, id), { kind: "artist", id }, memory);

  // ── the song pane and the writer pane (CREDITS.md §7) ──
  // A song is the one thing every card lists and no card could open. Its pane answers
  // "who made this": Apple's writers, then the facts we already hold. Every writer is a
  // chip, and a chip opens the writer pane — which is the producer-web idea at its
  // smallest (CREDITS.md §5.2): a name string as a node, answered by a local join.

  const factsHTML = (t: Track): string => {
    const rows: [string, string][] = [];
    if (t.albumName) rows.push(["Album", t.albumName]);
    const genres = (t.genres ?? []).filter((g) => g !== "Music");
    if (genres.length) rows.push(["Genre", genres.join(", ")]);
    if (t.releaseDate) rows.push(["Released", t.releaseDate.slice(0, 10)]);
    const clock = t.durationMs ? `${Math.floor(t.durationMs / 60000)}:${String(Math.round((t.durationMs % 60000) / 1000)).padStart(2, "0")}` : "";
    if (clock) rows.push(["Length", clock]);
    if (t.isrc) rows.push(["ISRC", t.isrc]);
    if (!rows.length) return "";
    return `<div class="search__label">Details</div><dl class="credit__facts">${rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("")}</dl>`;
  };


  const fillSong = (body: HTMLElement, t: Track) => {
    // "Reading…" is shown only while WE are the reason there is nothing (CREDITS.md §8):
    // a song we have never read. Apple having no credits is a settled answer, not a wait.
    let reading = false;
    let readFailed = false;
    const paint = () => {
      const credit = t.catalogId ? creditsFor(t.catalogId) : undefined;
      const writers = credit?.names ?? [];
      const gap = readFailed
        ? CREDITS_READ_FAILED
        : reading
          ? CREDITS_READING
          : credit?.state === "none"
            ? CREDITS_NONE
            : CREDITS_READING; // never read, and the read is about to start
      body.innerHTML = `
        <div class="lib-hero">${heroCover(t.artwork, t.title)}<span class="lib-hero__title">${esc(t.title)}</span><span class="lib-hero__sub">${esc(t.artistName)}</span></div>
        <div class="search__label">${esc(CREDITS_LABEL)}</div>
        ${writers.length
          ? `<div class="credit__chips">${writers
              .map((n) => `<button type="button" class="credit__chip" data-writer="${esc(n)}" title="Other songs by this name">${esc(n)}</button>`)
              .join("")}</div>`
          : `<p class="search__prompt">${esc(gap)}</p>`}
        ${factsHTML(t)}`;
      body.querySelectorAll<HTMLElement>("[data-writer]").forEach((chip) => {
        chip.addEventListener("click", () => openWriter(chip.dataset.writer!));
      });
    };
    paint();
    return primeCredits([t.catalogId]).then(async () => {
      if (!body.isConnected) return;
      paint();
      // Never read: that gap is ours, so close it instead of blaming Apple. One call.
      if (t.catalogId && !creditsFor(t.catalogId)) {
        reading = true;
        paint();
        try {
          await fetchCredits([t.catalogId]);
        } catch {
          readFailed = true;
        }
        reading = false;
        if (body.isConnected) paint();
      }
    });
  };

  const openSong = (t: Track, memory?: { instant?: boolean; scroll?: number }) =>
    pushPane("Song", (body) => fillSong(body, t), { kind: "song", track: t }, memory);

  const fillWriter = (body: HTMLElement, name: string) => {
    body.innerHTML = `<p class="search__prompt">Loading…</p>`;
    const paint = (songs: WriterSong[], searching: boolean) => {
      if (!body.isConnected) return;
      const playable = songs.filter((s) => s.track).map((s) => s.track!);
      const rest = songs.filter((s) => !s.track);
      const count = songs.length === 1 ? "1 song" : `${songs.length} songs`;
      body.innerHTML = `
        <div class="lib-hero">${heroCover(undefined, name, undefined, undefined, true)}<span class="lib-hero__title">${esc(name)}</span><span class="lib-hero__sub">Writer</span></div>
        <p class="credit__note">${esc(count)} · ${esc(WRITER_REACH)}</p>
        ${playable.length ? `<div class="search__label">In your app</div>${playable.map(listRow).join("")}` : ""}
        ${rest.length
          ? `<div class="search__label">Also credited</div>${rest
              .map((s) => `<div class="search__row search__row--flat"><div class="search__song-text"><span class="search__song-title">${esc(s.title)}</span><span class="search__song-artist">${esc(s.artistName)}</span></div></div>`)
              .join("")}`
          : ""}
        ${!songs.length ? `<p class="search__prompt">${esc(WRITER_EMPTY)}</p>` : ""}
        <div class="search__label">More</div>
        <button type="button" class="credit__chip" data-apple ${searching ? "disabled" : ""}>${
          searching ? "Searching…" : `Search Apple Music for “${esc(name)}”`
        }</button>
        <p class="credit__note">${esc(WRITER_SEARCH_NOTE)}</p>`;
      if (playable.length) wireTrackList(body, playable, `writer:${name}`);
      // The search fills THIS level in place (the user's call 2026-09-17): leaving for the
      // results would lose the page you asked the question from.
      body.querySelector<HTMLElement>("[data-apple]")?.addEventListener("click", () => {
        paint(songs, true);
        void searchAppleForWriter(name).then((found) => paint(found, false));
      });
    };
    return songsByWriter(name).then((songs) => paint(songs, false));
  };

  const openWriter = (name: string, memory?: { instant?: boolean; scroll?: number }) =>
    pushPane("Writer", (body) => fillWriter(body, name), { kind: "writer", name }, memory);

  // ── drill-ins ("Go to Artist" / "Go to Album") ──
  // Open the target pane immediately on the fallback name (the source row's own
  // artist/album string), resolve the catalog id via one memoized `include=` hop,
  // then relabel + fill in place. The resolve is session-cached in search.ts, so a
  // repeat drill on the same row costs no Apple call.
  const drillRelated = (
    kind: "songs" | "albums",
    id: string,
    rel: "artists" | "albums",
    fallbackName: string,
    fill: (body: HTMLElement, targetId: string, resolvedName: string) => void,
    memory?: { instant?: boolean; scroll?: number },
  ) =>
    pushPane(
      fallbackName,
      (body, setTitle) => {
        body.innerHTML = `<p class="search__prompt">Loading…</p>`;
        return catalogRelated(kind, id, rel)
          .then((ref) => {
            if (!ref) { body.innerHTML = `<p class="search__prompt">Not found.</p>`; return; }
            // The pane header reads the kind; the hero carries the name.
            setTitle(rel === "albums" ? "Album" : "Artist");
            fill(body, ref.id, ref.name || fallbackName);
          })
          .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
      },
      { kind: "related", srcKind: kind, srcId: id, rel, name: fallbackName },
      memory,
    );
  const goToArtist = (kind: "songs" | "albums", id: string, name: string) =>
    drillRelated(kind, id, "artists", name, fillArtist);
  const goToAlbum = (songId: string, name: string) =>
    drillRelated("songs", songId, "albums", name, (body, albumId, resolved) => fillCollection(body, "albums", albumId, { title: resolved }));

  // Remote drill-ins: other cards' "Go to Artist/Album" summon this card (go-to.ts)
  // and emit an intent here. Same machinery as an in-card drill — a pane pushes on top
  // of whatever the search card is currently showing.
  let tookRequest = false; // a held request beats card memory (CARD-MEMORY.md §4 rule 1)
  const runDrill = (intent: DrillIntent) => {
    tookRequest = true;
    if (intent.rel === "artists") goToArtist(intent.srcKind, intent.srcId, intent.name);
    else goToAlbum(intent.srcId, intent.name);
  };
  const unsubDrill = onDrillRequest(runDrill);
  // A Featured Playlists tile on the Library artist view opens its playlist here (ARTIST-VIEW.md §5).
  const runPane = (i: PlaylistPaneIntent) => {
    tookRequest = true;
    openCollection("playlists", i.id, { title: i.name, artwork: i.artwork, curatorName: i.curatorName }, i.tracks);
  };
  const unsubPlaylistPane = onPlaylistPaneRequest(runPane);
  // "Song Credits" from any card's right-click menu (go-to.ts).
  const runSongPane = (i: SongPaneIntent) => {
    tookRequest = true;
    openSong(i.track);
  };
  const unsubSongPane = onSongPaneRequest(runSongPane);

  // ── menus ──
  const enqueue = (tracks: Track[], how: "now" | "next" | "later", context: string) => {
    addTransientTracks(tracks);
    tracks.forEach(materializeTrack);
    const p =
      how === "now" ? playTracks(tracks, 0, context)
      : how === "next" ? queueTracksNext(tracks, context)
      : queueTracksLater(tracks, context);
    p.catch((e) => console.error("[search] enqueue", e));
  };
  const trackMenu = (e: MouseEvent, t: Track) => {
    menuAt(e, [
      { label: "Play Now", run: () => enqueue([t], "now", "search") },
      { label: "Play Next", run: () => enqueue([t], "next", "search") },
      { label: "Add to Queue", run: () => enqueue([t], "later", "search") },
      // Catalog tracks land as denormalised snapshots — no library/queue
      // materialization needed; the local store is self-contained by design.
      addToPlaylistItem(() => [t]),
      t.catalogId ? { label: "Go to Artist", run: () => goToArtist("songs", t.catalogId!, t.artistName) } : null,
      t.catalogId && t.albumName
        ? { label: "Go to Album", run: () => goToAlbum(t.catalogId!, t.albumName!) }
        : null,
      songCreditsItem(t),
      copySongLinkItem(t.catalogId),
      startStationItem("songs", t.catalogId),
      addSongToLibraryItem(t), // null unless the Library Add toggle is on
      favoriteItem(t), // same consent
    ].filter(Boolean) as MenuItem[]);
  };
  // `artistName` is supplied only where the album's artist isn't already on screen
  // (root results) — omitting it suppresses the redundant "Go to Artist" on album
  // tiles shown INSIDE an artist pane.
  const collectionMenu = (
    e: MouseEvent, kind: "albums" | "playlists", id: string, ctx: string, artistName?: string,
  ) => {
    const fetchThen = (how: "now" | "next" | "later") =>
      collectionTracks(kind, id)
        .then((tracks) => { if (tracks.length) enqueue(tracks, how, ctx); })
        .catch((err) => console.error("[search] collection enqueue", err));
    menuAt(e, [
      { label: "Play Now", run: () => void fetchThen("now") },
      { label: "Play Next", run: () => void fetchThen("next") },
      { label: "Add to Queue", run: () => void fetchThen("later") },
      addToPlaylistItem(() => collectionTracks(kind, id)), // fetch-then-add, lazy on pick
      kind === "albums" && artistName
        ? { label: "Go to Artist", run: () => goToArtist("albums", id, artistName) }
        : null,
      kind === "albums" ? copyAlbumLinkItem(id) : null,
      // Albums add as a library resource (fork A: graduates the album's tracks so they
      // appear right away). Playlists have no add-to-library path here.
      kind === "albums" ? addAlbumToLibraryItem(id, () => collectionTracks(kind, id)) : null,
    ].filter(Boolean) as MenuItem[]);
  };

  // ── root interactions (delegated; survive re-renders) ──
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const pin = t.closest<HTMLElement>("[data-pin]");
    if (pin) {
      togglePin(pin.dataset.pin!);
      return;
    }
    const recent = t.closest<HTMLElement>("[data-recent]");
    if (recent) {
      const term = recent.dataset.recent!;
      // A pinned term brings its category filter back with it.
      const p = loadPins().find((x) => x.term === term);
      if (p && p.types.length) {
        types = [...p.types];
        try { localStorage.setItem(TYPES_KEY, JSON.stringify(types)); } catch { /* ok */ }
        renderFilter();
      }
      input.value = term;
      onInput();
      return;
    }
    const song = t.closest<HTMLElement>("[data-song]");
    if (song) {
      const track = songsById.get(song.dataset.song!);
      if (track && picks.click(e, track)) return; // Ctrl / Shift → a pick, not a play
      if (track) enqueue([track], "now", "search"); // just-the-one (FUTURE-SETTINGS §1 sibling)
      return;
    }
    const artist = t.closest<HTMLElement>("[data-artist]");
    if (artist?.dataset.artist) {
      const a = results?.artists.find((x) => x.catalogId === artist.dataset.artist);
      openArtist(artist.dataset.artist, a?.name ?? "Artist");
      return;
    }
    const album = t.closest<HTMLElement>("[data-album]");
    if (album?.dataset.album) {
      const al = results?.albums.find((x) => x.catalogId === album.dataset.album);
      openCollection("albums", album.dataset.album, { title: al?.title ?? "Album", artwork: al?.artwork, artistName: al?.artistName, releaseDate: al?.releaseDate });
      return;
    }
    const pl = t.closest<HTMLElement>("[data-playlist]");
    if (pl?.dataset.playlist) {
      const p = results?.playlists.find((x) => x.catalogId === pl.dataset.playlist);
      openCollection("playlists", pl.dataset.playlist, { title: p?.name ?? "Playlist", artwork: p?.artwork, curatorName: p?.curatorName });
      return;
    }
    const st = t.closest<HTMLElement>("[data-station]");
    if (st?.dataset.station) {
      const s = results?.stations.find((x) => x.id === st.dataset.station);
      if (s) playStation(s).catch((err) => console.error("[search] play station", err));
    }
  });
  root.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    const song = t.closest<HTMLElement>("[data-song]");
    if (song) {
      const track = songsById.get(song.dataset.song!);
      if (track && picks.size() && picks.isPicked(track)) {
        e.preventDefault();
        menuAt(e, picksMenu(picks.picked(), "search"));
        return;
      }
      if (track) { e.preventDefault(); trackMenu(e, track); }
      return;
    }
    const album = t.closest<HTMLElement>("[data-album]");
    if (album?.dataset.album) {
      e.preventDefault();
      const al = results?.albums.find((x) => x.catalogId === album.dataset.album);
      collectionMenu(e, "albums", album.dataset.album, `search-albums:${album.dataset.album}`, al?.artistName);
      return;
    }
    const pl = t.closest<HTMLElement>("[data-playlist]");
    if (pl?.dataset.playlist) { e.preventDefault(); collectionMenu(e, "playlists", pl.dataset.playlist, `search-playlists:${pl.dataset.playlist}`); return; }
    const artist = t.closest<HTMLElement>("[data-artist]");
    if (artist?.dataset.artist) {
      e.preventDefault();
      const a = results?.artists.find((x) => x.catalogId === artist.dataset.artist);
      menuAt(e, [
        { label: "Go to Artist", run: () => openArtist(artist.dataset.artist!, a?.name ?? "Artist") },
        startStationItem("artists", artist.dataset.artist),
        a ? pinArtistItem(a) : null, // PINS.md: an artist off the library pins from here
      ].filter(Boolean) as MenuItem[]);
      return;
    }
    // A station tile (2026-09-15): the Radio card's menu — play, follow the queue, copy the link.
    const st = t.closest<HTMLElement>("[data-station]");
    if (st?.dataset.station) {
      const s = results?.stations.find((x) => x.id === st.dataset.station);
      if (!s) return;
      e.preventDefault();
      menuAt(e, [
        { label: "Play Now", run: () => void playStation(s).catch((err) => console.error("[search] play station", err)) },
        { label: "Add to Queue", run: () => void queueStationAfter(s).catch((err) => console.error("[search] queue station", err)) },
        copyStationLinkItem(s.url),
      ].filter(Boolean) as MenuItem[]);
    }
  });

  // ── drag sources (DRAG-DROP.md §2): songs, albums, playlists, stations — on the root and
  // in every drill pane. A collection's songs are fetched only at the drop. Artists aren't
  // song lists. ──
  const drag = rowDrag({
    root: panes,
    label: "search",
    rowAt: (target) => {
      if (isAddSquare(target)) return null; // a press on the + adds; it never drags the row
      // A drag off a picked row carries every picked song as ONE payload (§19).
      const setPayload = (t: Track | undefined, context: string) =>
        t && picks.size() > 1 && picks.isPicked(t)
          ? { source: "search" as const, kind: "song" as const, count: picks.size(), tracks: () => picks.picked(), context }
          : null;
      const song = target.closest<HTMLElement>("[data-song]");
      if (song) {
        const t = songsById.get(song.dataset.song!);
        const many = setPayload(t, "search");
        if (many) return { row: song, index: 0, payload: many };
        return t ? { row: song, index: 0, payload: { source: "search", kind: "song", tracks: () => [t], context: "search" } } : null;
      }
      const row = target.closest<HTMLElement>("[data-row]");
      if (row) {
        const scroll = row.closest<HTMLElement>(".spane__scroll");
        const list = scroll ? paneTracks.get(scroll) : undefined;
        const t = list?.tracks[Number(row.dataset.row)];
        const many = list ? setPayload(t, list.context) : null;
        if (many) return { row, index: 0, payload: many };
        return t && list ? { row, index: 0, payload: { source: "search", kind: "song", tracks: () => [t], context: list.context } } : null;
      }
      const album = target.closest<HTMLElement>("[data-album]");
      if (album?.dataset.album) {
        const id = album.dataset.album;
        return {
          row: album, index: 0,
          payload: { source: "search", kind: "album", tracks: () => collectionTracks("albums", id), context: `search-albums:${id}`, albumId: id },
        };
      }
      const pl = target.closest<HTMLElement>("[data-playlist]");
      if (pl?.dataset.playlist) {
        const id = pl.dataset.playlist;
        return {
          row: pl, index: 0,
          payload: { source: "search", kind: "playlist", tracks: () => collectionTracks("playlists", id), context: `search-playlists:${id}` },
        };
      }
      // A station tile (2026-09-15): the Queue card plays it after the queue, Now Playing now.
      const st = target.closest<HTMLElement>("[data-station]");
      if (st?.dataset.station) {
        const s = results?.stations.find((x) => x.id === st.dataset.station);
        return s ? { row: st, index: 0, payload: { source: "search", kind: "station", station: s, tracks: () => [], play: () => playStation(s) } } : null;
      }
      return null;
    },
  });

  backEl.addEventListener("click", backPane);

  renderEmpty();
  notifyHeader();
  takeTerm(); // this card was mounted BY a term request
  // Arrows and the Menu key over the rows and tiles; Escape pops a drill pane (list-keys.ts).
  // Enter / Space are the rows' own (above).
  const unwireKeys = wireListKeys(panes, {
    rows: "[role='button']",
    activate: false,
    back: () => {
      if (!paneStack.length) return false;
      popPane();
      return true;
    },
  });
  // …or BY a drill (CARD-GROW.md §14.5): the intent waits in go-to.ts until this card exists.
  const heldDrill = takeDrillRequest();
  if (heldDrill) runDrill(heldDrill);
  const heldPane = takePlaylistPaneRequest();
  if (heldPane) runPane(heldPane);
  const heldSong = takeSongPaneRequest();
  if (heldSong) runSongPane(heldSong);

  /** Card memory (CARD-MEMORY.md §5a): the term, the results place and every pane. */
  const snapshot = (): SearchSnapshot => ({
    v: 1,
    term: input.value,
    scroll: root.scrollTop,
    panes: paneStack
      .map((p) => {
        const open = paneOpen.get(p);
        return open ? { open, scroll: p.querySelector<HTMLElement>(".spane__scroll")?.scrollTop ?? 0 } : null;
      })
      .filter(Boolean) as { open: PaneOpen; scroll: number }[],
  });

  const openFrom = (o: PaneOpen, scroll: number) => {
    const memory = { instant: true, scroll };
    if (o.kind === "artist") openArtist(o.id, "Artist", memory);
    else if (o.kind === "song") openSong(o.track, memory);
    else if (o.kind === "writer") openWriter(o.name, memory);
    else if (o.kind === "related") drillRelated(o.srcKind, o.srcId, o.rel, o.name, o.rel === "artists" ? fillArtist : (body, albumId, resolved) => fillCollection(body, "albums", albumId, { title: resolved }), memory);
    else openCollection(o.kind === "album" ? "albums" : "playlists", o.id, o.meta, undefined, memory);
  };

  const restore = (s: unknown) => {
    if (!isSearchSnapshot(s) || tookRequest || paneStack.length) return;
    // The way back belongs to the TOP pane a restore opens, not to the first one pushed.
    const ret = pendingReturn && Date.now() - pendingReturn.at < RETURN_TTL_MS ? pendingReturn.cb : null;
    pendingReturn = null;
    if (s.term) {
      input.value = s.term;
      clearBtn.hidden = false;
      // The session cache answers a term searched already, so this costs no Apple call then.
      if (s.term.trim().length >= MIN_CHARS) runSearch(s.term.trim());
    }
    if (s.scroll) root.scrollTop = s.scroll;
    s.panes.forEach((p) => openFrom(p.open, p.scroll));
    const top = paneStack[paneStack.length - 1];
    if (ret && top) {
      paneReturn.set(top, ret);
      syncHeader();
    }
  };
  restore(mountOpts?.memory);

  return {
    snapshot,
    destroy() {
      unsubTerm();
      unwireKeys();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown);
      drag.destroy();
      window.clearTimeout(debounceTimer);
      queryToken++; // orphan any in-flight response
      filterDropdown.destroy(); // drop doc listeners + unregister from the mode fan-out
      unsubDrill(); // stop receiving remote drill intents once unmounted
      unsubPlaylistPane();
      unsubSongPane();
      headerCbs.clear();
      host.innerHTML = "";
    },
    onHeaderChange(cb) {
      headerCbs.add(cb);
      cb({ title: "Search", atRoot: paneStack.length === 0 });
      return () => headerCbs.delete(cb);
    },
  };
}

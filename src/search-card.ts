// Search card (SEARCH.md) — a STANDALONE card, the "searches" screen archetype
// (collections = the engine, queues = the Qcard, searches = this). Blended sectioned
// results: Artists → Songs → Albums → Playlists → Stations, each a horizontal scroller, divided
// by bars; an always-on debounced search bar with a category-filter popover; recents
// as the empty state.
//
// What a result opens — an artist, an album, a playlist, a song, a writer — is a level of the
// collection-card engine, built by media-levels.ts: the same page the Library draws, in the
// same code (ARTIST-VIEW.md §10.1, his calls 2026-10-12/13). The results page stays this card's
// own: the engine starts at the first drill, with a bare root over the results, and Back on the
// first level brings the results back. Search keeps compact rows (never the column table).

import { playTracks, queueTracksNext, queueTracksLater, playStation } from "./player";
import { addTransientTracks } from "./track-store";
import { addSquareHTML, isAddSquare } from "./add-square";
import { reconcile } from "./favorites";
import { openContextMenu, type MenuItem } from "./context-menu";
import { songMenu, albumMenu, artistMenu, playlistMenu, stationMenu, setMenu } from "./media-menu";
import { makeDropdown } from "./dropdown";
import { onAlbumPaneRequest, onArtistPaneRequest, onDrillRequest, onPlaylistPaneRequest, onSongPaneRequest, takeAlbumPaneRequest, takeArtistPaneRequest, takeDrillRequest, takePlaylistPaneRequest, takeSongPaneRequest, type AlbumPaneIntent, type ArtistPaneIntent, type DrillIntent, type PlaylistPaneIntent, type SongPaneIntent } from "./go-to";
import { onSearchTerm, takeSearchTerm, requestLibraryDrill } from "./layout-bus";
import { wireListKeys } from "./list-keys";
import { searchField } from "./search-field";
import { esc, initCollectionCard, type CardSnapshot, type Context } from "./collection-card";
import { explicitBadge, heroCover, musicCell, songsGrouping } from "./library-card";
import { mediaLevels } from "./media-levels";
import {
  searchCatalog, collectionTracks, materializeTrack,
  ALL_TYPES as EVERY_TYPE, type SearchType, type SearchResults, type Artist, type Album, type Playlist,
} from "./search";
import { WEB_ROOMS } from "./platform";

/** The categories this card offers. The web port has no stations: a station leaves a room
 *  (ROOMS.md §10), and a room is all the web port is for (WebRooms.md §9.3 F). */
const ALL_TYPES: SearchType[] = WEB_ROOMS ? EVERY_TYPE.filter((t) => t !== "stations") : EVERY_TYPE;
import type { Track } from "./library";
import type { CardDef, CardInstance, MountOpts } from "./cards";
import { rowDrag } from "./row-drag";
import { rowPick, picksText } from "./row-pick";
import { ruleGrowComing } from "./card-grow";

const TYPES_KEY = "deets.search.types";
const RECENTS_KEY = "deets.search.recents";
const PINS_KEY = "deets.search.pins"; // NEXT-VERSION §1: { term, types }[] — term + category filter
import { ICON_PIN } from "./pins"; // one pin glyph for the app (PINS.md)
import { plainError } from "./plain-error";
import { patchHTML } from "./keyed";
import { revealPictures, type PictureWave } from "./reveal";
import { ROW_PX, TILE_PX } from "./art-size";
const RECENTS_CAP = 8;
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
/** Takes one term out of the ring (a right-click on a Recent pill). */
function removeRecent(term: string): void {
  const r = loadRecents().filter((t) => t !== term);
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

/** Card memory (CARD-MEMORY.md §5a): the term, the results place, and the engine's levels
 *  (keys and view state, as the Library keeps them). v1 held this card's own pane records,
 *  before the levels were the engine's (2026-10-13); a v1 snapshot is not read. */
interface SearchSnapshot {
  v: 2;
  term: string;
  scroll: number;
  levels: CardSnapshot | null;
}
const isSearchSnapshot = (s: unknown): s is SearchSnapshot =>
  !!s && typeof s === "object" && (s as SearchSnapshot).v === 2;

/** The engine's root while the results show: an empty level, never drawn (`bare`). */
const BARE_ROOT: Context = {
  title: "Search",
  density: false,
  groupings: [
    {
      key: "none",
      label: "",
      sorts: [{ key: "none", label: "", type: "str", get: () => undefined }],
      list: () => [],
      name: () => "",
      match: () => false,
      render: () => "",
    },
  ],
};

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
      <div class="coll-views" data-coll-views hidden></div>
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
      <div class="search__panes">
        <div class="spane" data-pos="center"><div class="spane__scroll search__root"></div></div>
        <div class="search__levels coll-body" data-at-root></div>
      </div>
    </div>`;

  const titleEl = host.querySelector<HTMLElement>(".panel__title")!;
  const input = host.querySelector<HTMLInputElement>(".search__input")!;
  const clearBtn = host.querySelector<HTMLButtonElement>(".search__clear")!;
  const filterWrap = host.querySelector<HTMLElement>(".search__filter-wrap")!;
  const filterBtn = host.querySelector<HTMLElement>(".search__filter")!;
  const filterPop = host.querySelector<HTMLElement>(".search__filter-pop")!;
  const bar = host.querySelector<HTMLElement>(".search__bar")!;
  const root = host.querySelector<HTMLElement>(".search__root")!;
  const rootPane = root.closest<HTMLElement>(".spane")!;
  const levelsHost = host.querySelector<HTMLElement>(".search__levels")!;

  let types = loadTypes();
  let results: SearchResults | null = null;
  let lastTerm = "";
  let queryToken = 0;
  const headerCbs = new Set<(h: { title: string; atRoot: boolean }) => void>();
  let tookRequest = false; // a held request beats card memory (CARD-MEMORY.md §4 rule 1)

  // Track lookup for delegated handlers: keyed maps refreshed per render.
  let songsById = new Map<string, Track>();

  // Multi-select (row-pick.ts, NEXT-VERSION §19) over the root's Songs results. A level's
  // rows have the engine's own picks. Keyed by the song. Songs only: an album, playlist or
  // station tile is a drill or a play, not a pick.
  const picks = rowPick<Track>({
    id: (t) => t.catalogId ?? `${t.title} ${t.artistName}`,
    items: () => results?.songs ?? [],
    onChange: () => paintPicks(),
  });

  /** Re-mark the rows and re-draw the count: the Songs section title says how many. */
  const paintPicks = () => {
    picks.mark(root, "[data-song]", (el) => songsById.get(el.dataset.song ?? ""));
    const n = picks.size();
    const title = root.querySelector<HTMLElement>(".search__scroller--songs")?.previousElementSibling;
    if (title) title.textContent = n ? `Songs · ${picksText(n)}` : "Songs";
  };

  // ── the levels (ARTIST-VIEW.md §10.1) ──
  // What a result opens is an engine level, the same page the Library draws (media-levels.ts).
  // The engine runs on this card's head — its Back, its title, the Full | Lib chips — over a
  // bare root: the results page is this card's own, under the levels.
  let atRoot = true;
  let instantNext = false; // a card-memory restore: the results step aside with no slide
  const onLevel = (now: boolean) => {
    if (now === atRoot) return;
    atRoot = now;
    levelsHost.toggleAttribute("data-at-root", now);
    // The results' picks belong to the results (§19): a drill drops them, as before.
    if (!now) picks.clear();
    // The results slide with the level, as one page (the engine's --nav-* motion): out as the
    // first level comes in, back as the last one leaves. A rule grow or a restore: in place.
    // After the engine's own steps, so the rule grow is known (RULES.md §10).
    queueMicrotask(() => {
      const still = instantNext || (!now && ruleGrowComing(host.dataset.mounted ?? "search"));
      instantNext = false;
      if (still) rootPane.style.transition = "none";
      rootPane.dataset.pos = now ? "center" : "left";
      if (still) {
        void rootPane.offsetWidth;
        rootPane.style.transition = "";
      }
    });
  };
  const levels = mediaLevels({
    card: () => engine,
    songs: songsGrouping,
    heroCover,
    cell: musicCell,
    // A genre is the Library's own view (his call, 2026-10-13): Go to Genre summons it.
    genre: (name) => requestLibraryDrill({ kind: "genre", name }),
    playlistsHere: true,
  });
  const engine = initCollectionCard({
    root: host,
    storeKey: "deets.search.levels",
    rootContext: () => BARE_ROOT,
    bare: true,
    finder: false, // Ctrl+F is the Search field's (SEARCH-FIELDS.md), at every level
    grown: () => null, // compact rows, never the column table, even grown (his call)
    resolve: (key) => levels.resolve(key),
    onReturn: mountOpts?.onReturn,
    returnTitle: mountOpts?.returnTitle,
    onHeader: (h) => {
      onLevel(h.atRoot);
      headerCbs.forEach((cb) => cb(h));
    },
  });
  /** Open a level from the results or from a request. `mountStill`: a request taken at the
   *  mount of a drill swap, whose slide brings the card in with the level on it already. */
  let mountStill = false;
  const open = (ctx: Context) => {
    if (mountStill) instantNext = true; // the results step aside with no slide too
    engine.drill(ctx, mountStill);
  };

  /** The menu for a picked set of songs (§19). */
  const picksMenu = (ts: Track[], context: string): MenuItem[] =>
    setMenu(() => ts, ts.length, "song", { context, catalog: true });

  // A right-clicked row or tile wears `is-context` (the outline) while its menu is open, as
  // in the Library, Queue and History cards.
  const menuAt = (e: MouseEvent, items: MenuItem[]) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".search__song, .search__tile, .search__artist");
    el?.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, items, () => el?.classList.remove("is-context"));
  };
  // The Add-to-Library square on the root's song rows: add-square.ts draws it with its state
  // and hears its press.
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
  let pics: PictureWave = { releaseAll: () => {}, cancel: () => {} };
  const renderEmpty = () => {
    pics.cancel();
    const pins = loadPins();
    const recents = loadRecents().filter((t) => !pins.some((p) => p.term === t));
    const pinned = pins.map((p) => pillHTML(p.term, true)).join("");
    const recent = recents.map((t) => pillHTML(t, false)).join("");
    patchHTML(
      root,
      (pinned ? `<div class="search__label">Pinned</div><div class="search__recents" data-key="pinned">${pinned}</div>` : "") +
        (recent ? `<div class="search__label">Recent</div><div class="search__recents" data-key="recent">${recent}</div>` : ""),
    );
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
    return `<div class="search__song" data-k="song:${esc(id || `${t.title} ${t.artistName}`)}" data-song="${esc(id)}"${id ? ` data-cid="${esc(id)}"` : ""} role="button" tabindex="0">
      ${coverHTML(art(t.artwork?.urlTemplate, ROW_PX), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}${explicitBadge(t)}</span><span class="search__song-artist">${esc(t.artistName)}</span></div>
      ${addBtnHTML(t)}
    </div>`;
  };

  const tileCell = (kind: "album" | "playlist" | "station", id: string, name: string, sub: string, cover: string | null): string =>
    `<div class="search__tile" data-k="${kind}:${esc(id || name)}" data-${kind}="${esc(id)}" role="button" tabindex="0">
      ${coverHTML(cover, "search__tile-art")}
      <span class="search__tile-name">${esc(name)}</span>${sub ? `<span class="search__tile-sub">${esc(sub)}</span>` : ""}
    </div>`;

  const artistCell = (a: Artist): string =>
    `<div class="search__artist" data-k="artist:${esc(a.catalogId ?? a.name)}" data-artist="${esc(a.catalogId ?? "")}" role="button" tabindex="0">
      ${coverHTML(art(a.artwork?.urlTemplate, TILE_PX), "search__artist-art")}
      <span class="search__artist-name">${esc(a.name)}</span>
    </div>`;

  const renderResults = () => {
    if (!results) return renderEmpty();
    songsById = new Map(results.songs.filter((t) => t.catalogId).map((t) => [t.catalogId!, t]));
    const sections: string[] = [];
    const bodies: Record<SearchType, () => string> = {
      artists: () => results!.artists.map(artistCell).join(""),
      songs: () => results!.songs.map(songCell).join(""),
      albums: () =>
        results!.albums
          .map((a) => tileCell("album", a.catalogId ?? "", a.title, a.artistName, art(a.artwork?.urlTemplate, TILE_PX)))
          .join(""),
      playlists: () =>
        results!.playlists
          .map((p) => tileCell("playlist", p.catalogId ?? "", p.name, p.curatorName ?? "", art(p.artwork?.urlTemplate, TILE_PX)))
          .join(""),
      // A station tile plays on tap (radio mode) — no drill, no queue (STATIONS.md §1).
      stations: () =>
        results!.stations
          .map((s) => tileCell("station", s.id, s.name, s.isLive ? "Live" : s.tagline ?? "", art(s.artwork?.urlTemplate, TILE_PX)))
          .join(""),
    };
    for (const sec of SECTION_ORDER) {
      if (!types.includes(sec)) continue;
      const count = results[sec].length;
      if (!count) continue;
      sections.push(`<section class="search__sec" data-key="sec:${sec}">
        <h3 class="search__sec-title">${SECTION_LABEL[sec]}</h3>
        <div class="search__scroller search__scroller--${sec}">${bodies[sec]()}</div>
      </section>`);
    }
    // A keyed patch (keyed.ts, UX-COVERUPS.md §7.7 step 2): an answer that shares results with
    // the last one keeps those cells and their covers (4–6 made again per answer, 7.13).
    patchHTML(root, sections.length
      ? sections.join("")
      : `<p class="search__prompt">No results for “${esc(lastTerm)}”.</p>`);
    if (atRoot) paintPicks(); // re-mark what is still picked after a redraw
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
        // His S2 A (UX-COVERUPS.md §7.10): the words are in now; each section's new covers
        // wait for its own first screen (at most --search-reveal-cap) and fade in as one wave.
        pics.cancel();
        pics = revealPictures("search", [...root.querySelectorAll<HTMLElement>(".search__sec")], ".search__song, .search__tile, .search__artist");
      })
      .catch((e) => {
        if (token !== queryToken) return;
        // Plain words: "Search failed: Error: …" read as a bug, not as "no connection" (2026-09-29).
        console.warn("[search]", e);
        root.innerHTML = `<p class="search__prompt">${esc(plainError(e, "Couldn't reach Apple Music. Check your connection, then search again."))}</p>`;
      })
      .finally(() => {
        if (token === queryToken) bar.classList.remove("search__bar--busy");
      });
  };

  // The search bar owns the card: any keystroke (or a clear, or a recents tap) returns to the
  // root results at once. Otherwise a drill pane stays on top and hides the new results
  // rendered into `root` below it. Too short a term shows Recents and cancels what is in flight.
  const toRootFor = (term: string): boolean => {
    engine.toRoot();
    if (term.length >= MIN_CHARS) return true;
    queryToken++; // cancel any in-flight response
    bar.classList.remove("search__bar--busy");
    results = null;
    renderEmpty();
    return false;
  };
  input.addEventListener("input", () => void toRootFor(input.value.trim()));
  // The field's own parts (search-field.ts, SEARCH-FIELDS.md §3): the ×, Escape (clears, then
  // the focus leaves: Recents show), Ctrl+F, the Apple delay, and ↓ to the first result.
  const field = searchField(input, {
    delay: "apple",
    clear: clearBtn,
    finder: { root: host },
    // ↓ from the field: the first result, or the open level's rows.
    first: () =>
      atRoot
        ? (pics.releaseAll(), root.querySelector<HTMLElement>("[role='button']"))
        : levelsHost.querySelector<HTMLElement>('.coll-pane[data-pos="center"] [data-view]'),
    onTerm: (term) => {
      if (toRootFor(term)) runSearch(term);
    },
  });
  // A term from outside (the Compass, COMPASS.md §2): typed into the field, the search runs.
  const takeTerm = () => {
    const term = takeSearchTerm();
    if (term === null) return;
    field.set(term);
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

  // Escape drops the picks; Ctrl+A takes the results' songs. Gated on the last press inside
  // the results — a row carries no tabindex, so the focus never leaves <body>. A level's rows
  // have the engine's own keys.
  let touched = false;
  root.addEventListener("pointerdown", () => {
    touched = true;
  });
  const onDocDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) touched = false;
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable]")) return; // the search field keeps its own
    if (e.key === "Escape") {
      picks.clear();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && touched && atRoot) {
      e.preventDefault();
      picks.all();
    }
  };
  document.addEventListener("pointerdown", onDocDown);
  document.addEventListener("keydown", onKey);

  // ── what opens a level ──
  // A result (below, `root`'s clicks) and a request from another card (go-to.ts): other cards'
  // "Go to Artist / Album", a Featured playlist, a pinned album, "Song Credits" summon this
  // card and hand it the intent. Each opens the same level the Library would draw.

  /** A song's or an album's artist, or a song's album, by one memoized hop (DrillIntent). The
   *  name is the source row's own: shown until Apple answers, never asked of Last.fm. */
  const runDrill = (intent: DrillIntent) => {
    tookRequest = true;
    if (intent.rel === "artists")
      open(
        levels.fullArtist(
          { name: intent.name, named: false, albumId: intent.srcKind === "albums" ? intent.srcId : undefined },
          intent.srcKind === "songs" ? intent.srcId : undefined,
        ),
      );
    else open(levels.fullAlbum({ songId: intent.srcId, name: intent.name }));
  };
  const unsubDrill = onDrillRequest(runDrill);
  // A Featured Playlists tile on the Library artist view, with its songs from the chip flight.
  const runPane = (i: PlaylistPaneIntent) => {
    tookRequest = true;
    open(levels.playlist({ id: i.id, name: i.name, artwork: i.artwork, curatorName: i.curatorName, tracks: i.tracks }));
  };
  const unsubPlaylistPane = onPlaylistPaneRequest(runPane);
  // An album by its OWN id, from any card that holds one: no hop.
  const runAlbumPane = (i: AlbumPaneIntent) => {
    tookRequest = true;
    open(levels.fullAlbum({ albumId: i.id, name: i.name, artwork: i.artwork, artist: i.artistName, releaseDate: i.releaseDate }));
  };
  const unsubAlbumPane = onAlbumPaneRequest(runAlbumPane);
  // An artist by its OWN id (a Search artist tile's "Go to Artist", a pinned artist).
  const runArtistPane = (i: ArtistPaneIntent) => {
    tookRequest = true;
    open(levels.fullArtist({ name: i.name, id: i.id }));
  };
  const unsubArtistPane = onArtistPaneRequest(runArtistPane);
  // "Song Credits" from any card's right-click menu.
  const runSongPane = (i: SongPaneIntent) => {
    tookRequest = true;
    open(levels.song(i.track));
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
  // The menus are the shared ones (CONTEXT-MENUS.md). Catalog songs join the store before
  // they play (`catalog`), as a Search play always did.
  const songMenuAt = (e: MouseEvent, t: Track) => menuAt(e, songMenu(t, { context: "search", catalog: true }));
  // `inArtist`: an album tile INSIDE an artist pane, where Go to Artist would go where you are.
  const albumMenuAt = (e: MouseEvent, al: Album, inArtist = false) => {
    const id = al.catalogId;
    if (!id) return;
    menuAt(e, albumMenu(
      { title: al.title, artistName: al.artistName, artwork: al.artwork, catalogId: id, known: [], whole: () => collectionTracks("albums", id), catalog: true },
      { context: `search-albums:${id}`, inArtist },
    ));
  };
  const playlistMenuAt = (e: MouseEvent, p: Playlist) => {
    const id = p.catalogId;
    if (!id) return;
    menuAt(e, playlistMenu(p, () => collectionTracks("playlists", id), { context: `search-playlists:${id}`, catalog: true }));
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
      field.set(term);
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
      open(levels.fullArtist({ name: a?.name ?? "", id: artist.dataset.artist, artwork: a?.artwork }));
      return;
    }
    const album = t.closest<HTMLElement>("[data-album]");
    if (album?.dataset.album) {
      const al = results?.albums.find((x) => x.catalogId === album.dataset.album);
      open(levels.fullAlbum({ albumId: album.dataset.album, name: al?.title ?? "Album", artwork: al?.artwork, artist: al?.artistName, releaseDate: al?.releaseDate }));
      return;
    }
    const pl = t.closest<HTMLElement>("[data-playlist]");
    if (pl?.dataset.playlist) {
      const p = results?.playlists.find((x) => x.catalogId === pl.dataset.playlist);
      open(levels.playlist({ id: pl.dataset.playlist, name: p?.name ?? "Playlist", artwork: p?.artwork, curatorName: p?.curatorName }));
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
    // A term pill: a Recent one offers Pin + Remove from Recent, a pinned one Unpin. The
    // whole pill wears the outline, both halves.
    const pill = t.closest<HTMLElement>(".search__recent");
    if (pill) {
      const term = pill.querySelector<HTMLElement>("[data-recent]")?.dataset.recent;
      if (!term) return;
      e.preventDefault();
      pill.classList.add("is-context");
      const items: MenuItem[] = pill.classList.contains("is-pinned")
        ? [{ label: "Unpin", run: () => togglePin(term) }]
        : [
            { label: "Pin", run: () => togglePin(term) },
            { label: "Remove from Recent", run: () => { removeRecent(term); renderEmpty(); } },
          ];
      openContextMenu(e.clientX, e.clientY, items, () => pill.classList.remove("is-context"));
      return;
    }
    const song = t.closest<HTMLElement>("[data-song]");
    if (song) {
      const track = songsById.get(song.dataset.song!);
      if (track && picks.size() && picks.isPicked(track)) {
        e.preventDefault();
        menuAt(e, picksMenu(picks.picked(), "search"));
        return;
      }
      if (track) { e.preventDefault(); songMenuAt(e, track); }
      return;
    }
    const album = t.closest<HTMLElement>("[data-album]");
    if (album?.dataset.album) {
      e.preventDefault();
      const al = results?.albums.find((x) => x.catalogId === album.dataset.album);
      if (al) albumMenuAt(e, al);
      return;
    }
    const pl = t.closest<HTMLElement>("[data-playlist]");
    if (pl?.dataset.playlist) {
      e.preventDefault();
      const p = results?.playlists.find((x) => x.catalogId === pl.dataset.playlist);
      if (p) playlistMenuAt(e, p);
      return;
    }
    const artist = t.closest<HTMLElement>("[data-artist]");
    if (artist?.dataset.artist) {
      e.preventDefault();
      const id = artist.dataset.artist;
      const a = results?.artists.find((x) => x.catalogId === id);
      // An artist off the library plays Apple's Top Songs, and pins with its snapshot.
      menuAt(e, artistMenu({ name: a?.name ?? "Artist", catalogId: id, artwork: a?.artwork }, { context: `search-artist:${id}` }));
      return;
    }
    // A station tile: the station menu, as on the Radio card.
    const st = t.closest<HTMLElement>("[data-station]");
    if (st?.dataset.station) {
      const s = results?.stations.find((x) => x.id === st.dataset.station);
      if (!s) return;
      e.preventDefault();
      menuAt(e, stationMenu(s, { context: `station:${s.id}` }));
    }
  });

  // ── drag sources (DRAG-DROP.md §2): songs, albums, playlists, stations on the results. A
  // collection's songs are fetched only at the drop. Artists aren't song lists. A level's rows
  // are the engine's own drags. ──
  const drag = rowDrag({
    root: rootPane,
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

  renderEmpty();
  takeTerm(); // this card was mounted BY a term request
  // Arrows and the Menu key over the results' rows and tiles (list-keys.ts). Enter / Space are
  // the rows' own (above). A level's rows have the engine's keys, Escape = Back among them.
  const unwireKeys = wireListKeys(root, {
    rows: "[role='button']",
    activate: false,
    back: () => false,
  });
  // …or BY a drill (CARD-GROW.md §14.5): the intent waits in go-to.ts until this card exists.
  mountStill = !!mountOpts?.drilled;
  const heldDrill = takeDrillRequest();
  if (heldDrill) runDrill(heldDrill);
  const heldPane = takePlaylistPaneRequest();
  if (heldPane) runPane(heldPane);
  const heldAlbum = takeAlbumPaneRequest();
  if (heldAlbum) runAlbumPane(heldAlbum);
  const heldArtist = takeArtistPaneRequest();
  if (heldArtist) runArtistPane(heldArtist);
  const heldSong = takeSongPaneRequest();
  if (heldSong) runSongPane(heldSong);
  mountStill = false;

  /** Card memory (CARD-MEMORY.md §5a): the term, the results place, and the open levels. */
  const snapshot = (): SearchSnapshot => ({
    v: 2,
    term: input.value,
    scroll: root.scrollTop,
    levels: engine.depth() > 1 ? engine.snapshot() : null,
  });

  const restore = (s: unknown) => {
    if (!isSearchSnapshot(s) || tookRequest || engine.depth() > 1) return;
    if (s.term) {
      input.value = s.term;
      field.sync();
      // The session cache answers a term searched already, so this costs no Apple call then.
      if (s.term.trim().length >= MIN_CHARS) runSearch(s.term.trim());
    }
    if (s.scroll) root.scrollTop = s.scroll;
    // The levels come back in place, as the Library's do (CARD-MEMORY.md §4 rule 2); the way
    // back of a drill swap rides the engine's own (`onReturn`).
    if (s.levels) {
      instantNext = true;
      if (!engine.restore(s.levels)) instantNext = false;
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
      field.destroy();
      engine.destroy();
      queryToken++; // orphan any in-flight response
      filterDropdown.destroy(); // drop doc listeners + unregister from the mode fan-out
      unsubDrill(); // stop receiving remote drill intents once unmounted
      unsubPlaylistPane();
      unsubAlbumPane();
      unsubArtistPane();
      unsubSongPane();
      headerCbs.clear();
      host.innerHTML = "";
    },
    onHeaderChange(cb) {
      headerCbs.add(cb);
      cb({ title: titleEl.textContent ?? "Search", atRoot });
      return () => headerCbs.delete(cb);
    },
  };
}

// Search card (SEARCH.md) — a STANDALONE card, the "searches" screen archetype
// (collections = the engine, queues = the Qcard, searches = this). Blended sectioned
// results: Artists → Songs → Albums → Playlists → Stations, each a horizontal scroller, divided
// by bars; an always-on debounced search bar with a category-filter popover; recents
// as the empty state; drill-in panes riding the same --nav-* motion tokens as the
// engine (shared idiom, not shared code).

import { playTracks, queueTracksNext, queueTracksLater, playStation } from "./player";
import { addTransientTracks, onTracksChange } from "./track-store";
import { addToPlaylistItem } from "./playlists";
import * as frames from "./frames";
import {
  addSongToLibraryItem, addAlbumToLibraryItem, addTrackToLibrary, libraryAddEnabled, libraryAddOffered, onLibraryAddChange,
} from "./library-add";
import { startStationItem } from "./start-station";
import { favoriteItem, reconcile } from "./favorites";
import { openContextMenu, type MenuItem } from "./context-menu";
import { copySongLinkItem, copyAlbumLinkItem } from "./copy-link";
import { makeDropdown } from "./dropdown";
import { onDrillRequest } from "./go-to";
import { esc, formatTotal } from "./collection-card";
import { explicitBadge, heroCover } from "./library-card";
import {
  searchCatalog, collectionTracks, artistDetail, materializeTrack, catalogRelated,
  ALL_TYPES, type SearchType, type SearchResults, type Artist,
} from "./search";
import type { Track, Artwork } from "./library";
import type { CardDef, CardInstance } from "./cards";

const TYPES_KEY = "deets.search.types";
const RECENTS_KEY = "deets.search.recents";
const PINS_KEY = "deets.search.pins"; // NEXT-VERSION §1: { term, types }[] — term + category filter
const ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>';
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

export const searchCard: CardDef = {
  id: "search",
  title: "Search",
  mount: (host) => mountSearch(host),
};

function mountSearch(host: HTMLElement): CardInstance {
  host.innerHTML = `
    <header class="panel__head"><h2 class="panel__title">Search</h2></header>
    <div class="panel__body search">
      <div class="search__bar">
        <div class="search__field">
          <svg class="search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
          <input class="search__input" type="search" placeholder="Search Apple Music" spellcheck="false" />
          <span class="search__busy" aria-hidden="true"></span>
          <button class="search__clear" type="button" aria-label="Clear search" hidden>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="search__filter-wrap">
          <button class="search__filter" type="button" aria-label="Filter categories" aria-haspopup="true" aria-expanded="false">
            <svg class="search__filter-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h12M4 8h8M6 11h4"/></svg>
          </button>
          <div class="search__filter-pop" role="menu" aria-label="Filter categories" hidden></div>
        </div>
      </div>
      <div class="search__panes"><div class="spane" data-pos="center"><div class="spane__scroll search__root"></div></div></div>
    </div>`;

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
  const notifyHeader = () =>
    headerCbs.forEach((cb) => cb({ title: "Search", atRoot: paneStack.length === 0 }));

  // Track lookup for delegated handlers: keyed maps refreshed per render.
  let songsById = new Map<string, Track>();

  // ── Add-to-Library square on song rows (root Songs grid + drill-pane track lists) ──
  // Mirrors the Now Playing "+": a press IS the consent (addTrackToLibrary), the Library
  // Add toggle is the only thing that removes it. "+" when not in the library, ✓ when it
  // is. Shown on row hover/focus (CSS). Membership is the local store — no Apple call
  // until a press.
  const addable = new Map<string, Track>(); // catalogId → the row's track
  const adding = new Set<string>();
  const addBtnHTML = (t: Track): string => {
    if (!t.catalogId) return "";
    addable.set(t.catalogId, t);
    return `<button class="panel__action search__add" type="button" data-add="${esc(t.catalogId)}" hidden></button>`;
  };
  const paintAdd = (btn: HTMLButtonElement) => {
    const id = btn.dataset.add!;
    const t = addable.get(id);
    btn.hidden = !t || !libraryAddEnabled();
    if (btn.hidden || !t) return;
    const busy = adding.has(id);
    const inLib = !busy && !libraryAddOffered(t);
    btn.classList.toggle("is-busy", busy);
    btn.classList.toggle("is-in", inLib);
    btn.setAttribute("aria-disabled", String(inLib || busy));
    btn.innerHTML = inLib ? ICON_CHECK : ICON_PLUS;
    const label = inLib ? "In your library" : "Add to Library";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  };
  const refreshAdds = () => host.querySelectorAll<HTMLButtonElement>("[data-add]").forEach(paintAdd);
  // Capture phase on the host: runs before the row's play handlers (root + panes) and
  // stops the press from also playing the song.
  host.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const id = btn.dataset.add!;
    const t = addable.get(id);
    if (!t || adding.has(id) || !libraryAddOffered(t)) return;
    adding.add(id);
    paintAdd(btn);
    addTrackToLibrary(t)
      .catch((err) => console.error("[search] add to library", err))
      .finally(() => {
        adding.delete(id);
        refreshAdds();
      });
  }, true);
  const unsubAddTracks = onTracksChange(refreshAdds, "search.add");
  const unsubAddToggle = onLibraryAddChange(refreshAdds);

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
    return `<div class="search__song" data-song="${esc(id)}" role="button" tabindex="0">
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
    refreshAdds();
  };

  // ── querying ──
  const runSearch = (term: string) => {
    const token = ++queryToken;
    bar.classList.add("search__bar--busy");
    searchCatalog(term, types)
      .then((r) => {
        if (token !== queryToken) return; // stale — a newer term is in flight
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
    fill: (body: HTMLElement, setTitle: (t: string) => void) => void,
  ) => {
    const pane = document.createElement("div");
    pane.className = "spane";
    pane.dataset.pos = "right";
    pane.innerHTML = `
      <div class="spane__head"><button class="spane__back" type="button" aria-label="Back">‹</button><span class="spane__title">${esc(title)}</span></div>
      <div class="spane__scroll"></div>`;
    panes.appendChild(pane);
    // setTitle lets a drill-in relabel the pane once the target resolves (fallback
    // name shown while the id hop is in flight, real name swapped in on arrival).
    const titleEl = pane.querySelector<HTMLElement>(".spane__title")!;
    fill(pane.querySelector<HTMLElement>(".spane__scroll")!, (t) => { titleEl.textContent = t; });
    const below = paneStack[paneStack.length - 1] ?? panes.querySelector<HTMLElement>('.spane[data-pos="center"]');
    void pane.offsetWidth; // commit the off-screen position before sliding in
    frames.during("slide", 450, "search-push");
    pane.dataset.pos = "center";
    if (below) below.dataset.pos = "left";
    paneStack.push(pane);
    pane.querySelector(".spane__back")!.addEventListener("click", popPane);
    notifyHeader();
  };
  const popPane = () => {
    const pane = paneStack.pop();
    if (!pane) return;
    const below = paneStack[paneStack.length - 1] ?? panes.querySelector<HTMLElement>(".spane:first-child");
    frames.during("slide", 450, "search-pop");
    pane.dataset.pos = "right";
    if (below) below.dataset.pos = "center";
    window.setTimeout(() => pane.remove(), 400); // past --nav-dur; cheap cleanup
    notifyHeader();
  };
  /** Drop every drill pane at once, so `root` is the visible pane again. */
  const resetToRoot = () => { while (paneStack.length) popPane(); };

  const listRow = (t: Track, i: number): string =>
    `<div class="search__row" data-row="${i}" role="button" tabindex="0">
      ${coverHTML(art(t.artwork?.urlTemplate, 72), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}${explicitBadge(t)}</span><span class="search__song-artist">${esc(t.artistName)}</span></div>
      ${addBtnHTML(t)}
    </div>`;

  /** A detail pane's track list: tap plays the list from that row (Library semantics). */
  const wireTrackList = (body: HTMLElement, tracks: Track[], context: string) => {
    body.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
      if (!row) return;
      const idx = Number(row.dataset.row);
      addTransientTracks(tracks);
      tracks.forEach(materializeTrack);
      playTracks(tracks, idx, context).catch((err) => console.error("[search] play", err));
    });
    body.addEventListener("contextmenu", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
      if (!row) return;
      e.preventDefault();
      const t = tracks[Number(row.dataset.row)];
      if (t) trackMenu(e, t);
    });
  };

  // Body fillers, split from the open* wrappers so the drill-ins can reuse them:
  // a drill opens the pane on the FALLBACK name, then fills once the id resolves.
  // What the hero knows before the tracks land: the result tile's own facts. Anything
  // missing (a drill-in only has a name) falls back to the first track.
  interface CollectionMeta { title: string; artwork?: Artwork; artistName?: string; releaseDate?: string; curatorName?: string }
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
  const fillCollection = (body: HTMLElement, kind: "albums" | "playlists", id: string, meta: CollectionMeta) => {
    body.innerHTML = `<p class="search__prompt">Loading…</p>`;
    collectionTracks(kind, id)
      .then((tracks) => {
        body.innerHTML = heroHTML(kind, meta, tracks) + (tracks.map(listRow).join("") || `<p class="search__prompt">No songs.</p>`);
        wireTrackList(body, tracks, `search-${kind}:${id}`);
        refreshAdds();
        // The album hero's artist subtitle → the artist pane, via the album's own relationship.
        body.querySelector<HTMLElement>("[data-hero-artist]")?.addEventListener("click", (e) => {
          e.stopPropagation();
          goToArtist("albums", id, (e.currentTarget as HTMLElement).dataset.heroArtist ?? "Artist");
        });
      })
      .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
  };
  // The pane header shows the kind; the hero owns the name.
  const openCollection = (kind: "albums" | "playlists", id: string, meta: CollectionMeta) =>
    pushPane(kind === "albums" ? "Album" : "Playlist", (body) => fillCollection(body, kind, id, meta));

  const fillArtist = (body: HTMLElement, id: string) => {
      body.innerHTML = `<p class="search__prompt">Loading…</p>`;
      artistDetail(id)
        .then((d) => {
          const albums = d.albums
            .map((a) => tileCell("album", a.catalogId ?? "", a.title, a.releaseDate?.slice(0, 4) ?? "", art(a.artwork?.urlTemplate, 128)))
            .join("");
          body.innerHTML = `
            ${albums ? `<div class="search__label">Albums</div><div class="search__scroller search__scroller--albums">${albums}</div>` : ""}
            <div class="search__label">Top Songs</div>
            ${d.topSongs.map(listRow).join("") || `<p class="search__prompt">No songs.</p>`}`;
          wireTrackList(body, d.topSongs, `search-artist:${id}`);
          refreshAdds();
          body.addEventListener("click", (e) => {
            const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-album]");
            if (!tile) return;
            const al = d.albums.find((a) => a.catalogId === tile.dataset.album);
            if (al?.catalogId) openCollection("albums", al.catalogId, { title: al.title, artwork: al.artwork, artistName: d.artist.name, releaseDate: al.releaseDate });
          });
          // Album tiles live outside `root`, so the root's delegated right-click doesn't
          // reach them — wire the same fetch-then-enqueue menu here (else native menu shows).
          body.addEventListener("contextmenu", (e) => {
            const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-album]");
            if (!tile?.dataset.album) return;
            e.preventDefault();
            collectionMenu(e, "albums", tile.dataset.album, `search-albums:${tile.dataset.album}`);
          });
        })
        .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
  };
  const openArtist = (id: string, name: string) => pushPane(name, (body) => fillArtist(body, id));

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
  ) =>
    pushPane(fallbackName, (body, setTitle) => {
      body.innerHTML = `<p class="search__prompt">Loading…</p>`;
      catalogRelated(kind, id, rel)
        .then((ref) => {
          if (!ref) { body.innerHTML = `<p class="search__prompt">Not found.</p>`; return; }
          // An album pane's header reads "Album" (the hero carries the name); an artist pane keeps the name.
          setTitle(rel === "albums" ? "Album" : ref.name || fallbackName);
          fill(body, ref.id, ref.name || fallbackName);
        })
        .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
    });
  const goToArtist = (kind: "songs" | "albums", id: string, name: string) =>
    drillRelated(kind, id, "artists", name, fillArtist);
  const goToAlbum = (songId: string, name: string) =>
    drillRelated("songs", songId, "albums", name, (body, albumId, resolved) => fillCollection(body, "albums", albumId, { title: resolved }));

  // Remote drill-ins: other cards' "Go to Artist/Album" summon this card (go-to.ts)
  // and emit an intent here. Same machinery as an in-card drill — a pane pushes on top
  // of whatever the search card is currently showing.
  const unsubDrill = onDrillRequest((intent) => {
    if (intent.rel === "artists") goToArtist(intent.srcKind, intent.srcId, intent.name);
    else goToAlbum(intent.srcId, intent.name);
  });

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
    openContextMenu(e.clientX, e.clientY, [
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
    openContextMenu(e.clientX, e.clientY, [
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
      openContextMenu(e.clientX, e.clientY, [
        { label: "Go to Artist", run: () => openArtist(artist.dataset.artist!, a?.name ?? "Artist") },
        startStationItem("artists", artist.dataset.artist),
      ].filter(Boolean) as MenuItem[]);
    }
  });

  renderEmpty();
  notifyHeader();

  return {
    destroy() {
      window.clearTimeout(debounceTimer);
      queryToken++; // orphan any in-flight response
      filterDropdown.destroy(); // drop doc listeners + unregister from the mode fan-out
      unsubDrill(); // stop receiving remote drill intents once unmounted
      unsubAddTracks();
      unsubAddToggle();
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

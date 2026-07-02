// Search card (SEARCH.md) — a STANDALONE card, the "searches" screen archetype
// (collections = the engine, queues = the Qcard, searches = this). Blended sectioned
// results: Artists → Songs → Albums → Playlists, each a horizontal scroller, divided
// by bars; an always-on debounced search bar with a category-filter popover; recents
// as the empty state; drill-in panes riding the same --nav-* motion tokens as the
// engine (shared idiom, not shared code).

import { playTracks, queueTracksNext, queueTracksLater } from "./player";
import { addTransientTracks } from "./track-store";
import { openContextMenu } from "./context-menu";
import { makeDropdown } from "./dropdown";
import { esc } from "./collection-card";
import {
  searchCatalog, collectionTracks, artistDetail, materializeTrack,
  ALL_TYPES, type SearchType, type SearchResults, type Artist,
} from "./search";
import type { Track } from "./library";
import type { CardDef, CardInstance } from "./cards";

const TYPES_KEY = "deets.search.types";
const RECENTS_KEY = "deets.search.recents";
const RECENTS_CAP = 8;
const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

const SECTION_LABEL: Record<SearchType, string> = {
  artists: "Artists", songs: "Songs", albums: "Albums", playlists: "Playlists",
};
const SECTION_ORDER: SearchType[] = ["artists", "songs", "albums", "playlists"];

const art = (tmpl: string | undefined, px: number): string | null =>
  tmpl ? tmpl.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;

const coverHTML = (url: string | null, cls: string): string =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" />`
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

  // ── root rendering ──
  const renderEmpty = () => {
    const recents = loadRecents();
    const rows = recents
      .map((t) => `<button class="search__recent" type="button" data-recent="${esc(t)}">${esc(t)}</button>`)
      .join("");
    root.innerHTML = recents.length
      ? `<div class="search__label">Recent</div><div class="search__recents">${rows}</div>`
      : "";
  };

  const songCell = (t: Track): string => {
    const id = t.catalogId ?? "";
    return `<div class="search__song" data-song="${esc(id)}" role="button" tabindex="0">
      ${coverHTML(art(t.artwork?.urlTemplate, 72), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}</span><span class="search__song-artist">${esc(t.artistName)}</span></div>
    </div>`;
  };

  const tileCell = (kind: "album" | "playlist", id: string, name: string, sub: string, cover: string | null): string =>
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
        pushRecent(term);
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
  const pushPane = (title: string, fill: (body: HTMLElement) => void) => {
    const pane = document.createElement("div");
    pane.className = "spane";
    pane.dataset.pos = "right";
    pane.innerHTML = `
      <div class="spane__head"><button class="spane__back" type="button" aria-label="Back">‹</button><span class="spane__title">${esc(title)}</span></div>
      <div class="spane__scroll"></div>`;
    panes.appendChild(pane);
    fill(pane.querySelector<HTMLElement>(".spane__scroll")!);
    const below = paneStack[paneStack.length - 1] ?? panes.querySelector<HTMLElement>('.spane[data-pos="center"]');
    void pane.offsetWidth; // commit the off-screen position before sliding in
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
    pane.dataset.pos = "right";
    if (below) below.dataset.pos = "center";
    window.setTimeout(() => pane.remove(), 400); // past --nav-dur; cheap cleanup
    notifyHeader();
  };

  const listRow = (t: Track, i: number): string =>
    `<div class="search__row" data-row="${i}" role="button" tabindex="0">
      ${coverHTML(art(t.artwork?.urlTemplate, 72), "search__song-art")}
      <div class="search__song-text"><span class="search__song-title">${esc(t.title)}</span><span class="search__song-artist">${esc(t.artistName)}</span></div>
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

  const openCollection = (kind: "albums" | "playlists", id: string, title: string) => {
    pushPane(title, (body) => {
      body.innerHTML = `<p class="search__prompt">Loading…</p>`;
      collectionTracks(kind, id)
        .then((tracks) => {
          body.innerHTML = tracks.map(listRow).join("") || `<p class="search__prompt">No songs.</p>`;
          wireTrackList(body, tracks, `search-${kind}:${id}`);
        })
        .catch((e) => { body.innerHTML = `<p class="search__prompt">Failed to load: ${esc(String(e))}</p>`; });
    });
  };

  const openArtist = (id: string, name: string) => {
    pushPane(name, (body) => {
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
          body.addEventListener("click", (e) => {
            const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-album]");
            if (!tile) return;
            const al = d.albums.find((a) => a.catalogId === tile.dataset.album);
            if (al?.catalogId) openCollection("albums", al.catalogId, al.title);
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
    });
  };

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
    ]);
  };
  const collectionMenu = (e: MouseEvent, kind: "albums" | "playlists", id: string, ctx: string) => {
    const fetchThen = (how: "now" | "next" | "later") =>
      collectionTracks(kind, id)
        .then((tracks) => { if (tracks.length) enqueue(tracks, how, ctx); })
        .catch((err) => console.error("[search] collection enqueue", err));
    openContextMenu(e.clientX, e.clientY, [
      { label: "Play Now", run: () => void fetchThen("now") },
      { label: "Play Next", run: () => void fetchThen("next") },
      { label: "Add to Queue", run: () => void fetchThen("later") },
    ]);
  };

  // ── root interactions (delegated; survive re-renders) ──
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const recent = t.closest<HTMLElement>("[data-recent]");
    if (recent) {
      input.value = recent.dataset.recent!;
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
      openCollection("albums", album.dataset.album, al?.title ?? "Album");
      return;
    }
    const pl = t.closest<HTMLElement>("[data-playlist]");
    if (pl?.dataset.playlist) {
      const p = results?.playlists.find((x) => x.catalogId === pl.dataset.playlist);
      openCollection("playlists", pl.dataset.playlist, p?.name ?? "Playlist");
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
    if (album?.dataset.album) { e.preventDefault(); collectionMenu(e, "albums", album.dataset.album, `search-albums:${album.dataset.album}`); return; }
    const pl = t.closest<HTMLElement>("[data-playlist]");
    if (pl?.dataset.playlist) { e.preventDefault(); collectionMenu(e, "playlists", pl.dataset.playlist, `search-playlists:${pl.dataset.playlist}`); return; }
    const artist = t.closest<HTMLElement>("[data-artist]");
    if (artist?.dataset.artist) {
      e.preventDefault();
      const a = results?.artists.find((x) => x.catalogId === artist.dataset.artist);
      openContextMenu(e.clientX, e.clientY, [
        { label: "Go to Artist", run: () => openArtist(artist.dataset.artist!, a?.name ?? "Artist") },
      ]);
    }
  });

  renderEmpty();
  notifyHeader();

  return {
    destroy() {
      window.clearTimeout(debounceTimer);
      queryToken++; // orphan any in-flight response
      filterDropdown.destroy(); // drop doc listeners + unregister from the mode fan-out
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

// Home card (HOME.md) — the landing card: three shelves of what you played, what you
// added, and what this kind of hour usually holds. Every tile is local; the card costs
// no Apple call at any point, including its refresh.
//
// The shelves are the artist view's shelves (ARTIST-VIEW.md §2.2): a label, then one row
// of tiles that scrolls sideways, stacked down the card — the same `.search__scroller` +
// `.search__tile` markup, so Home wears no layout CSS of its own and all three shelves
// stay on screen at any window size (his call, 2026-09-15; it replaced a one-row-of-the-
// grid cap on the collection-card engine, which the card's width kept squeezing).
//
// This card does NOT ride the collection-card engine: with no vertical row list under
// the shelves, its Sort / View / Search toolbar would act on nothing. What is left is
// small — build the markup, delegate three listeners.
//
// The shelves rebuild when the library, the playlists or the played song changes, and on
// the header's refresh square — all from SQLite and the caches already in memory.

import { homeShelves, hideItem, fillArtistPhotos, type HomeItem, type HomeShelf } from "./home";
import { playTracks, playStation, queueStationAfter, onPlayerState } from "./player";
import { playlistShelfMenu } from "./artist-view";
import { trackMenu } from "./library-card";
import { requestOpenPlaylist, onPlaylistsChange } from "./playlists";
import { requestCard } from "./layout-bus";
import { copyStationLinkItem } from "./copy-link";
import { onTracksChange } from "./track-store";
import { toast } from "./toast";
import { openContextMenu, type MenuItem } from "./context-menu";
import { rowDrag, type DragPayload } from "./row-drag";
import { mosaicHTML } from "./mosaic";
import { esc } from "./collection-card";
import { enterRows } from "./pop";
import type { Artwork, Track } from "./library";
import type { CardDef } from "./cards";

const err = (what: string) => (e: unknown) => console.error(`[home] ${what}`, e);

const HEAD = `
  <header class="panel__head">
    <h2 class="panel__title">Home</h2>
    <button class="panel__action" id="home-refresh" type="button" aria-label="Refresh Home" title="Builds the shelves again from what you have played and added">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </header>
  <div class="panel__body"><div class="lib-shelves" data-shelves></div></div>`;

// ── one tile ──────────────────────────────────────────────────────────────────
const artURL = (art: Artwork | undefined, px: number): string | null =>
  art?.urlTemplate ? art.urlTemplate.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;

function tileArt(it: HomeItem): string {
  const round = it.round ? " search__tile-art--round" : "";
  const url = artURL(it.art, 192);
  if (url) return `<img class="search__tile-art${round}" src="${esc(url)}" alt="" loading="lazy" decoding="async" />`;
  // A playlist with no artwork of its own (never a round tile, so the base class stands).
  if (it.mosaic?.length) return mosaicHTML("search__tile-art", it.mosaic, it.mosaicSeed ?? it.key);
  return `<div class="search__tile-art search__tile-art--empty${round}" aria-hidden="true">♪</div>`;
}

/** `data-key` is the item's identity — the one thing a listener needs to find it again. */
const tileHTML = (it: HomeItem): string =>
  `<div class="search__tile" data-key="${esc(it.key)}" role="button" tabindex="0" title="${esc(it.title)}">` +
  `${tileArt(it)}<span class="search__tile-name">${esc(it.title)}</span>` +
  `<span class="search__tile-sub">${esc(it.sub)}</span></div>`;

const shelfHTML = (sh: HomeShelf): string =>
  `<div class="search__label">${esc(sh.label)}</div>` +
  `<div class="search__scroller">${sh.items.map(tileHTML).join("")}</div>`;

export const homeCard: CardDef = {
  id: "home",
  title: "Home",
  mount(host) {
    host.innerHTML = HEAD;
    const refreshBtn = host.querySelector<HTMLElement>("#home-refresh");
    const body = host.querySelector<HTMLElement>(".panel__body")!;
    const shelfBox = host.querySelector<HTMLElement>("[data-shelves]")!;

    let shelves: HomeShelf[] = [];
    let loading = true;
    let alive = true;

    const itemOf = (key: string | undefined): HomeItem | undefined =>
      key ? shelves.flatMap((s) => s.items).find((i) => i.key === key) : undefined;

    // A rebuild keeps each shelf's sideways scroll where the user left it.
    const render = () => {
      const scrolled = [...shelfBox.querySelectorAll<HTMLElement>(".search__scroller")].map((el) => el.scrollLeft);
      shelfBox.innerHTML = shelves.length
        ? shelves.map(shelfHTML).join("")
        : `<p class="lib-empty__msg">${loading ? "Looking through what you play…" : "Play something. Home fills itself."}</p>`;
      shelfBox.querySelectorAll<HTMLElement>(".search__scroller").forEach((el, i) => {
        if (scrolled[i]) el.scrollLeft = scrolled[i];
      });
    };

    // Rebuild every shelf. Cheap and local: one log read, one add-stamp read, the
    // cached playlists. Serialized — a burst of changes coalesces into one pass.
    let pending = false;
    let again = false;
    let first = true;
    const build = () => {
      if (pending) {
        again = true; // a hide (or a play) landed mid-build — run once more after it
        return;
      }
      pending = true;
      refreshBtn?.classList.add("is-busy");
      homeShelves()
        .then((s) => {
          if (alive) shelves = s;
        })
        .catch(err("build"))
        .finally(() => {
          pending = false;
          loading = false;
          refreshBtn?.classList.remove("is-busy");
          if (!alive) return;
          render();
          // The first fill slides its shelves in, as a card's rows do elsewhere.
          if (first && shelves.length) {
            first = false;
            enterRows([...shelfBox.children] as HTMLElement[]);
          }
          // An artist tile with no cached photo: one call each, once ever. Draw again
          // when one lands, so the borrowed album cover swaps for the real face.
          // A rebuild, not a redraw: the tile's artwork was chosen when the item was
          // built, so the new photo only reaches the shelf through another build. The
          // second pass asks for nothing (every name is memoized), so this cannot loop.
          void fillArtistPhotos(shelves.flatMap((sh) => sh.items))
            .then((got) => {
              if (got && alive) build();
            })
            .catch(err("artist photos"));
          if (again) {
            again = false;
            build();
          }
        });
    };

    // ── acting on a tile ──
    const activate = (it: HomeItem) => {
      if (it.kind === "station" && it.station) {
        void playStation(it.station).then(build).catch(err("play station"));
        return;
      }
      void Promise.resolve(it.tracks())
        .then((ts) => (ts.length ? playTracks(ts, 0, it.context) : undefined))
        .catch(err("play"));
    };

    // Hide: the tile goes, the shelf refills from the next candidate, and the toast
    // holds the undo. A hide never changes what the bucket shelf scores (HOME.md §4).
    const hideRow = (it: HomeItem): MenuItem => ({
      label: "Hide",
      run: () => {
        const undo = hideItem(it.key);
        build();
        toast({
          kind: "info",
          text: `Hid ${it.title}`,
          actions: [{ label: "Undo", run: () => { undo(); build(); } }],
        });
      },
    });

    const menuFor = (it: HomeItem): MenuItem[] => {
      if (it.kind === "station" && it.station) {
        const s = it.station;
        return [
          { label: "Play Now", run: () => void playStation(s).then(build).catch(err("play station")) },
          { label: "Add to Queue", run: () => void queueStationAfter(s).catch(err("queue station")) },
          copyStationLinkItem(s.url),
          hideRow(it),
        ].filter(Boolean) as MenuItem[];
      }
      if (it.kind === "playlist" && it.playlist) {
        const p = it.playlist;
        const open: MenuItem | null = p.libraryId
          ? {
              label: "Open in Playlists",
              run: () => {
                requestCard("playlists");
                requestOpenPlaylist(p.libraryId as string);
              },
            }
          : null;
        const load = () => Promise.resolve(it.tracks());
        return [...playlistShelfMenu(load, it.context, false), open, hideRow(it)].filter(Boolean) as MenuItem[];
      }
      // Songs, albums and artists are all track lists: the shared Library menu, which
      // brings Play Now / Next / Queue, Add to playlist, Go to…, the link and ♥.
      const list = it.tracks();
      return [...trackMenu(Array.isArray(list) ? list : ([] as Track[]), it.context), hideRow(it)];
    };

    const payloadFor = (it: HomeItem): DragPayload => ({
      source: "home",
      kind: it.kind === "artist" ? "artist" : it.kind,
      count: it.count,
      tracks: () => it.tracks(),
      station: it.station,
      context: it.context,
      playlistId: it.playlist?.libraryId,
      play: it.kind === "station" && it.station ? () => playStation(it.station as NonNullable<typeof it.station>) : undefined,
    });

    // A tile drags to any card that takes it (DRAG-DROP.md §2). Copy-only: the shelves
    // have no order of their own to reorder.
    const drag = rowDrag({
      root: body,
      label: "home",
      rowAt: (target) => {
        const el = tileAt(target);
        const it = itemOf(el?.dataset.key);
        return el && it ? { row: el, index: 0, payload: payloadFor(it) } : null;
      },
    });

    // ── three listeners over the whole card ──
    const tileAt = (target: EventTarget | null): HTMLElement | null =>
      target instanceof HTMLElement ? target.closest<HTMLElement>(".search__tile") : null;

    const onClick = (e: MouseEvent) => {
      if (drag.consumeClick()) return; // the tail of a drag, not a play
      const it = itemOf(tileAt(e.target)?.dataset.key);
      if (it) activate(it);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const it = itemOf(tileAt(e.target)?.dataset.key);
      if (!it) return;
      e.preventDefault();
      activate(it);
    };
    const onMenu = (e: MouseEvent) => {
      const el = tileAt(e.target);
      const it = itemOf(el?.dataset.key);
      if (!el || !it) return;
      e.preventDefault();
      el.classList.add("is-context");
      openContextMenu(e.clientX, e.clientY, menuFor(it), () => el.classList.remove("is-context"));
    };
    body.addEventListener("click", onClick);
    body.addEventListener("keydown", onKey);
    body.addEventListener("contextmenu", onMenu);

    // ── keeping up to date ──
    // A new song means a new play row, so Recently Played changed. Debounced, and only
    // on a real song change (play/pause fires the same listener).
    let lastSong = "";
    let timer: number | undefined;
    const offState = onPlayerState((s) => {
      const id = `${s.title ?? ""}${s.artist ?? ""}`;
      if (id === lastSong) return;
      lastSong = id;
      window.clearTimeout(timer);
      timer = window.setTimeout(build, 1500);
    });
    const offTracks = onTracksChange(() => build(), "home-card");
    const offPlaylists = onPlaylistsChange(() => build());

    render();
    build();
    refreshBtn?.addEventListener("click", build);

    return {
      destroy() {
        alive = false;
        window.clearTimeout(timer);
        offState();
        offTracks();
        offPlaylists();
        drag.destroy();
        body.removeEventListener("click", onClick);
        body.removeEventListener("keydown", onKey);
        body.removeEventListener("contextmenu", onMenu);
        host.innerHTML = "";
      },
    };
  },
};

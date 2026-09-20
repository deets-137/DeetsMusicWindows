// Home card (HOME.md) — the landing card: three shelves of what you played, what you
// added, and what this kind of hour usually holds. Nearly every tile is local. The card
// makes two Apple calls, one per shelf, at most once per floor (HOME.md §9): the plays
// and the adds made on your other devices, which never reach this machine otherwise.
// The refresh square asks Apple again; a failed call costs only the continuity.
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

import { wireListKeys } from "./list-keys";
import { homeShelves, hideItem, fillArtistPhotos, refreshApple, type HomeItem, type HomeShelf } from "./home";
import { playTracks, playStation, queueStationAfter, onPlayerState } from "./player";
import { playlistShelfMenu } from "./artist-view";
import { trackMenu } from "./library-card";
import { addSongToLibraryItem, addAlbumToLibraryItem, addAlbumFromSongsItem } from "./library-add";
import { requestOpenPlaylist, onPlaylistsChange } from "./playlists";
import { requestDrillCard } from "./layout-bus";
import { copyStationLinkItem, copyAlbumLinkFromSongItem, copyAlbumLinkItem } from "./copy-link";
import { goToAlbumItem, goToAlbumPaneItem, goToArtistItem, requestPlaylistPane } from "./go-to";
import { onTracksChange } from "./track-store";
import { toast } from "./toast";
import { openContextMenu, type MenuItem } from "./context-menu";
import { rowDrag, type DragPayload } from "./row-drag";
import { mosaicHTML } from "./mosaic";
import { esc } from "./collection-card";
import { enterRows } from "./pop";
import type { Artwork, Track } from "./library";
import type { CardDef, MountOpts } from "./cards";
import { scrollSnapshot, applyScrollSnapshot } from "./card-memory";
import { isPinned, pinItem, pinRows, pinActivate, pinBadgeHTML, handleUnpin, onPinsChange, PIN_GRIP, pinDragRow, isPinGrip } from "./pins";
import { sortByOrder, moveTo, onRowOrderChange, sectionsMovable, holdMs } from "./row-order";
import { pickByKey, pickMenu, suggestMarkItem, onSotdChange, SUGGEST_KEY } from "./sotd";
import * as diag from "./diag";

const err = (what: string) => (e: unknown) => console.error(`[home] ${what}`, e);

const HEAD = `
  <header class="panel__head">
    <h2 class="panel__title">Home</h2>
    <button class="panel__action" id="home-refresh" type="button" aria-label="Refresh Home" title="Builds the shelves again, and asks Apple Music what you played and added elsewhere">
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

/** `data-key` is the item's identity — the one thing a listener needs to find it again.
 *  On the Pinned shelf a tile also carries its place in that shelf and the grip that moves
 *  it (MOVABLE-ROWS.md §5.2); everywhere else it is exactly the tile it always was. */
const tileHTML = (it: HomeItem, i: number, pinShelf: boolean): string =>
  `<div class="search__tile${it.dashed ? " search__tile--offer" : ""}" data-key="${esc(it.key)}"` +
  `${pinShelf ? ` data-pin-idx="${i}"` : ""} role="button" tabindex="0" title="${esc(it.title)}">` +
  `${tileArt(it)}${isPinned(it.key) ? pinBadgeHTML(it.key) : ""}${pinShelf ? PIN_GRIP : ""}` +
  `<span class="search__tile-name">${esc(it.title)}</span>` +
  `<span class="search__tile-sub">${esc(it.sub)}</span></div>`;

// A shelf is one block: its label and the tiles under it move together (§4.1). The label
// is the header you hold.
const shelfHTML = (sh: HomeShelf, i: number): string =>
  `<section class="home-shelf" data-idx="${i}" data-shelf="${sh.id}">` +
  `<div class="search__label">${esc(sh.label)}</div>` +
  `<div class="search__scroller">${sh.items.map((it, n) => tileHTML(it, n, sh.id === "pinned")).join("")}</div></section>`;

export const homeCard: CardDef = {
  id: "home",
  title: "Home",
  mount(host, mountOpts?: MountOpts) {
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
    /** The shelves this render draws, in the user's own order (MOVABLE-ROWS.md §2). The
     *  push order in `homeShelves()` is the built-in order; a shelf the rank list does not
     *  name falls to the end (fork 3A). Keyed on `id`, never on the label — the bucket
     *  shelf's label changes with the hour. */
    const ordered = (): HomeShelf[] => sortByOrder("home.shelves", shelves, (sh) => sh.id);
    let shownIds: string[] = [];

    const render = () => {
      const scrolled = [...shelfBox.querySelectorAll<HTMLElement>(".search__scroller")].map((el) => el.scrollLeft);
      const list = ordered();
      shownIds = list.map((sh) => sh.id);
      shelfBox.innerHTML = shelves.length
        ? list.map(shelfHTML).join("")
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
      // A PINNED tile obeys the verb the pin carries, here as in the three cards (PINS.md
      // §8.2 fork 4: one pin, one verb, in all four Pinned shelves). Home has no detail of
      // its own, so an Open hops to the card that holds the item — `pinActivate` with no
      // nav does exactly that.
      if (isPinned(it.key)) {
        pinActivate(it, "home");
        if (it.kind === "station") build();
        return;
      }
      // The click trail (LOGGING.md §The click trail): which tile, and what it stands for
      // — a song tile queues ONE song, an album tile queues the album, and the two lead
      // to very different queues from the same gesture.
      diag.log("ui:act", { at: "home", do: "tile", kind: it.kind, n: it.count ?? 1 });
      if (it.kind === "station" && it.station) {
        void playStation(it.station).then(build).catch(err("play station"));
        return;
      }
      // An album or artist off the library plays whole (its `whole` fetch), not only the songs known.
      void (it.whole?.() ?? Promise.resolve(it.tracks()))
        .then((ts) => (ts.length ? playTracks(ts, 0, it.context) : undefined))
        .catch(err("play"));
    };

    // Hide: the tile goes, the shelf refills from the next candidate, and the toast
    // holds the undo. A hide never changes what the bucket shelf scores (HOME.md §4).
    // A pinned tile is never hidden (PINS.md): its row is Unpin, which the menu carries.
    const hideRow = (it: HomeItem): MenuItem | null => isPinned(it.key) ? null : ({
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
          pinItem(it.key, "station", s),
          hideRow(it),
        ].filter(Boolean) as MenuItem[];
      }
      if (it.kind === "playlist" && it.playlist) {
        const p = it.playlist;
        // Yours opens in the Playlists card, where you can edit it. One of Apple's, which
        // this card has no row for, opens as a Search pane — the same pane a Featured
        // Playlists tile opens (ARTIST-VIEW.md §5). Before 2026-09-20 it had neither.
        const open: MenuItem | null = p.libraryId
          ? {
              label: "Open in Playlists",
              run: () => {
                requestDrillCard("playlists");
                requestOpenPlaylist(p.libraryId as string);
              },
            }
          : p.catalogId
            ? {
                label: "Go to Playlist",
                run: () =>
                  requestPlaylistPane({ id: p.catalogId as string, name: p.name, artwork: p.artwork, curatorName: p.curatorName }),
              }
            : null;
        const load = () => Promise.resolve(it.tracks());
        return [...playlistShelfMenu(load, it.context, false), open, ...pinRows(it.key, "playlist"), hideRow(it)].filter(Boolean) as MenuItem[];
      }
      // An album or an artist the library does not hold: its rows load the whole list (the
      // shelf menu's loader shape), the drill-ins, an album's link, and the pin (an album's
      // known songs are its snapshot; an artist's snapshot is already in the pin).
      //
      // Two kinds of tile land here, and they differ only in what they can hop FROM. A tile
      // built from songs (Recently Played, Added, the bucket) hops from any song that has a
      // catalog id. A tile built from a catalog album — the "New" shelf — holds the album's
      // OWN id, so it opens the pane with no hop and asks Apple for the artist directly.
      if (it.whole) {
        const known = it.tracks();
        const seed = Array.isArray(known) ? known.find((t) => t.catalogId) : undefined;
        const album = it.kind === "album";
        const artist = it.artistName ?? it.sub;
        return [
          ...playlistShelfMenu(it.whole, it.context, false),
          album
            ? it.catalogId
              ? goToAlbumPaneItem({ id: it.catalogId, name: it.title, artwork: it.art, artistName: it.artistName })
              : goToAlbumItem(seed?.catalogId, it.title)
            : null,
          album && it.catalogId
            ? goToArtistItem("albums", it.catalogId, artist)
            : goToArtistItem("songs", seed?.catalogId, album ? artist : it.title),
          album ? (it.catalogId ? copyAlbumLinkItem(it.catalogId) : copyAlbumLinkFromSongItem(seed?.catalogId)) : null,
          // "Add to Library" (2026-09-20): by the album's own id where the tile has one —
          // a "New" tile, which needs no hop and whose songs are not here to test, so the
          // row stands on the toggle alone — else from the songs the tile knows.
          album
            ? it.catalogId
              ? addAlbumToLibraryItem(it.catalogId, it.whole)
              : addAlbumFromSongsItem(Array.isArray(known) ? known : [])
            : null,
          // A pin keeps its own snapshot of the songs (PINS.md): a tile that knows none yet
          // — a release that is not out — has nothing to pin, so it offers no Pin row. It
          // never did; whether an unreleased album can be pinned is its own question.
          ...(it.catalogId ? [] : pinRows(it.key, it.kind, album && Array.isArray(known) ? known : undefined)),
          hideRow(it),
        ].filter(Boolean) as MenuItem[];
      }
      // A Song of the Day tile: the pick's own rows (a note, Post Now, Unmark) after the
      // song's, and the suggestion, whose first row is the Mark it exists for (§8.6).
      if (it.key === SUGGEST_KEY) {
        const list = it.tracks();
        const one = Array.isArray(list) ? list[0] : undefined;
        return one ? [suggestMarkItem(one), ...trackMenu([one], it.context)] : [];
      }
      const pick = it.key.startsWith("pick:") ? pickByKey(it.key) : undefined;
      if (pick) {
        const list = it.tracks();
        return [...trackMenu(Array.isArray(list) ? list : ([] as Track[]), it.context), ...pickMenu(pick)];
      }
      // Songs, albums and artists are all track lists: the shared Library menu, which
      // brings Play Now / Next / Queue, Add to playlist, Go to…, the link, ♥ and — for an
      // album this card shows but the library does not hold — Add to Library.
      // (`trackMenu` carries Pin / Unpin itself, from the context tag or the one song.)
      //
      // A SONG's own Add to Library is not in that shared menu: every card wires it in
      // itself (Queue, History, Now Playing, Playlists), and this card never did — so a
      // song tile on Home could not be added anywhere (the owner, 2026-09-20). It sits
      // where the other cards put it: after the link and the station, before ♥ and Hide.
      const list = it.tracks();
      const rows = Array.isArray(list) ? list : ([] as Track[]);
      const one = rows.length === 1 ? rows[0] : undefined;
      return [
        ...trackMenu(rows, it.context),
        one ? addSongToLibraryItem(one) : null,
        hideRow(it),
      ].filter(Boolean) as MenuItem[];
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

    // A tile drags to any card that takes it (DRAG-DROP.md §2). Three presses share the
    // one primitive now (MOVABLE-ROWS.md): a pinned tile's grip moves it along its shelf,
    // a HELD shelf label moves the whole shelf, and anything else is the copy it always was.
    const drag = rowDrag({
      root: body,
      label: "home",
      rowAt: (target) => {
        const pin = pinDragRow(target);
        if (pin) return pin;
        const label = target.closest<HTMLElement>(".search__label");
        if (label && sectionsMovable()) {
          const sec = label.closest<HTMLElement>(".home-shelf");
          const idx = sec?.dataset.idx;
          const id = sec?.dataset.shelf;
          if (sec && idx !== undefined && id) {
            return {
              row: sec,
              index: Number(idx),
              list: shelfBox,
              count: shownIds.length,
              measure: true, // a shelf is as tall as its tiles
              hold: holdMs(),
              done: (to) => {
                if (to != null) void moveTo("home.shelves", shownIds, id, to);
              },
            };
          }
        }
        const el = tileAt(target);
        const it = itemOf(el?.dataset.key);
        return el && it ? { row: el, index: 0, payload: payloadFor(it) } : null;
      },
    });

    // ── three listeners over the whole card ──
    const tileAt = (target: EventTarget | null): HTMLElement | null =>
      target instanceof HTMLElement ? target.closest<HTMLElement>(".search__tile") : null;

    const onClick = (e: MouseEvent) => {
      if (handleUnpin(e)) return; // the badge unpins; the tile does not play
      if (isPinGrip(e)) return; // the grip moves the tile; it never plays it
      if (drag.consumeClick()) return; // the tail of a drag, not a play
      const it = itemOf(tileAt(e.target)?.dataset.key);
      if (it) activate(it);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target instanceof HTMLElement && e.target.closest("[data-unpin]")) return; // the badge's own key press
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
    const unwireKeys = wireListKeys(body, { rows: ".search__tile", activate: false }); // the tiles keep their own Enter
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
    const offPins = onPinsChange(() => build());
    const offSotd = onSotdChange(() => build());
    // A move — this card's own, or a Reset — redraws the shelves. The shelves themselves
    // are unchanged, so this is a render, not a build.
    const offOrder = onRowOrderChange(() => { if (alive) render(); });

    render();
    build();
    refreshBtn?.addEventListener("click", () => {
      refreshApple(); // the square is the one place that overrides the Apple floor
      build();
    });
    // Card memory (CARD-MEMORY.md §5): the body scroll and each shelf's sideways place, once
    // the shelves are built (the build is a local read, so it lands in a later task).
    applyScrollSnapshot(body, mountOpts?.memory, ".search__scroller");

    return {
      snapshot: () => scrollSnapshot(body, ".search__scroller"),
      destroy() {
        alive = false;
        window.clearTimeout(timer);
        offState();
        offSotd();
        offTracks();
        offPlaylists();
        offPins();
        offOrder();
        drag.destroy();
        body.removeEventListener("click", onClick);
        body.removeEventListener("keydown", onKey);
        unwireKeys();
        body.removeEventListener("contextmenu", onMenu);
        host.innerHTML = "";
      },
    };
  },
};
